/**
 * @module /api/gemini-tool-exec
 * Executes tool calls from Gemini Live WebSocket.
 * Supports: search_knowledge, get_system_status, browse_url, save_memory, send_telegram
 */
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { saveMemory } from "@/lib/memoryStore";

const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";
const OBSIDIAN_URL = process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY ?? "";
const TELEGRAM_URL = process.env.TELEGRAM_SERVICE_URL ?? "http://127.0.0.1:8035";

interface ToolExecRequest {
    tool: string;
    args: Record<string, unknown>;
    userId?: string;
}

export async function POST(req: NextRequest) {
    let body: ToolExecRequest;
    try {
        body = await req.json() as ToolExecRequest;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { tool, args, userId = "anonymous" } = body;
    const startMs = Date.now();

    try {
        let result: unknown;

        switch (tool) {
            case "search_knowledge": {
                const query = String(args.query ?? "");
                const sourceType = args.source_type as string | undefined;
                if (!query) {
                    result = { error: "Query is required" };
                    break;
                }

                // Try hybrid search first, fallback to vector
                const endpoint = "/search/hybrid";
                try {
                    const res = await fetch(`${INDEXER_URL}${endpoint}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            query,
                            top_k: 10,
                            source_type: sourceType || null,
                        }),
                        signal: AbortSignal.timeout(3000),
                    });
                    if (res.ok) {
                        const items = await res.json() as Array<{
                            text: string;
                            metadata: Record<string, string>;
                            relevance_pct: number;
                        }>;
                        // Format results for LLM consumption
                        const formatted = items.map((item, i) => {
                            const src = item.metadata?.source_type ?? "note";
                            const title = item.metadata?.title ?? "";
                            const date = item.metadata?.date ?? "";
                            const chatType = item.metadata?.chat_type ?? "";
                            let label = "";
                            if (src === "telegram") {
                                if (chatType === "private") label = `📬 ЛИЧНЫЙ ЧАТ с "${title}"`;
                                else if (chatType === "group" || chatType === "supergroup") label = `📬 ГРУППА "${title}"`;
                                else label = `📬 Telegram "${title}"`;
                                if (date) label += ` (${date})`;
                            } else if (src === "session") {
                                label = `📝 Сессия (${date})`;
                            } else {
                                label = `🗃 ${title}`;
                            }
                            return `[${i + 1}] ${label} (${item.relevance_pct}%):\n${item.text.slice(0, 500)}`;
                        });
                        result = {
                            found: items.length,
                            results: formatted.join("\n\n"),
                        };
                    } else {
                        // Fallback to basic search
                        const fallbackRes = await fetch(`${INDEXER_URL}/search`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query, top_k: 10, source_type: sourceType || null }),
                            signal: AbortSignal.timeout(3000),
                        });
                        if (fallbackRes.ok) {
                            const items = await fallbackRes.json() as Array<{ text: string; metadata: Record<string, string> }>;
                            result = { found: items.length, results: items.map(i => i.text.slice(0, 500)).join("\n\n") };
                        } else {
                            result = { found: 0, error: "Indexer unavailable" };
                        }
                    }
                } catch {
                    result = { found: 0, error: "Indexer service not running" };
                }
                break;
            }

            case "get_system_status": {
                const statuses: Record<string, unknown> = {};

                // Check all services in parallel
                const checks = await Promise.allSettled([
                    fetch(`${INDEXER_URL}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()),
                    fetch(`${INDEXER_URL}/stats`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()),
                    fetch(`${OBSIDIAN_URL}`, {
                        headers: OBSIDIAN_KEY ? { Authorization: `Bearer ${OBSIDIAN_KEY}` } : {},
                        signal: AbortSignal.timeout(1500),
                    }).then(r => ({ status: r.ok ? "ok" : "error", code: r.status })),
                    fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(1500) }).then(r => r.json()),
                    fetch(`${TELEGRAM_URL}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()),
                ]);

                statuses.indexer = checks[0].status === "fulfilled" ? checks[0].value : { status: "offline" };
                statuses.indexer_stats = checks[1].status === "fulfilled" ? checks[1].value : { status: "offline" };
                statuses.obsidian = checks[2].status === "fulfilled" ? checks[2].value : { status: "offline" };
                statuses.voicezettel = checks[3].status === "fulfilled" ? checks[3].value : { status: "offline" };
                statuses.telegram = checks[4].status === "fulfilled" ? checks[4].value : { status: "offline" };

                result = statuses;
                break;
            }

            case "browse_url": {
                const url = String(args.url ?? "");
                if (!url || !url.startsWith("http")) {
                    result = { error: "Valid URL required" };
                    break;
                }

                try {
                    const res = await fetch(url, {
                        headers: { "User-Agent": "VoiceZettel/1.0" },
                        signal: AbortSignal.timeout(5000),
                    });
                    const html = await res.text();
                    // Extract text content (strip HTML tags)
                    const text = html
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                        .replace(/<[^>]+>/g, " ")
                        .replace(/\s{2,}/g, " ")
                        .trim()
                        .slice(0, 3000);

                    result = {
                        url,
                        title: (html.match(/<title[^>]*>(.*?)<\/title>/i) ?? [])[1] ?? "",
                        status: res.status,
                        content: text,
                    };
                } catch (err) {
                    result = { error: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            case "save_memory": {
                const text = String(args.text ?? "");
                const tags = (args.tags as string[]) ?? ["voice"];
                if (!text) {
                    result = { error: "Text is required" };
                    break;
                }

                try {
                    await saveMemory(userId, text, tags);
                    result = { saved: true, text: text.slice(0, 100) };
                } catch (err) {
                    result = { error: `Save failed: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            case "create_task": {
                const title = String(args.title ?? "");
                const description = String(args.description ?? "");
                const priority = String(args.priority ?? "medium");
                const assignee = String(args.assignee ?? "antigravity");

                if (!title) {
                    result = { error: "Title is required" };
                    break;
                }

                // 1. Save as Obsidian note
                let obsidianSaved = false;
                try {
                    const content = `# ${title}\n\n${description}\n\n**Приоритет:** ${priority}\n**Назначено:** ${assignee}\n\n---\n*Создано голосом через VoiceZettel*`;
                    const notePath = `Tasks/${title.replace(/[/\\:*?"<>|]/g, "_")}.md`;
                    const res = await fetch(`${OBSIDIAN_URL}/vault/${notePath}`, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "text/markdown",
                            ...(OBSIDIAN_KEY ? { Authorization: `Bearer ${OBSIDIAN_KEY}` } : {}),
                        },
                        body: content,
                        signal: AbortSignal.timeout(3000),
                    });
                    obsidianSaved = res.ok;
                } catch { /* Obsidian may be offline */ }

                // 2. Save to ChromaDB via Tasks API
                let chromaSaved = false;
                try {
                    const baseUrl = req.nextUrl.origin;
                    const res = await fetch(`${baseUrl}/api/tasks`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title, description, priority, assignee, userId }),
                        signal: AbortSignal.timeout(5000),
                    });
                    chromaSaved = res.ok;
                } catch { /* ChromaDB may be offline */ }

                result = {
                    created: obsidianSaved || chromaSaved,
                    obsidian: obsidianSaved,
                    chromadb: chromaSaved,
                    title,
                    priority,
                    assignee,
                    message: `Задача "${title}" создана (Obsidian: ${obsidianSaved ? "✓" : "✗"}, ChromaDB: ${chromaSaved ? "✓" : "✗"}).`,
                };
                break;
            }

            case "send_telegram": {
                const chatName = String(args.chat_name ?? "");
                const text = String(args.text ?? "");
                const chatId = args.chat_id as number | undefined;

                if (!text) {
                    result = { error: "Текст сообщения обязателен" };
                    break;
                }
                if (!chatName && !chatId) {
                    result = { error: "Укажите имя контакта (chat_name) или ID чата" };
                    break;
                }

                try {
                    const res = await fetch(`${TELEGRAM_URL}/send`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_name: chatName || null,
                            chat_id: chatId || null,
                            text,
                        }),
                        signal: AbortSignal.timeout(5000),
                    });
                    if (res.ok) {
                        const data = await res.json() as { chat_name: string; message_id: number };
                        result = {
                            sent: true,
                            recipient: data.chat_name,
                            message_id: data.message_id,
                        };
                    } else {
                        const errBody = await res.json().catch(() => ({ detail: res.statusText })) as { detail?: string };
                        result = { error: errBody.detail ?? `Ошибка ${res.status}` };
                    }
                } catch (err) {
                    result = { error: `Telegram сервис недоступен: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            default:
                result = { error: `Unknown tool: ${tool}` };
        }

        const elapsedMs = Date.now() - startMs;
        logger.info(`[ToolExec] ${tool} completed in ${elapsedMs}ms`);

        return NextResponse.json({ result, elapsed_ms: elapsedMs });
    } catch (err) {
        logger.error(`[ToolExec] ${tool} error:`, err instanceof Error ? err.message : String(err));
        return NextResponse.json({ result: { error: "Internal error" }, elapsed_ms: Date.now() - startMs });
    }
}
