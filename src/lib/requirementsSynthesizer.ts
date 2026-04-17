/**
 * @module requirementsSynthesizer
 * Loads ALL user requirements from SQLite, groups them,
 * and generates compiled behavior rules via OpenAI.
 * 
 * Result is stored as a single "compiled_rules" memory
 * that gets injected FIRST in the context window.
 */

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

interface MemoryRow {
    id: string;
    text: string;
    tags: string;
    created_at: string;
}

const SYNTHESIS_PROMPT = `Ты — компилятор правил поведения AI-ассистента.

Тебе дан список требований, замечаний и предпочтений пользователя, накопленных за всё время общения.
Многие из них дублируются или противоречат друг другу.

Твоя задача:
1. Дедуплицировать (оставить самую свежую версию)
2. Устранить противоречия (более поздние отменяют ранние)
3. Сгруппировать по категориям
4. Сформулировать КРАТКИЕ, ЧЁТКИЕ правила

Формат вывода (чистый текст, НЕ JSON):

## Стиль ответов
- [правило 1]
- [правило 2]

## Запреты
- [запрет 1]

## Предпочтения
- [предпочтение 1]

## Формат
- [формат 1]

## Личные факты
- [факт 1]

ВАЖНО: Будь МАКСИМАЛЬНО кратким. Каждое правило — 1 строка.
Не добавляй правила которых нет в исходных данных.`;

/**
 * Synthesize all requirements into compiled behavior rules.
 * Called:
 * - After each new requirement is stored
 * - Periodically (every ~10 sessions)
 */
export async function synthesizeRequirements(userId: string): Promise<string> {
    if (!OPENAI_API_KEY) {
        logger.warn("[RequirementsSynthesizer] No OPENAI_API_KEY");
        return "";
    }

    const startMs = Date.now();

    try {
        const db = getDb();
        const rows = db
            .prepare(
                `SELECT id, text, tags, created_at 
                 FROM memories 
                 WHERE user_id = ? 
                 AND (tags LIKE '%remark%' OR tags LIKE '%requirement%' OR tags LIKE '%correction%' OR tags LIKE '%preference%')
                 ORDER BY created_at ASC`,
            )
            .all(userId) as MemoryRow[];

        if (rows.length === 0) {
            logger.info("[RequirementsSynthesizer] No requirements found");
            return "";
        }

        // Format for OpenAI
        const requirementsList = rows
            .map((r, i) => `${i + 1}. [${r.created_at}] ${r.text} (tags: ${r.tags})`)
            .join("\n");

        // Call OpenAI to synthesize
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: SYNTHESIS_PROMPT },
                    { role: "user", content: `Всего ${rows.length} требований:\n\n${requirementsList}` },
                ],
                temperature: 0.1,
                max_tokens: 2000,
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            logger.error(`[RequirementsSynthesizer] OpenAI error: ${res.status} ${body}`);
            return "";
        }

        const json = await res.json() as { choices: Array<{ message: { content: string } }> };
        const compiledRules = json.choices[0]?.message?.content ?? "";

        if (!compiledRules) return "";

        // Store compiled rules in SQLite (upsert)
        try {
            // Delete old compiled rules
            db.prepare(
                `DELETE FROM memories WHERE user_id = ? AND tags LIKE '%compiled_rules%'`,
            ).run(userId);

            // Insert new
            const id = `compiled_${Date.now()}`;
            db.prepare(
                `INSERT INTO memories (id, user_id, text, tags, created_at) VALUES (?, ?, ?, ?, ?)`,
            ).run(id, userId, compiledRules, JSON.stringify(["compiled_rules", "system"]), new Date().toISOString());

            logger.info(
                `[RequirementsSynthesizer] Compiled ${rows.length} requirements → ${compiledRules.length}ch (${Date.now() - startMs}ms)`,
            );
        } catch (err) {
            logger.error(`[RequirementsSynthesizer] DB store failed: ${err}`);
        }

        return compiledRules;
    } catch (err) {
        logger.error(`[RequirementsSynthesizer] Synthesis failed: ${err}`);
        return "";
    }
}

/**
 * Load the latest compiled rules from SQLite.
 * Fast — no OpenAI call, just DB read.
 */
export function loadCompiledRules(userId: string): string {
    try {
        const db = getDb();
        const row = db
            .prepare(
                `SELECT text FROM memories 
                 WHERE user_id = ? AND tags LIKE '%compiled_rules%'
                 ORDER BY created_at DESC LIMIT 1`,
            )
            .get(userId) as { text: string } | undefined;

        return row?.text ?? "";
    } catch {
        return "";
    }
}
