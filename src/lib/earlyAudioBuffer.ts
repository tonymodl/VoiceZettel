/**
 * @module earlyAudioBuffer
 * Antigravity Phase 3: Early Audio Ring Buffer
 * 
 * Captures PCM audio data while WebSocket/WebRTC is still connecting.
 * On connection ready, flushes buffered audio as the first payload.
 * 
 * SAFETY: If connection never establishes, buffer is silently discarded.
 * No impact on existing audio pipeline — purely additive.
 */

export class EarlyAudioBuffer {
    private chunks: ArrayBuffer[] = [];
    private maxChunks: number;
    private flushed = false;

    /**
     * @param maxChunks Maximum number of audio chunks to retain (ring buffer).
     *                  Default ~500 = approximately 10 seconds at 16kHz.
     */
    constructor(maxChunks = 500) {
        this.maxChunks = maxChunks;
    }

    /**
     * Store an audio chunk while waiting for connection.
     * Silently no-ops after flush() has been called.
     */
    push(chunk: ArrayBuffer): void {
        if (this.flushed) return;
        if (this.chunks.length >= this.maxChunks) {
            this.chunks.shift(); // Ring: discard oldest
        }
        this.chunks.push(chunk);
    }

    /**
     * Flush all buffered audio through the provided send function.
     * Called once when the WebSocket reaches OPEN state.
     */
    flush(sendFn: (data: ArrayBuffer) => void): void {
        this.flushed = true;
        for (const chunk of this.chunks) {
            sendFn(chunk);
        }
        this.chunks = [];
    }

    /**
     * Discard all buffered audio without sending.
     * Called on stop() or connection failure.
     */
    discard(): void {
        this.flushed = true;
        this.chunks = [];
    }

    /** Number of currently buffered chunks */
    get size(): number {
        return this.chunks.length;
    }

    /** Whether flush has been called */
    get isFlushed(): boolean {
        return this.flushed;
    }
}
