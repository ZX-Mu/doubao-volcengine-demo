import { useState, useCallback, useRef } from 'react';
import { constructHeader, generateReqId } from '../utils/volcengine';
import { appendTTSSentenceTimestamp, parseTTSSentenceTimestamp, type TTSSentenceTimestamp } from '../utils/ttsSubtitle';
import { StreamingAudioPlayer } from '../utils/streamingAudioPlayer';
import { createInitialTTSMetrics, type TTSMetrics } from '../utils/ttsMetrics';

const TTS_WS_PROXY_URL = '/api/proxy/tts/ws-unidirectional';

interface TTSWsOptions {
    appId: string;
    token: string;
    resourceId: string;
    voiceType: string;
    speechRate?: number;
    pitchRate?: number;
    loudnessRate?: number;
}

interface TTSWsState {
    chunkCount: number;
    audioUrl: string | null;
    fileName: string;
    audioByteLength: number;
    sentences: TTSSentenceTimestamp[];
    metrics: TTSMetrics;
    currentTimeSec: number;
}

interface ParsedWsMessage {
    messageType: number;
    messageFlags: number;
    serialization: number;
    compression: number;
    payload: Uint8Array;
    sequence?: number;
    event?: number;
    identifier?: string;
    errorCode?: number;
}

function buildFrame(messageType: number, serialization: number, compression: number, payload: Uint8Array) {
    const header = constructHeader(messageType, 0x0, serialization, compression);
    const frame = new Uint8Array(header.length + 4 + payload.byteLength);
    frame.set(header, 0);
    new DataView(frame.buffer).setUint32(header.length, payload.byteLength, false);
    frame.set(payload, header.length + 4);
    return frame.buffer;
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

function tryReadIdentifierAndPayload(view: DataView, buffer: ArrayBuffer, offset: number) {
    if (buffer.byteLength < offset + 4) {
        return { identifier: undefined, payload: new Uint8Array() };
    }

    const identifierLength = view.getUint32(offset, false);
    const identifierStart = offset + 4;
    const payloadLengthOffset = identifierStart + identifierLength;
    if (buffer.byteLength < payloadLengthOffset + 4) {
        return { identifier: undefined, payload: new Uint8Array() };
    }

    const payloadLength = view.getUint32(payloadLengthOffset, false);
    const payloadStart = payloadLengthOffset + 4;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > buffer.byteLength) {
        return { identifier: undefined, payload: new Uint8Array() };
    }

    const identifier = new TextDecoder().decode(buffer.slice(identifierStart, payloadLengthOffset));
    return {
        identifier,
        payload: new Uint8Array(buffer.slice(payloadStart, payloadEnd)),
    };
}

function parseMessage(buffer: ArrayBuffer): ParsedWsMessage | null {
    if (buffer.byteLength < 4) return null;
    const view = new DataView(buffer);
    const headerSize = (view.getUint8(0) & 0x0f) * 4;
    const messageType = view.getUint8(1) >> 4;
    const messageFlags = view.getUint8(1) & 0x0f;
    const serialization = view.getUint8(2) >> 4;
    const compression = view.getUint8(2) & 0x0f;
    let offset = headerSize;

    const hasEvent = (messageFlags & 0x4) === 0x4;
    let event: number | undefined;
    if (hasEvent) {
        if (buffer.byteLength < offset + 4) return null;
        event = view.getInt32(offset, false);
        offset += 4;
    }

    if (messageType === 0xb) {
        if (hasEvent) {
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

        let sequence: number | undefined;
        if ((messageFlags & 0x1) === 0x1) {
            if (buffer.byteLength < offset + 8) return null;
            sequence = view.getInt32(offset, false);
            offset += 4;
        } else if (buffer.byteLength < offset + 4) {
            return null;
        }

        const payloadSize = view.getUint32(offset, false);
        offset += 4;
        return {
            messageType,
            messageFlags,
            serialization,
            compression,
            sequence,
            payload: new Uint8Array(buffer.slice(offset, offset + payloadSize)),
        };
    }

    if (messageType === 0xf) {
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

    if (hasEvent) {
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

    if (buffer.byteLength < offset + 4) return null;
    let sequence: number | undefined;
    if ((messageFlags & 0x1) === 0x1) {
        if (buffer.byteLength < offset + 8) return null;
        sequence = view.getInt32(offset, false);
        offset += 4;
    }

    const payloadSize = view.getUint32(offset, false);
    offset += 4;
    return {
        messageType,
        messageFlags,
        serialization,
        compression,
        sequence,
        payload: new Uint8Array(buffer.slice(offset, offset + payloadSize)),
    };
}

function decodePayloadText(payload: Uint8Array) {
    if (payload.length === 0) return '';
    return new TextDecoder().decode(payload);
}

function getErrorMessage(parsed: ParsedWsMessage) {
    const rawText = decodePayloadText(parsed.payload);
    if (!rawText) {
        return parsed.errorCode ? `TTS WebSocket 返回错误(code=${parsed.errorCode})` : 'TTS WebSocket 返回错误';
    }

    try {
        const json = JSON.parse(rawText);
        return json?.message ?? json?.msg ?? json?.error ?? rawText;
    } catch {
        return parsed.errorCode ? `${rawText} (code=${parsed.errorCode})` : rawText;
    }
}

export function useTTSWsUnidirectional() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ttsState, setTtsState] = useState<TTSWsState>({
        chunkCount: 0,
        audioUrl: null,
        fileName: 'doubao-tts-ws.mp3',
        audioByteLength: 0,
        sentences: [],
        metrics: createInitialTTSMetrics(),
        currentTimeSec: 0,
    });

    const wsRef = useRef<WebSocket | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamingPlayerRef = useRef<StreamingAudioPlayer | null>(null);

    const stop = useCallback(() => {
        const ws = wsRef.current;
        wsRef.current = null;
        streamingPlayerRef.current?.stop();
        streamingPlayerRef.current = null;
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }
        setIsPlaying(false);
    }, []);

    const speak = useCallback(async (text: string, options: TTSWsOptions) => {
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
            fileName: `doubao-tts-ws-${Date.now()}.mp3`,
            audioByteLength: 0,
            sentences: [],
            metrics: createInitialTTSMetrics(),
            currentTimeSec: 0,
        });
        setIsPlaying(true);

        const requestStartedAt = performance.now();
        const wsUrl = `${TTS_WS_PROXY_URL}?appId=${encodeURIComponent(options.appId)}&token=${encodeURIComponent(options.token)}&resourceId=${encodeURIComponent(options.resourceId)}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.binaryType = 'arraybuffer';
        let firstChunkRecorded = false;
        let firstPlaybackRecorded = false;
        const streamingPlayer = new StreamingAudioPlayer();
        const streamingReady = await streamingPlayer.init();
        if (streamingReady) {
            streamingPlayerRef.current = streamingPlayer;
            audioRef.current = streamingPlayer.audio;
            streamingPlayer.audio.onplaying = () => {
                if (firstPlaybackRecorded) return;
                firstPlaybackRecorded = true;
                setTtsState((prev) => ({
                    ...prev,
                    metrics: {
                        ...prev.metrics,
                        firstPlaybackMs: performance.now() - requestStartedAt,
                    },
                }));
            };
            streamingPlayer.audio.onended = () => setIsPlaying(false);
            streamingPlayer.audio.ontimeupdate = () => {
                setTtsState((prev) => ({
                    ...prev,
                    currentTimeSec: streamingPlayer.audio.currentTime,
                }));
            };
            streamingPlayer.audio.onerror = () => {
                const mediaError = streamingPlayer.audio.error;
                setError(`浏览器播放音频失败(code=${mediaError?.code ?? 'unknown'})，请尝试下载后确认返回格式`);
                setIsPlaying(false);
            };
        }

        const audioChunks: Uint8Array[] = [];
        let chunkCount = 0;
        let finalized = false;

        const finalizeAudio = async () => {
            if (finalized) return;
            finalized = true;

            const mergedAudio = concatUint8Arrays(audioChunks);
            if (mergedAudio.length === 0) {
                setError('TTS WebSocket 未返回音频数据');
                stop();
                return;
            }

            if (streamingReady) {
                streamingPlayer.finish();
            }

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
                    setTtsState((prev) => ({
                        ...prev,
                        metrics: {
                            ...prev.metrics,
                            firstPlaybackMs: performance.now() - requestStartedAt,
                        },
                    }));
                };
                audio.onended = () => setIsPlaying(false);
                audio.ontimeupdate = () => {
                    setTtsState((prev) => ({
                        ...prev,
                        currentTimeSec: audio.currentTime,
                    }));
                };
                audio.onerror = () => {
                    const mediaError = audio.error;
                    setError(`浏览器播放音频失败(code=${mediaError?.code ?? 'unknown'})，请尝试下载后确认返回格式`);
                    setIsPlaying(false);
                };

                try {
                    await audio.play();
                } catch (error: any) {
                    setError(error?.message || '浏览器自动播放失败，请手动下载确认返回格式');
                    setIsPlaying(false);
                }
            }
        };

        ws.onopen = () => {
            const reqId = generateReqId();
            const request = {
                user: {
                    uid: `web_${generateReqId().slice(0, 8)}`,
                },
                unique_id: reqId,
                namespace: 'SpeechSynthesizer',
                req_params: {
                    reqid: reqId,
                    text,
                    speaker: options.voiceType,
                    audio_params: {
                        format: 'mp3',
                        sample_rate: 24000,
                        speech_rate: options.speechRate ?? 0,
                        loudness_rate: options.loudnessRate ?? 0,
                        pitch_rate: options.pitchRate ?? 0,
                        enable_subtitle: true,
                    },
                },
            };

            const payload = new TextEncoder().encode(JSON.stringify(request));
            ws.send(buildFrame(0x1, 0x1, 0x0, payload));
        };

        ws.onmessage = async (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const parsed = parseMessage(event.data);
            if (!parsed) return;

            if (parsed.messageType === 0xb) {
                const payload = parsed.payload;
                const isFinalPacket =
                    parsed.messageFlags === 0x2 ||
                    parsed.messageFlags === 0x3 ||
                    (parsed.sequence ?? 0) < 0;

                if (payload.length > 0) {
                    audioChunks.push(payload);
                    if (!firstChunkRecorded) {
                        firstChunkRecorded = true;
                        setTtsState((prev) => ({
                            ...prev,
                            metrics: {
                                ...prev.metrics,
                                firstChunkMs: performance.now() - requestStartedAt,
                            },
                        }));
                    }
                    if (streamingReady) {
                        await streamingPlayer.appendChunk(payload);
                    }
                    chunkCount += 1;
                    setTtsState((prev) => ({ ...prev, chunkCount }));
                }

                if (isFinalPacket) {
                    await finalizeAudio();
                }
                return;
            }

            if (parsed.messageType === 0x9) {
                const rawText = decodePayloadText(parsed.payload);
                if (!rawText) return;

                try {
                    const payload = JSON.parse(rawText);
                    const sentence = parseTTSSentenceTimestamp(payload);
                    if (sentence) {
                        setTtsState((prev) => ({
                            ...prev,
                            sentences: appendTTSSentenceTimestamp(prev.sentences, sentence),
                        }));
                    }
                    const code = typeof payload?.code === 'number' ? payload.code : undefined;
                    if (code !== undefined && code !== 0 && code !== 20000000) {
                        setError(payload?.message ?? payload?.msg ?? `TTS WebSocket 返回错误(code=${code})`);
                        stop();
                        return;
                    }

                    if (parsed.event === 152 || rawText === '{}') {
                        if (audioChunks.length > 0) {
                            await finalizeAudio();
                        }
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                    }
                } catch {
                    console.info('[TTS WS Response]', rawText);
                }
                return;
            }

            if (parsed.messageType === 0xc) {
                const rawText = decodePayloadText(parsed.payload);
                if (rawText) {
                    console.info('[TTS WS Frontend Response]', rawText);
                }
                if (audioChunks.length > 0) {
                    await finalizeAudio();
                }
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                return;
            }

            if (parsed.messageType === 0xf) {
                setError(getErrorMessage(parsed));
                stop();
            }
        };

        ws.onerror = () => {
            setError('TTS WebSocket 连接失败，请确认配置和权限有效');
            setIsPlaying(false);
        };

        ws.onclose = () => {
            wsRef.current = null;
            if (!finalized && audioChunks.length > 0) {
                void finalizeAudio();
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
    };
}
