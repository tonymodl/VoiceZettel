/**
 * @module goldenContext
 * "Golden Context" — the hardcoded inner circle of people that MUST always be
 * present in the AI system prompt. This block is injected into the `critical`
 * slot and is NEVER evicted from the context window.
 *
 * Data sources:
 *  1. Static list below (manually curated by the user)
 *  2. Dynamic enrichment from /api/dunbar/list (optional, if available)
 *
 * The block occupies ~1500 chars (~600 tokens) — well within the critical slot budget.
 */

import { logger } from "@/lib/logger";
import { buildInvestorContextBlock, getInvestorContextChars } from "@/lib/investorContext";

// ── Types ────────────────────────────────────────────────────

export interface GoldenPerson {
    name: string;
    relation: string;
    circle: 1 | 2 | 3;
    role?: string;        // business role or context
    channels?: string[];  // telegram, phone, meet
    notes?: string;       // extra context for the AI
    /** Alternative names / Telegram folder names for fuzzy matching */
    aliases?: string[];
    /** Pronunciation hint for voice output (how the AI should say the name) */
    pronunciation?: string;
}

// ── Static Inner Circle (NEVER changes without user approval) ──

export const GOLDEN_CIRCLE: GoldenPerson[] = [
    // ═══ Circle 1 — Ядро (самые близкие) ═══
    {
        name: "Настя Рудакова",
        relation: "жена",
        circle: 1,
        role: "Жена Антона. Также участвует в бизнесе Dominion.",
        channels: ["telegram", "phone", "meet"],
        notes: "Обращаться с уважением и теплотой. Часто обсуждают бизнес и быт вместе.",
        aliases: ["Убн Настя", "Настюша", "Анастасия", "Настя"],
        pronunciation: "На́стя Рудако́ва",
    },
    {
        name: "Константин Денисенко",
        relation: "инвестор",
        circle: 1,
        role: "Ключевой инвестор. Бизнес-партнёр. Связан с Lixiang (авто).",
        channels: ["telegram", "phone", "meet"],
        notes: "Важнейший деловой контакт. Все финансовые вопросы — через него. Секретарь: Анна.",
        aliases: ["Константин Денисенко Lixiang", "Костя", "Костян", "Константин"],
        pronunciation: "Константи́н Денисе́нко",
    },
    {
        name: "Мама (Мама Смартфон Билайн)",
        relation: "мама",
        circle: 1,
        channels: ["phone", "telegram"],
        notes: "Мама Антона.",
        aliases: ["Мама Смартфон Билайн", "Мама", "Мамочка"],
        pronunciation: "Ма́ма",
    },
    {
        name: "Pavel Evsin",
        relation: "брат",
        circle: 1,
        channels: ["telegram", "phone"],
        notes: "Родной брат Антона.",
        aliases: ["Паша", "Павел", "Брат"],
        pronunciation: "Па́вел Евси́н",
    },

    // ═══ Circle 2 — Команда Dominion 2.0 (сотрудники) ═══
    {
        name: "Денис 3D",
        relation: "сотрудник",
        circle: 2,
        role: "3D-дизайнер, разрабатывает корпуса и детали для продуктов Dominion.",
        channels: ["telegram"],
        notes: "Команда Dominion 2.0. Обсуждает прототипы, 3D-модели.",
        aliases: ["Денис", "Дениска"],
        pronunciation: "Дени́с",
    },
    {
        name: "Тришин Владислав (Влад)",
        relation: "сотрудник",
        circle: 2,
        role: "Инженер-электронщик, прошивки, платы, программирование.",
        channels: ["telegram"],
        notes: "Команда Dominion 2.0. Отвечает за электронику и прошивки. Часто спрашивает про ЗП.",
        aliases: ["ВЛАД СВИТЕР", "Влад", "Владислав", "Тришин"],
        pronunciation: "Влад",
    },
    {
        name: "Magikanen Александр ИИ",
        relation: "сотрудник",
        circle: 2,
        role: "Специалист по ИИ в команде Dominion. Он же Санёк.",
        channels: ["telegram"],
        notes: "Команда Dominion 2.0. Санёк — специалист по ИИ.",
        aliases: ["Санёк", "Саня", "Александр", "Саша ИИ"],
        pronunciation: "Санёк",
    },

    // ═══ Circle 3 — Деловые контакты ═══
    {
        name: "Анна (Секретарь Константина)",
        relation: "бухгалтер инвестора",
        circle: 3,
        role: "Бухгалтер и секретарь Константина Денисенко.",
        channels: ["telegram"],
        notes: "Все документы и финансовая отчётность — через Анну.",
        aliases: ["Анна секретарь", "Аня Костина"],
        pronunciation: "А́нна",
    },
];

// ── Builders ─────────────────────────────────────────────────

/**
 * Build the golden context block for injection into the system prompt.
 * This is a compact markdown block that fits in ~1500 chars.
 */
export function buildGoldenContextBlock(): string {
    const lines: string[] = [
        "",
        "═══════════════════════════════════════════════",
        "БЛИЖНИЙ КРУГ — НИКОГДА НЕ ЗАБЫВАЙ ЭТИХ ЛЮДЕЙ",
        "═══════════════════════════════════════════════",
        "",
    ];

    const byCircle = new Map<number, GoldenPerson[]>();
    for (const p of GOLDEN_CIRCLE) {
        const arr = byCircle.get(p.circle) ?? [];
        arr.push(p);
        byCircle.set(p.circle, arr);
    }

    const circleLabels: Record<number, string> = {
        1: "🔴 ЯДРО (самые близкие)",
        2: "🟠 КОМАНДА DOMINION",
        3: "🟡 ДЕЛОВЫЕ КОНТАКТЫ",
    };

    for (const [circle, label] of Object.entries(circleLabels)) {
        const people = byCircle.get(Number(circle));
        if (!people || people.length === 0) continue;

        lines.push(`### ${label}`);
        for (const p of people) {
            let line = `• **${p.name}** — ${p.relation}`;
            if (p.role) line += ` | ${p.role}`;
            if (p.notes) line += ` | ${p.notes}`;
            lines.push(line);
        }
        lines.push("");
    }

    lines.push("Когда пользователь упоминает любое из этих имён — ты ОБЯЗАН знать кто это.");
    lines.push("Если спрашивают «кто такая Настя?» — отвечай: «Настя Рудакова, твоя жена».");
    lines.push("Если спрашивают про Влада или Дениса — это сотрудники Dominion.");
    lines.push("Если спрашивают про Санька — это Magikanen Александр, специалист по ИИ в Dominion.");
    lines.push("");

    // Alias lookup table for voice recognition
    lines.push("### 🎙 АЛИАСЫ (распознавание голоса)");
    for (const p of GOLDEN_CIRCLE) {
        if (p.aliases && p.aliases.length > 0) {
            lines.push(`• ${p.aliases.join(" / ")} → **${p.name}** (${p.relation})`);
        }
    }
    lines.push("═══════════════════════════════════════════════");
    lines.push("");

    // Append investor context (Костя/Константин Денисенко) if available
    const investorBlock = buildInvestorContextBlock();
    if (investorBlock) {
        lines.push(investorBlock);
    }

    return lines.join("\n");
}

/**
 * Try to dynamically enrich the golden context from the Dunbar API.
 * Falls back to static data if the API is unavailable.
 * This runs server-side only.
 */
export async function loadDynamicGoldenContext(): Promise<string> {
    try {
        // Try to fetch additional people from Dunbar API
        const res = await fetch("http://127.0.0.1:3000/api/dunbar/list?userId=anonymous", {
            signal: AbortSignal.timeout(3000),
        });

        if (res.ok) {
            const data = await res.json() as {
                people?: Array<{ name: string; relation: string; circle: number; notes: string }>;
            };

            if (data.people && data.people.length > 0) {
                // Merge dynamic people with static (static takes priority)
                const staticNames = new Set(GOLDEN_CIRCLE.map((p) => p.name.toLowerCase()));
                const dynamicPeople = data.people.filter(
                    (p) => !staticNames.has(p.name.toLowerCase()) && p.circle <= 2,
                );

                if (dynamicPeople.length > 0) {
                    const extra = dynamicPeople
                        .slice(0, 10) // Max 10 extra people
                        .map((p) => `• ${p.name} — ${p.relation} | ${p.notes || ""}`)
                        .join("\n");

                    return buildGoldenContextBlock() + `\n### 🔵 ДОПОЛНИТЕЛЬНО (из памяти)\n${extra}\n`;
                }
            }
        }
    } catch (err) {
        logger.debug(`[GoldenContext] Dynamic load skipped: ${err instanceof Error ? err.message : "unknown"}`);
    }

    return buildGoldenContextBlock();
}

/**
 * Get the character count of the golden context block.
 * Used for context budget calculations.
 */
export function getGoldenContextChars(): number {
    return buildGoldenContextBlock().length;
}

/**
 * Get the character count of the investor context alone.
 * Used for dashboard/budget display.
 */
export function getInvestorContextCharsCount(): number {
    return getInvestorContextChars();
}

/**
 * Compact voice-optimized context block.
 * Used when context budget is tight (e.g., voice-only sessions).
 * ~400 chars instead of ~1500.
 */
export function getGoldenContextForVoice(): string {
    const lines: string[] = ["БЛИЖНИЙ КРУГ:"];
    for (const p of GOLDEN_CIRCLE.filter(p => p.circle <= 2)) {
        const pron = p.pronunciation ? ` [${p.pronunciation}]` : "";
        lines.push(`• ${p.name}${pron} — ${p.relation}`);
    }
    return lines.join("\n");
}
