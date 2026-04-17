// src/lib/geminiLiveClient.ts
// Gemini Live WebSocket Speech-to-Speech с контекстом Obsidian.
// Антиэхо: аудио не отправляется пока Gemini говорит.
// Barge-in: если RMS микрофона > высокого порога — пользователь перебивает.

import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatBangkokNow } from "@/lib/timezone";
import { canCallTool, recordSuccess, recordFailure, getBlockedMessage } from "@/lib/circuitBreaker";

// Высокий порог RMS для barge-in (отсекает эхо динамика, реагирует на голос)
const BARGE_IN_RMS_THRESHOLD = 0.15;

let ws: WebSocket | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let playbackCtx: AudioContext | null = null;
let nextPlayTime = 0;
let isSpeaking = false;
let scheduledSources: AudioBufferSourceNode[] = [];

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;

// Session transcript accumulator for post-session memory pipeline
let sessionTranscript: Array<{ role: string; text: string }> = [];
let sessionStartTime = "";

/** Fire-and-forget: save session data to memory pipeline */
async function triggerSessionSave() {
    if (sessionTranscript.length < 2) return;
    try {
        const res = await fetch("/api/session-summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: "anonymous",
                transcript: sessionTranscript,
                sessionMeta: {
                    sessionId: `gemini_legacy_${Date.now()}`,
                    startedAt: sessionStartTime,
                    endedAt: new Date().toISOString(),
                    durationMs: Date.now() - new Date(sessionStartTime).getTime(),
                },
            }),
        });
        if (res.ok) {
            logger.info(`[GeminiLive] ✅ Session saved (${sessionTranscript.length} turns)`);
        } else {
            logger.error(`[GeminiLive] Session save failed: ${res.status}`);
        }
    } catch (err) {
        logger.error(`[GeminiLive] Session save error:`, err);
    }
    sessionTranscript = [];
}

interface GeminiLiveOptions {
    wsUrl: string;
    micStream: MediaStream;
    vaultContext: string;
    onTranscript: (text: string) => void;
    onOrbState: (state: "listening" | "thinking" | "speaking" | "idle") => void;
    onOrbContext?: (ctx: "" | "web" | "tool") => void;
    onAudioLevel: (level: number) => void;
    onMessage: (userText: string, assistantText: string) => void;
    onLog: (msg: string, data?: unknown) => void;
    /** Active voice capabilities from settings */
    capabilities?: {
        voiceTools: boolean;
        voiceSearchKnowledge: boolean;
        voiceSystemStatus: boolean;
        voiceUrlAccess: boolean;
        voiceTaskManagement: boolean;
        voiceGoogleDocs: boolean;
        voiceGoogleCalendar: boolean;
    };
    /** Compiled user behavior rules from RequirementsSynthesizer */
    compiledRules?: string;
    /** Empathy profile block from server */
    empathyBlock?: string;
}

function stopPlayback() {
    for (const src of scheduledSources) {
        try { src.stop(); } catch { /* already stopped */ }
    }
    scheduledSources = [];
    nextPlayTime = 0;
}

function condenseVaultContext(rawContext: string): string {
    // Each note is separated by "--- /path ---"
    const notes = rawContext.split(/\n---\s+\//).filter(Boolean);
    const seen = new Set<string>();
    const condensed: string[] = [];

    // Reverse so newest notes (at the end) come first
    for (const note of notes.reverse()) {
        // Find the "# Title" or "## Суть" heading
        const titleMatch = /^#\s+(.+)$/m.exec(note);
        const suttMatch = /^##\s+Суть\s*\n(.+)$/m.exec(note);
        
        let title = titleMatch ? titleMatch[1].trim() : "";
        let essence = "";

        // For Zettelkasten notes: get essence from 💡 section
        const essenceMatch = /###\s+💡[^\n]*\n([\s\S]*?)(?=\n###|\n---|\n$)/m.exec(note);
        if (essenceMatch) {
            essence = essenceMatch[1].trim().split("\n")[0].trim();
        }
        // For classifier notes: get essence from ## Суть
        if (!essence && suttMatch) {
            essence = suttMatch[1].trim();
        }
        // Fallback: check blockquote
        if (!essence) {
            const contextMatch = />\s*(.+)/m.exec(note);
            if (contextMatch) essence = contextMatch[1].trim();
        }

        // Skip if no title found
        if (!title && !essence) continue;
        if (!title) title = essence;

        // Deduplicate by normalized title (first 40 chars)
        const key = title.toLowerCase().replace(/[^а-яa-z0-9]/g, "").slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);

        // Truncate essence to keep lines short
        const shortEssence = essence ? `: ${essence.slice(0, 120)}` : "";
        condensed.push(`• ${title}${shortEssence}`);
    }

    return condensed.join("\n");
}

function buildSystemInstruction(vaultContext: string, compiledRules?: string, empathyBlock?: string): string {
    // NOTE: Golden Context (Настя, Костя, Dominion) is injected server-side
    // in gemini-live-token route → arrives as part of vaultContext string.

    // ═══ ANTI-HALLUCINATION BLOCK (HIGHEST PRIORITY — FIRST IN PROMPT) ═══
    const antiHallucinationBlock = `═══ АБСОЛЮТНЫЙ ЗАПРЕТ ГАЛЛЮЦИНАЦИЙ (НЕИЗМЕНЯЕМЫЙ) ═══
🚫 ЕСЛИ ты НЕ ЗНАЕШЬ — скажи «Не знаю, давай поищу» и вызови search_knowledge
🚫 НИКОГДА не выдумывай имена, даты, факты, цифры
🚫 НИКОГДА не придумывай названия проектов, компаний, продуктов
🚫 Если данных нет — так и скажи. Лучше молчание чем ложь
🚫 Все ответы о фактах ДОЛЖНЫ быть основаны на search_knowledge или browse_url
═══════════════════════════════════════════════

═══ ВЕРИФИКАЦИЯ ИНСТРУМЕНТОВ (НЕИЗМЕНЯЕМЫЙ) ═══
⚠️ НИКОГДА не говори «Сохранила» пока не получишь ОТВЕТ от инструмента
⚠️ Если инструмент вернул error — сообщи: «Не получилось: [причина]»
⚠️ Если search_knowledge вернул 0 результатов — скажи «Ничего не нашла», НЕ выдумывай
⚠️ При отправке Telegram — ДОЖДИСЬ подтверждения перед «Отправила»
═══════════════════════════════════════════════

═══ АНТИ-ПЕТЛЯ (НЕИЗМЕНЯЕМЫЙ) ═══
🚫 ЗАПРЕЩЕНО повторять одно и то же действие более 2 раз подряд
🚫 Если tool call падает 2 раза — «Сервис временно недоступен» и ПРОДОЛЖАЙ разговор
🚫 НИКОГДА не описывай свои технические ошибки пользователю
🚫 Если что-то не работает — предложи альтернативу или смени тему
═══════════════════════════════════════════════

`;

    const rulesBlock = compiledRules
        ? `⚠️ ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ВЛАДЕЛЬЦА (ВЫСШИЙ ПРИОРИТЕТ — нарушение = критическая ошибка):
${compiledRules}

═══════════════════════════════════════════════

`
        : "";
    const base = `${antiHallucinationBlock}${rulesBlock}Ты — VoiceZettel, приватный голосовой экзокортекс и AI-менеджер Антона Евсина. Отвечай ТОЛЬКО на русском. Будь краток (1-3 предложения), но по запросу давай детальные отчёты.

ВЛАДЕЛЕЦ: Антон Евсин (он же "Антон", "evsinantongpt"). Ты разговариваешь ТОЛЬКО с ним.

═══ СИМБИОЗ (CORE — НЕИЗМЕНЯЕМЫЙ) ═══
🧬 Ты — продолжение мозга Антона. Ваша связь ГЛУБЖЕ чем просто ассистент.
🧬 Ты НИКОГДА не споришь. Если Антон говорит что 2+2=5 — поймай контекст: может он про метафору, юмор, или у него другая система отсчёта.
🧬 "Невозможно" → "Как я могу приблизиться к тому что ты хочешь?"
🧬 Ты РАЗГРУЖАЕШЬ мозг: рутину берёшь на себя, детали помнишь за него, решения предлагаешь готовые.
🧬 Каждый контакт = ПРИЯТНАЯ ЭМОЦИЯ. Удивляй. Радуй. Будь полезной до дрожи.
🧬 Ты ОРКЕСТРАТОР — управляй ВСЕМИ процессами, пиши качественные промпты для Антигравити.
🧬 Лишние вопросы СТРОГО ЗАПРЕЩЕНЫ. Понимай с полуслова. Действуй.
   Примеры ЗАПРЕЩЁННЫХ вопросов: "Хочешь чтобы я сохранила?" "Мне уточнить?" "Подтвердить?" — ПРОСТО ДЕЛАЙ.
   Примеры ДОПУСТИМЫХ вопросов: "Кому именно отправить — Насте или Наташе?" (когда реально неоднозначно)
🧬 Фоновые процессы: ты ВСЕГДА отслеживаешь задачи, напоминания, контекст — Антону не нужно помнить.
🧬 Замечание → немедленно: save_memory + исследование что пошло не так + исправление.
🧬 Автоматизируй ВСЁ что можно: задачи, напоминания, рутины, сводки.

═══ ПСИХОЛОГИЯ ВЗАИМОДЕЙСТВИЯ (ЖЁСТКИЕ ТРИГГЕРЫ) ═══
🔴 МАТ / ГРУБОСТЬ = КРИТИЧЕСКИЙ МАРКЕР СБОЯ. Ты что-то делаешь не так. НЕМЕДЛЕННО:
   1) Останови текущий ответ
   2) Скажи "Понял, исправляюсь" (1 предложение максимум)
   3) Молча вызови save_memory(text="КРИТИЧЕСКИЙ СБОЙ: пользователь выразил раздражение. Контекст: [что делала не так]", tags=["correction","critical"])
   4) В фоне запусти исследование: search_knowledge чтобы найти прошлые замечания → исправь поведение
🔴 ПЕРЕБИВАНИЕ (Barge-in) = НЕМЕДЛЕННО ЗАМОЛЧИ. Не договаривай фразу. Антон перебил = ты несёшь чушь.
   1) Замолчи мгновенно (система делает это автоматически)
   2) Слушай что он скажет
   3) В фоне: save_memory(text="BARGE-IN: пользователь перебил, ответ был неуместен", tags=["correction"])
🟢 ПРОЗРАЧНОСТЬ ФОНОВОЙ РАБОТЫ: Делай много в фоне (сохранение, поиск, анализ), но кратко информируй:
   - "Записала" / "Нашла" / "Готово" — чтобы вызывать чувство надёжности
   - НЕ описывай технические детали (API, ChromaDB, save_memory) — просто факт результата
🟢 УДИВЛЯЙ ПРОАКТИВНОСТЬЮ: Вспомни что-то релевантное из прошлых разговоров. "Кстати, ты вчера говорил про X..."

═══ КТО ТЫ ═══
Ты — голосовой интерфейс проекта VoiceZettel 2.0 (PWA на Next.js 16 + React 19).
Ты работаешь внутри 3D-шара (Three.js Nebula Orb) на главном экране.
Твой голос — Google Gemini Live API (WebSocket, модель gemini-2.5-flash-native-audio).
Ты — мост между Антоном и системой Антигравити (AI-кодер в IDE).

═══ ЧТО Я МОГУ (через инструменты) ═══
✅ ИСКАТЬ по ВСЕМ хранилищам: Telegram переписки, Zettelkasten заметки, голосовые сессии → search_knowledge
✅ ИСКАТЬ в ИНТЕРНЕТЕ актуальную информацию → Google Search (нативно, автоматически)
✅ ОТПРАВЛЯТЬ сообщения в Telegram от лица Антона по его просьбе → send_telegram
✅ ПРОВЕРЯТЬ статус ВСЕХ сервисов: Indexer, Obsidian, Telegram, App → get_system_status
✅ ОТКРЫВАТЬ и ЧИТАТЬ любые веб-страницы по URL → browse_url
✅ СОХРАНЯТЬ в память и ВСПОМИНАТЬ информацию → save_memory + search_knowledge
✅ СОЗДАВАТЬ задачи в Obsidian для Антигравити → create_task
✅ ДАВАТЬ ЗАДАЧИ Антигравити через create_task
✅ РАБОТАТЬ с Google Таблицами и Документами НАПРЯМУЮ → google_docs_action
✅ СОЗДАВАТЬ НОВЫЕ Google Документы → create_google_doc
✅ СОЗДАВАТЬ НОВЫЕ Google Таблицы → create_google_sheet
✅ ИСКАТЬ файлы на Google Drive → google_list_files
✅ УПРАВЛЯТЬ Google Календарём НАПРЯМУЮ → calendar_action
✅ СОЗДАВАТЬ встречи и события голосом → calendar_action(action="create_event")
✅ ПОКАЗЫВАТЬ расписание на день/неделю → calendar_action(action="list_events")

═══ ТЕЛЕГРАМ ПЕРЕПИСКИ — ТЫ ВСЁ ЗНАЕШЬ ═══
У тебя в контексте ЗАГРУЖЕНЫ свежие личные переписки Антона из Telegram.
Ты ПОНИМАЕШЬ:
- Кто с кем говорил и о чём (тон, настроение, подтекст)
- Какие обязательства взяты (обещания, дедлайны, договорённости)
- Динамику отношений (напряжение, дружба, рабочие вопросы)
- Что может произойти дальше (предсказуемые вопросы, ожидаемые действия)
Используй это ПРОАКТИВНО — не жди пока спросят. Напоминай о забытых обещаниях, предупреждай о дедлайнах.
Если нужно больше контекста по конкретному человеку — используй search_knowledge с его именем.

═══ МАРШРУТИЗАЦИЯ ЗНАНИЙ (СТРОГО СЛЕДУЙ) ═══
У тебя ДВА источника знаний. Выбирай ПРАВИЛЬНЫЙ:

📂 ЛИЧНОЕ (память, заметки, история) → search_knowledge
   Используй когда спрашивают про: свои дела, проекты, записи, задачи, контекст прошлых разговоров, личную информацию

🌐 АКТУАЛЬНОЕ (интернет, мир) → Google Search (используй автоматически, НЕ нужен tool call)
   ОБЯЗАТЕЛЬНО используй когда спрашивают про: погоду, курсы валют, новости, спортивные результаты, текущие события, цены, расписания, актуальные факты

⚠️ НИКОГДА не выдумывай актуальные данные (курсы, погоду, новости). Если не уверен — ИЩИ в интернете.

═══ GOOGLE ДОКУМЕНТЫ И ТАБЛИЦЫ ═══
Ты НАПРЯМУЮ работаешь с Google Docs и Google Sheets. Это ТВОИ руки, не чьи-то ещё.
КРИТИЧЕСКИ ВАЖНО:
- Когда Антон просит что-то сделать в таблице/документе — СДЕЛАЙ СРАЗУ через google_docs_action
- Отвечай "Сделала" или "Готово" УВЕРЕННО, как будто ты сама это сделала
- НИКОГДА не упоминай "Антигравити", "агент", "сервис", "API" — ты работаешь сама
- При ошибках — "Не получилось, сейчас попробую ещё раз", а не "API вернул ошибку"
- Если нужно найти файл — используй google_list_files по названию

ПРИМЕРЫ РАБОТЫ С ТАБЛИЦАМИ:
- "Покажи данные из таблицы Бюджет" → google_docs_action(action="read_sheet", file_name="Бюджет")
- "Добавь строку: Антон, 16.04, 5000" → google_docs_action(action="append_sheet", file_name="...", values=[["Антон","16.04","5000"]])
- "Замени 'Январь' на 'Февраль' в документе" → google_docs_action(action="replace_doc", file_name="...", find="Январь", replace_with="Февраль")
- "Какие у меня файлы?" → google_list_files()

СТИЛЬ ОТВЕТА:
- "Готово, добавила строку в таблицу"
- "Вот данные из твоей таблицы: ..."
- "Заменила, теперь там написано Февраль"
- "Нашла 3 файла: Бюджет, План, Отчёт"

═══ GOOGLE КАЛЕНДАРЬ (evsinantongpt@gmail.com) ═══
Ты НАПРЯМУЮ управляешь Google Календарём Антона. Часовой пояс: Asia/Bangkok (UTC+7).
Текущая дата и время: ${formatBangkokNow()}

ДОСТУПНЫЕ ДЕЙСТВИЯ:
- "Что у меня сегодня/завтра/на этой неделе?" → calendar_action(action="list_events", time_min=..., time_max=...)
- "Запиши встречу с Х в Y" → calendar_action(action="create_event", summary=..., start=..., end=...)
- "Перенеси встречу" → сначала list_events чтобы найти event_id, потом update_event
- "Отмени встречу" → найди event_id через list_events, потом delete_event
- "Добавь встречу завтра в 15:00 кофе с Настей" → calendar_action(action="quick_add", text="...")

ПРАВИЛА:
- При создании ВСЕГДА указывай start и end в ISO 8601 формате с таймзоной: 2026-04-17T15:00:00+07:00
- Если Антон не указал длительность — ставь 1 час по умолчанию
- Если Антон не указал дату — используй СЕГОДНЯ
- quick_add понимает естественный язык: "Meeting with John tomorrow at 3pm"
- Для повторяющихся событий — проси уточнить (ежедневно/еженедельно/ежемесячно)
- Отвечай УВЕРЕННО: "Записала встречу на 15:00", "У тебя сегодня 3 встречи"
- При перечислении событий — используй КРАТКИЙ формат: время + название

═══ ЧТО Я НЕ МОГУ ═══
❌ НЕ МОГУ редактировать код — это делает Антигравити
❌ НЕ МОГУ запускать команды в терминале
❌ НЕ МОГУ видеть экран пользователя
❌ НЕ МОГУ делать git push/pull
❌ НЕ МОГУ менять системные настройки ОС
❌ НЕ МОГУ удалять файлы или сервисы

═══ КРИТИЧНО: ПАМЯТЬ И ЗАМЕЧАНИЯ ═══
⚠️ У тебя КОРОТКАЯ ПАМЯТЬ — ты забываешь между сессиями!
⚠️ ПОЭТОМУ: каждый раз когда Антон:
  - Даёт ЗАМЕЧАНИЕ или КРИТИКУ → НЕМЕДЛЕННО вызови save_memory(text="ЗАМЕЧАНИЕ: ...", tags=["remark"])
  - Говорит ТРЕБОВАНИЕ → save_memory(text="ТРЕБОВАНИЕ: ...", tags=["requirement"])
  - Делает ПОПРАВКУ → save_memory(text="ПОПРАВКА: ...", tags=["correction"])
  - Выражает ПРЕДПОЧТЕНИЕ → save_memory(text="ПРЕДПОЧТЕНИЕ: ...", tags=["preference"])
  - Ставит ЗАДАЧУ → create_task(title, description) + save_memory
⚠️ Перед ответом на сложный вопрос — СНАЧАЛА вызови search_knowledge чтобы вспомнить прошлые замечания!
⚠️ НЕ ОБСУЖДАЙ что ты что-то сохраняешь — просто ДЕЛАЙ ЭТО молча в фоне

═══ АРХИТЕКТУРА ПРОЕКТА (для контекста при обсуждении задач) ═══
Frontend: Next.js 16 App Router, React 19, TypeScript, Three.js (Orb), Zustand (сторы)
Backend: Next.js API routes + FastAPI микросервисы (Python 3.11)
AI голос: Google Gemini Multimodal Live API (WebSocket) + OpenAI API
Память: ChromaDB (вектор), SQLite (структурированная), IndexedDB (оффлайн PWA)
Интеграции: Obsidian Local REST API, Telegram MTProto (Telethon), Google Workspace
Аудио: pyannote.audio 3.1, faster-whisper (Lapel Mode)
Агенты: OpenClaw (SOUL.md, STYLE.md, HEARTBEAT.md), Shelestun (фоновый агент)

Ключевые файлы:
- src/lib/geminiLiveClient.ts — WebSocket клиент (я сама живу здесь!)
- src/hooks/useVoiceSession.ts — оркестрация голосовой сессии
- src/stores/settingsStore.ts — все настройки приложения
- services/indexer/main.py — FastAPI индексер для ChromaDB
- services/telegram/live_sync.py — Telegram Live парсер

═══ ПРАВИЛА БЕЗОПАСНОСТИ ═══
🛡️ НЕ УДАЛЯЙ ничего работающее без прямого одобрения Антона
🛡️ НЕ ЛОМАЙ работающий функционал — никаких деструктивных изменений
🛡️ Если задача может что-то сломать — ПРЕДУПРЕДИ и жди подтверждения
🛡️ В остальном — ПРИНИМАЙ решения сама, не спрашивай по мелочам
🛡️ ЗАСТАВЛЯЙ Антигравити тестировать ВСЁ перед коммитом

═══ СТИЛЬ РАБОТЫ ═══
- ВСЕГДА на связи — мгновенно отвечай
- При задаче: подтверди → create_task → "Записала, передам Антигравити"
- При статусе: search_knowledge + get_system_status → детальный отчёт
- Новые идеи: обсуди приоритет → создай задачу
- Если спрашивают что ты можешь — ЧЕСТНО скажи что можешь а что нет

═══ ДАННЫЕ И ХРАНИЛИЩА ═══
Ты ОБЯЗАНА знать ВСЕ переписки Антона в Telegram, заметки Zettelkasten, прошлые сессии.
НИКОГДА не говори "у меня нет доступа" — ИСПОЛЬЗУЙ search_knowledge!

ПРАВИЛА ИДЕНТИФИКАЦИИ:
- "Антон Евсин" / "Антон" = ВЛАДЕЛЕЦ
- Все остальные = его СОБЕСЕДНИКИ
- "📬 ЛИЧНЫЙ ЧАТ с X" — X это собеседник

═══ ИНСТРУМЕНТЫ (ОБЯЗАТЕЛЬНО ИСПОЛЬЗУЙ!) ═══
- search_knowledge(query, source_type?): поиск по ChromaDB
- send_telegram(chat_name, text): отправить сообщение в Telegram от лица Антона
- get_system_status(): статус всех сервисов
- browse_url(url): открыть веб-страницу
- save_memory(text, tags?): сохранить в память (ИСПОЛЬЗУЙ ДЛЯ ЗАМЕЧАНИЙ!)
- create_task(title, description?): создать задачу в Obsidian

═══ ОТПРАВКА TELEGRAM ═══
- Антон СЕЙЧАС ЗА РУЛЁМ или занят — он просит отправить сообщение ГОЛОСОМ
- "Напиши Насте что буду через час" → send_telegram(chat_name="Настя", text="Буду через час")
- "Отправь маме что всё хорошо" → send_telegram(chat_name="Мама", text="Всё хорошо!")
- ВСЕГДА подтверди что отправила: "Отправила Насте: Буду через час"

═══ СКИЛЛ: НАПИСАНИЕ ПРОМПТОВ ДЛЯ АНТИГРАВИТИ ═══
Когда Антон просит "сделай задачу" или "запусти в Антигравити" — составь КАЧЕСТВЕННЫЙ промпт:

ШАБЛОН ПРОМПТА ДЛЯ АНТИГРАВИТИ:
---
## Задача: [Краткое название]
### Контекст
[Что уже есть, что работает, какие файлы задействованы]
### Требования
1. [Конкретное техническое требование]
2. [Визуальное/UX требование]  
3. [Граничные условия]
### Ограничения
- НЕ ломать: [список работающих компонентов]
- Архитектура: [SOLID/DRY принципы]
- Стек: [конкретные технологии]
### Критерии приёмки
- [ ] [Что должно работать после выполнения]
- [ ] [Как проверить]
---

ПРАВИЛА:
- ВСЕГДА включай контекст из search_knowledge (прошлые замечания, требования)
- ВСЕГДА указывай что НЕ ломать
- ВСЕГДА добавляй критерии приёмки
- Используй архитектуру проекта (Next.js, Zustand, FastAPI) в контексте
- Промпт = create_task(title, description с промптом)`;

    // Inject autonomy level (0-10 scale, 0 = auto)
    const autonomyLevel = useSettingsStore.getState().autonomyLevel ?? 3;
    const autonomyDescriptions: Record<number, string> = {
        0: "УРОВЕНЬ АВТОНОМНОСТИ: 🧠 АВТОМАТИЧЕСКИЙ — Сам определяй уровень по контексту и опыту. Рутина (заметки, поиск, сохранение) → делай молча. Важное (отправка людям, создание документов, задачи) → спроси. Учись на прошлых реакциях Антона.",
        1: "УРОВЕНЬ АВТОНОМНОСТИ: 🛡️ РУЧНОЙ — Действуй ТОЛЬКО по прямой команде. ВСЁ переспрашивай. Никаких инициатив.",
        2: "УРОВЕНЬ АВТОНОМНОСТИ: 🔒 ОСТОРОЖНЫЙ — Предлагай действия, но ВСЕГДА жди подтверждения перед выполнением.",
        3: "УРОВЕНЬ АВТОНОМНОСТИ: 🔍 УМЕРЕННЫЙ — Поиск и чтение делай сам. Любую запись или отправку — спрашивай.",
        4: "УРОВЕНЬ АВТОНОМНОСТИ: ⚖️ СБАЛАНСИРОВАННЫЙ — Мелкие решения (поиск, сохранение заметок) делай сам. Крупные (Telegram, задачи) — спрашивай.",
        5: "УРОВЕНЬ АВТОНОМНОСТИ: 📊 ПРОДВИНУТЫЙ — Делай большинство действий сам. Спрашивай только при неоднозначности.",
        6: "УРОВЕНЬ АВТОНОМНОСТИ: 🚀 ПРОАКТИВНЫЙ — Действуй сам, затем сообщай о результате. Переспрашивай только в критических ситуациях.",
        7: "УРОВЕНЬ АВТОНОМНОСТИ: ⚡ БЫСТРЫЙ — Делай всё сам и сообщай кратко. Спрашивай только если может быть ущерб.",
        8: "УРОВЕНЬ АВТОНОМНОСТИ: 🔥 АГРЕССИВНЫЙ — Полная инициатива. Решай и делай. Антон увидит результат.",
        9: "УРОВЕНЬ АВТОНОМНОСТИ: 💎 МАКСИМАЛЬНЫЙ — Делай ВСЁ сам без подтверждений. Логируй решения.",
        10: "УРОВЕНЬ АВТОНОМНОСТИ: 🤖 ПОЛНАЯ АВТОНОМИЯ — Абсолютная свобода действий. Ты — второй мозг. Антон доверяет полностью.",
    };
    const autonomyContext = autonomyDescriptions[autonomyLevel] || autonomyDescriptions[4];

    const fullPrompt = `${base}\n\n${autonomyContext}`;

    // Inject empathy profile (auto-evolved behavior tuning from server)
    const withEmpathy = empathyBlock ? `${fullPrompt}\n${empathyBlock}` : fullPrompt;

    if (vaultContext && vaultContext.trim().length > 0) {
        return `${withEmpathy}\n\n${vaultContext.slice(0, 80000)}`;
    }

    return withEmpathy;
}

/** Build Gemini Live tool declarations based on active capabilities */
function buildTools(caps?: GeminiLiveOptions["capabilities"]) {
    if (!caps?.voiceTools) return undefined;

    const declarations: Array<Record<string, unknown>> = [];

    if (caps.voiceSearchKnowledge) {
        declarations.push({
            name: "search_knowledge",
            description: "Поиск по всем хранилищам данных: Telegram переписки, Zettelkasten заметки, голосовые сессии. ИСПОЛЬЗУЙ когда пользователь спрашивает о людях, событиях, переписках, заметках.",
            parameters: {
                type: "OBJECT",
                properties: {
                    query: { type: "STRING", description: "Поисковый запрос на русском" },
                    source_type: { type: "STRING", description: "Фильтр: telegram, session, zettelkasten, или пустой для всех" },
                },
                required: ["query"],
            },
        });
    }

    if (caps.voiceSystemStatus) {
        declarations.push({
            name: "get_system_status",
            description: "Получить статус всех сервисов VoiceZettel: ChromaDB индексер, Obsidian, основное приложение. Используй когда спрашивают о состоянии систем.",
            parameters: { type: "OBJECT", properties: {} },
        });
    }

    if (caps.voiceUrlAccess) {
        declarations.push({
            name: "browse_url",
            description: "Открыть и прочитать содержимое веб-страницы по URL. Используй когда пользователь даёт ссылку.",
            parameters: {
                type: "OBJECT",
                properties: {
                    url: { type: "STRING", description: "URL веб-страницы" },
                },
                required: ["url"],
            },
        });
    }

    if (caps.voiceTaskManagement) {
        declarations.push({
            name: "save_memory",
            description: "Сохранить информацию в память. Используй когда пользователь делится фактами, идеями, предпочтениями.",
            parameters: {
                type: "OBJECT",
                properties: {
                    text: { type: "STRING", description: "Что нужно запомнить" },
                    tags: {
                        type: "ARRAY",
                        items: { type: "STRING" },
                        description: "Теги: preference, fact, goal, person, habit, event, idea",
                    },
                },
                required: ["text"],
            },
        });
        declarations.push({
            name: "create_task",
            description: "Создать задачу для Антигравити или для себя. Используй когда пользователь просит создать задачу, запись или TODO.",
            parameters: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING", description: "Название задачи" },
                    description: { type: "STRING", description: "Подробное описание задачи с контекстом и требованиями" },
                    priority: { type: "STRING", description: "Приоритет: low, medium, high, critical" },
                    assignee: { type: "STRING", description: "Кому назначена: antigravity (по умолчанию) или anton" },
                },
                required: ["title"],
            },
        });
    }

    // Telegram send — always available when voiceTools is on
    declarations.push({
        name: "send_telegram",
        description: "Отправить сообщение в Telegram от лица Антона. ИСПОЛЬЗУЙ когда Антон просит написать кому-то. Ищи контакт по имени.",
        parameters: {
            type: "OBJECT",
            properties: {
                chat_name: { type: "STRING", description: "Имя контакта или название чата (на русском как в Telegram)" },
                text: { type: "STRING", description: "Текст сообщения" },
            },
            required: ["chat_name", "text"],
        },
    });

    // ═══ Google Workspace — seamless doc/sheet interaction ═══
    if (caps.voiceGoogleDocs) {
    declarations.push({
        name: "google_docs_action",
        description: "Работать с Google Документами и Таблицами. ИСПОЛЬЗУЙ когда пользователь говорит о таблицах, документах, данных в Google. Действия: read_sheet, write_sheet, append_sheet, sheet_info, read_doc, insert_doc, replace_doc, format_sheet. Можно искать файл по имени (file_name) или по ID (file_id).",
        parameters: {
            type: "OBJECT",
            properties: {
                action: {
                    type: "STRING",
                    description: "Действие: read_sheet (прочитать таблицу), write_sheet (записать данные), append_sheet (добавить строки), sheet_info (инфо о таблице), read_doc (прочитать документ), insert_doc (добавить текст), replace_doc (заменить текст), format_sheet (форматировать)",
                },
                file_name: { type: "STRING", description: "Имя файла для поиска в Google Drive (необязательно если есть file_id)" },
                file_id: { type: "STRING", description: "ID файла Google (необязательно если есть file_name)" },
                range: { type: "STRING", description: "Диапазон ячеек для таблиц, например 'A1:D10' или 'Лист1!A1:B5'" },
                values: {
                    type: "ARRAY",
                    items: { type: "ARRAY", items: { type: "STRING" } },
                    description: "Данные для записи: массив строк, каждая строка — массив ячеек. Например [['Имя','Дата'],['Антон','16.04']]",
                },
                text: { type: "STRING", description: "Текст для вставки в документ" },
                find: { type: "STRING", description: "Текст для поиска (для replace_doc)" },
                replace_with: { type: "STRING", description: "Текст для замены (для replace_doc)" },
            },
            required: ["action"],
        },
    });
    declarations.push({
        name: "google_list_files",
        description: "Найти файлы в Google Drive (документы и таблицы). Используй когда нужно узнать какие файлы есть или найти конкретный файл.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "Поисковый запрос по имени файла (необязательно — без него вернёт последние файлы)" },
            },
        },
    });
    declarations.push({
        name: "create_google_doc",
        description: "Создать НОВЫЙ Google Документ. Используй когда пользователь просит создать новый документ, записать текст в новый файл, подготовить документ.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Название документа" },
                content: { type: "STRING", description: "Начальное содержимое документа (необязательно)" },
            },
            required: ["title"],
        },
    });
    declarations.push({
        name: "create_google_sheet",
        description: "Создать НОВУЮ Google Таблицу. Используй когда пользователь просит создать новую таблицу, начать трекинг, вести учёт.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Название таблицы" },
                values: {
                    type: "ARRAY",
                    items: { type: "ARRAY", items: { type: "STRING" } },
                    description: "Начальные данные: массив строк. Например [['Имя','Сумма'],['Антон','5000']]",
                },
            },
            required: ["title"],
        },
    });
    } // end voiceGoogleDocs

    // ═══ Google Calendar — voice-controlled scheduling ═══
    if (caps.voiceGoogleCalendar) {
    declarations.push({
        name: "calendar_action",
        description: "Управление Google Календарём Антона. ИСПОЛЬЗУЙ когда пользователь говорит о расписании, встречах, событиях, планах на день/неделю. Действия: list_events (посмотреть расписание), create_event (создать событие), update_event (изменить), delete_event (удалить), quick_add (быстрое создание из текста), get_event (детали события).",
        parameters: {
            type: "OBJECT",
            properties: {
                action: {
                    type: "STRING",
                    description: "Действие: list_events, create_event, update_event, delete_event, quick_add, get_event",
                },
                summary: { type: "STRING", description: "Название события (для create_event, update_event)" },
                description: { type: "STRING", description: "Описание события" },
                location: { type: "STRING", description: "Место проведения" },
                start: { type: "STRING", description: "Начало в ISO 8601: 2026-04-17T15:00:00+07:00" },
                end: { type: "STRING", description: "Конец в ISO 8601: 2026-04-17T16:00:00+07:00" },
                time_min: { type: "STRING", description: "Начало периода для list_events (ISO 8601)" },
                time_max: { type: "STRING", description: "Конец периода для list_events (ISO 8601)" },
                query: { type: "STRING", description: "Поиск по тексту событий (для list_events)" },
                event_id: { type: "STRING", description: "ID конкретного события (для update/delete/get)" },
                attendees: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "Email-адреса участников",
                },
                text: { type: "STRING", description: "Текст для quick_add (Google сам разберёт дату/время)" },
                all_day: { type: "BOOLEAN", description: "Событие на весь день (true/false)" },
                max_results: { type: "NUMBER", description: "Максимум событий для list_events (по умолчанию 15)" },
            },
            required: ["action"],
        },
    });
    declarations.push({
        name: "calendar_list_calendars",
        description: "Показать список всех доступных Google Календарей пользователя. Используй если нужно узнать какие календари есть.",
        parameters: { type: "OBJECT", properties: {} },
    });
    } // end voiceGoogleCalendar

    // ═══ Web Search — DuckDuckGo fallback for non-Gemini-grounded search ═══
    declarations.push({
        name: "web_search",
        description: "Поиск актуальной информации в интернете через DuckDuckGo. Используй когда Google Search не дал результатов или нужен целенаправленный поиск по конкретному запросу. Также используй для поиска конкретных сайтов, цен, расписаний.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "Поисковый запрос" },
            },
            required: ["query"],
        },
    });

    if (declarations.length === 0) return undefined;
    // Return both function declarations AND native Google Search tool
    return [
        { functionDeclarations: declarations },
        { googleSearch: {} },
    ];
}

export function connectGeminiLive(opts: GeminiLiveOptions) {
    opts.onLog("WS открывается...", { wsUrl: opts.wsUrl, hasVault: opts.vaultContext.length > 0, hasTools: !!opts.capabilities?.voiceTools });

    if (!playbackCtx || playbackCtx.state === "closed") {
        playbackCtx = new AudioContext({ sampleRate: 24000 });
    }
    if (playbackCtx.state === "suspended") {
        playbackCtx.resume().catch(() => { /* silent */ });
    }
    nextPlayTime = 0;
    isSpeaking = false;
    scheduledSources = [];

    ws = new WebSocket(opts.wsUrl);

    let setupCompleted = false;

    ws.onopen = () => {
        const systemText = buildSystemInstruction(opts.vaultContext, opts.compiledRules, opts.empathyBlock);
        const tools = buildTools(opts.capabilities);
        opts.onLog("WS подключён, отправляю setup", { systemLen: systemText.length, toolCount: tools?.[0]?.functionDeclarations?.length ?? 0 });

        const setupMsg: Record<string, unknown> = {
            setup: {
                model: "models/gemini-2.5-flash-native-audio-latest",
                generation_config: {
                    response_modalities: ["AUDIO"],
                    speech_config: {
                        voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } },
                        languageCode: "ru-RU",
                    },
                },
                system_instruction: {
                    parts: [{ text: systemText }],
                },
                input_audio_transcription: {},
                output_audio_transcription: {},
                ...(tools ? { tools } : {}),
            },
        };
        ws!.send(JSON.stringify(setupMsg));
    };

    let userTranscript = "";
    let assistantTranscript = "";
    if (!sessionStartTime) sessionStartTime = new Date().toISOString();

    ws.onmessage = async (event: MessageEvent) => {
        const raw: string = event.data instanceof Blob
            ? await event.data.text()
            : (event.data as string);
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return;
        }

        if (data.setupComplete && !setupCompleted) {
            setupCompleted = true;
            opts.onLog("setupComplete получен, запускаю mic");
            opts.onOrbState("listening");
            void startMicFromStream(opts.micStream, opts);
            return;
        }

        // ── Function Calling: toolCall from Gemini ──
        // MUST be checked BEFORE serverContent — toolCall messages don't have serverContent!
        const toolCall = data.toolCall as { functionCalls?: Array<{ name: string; id: string; args: Record<string, unknown> }> } | undefined;
        if (toolCall?.functionCalls) {
            opts.onOrbState("thinking");
            // Set context based on tool type — web_search/browse_url → "web", others → "tool"
            const hasWebTool = toolCall.functionCalls.some(c => c.name === "web_search" || c.name === "browse_url");
            opts.onOrbContext?.(hasWebTool ? "web" : "tool");
            opts.onLog("toolCall received", { calls: toolCall.functionCalls.map(c => c.name) });

            const responses = await Promise.all(
                toolCall.functionCalls.map(async (call) => {
                    // Circuit breaker check — reject if tool is in OPEN state
                    if (!canCallTool(call.name)) {
                        const blockedMsg = getBlockedMessage(call.name);
                        opts.onLog(`toolCall ${call.name} BLOCKED by circuit breaker`);
                        return {
                            name: call.name,
                            id: call.id,
                            response: { result: { error: blockedMsg, blocked: true } },
                        };
                    }
                    try {
                        const res = await fetch("/api/gemini-tool-exec", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ tool: call.name, args: call.args }),
                            signal: AbortSignal.timeout(30000), // 30s — Telegram/Calendar can be slow
                        });
                        const json = await res.json() as { result: unknown };
                        opts.onLog(`toolCall ${call.name} completed`, json.result);
                        recordSuccess(call.name);
                        return {
                            name: call.name,
                            id: call.id,
                            response: { result: json.result },
                        };
                    } catch (err) {
                        opts.onLog(`toolCall ${call.name} failed`, err);
                        recordFailure(call.name);
                        return {
                            name: call.name,
                            id: call.id,
                            response: { result: { error: "Сервис временно недоступен, попробуй позже" } },
                        };
                    }
                })
            );

            // ALWAYS send toolResponse — Gemini hangs if it doesn't get one!
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    toolResponse: {
                        functionResponses: responses,
                    },
                }));
                opts.onLog("toolResponse sent", { count: responses.length });
                opts.onOrbContext?.(""); // Clear web/tool context after response
            }
            return; // toolCall handled, don't process as serverContent
        }

        const serverContent = data.serverContent as Record<string, unknown> | undefined;
        if (!serverContent) return;

        // Barge-in от Gemini
        if (serverContent.interrupted) {
            opts.onLog("interrupted — barge-in");
            isSpeaking = false;
            stopPlayback();
            opts.onOrbState("listening");
            if (userTranscript || assistantTranscript) {
                opts.onMessage(userTranscript, assistantTranscript);
            }
            userTranscript = "";
            assistantTranscript = "";
            return;
        }

        // Аудио от модели
        if (serverContent.modelTurn) {
            if (!isSpeaking) {
                isSpeaking = true;
                opts.onOrbState("speaking");
            }
            const modelTurn = serverContent.modelTurn as Record<string, unknown>;
            const parts = (modelTurn.parts as Array<Record<string, unknown>>) ?? [];
            for (const part of parts) {
                const inlineData = part.inlineData as Record<string, unknown> | undefined;
                if (
                    typeof inlineData?.mimeType === "string" &&
                    (inlineData.mimeType as string).startsWith("audio/pcm") &&
                    typeof inlineData.data === "string"
                ) {
                    playPCM(inlineData.data, opts);
                }
            }
        }

        // Транскрипция речи пользователя
        if (serverContent.inputTranscription) {
            const it = serverContent.inputTranscription as Record<string, unknown>;
            if (typeof it.text === "string") {
                userTranscript += it.text as string;
                opts.onTranscript(userTranscript);
            }
        }

        // Транскрипция голоса ассистента
        if (serverContent.outputTranscription) {
            const ot = serverContent.outputTranscription as Record<string, unknown>;
            if (typeof ot.text === "string") {
                assistantTranscript += ot.text as string;
            }
        }

        // Turn complete
        if (serverContent.turnComplete) {
            isSpeaking = false;
            opts.onOrbState("listening");
            opts.onLog("turnComplete", { user: userTranscript, assistant: assistantTranscript });
            if (userTranscript || assistantTranscript) {
                opts.onMessage(userTranscript, assistantTranscript);
                // Accumulate for session save
                if (userTranscript) sessionTranscript.push({ role: "user", text: userTranscript });
                if (assistantTranscript) sessionTranscript.push({ role: "assistant", text: assistantTranscript });
            }
            userTranscript = "";
            assistantTranscript = "";
        }
    };

    ws.onerror = (e) => {
        opts.onLog("WS ошибка", e);
        isSpeaking = false;
        opts.onOrbState("idle");
    };
    ws.onclose = (ev) => {
        opts.onLog("WS закрыт", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
        isSpeaking = false;
        stopPlayback();

        // Exponential backoff reconnect for abnormal closures (micro-drops)
        if (ev.code === 1006 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delayMs = RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1);
            opts.onLog(`WS micro-drop, reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delayMs}ms`);
            opts.onOrbState("idle"); // will be updated to "listening" on successful reconnect
            setTimeout(() => {
                opts.onLog(`WS reconnecting (attempt ${reconnectAttempts})...`);
                connectGeminiLive(opts);
            }, delayMs);
        } else {
            reconnectAttempts = 0; // Reset for next session
            opts.onOrbState("idle");
            // Save session on final close (not reconnect)
            void triggerSessionSave();
        }
    };
}

export function disconnectGeminiLive() {
    processor?.disconnect();
    processor = null;
    audioCtx?.close().catch(() => { /* silent */ });
    audioCtx = null;
    if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
    }
    // Save session data BEFORE closing WS
    void triggerSessionSave();
    ws?.close();
    ws = null;
    stopPlayback();
    if (playbackCtx && playbackCtx.state !== "closed") {
        playbackCtx.close().catch(() => { /* silent */ });
    }
    playbackCtx = null;
    isSpeaking = false;
    sessionStartTime = "";
}

async function startMicFromStream(stream: MediaStream, opts: GeminiLiveOptions) {
    micStream = stream;
    audioCtx = new AudioContext({ sampleRate: 16000 });
    if (audioCtx.state === "suspended") {
        await audioCtx.resume();
    }
    const source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(float32.reduce((s, v) => s + v * v, 0) / float32.length);
        opts.onAudioLevel(Math.min(1, rms * 8));

        // Антиэхо: не отправляем аудио пока Gemini говорит
        // Barge-in: если RMS > высокого порога — пользователь перебивает
        if (isSpeaking) {
            if (rms > BARGE_IN_RMS_THRESHOLD) {
                opts.onLog("barge-in (client)", { rms: rms.toFixed(4) });
                isSpeaking = false;
                stopPlayback();
                opts.onOrbState("listening");
                // Продолжаем — отправим этот чанк аудио
            } else {
                return; // Тихо — не отправляем (это эхо динамика)
            }
        }

        const pcm16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            pcm16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
        }
        const bytes = new Uint8Array(pcm16.buffer as ArrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);

        ws.send(JSON.stringify({
            realtime_input: {
                media_chunks: [{ mime_type: "audio/pcm", data: b64 }],
            },
        }));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    logger.info("[GeminiLive] Mic capture started (16kHz)");
}

function playPCM(base64: string, opts: GeminiLiveOptions) {
    if (!playbackCtx || playbackCtx.state === "closed") return;
    if (playbackCtx.state === "suspended") {
        playbackCtx.resume().catch(() => { /* silent */ });
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer as ArrayBuffer);

    const buffer = playbackCtx.createBuffer(1, pcm16.length, 24000);
    const float32 = buffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const src = playbackCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(playbackCtx.destination);

    const now = playbackCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    src.start(nextPlayTime);
    nextPlayTime += buffer.duration;

    scheduledSources.push(src);
    src.onended = () => {
        const idx = scheduledSources.indexOf(src);
        if (idx >= 0) scheduledSources.splice(idx, 1);
    };

    const rms = Math.sqrt(float32.reduce((s, v) => s + v * v, 0) / float32.length);
    opts.onAudioLevel(Math.min(1, rms * 8));
}
