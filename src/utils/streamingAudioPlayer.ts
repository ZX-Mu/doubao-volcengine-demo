export class StreamingAudioPlayer {
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private objectUrl: string | null = null;
    private queue: Uint8Array[] = [];
    private sourceOpenPromise: Promise<void> | null = null;
    private sourceOpenResolve: (() => void) | null = null;
    private isEnded = false;
    private isStopped = false;
    private playStarted = false;

    readonly audio = new Audio();

    constructor() {
        this.audio.preload = 'auto';
    }

    static isSupported() {
        return (
            typeof window !== 'undefined'
            && 'MediaSource' in window
            && MediaSource.isTypeSupported('audio/mpeg')
        );
    }

    async init() {
        if (!StreamingAudioPlayer.isSupported()) {
            return false;
        }

        this.mediaSource = new MediaSource();
        this.objectUrl = URL.createObjectURL(this.mediaSource);
        this.audio.src = this.objectUrl;

        this.sourceOpenPromise = new Promise<void>((resolve) => {
            this.sourceOpenResolve = resolve;
        });

        this.mediaSource.addEventListener('sourceopen', () => {
            if (!this.mediaSource || this.sourceBuffer) {
                this.sourceOpenResolve?.();
                this.sourceOpenResolve = null;
                return;
            }

            this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
            this.sourceBuffer.mode = 'sequence';
            this.sourceBuffer.addEventListener('updateend', () => {
                this.flushQueue();
            });

            this.sourceOpenResolve?.();
            this.sourceOpenResolve = null;
            this.flushQueue();
        }, { once: true });

        await this.sourceOpenPromise;
        return true;
    }

    async appendChunk(chunk: Uint8Array) {
        if (this.isStopped || chunk.length === 0) {
            return;
        }

        this.queue.push(chunk);
        this.flushQueue();

        if (!this.playStarted) {
            this.playStarted = true;
            try {
                await this.audio.play();
            } catch {
                this.playStarted = false;
            }
        }
    }

    finish() {
        this.isEnded = true;
        this.flushQueue();
    }

    stop() {
        this.isStopped = true;
        this.queue = [];

        try {
            this.audio.pause();
            this.audio.currentTime = 0;
        } catch {
            // Ignore cleanup failures.
        }

        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch {
                // Ignore cleanup failures.
            }
        }

        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }

        this.sourceBuffer = null;
        this.mediaSource = null;
    }

    private flushQueue() {
        if (!this.mediaSource || !this.sourceBuffer || this.isStopped) {
            return;
        }

        if (this.sourceBuffer.updating) {
            return;
        }

        const nextChunk = this.queue.shift();
        if (nextChunk) {
            this.sourceBuffer.appendBuffer(nextChunk);
            return;
        }

        if (this.isEnded && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch {
                // Ignore cleanup failures.
            }
        }
    }
}
