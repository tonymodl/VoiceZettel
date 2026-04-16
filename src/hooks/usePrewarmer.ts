"use client";

/**
 * @module usePrewarmer
 * Antigravity Phase 2: Background Pre-warming Hook
 * 
 * On mount (when OrbArea renders), this hook proactively warms up:
 * 1. Microphone MediaStream (phantom — track.enabled = false)
 * 2. Gemini Live token + vault context
 * 3. OpenAI Realtime token
 * 4. Local Core STT availability check
 * 5. All TTS servers (fire-and-forget warmup requests)
 * 
 * SAFETY:
 * - All pre-warming is fire-and-forget with catch(() => {})
 * - Phantom mic is released after configurable timeout (from settings)
 * - Mic released on visibilitychange (when user switches to Zoom/Teams)
 * - If ANY pre-warm fails, startVoice() falls back to its own init logic
 * - Zero changes to existing modules — purely a new additive hook
 */

import { useEffect, useRef, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { logger } from "@/lib/logger";

/** Cached pre-warming results, exposed via window for startVoice() fallback reads */
interface PrewarmCache {
    micStream: MediaStream | null;
    geminiToken: { wsUrl: string; vaultContext: string } | null;
    realtimeToken: string | null;
    localCoreAvailable: boolean | null;
    timestamp: number;
}

/** Global singleton cache — readable from useVoiceSession without prop drilling */
const CACHE_KEY = "__vz_prewarm_cache";

function getCache(): PrewarmCache {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (!w[CACHE_KEY]) {
        w[CACHE_KEY] = {
            micStream: null,
            geminiToken: null,
            realtimeToken: null,
            localCoreAvailable: null,
            timestamp: 0,
        };
    }
    return w[CACHE_KEY] as PrewarmCache;
}

/** Read pre-warm cache from anywhere (e.g. useVoiceSession) */
export function readPrewarmCache(): PrewarmCache {
    if (typeof window === "undefined") {
        return { micStream: null, geminiToken: null, realtimeToken: null, localCoreAvailable: null, timestamp: 0 };
    }
    return getCache();
}

/** Invalidate and release all cached resources */
export function invalidatePrewarmCache(): void {
    if (typeof window === "undefined") return;
    const cache = getCache();
    if (cache.micStream) {
        cache.micStream.getTracks().forEach(t => t.stop());
    }
    cache.micStream = null;
    cache.geminiToken = null;
    cache.realtimeToken = null;
    cache.localCoreAvailable = null;
    cache.timestamp = 0;
}

export function usePrewarmer() {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    const prewarm = useCallback(() => {
        if (typeof window === "undefined") return;

        const cache = getCache();
        const settings = useSettingsStore.getState();
        const timeoutMinutes = settings.prewarmTimeoutMinutes ?? 5;
        const timeoutMs = timeoutMinutes * 60 * 1000;

        logger.info(`[Prewarm] Starting pre-warming (timeout: ${timeoutMinutes} мин)...`);

        // 1. Pre-warm microphone (phantom track — NOT recording)
        navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 16000,
            },
        }).then(stream => {
            if (!mountedRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            // Disable tracks: Chrome shows "recording" indicator but no audio captured
            stream.getTracks().forEach(t => { t.enabled = false; });
            cache.micStream = stream;
            cache.timestamp = Date.now();
            logger.info("[Prewarm] Mic stream cached (phantom mode)");
        }).catch(() => {
            logger.info("[Prewarm] Mic pre-warm skipped (permission denied or unavailable)");
        });

        // 2. Pre-warm Gemini Live token
        fetch("/api/gemini-live-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: "prewarm" }),
            signal: AbortSignal.timeout(5000),
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && !data.disabled && data.wsUrl) {
                    cache.geminiToken = { wsUrl: data.wsUrl, vaultContext: data.vaultContext ?? "" };
                    logger.info("[Prewarm] Gemini token cached");
                }
            })
            .catch(() => { /* fallback in startVoice */ });

        // 3. Pre-warm OpenAI Realtime token
        fetch("/api/realtime-token", { signal: AbortSignal.timeout(5000) })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.client_secret?.value) {
                    cache.realtimeToken = data.client_secret.value;
                    logger.info("[Prewarm] Realtime token cached");
                }
            })
            .catch(() => { /* fallback in startVoice */ });

        // 4. Pre-warm Local Core availability
        fetch("/api/local-health", { signal: AbortSignal.timeout(2000) })
            .then(res => {
                cache.localCoreAvailable = res.ok;
                logger.info(`[Prewarm] Local Core: ${res.ok ? "available" : "unavailable"}`);
            })
            .catch(() => { cache.localCoreAvailable = false; });

        // 5. Pre-warm ALL TTS servers
        const warmTTS = (url: string, body: object) => {
            fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(5000),
            }).catch(() => {});
        };
        warmTTS("/api/tts-local", { text: "прогрев", voice: settings.localTtsVoice ?? "kseniya" });
        warmTTS("/api/tts-piper", { text: "прогрев" });
        warmTTS("/api/tts-qwen", { text: "прогрев" });
        warmTTS("/api/tts", { text: " ", voice: settings.edgeTtsVoice ?? "ru-RU-SvetlanaNeural" });

        // 6. Auto-release phantom mic after timeout
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            if (cache.micStream) {
                cache.micStream.getTracks().forEach(t => t.stop());
                cache.micStream = null;
                logger.info(`[Prewarm] Phantom mic released after ${timeoutMinutes} мин бездействия`);
            }
            // Also invalidate tokens (they may have expired)
            cache.geminiToken = null;
            cache.realtimeToken = null;
        }, timeoutMs);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        prewarm();

        // Release mic when user switches away from the browser
        const handleVisibility = () => {
            if (document.hidden) {
                const cache = getCache();
                if (cache.micStream) {
                    cache.micStream.getTracks().forEach(t => t.stop());
                    cache.micStream = null;
                    logger.info("[Prewarm] Phantom mic released (tab hidden — free for Zoom/Teams)");
                }
            } else {
                // Re-warm when user returns
                prewarm();
            }
        };

        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            mountedRef.current = false;
            document.removeEventListener("visibilitychange", handleVisibility);
            if (timerRef.current) clearTimeout(timerRef.current);
            invalidatePrewarmCache();
        };
    }, [prewarm]);
}
