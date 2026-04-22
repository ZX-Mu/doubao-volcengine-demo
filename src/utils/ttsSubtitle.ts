export interface TTSWordTimestamp {
    word: string;
    startTime: number;
    endTime: number;
    confidence?: number;
}

export interface TTSSentenceTimestamp {
    text: string;
    words: TTSWordTimestamp[];
}

function toFiniteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseTTSSentenceTimestamp(payload: any): TTSSentenceTimestamp | null {
    const sentence = payload?.sentence ?? payload;
    const text = typeof sentence?.text === 'string' ? sentence.text : null;
    const rawWords = Array.isArray(sentence?.words) ? sentence.words : null;

    if (!text || !rawWords) {
        return null;
    }

    const words = rawWords
        .map((item: any) => {
            const word = typeof item?.word === 'string' ? item.word : null;
            const startTime = toFiniteNumber(item?.startTime);
            const endTime = toFiniteNumber(item?.endTime);
            const confidence = toFiniteNumber(item?.confidence) ?? undefined;

            if (!word || startTime === null || endTime === null) {
                return null;
            }

            return {
                word,
                startTime,
                endTime,
                confidence,
            };
        })
        .filter((item): item is TTSWordTimestamp => item !== null);

    if (words.length === 0) {
        return null;
    }

    return {
        text,
        words,
    };
}

export function appendTTSSentenceTimestamp(
    sentences: TTSSentenceTimestamp[],
    nextSentence: TTSSentenceTimestamp,
    maxItems = 20,
) {
    const lastSentence = sentences[sentences.length - 1];
    if (lastSentence?.text === nextSentence.text) {
        return sentences;
    }

    const next = [...sentences, nextSentence];
    return next.slice(-maxItems);
}
