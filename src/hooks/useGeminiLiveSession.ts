"use client";

import { useState, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";
import { readPrewarmCache, invalidatePrewarmCache } from "@/hooks/usePrewarmer";

/* ------------------------------------------------------------------ */
/*  Types for Gemini Live WebSocket protocol                          */
/* ------------------------------------------------------------------ */

interface GeminiSetupMessage {
    setup: {
        model: string;
        generation_config: {
            response_modalities: string[];
            speech_config: {
                voice_config: {
                    prebuilt_voice_config: { voice_name: string };
                };
            };
        };
        system_instruction?: { parts: { text: string }[] };
        input_audio_transcription?: Record<string, never>;
        output_audio_transcription?: Record<string, never>;
    };
}

interface GeminiRealtimeInput {
    realtime_input: {
        media_chunks: { mime_type: string; data: string }[];
    };
}

interface GeminiInlineData {
    mimeType: string;
    data: string;
}

interface GeminiPart {
    text?: string;
    inlineData?: GeminiInlineData;
}

interface GeminiServerMessage {
    setupComplete?: unknown;
    serverContent?: {
        modelTurn?: {
            parts?: GeminiPart[];
        };
        turnComplete?: boolean;
        inputTranscription?: { text: string };
        outputTranscription?: { text: string };
    };
}

interface TokenResponse {
    wsUrl: string;
    model?: string;
    vaultContext?: string;
    compiledRules?: string;
    empathyBlock?: string;
    contextSummary?: {
        totalTokens: number;
        maxTokens: number;
        percentUsed: number;
    };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert Float32 [-1,1] → Int16 PCM bytes */
function float32ToInt16(buffer: Float32Array): Int16Array {
    const out = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        const s = Math.max(-1, Math.min(1, buffer[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
}

/** Encode ArrayBuffer → base64 string */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Decode base64 → ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/** Convert Int16 PCM → Float32 for AudioBuffer */
function int16ToFloat32(int16: Int16Array): Float32Array {
    const out = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        out[i] = int16[i] / 0x8000;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useGeminiLiveSession() {
    const [isConnected, setIsConnected] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [isReconnecting, setIsReconnecting] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const micAudioCtxRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const playbackCtxRef = useRef<AudioContext | null>(null);

    // Auto-reconnect state
    const intentionalCloseRef = useRef(false);
    const retryCountRef = useRef(0);
    const lastSystemPromptRef = useRef<string | undefined>(undefined);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Session transcript for post-session analysis
    const sessionTranscriptRef = useRef<string[]>([]);
    const sessionStartRef = useRef<string>("");

    /* ── Play received PCM audio ── */
    // Sequential audio queue: schedules chunks back-to-back for gapless playback
    const nextPlayTimeRef = useRef(0);

    const playPcmAudio = useCallback((base64Data: string) => {
        const rawBuf = base64ToArrayBuffer(base64Data);
        const int16 = new Int16Array(rawBuf);
        const float32 = int16ToFloat32(int16);

        const PLAYBACK_SAMPLE_RATE = 24000;

        if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
            playbackCtxRef.current = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
            nextPlayTimeRef.current = 0;
        }

        const ctx = playbackCtxRef.current;
        const audioBuffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
        audioBuffer.copyToChannel(new Float32Array(float32.buffer as ArrayBuffer), 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Schedule sequentially: each chunk starts right after the previous one ends
        const now = ctx.currentTime;
        const startTime = Math.max(now, nextPlayTimeRef.current);
        source.start(startTime);
        nextPlayTimeRef.current = startTime + audioBuffer.duration;
    }, []);

    /* ── Handle incoming WS messages ── */
    const handleMessage = useCallback(
        (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data as string) as GeminiServerMessage;

                if (msg.setupComplete) {
                    logger.info("[GeminiLive] Setup complete, session ready");
                    retryCountRef.current = 0; // Reset retry count on successful setup
                    setIsReconnecting(false);
                    return;
                }

                // Track input transcription (what user said)
                if (msg.serverContent?.inputTranscription?.text) {
                    const userText = msg.serverContent.inputTranscription.text;
                    sessionTranscriptRef.current.push(`USER: ${userText}`);
                    setTranscript((prev) => prev + `\n[You]: ${userText}`);
                }

                // Track output transcription (what assistant said)
                if (msg.serverContent?.outputTranscription?.text) {
                    const assistantText = msg.serverContent.outputTranscription.text;
                    sessionTranscriptRef.current.push(`ASSISTANT: ${assistantText}`);
                }

                const parts = msg.serverContent?.modelTurn?.parts;
                if (!parts) return;

                for (const part of parts) {
                    if (part.inlineData?.mimeType === "audio/pcm" && part.inlineData.data) {
                        playPcmAudio(part.inlineData.data);
                    }
                    if (part.text) {
                        setTranscript((prev) => prev + part.text);
                    }
                }
            } catch (err) {
                logger.error("[GeminiLive] Failed to parse message:", err);
            }
        },
        [playPcmAudio],
    );

    /* ── Post-session analytics trigger ── */
    const triggerSessionAnalysis = useCallback(async () => {
        const lines = sessionTranscriptRef.current;
        if (lines.length < 2) return; // Nothing meaningful to analyze

        const sessionStart = sessionStartRef.current;

        // Convert raw lines ("USER: text" / "ASSISTANT: text") into structured format
        // expected by /api/session-summary POST handler
        const transcript: Array<{ role: string; text: string }> = [];
        for (const line of lines) {
            if (line.startsWith("USER: ")) {
                transcript.push({ role: "user", text: line.slice(6) });
            } else if (line.startsWith("ASSISTANT: ")) {
                transcript.push({ role: "assistant", text: line.slice(11) });
            }
        }

        if (transcript.length < 2) return;

        try {
            // CRITICAL: POST to /api/session-summary (NOT /api/session-analytics which is GET-only!)
            // This triggers the full memory pipeline:
            //   saveSessionSummary() → analyzeSession() → evolveEmpathyProfile() → synthesizeRequirements()
            const res = await fetch("/api/session-summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: "anonymous", // Overridden server-side
                    transcript,
                    sessionMeta: {
                        sessionId: `gemini_live_${Date.now()}`,
                        startedAt: sessionStart,
                        endedAt: new Date().toISOString(),
                        durationMs: Date.now() - new Date(sessionStart).getTime(),
                    },
                }),
            });
            if (res.ok) {
                logger.info(`[GeminiLive] ✅ Session summary saved (${transcript.length} turns)`);
            } else {
                logger.error(`[GeminiLive] Session summary failed: ${res.status}`);
            }
        } catch (err) {
            logger.error("[GeminiLive] Failed to submit session summary:", err);
        }

        // Reset for next session
        sessionTranscriptRef.current = [];
    }, []);

    /* ── Cleanup mic resources ── */
    const cleanupMic = useCallback((keepStreamOpen = false) => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (!keepStreamOpen) {
            if (micAudioCtxRef.current && micAudioCtxRef.current.state !== "closed") {
                micAudioCtxRef.current.close().catch(() => { /* silent */ });
                micAudioCtxRef.current = null;
            }
            if (micStreamRef.current) {
                micStreamRef.current.getTracks().forEach((t) => t.stop());
                micStreamRef.current = null;
            }
        }
    }, []);

    /* ── Connect ── */
    const connect: (systemPrompt?: string, isReconnect?: boolean) => Promise<void> = useCallback(
        async (systemPrompt?: string, isReconnect = false): Promise<void> => {
            // Save for reconnection (only on first connect, not reconnects)
            if (!isReconnect) {
                lastSystemPromptRef.current = systemPrompt;
                sessionStartRef.current = new Date().toISOString();
            }
            intentionalCloseRef.current = false;

            const connectStart = performance.now();

            // ══════ FAST PATH: Use prewarm cache if available ══════
            const cache = readPrewarmCache();
            const cacheAge = Date.now() - cache.timestamp;
            const cacheValid = cacheAge < 4 * 60 * 1000; // 4 min TTL

            let stream: MediaStream;
            let tokenData: TokenResponse;

            if (cacheValid && cache.micStream && cache.geminiToken) {
                // ⚡ FAST PATH — use cached mic + token
                logger.info(`[GeminiLive] ⚡ Using prewarm cache (age: ${(cacheAge / 1000).toFixed(1)}s)`);
                stream = cache.micStream;
                // Re-enable tracks (prewarmer disables them)
                stream.getTracks().forEach((t) => { t.enabled = true; });
                micStreamRef.current = stream;

                tokenData = {
                    wsUrl: cache.geminiToken.wsUrl,
                    vaultContext: cache.geminiToken.vaultContext,
                    compiledRules: cache.geminiToken.compiledRules,
                    empathyBlock: cache.geminiToken.empathyBlock,
                };

                // Invalidate cache so next connect gets fresh data
                invalidatePrewarmCache();
            } else if (micStreamRef.current && micStreamRef.current.active) {
                // ⚡ RECONNECT PATH — reuse existing mic
                logger.info("[GeminiLive] Reusing existing microphone stream");
                stream = micStreamRef.current;
                
                const tokenResult = await fetch("/api/gemini-live-token", { method: "POST" });
                if (!tokenResult.ok) {
                    const body = await tokenResult.text();
                    throw new Error(`Token fetch failed: ${body}`);
                }
                tokenData = (await tokenResult.json()) as TokenResponse;
            } else {
                // 🔄 PARALLEL PATH — mic + token simultaneously
                logger.info("[GeminiLive] No valid cache, fetching mic + token in parallel");

                const [micResult, tokenResult] = await Promise.allSettled([
                    navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: 16000,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                        },
                    }),
                    fetch("/api/gemini-live-token", { method: "POST" }),
                ]);

                // Check mic
                if (micResult.status === "rejected") {
                    throw new Error(`Microphone error: ${micResult.reason}`);
                }
                stream = micResult.value;
                micStreamRef.current = stream;

                // Check token
                if (tokenResult.status === "rejected") {
                    stream.getTracks().forEach((t) => t.stop());
                    throw new Error(`Token fetch failed: ${tokenResult.reason}`);
                }
                const res = tokenResult.value;
                if (!res.ok) {
                    stream.getTracks().forEach((t) => t.stop());
                    const body = await res.text();
                    throw new Error(`Token fetch failed: ${body}`);
                }
                tokenData = (await res.json()) as TokenResponse;
            }

            const fetchMs = (performance.now() - connectStart).toFixed(0);
            logger.info(`[GeminiLive] Mic + token ready in ${fetchMs}ms`);

            // 3. Build enriched system prompt with memory + empathy
            const memoryParts: string[] = [];

            // Compiled behavior rules (from requirementsSynthesizer) — HIGHEST PRIORITY
            if (tokenData.compiledRules) {
                memoryParts.push(
                    `⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ВЛАДЕЛЬЦА (нарушение = критическая ошибка):\n${tokenData.compiledRules}`,
                );
            }

            // Empathy profile (auto-evolved from past sessions)
            if (tokenData.empathyBlock) {
                memoryParts.push(tokenData.empathyBlock);
            }

            // User-provided system prompt or default
            if (systemPrompt) {
                memoryParts.push(systemPrompt);
            }

            // Vault + ChromaDB context (assembled by contextManager)
            if (tokenData.vaultContext) {
                memoryParts.push(tokenData.vaultContext);
            }

            // ══════ RECONNECT CONTEXT RECOVERY (with memory compaction) ══════
            // When reconnecting after WS drop, inject accumulated transcript
            // so Gemini can continue the conversation seamlessly.
            // Memory compaction: if >30 turns, compress older ones into summary.
            if (isReconnect && sessionTranscriptRef.current.length > 0) {
                const allLines = sessionTranscriptRef.current;
                let contextLines: string[];
                let compactedSummary = "";

                if (allLines.length > 30) {
                    // Memory compaction: summarize older turns, keep last 20 raw
                    const olderLines = allLines.slice(0, -20);
                    const recentLines = allLines.slice(-20);
                    const topics = new Set<string>();
                    for (const line of olderLines) {
                        // Extract key words from each line for topic detection
                        const text = line.replace(/^(USER|ASSISTANT): /, "");
                        if (text.length > 20) topics.add(text.slice(0, 80) + "...");
                    }
                    compactedSummary = `[Сжатый контекст: ${olderLines.length} реплик ранее. Темы: ${Array.from(topics).slice(0, 5).join("; ")}]`;
                    contextLines = recentLines;
                } else {
                    contextLines = allLines.slice(-20);
                }

                const reconnectBlock = [
                    "\n══════ КОНТЕКСТ ПРЕРВАННОЙ СЕССИИ ══════",
                    "Соединение было временно потеряно. Ниже — последние реплики ДО обрыва.",
                    "Продолжай разговор естественно, как если бы ничего не произошло.",
                    "",
                    ...(compactedSummary ? [compactedSummary, ""] : []),
                    ...contextLines,
                    "══════════════════════════════════════════",
                ].join("\n");
                memoryParts.push(reconnectBlock);
                logger.info(`[GeminiLive] 🔄 Reconnect context injected: ${contextLines.length} turns` +
                    (compactedSummary ? ` (+ ${allLines.length - contextLines.length} compacted)` : ""));
            }

            const fullSystemPrompt = memoryParts.join("\n\n═══════════════════════════════════════════════\n\n");

            if (tokenData.contextSummary) {
                logger.info(
                    `[GeminiLive] Context loaded: ${tokenData.contextSummary.totalTokens}t (${tokenData.contextSummary.percentUsed.toFixed(1)}%)`,
                );
            }

            // 4. Open WebSocket
            const ws = new WebSocket(tokenData.wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                const totalMs = (performance.now() - connectStart).toFixed(0);
                logger.info(`[GeminiLive] WebSocket connected in ${totalMs}ms total, sending setup`);

                // Send setup message with full memory-enriched prompt
                const setupMsg: GeminiSetupMessage = {
                    setup: {
                        model: `models/${tokenData.model ?? "gemini-2.5-flash-native-audio-latest"}`,
                        generation_config: {
                            response_modalities: ["AUDIO"],
                            speech_config: {
                                voice_config: {
                                    prebuilt_voice_config: { voice_name: "Aoede" },
                                },
                            },
                        },
                        input_audio_transcription: {},
                        output_audio_transcription: {},
                    },
                };

                if (fullSystemPrompt) {
                    setupMsg.setup.system_instruction = {
                        parts: [{ text: fullSystemPrompt }],
                    };
                }

                ws.send(JSON.stringify(setupMsg));
                setIsConnected(true);
                setTranscript("");

                // Start mic capture with already-acquired stream
                void startMicCapture(ws, stream);
            };

            ws.onmessage = handleMessage;

            ws.onerror = (ev) => {
                logger.error("[GeminiLive] WebSocket error:", ev);
            };

            ws.onclose = (ev) => {
                logger.info(`[GeminiLive] WebSocket closed: code=${ev.code} reason=${ev.reason}`);
                setIsConnected(false);
                
                const willReconnect = !intentionalCloseRef.current && retryCountRef.current < MAX_RECONNECT_ATTEMPTS;
                cleanupMic(willReconnect); // keep stream open if we are reconnecting

                // Auto-reconnect with exponential backoff (5 attempts, max 16s)
                if (willReconnect) {
                    const delay = Math.min(
                        RECONNECT_BASE_DELAY_MS * Math.pow(2, retryCountRef.current),
                        16000,
                    );
                    retryCountRef.current++;
                    setIsReconnecting(true);
                    logger.warn(
                        `[GeminiLive] ⚡ Reconnecting ${retryCountRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms (code=${ev.code})`,
                    );

                    reconnectTimerRef.current = setTimeout(() => {
                        connect(lastSystemPromptRef.current, true /* isReconnect */).catch((err: Error | unknown) => {
                            logger.error("[GeminiLive] Reconnect failed:", err);
                            if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
                                setIsReconnecting(false);
                                logger.error("[GeminiLive] ❌ Max reconnect attempts reached. Voice assistant stopped.");
                                cleanupMic(false);
                            }
                        });
                    }, delay);
                } else if (intentionalCloseRef.current) {
                    // Intentional disconnect — trigger session analytics
                    void triggerSessionAnalysis();
                } else {
                    // All retries exhausted — still save session data!
                    setIsReconnecting(false);
                    cleanupMic(false);
                    logger.error("[GeminiLive] ❌ All reconnect attempts exhausted. Saving session data...");
                    void triggerSessionAnalysis();
                }
            };
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [handleMessage, cleanupMic, triggerSessionAnalysis],
    );

    /* ── Microphone capture ── */
    const startMicCapture = async (ws: WebSocket, stream: MediaStream) => {
        // If we already have a micCtx, use it, otherwise create one
        let ctx = micAudioCtxRef.current;
        if (!ctx || ctx.state === "closed") {
             ctx = new AudioContext({ sampleRate: 16000 });
             micAudioCtxRef.current = ctx;
        }

        if (ctx.state === "suspended") {
            await ctx.resume();
        }

        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16 = float32ToInt16(inputData);
            const base64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);

            const msg: GeminiRealtimeInput = {
                realtime_input: {
                    media_chunks: [
                        { mime_type: "audio/pcm", data: base64 },
                    ],
                },
            };

            ws.send(JSON.stringify(msg));
        };

        source.connect(processor);
        processor.connect(ctx.destination);
    };

    /* ── Disconnect ── */
    const disconnect = useCallback(() => {
        intentionalCloseRef.current = true;
        retryCountRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent any pending reconnect

        // Cancel pending reconnect timer
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }

        cleanupMic(false); // Fully stop mic

        if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
            playbackCtxRef.current.close().catch(() => { /* silent */ });
            playbackCtxRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsConnected(false);
        setIsReconnecting(false);
    }, [cleanupMic]);

    return { connect, disconnect, isConnected, isReconnecting, transcript } as const;
}
