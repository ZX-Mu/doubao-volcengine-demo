import { useState, useCallback, useRef } from 'react';
import { generateReqId } from '../utils/volcengine';

interface TTSOptions {
    appId: string;
    token: string;
    resourceId: string;
    voiceType: string;
    speechRate?: number;
    pitchRate?: number;
    loudnessRate?: number;
}

interface TTSState {
    chunkCount: number;
    audioUrl: string | null;
    fileName: string;
    audioByteLength: number;
}

function isErrorPayload(payload: any) {
    const errorCode = typeof payload?.error_code === 'number' ? payload.error_code : undefined;
    const errorText = typeof payload?.error === 'string' ? payload.error.trim() : '';

    if (errorCode !== undefined) {
        return errorCode !== 0;
    }

    if (!errorText) {
        return false;
    }

    return errorText.toUpperCase() !== 'OK';
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

function decodeBase64Chunk(value: string) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function getAudioChunk(payload: any) {
    const candidate = payload?.data ?? payload?.audio_base64 ?? payload?.audio;
    return typeof candidate === 'string' ? candidate : null;
}

export function useTTS() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ttsState, setTtsState] = useState<TTSState>({
        chunkCount: 0,
        audioUrl: null,
        fileName: 'doubao-tts.mp3',
        audioByteLength: 0,
    });

    const abortControllerRef = useRef<AbortController | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const stop = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }
        setIsPlaying(false);
    }, []);

    const speak = useCallback(async (text: string, options: TTSOptions) => {
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
            fileName: `doubao-tts-${Date.now()}.mp3`,
            audioByteLength: 0,
        });
        setIsPlaying(true);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const response = await fetch('/api/proxy/tts/sse', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    appId: options.appId,
                    token: options.token,
                    resourceId: options.resourceId,
                    text,
                    speaker: options.voiceType,
                    speechRate: options.speechRate ?? 0,
                    pitchRate: options.pitchRate ?? 0,
                    loudnessRate: options.loudnessRate ?? 0,
                    reqId: generateReqId(),
                }),
                signal: controller.signal,
            });

            if (!response.ok || !response.body) {
                const message = await response.text();
                throw new Error(message || 'TTS SSE 请求失败');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const audioChunks: Uint8Array[] = [];
            let chunkCount = 0;

            const handleEventBlock = (block: string) => {
                const lines = block.split('\n');
                const dataLines = lines
                    .filter((line) => line.startsWith('data:'))
                    .map((line) => line.slice(5).trim())
                    .filter(Boolean);

                if (dataLines.length === 0) return;

                const raw = dataLines.join('\n');
                if (raw === '[DONE]') return;

                let payload: any;
                try {
                    payload = JSON.parse(raw);
                } catch {
                    return;
                }

                if (isErrorPayload(payload)) {
                    throw new Error(
                        payload?.message ??
                        payload?.msg ??
                        payload?.error ??
                        payload?.error_message ??
                        'TTS 返回错误',
                    );
                }

                const audioBase64 = getAudioChunk(payload);
                if (!audioBase64) {
                    console.info('[TTS Event]', payload);
                    return;
                }

                audioChunks.push(decodeBase64Chunk(audioBase64));
                chunkCount += 1;
                setTtsState((prev) => ({
                    ...prev,
                    chunkCount,
                }));
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop() ?? '';

                for (const block of blocks) {
                    handleEventBlock(block);
                }
            }

            if (buffer.trim()) {
                handleEventBlock(buffer);
            }

            const mergedAudio = concatUint8Arrays(audioChunks);
            if (mergedAudio.length === 0) {
                throw new Error('TTS 未返回音频数据');
            }

            const mp3Signature = new TextDecoder().decode(mergedAudio.slice(0, 3));
            console.info('[TTS Audio]', {
                chunkCount,
                byteLength: mergedAudio.length,
                signature: mp3Signature,
            });
            console.info('[TTS Stream]', 'completed');

            const blobUrl = URL.createObjectURL(new Blob([mergedAudio], { type: 'audio/mpeg' }));
            const audio = new Audio(blobUrl);
            audioRef.current = audio;
            audio.onended = () => {
                setIsPlaying(false);
            };
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

            await audio.play();
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                setError(err?.message || 'TTS 初始化失败');
            }
            setIsPlaying(false);
        } finally {
            abortControllerRef.current = null;
        }
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
