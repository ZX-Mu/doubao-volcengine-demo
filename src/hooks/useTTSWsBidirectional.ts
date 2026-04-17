import { useState, useCallback, useRef } from 'react';
import { constructHeader, generateReqId } from '../utils/volcengine';

const TTS_WS_BIDIRECTIONAL_PROXY_URL = '/api/proxy/tts/ws-bidirectional';

const EVENT = {
    START_CONNECTION: 1,
    FINISH_CONNECTION: 2,
    CONNECTION_STARTED: 50,
    CONNECTION_FAILED: 51,
    START_SESSION: 100,
    FINISH_SESSION: 102,
    TASK_REQUEST: 200,
    SESSION_STARTED: 150,
    SESSION_FINISHED: 152,
    SESSION_FAILED: 153,
} as const;

const MESSAGE_TYPE = {
    FULL_CLIENT_REQUEST: 0x1,
    FULL_SERVER_RESPONSE: 0x9,
    AUDIO_ONLY_RESPONSE: 0xb,
    ERROR: 0xf,
} as const;

interface TTSWsBidirectionalOptions {
    appId: string;
    token: string;
    resourceId: string;
    voiceType: string;
    speechRate?: number;
    pitchRate?: number;
    loudnessRate?: number;
}

interface TTSWsBidirectionalState {
    chunkCount: number;
    audioUrl: string | null;
    fileName: string;
    audioByteLength: number;
}

interface ParsedBidirectionalFrame {
    messageType: number;
    messageFlags: number;
    serialization: number;
    compression: number;
    event?: number;
    identifier?: string;
    payload: Uint8Array;
    errorCode?: number;
}

function concatUint8Arrays(chunks: Uint8Array[]) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}

function decodePayloadText(payload: Uint8Array) {
    if (payload.length === 0) return '';
    return new TextDecoder().decode(payload);
}

function tryReadIdentifierAndPayload(view: DataView, buffer: ArrayBuffer, offset: number) {
    if (buffer.byteLength < offset + 4) {
        return { identifier: undefined, payload: new Uint8Array() };
    }

    const candidateIdLength = view.getUint32(offset, false);
    const candidateIdStart = offset + 4;
    const candidatePayloadLengthOffset = candidateIdStart + candidateIdLength;
    if (buffer.byteLength >= candidatePayloadLengthOffset + 4) {
        const candidatePayloadLength = view.getUint32(candidatePayloadLengthOffset, false);
        const candidatePayloadStart = candidatePayloadLengthOffset + 4;
        const candidatePayloadEnd = candidatePayloadStart + candidatePayloadLength;
        if (candidatePayloadEnd <= buffer.byteLength) {
            const identifier = new TextDecoder().decode(buffer.slice(candidateIdStart, candidatePayloadLengthOffset));
            return {
                identifier,
                payload: new Uint8Array(buffer.slice(candidatePayloadStart, candidatePayloadEnd)),
            };
        }
    }

    const payloadLength = view.getUint32(offset, false);
    const payloadStart = offset + 4;
    const payloadEnd = payloadStart + payloadLength;
    return {
        identifier: undefined,
        payload: new Uint8Array(buffer.slice(payloadStart, Math.min(payloadEnd, buffer.byteLength))),
    };
}

function parseMessage(buffer: ArrayBuffer): ParsedBidirectionalFrame | null {
    if (buffer.byteLength < 8) return null;

    const view = new DataView(buffer);
    const headerSize = (view.getUint8(0) & 0x0f) * 4;
    const messageType = view.getUint8(1) >> 4;
    const messageFlags = view.getUint8(1) & 0x0f;
    const serialization = view.getUint8(2) >> 4;
    const compression = view.getUint8(2) & 0x0f;

    let offset = headerSize;

    if (messageType === MESSAGE_TYPE.ERROR) {
        if (buffer.byteLength < offset + 8) return null;
        const errorCode = view.getUint32(offset, false);
        offset += 4;
        const payloadSize = view.getUint32(offset, false);
        offset += 4;
        return {
            messageType,
            messageFlags,
            serialization,
            compression,
            errorCode,
            payload: new Uint8Array(buffer.slice(offset, offset + payloadSize)),
        };
    }

    const hasEvent = (messageFlags & 0x4) === 0x4;
    let event: number | undefined;
    if (hasEvent) {
        if (buffer.byteLength < offset + 4) return null;
        event = view.getInt32(offset, false);
        offset += 4;
    }

    if (messageType === MESSAGE_TYPE.AUDIO_ONLY_RESPONSE) {
        const parsed = tryReadIdentifierAndPayload(view, buffer, offset);
        return {
            messageType,
            messageFlags,
            serialization,
            compression,
            event,
            identifier: parsed.identifier,
            payload: parsed.payload,
        };
    }

    const parsed = tryReadIdentifierAndPayload(view, buffer, offset);
    return {
        messageType,
        messageFlags,
        serialization,
        compression,
        event,
        identifier: parsed.identifier,
        payload: parsed.payload,
    };
}

function buildFrame({
    messageType,
    serialization,
    compression,
    event,
    identifier,
    payload,
}: {
    messageType: number;
    serialization: number;
    compression: number;
    event?: number;
    identifier?: string;
    payload: Uint8Array;
}) {
    const flags = event !== undefined ? 0x4 : 0x0;
    const header = constructHeader(messageType, flags, serialization, compression);
    const idBytes = identifier ? new TextEncoder().encode(identifier) : undefined;
    const extraSize = (event !== undefined ? 4 : 0) + (idBytes ? 4 + idBytes.length : 0) + 4;
    const frame = new Uint8Array(header.length + extraSize + payload.length);
    const view = new DataView(frame.buffer);

    frame.set(header, 0);
    let offset = header.length;

    if (event !== undefined) {
        view.setInt32(offset, event, false);
        offset += 4;
    }

    if (idBytes) {
        view.setUint32(offset, idBytes.length, false);
        offset += 4;
        frame.set(idBytes, offset);
        offset += idBytes.length;
    }

    view.setUint32(offset, payload.length, false);
    offset += 4;
    frame.set(payload, offset);
    return frame.buffer;
}

function getErrorMessage(parsed: ParsedBidirectionalFrame) {
    const rawText = decodePayloadText(parsed.payload);
    if (!rawText) {
        return parsed.errorCode ? `TTS 双向 WebSocket 返回错误(code=${parsed.errorCode})` : 'TTS 双向 WebSocket 返回错误';
    }

    try {
        const json = JSON.parse(rawText);
        return json?.message ?? json?.msg ?? json?.error ?? rawText;
    } catch {
        return parsed.errorCode ? `${rawText} (code=${parsed.errorCode})` : rawText;
    }
}

export function useTTSWsBidirectional() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ttsState, setTtsState] = useState<TTSWsBidirectionalState>({
        chunkCount: 0,
        audioUrl: null,
        fileName: 'doubao-tts-ws-bidirectional.mp3',
        audioByteLength: 0,
    });

    const wsRef = useRef<WebSocket | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const stop = useCallback(() => {
        const ws = wsRef.current;
        wsRef.current = null;
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    const finishConnectionPayload = new TextEncoder().encode('{}');
                    ws.send(buildFrame({
                        messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                        serialization: 0x1,
                        compression: 0x0,
                        event: EVENT.FINISH_CONNECTION,
                        payload: finishConnectionPayload,
                    }));
                }
            } catch {
                // Ignore best-effort shutdown failures.
            }
            ws.close();
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }
        setIsPlaying(false);
    }, []);

    const speak = useCallback(async (text: string, options: TTSWsBidirectionalOptions) => {
        stop();
        setError(null);

        if (!options.appId || !options.token || !options.resourceId) {
            setError('请先配置 App ID、Access Token 和 TTS Resource ID');
            return;
        }

        if (!text.trim()) {
            setError('请输入需要合成的文本');
            return;
        }

        if (ttsState.audioUrl) {
            URL.revokeObjectURL(ttsState.audioUrl);
        }
        setTtsState({
            chunkCount: 0,
            audioUrl: null,
            fileName: `doubao-tts-ws-bidirectional-${Date.now()}.mp3`,
            audioByteLength: 0,
        });
        setIsPlaying(true);

        const connectId = generateReqId();
        const sessionId = generateReqId();
        const wsUrl = `${TTS_WS_BIDIRECTIONAL_PROXY_URL}?appId=${encodeURIComponent(options.appId)}&token=${encodeURIComponent(options.token)}&resourceId=${encodeURIComponent(options.resourceId)}&connectId=${encodeURIComponent(connectId)}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.binaryType = 'arraybuffer';

        const audioChunks: Uint8Array[] = [];
        let chunkCount = 0;
        let sessionStarted = false;
        let taskDispatched = false;

        const sendStartSession = () => {
            const request = {
                user: {
                    uid: `web_${generateReqId().slice(0, 8)}`,
                },
                event: EVENT.START_SESSION,
                namespace: 'BidirectionalTTS',
                req_params: {
                    speaker: options.voiceType,
                    audio_params: {
                        format: 'mp3',
                        sample_rate: 24000,
                        bit_rate: 128000,
                        speech_rate: options.speechRate ?? 0,
                        loudness_rate: options.loudnessRate ?? 0,
                        pitch_rate: options.pitchRate ?? 0,
                    },
                },
            };

            const payload = new TextEncoder().encode(JSON.stringify(request));
            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.START_SESSION,
                identifier: sessionId,
                payload,
            }));
        };

        const sendTaskRequestAndFinish = () => {
            if (taskDispatched) return;
            taskDispatched = true;

            const taskPayload = new TextEncoder().encode(JSON.stringify({
                event: EVENT.TASK_REQUEST,
                namespace: 'BidirectionalTTS',
                req_params: {
                    text,
                },
            }));

            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.TASK_REQUEST,
                identifier: sessionId,
                payload: taskPayload,
            }));

            const finishPayload = new TextEncoder().encode('{}');
            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.FINISH_SESSION,
                identifier: sessionId,
                payload: finishPayload,
            }));
        };

        ws.onopen = () => {
            const payload = new TextEncoder().encode('{}');
            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.START_CONNECTION,
                payload,
            }));
        };

        ws.onmessage = async (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const parsed = parseMessage(event.data);
            if (!parsed) return;

            if (parsed.compression !== 0x0) {
                setError('当前实现暂不支持双向流式压缩返回');
                stop();
                return;
            }

            if (parsed.messageType === MESSAGE_TYPE.AUDIO_ONLY_RESPONSE) {
                if (sessionStarted && parsed.payload.length > 0) {
                    audioChunks.push(parsed.payload);
                    chunkCount += 1;
                    setTtsState((prev) => ({ ...prev, chunkCount }));
                }
                return;
            }

            if (parsed.messageType === MESSAGE_TYPE.FULL_SERVER_RESPONSE) {
                const rawText = decodePayloadText(parsed.payload);
                const payload = rawText ? JSON.parse(rawText || '{}') : {};

                if (parsed.event === EVENT.CONNECTION_STARTED) {
                    sendStartSession();
                    return;
                }

                if (parsed.event === EVENT.CONNECTION_FAILED) {
                    setError(payload?.message ?? 'TTS 双向 WebSocket 建连失败');
                    stop();
                    return;
                }

                if (parsed.event === EVENT.SESSION_STARTED) {
                    sessionStarted = true;
                    sendTaskRequestAndFinish();
                    return;
                }

                if (parsed.event === EVENT.SESSION_FINISHED) {
                    const statusCode = typeof payload?.status_code === 'number' ? payload.status_code : undefined;
                    if (statusCode !== undefined && statusCode !== 20000000) {
                        setError(payload?.message ?? `TTS 双向 WebSocket 会话结束异常(code=${statusCode})`);
                        stop();
                        return;
                    }

                    const mergedAudio = concatUint8Arrays(audioChunks);
                    if (mergedAudio.length === 0) {
                        setError('TTS 双向 WebSocket 未返回音频数据');
                        stop();
                        return;
                    }

                    const blobUrl = URL.createObjectURL(new Blob([mergedAudio], { type: 'audio/mpeg' }));
                    const audio = new Audio(blobUrl);
                    audioRef.current = audio;
                    audio.onended = () => setIsPlaying(false);
                    audio.onerror = () => {
                        const mediaError = audio.error;
                        setError(`浏览器播放音频失败(code=${mediaError?.code ?? 'unknown'})，请尝试下载后确认返回格式`);
                        setIsPlaying(false);
                    };

                    setTtsState((prev) => ({
                        ...prev,
                        audioUrl: blobUrl,
                        audioByteLength: mergedAudio.length,
                    }));

                    try {
                        await audio.play();
                    } finally {
                        if (ws.readyState === WebSocket.OPEN) {
                            const finishConnectionPayload = new TextEncoder().encode('{}');
                            ws.send(buildFrame({
                                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                                serialization: 0x1,
                                compression: 0x0,
                                event: EVENT.FINISH_CONNECTION,
                                payload: finishConnectionPayload,
                            }));
                            ws.close();
                        }
                    }
                    return;
                }

                if (parsed.event === EVENT.SESSION_FAILED) {
                    setError(payload?.message ?? 'TTS 双向 WebSocket 会话失败');
                    stop();
                    return;
                }

                if (!sessionStarted && payload?.message) {
                    console.info('[TTS WS Bidirectional Response]', payload);
                }
                return;
            }

            if (parsed.messageType === MESSAGE_TYPE.ERROR) {
                setError(getErrorMessage(parsed));
                stop();
            }
        };

        ws.onerror = () => {
            setError('TTS 双向 WebSocket 连接失败，请确认配置和权限有效');
            setIsPlaying(false);
        };

        ws.onclose = () => {
            wsRef.current = null;
            if (!audioRef.current) {
                setIsPlaying(false);
            }
        };
    }, [stop, ttsState.audioUrl]);

    return {
        speak,
        stop,
        isPlaying,
        error,
        audioUrl: ttsState.audioUrl,
        fileName: ttsState.fileName,
        chunkCount: ttsState.chunkCount,
        audioByteLength: ttsState.audioByteLength,
    };
}
