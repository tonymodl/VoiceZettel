/**
 * @module notifications
 * Voice notification utility for Antigravity task completion.
 * Uses the configured TTS provider to speak notifications.
 */

import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Play a voice notification using the configured TTS.
 * Respects the voiceNotifications setting.
 */
export async function playVoiceNotification(text: string): Promise<void> {
    const { voiceNotifications, ttsProvider } = useSettingsStore.getState();

    if (!voiceNotifications) return;

    try {
        // Use Gemini TTS for notifications (most natural)
        const provider = ttsProvider || "gemini";
        const endpoint = provider === "gemini" ? "/api/tts-gemini" : "/api/tts";

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice: "ru-RU-Wavenet-A" }),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            // Fallback: use browser SpeechSynthesis
            fallbackSpeak(text);
            return;
        }

        const audioBlob = await res.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.volume = 0.6;
        audio.onended = () => URL.revokeObjectURL(audioUrl);

        await audio.play();
    } catch {
        // Fallback: use browser SpeechSynthesis
        fallbackSpeak(text);
    }
}

/**
 * Browser-native TTS fallback when API is unavailable.
 */
function fallbackSpeak(text: string): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ru-RU";
    utterance.volume = 0.6;
    utterance.rate = 1.0;

    // Try to find a Russian voice
    const voices = window.speechSynthesis.getVoices();
    const ruVoice = voices.find((v) => v.lang.startsWith("ru"));
    if (ruVoice) utterance.voice = ruVoice;

    window.speechSynthesis.speak(utterance);
}
