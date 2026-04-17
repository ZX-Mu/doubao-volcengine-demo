import { useState, useCallback, useRef } from 'react';
import { constructHeader, generateReqId, parseHeader } from '../utils/volcengine';

const ASR_ASYNC_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const DEFAULT_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const WORKLET_URL = new URL('../worklets/asr-pcm-worklet.js', import.meta.url);
const TARGET_SAMPLE_RATE = 16000;

interface ASRAsyncOptions {
    appId: string;
    token: string;
    resourceId?: string;
}

interface ASRAsyncResult {
    text: string;
    isFinal: boolean;
    sequence?: number;
    receivedAt: number;
}

function buildFrame(messageType: number, messageFlags: number, serialization: number, payload: Uint8Array) {
    const header = constructHeader(messageType, messageFlags, serialization, 0x0);
    const frame = new Uint8Array(header.length + 4 + payload.byteLength);
    frame.set(header, 0);
    new DataView(frame.buffer).setUint32(header.length, payload.byteLength, false);
    frame.set(payload, header.length + 4);
    return frame.buffer;
}

function parseServerMessage(buffer: ArrayBuffer) {
    const header = parseHeader(buffer);
    if (!header) return null;

    let offset = header.headerSize;
    let sequenceOrCode: number | undefined;
    const view = new DataView(buffer);

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
    try {
        return {
            header,
            sequenceOrCode,
            payload: JSON.parse(new TextDecoder().decode(payloadBytes)),
        };
    } catch {
        return null;
    }
}

function extractText(payload: any) {
    return payload?.result?.text ?? payload?.text ?? '';
}

export function useASRAsync() {
    const [isRecording, setIsRecording] = useState(false);
    const [result, setResult] = useState<ASRAsyncResult>({ text: '', isFinal: false, receivedAt: 0 });
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
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
        sessionIdRef.current += 1;
        releaseAudio();

        const ws = wsRef.current;
        wsRef.current = null;

        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(buildFrame(0x2, 0x2, 0x0, new Uint8Array(0)));
            ws.close(1000, 'session ended');
        } else if (ws?.readyState === WebSocket.CONNECTING) {
            ws.close();
        }

        setIsRecording(false);
    }, [releaseAudio]);

    const start = useCallback(async (options: ASRAsyncOptions) => {
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
                    sampleRate: TARGET_SAMPLE_RATE,
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

        const resourceId = options.resourceId ?? DEFAULT_RESOURCE_ID;
        const reqId = generateReqId();
        const wsUrl = `${ASR_ASYNC_URL}?api_appid=${encodeURIComponent(options.appId)}&api_access_key=${encodeURIComponent(options.token)}&api_resource_id=${encodeURIComponent(resourceId)}`;

        let ws: WebSocket;
        try {
            ws = new WebSocket(wsUrl);
        } catch {
            releaseAudio();
            setError('无法创建 ASR WebSocket 连接');
            return;
        }

        wsRef.current = ws;
        ws.binaryType = 'arraybuffer';

        ws.onopen = async () => {
            try {
                if (sessionIdRef.current !== sessionId || wsRef.current !== ws) return;

                ws.send(buildFrame(0x1, 0x0, 0x1, new TextEncoder().encode(JSON.stringify({
                    user: { uid: `web_${reqId.slice(0, 8)}` },
                    audio: {
                        format: 'pcm',
                        rate: TARGET_SAMPLE_RATE,
                        bits: 16,
                        channel: 1,
                        codec: 'raw',
                    },
                    request: {
                        reqid: reqId,
                        model_name: 'bigmodel',
                        sequence: 1,
                        result_type: 'full',
                        enable_itn: true,
                        enable_punc: true,
                        show_utterances: true,
                    },
                }))));

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
                    if (event.data?.type === 'debug') return;
                    if (ws.readyState !== WebSocket.OPEN) return;
                    const chunk = event.data;
                    if (!(chunk instanceof ArrayBuffer) || chunk.byteLength === 0) return;
                    ws.send(buildFrame(0x2, 0x0, 0x0, new Uint8Array(chunk)));
                };

                sourceNode.connect(workletNode);
                setIsRecording(true);
            } catch (err: any) {
                if (sessionIdRef.current !== sessionId) return;
                setError(err?.message || 'ASR async 音频链路初始化失败');
                stop();
            }
        };

        ws.onmessage = (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const parsed = parseServerMessage(event.data);
            if (!parsed) return;

            const { header, payload, sequenceOrCode } = parsed;
            if (header.messageType === 0xf || (payload?.code !== undefined && payload.code !== 0 && payload.code !== 1000)) {
                setError(`ASR Error [${payload?.code ?? sequenceOrCode ?? '?'}]: ${payload?.message ?? payload?.msg ?? '未知错误'}`);
                stop();
                return;
            }

            const text = extractText(payload);
            if (!text) return;

            setResult({
                text,
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
        };

        ws.onerror = () => {
            setError('ASR WebSocket 连接失败，请确认 async 模式的配置和权限有效');
            releaseAudio();
            wsRef.current = null;
            setIsRecording(false);
        };

        ws.onclose = (event) => {
            wsRef.current = null;
            setIsRecording(false);
            if (event.code !== 1000 && event.code !== 1001) {
                setError(`ASR 连接关闭 [${event.code}]${event.reason ? `: ${event.reason}` : ''}`);
                releaseAudio();
            }
        };
    }, [releaseAudio, stop]);

    return { start, stop, isRecording, result, error };
}
