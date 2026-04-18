/**
 * @module contextManager
 * Intelligent context window manager for VoiceZettel.
 * 
 * Scores, ranks, and allocates context budget across 6 slots:
 *   🔴 CRITICAL — remarks, requirements, corrections (NEVER evicted)
 *   🟠 ACTIVE — current tasks, goals, open projects
 *   🟡 PREDICTED — pre-fetched based on time/patterns
 *   🔵 RECENT — last session summary + fresh Telegram
 *   ⚪ VAULT — top-scored Zettelkasten notes
 *   🟣 TOOLS — tool declarations (from VoiceCapabilities toggles)
 */

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getGoldenContextChars } from "@/lib/goldenContext";

// ── Types ────────────────────────────────────────────────────

export interface ContextItem {
    id: string;
    text: string;
    tags: string[];
    source: "memory" | "vault" | "chroma" | "session" | "predicted";
    score: number;
    createdAt: string;
    /** Character count of this item */
    chars: number;
}

export interface ContextSlot {
    name: string;
    emoji: string;
    color: string;
    maxChars: number;
    items: ContextItem[];
    usedChars: number;
}

export interface ContextSummary {
    totalTokens: number;
    maxTokens: number;
    percentUsed: number;
    slots: {
        critical: ContextSlot;
        active: ContextSlot;
        predicted: ContextSlot;
        recent: ContextSlot;
        vault: ContextSlot;
        tools: ContextSlot;
    };
    /** Combined context string ready for system prompt injection */
    contextText: string;
}

// ── Tag Weights ──────────────────────────────────────────────

const TAG_WEIGHTS: Record<string, number> = {
    remark: 1.0,
    correction: 1.0,
    requirement: 0.95,
    preference: 0.85,
    goal: 0.75,
    task: 0.75,
    session_summary: 0.70,
    fact: 0.50,
    idea: 0.40,
    chat: 0.20,
    "user-said": 0.20,
    vault: 0.15,
    preloaded: 0.15,
};

const CRITICAL_TAGS = new Set(["remark", "correction", "requirement", "preference"]);

// ── Priority Scorer ──────────────────────────────────────────

interface MemoryRow {
    id: string;
    text: string;
    tags: string;
    created_at: string;
}

function scoreItem(row: MemoryRow): number {
    const tags: string[] = JSON.parse(row.tags) as string[];
    const ageHours =
        (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);

    // Tag weight: max of all tags
    const wTag = 0.30;
    const tagScore = Math.max(
        ...tags.map((t) => TAG_WEIGHTS[t] ?? 0.10),
        0.10,
    );

    // Recency decay: e^(-age/72) → half-life ~50 hours
    const wTime = 0.25;
    const timeScore = Math.exp(-ageHours / 72);

    // Pin bonus: critical tags get +1
    const wPin = 0.25;
    const pinScore = tags.some((t) => CRITICAL_TAGS.has(t)) ? 1.0 : 0.0;

    // Length penalty: prefer shorter items (less context waste)
    const wLen = 0.20;
    const lenScore = Math.max(0, 1.0 - row.text.length / 1000);

    return wTag * tagScore + wTime * timeScore + wPin * pinScore + wLen * lenScore;
}

// ── Predictive Pre-fetcher ───────────────────────────────────

/**
 * Generate dynamic search queries based on:
 * - Time of day
 * - Day of week
 * - Last session topics
 */
export function getPredictedQueries(): string[] {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=Sun
    const queries: string[] = [];

    // Time-of-day patterns
    if (hour >= 6 && hour < 12) {
        queries.push("задачи планы расписание утро сегодня");
        queries.push("важные встречи напоминания дедлайны");
    } else if (hour >= 12 && hour < 18) {
        queries.push("проект работа прогресс результаты");
        queries.push("текущие задачи приоритеты статус");
    } else if (hour >= 18 && hour < 23) {
        queries.push("итоги дня что сделано результат");
        queries.push("личные дела планы идеи мысли");
    } else {
        queries.push("размышления идеи заметки инсайты");
    }

    // Weekend vs weekday
    if (day === 0 || day === 6) {
        queries.push("личное отдых хобби идеи");
    } else {
        queries.push("рабочие задачи проекты код архитектура");
    }

    // Always include recent conversations and personal chats
    queries.push("последние разговоры обсуждение переписка");
    queries.push("личные сообщения обещания договорённости встречи");

    return queries;
}

// ── Budget Allocator ─────────────────────────────────────────

interface AllocatorOptions {
    totalBudget: number;
    /** Pre-fetched vault notes (condensed) */
    vaultNotes: string;
    /** Pre-fetched ChromaDB results */
    chromaResults: string[];
    /** User ID for SQLite queries */
    userId: string;
    /** User-configurable slot priorities (percentages, must sum to 100) */
    priorities?: SlotPriorities;
}

function createEmptySlot(
    name: string,
    emoji: string,
    color: string,
    maxChars: number,
): ContextSlot {
    return { name, emoji, color, maxChars, items: [], usedChars: 0 };
}

/**
 * Load critical memories (remarks, requirements, corrections, preferences)
 * from SQLite. These ALWAYS get loaded — they are never evicted.
 */
export function loadCriticalMemories(userId: string): ContextItem[] {
    try {
        const db = getDb();
        const rows = db
            .prepare(
                `SELECT id, text, tags, created_at 
                 FROM memories 
                 WHERE user_id = ? 
                 AND (tags LIKE '%remark%' OR tags LIKE '%requirement%' OR tags LIKE '%correction%' OR tags LIKE '%preference%')
                 ORDER BY created_at DESC 
                 LIMIT 50`,
            )
            .all(userId) as MemoryRow[];

        return rows.map((row) => ({
            id: row.id,
            text: row.text,
            tags: JSON.parse(row.tags) as string[],
            source: "memory" as const,
            score: scoreItem(row),
            createdAt: row.created_at,
            chars: row.text.length,
        }));
    } catch (err) {
        logger.error(`[ContextManager] Failed to load critical memories: ${err}`);
        return [];
    }
}

/**
 * Load session summaries from SQLite.
 */
export function loadSessionSummaries(userId: string, limit = 3): ContextItem[] {
    try {
        const db = getDb();
        const rows = db
            .prepare(
                `SELECT id, text, tags, created_at 
                 FROM memories 
                 WHERE user_id = ? AND tags LIKE '%session_summary%'
                 ORDER BY created_at DESC 
                 LIMIT ?`,
            )
            .all(userId, limit) as MemoryRow[];

        return rows.map((row) => ({
            id: row.id,
            text: row.text,
            tags: JSON.parse(row.tags) as string[],
            source: "session" as const,
            score: scoreItem(row),
            createdAt: row.created_at,
            chars: row.text.length,
        }));
    } catch (err) {
        logger.error(`[ContextManager] Failed to load session summaries: ${err}`);
        return [];
    }
}

/**
 * Load active tasks/goals from SQLite.
 */
export function loadActiveMemories(userId: string): ContextItem[] {
    try {
        const db = getDb();
        const rows = db
            .prepare(
                `SELECT id, text, tags, created_at 
                 FROM memories 
                 WHERE user_id = ? 
                 AND (tags LIKE '%goal%' OR tags LIKE '%task%')
                 AND tags NOT LIKE '%remark%'
                 AND tags NOT LIKE '%requirement%'
                 ORDER BY created_at DESC 
                 LIMIT 20`,
            )
            .all(userId) as MemoryRow[];

        return rows
            .map((row) => ({
                id: row.id,
                text: row.text,
                tags: JSON.parse(row.tags) as string[],
                source: "memory" as const,
                score: scoreItem(row),
                createdAt: row.created_at,
                chars: row.text.length,
            }))
            .sort((a, b) => b.score - a.score);
    } catch (err) {
        logger.error(`[ContextManager] Failed to load active memories: ${err}`);
        return [];
    }
}

interface SlotPriorities {
    critical: number;
    active: number;
    predicted: number;
    recent: number;
    vault: number;
    tools: number;
}

/**
 * Main allocation function. Builds the full ContextSummary with all 6 slots.
 */
export function allocateContext(opts: AllocatorOptions): ContextSummary {
    const { totalBudget, chromaResults, userId } = opts;

    // Define tools budget statically as reserved space
    const TOOLS_MAX_CHARS = 10400;

    // ── Phase 1: CRITICAL (No strict limit, takes what it needs) ──
    const critical = createEmptySlot("Замечания", "🔴", "#ff6b6b", totalBudget);

    // Golden Context (inner circle) — ALWAYS present, NEVER evicted
    const goldenChars = getGoldenContextChars(userId);
    critical.items.push({
        id: "golden_context",
        text: "[Ближний круг — инжектирован в промпт через goldenContext.ts]",
        tags: ["golden", "inner-circle", "never-evict"],
        source: "memory" as const,
        score: 1.0,
        createdAt: new Date().toISOString(),
        chars: goldenChars,
    });
    critical.usedChars += goldenChars;

    // User corrections/remarks
    const criticalItems = loadCriticalMemories(userId);
    for (const item of criticalItems) {
        if (critical.usedChars + item.chars > totalBudget) break;
        critical.items.push(item);
        critical.usedChars += item.chars;
    }

    // Set its actual maxChars to what it consumed so UI reflects 100% capacity used for its dedicated budget chunk
    critical.maxChars = critical.usedChars > 0 ? critical.usedChars : 1; 

    // ── Calculate Remaining Budget for Flex Allocation ──
    let availableBudget = totalBudget - critical.usedChars - TOOLS_MAX_CHARS;
    if (availableBudget < 0) availableBudget = 0;

    // ── Phase 2: Gather candidate items for other slots ──
    // Slot: PREDICTED
    const predictedCandidates: ContextItem[] = [];
    for (const text of chromaResults) {
        const trimmed = text.slice(0, 500);
        predictedCandidates.push({
            id: `chroma_${predictedCandidates.length}`,
            text: trimmed,
            tags: ["predicted"],
            source: "chroma",
            score: 0.5,
            createdAt: new Date().toISOString(),
            chars: trimmed.length,
        });
    }

    // Slot: ACTIVE
    const activeCandidates = loadActiveMemories(userId);

    // Slot: RECENT
    const recentCandidates = loadSessionSummaries(userId);

    // ── Phase 3: Flex Waterfall Allocation ──
    // Target base split: 50% Predicted, 25% Active, 25% Recent
    let predictedTarget = Math.floor(availableBudget * 0.50);
    let activeTarget = Math.floor(availableBudget * 0.25);
    let recentTarget = Math.floor(availableBudget * 0.25);

    // Helper to calculate total chars needed by candidate array
    const calcNeeded = (candidates: ContextItem[]) => candidates.reduce((sum, item) => sum + item.chars, 0);

    const predictedNeeded = calcNeeded(predictedCandidates);
    const activeNeeded = calcNeeded(activeCandidates);
    const recentNeeded = calcNeeded(recentCandidates);

    // Waterfall spill-over: If a slot needs less than its target, shift remainder to others
    if (activeNeeded < activeTarget) {
        const excess = activeTarget - activeNeeded;
        activeTarget = activeNeeded;
        predictedTarget += Math.floor(excess * 0.7);
        recentTarget += Math.floor(excess * 0.3);
    }
    if (recentNeeded < recentTarget) {
        const excess = recentTarget - recentNeeded;
        recentTarget = recentNeeded;
        predictedTarget += excess;
    }
    if (predictedNeeded < predictedTarget) {
        const excess = predictedTarget - predictedNeeded;
        predictedTarget = predictedNeeded;
        activeTarget += excess; // Or whatever is next priority
    }

    // ── Phase 4: Fill Slots ──
    const fillSlot = (name: string, emoji: string, color: string, maxChars: number, candidates: ContextItem[]) => {
        const slot = createEmptySlot(name, emoji, color, maxChars);
        for (const item of candidates) {
            if (slot.usedChars + item.chars > slot.maxChars) continue; // Try to fit smaller ones if big one fails
            slot.items.push(item);
            slot.usedChars += item.chars;
        }
        return slot;
    };

    const predicted = fillSlot("Предсказано", "🟡", "#ffd43b", predictedTarget, predictedCandidates);
    const active = fillSlot("Задачи и цели", "🟠", "#ffa94d", activeTarget, activeCandidates);
    const recent = fillSlot("Свежее", "🔵", "#4dabf7", recentTarget, recentCandidates);

    // Vault zeroed out as per user philosophy (Vault represents a tool now)
    const vault = createEmptySlot("Vault заметки", "⚪", "#e9ecef", 0);
    const tools = createEmptySlot("Инструменты", "🟣", "#c084fc", TOOLS_MAX_CHARS);

    // ── Build combined context text ──
    const parts: string[] = [];

    if (critical.items.length > 0) {
        parts.push("\n⚠️ ОБЯЗАТЕЛЬНЫЕ ЗАМЕЧАНИЯ ВЛАДЕЛЬЦА (нарушение = ошибка):");
        for (const item of critical.items) {
            parts.push(`• ${item.text}`);
        }
    }

    if (active.items.length > 0) {
        parts.push("\n📋 ТЕКУЩИЕ ЗАДАЧИ И ЦЕЛИ:");
        for (const item of active.items) {
            parts.push(`• ${item.text}`);
        }
    }

    if (recent.items.length > 0) {
        parts.push("\n📝 ИЗ ПРОШЛЫХ СЕССИЙ:");
        for (const item of recent.items) {
            parts.push(`• ${item.text}`);
        }
    }

    if (predicted.items.length > 0) {
        parts.push('\nДАННЫЕ ИЗ ХРАНИЛИЩ ("Антон Евсин" или "Антон" = ВЛАДЕЛЕЦ, остальные имена = его собеседники):');
        for (const item of predicted.items) {
            parts.push(item.text);
        }
    }

    const contextText = parts.join("\n");

    const BASE_PROMPT_CHARS = 6500;
    const totalChars = BASE_PROMPT_CHARS + TOOLS_MAX_CHARS + goldenChars + contextText.length;
    const totalTokens = Math.ceil(totalChars / 2.5);
    const maxTokens = 128000;

    logger.info(
        `[ContextManager] Allocated: critical=${critical.usedChars}, active=${active.usedChars}, predicted=${predicted.usedChars}, recent=${recent.usedChars}, total=${totalChars}ch (~${totalTokens}t)`,
    );

    return {
        totalTokens,
        maxTokens,
        percentUsed: (totalTokens / maxTokens) * 100,
        slots: { critical, active, predicted, recent, vault, tools },
        contextText,
    };
}
