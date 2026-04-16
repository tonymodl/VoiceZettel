import { NextRequest, NextResponse } from "next/server";
import { loadVaultContext } from "@/lib/vaultContext";
import { logger } from "@/lib/logger";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

/**
 * Extract just title + short essence from each Zettelkasten note.
 * Deduplicates by normalized title. Returns newest first.
 */
function condenseVaultNotes(rawContext: string): string {
    const notes = rawContext.split(/\n---\s+\//).filter(Boolean);
    const seen = new Set<string>();
    const condensed: string[] = [];

    // Reverse so newest (last alphabetically / last loaded) come first
    for (const note of notes.reverse()) {
        const titleMatch = /^#\s+(.+)$/m.exec(note);
        const suttMatch = /^##\s+Суть\s*\n(.+)$/m.exec(note);
        
        let title = titleMatch ? titleMatch[1].trim() : "";
        let essence = "";

        // Zettelkasten: get from 💡 section
        const essenceMatch = /###\s+💡[^\n]*\n([\s\S]*?)(?=\n###|\n---|\n$)/m.exec(note);
        if (essenceMatch) {
            essence = essenceMatch[1].trim().split("\n")[0].trim();
        }
        // Classifier: get from ## Суть  
        if (!essence && suttMatch) {
            essence = suttMatch[1].trim();
        }
        // Fallback: blockquote
        if (!essence) {
            const ctxMatch = />\s*(.+)/m.exec(note);
            if (ctxMatch) essence = ctxMatch[1].trim();
        }

        if (!title && !essence) continue;
        if (!title) title = essence;

        // Dedup by normalized title
        const key = title.toLowerCase().replace(/[^а-яa-z0-9]/g, "").slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);

        // Just title — it already contains the key fact
        condensed.push(`• ${title}`);
    }

    return condensed.join("\n");
}

export async function POST(req: NextRequest) {
    if (!GOOGLE_GEMINI_API_KEY) {
        return NextResponse.json({
            disabled: true,
            reason: "GOOGLE_GEMINI_API_KEY не настроен. Добавьте ключ в .env для активации Gemini Live.",
        });
    }

    let userId = "anonymous";
    try {
        const body = await req.json() as { userId?: string };
        if (body.userId) userId = body.userId;
    } catch {
        // нет тела — anonymous
    }

    // Antigravity: Load vault + ChromaDB in PARALLEL
    const startMs = Date.now();
    const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";

    // Fire both vault and chroma concurrently
    const [vaultResult, chromaResult] = await Promise.allSettled([
        // Task 1: Vault notes from Obsidian
        (async () => {
            try {
                const rawVault = await loadVaultContext(userId);
                return rawVault.length > 0 ? condenseVaultNotes(rawVault) : "";
            } catch {
                return "";
            }
        })(),
        // Task 2: ChromaDB context (all queries parallel)
        (async () => {
            try {
                const queries = [
                    "личные сообщения переписка сегодня",
                    "Настя Рудакова прокси proxy запуск",
                    "последние разговоры чат telegram обсуждение",
                    "важное задачи планы работа проект",
                ];

                const queryResults = await Promise.allSettled(
                    queries.map(async (q) => {
                        const res = await fetch(`${INDEXER_URL}/search`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, top_k: 7 }),
                            signal: AbortSignal.timeout(1500),
                        });
                        if (!res.ok) return [];
                        return await res.json() as Array<{
                            text: string;
                            metadata: Record<string, string>;
                            relevance_pct: number;
                        }>;
                    })
                );

                const allResults: string[] = [];
                for (const result of queryResults) {
                    if (result.status !== "fulfilled" || !result.value) continue;
                    for (const r of result.value) {
                        const srcType = r.metadata?.source_type ?? "note";
                        const chatType = r.metadata?.chat_type ?? "";
                        const title = r.metadata?.title ?? "";
                        const date = r.metadata?.date ?? "";

                        let label = "";
                        if (srcType === "telegram") {
                            if (chatType === "private") {
                                label = `📬 ЛИЧНЫЙ ЧАТ с "${title}" (${date})`;
                            } else if (chatType === "group" || chatType === "supergroup") {
                                label = `📬 ГРУППА "${title}" (${date})`;
                            } else if (chatType === "channel") {
                                label = `📬 КАНАЛ "${title}" (${date})`;
                            } else {
                                label = `📬 Telegram "${title}" (${date})`;
                            }
                        } else if (srcType === "session") {
                            label = `📝 Сессия с ассистентом (${date})`;
                        } else {
                            label = `🗃 Заметка "${title}"`;
                        }

                        allResults.push(`${label}:\n${r.text.slice(0, 400)}`);
                    }
                }

                if (allResults.length > 0) {
                    return "\n\nДАННЫЕ ИЗ ХРАНИЛИЩ (\"Антон Евсин\" или \"Антон\" = ВЛАДЕЛЕЦ, остальные имена = его собеседники):\n\n" + allResults.slice(0, 12).join("\n\n");
                }
                return "";
            } catch {
                return "";
            }
        })(),
    ]);

    const condensedVault = vaultResult.status === "fulfilled" ? vaultResult.value : "";
    const chromaContext = chromaResult.status === "fulfilled" ? chromaResult.value : "";

    // Объединяем контексты
    const fullContext = condensedVault + chromaContext;

    // WS URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const wsUrl = appUrl
        ? `${appUrl.replace("http://", "ws://").replace("https://", "wss://")}/ws-gemini`
        : "ws://localhost:3099";

    const elapsedMs = Date.now() - startMs;

    // eslint-disable-next-line no-console
    console.log(`[GeminiLiveToken] userId=${userId}, vault=${condensedVault.length}ch, chroma=${chromaContext.length}ch, total=${fullContext.length}ch, ${elapsedMs}ms`);

    logger.info(`[GeminiLiveToken] userId=${userId}, vault=${condensedVault.length}, chroma=${chromaContext.length}, ${elapsedMs}ms`);

    return NextResponse.json({ wsUrl, vaultContext: fullContext });
}
