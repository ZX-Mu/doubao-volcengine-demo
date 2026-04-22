export interface TTSMetrics {
    firstChunkMs: number | null;
    firstPlaybackMs: number | null;
}

export function createInitialTTSMetrics(): TTSMetrics {
    return {
        firstChunkMs: null,
        firstPlaybackMs: null,
    };
}
