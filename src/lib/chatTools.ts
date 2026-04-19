/**
 * @module chatTools
 * Function calling tool definitions and execution handler.
 * Tools: save_memory, search_memory, create_zettel, web_search, telegram, google workspace
 */
import { logger } from "@/lib/logger";
import {
    saveMemory,
    searchMemories,
} from "@/lib/memoryStore";
import { writeNoteToVault } from "@/lib/vaultWriter";
import { webSearch } from "@/lib/webSearch";
import type { ToolCall } from "@/lib/providers/base";
import * as google from "@/lib/googleClient";
import { TZ } from "@/lib/timezone";

// ── Function calling tool definitions ────────────────────────

export const MEMORY_TOOLS = [
    {
        type: "function" as const,
        function: {
            name: "save_memory",
            description:
                "ОБЯЗАТЕЛЬНО вызывай эту функцию когда пользователь делится ЛЮБОЙ личной информацией: имена, клички питомцев, даты рождения, предпочтения, привычки, цели, события, здоровье, отношения, работа, хобби. Сохраняй ВСЮ информацию без исключений.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description:
                            "Краткая суть того что нужно запомнить (1-2 предложения)",
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "Теги для категоризации: preference, fact, goal, person, habit, event, idea",
                    },
                },
                required: ["text", "tags"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "search_memory",
            description:
                "Поиск в памяти по запросу. Используй когда пользователь спрашивает что ты помнишь о нём, или когда нужно найти ранее сохранённую информацию.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Поисковый запрос",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "graph_search",
            description:
                "Глубокий семантический поиск по Графу Знаний (GraphRAG Obsidian Vault). Используй для поиска сложных связей, технических логов прошлых исследований или понимания структуры проектов пользователя.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Поисковый запрос для GraphRAG",
                    },
                    mode: {
                        type: "string",
                        enum: ["local", "global", "hybrid"],
                        description: "Режим поиска (local для специфики, global для общих концепций, hybrid для баланса)"
                    }
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "create_zettel",
            description:
                "Создать структурированную заметку Zettelkasten в Obsidian. Используй когда пользователь делится идеей, инсайтом, фактом или задачей которые стоит оформить как атомарную заметку.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description:
                            "Декларативный заголовок-утверждение (НЕ существительное, а полная мысль). Пример: 'Прокрастинация возникает из-за страха неудачи, а не лени'",
                    },
                    essence: {
                        type: "string",
                        description: "Суть идеи — переформулированная мысль пользователя, понятная без контекста",
                    },
                    action: {
                        type: "string",
                        description: "Практическое применение: как использовать эту идею в действиях",
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Теги для категоризации, например: #идея, #продуктивность, #здоровье",
                    },
                    compass: {
                        type: "object",
                        properties: {
                            north: { type: "string", description: "Более широкая тема/паттерн" },
                            south: { type: "string", description: "Корневая причина / детали" },
                            east: { type: "string", description: "Контраргумент / противоречие" },
                            west: { type: "string", description: "Аналогия из другой области" },
                        },
                        required: ["north", "south", "east", "west"],
                    },
                    context: {
                        type: "string",
                        description: "Контекст диалога: в каком разговоре возникла эта мысль",
                    },
                    noteType: {
                        type: "string",
                        enum: ["idea", "fact", "task", "persona"],
                        description: "Тип заметки",
                    },
                },
                required: ["title", "essence", "action", "tags", "compass", "context", "noteType"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "web_search",
            description:
                "Поиск актуальной информации в интернете. ОБЯЗАТЕЛЬНО используй когда вопрос касается: погоды, курсов валют, новостей, спортивных результатов, текущих событий, цен, расписаний, любой информации которая может измениться со временем. НЕ выдумывай актуальные данные — всегда вызывай эту функцию.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Поисковый запрос на русском или английском языке",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "send_telegram",
            description: "Отправить сообщение в Telegram от имени пользователя. Используй это, когда пользователь просит написать кому-то или отправить сообщение.",
            parameters: {
                type: "object",
                properties: {
                    chat_name: { type: "string", description: "Имя адресата (человека или группы). Например: 'Настя', 'Рабочий чат', 'Me' (для Избранного)" },
                    text: { type: "string", description: "Текст сообщения для отправки" },
                    chat_id: { type: "number", description: "ID чата (если известно)" }
                },
                required: ["text"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "google_docs_action",
            description: "Взаимодействие с существующими Google Документами и Таблицами (Чтение, Запись, Поиск, Замена, Форматирование).",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["read_sheet", "write_sheet", "append_sheet", "sheet_info", "read_doc", "insert_doc", "replace_doc", "format_sheet"] },
                    file_id: { type: "string", description: "ID файла" },
                    file_name: { type: "string", description: "Имя файла (если ID неизвестен)" },
                    range: { type: "string", description: "Диапазон A1:B2" },
                    text: { type: "string", description: "Текст для вставки" },
                    values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Данные таблицы" },
                    find: { type: "string", description: "Текст для поиска" },
                    replace_with: { type: "string", description: "Замена текста" },
                    requests: { type: "array", items: { type: "object" }, description: "Batch запросы" }
                },
                required: ["action"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "create_google_doc",
            description: "Создать новый пустой Google Документ или документ с начальным текстом.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Название документа" },
                    content: { type: "string", description: "Начальный текст" }
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "create_google_sheet",
            description: "Создать новую Google Таблицу.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Название таблицы" },
                    values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Данные таблицы" }
                },
                required: ["title"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "google_list_files",
            description: "Поиск файлов в Google Drive (Документы и Таблицы) по имени.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Часть имени файла для поиска" }
                },
                required: [],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "calendar_action",
            description: "Управление Google Календарем (список событий, создание, редактирование, удаление).",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list_events", "create_event", "update_event", "delete_event", "quick_add"] },
                    summary: { type: "string", description: "Название события" },
                    description: { type: "string", description: "Описание события" },
                    location: { type: "string", description: "Место" },
                    start: { type: "string", description: "ISO формат (e.g. 2026-04-18T10:00:00Z)" },
                    end: { type: "string", description: "ISO формат (e.g. 2026-04-18T11:00:00Z)" },
                    time_min: { type: "string" },
                    time_max: { type: "string" },
                    query: { type: "string" },
                    max_results: { type: "number" },
                    event_id: { type: "string" },
                    attendees: { type: "array", items: { type: "string" } },
                    all_day: { type: "boolean", description: "Событие на весь день" },
                    text: { type: "string", description: "Текст для quick_add" },
                    status: { type: "string" }
                },
                required: ["action"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "calendar_list_calendars",
            description: "Показать доступные Google Календари.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    }
];

// ── Execute tool calls ───────────────────────────────────────

/**
 * Execute an array of tool calls returned by the LLM.
 * Each tool call is dispatched to the appropriate handler.
 */
export async function handleToolCalls(
    userId: string,
    toolCalls: ToolCall[],
): Promise<Array<{ role: string; tool_call_id: string; content: string }>> {
    const results: Array<{
        role: string;
        tool_call_id: string;
        content: string;
    }> = [];

    for (const tc of toolCalls) {
        try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;

            if (tc.function.name === "save_memory") {
                const text = args.text as string;
                const tags = (args.tags as string[]) ?? [];
                const memoryId = crypto.randomUUID();
                void saveMemory(userId, text, tags).catch(err =>
                    logger.error(`[Antigravity] Background saveMemory failed: ${err instanceof Error ? err.message : String(err)}`)
                );
                results.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ success: true, id: memoryId, text }),
                });
                logger.debug(`Memory queued via function call: "${text.slice(0, 50)}"`);
            } else if (tc.function.name === "search_memory") {
                const query = args.query as string;
                const found = await searchMemories(userId, query);
                results.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({
                        results: found.map((r) => ({
                            text: r.memory.text,
                            tags: r.memory.tags,
                            date: r.memory.createdAt,
                            relevance: `${(r.score * 100).toFixed(0)}%`,
                        })),
                    }),
                });
                logger.debug(`Memory search: "${query}" → ${found.length} results`);
            } else if (tc.function.name === "create_zettel") {
                const title = args.title as string;
                const essence = args.essence as string;
                const action = args.action as string;
                const tags = (args.tags as string[]) ?? [];
                const compass = args.compass as { north: string; south: string; east: string; west: string };
                const context = args.context as string;
                const noteType = args.noteType as string;

                const now = new Date();
                const TYPE_EMOJI: Record<string, string> = { idea: "💡", fact: "📚", task: "✅", persona: "👤" };
                const emoji = TYPE_EMOJI[noteType] ?? "💡";

                const markdown = `---
type: ${noteType}
tags: [${tags.map((t) => `"${t}"`).join(", ")}]
created: ${now.toISOString()}
compass: ["${compass.north}", "${compass.south}", "${compass.east}", "${compass.west}"]
---

# ${title}

${emoji} **Суть идеи**
${essence}

🛠 **Практическое применение**
${action}

🧭 **Компас Идей**
- **Север** (тема): [[${compass.north}]]
- **Юг** (причины): [[${compass.south}]]
- **Восток** (контраргументы): [[${compass.east}]]
- **Запад** (аналогии): [[${compass.west}]]

🎙 **Контекст**
> ${context}
`;
                const safeTitle = title.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 100);
                void (async () => {
                    try {
                        await writeNoteToVault(userId, safeTitle, markdown);
                        await saveMemory(userId, `Zettel: ${title} — ${essence.slice(0, 100)}`, ["zettel", noteType, ...tags.map((t) => t.replace("#", ""))]);
                    } catch (err) {
                        logger.error(`[Antigravity] Background create_zettel failed: ${err instanceof Error ? err.message : String(err)}`);
                    }
                })();

                results.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: JSON.stringify({ success: true, title: safeTitle, method: "background" }),
                });
                logger.debug(`Zettel queued: "${safeTitle}" [${noteType}]`);
            } else if (tc.function.name === "graph_search") {
                const query = args.query as string;
                const mode = (args.mode as string) || "hybrid";
                if (!query) {
                    results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Query is required" }) });
                } else {
                    try {
                        const res = await fetch("http://127.0.0.1:8011/search", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query, mode })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            results.push({
                                role: "tool",
                                tool_call_id: tc.id,
                                content: JSON.stringify({ source: "graphRAG", result: data.result, mode }),
                            });
                            logger.info(`[GraphRAG] Evaluated: "${query}" (mode: ${mode})`);
                        } else {
                            results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: `GraphRAG Server Error ${res.status}` }) });
                        }
                    } catch (e) {
                        results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: `GraphRAG Service Unreachable: ${e}` }) });
                        logger.warn(`[GraphRAG] Service is down. Starting it requires 'cd services/graph-rag && uvicorn server:app --port 8011'`);
                    }
                }
            } else if (tc.function.name === "web_search") {
                const query = args.query as string;
                if (!query) {
                    results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Query is required" }) });
                } else {
                    const searchResult = await webSearch(query);
                    results.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: JSON.stringify({
                            results: searchResult.results,
                            query: searchResult.query,
                            source: searchResult.source,
                        }),
                    });
                    logger.info(`[webSearch] Tool call: "${query}" → ${searchResult.results.length} results`);
                }
            } else if (tc.function.name === "send_telegram") {
                const chatName = String(args.chat_name ?? "");
                const text = String(args.text ?? "");
                const chatId = args.chat_id as number | undefined;

                if (!text) {
                    results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Текст обязателен" }) });
                    continue;
                }

                try {
                    const res = await fetch("http://127.0.0.1:8038/send", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_name: chatName || null,
                            chat_id: chatId || null,
                            text,
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ sent: true, recipient: data.chat_name, message_id: data.message_id }) });
                        logger.info(`[Telegram] Sent message to ${chatName}: ${text.slice(0, 30)}`);
                    } else {
                        const errData = await res.json().catch(() => ({ detail: res.statusText }));
                        results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: errData.detail ?? `Error ${res.status}` }) });
                    }
                } catch (e) {
                    results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: String(e) }) });
                }
            } else if (tc.function.name === "google_docs_action") {
                const action = String(args.action ?? "");
                const fileId = String(args.file_id ?? "");
                const fileName = args.file_name as string | undefined;

                let resolvedId = fileId;
                if (!resolvedId && fileName) {
                    const files = await google.driveListFiles(fileName, 3);
                    if (files.length > 0) resolvedId = files[0].id;
                    else {
                        results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: `Файл "${fileName}" не найден` }) });
                        continue;
                    }
                }

                if (!resolvedId) {
                    results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Нужен file_id или file_name" }) });
                    continue;
                }

                let executionResult: any = {};
                switch (action) {
                    case "read_sheet":
                        const range = String(args.range ?? "A1:Z100");
                        const data = await google.sheetsRead(resolvedId, range);
                        executionResult = { success: true, range: data.range, rows: data.values.length, data: data.values.slice(0, 50) };
                        break;
                    case "write_sheet":
                        executionResult = await google.sheetsWrite(resolvedId, String(args.range ?? "A1"), args.values as string[][] ?? []);
                        break;
                    case "append_sheet":
                        executionResult = await google.sheetsAppend(resolvedId, String(args.range ?? "A1"), args.values as string[][] ?? []);
                        break;
                    case "sheet_info":
                        executionResult = await google.sheetsGetInfo(resolvedId);
                        break;
                    case "read_doc":
                        const doc = await google.docsRead(resolvedId);
                        executionResult = { success: true, title: doc.title, body: doc.body.slice(0, 5000) };
                        break;
                    case "insert_doc":
                        await google.docsInsertText(resolvedId, String(args.text ?? ""));
                        executionResult = { success: true };
                        break;
                    case "replace_doc":
                        executionResult = await google.docsReplaceText(resolvedId, String(args.find ?? ""), String(args.replace_with ?? ""));
                        break;
                    case "format_sheet":
                        await google.sheetsBatchUpdate(resolvedId, args.requests as any ?? []);
                        executionResult = { success: true };
                        break;
                    default:
                        executionResult = { error: `Неизвестное действие: ${action}` };
                }
                results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(executionResult) });
            } else if (tc.function.name === "create_google_doc") {
                const doc = await google.driveCreateDoc(String(args.title ?? ""), args.content as string | undefined);
                results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true, id: doc.id, name: doc.name, url: doc.url }) });
            } else if (tc.function.name === "create_google_sheet") {
                const sheet = await google.driveCreateSheet(String(args.title ?? ""), args.values as string[][] | undefined);
                results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true, id: sheet.id, name: sheet.name, url: sheet.url }) });
            } else if (tc.function.name === "google_list_files") {
                const files = await google.driveListFiles(args.query as string | undefined, 10);
                results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true, files: files.map(f => ({ id: f.id, name: f.name, type: f.mimeType.includes("spreadsheet") ? "sheet" : "doc", modified: f.modifiedTime })) }) });
            } else if (tc.function.name === "calendar_action") {
                const action = String(args.action ?? "");
                let executionResult: any = {};
                switch (action) {
                    case "list_events":
                        const data = await google.calendarListEvents({
                            timeMin: args.time_min as string,
                            timeMax: args.time_max as string,
                            q: args.query as string,
                            maxResults: args.max_results as number || 15,
                        });
                        const formatted = data.events.map((ev, i) => {
                            const start = ev.start.dateTime
                                ? new Date(ev.start.dateTime).toLocaleString("ru-RU", { timeZone: "Asia/Barnaul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
                                : ev.start.date || "весь день";
                            const end = ev.end.dateTime
                                ? new Date(ev.end.dateTime).toLocaleString("ru-RU", { timeZone: "Asia/Barnaul", hour: "2-digit", minute: "2-digit" })
                                : "";
                            const attendees = ev.attendees?.map(a => a.displayName || a.email).join(", ") || "";
                            const location = ev.location ? ` 📍 ${ev.location}` : "";
                            return `${i + 1}. ${start}${end ? ` — ${end}` : ""}: ${ev.summary || "(без названия)"}${location}${attendees ? ` 👥 ${attendees}` : ""}`;
                        });
                        executionResult = { success: true, count: data.events.length, events: formatted.join("\n") };
                        break;
                    case "create_event":
                        const allDay = args.all_day as boolean | undefined;
                        const startStr = args.start as string;
                        const endStr = args.end as string;
                        const created = await google.calendarCreateEvent({
                            summary: String(args.summary ?? ""),
                            description: args.description as string,
                            location: args.location as string,
                            start: allDay ? { date: startStr } : { dateTime: startStr, timeZone: "Asia/Barnaul" },
                            end: allDay ? { date: endStr || startStr } : { dateTime: endStr || new Date(new Date(startStr).getTime() + 3600000).toISOString(), timeZone: "Asia/Barnaul" },
                            attendees: (args.attendees as string[])?.map(email => ({ email })),
                        });
                        executionResult = { success: true, id: created.id, summary: created.summary, link: created.htmlLink };
                        break;
                    case "update_event":
                        const updates: any = {};
                        if (args.summary) updates.summary = String(args.summary);
                        if (args.description) updates.description = String(args.description);
                        if (args.location) updates.location = String(args.location);
                        if (args.start) updates.start = { dateTime: String(args.start), timeZone: "Asia/Barnaul" };
                        if (args.end) updates.end = { dateTime: String(args.end), timeZone: "Asia/Barnaul" };
                        if (args.status) updates.status = String(args.status);
                        const updated = await google.calendarUpdateEvent(String(args.event_id ?? ""), updates);
                        executionResult = { success: true, id: updated.id, summary: updated.summary };
                        break;
                    case "delete_event":
                        await google.calendarDeleteEvent(String(args.event_id ?? ""));
                        executionResult = { success: true, message: "Событие удалено" };
                        break;
                    case "quick_add":
                        const quick = await google.calendarQuickAdd(String(args.text ?? ""));
                        executionResult = { success: true, id: quick.id, summary: quick.summary };
                        break;
                    default:
                        executionResult = { error: `Неизвестное действие: ${action}` };
                }
                results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(executionResult) });
            } else if (tc.function.name === "calendar_list_calendars") {
                const cals = await google.calendarListCalendars();
                results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true, calendars: cals.map(c => ({ id: c.id, summary: c.summary, primary: c.primary })) }) });
            }
        } catch (err) {
            results.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify({
                    error: err instanceof Error ? err.message : "Unknown error",
                }),
            });
        }
    }

    return results;
}
