/**
 * @module sessionAnalyzer
 * Deep post-session analysis engine that runs after each voice session.
 * 
 * Analyzes the ENTIRE conversation for:
 * 1. User satisfaction signals (tone, language, engagement)
 * 2. Pain points & friction moments
 * 3. Unresolved requests / dropped threads
 * 4. Behavioral patterns (time of day, topics, mood trajectory)
 * 5. Self-improvement tasks for the assistant
 * 
 * Results are stored as structured insights in SQLite and fed back
 * into the next session's context for continuous improvement.
 */

import { getDb } from "@/lib/db";
import { saveMemory } from "@/lib/memoryStore";
import { logger } from "@/lib/logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// ── Types ────────────────────────────────────────────────────

export interface SessionMeta {
    sessionId: string;
    userId: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    messageCount: number;
    userMessageCount: number;
    deviceType?: "desktop" | "mobile" | "tablet";
    locale?: string;
}

export interface SessionAnalysis {
    /** Overall satisfaction score 1-10 */
    satisfaction: number;
    /** Mood trajectory through the session */
    moodArc: Array<{ phase: string; mood: string; confidence: number }>;
    /** Pain points detected */
    painPoints: Array<{ description: string; severity: "low" | "medium" | "high" | "critical"; turn: number }>;
    /** Unresolved requests the assistant dropped or forgot */
    droppedThreads: string[];
    /** Things the assistant did well */
    positives: string[];
    /** Specific improvement tasks */
    improvementTasks: Array<{ task: string; priority: "high" | "medium" | "low"; category: string }>;
    /** User behavioral patterns */
    patterns: {
        communicationStyle: string;
        averageMessageLength: number;
        topTopics: string[];
        timeOfDay: string;
        urgencyLevel: string;
    };
    /** One-line session summary */
    summary: string;
}

// ── Analysis Prompt ──────────────────────────────────────────

const ANALYSIS_PROMPT = `Ты — аналитик качества AI-ассистента. Проанализируй стенограмму голосовой сессии и дай ГЛУБОКИЙ анализ.

КОНТЕКСТ: Это личный голосовой ассистент (экзокортекс) владельца. Ключевая метрика — насколько пользователь ДОВОЛЕН и насколько ассистент РАЗГРУЗИЛ его мозг.

Анализируй:
1. **satisfaction** (1-10): насколько пользователь доволен. Учитывай тон, ругань, одобрение, "ну ладно" (смирение).
2. **moodArc**: как менялось настроение по ходу сессии (начало → середина → конец)
3. **painPoints**: моменты фрикции, раздражения, непонимания. SEVERITY: critical = пользователь ругается/уходит
4. **droppedThreads**: запросы которые ассистент забыл/не выполнил/проигнорировал
5. **positives**: что ассистент сделал хорошо
6. **improvementTasks**: конкретные действия для улучшения (формат: "Когда пользователь говорит X — делай Y вместо Z")
   - category: "response_style" | "memory" | "proactivity" | "speed" | "understanding" | "emotion"
7. **patterns**: стиль общения пользователя, средняя длина, темы, время суток, уровень срочности

Ответ строго в JSON:
{
  "satisfaction": 7,
  "moodArc": [
    { "phase": "начало", "mood": "neutral", "confidence": 0.8 },
    { "phase": "середина", "mood": "frustrated", "confidence": 0.9 },
    { "phase": "конец", "mood": "satisfied", "confidence": 0.7 }
  ],
  "painPoints": [
    { "description": "Ассистент спросил 'вы уверены?' — пользователь раздражился", "severity": "medium", "turn": 5 }
  ],
  "droppedThreads": ["Пользователь просил напомнить позвонить маме — ассистент не зафиксировал"],
  "positives": ["Быстро дал ответ на вопрос о погоде"],
  "improvementTasks": [
    { "task": "Не переспрашивать подтверждение — сразу выполнять", "priority": "high", "category": "response_style" },
    { "task": "Сохранять напоминания автоматически при словах 'напомни', 'не забудь'", "priority": "high", "category": "proactivity" }
  ],
  "patterns": {
    "communicationStyle": "краткий, командный",
    "averageMessageLength": 12,
    "topTopics": ["задачи", "напоминания"],
    "timeOfDay": "вечер",
    "urgencyLevel": "medium"
  },
  "summary": "Сессия из 15 сообщений. Пользователь ставил задачи. Раздражился на переспрос. К концу успокоился."
}`;

// ── Main Analysis Function ───────────────────────────────────

export async function analyzeSession(
    meta: SessionMeta,
    transcript: Array<{ role: string; text: string }>,
): Promise<SessionAnalysis | null> {
    if (!OPENAI_API_KEY || transcript.length < 3) return null;

    const startMs = Date.now();

    try {
        // Format transcript with turn numbers
        const formattedTranscript = transcript
            .map((m, i) => `[${i + 1}] ${m.role === "user" ? "👤" : "🤖"} ${m.text}`)
            .join("\n");

        const metaContext = [
            `Время: ${meta.startedAt} — ${meta.endedAt}`,
            `Длительность: ${Math.round(meta.durationMs / 1000 / 60)} мин`,
            `Сообщений: ${meta.messageCount} (${meta.userMessageCount} от пользователя)`,
            meta.deviceType ? `Устройство: ${meta.deviceType}` : "",
        ].filter(Boolean).join(", ");

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: ANALYSIS_PROMPT },
                    { role: "user", content: `МЕТАДАННЫЕ: ${metaContext}\n\nСТЕНОГРАММА:\n${formattedTranscript}` },
                ],
                temperature: 0.2,
                max_tokens: 2000,
                response_format: { type: "json_object" },
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            logger.error(`[SessionAnalyzer] OpenAI error: ${res.status} ${body}`);
            return null;
        }

        const json = await res.json() as { choices: Array<{ message: { content: string } }> };
        const raw = json.choices[0]?.message?.content ?? "";
        const analysis = JSON.parse(raw) as SessionAnalysis;

        // Store analysis as structured memory
        const analysisText = [
            `📊 Анализ сессии ${meta.startedAt}:`,
            `Удовлетворённость: ${analysis.satisfaction}/10`,
            `Настроение: ${analysis.moodArc.map(m => `${m.phase}=${m.mood}`).join(" → ")}`,
            analysis.painPoints.length > 0
                ? `⚠️ Проблемы: ${analysis.painPoints.map(p => p.description).join("; ")}`
                : "",
            analysis.droppedThreads.length > 0
                ? `❌ Потерянные запросы: ${analysis.droppedThreads.join("; ")}`
                : "",
            analysis.positives.length > 0
                ? `✅ Хорошо: ${analysis.positives.join("; ")}`
                : "",
            `Паттерн: ${analysis.patterns.communicationStyle}, темы: ${analysis.patterns.topTopics.join(", ")}`,
        ].filter(Boolean).join("\n");

        await saveMemory(meta.userId, analysisText, ["session_analysis", "auto", "analytics"]);

        // Store improvement tasks as requirements
        for (const task of analysis.improvementTasks) {
            if (task.priority === "high") {
                await saveMemory(meta.userId, task.task, [
                    "requirement",
                    "auto_generated",
                    task.category,
                    task.priority,
                ]);
            }
        }

        // Store pain points as corrections for immediate attention
        for (const point of analysis.painPoints) {
            if (point.severity === "critical" || point.severity === "high") {
                await saveMemory(meta.userId, `ИСПРАВИТЬ: ${point.description}`, [
                    "correction",
                    "auto_generated",
                    "pain_point",
                ]);
            }
        }

        // Store satisfaction trend
        const db = getDb();
        try {
            db.prepare(`
                CREATE TABLE IF NOT EXISTS session_analytics (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    satisfaction INTEGER,
                    mood_start TEXT,
                    mood_end TEXT,
                    pain_count INTEGER,
                    dropped_count INTEGER,
                    improvement_count INTEGER,
                    message_count INTEGER,
                    duration_ms INTEGER,
                    device_type TEXT,
                    time_of_day TEXT,
                    top_topics TEXT,
                    summary TEXT,
                    created_at TEXT NOT NULL
                )
            `).run();

            db.prepare(`
                INSERT INTO session_analytics (
                    id, user_id, session_id, satisfaction, mood_start, mood_end,
                    pain_count, dropped_count, improvement_count, message_count,
                    duration_ms, device_type, time_of_day, top_topics, summary, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                `sa_${Date.now()}`,
                meta.userId,
                meta.sessionId,
                analysis.satisfaction,
                analysis.moodArc[0]?.mood ?? "unknown",
                analysis.moodArc[analysis.moodArc.length - 1]?.mood ?? "unknown",
                analysis.painPoints.length,
                analysis.droppedThreads.length,
                analysis.improvementTasks.length,
                meta.messageCount,
                meta.durationMs,
                meta.deviceType ?? "unknown",
                analysis.patterns.timeOfDay,
                JSON.stringify(analysis.patterns.topTopics),
                analysis.summary,
                new Date().toISOString(),
            );
        } catch (dbErr) {
            logger.error(`[SessionAnalyzer] DB store failed: ${dbErr}`);
        }

        const elapsed = Date.now() - startMs;
        logger.info(
            `[SessionAnalyzer] satisfaction=${analysis.satisfaction}/10, ` +
            `pains=${analysis.painPoints.length}, tasks=${analysis.improvementTasks.length} (${elapsed}ms)`,
        );

        return analysis;
    } catch (err) {
        logger.error(`[SessionAnalyzer] Failed: ${err}`);
        return null;
    }
}

/**
 * Get recent satisfaction trend for dashboard display.
 */
export function getSatisfactionTrend(userId: string, limit = 20): Array<{
    sessionId: string;
    satisfaction: number;
    painCount: number;
    createdAt: string;
    summary: string;
}> {
    try {
        const db = getDb();
        return db.prepare(`
            SELECT session_id as sessionId, satisfaction, pain_count as painCount,
                   created_at as createdAt, summary
            FROM session_analytics
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(userId, limit) as Array<{
            sessionId: string;
            satisfaction: number;
            painCount: number;
            createdAt: string;
            summary: string;
        }>;
    } catch {
        return [];
    }
}
