import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
    loadCriticalMemories,
    loadActiveMemories,
    loadSessionSummaries,
} from "@/lib/contextManager";
import { loadVaultNotes } from "@/lib/vaultContext";
import { getGoldenContextChars } from "@/lib/goldenContext";

/**
 * GET /api/context-summary
 * Returns the current context window composition for visualization.
 * Slot maxChars are dynamically calculated from CONTEXT_BUDGET + priorities.
 * 
 * Accepts optional query params for priorities:
 *   ?critical=28&active=14&predicted=16&recent=14&vault=15&tools=13
 */
export async function GET(req: NextRequest) {
    const userId = "anonymous"; // TODO: get from session

    try {
        const critical = loadCriticalMemories(userId);
        const active = loadActiveMemories(userId);
        const sessions = loadSessionSummaries(userId);

        // Load real vault notes
        let vaultNotes: Array<{ title: string; content: string }> = [];
        try {
            vaultNotes = await loadVaultNotes(userId);
        } catch {
            logger.warn("[ContextSummary] Failed to load vault notes");
        }
        const vaultChars = vaultNotes.reduce((sum, n) => sum + n.title.length + n.content.length, 0);
        const vaultItemCount = vaultNotes.length;

        // Golden context (inner circle — always present)
        const goldenChars = getGoldenContextChars();
        let goldenPersonCount = 0;
        try {
            const { loadDynamicGoldenContext } = await import("@/lib/goldenContext");
            const g = await loadDynamicGoldenContext();
            goldenPersonCount = g.length;
        } catch { }

        // Match the real CONTEXT_BUDGET used in gemini-live-token
        const CONTEXT_BUDGET = 80000;
        const BASE_PROMPT_CHARS = 6500;
        const TOOL_DECL_CHARS = 4000;

        // Read priorities from query params or use defaults
        const sp = req.nextUrl.searchParams;
        const priorities = {
            critical: parseInt(sp.get("critical") ?? "28", 10),
            active: parseInt(sp.get("active") ?? "14", 10),
            predicted: parseInt(sp.get("predicted") ?? "16", 10),
            recent: parseInt(sp.get("recent") ?? "14", 10),
            vault: parseInt(sp.get("vault") ?? "15", 10),
            tools: parseInt(sp.get("tools") ?? "13", 10),
        };

        // Dynamic slot budgets
        const slotBudgets = {
            critical: Math.floor(CONTEXT_BUDGET * (priorities.critical / 100)),
            active: Math.floor(CONTEXT_BUDGET * (priorities.active / 100)),
            predicted: Math.floor(CONTEXT_BUDGET * (priorities.predicted / 100)),
            recent: Math.floor(CONTEXT_BUDGET * (priorities.recent / 100)),
            vault: Math.floor(CONTEXT_BUDGET * (priorities.vault / 100)),
            tools: Math.floor(CONTEXT_BUDGET * (priorities.tools / 100)),
        };

        // Estimate sizes (golden context is part of critical slot)
        const criticalChars = goldenChars + critical.reduce((sum, i) => sum + i.chars, 0);
        const activeChars = active.reduce((sum, i) => sum + i.chars, 0);
        const sessionChars = sessions.reduce((sum, i) => sum + i.chars, 0);

        const totalChars = BASE_PROMPT_CHARS + TOOL_DECL_CHARS + criticalChars + activeChars + sessionChars + Math.min(vaultChars, slotBudgets.vault);
        const totalTokens = Math.ceil(totalChars / 2.5);
        const maxTokens = 128000;

        return NextResponse.json({
            totalTokens,
            maxTokens,
            percentUsed: (totalTokens / maxTokens) * 100,
            slots: {
                critical: {
                    name: "Замечания + Ближний круг",
                    emoji: "🔴",
                    color: "#ff6b6b",
                    usedChars: criticalChars,
                    maxChars: slotBudgets.critical,
                    itemCount: critical.length + 1, // +1 for golden context
                    items: [
                        {
                            id: "golden_context",
                            text: `🛡 Ближний круг: ${goldenPersonCount} персон (${goldenChars} символов) — НИКОГДА не вытесняется`,
                            tags: ["golden", "inner-circle", "never-evict"],
                            createdAt: new Date().toISOString(),
                            score: 1.0,
                        },
                        ...critical.map((i) => ({
                            id: i.id,
                            text: i.text.slice(0, 200),
                            tags: i.tags,
                            createdAt: i.createdAt,
                            score: i.score,
                        })),
                    ],
                },
                active: {
                    name: "Задачи и цели",
                    emoji: "🟠",
                    color: "#ffa94d",
                    usedChars: activeChars,
                    maxChars: slotBudgets.active,
                    itemCount: active.length,
                    items: active.map((i) => ({
                        id: i.id,
                        text: i.text.slice(0, 200),
                        tags: i.tags,
                        createdAt: i.createdAt,
                        score: i.score,
                    })),
                },
                predicted: {
                    name: "Предсказано",
                    emoji: "🟡",
                    color: "#ffd43b",
                    usedChars: 0,
                    maxChars: slotBudgets.predicted,
                    itemCount: 0,
                    items: [],
                },
                recent: {
                    name: "Свежее",
                    emoji: "🔵",
                    color: "#4dabf7",
                    usedChars: sessionChars,
                    maxChars: slotBudgets.recent,
                    itemCount: sessions.length,
                    items: sessions.map((i) => ({
                        id: i.id,
                        text: i.text.slice(0, 200),
                        tags: i.tags,
                        createdAt: i.createdAt,
                        score: i.score,
                    })),
                },
                vault: {
                    name: "Vault заметки",
                    emoji: "⚪",
                    color: "#e9ecef",
                    usedChars: Math.min(vaultChars, slotBudgets.vault),
                    maxChars: slotBudgets.vault,
                    itemCount: vaultItemCount,
                    items: vaultNotes.slice(0, 15).map((n, i) => ({
                        id: `vault_${i}`,
                        text: `📄 ${n.title}: ${n.content.slice(0, 150)}`,
                        tags: ["vault"],
                        createdAt: new Date().toISOString(),
                        score: 0.3,
                    })),
                },
                tools: {
                    name: "Инструменты",
                    emoji: "🟣",
                    color: "#c084fc",
                    usedChars: TOOL_DECL_CHARS,
                    maxChars: slotBudgets.tools,
                    itemCount: 12,
                    items: [],
                },
                basePrompt: {
                    name: "Системный промпт",
                    emoji: "⚙️",
                    color: "#94a3b8",
                    usedChars: BASE_PROMPT_CHARS,
                    maxChars: BASE_PROMPT_CHARS,
                    itemCount: 1,
                    items: [],
                },
            },
        });
    } catch (err) {
        logger.error(`[ContextSummary] Error: ${err}`);
        return NextResponse.json({ error: "Failed to load context summary" }, { status: 500 });
    }
}

