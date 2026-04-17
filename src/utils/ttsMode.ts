export const TTS_MODE_IDS = {
    SSE_V3: 'http_sse_v3',
    WS_UNIDIRECTIONAL_V3: 'ws_unidirectional_v3',
    WS_BIDIRECTIONAL_V3: 'ws_bidirectional_v3',
} as const;

export type TTSModeId = typeof TTS_MODE_IDS[keyof typeof TTS_MODE_IDS];
