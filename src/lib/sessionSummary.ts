/**
 * @module sessionSummary
 * Generates a summary of the completed voice session and saves it to SQLite
 * for injection into the next session's context window.
 */

import { logger } from "@/lib/logger";
import { saveMemory } from "@/lib/memoryStore";

/**
 * Summarize the voice session conversation and save to long-term memory.
 * Uses a simple extraction approach — pulls key topics from transcript.
 * 
 * Called when disconnectGeminiLive() is invoked.
 */
export async function saveSessionSummary(
    userId: string,
    transcript: Array<{ role: string; text: string }>,
): Promise<void> {
    if (transcript.length < 2) return; // too short to summarize

    try {
        // Extract key topics from the conversation
        const userMessages = transcript
            .filter((m) => m.role === "user")
            .map((m) => m.text)
            .filter((t) => t.length > 10);

        const assistantMessages = transcript
            .filter((m) => m.role === "assistant" || m.role === "model")
            .map((m) => m.text)
            .filter((t) => t.length > 10);

        if (userMessages.length === 0) return;

        // Build a compact summary from user messages
        const topicPhrases = userMessages
            .slice(-10) // last 10 messages
            .map((msg) => msg.slice(0, 150).trim())
            .join("; ");

        const assistantTopics = assistantMessages
            .slice(-5) // last 5 assistant responses
            .map((msg) => msg.slice(0, 100).trim())
            .join("; ");

        const now = new Date();
        const dateStr = now.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
        });

        const summary = [
            `Сессия ${dateStr} (${userMessages.length} сообщений пользователя):`,
            `Темы: ${topicPhrases.slice(0, 500)}`,
            assistantTopics ? `Ключевые ответы: ${assistantTopics.slice(0, 300)}` : "",
        ]
            .filter(Boolean)
            .join("\n");

        await saveMemory(userId, summary, ["session_summary", "auto"]);

        logger.info(
            `[SessionSummary] Saved summary for userId=${userId}, ${userMessages.length} user msgs, ${summary.length} chars`,
        );
    } catch (err) {
        logger.error(
            `[SessionSummary] Failed to save: ${err instanceof Error ? err.message : "Unknown"}`,
        );
    }
}
