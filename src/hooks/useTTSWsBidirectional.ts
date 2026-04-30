import { useState, useCallback, useRef } from 'react';
import { constructHeader, generateReqId } from '../utils/volcengine';
import { appendTTSSentenceTimestamp, parseTTSSentenceTimestamp, type TTSSentenceTimestamp } from '../utils/ttsSubtitle';
import { StreamingAudioPlayer } from '../utils/streamingAudioPlayer';
import { createInitialTTSMetrics, type TTSMetrics } from '../utils/ttsMetrics';
import { redactSpeechUrl } from '../utils/auth';

const TTS_WS_BIDIRECTIONAL_PROXY_URL = '/api/proxy/tts/ws-bidirectional';
const TTS_WS_BIDIRECTIONAL_DIRECT_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';

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
    simulateStreamingInput?: boolean;
    streamChunkSize?: number;
    streamDelayMs?: number;
    direct?: boolean;
}

interface TTSWsBidirectionalState {
    chunkCount: number;
    audioUrl: string | null;
    fileName: string;
    audioByteLength: number;
    sentences: TTSSentenceTimestamp[];
    metrics: TTSMetrics;
    currentTimeSec: number;
    inputChunks: string[];
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

function splitTextForStreaming(text: string, chunkSize: number) {
    const safeChunkSize = Math.max(1, chunkSize);
    const segments = text.match(/[^，。！？；：,.!?;:\n]+[，。！？；：,.!?;:\n]?/g) ?? [text];
    const chunks: string[] = [];

    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        if (trimmed.length <= safeChunkSize) {
            chunks.push(trimmed);
            continue;
        }

        for (let index = 0; index < trimmed.length; index += safeChunkSize) {
            const part = trimmed.slice(index, index + safeChunkSize).trim();
            if (part) {
                chunks.push(part);
            }
        }
    }

    return chunks.length > 0 ? chunks : [text];
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

function summarizeText(text: string, maxLength = 500) {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...(${text.length} chars)` : text;
}

export function useTTSWsBidirectional() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ttsState, setTtsState] = useState<TTSWsBidirectionalState>({
        chunkCount: 0,
        audioUrl: null,
        fileName: 'doubao-tts-ws-bidirectional.mp3',
        audioByteLength: 0,
        sentences: [],
        metrics: createInitialTTSMetrics(),
        currentTimeSec: 0,
        inputChunks: [],
    });

    const wsRef = useRef<WebSocket | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamingPlayerRef = useRef<StreamingAudioPlayer | null>(null);
    const streamTimerRef = useRef<number | null>(null);
    const stoppedByUserRef = useRef(false);

    const stop = useCallback(() => {
        stoppedByUserRef.current = true;
        const ws = wsRef.current;
        wsRef.current = null;
        if (streamTimerRef.current !== null) {
            window.clearTimeout(streamTimerRef.current);
            streamTimerRef.current = null;
        }
        streamingPlayerRef.current?.stop();
        streamingPlayerRef.current = null;
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
        stoppedByUserRef.current = false;
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
            sentences: [],
            metrics: createInitialTTSMetrics(),
            currentTimeSec: 0,
            inputChunks: [],
        });
        setIsPlaying(true);

        const requestStartedAt = performance.now();
        const logTiming = (stage: string, details: Record<string, unknown> = {}) => {
            console.info('[TTS WS Bidirectional Timing]', {
                mode: options.direct ? 'bidirectional-direct' : 'bidirectional-proxy',
                stage,
                elapsedMs: Math.round((performance.now() - requestStartedAt) * 100) / 100,
                at: new Date().toISOString(),
                ...details,
            });
        };
        logTiming('speak:start', {
            textLength: text.length,
            text: summarizeText(text),
            voiceType: options.voiceType,
            speechRate: options.speechRate ?? 0,
            pitchRate: options.pitchRate ?? 0,
            loudnessRate: options.loudnessRate ?? 0,
            resourceId: options.resourceId,
            simulateStreamingInput: Boolean(options.simulateStreamingInput),
            streamChunkSize: options.streamChunkSize ?? 12,
            streamDelayMs: options.streamDelayMs ?? 120,
        });
        const connectId = generateReqId();
        const sessionId = generateReqId();
        // 直连模式：浏览器直接连火山引擎 WSS，认证信息放 query params
        // 代理模式：通过 vite dev proxy 中转，由服务端添加认证 Header
        const wsUrl = options.direct
            ? `${TTS_WS_BIDIRECTIONAL_DIRECT_URL}?api_appid=${encodeURIComponent(options.appId)}&api_access_key=${encodeURIComponent(options.token)}&api_resource_id=${encodeURIComponent(options.resourceId)}&api_connect_id=${encodeURIComponent(connectId)}`
            : `${TTS_WS_BIDIRECTIONAL_PROXY_URL}?appId=${encodeURIComponent(options.appId)}&token=${encodeURIComponent(options.token)}&resourceId=${encodeURIComponent(options.resourceId)}&connectId=${encodeURIComponent(connectId)}`;
        const ws = new WebSocket(wsUrl);
        logTiming('ws:create', {
            url: redactSpeechUrl(wsUrl),
            connectId,
            sessionId,
        });
        wsRef.current = ws;
        ws.binaryType = 'arraybuffer';
        let firstChunkRecorded = false;
        let firstPlaybackRecorded = false;
        const streamingPlayer = new StreamingAudioPlayer();
        const streamingReady = await streamingPlayer.init();
        logTiming('streaming-player:init', { streamingReady });
        if (streamingReady) {
            streamingPlayerRef.current = streamingPlayer;
            audioRef.current = streamingPlayer.audio;
            streamingPlayer.audio.onplaying = () => {
                if (firstPlaybackRecorded) return;
                firstPlaybackRecorded = true;
                logTiming('audio:playing:first', {
                    audioCurrentTimeSec: streamingPlayer.audio.currentTime,
                });
                setTtsState((prev) => ({
                    ...prev,
                    metrics: {
                        ...prev.metrics,
                        firstPlaybackMs: performance.now() - requestStartedAt,
                    },
                }));
            };
            streamingPlayer.audio.oncanplay = () => {
                logTiming('audio:canplay', {
                    audioCurrentTimeSec: streamingPlayer.audio.currentTime,
                    readyState: streamingPlayer.audio.readyState,
                });
            };
            streamingPlayer.audio.onwaiting = () => {
                logTiming('audio:waiting', {
                    audioCurrentTimeSec: streamingPlayer.audio.currentTime,
                    readyState: streamingPlayer.audio.readyState,
                });
            };
            streamingPlayer.audio.onended = () => {
                logTiming('audio:ended', {
                    audioCurrentTimeSec: streamingPlayer.audio.currentTime,
                });
                setIsPlaying(false);
            };
            streamingPlayer.audio.ontimeupdate = () => {
                setTtsState((prev) => ({
                    ...prev,
                    currentTimeSec: streamingPlayer.audio.currentTime,
                }));
            };
            streamingPlayer.audio.onerror = () => {
                const mediaError = streamingPlayer.audio.error;
                logTiming('audio:error', { code: mediaError?.code ?? 'unknown' });
                setError(`浏览器播放音频失败(code=${mediaError?.code ?? 'unknown'})，请尝试下载后确认返回格式`);
                setIsPlaying(false);
            };
        }

        const audioChunks: Uint8Array[] = [];
        let chunkCount = 0;
        let sessionStarted = false;
        let inputDispatchStarted = false;

        const finalizeAudio = async () => {
            const mergedAudio = concatUint8Arrays(audioChunks);
            if (mergedAudio.length === 0) {
                logTiming('audio:finalize:no-audio');
                setError('TTS 双向 WebSocket 未返回音频数据');
                stop();
                return;
            }

            if (streamingReady) {
                streamingPlayer.finish();
            }
            logTiming('audio:finalize', {
                chunkCount,
                totalAudioBytes: mergedAudio.length,
                streamingReady,
            });

            const blobUrl = URL.createObjectURL(new Blob([mergedAudio], { type: 'audio/mpeg' }));

            setTtsState((prev) => ({
                ...prev,
                audioUrl: blobUrl,
                audioByteLength: mergedAudio.length,
            }));

            if (!streamingReady) {
                const audio = new Audio(blobUrl);
                audioRef.current = audio;
                audio.onplaying = () => {
                    if (firstPlaybackRecorded) return;
                    firstPlaybackRecorded = true;
                    logTiming('audio:playing:first', {
                        audioCurrentTimeSec: audio.currentTime,
                        fallbackBlob: true,
                    });
                    setTtsState((prev) => ({
                        ...prev,
                        metrics: {
                            ...prev.metrics,
                            firstPlaybackMs: performance.now() - requestStartedAt,
                        },
                    }));
                };
                audio.oncanplay = () => {
                    logTiming('audio:canplay', {
                        audioCurrentTimeSec: audio.currentTime,
                        readyState: audio.readyState,
                        fallbackBlob: true,
                    });
                };
                audio.onended = () => {
                    logTiming('audio:ended', {
                        audioCurrentTimeSec: audio.currentTime,
                        fallbackBlob: true,
                    });
                    setIsPlaying(false);
                };
                audio.ontimeupdate = () => {
                    setTtsState((prev) => ({
                        ...prev,
                        currentTimeSec: audio.currentTime,
                    }));
                };
                audio.onerror = () => {
                    const mediaError = audio.error;
                    logTiming('audio:error', { code: mediaError?.code ?? 'unknown', fallbackBlob: true });
                    setError(`浏览器播放音频失败(code=${mediaError?.code ?? 'unknown'})，请尝试下载后确认返回格式`);
                    setIsPlaying(false);
                };
                logTiming('audio:play:attempt', { fallbackBlob: true });
                await audio.play();
            }
        };

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
                        enable_subtitle: true,
                    },
                },
            };

            const payload = new TextEncoder().encode(JSON.stringify(request));
            logTiming('input:send:start-session', {
                event: EVENT.START_SESSION,
                sessionId,
                payloadBytes: payload.byteLength,
                request,
            });
            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.START_SESSION,
                identifier: sessionId,
                payload,
            }));
        };

        const sendTaskRequest = (taskText: string) => {
            const taskRequest = {
                event: EVENT.TASK_REQUEST,
                namespace: 'BidirectionalTTS',
                req_params: {
                    text: taskText,
                },
            };
            const taskPayload = new TextEncoder().encode(JSON.stringify(taskRequest));
            logTiming('input:send:task-request', {
                event: EVENT.TASK_REQUEST,
                sessionId,
                textLength: taskText.length,
                text: summarizeText(taskText),
                payloadBytes: taskPayload.byteLength,
                request: taskRequest,
            });
            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.TASK_REQUEST,
                identifier: sessionId,
                payload: taskPayload,
            }));

            setTtsState((prev) => ({
                ...prev,
                inputChunks: [...prev.inputChunks, taskText],
            }));
        };

        const finishSession = () => {
            const finishPayload = new TextEncoder().encode('{}');
            logTiming('input:send:finish-session', {
                event: EVENT.FINISH_SESSION,
                sessionId,
                payloadBytes: finishPayload.byteLength,
            });
            ws.send(buildFrame({
                messageType: MESSAGE_TYPE.FULL_CLIENT_REQUEST,
                serialization: 0x1,
                compression: 0x0,
                event: EVENT.FINISH_SESSION,
                identifier: sessionId,
                payload: finishPayload,
            }));
        };

        const startInputDispatch = () => {
            if (inputDispatchStarted) return;
            inputDispatchStarted = true;

            if (!options.simulateStreamingInput) {
                logTiming('input:dispatch:start', {
                    simulateStreamingInput: false,
                    chunks: 1,
                });
                sendTaskRequest(text);
                finishSession();
                return;
            }

            const chunks = splitTextForStreaming(text, options.streamChunkSize ?? 12);
            const delayMs = Math.max(30, options.streamDelayMs ?? 120);
            logTiming('input:dispatch:start', {
                simulateStreamingInput: true,
                chunks: chunks.length,
                delayMs,
                chunkLengths: chunks.map((chunk) => chunk.length),
            });

            const dispatchChunk = (index: number) => {
                if (ws.readyState !== WebSocket.OPEN) {
                    logTiming('input:dispatch:abort', {
                        index,
                        readyState: ws.readyState,
                    });
                    return;
                }

                if (index >= chunks.length) {
                    streamTimerRef.current = null;
                    logTiming('input:dispatch:done', {
                        chunks: chunks.length,
                    });
                    finishSession();
                    return;
                }

                logTiming('input:dispatch:chunk', {
                    index: index + 1,
                    chunks: chunks.length,
                    textLength: chunks[index].length,
                    text: summarizeText(chunks[index]),
                });
                sendTaskRequest(chunks[index]);
                streamTimerRef.current = window.setTimeout(() => {
                    dispatchChunk(index + 1);
                }, delayMs);
            };

            dispatchChunk(0);
        };

        ws.onopen = () => {
            logTiming('ws:open', { url: redactSpeechUrl(wsUrl) });
            const payload = new TextEncoder().encode('{}');
            logTiming('input:send:start-connection', {
                event: EVENT.START_CONNECTION,
                connectId,
                payloadBytes: payload.byteLength,
            });
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
            logTiming('ws:message', {
                messageType: parsed.messageType,
                messageFlags: parsed.messageFlags,
                serialization: parsed.serialization,
                compression: parsed.compression,
                event: parsed.event,
                identifier: parsed.identifier,
                payloadBytes: parsed.payload.length,
                errorCode: parsed.errorCode,
            });

            if (parsed.compression !== 0x0) {
                logTiming('ws:unsupported-compression', { compression: parsed.compression });
                setError('当前实现暂不支持双向流式压缩返回');
                stop();
                return;
            }

            if (parsed.messageType === MESSAGE_TYPE.AUDIO_ONLY_RESPONSE) {
                if (sessionStarted && parsed.payload.length > 0) {
                    audioChunks.push(parsed.payload);
                    const totalAudioBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                    if (!firstChunkRecorded) {
                        firstChunkRecorded = true;
                        logTiming('audio:chunk:first', {
                            bytes: parsed.payload.length,
                            totalAudioBytes,
                            event: parsed.event,
                            identifier: parsed.identifier,
                        });
                        setTtsState((prev) => ({
                            ...prev,
                            metrics: {
                                ...prev.metrics,
                                firstChunkMs: performance.now() - requestStartedAt,
                            },
                        }));
                    }
                    logTiming('audio:chunk', {
                        chunkIndex: chunkCount + 1,
                        bytes: parsed.payload.length,
                        totalAudioBytes,
                        event: parsed.event,
                        identifier: parsed.identifier,
                    });
                    if (streamingReady) {
                        logTiming('audio:append:start', {
                            chunkIndex: chunkCount + 1,
                            bytes: parsed.payload.length,
                        });
                        await streamingPlayer.appendChunk(parsed.payload);
                        logTiming('audio:append:done', {
                            chunkIndex: chunkCount + 1,
                            bytes: parsed.payload.length,
                        });
                    }
                    chunkCount += 1;
                    setTtsState((prev) => ({ ...prev, chunkCount }));
                }
                return;
            }

            if (parsed.messageType === MESSAGE_TYPE.FULL_SERVER_RESPONSE) {
                const rawText = decodePayloadText(parsed.payload);
                logTiming('output:json', {
                    event: parsed.event,
                    identifier: parsed.identifier,
                    rawText,
                });
                const payload = rawText ? JSON.parse(rawText || '{}') : {};
                const sentence = parseTTSSentenceTimestamp(payload);
                if (sentence) {
                    logTiming('subtitle:arrive', {
                        text: sentence.text,
                        firstWordStartTime: sentence.words[0]?.startTime,
                        lastWordEndTime: sentence.words[sentence.words.length - 1]?.endTime,
                        wordCount: sentence.words.length,
                        event: parsed.event,
                        identifier: parsed.identifier,
                    });
                    setTtsState((prev) => ({
                        ...prev,
                        sentences: appendTTSSentenceTimestamp(prev.sentences, sentence),
                    }));
                }

                if (parsed.event === EVENT.CONNECTION_STARTED) {
                    logTiming('event:connection-started', { event: parsed.event, payload });
                    sendStartSession();
                    return;
                }

                if (parsed.event === EVENT.CONNECTION_FAILED) {
                    logTiming('event:connection-failed', { event: parsed.event, payload });
                    setError(payload?.message ?? 'TTS 双向 WebSocket 建连失败');
                    stop();
                    return;
                }

                if (parsed.event === EVENT.SESSION_STARTED) {
                    logTiming('event:session-started', { event: parsed.event, payload });
                    sessionStarted = true;
                    startInputDispatch();
                    return;
                }

                if (parsed.event === EVENT.SESSION_FINISHED) {
                    logTiming('event:session-finished', {
                        event: parsed.event,
                        payload,
                        chunkCount,
                        totalAudioBytes: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
                    });
                    const statusCode = typeof payload?.status_code === 'number' ? payload.status_code : undefined;
                    if (statusCode !== undefined && statusCode !== 20000000) {
                        setError(payload?.message ?? `TTS 双向 WebSocket 会话结束异常(code=${statusCode})`);
                        stop();
                        return;
                    }

                    try {
                        await finalizeAudio();
                    } finally {
                        if (ws.readyState === WebSocket.OPEN) {
                            if (streamTimerRef.current !== null) {
                                window.clearTimeout(streamTimerRef.current);
                                streamTimerRef.current = null;
                            }
                            const finishConnectionPayload = new TextEncoder().encode('{}');
                            logTiming('input:send:finish-connection', {
                                event: EVENT.FINISH_CONNECTION,
                                connectId,
                                payloadBytes: finishConnectionPayload.byteLength,
                            });
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
                    logTiming('event:session-failed', { event: parsed.event, payload });
                    setError(payload?.message ?? 'TTS 双向 WebSocket 会话失败');
                    stop();
                    return;
                }

                if (!sessionStarted && payload?.message) {
                    logTiming('output:message-before-session', { payload });
                }
                return;
            }

            if (parsed.messageType === MESSAGE_TYPE.ERROR) {
                logTiming('ws:error-frame', {
                    errorCode: parsed.errorCode,
                    message: getErrorMessage(parsed),
                });
                setError(getErrorMessage(parsed));
                stop();
            }
        };

        ws.onerror = (ev) => {
            logTiming('ws:error', { event: ev.type });
            console.error('[TTS WS Bidirectional onerror]', ev);
            setError('TTS 双向 WebSocket 连接失败，请确认配置和权限有效');
            setIsPlaying(false);
        };

        ws.onclose = (ev) => {
            logTiming('ws:close', {
                code: ev.code,
                reason: ev.reason,
                wasClean: ev.wasClean,
                chunkCount,
                totalAudioBytes: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
                hasAudioElement: Boolean(audioRef.current),
            });
            console.warn(`[TTS WS Bidirectional onclose] code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean}`);
            wsRef.current = null;
            if (!audioRef.current) {
                setIsPlaying(false);
            }
            // 用户主动停止或正常关闭不报错
            if (stoppedByUserRef.current || ev.code === 1000 || ev.code === 1005) {
                return;
            }
            // 非正常关闭，给出详细错误信息
            if (!audioRef.current) {
                setError(`TTS 双向 WebSocket 被关闭 (code=${ev.code}, reason="${ev.reason || '无'}")`);
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
        sentences: ttsState.sentences,
        metrics: ttsState.metrics,
        currentTimeSec: ttsState.currentTimeSec,
        inputChunks: ttsState.inputChunks,
    };
}
