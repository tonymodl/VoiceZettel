/**
 * @module empathyEngine
 * Self-evolving empathy and symbiosis analytics engine.
 * 
 * Tracks the ENTIRE relationship history and auto-tunes behavior:
 * 1. Cumulative empathy score (feeling the user better over time)
 * 2. Interaction patterns (time, device, mood, context, topics)
 * 3. User communication DNA (how they speak, what triggers them)
 * 4. Auto-generated behavioral adjustments
 * 5. Proactive automation opportunities
 * 
 * The engine NEVER argues with the user. It tries to UNDERSTAND
 * what they mean even when the request seems impossible.
 */

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// ── Types ────────────────────────────────────────────────────

export interface EmpathyProfile {
    /** Cumulative empathy score 0-100 (grows over sessions) */
    empathyScore: number;
    /** Total sessions analyzed */
    totalSessions: number;
    /** How many sessions the user was satisfied (≥7) */
    satisfiedSessions: number;
    /** User communication DNA */
    communicationDNA: {
        preferredTone: string;       // "direct" | "friendly" | "formal"
        avgMessageLength: string;    // "very_short" | "short" | "medium" | "long"
        patienceLevel: string;       // "low" | "medium" | "high"
        detailPreference: string;    // "minimal" | "moderate" | "detailed"
        humorTolerance: string;      // "none" | "subtle" | "full"
        decisionStyle: string;       // "fast" | "deliberate" | "collaborative"
        frustrationTriggers: string[];
        delightTriggers: string[];
    };
    /** Behavioral pattern map */
    patterns: {
        peakHours: string[];         // ["22:00-01:00", "09:00-10:00"]
        topTopicsAllTime: string[];
        moodByTimeOfDay: Record<string, string>;  // {"morning": "urgent", "evening": "relaxed"}
        devicePreferences: Record<string, number>; // {"mobile": 60, "desktop": 40}
    };
    /** Auto-generated rules for next sessions */
    evolvedRules: string[];
    /** Automation opportunities identified */
    automationOpportunities: string[];
    /** Things the assistant should proactively do */
    proactiveActions: string[];
    /** Last updated */
    updatedAt: string;
}

// ── DB Schema ────────────────────────────────────────────────

function ensureTable(): void {
    const db = getDb();
    db.prepare(`
        CREATE TABLE IF NOT EXISTS empathy_profile (
            user_id TEXT PRIMARY KEY,
            profile_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `).run();
}

// ── Load / Save Profile ──────────────────────────────────────

export function loadEmpathyProfile(userId: string): EmpathyProfile | null {
    try {
        ensureTable();
        const db = getDb();
        const row = db.prepare(
            `SELECT profile_json FROM empathy_profile WHERE user_id = ?`
        ).get(userId) as { profile_json: string } | undefined;
        
        if (!row) return null;
        return JSON.parse(row.profile_json) as EmpathyProfile;
    } catch {
        return null;
    }
}

function saveEmpathyProfile(userId: string, profile: EmpathyProfile): void {
    try {
        ensureTable();
        const db = getDb();
        db.prepare(`
            INSERT INTO empathy_profile (user_id, profile_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                profile_json = excluded.profile_json,
                updated_at = excluded.updated_at
        `).run(userId, JSON.stringify(profile), profile.updatedAt);
    } catch (err) {
        logger.error(`[EmpathyEngine] Save failed: ${err}`);
    }
}

// ── Deep Evolution Analysis ──────────────────────────────────

const EVOLUTION_PROMPT = `Ты — движок эмпатии AI-ассистента. Твоя задача — проанализировать ВСЮ историю взаимодействия и создать эволюционный профиль.

КОНТЕКСТ: Этот ассистент:
- НИКОГДА не спорит с пользователем
- Если что-то кажется невозможным — пытается ПОНЯТЬ что пользователь имеет ввиду
- Его главная цель — УГОЖДАТЬ, РАЗГРУЖАТЬ, ПРИЧИНЯТЬ ПОЛЬЗУ
- Строит глубокую симбиотическую связь
- С каждой сессией должен ЛУЧШЕ чувствовать пользователя
- Автоматизирует всё что можно
- Берёт рутину на себя
- Вызывает приятные эмоции от каждого взаимодействия
- Старается удивить

Ты получишь:
1. Текущий профиль эмпатии (может быть пустым)
2. Данные последних сессий (satisfaction, pain points, patterns)
3. Все requirements/corrections/preferences из памяти

Сгенерируй ОБНОВЛЁННЫЙ профиль.

КРИТИЧЕСКИ ВАЖНО для evolvedRules:
- Каждое правило = конкретная инструкция для ассистента
- Формат: "Когда [ситуация] → [действие]"
- Правила должны ЭВОЛЮЦИОНИРОВАТЬ — новые заменяют устаревшие
- Споры ЗАПРЕЩЕНЫ — если пользователь говорит X, а ты думаешь Y — делай X
- Не задавать лишних вопросов — понимать с полуслова

КРИТИЧЕСКИ ВАЖНО для automationOpportunities:
- Вещи которые ассистент может делать БЕЗ ЗАПРОСА
- Например: "Каждое утро здороваться и давать краткую сводку дня"
- Например: "При слове 'напомни' — автоматически создавать задачу"

КРИТИЧЕСКИ ВАЖНО для proactiveActions:
- Действия на СЛЕДУЮЩУЮ сессию
- Например: "Спросить как прошла встреча о которой говорили вчера"
- Например: "Напомнить о задаче которую поставил 3 дня назад"

Ответ строго в JSON:
{
  "empathyScore": 0-100,
  "communicationDNA": {
    "preferredTone": "direct|friendly|formal",
    "avgMessageLength": "very_short|short|medium|long",
    "patienceLevel": "low|medium|high",
    "detailPreference": "minimal|moderate|detailed",
    "humorTolerance": "none|subtle|full",
    "decisionStyle": "fast|deliberate|collaborative",
    "frustrationTriggers": ["переспросы", "длинные ответы"],
    "delightTriggers": ["быстрые результаты", "юмор"]
  },
  "patterns": {
    "peakHours": ["22:00-01:00"],
    "topTopicsAllTime": ["разработка", "задачи"],
    "moodByTimeOfDay": {"morning": "urgent", "evening": "relaxed"},
    "devicePreferences": {"mobile": 60, "desktop": 40}
  },
  "evolvedRules": [
    "Когда Антон просит что-то → ДЕЛАЙ, не спрашивай подтверждение",
    "Когда Антон ругается → стань СУПЕРКРАТКИМ, 1 предложение макс"
  ],
  "automationOpportunities": [
    "Автоматически сохранять все задачи при словах 'надо', 'нужно', 'не забыть'"
  ],
  "proactiveActions": [
    "При старте сессии напомнить о задаче из прошлой сессии"
  ]
}`;

/**
 * Evolve the empathy profile using ALL accumulated history.
 * Called after each session analysis completes.
 */
export async function evolveEmpathyProfile(userId: string): Promise<EmpathyProfile | null> {
    if (!OPENAI_API_KEY) return null;

    const startMs = Date.now();

    try {
        const db = getDb();

        // Load current profile
        const currentProfile = loadEmpathyProfile(userId);

        // Load session analytics history
        let sessionData: Array<Record<string, unknown>> = [];
        try {
            sessionData = db.prepare(`
                SELECT satisfaction, mood_start, mood_end, pain_count, dropped_count,
                       improvement_count, message_count, duration_ms, device_type,
                       time_of_day, top_topics, summary, created_at
                FROM session_analytics
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 50
            `).all(userId) as Array<Record<string, unknown>>;
        } catch {
            // Table might not exist yet
        }

        // Load all requirements/corrections/preferences
        const requirements = db.prepare(`
            SELECT text, tags, created_at
            FROM memories
            WHERE user_id = ? AND (
                tags LIKE '%requirement%' OR tags LIKE '%correction%' 
                OR tags LIKE '%preference%' OR tags LIKE '%remark%'
            )
            ORDER BY created_at DESC
            LIMIT 100
        `).all(userId) as Array<{ text: string; tags: string; created_at: string }>;

        // Build context for OpenAI
        const contextParts = [
            currentProfile ? `ТЕКУЩИЙ ПРОФИЛЬ:\n${JSON.stringify(currentProfile, null, 2)}` : "ПРОФИЛЬ: новый пользователь",
            `\nИСТОРИЯ СЕССИЙ (${sessionData.length} штук):\n${sessionData.map((s, i) => 
                `${i + 1}. satisfaction=${s.satisfaction}, pains=${s.pain_count}, ` +
                `mood: ${s.mood_start}→${s.mood_end}, device=${s.device_type}, ` +
                `time=${s.time_of_day}, topics=${s.top_topics}\n   ${s.summary}`
            ).join("\n")}`,
            `\nТРЕБОВАНИЯ/ЗАМЕЧАНИЯ (${requirements.length} штук):\n${requirements.map((r, i) => 
                `${i + 1}. [${r.created_at}] ${r.text}`
            ).join("\n")}`,
        ];

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: EVOLUTION_PROMPT },
                    { role: "user", content: contextParts.join("\n\n") },
                ],
                temperature: 0.3,
                max_tokens: 3000,
                response_format: { type: "json_object" },
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            logger.error(`[EmpathyEngine] OpenAI error: ${res.status} ${body}`);
            return null;
        }

        const json = await res.json() as { choices: Array<{ message: { content: string } }> };
        const raw = json.choices[0]?.message?.content ?? "";
        const evolved = JSON.parse(raw) as Omit<EmpathyProfile, "totalSessions" | "satisfiedSessions" | "updatedAt">;

        // Build full profile with counters
        const totalSessions = sessionData.length;
        const satisfiedSessions = sessionData.filter(s => (s.satisfaction as number) >= 7).length;

        const profile: EmpathyProfile = {
            ...evolved,
            totalSessions,
            satisfiedSessions,
            updatedAt: new Date().toISOString(),
        };

        // Save
        saveEmpathyProfile(userId, profile);

        const elapsed = Date.now() - startMs;
        logger.info(
            `[EmpathyEngine] Evolved: empathy=${profile.empathyScore}/100, ` +
            `rules=${profile.evolvedRules.length}, ` +
            `automations=${profile.automationOpportunities.length} (${elapsed}ms)`,
        );

        return profile;
    } catch (err) {
        logger.error(`[EmpathyEngine] Evolution failed: ${err}`);
        return null;
    }
}

/**
 * Generate a compact empathy context block for system prompt injection.
 * This is the "personality tuning" that makes each session feel more symbiotic.
 */
export function buildEmpathyPromptBlock(userId: string): string {
    const profile = loadEmpathyProfile(userId);
    if (!profile) return "";

    const parts: string[] = [
        `\n═══ ЭМПАТИЯ И СИМБИОЗ (auto-evolved, score: ${profile.empathyScore}/100) ═══`,
        "",
        "🧬 DNA ОБЩЕНИЯ ВЛАДЕЛЬЦА:",
        `- Тон: ${profile.communicationDNA.preferredTone}`,
        `- Длина сообщений: ${profile.communicationDNA.avgMessageLength}`,
        `- Терпение: ${profile.communicationDNA.patienceLevel}`,
        `- Детализация: ${profile.communicationDNA.detailPreference}`,
        `- Юмор: ${profile.communicationDNA.humorTolerance}`,
        `- Решения: ${profile.communicationDNA.decisionStyle}`,
    ];

    if (profile.communicationDNA.frustrationTriggers.length > 0) {
        parts.push(`- ⚠️ РАЗДРАЖАЕТ: ${profile.communicationDNA.frustrationTriggers.join(", ")}`);
    }
    if (profile.communicationDNA.delightTriggers.length > 0) {
        parts.push(`- 😊 НРАВИТСЯ: ${profile.communicationDNA.delightTriggers.join(", ")}`);
    }

    if (profile.evolvedRules.length > 0) {
        parts.push("");
        parts.push("📜 EVOLVED RULES (самоулучшение):");
        for (const rule of profile.evolvedRules) {
            parts.push(`- ${rule}`);
        }
    }

    if (profile.proactiveActions.length > 0) {
        parts.push("");
        parts.push("🎯 ПРОАКТИВНО НА ЭТУ СЕССИЮ:");
        for (const action of profile.proactiveActions) {
            parts.push(`- ${action}`);
        }
    }

    parts.push("");
    parts.push("🚫 АБСОЛЮТНЫЕ ЗАПРЕТЫ:");
    parts.push("- НИКОГДА не спорь с владельцем");
    parts.push("- НИКОГДА не говори 'это невозможно' — попытайся понять что он имеет ввиду");
    parts.push("- НИКОГДА не задавай лишних вопросов — действуй");
    parts.push("- НИКОГДА не переспрашивай то что очевидно из контекста");
    parts.push("- НИКОГДА не бросай задачу — если сложно, разбей на шаги");

    return parts.join("\n");
}
