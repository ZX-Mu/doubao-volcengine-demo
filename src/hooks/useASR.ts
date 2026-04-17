import { useState, useCallback, useRef } from 'react';
import { generateReqId, constructHeader, parseHeader } from '../utils/volcengine';

const ASR_PROXY_URL = '/api/proxy/asr';
const DEFAULT_RESOURCE_IDS = {
    bidirectional: 'volc.bigasr.sauc.duration',
    async: 'volc.seedasr.sauc.duration',
    nostream: 'volc.seedasr.sauc.duration',
} as const;
const GENERIC_ASR_REQUEST_CONFIG = {
    bidirectional: {
        result_type: 'full',
    },
    nostream: {
        result_type: 'single',
    },
} as const;
const WORKLET_URL = new URL('../worklets/asr-pcm-worklet.js', import.meta.url);
const TARGET_SAMPLE_RATE = 16000;
export type ASRMode = 'bidirectional' | 'async' | 'nostream';

interface ASROptions {
    appId: string;
    token: string;
    mode: ASRMode;
    resourceId?: string;
}

interface ASRResult {
    text: string;
    isFinal: boolean;
    sequence?: number;
    receivedAt: number;
}

interface ParsedServerMessage {
    header: ReturnType<typeof parseHeader>;
    payload: any;
    sequenceOrCode?: number;
}

function buildFrame(
    messageType: number,
    messageFlags: number,
    serialization: number,
    payload: Uint8Array
): ArrayBuffer {
    const header = constructHeader(messageType, messageFlags, serialization, 0x0);
    const frame = new Uint8Array(header.length + 4 + payload.byteLength);
    frame.set(header, 0);
    new DataView(frame.buffer).setUint32(header.length, payload.byteLength, false);
    frame.set(payload, header.length + 4);
    return frame.buffer;
}

function parseServerMessage(buffer: ArrayBuffer): ParsedServerMessage | null {
    const header = parseHeader(buffer);
    if (!header) return null;

    let offset = header.headerSize;
    let sequenceOrCode: number | undefined;
    const view = new DataView(buffer);

    // ASR 服务端响应通常带 [4B seq/code][4B payloadSize][payload]
    if (header.messageType === 0x9 || header.messageType === 0xf) {
        if (buffer.byteLength < offset + 8) return null;
        sequenceOrCode = view.getInt32(offset, false);
        offset += 4;
    }

    if (buffer.byteLength < offset + 4) return null;
    const payloadSize = view.getUint32(offset, false);
    offset += 4;
    const end = Math.min(offset + payloadSize, buffer.byteLength);
    if (offset > end) return null;

    const payloadBytes = new Uint8Array(buffer.slice(offset, end));
    let payload: any = null;
    try {
        payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
        payload = {
            rawText: new TextDecoder().decode(payloadBytes),
        };
    }

    return { header, payload, sequenceOrCode };
}

function extractTextFromArray(result: any[]): string {
    return result
        .map((item: any) => {
            if (!item) return '';
            if (typeof item === 'string') return item;
            return item.text ?? item.utterance ?? item.transcript ?? '';
        })
        .filter(Boolean)
        .join('');
}

function decodePayload(buffer: ArrayBuffer, headerSize: number) {
    if (buffer.byteLength < headerSize + 4) return null;
    const view = new DataView(buffer);
    const payloadSize = view.getUint32(headerSize, false);
    const start = headerSize + 4;
    const end = Math.min(start + payloadSize, buffer.byteLength);
    if (start > end) return null;
    return new Uint8Array(buffer.slice(start, end));
}

function extractText(result: any): string {
    if (!result) return '';
    if (typeof result.text === 'string') return result.text;
    if (typeof result.transcript === 'string') return result.transcript;
    if (Array.isArray(result)) return extractTextFromArray(result);
    if (Array.isArray(result.records)) return extractTextFromArray(result.records);
    if (Array.isArray(result.results)) return extractTextFromArray(result.results);
    if (Array.isArray(result.utterances)) {
        return extractTextFromArray(result.utterances);
    }
    return '';
}

export function useASR() {
    const [isRecording, setIsRecording] = useState(false);
    const [result, setResult] = useState<ASRResult>({ text: '', isFinal: false, receivedAt: 0 });
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const isStoppingRef = useRef(false);
    const finSentRef = useRef(false);
    const reqIdRef = useRef<string>('');
    const sessionIdRef = useRef(0);

    const releaseAudio = useCallback(() => {
        workletNodeRef.current?.port.close();
        workletNodeRef.current?.disconnect();
        workletNodeRef.current = null;
        sourceNodeRef.current?.disconnect();
        sourceNodeRef.current = null;
        audioContextRef.current?.close().catch(() => {});
        audioContextRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    const stop = useCallback(() => {
        if (isStoppingRef.current) return;
        isStoppingRef.current = true;

        releaseAudio();

        const ws = wsRef.current;

        if (ws?.readyState === WebSocket.OPEN) {
            if (!finSentRef.current) {
                finSentRef.current = true;
                ws.send(buildFrame(0x2, 0x2, 0x0, new Uint8Array(0)));
            }
        } else if (ws?.readyState === WebSocket.CONNECTING) {
            wsRef.current = null;
            ws.close();
        }

        setIsRecording(false);
        isStoppingRef.current = false;
    }, [releaseAudio]);

    const start = useCallback(async (options: ASROptions) => {
        if (isStoppingRef.current) return;
        if (!options.appId || !options.token) {
            setError('请先配置 App ID 和 Access Token');
            return;
        }

        setError(null);
        setResult({ text: '', isFinal: false, receivedAt: 0 });
        sessionIdRef.current += 1;
        const sessionId = sessionIdRef.current;

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });
        } catch {
            setError('无法访问麦克风，请检查浏览器权限');
            return;
        }
        streamRef.current = stream;

        const connectId = generateReqId();
        const resourceId = options.resourceId ?? DEFAULT_RESOURCE_IDS[options.mode];
        reqIdRef.current = generateReqId();
        finSentRef.current = false;
        const requestConfig = GENERIC_ASR_REQUEST_CONFIG[options.mode as 'bidirectional' | 'nostream'];

        let ws: WebSocket;
        try {
            const url = `${ASR_PROXY_URL}?appId=${encodeURIComponent(options.appId)}&token=${encodeURIComponent(options.token)}&resourceId=${encodeURIComponent(resourceId)}&connectId=${encodeURIComponent(connectId)}&mode=${encodeURIComponent(options.mode)}`;
            ws = new WebSocket(url);
        } catch {
            releaseAudio();
            setError('无法创建本地 ASR 代理连接');
            return;
        }

        wsRef.current = ws;
        ws.binaryType = 'arraybuffer';

        ws.onopen = async () => {
            try {
                if (sessionIdRef.current !== sessionId || wsRef.current !== ws) return;
                const handshake = {
                    user: { uid: `web_${connectId.slice(0, 8)}` },
                    audio: {
                        format: 'pcm',
                        rate: TARGET_SAMPLE_RATE,
                        bits: 16,
                        channel: 1,
                        codec: 'raw',
                    },
                    request: {
                        reqid: reqIdRef.current,
                        model_name: 'bigmodel',
                        sequence: 1,
                        result_type: requestConfig.result_type,
                        enable_itn: true,
                        enable_punc: true,
                        show_utterances: true,
                    },
                };

                ws.send(buildFrame(0x1, 0x0, 0x1, new TextEncoder().encode(JSON.stringify(handshake))));

                const audioContext = new AudioContext({
                    sampleRate: TARGET_SAMPLE_RATE,
                    latencyHint: 'interactive',
                });
                if (sessionIdRef.current !== sessionId || wsRef.current !== ws) {
                    await audioContext.close().catch(() => {});
                    return;
                }
                audioContextRef.current = audioContext;
                await audioContext.audioWorklet.addModule(WORKLET_URL);
                if (sessionIdRef.current !== sessionId || wsRef.current !== ws || audioContext.state === 'closed') {
                    return;
                }

                const sourceNode = audioContext.createMediaStreamSource(stream);
                sourceNodeRef.current = sourceNode;
                const workletNode = new AudioWorkletNode(audioContext, 'asr-pcm-worklet');
                workletNodeRef.current = workletNode;
                workletNode.port.postMessage({
                    type: 'config',
                    targetSampleRate: TARGET_SAMPLE_RATE,
                    inputSampleRate: audioContext.sampleRate,
                    frameDurationMs: 200,
                });

                workletNode.port.onmessage = (event) => {
                    if (sessionIdRef.current !== sessionId || wsRef.current !== ws) return;
                    if (event.data?.type === 'debug') {
                        console.info('[ASR Worklet]', event.data.message);
                        return;
                    }
                    if (ws.readyState !== WebSocket.OPEN) return;
                    const chunk = event.data;
                    if (!(chunk instanceof ArrayBuffer) || chunk.byteLength === 0) return;
                    ws.send(buildFrame(0x2, 0x0, 0x0, new Uint8Array(chunk)));
                };

                sourceNode.connect(workletNode);
                setIsRecording(true);
            } catch (err: any) {
                if (sessionIdRef.current !== sessionId) return;
                setError(err?.message || 'ASR 音频链路初始化失败');
                stop();
            }
        };

        ws.onmessage = (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const buffer = event.data as ArrayBuffer;
            const parsed = parseServerMessage(buffer);
            if (!parsed) return;

            const { header, payload, sequenceOrCode } = parsed;

            if (header.messageType === 0xf || (payload?.code !== undefined && payload.code !== 0 && payload.code !== 1000)) {
                const errorCode = payload?.code ?? sequenceOrCode ?? '?';
                const errorMessage = payload?.message ?? payload?.msg ?? payload?.rawText ?? '未知错误';
                setError(`ASR Error [${errorCode}]: ${errorMessage}`);
                sessionIdRef.current += 1;
                stop();
                return;
            }

            const nextText =
                extractText(payload?.result) ||
                extractText(payload?.results) ||
                extractText(payload?.utterances) ||
                extractText(payload?.data);

            if (!nextText) return;

            setResult({
                text: nextText,
                isFinal: Boolean(
                    payload?.result?.is_final ??
                    payload?.result?.final ??
                    payload?.result?.end ??
                    payload?.is_final ??
                    payload?.final ??
                    payload?.end
                ),
                sequence: sequenceOrCode,
                receivedAt: Date.now(),
            });

            const isFinal = Boolean(
                payload?.result?.is_final ??
                payload?.result?.final ??
                payload?.result?.end ??
                payload?.is_final ??
                payload?.final ??
                payload?.end
            );

            if (isFinal && finSentRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.close(1000, 'final result received');
                wsRef.current = null;
            }
        };

        ws.onerror = () => {
            setError('ASR 代理连接失败，请确认本地开发服务正在运行且配置有效');
            sessionIdRef.current += 1;
            releaseAudio();
            wsRef.current = null;
            setIsRecording(false);
        };

        ws.onclose = (event) => {
            sessionIdRef.current += 1;
            wsRef.current = null;
            setIsRecording(false);
            if (event.code !== 1000 && event.code !== 1001) {
                setError(`ASR 连接关闭 [${event.code}]${event.reason ? `: ${event.reason}` : ''}`);
            }
            finSentRef.current = false;
            if (event.code !== 1000 && event.code !== 1001) {
                releaseAudio();
            }
        };
    }, [releaseAudio, stop]);

    return { start, stop, isRecording, result, error };
}
