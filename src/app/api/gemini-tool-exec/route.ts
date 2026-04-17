/**
 * @module /api/gemini-tool-exec
 * Executes tool calls from Gemini Live WebSocket.
 * Supports: search_knowledge, get_system_status, browse_url, save_memory, send_telegram
 */
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { saveMemory } from "@/lib/memoryStore";
import * as google from "@/lib/googleClient";
import { canCallTool, recordSuccess, recordFailure, getBlockedMessage } from "@/lib/circuitBreaker";
import { toBangkokISO } from "@/lib/timezone";

const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";
const OBSIDIAN_URL = process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY ?? "";
const TELEGRAM_URL = process.env.TELEGRAM_SERVICE_URL ?? "http://127.0.0.1:8038";

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

    // Circuit breaker check
    if (!canCallTool(tool)) {
        const msg = getBlockedMessage(tool);
        logger.warn(`[tool-exec] Circuit breaker OPEN for: ${tool}`);
        return NextResponse.json({
            result: { error: msg, blocked: true, instruction: "Скажи пользователю: 'Сервис временно недоступен. Попробуй через минуту.'" },
        });
    }

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
                    // Retry once after 500ms
                    try {
                        await new Promise(r => setTimeout(r, 500));
                        const retryRes = await fetch(`${INDEXER_URL}/search`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query, top_k: 10, source_type: sourceType || null }),
                            signal: AbortSignal.timeout(3000),
                        });
                        if (retryRes.ok) {
                            const items = await retryRes.json() as Array<{ text: string; metadata: Record<string, string> }>;
                            result = { found: items.length, results: items.map(i => i.text.slice(0, 500)).join("\n\n"), verified: true };
                        } else {
                            result = {
                                found: 0,
                                error: "INTERNAL_ERROR",
                                instruction: "Скажи пользователю: 'Сервис поиска временно недоступен. Попробуй через минуту.'",
                                verified: false,
                            };
                        }
                    } catch {
                        recordFailure(tool);
                        result = {
                            found: 0,
                            error: "INTERNAL_ERROR",
                            instruction: "Скажи пользователю: 'Сервис поиска временно недоступен. Попробуй через минуту.'",
                            verified: false,
                        };
                    }
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
                    result = { error: "Text is required", verified: false };
                    break;
                }

                try {
                    await saveMemory(userId, text, tags);
                    recordSuccess(tool);
                    result = { saved: true, text: text.slice(0, 100), verified: true, timestamp: toBangkokISO() };
                } catch (err) {
                    recordFailure(tool);
                    result = { error: `Save failed: ${err instanceof Error ? err.message : String(err)}`, verified: false, instruction: "Скажи пользователю: 'Не удалось сохранить. Попробую ещё раз.'" };
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

                // 3. Write to .antigravity/tasks/ for IDE integration
                let antigravitySaved = false;
                try {
                    const { promises: fsPromises } = await import("fs");
                    const pathMod = await import("path");
                    const tasksDir = pathMod.join(process.cwd(), ".antigravity", "tasks");
                    await fsPromises.mkdir(tasksDir, { recursive: true });
                    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    const taskFile = pathMod.join(tasksDir, `${taskId}.json`);
                    await fsPromises.writeFile(taskFile, JSON.stringify({
                        id: taskId,
                        title,
                        description,
                        priority,
                        assignee,
                        status: "pending",
                        source: "voice_assistant",
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    }, null, 2));
                    antigravitySaved = true;
                } catch { /* Filesystem write may fail */ }

                result = {
                    created: obsidianSaved || chromaSaved || antigravitySaved,
                    obsidian: obsidianSaved,
                    chromadb: chromaSaved,
                    antigravity: antigravitySaved,
                    title,
                    priority,
                    assignee,
                    message: `Задача "${title}" создана (Obsidian: ${obsidianSaved ? "✓" : "✗"}, ChromaDB: ${chromaSaved ? "✓" : "✗"}, Антигравити: ${antigravitySaved ? "✓" : "✗"}).`,
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

            // ═══ Google Workspace: seamless document interaction ═══
            case "google_docs_action": {
                const action = String(args.action ?? "");
                const fileId = String(args.file_id ?? "");
                const fileName = args.file_name as string | undefined;

                try {
                    // If file_name given but no file_id, search by name
                    let resolvedId = fileId;
                    if (!resolvedId && fileName) {
                        const files = await google.driveListFiles(fileName, 3);
                        if (files.length === 0) {
                            result = { error: `Файл "${fileName}" не найден в Google Drive` };
                            break;
                        }
                        resolvedId = files[0].id;
                    }
                    if (!resolvedId) {
                        result = { error: "Нужен file_id или file_name" };
                        break;
                    }

                    switch (action) {
                        case "read_sheet": {
                            const range = String(args.range ?? "A1:Z100");
                            const data = await google.sheetsRead(resolvedId, range);
                            result = { success: true, range: data.range, rows: data.values.length, data: data.values.slice(0, 50) };
                            break;
                        }
                        case "write_sheet": {
                            const range = String(args.range ?? "A1");
                            const values = args.values as string[][] ?? [];
                            const res = await google.sheetsWrite(resolvedId, range, values);
                            result = { success: true, updatedCells: res.updatedCells };
                            break;
                        }
                        case "append_sheet": {
                            const range = String(args.range ?? "A1");
                            const values = args.values as string[][] ?? [];
                            const res = await google.sheetsAppend(resolvedId, range, values);
                            result = { success: true, updatedCells: res.updatedCells };
                            break;
                        }
                        case "sheet_info": {
                            const info = await google.sheetsGetInfo(resolvedId);
                            result = { success: true, ...info };
                            break;
                        }
                        case "read_doc": {
                            const doc = await google.docsRead(resolvedId);
                            result = { success: true, title: doc.title, body: doc.body.slice(0, 5000) };
                            break;
                        }
                        case "insert_doc": {
                            const text = String(args.text ?? "");
                            await google.docsInsertText(resolvedId, text);
                            result = { success: true, inserted: text.length };
                            break;
                        }
                        case "replace_doc": {
                            const find = String(args.find ?? "");
                            const replaceWith = String(args.replace_with ?? "");
                            const res = await google.docsReplaceText(resolvedId, find, replaceWith);
                            result = { success: true, occurrencesChanged: res.occurrencesChanged };
                            break;
                        }
                        case "format_sheet": {
                            const requests = args.requests as Record<string, unknown>[] ?? [];
                            await google.sheetsBatchUpdate(resolvedId, requests);
                            result = { success: true, applied: requests.length };
                            break;
                        }
                        default:
                            result = { error: `Неизвестное действие: ${action}. Доступны: read_sheet, write_sheet, append_sheet, sheet_info, read_doc, insert_doc, replace_doc, format_sheet, create_doc, create_sheet` };
                    }
                } catch (err) {
                    result = { error: `Google API: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            // ═══ Create new Google Docs / Sheets ═══
            case "create_google_doc": {
                const title = String(args.title ?? "");
                const content = args.content as string | undefined;
                if (!title) {
                    result = { error: "Название документа (title) обязательно" };
                    break;
                }
                try {
                    const doc = await google.driveCreateDoc(title, content);
                    result = { success: true, id: doc.id, name: doc.name, url: doc.url, message: `Документ "${doc.name}" создан: ${doc.url}` };
                } catch (err) {
                    result = { error: `Google API: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            case "create_google_sheet": {
                const title = String(args.title ?? "");
                const values = args.values as string[][] | undefined;
                if (!title) {
                    result = { error: "Название таблицы (title) обязательно" };
                    break;
                }
                try {
                    const sheet = await google.driveCreateSheet(title, values);
                    result = { success: true, id: sheet.id, name: sheet.name, url: sheet.url, message: `Таблица "${sheet.name}" создана: ${sheet.url}` };
                } catch (err) {
                    result = { error: `Google API: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            case "google_list_files": {
                const query = args.query as string | undefined;
                try {
                    const files = await google.driveListFiles(query, 10);
                    result = {
                        success: true,
                        files: files.map(f => ({
                            id: f.id,
                            name: f.name,
                            type: f.mimeType.includes("spreadsheet") ? "sheet" : "doc",
                            modified: f.modifiedTime,
                        })),
                    };
                } catch (err) {
                    result = { error: `Drive: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            // ═══ Google Calendar: full event management ═══
            case "calendar_action": {
                const action = String(args.action ?? "");
                try {
                    switch (action) {
                        case "list_events": {
                            const timeMin = args.time_min as string | undefined;
                            const timeMax = args.time_max as string | undefined;
                            const query = args.query as string | undefined;
                            const maxResults = args.max_results as number | undefined;

                            const data = await google.calendarListEvents({
                                timeMin,
                                timeMax,
                                q: query,
                                maxResults: maxResults || 15,
                            });

                            // Format events for voice-friendly output
                            const formatted = data.events.map((ev, i) => {
                                const start = ev.start.dateTime
                                    ? new Date(ev.start.dateTime).toLocaleString("ru-RU", { timeZone: "Asia/Bangkok", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
                                    : ev.start.date || "весь день";
                                const end = ev.end.dateTime
                                    ? new Date(ev.end.dateTime).toLocaleString("ru-RU", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })
                                    : "";
                                const attendees = ev.attendees?.map(a => a.displayName || a.email).join(", ") || "";
                                const location = ev.location ? ` 📍 ${ev.location}` : "";
                                return `${i + 1}. ${start}${end ? ` — ${end}` : ""}: ${ev.summary || "(без названия)"}${location}${attendees ? ` 👥 ${attendees}` : ""}`;
                            });

                            result = {
                                success: true,
                                count: data.events.length,
                                calendar: data.summary,
                                timeZone: data.timeZone,
                                events: formatted.join("\n"),
                                raw_events: data.events.map(ev => ({
                                    id: ev.id,
                                    summary: ev.summary,
                                    start: ev.start,
                                    end: ev.end,
                                    location: ev.location,
                                    description: ev.description?.slice(0, 200),
                                    attendees: ev.attendees?.map(a => ({ name: a.displayName, email: a.email })),
                                    link: ev.htmlLink,
                                })),
                            };
                            break;
                        }
                        case "create_event": {
                            const summary = String(args.summary ?? "");
                            if (!summary) { result = { error: "Название события (summary) обязательно" }; break; }

                            const startStr = args.start as string;
                            const endStr = args.end as string;
                            const description = args.description as string | undefined;
                            const location = args.location as string | undefined;
                            const attendeeEmails = args.attendees as string[] | undefined;
                            const allDay = args.all_day as boolean | undefined;

                            const eventPayload: Parameters<typeof google.calendarCreateEvent>[0] = {
                                summary,
                                description,
                                location,
                                start: allDay ? { date: startStr } : { dateTime: startStr, timeZone: "Asia/Bangkok" },
                                end: allDay
                                    ? { date: endStr || startStr }
                                    : { dateTime: endStr || new Date(new Date(startStr).getTime() + 3600000).toISOString(), timeZone: "Asia/Bangkok" },
                                attendees: attendeeEmails?.map(email => ({ email })),
                            };

                            const created = await google.calendarCreateEvent(eventPayload);
                            result = {
                                success: true,
                                id: created.id,
                                summary: created.summary,
                                start: created.start,
                                end: created.end,
                                link: created.htmlLink,
                                message: `Событие "${created.summary}" создано: ${created.htmlLink}`,
                            };
                            break;
                        }
                        case "update_event": {
                            const eventId = String(args.event_id ?? "");
                            if (!eventId) { result = { error: "event_id обязателен" }; break; }

                            const updates: Parameters<typeof google.calendarUpdateEvent>[1] = {};
                            if (args.summary) updates.summary = String(args.summary);
                            if (args.description) updates.description = String(args.description);
                            if (args.location) updates.location = String(args.location);
                            if (args.start) updates.start = { dateTime: String(args.start), timeZone: "Asia/Bangkok" };
                            if (args.end) updates.end = { dateTime: String(args.end), timeZone: "Asia/Bangkok" };
                            if (args.status) updates.status = String(args.status);

                            const updated = await google.calendarUpdateEvent(eventId, updates);
                            result = {
                                success: true,
                                id: updated.id,
                                summary: updated.summary,
                                start: updated.start,
                                end: updated.end,
                                message: `Событие "${updated.summary}" обновлено`,
                            };
                            break;
                        }
                        case "delete_event": {
                            const eventId = String(args.event_id ?? "");
                            if (!eventId) { result = { error: "event_id обязателен" }; break; }

                            await google.calendarDeleteEvent(eventId);
                            result = { success: true, message: "Событие удалено" };
                            break;
                        }
                        case "quick_add": {
                            const text = String(args.text ?? "");
                            if (!text) { result = { error: "Текст для quick_add обязателен" }; break; }

                            const quickEvent = await google.calendarQuickAdd(text);
                            result = {
                                success: true,
                                id: quickEvent.id,
                                summary: quickEvent.summary,
                                start: quickEvent.start,
                                end: quickEvent.end,
                                link: quickEvent.htmlLink,
                                message: `Событие "${quickEvent.summary}" создано из текста`,
                            };
                            break;
                        }
                        case "get_event": {
                            const eventId = String(args.event_id ?? "");
                            if (!eventId) { result = { error: "event_id обязателен" }; break; }

                            const ev = await google.calendarGetEvent(eventId);
                            result = {
                                success: true,
                                id: ev.id,
                                summary: ev.summary,
                                description: ev.description,
                                location: ev.location,
                                start: ev.start,
                                end: ev.end,
                                attendees: ev.attendees,
                                link: ev.htmlLink,
                                status: ev.status,
                            };
                            break;
                        }
                        default:
                            result = { error: `Неизвестное действие: ${action}. Доступны: list_events, create_event, update_event, delete_event, quick_add, get_event` };
                    }
                } catch (err) {
                    result = { error: `Calendar API: ${err instanceof Error ? err.message : String(err)}` };
                }
                break;
            }

            case "calendar_list_calendars": {
                try {
                    const calendars = await google.calendarListCalendars();
                    result = {
                        success: true,
                        calendars: calendars.map(c => ({
                            id: c.id,
                            name: c.summary,
                            primary: c.primary || false,
                            timeZone: c.timeZone,
                        })),
                    };
                } catch (err) {
                    result = { error: `Calendar API: ${err instanceof Error ? err.message : String(err)}` };
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
