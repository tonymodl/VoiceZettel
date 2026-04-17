/**
 * @module sessionSummarizer
 * Summarizes voice sessions using GPT-4o-mini.
 * 
 * Called at disconnect to create a session summary that persists
 * across session boundaries, enabling context carry-over.
 * 
 * Flow:
 *   disconnectGeminiLive() → summarizeSession() → saveMemory() → next session loads summary
 */

import { saveMemory } from "@/lib/memoryStore";
import { toBangkokISO } from "@/lib/timezone";
import { logger } from "@/lib/logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

interface SessionMessage {
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
}

/**
 * Summarize a voice session and save to memory.
 * Called when a Gemini Live session disconnects.
 */
export async function summarizeSession(
    userId: string,
    messages: SessionMessage[],
): Promise<string> {
    if (!OPENAI_API_KEY || messages.length < 2) {
        return "";
    }

    const startMs = Date.now();

    try {
        // Build transcript
        const transcript = messages
            .map((m) => `${m.role === "user" ? "Антон" : "Ассистент"}: ${m.content}`)
            .join("\n");

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `Ты суммаризатор голосовых сессий.
                        
Задача: Создай КРАТКУЮ сводку (максимум 5 предложений) разговора между Антоном и его AI-ассистентом.

Формат вывода:
1. Темы: [основные темы разговора]
2. Решения: [принятые решения, если есть]
3. Задачи: [поставленные задачи, если есть]
4. Важное: [ключевая информация для запоминания]

НЕ добавляй ничего, чего не было в разговоре.
Пиши на русском. Будь максимально кратким.`,
                    },
                    {
                        role: "user",
                        content: `Суммаризуй эту голосовую сессию:\n\n${transcript.slice(0, 8000)}`,
                    },
                ],
                temperature: 0.1,
                max_tokens: 500,
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            logger.error(`[SessionSummarizer] OpenAI error: ${res.status} ${body}`);
            return "";
        }

        const json = (await res.json()) as {
            choices: Array<{ message: { content: string } }>;
        };
        const summary = json.choices[0]?.message?.content ?? "";

        if (!summary) return "";

        // Save to memory
        const timestamp = toBangkokISO();
        const memoryText = `СВОДКА ГОЛОСОВОЙ СЕССИИ (${timestamp}):\n${summary}`;
        await saveMemory(userId, memoryText, ["session_summary", "voice"]);

        logger.info(
            `[SessionSummarizer] Session summarized: ${messages.length} messages → ${summary.length}ch (${Date.now() - startMs}ms)`,
        );

        return summary;
    } catch (err) {
        logger.error(`[SessionSummarizer] Failed: ${err}`);
        return "";
    }
}

/**
 * Load the most recent session summary from memory.
 * Used to provide context carry-over to new sessions.
 */
export async function loadLastSessionSummary(userId: string): Promise<string> {
    try {
        // Use the memory store's search to find last session summary
        const { searchMemories } = await import("@/lib/memoryStore");
        const results = await searchMemories(userId, "сводка голосовой сессии");
        
        if (results.length > 0) {
            return `\n═══ ПРЕДЫДУЩАЯ СЕССИЯ ═══\n${results[0].memory.text}\n═══════════════════════════════════════════════\n`;
        }
        return "";
    } catch {
        return "";
    }
}
