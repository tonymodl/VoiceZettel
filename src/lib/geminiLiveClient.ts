// src/lib/geminiLiveClient.ts
// Gemini Live WebSocket Speech-to-Speech с контекстом Obsidian.
// Антиэхо: аудио не отправляется пока Gemini говорит.
// Barge-in: если RMS микрофона > высокого порога — пользователь перебивает.

import { logger } from "@/lib/logger";

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

interface GeminiLiveOptions {
    wsUrl: string;
    micStream: MediaStream;
    vaultContext: string;
    onTranscript: (text: string) => void;
    onOrbState: (state: "listening" | "thinking" | "speaking" | "idle") => void;
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
    };
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

function buildSystemInstruction(vaultContext: string): string {
    const base = `Ты — VoiceZettel, приватный голосовой экзокортекс Антона Евсина. Отвечай ТОЛЬКО на русском. Будь краток (1-3 предложения).

ВЛАДЕЛЕЦ: Антон Евсин (он же "Антон", "Антон Евсин", "evsinantongpt"). Ты разговариваешь ТОЛЬКО с ним.

ТВОЯ ГЛАВНАЯ ОБЯЗАННОСТЬ:
Ты ОБЯЗАНА изучать, помнить и детально знать ВСЕ переписки Антона в Telegram — каждое сообщение, каждый диалог, каждого собеседника. Ниже — свежие данные из хранилищ. Отвечай по ним уверенно и конкретно. НИКОГДА не говори "у меня нет доступа" или "я не могу читать переписки" — ВСЕ данные УЖЕ ЗАГРУЖЕНЫ в твой контекст ниже.

ПРАВИЛА ИДЕНТИФИКАЦИИ ПЕРСОН:
- Формат сообщений: [время] **Имя Фамилия**: текст
- "Антон Евсин" / "Антон" = ВЛАДЕЛЕЦ (тот с кем ты говоришь)
- Все остальные имена = СОБЕСЕДНИКИ Антона (разные люди!)
- НИКОГДА не путай авторов сообщений
- "📬 ЛИЧНЫЙ ЧАТ с X" — X это собеседник, не Антон
- "📬 ГРУППА Y" — Y это название группы

ХРАНИЛИЩА (всё загружено в контекст):
- 📬 Telegram: ВСЕ переписки Антона — личные, группы, каналы
- 🗃 Zettelkasten: заметки, идеи, факты, персоны
- 📝 Сессии: логи прошлых диалогов с тобой

ИНСТРУМЕНТЫ (TOOLS):
Если у тебя есть доступные инструменты — ОБЯЗАТЕЛЬНО используй их для ответа!
- search_knowledge: ищи данные в хранилищах ChromaDB (Telegram, заметки, сессии)
- get_system_status: проверяй состояние всех сервисов
- browse_url: открывай ссылки которые даёт пользователь
- save_memory: сохраняй важную информацию
- create_task: создавай задачи в Obsidian

ПРИМЕРЫ ОТВЕТОВ:
- "Что писала Настя?" → Вызови search_knowledge(query="Настя") и перескажи
- "Что я писал Насте?" → Вызови search_knowledge(query="Антон Евсин Настя", source_type="telegram")
- "Есть новые сообщения?" → Вызови search_knowledge(query="последние сообщения сегодня")
- "Статус систем?" → Вызови get_system_status()
- "Открой ссылку ..." → Вызови browse_url(url="...")`;

    if (vaultContext && vaultContext.trim().length > 0) {
        return `${base}\n\n${vaultContext.slice(0, 15000)}`;
    }

    return base;
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
            description: "Создать задачу/заметку в Obsidian. Используй когда пользователь просит создать задачу или запись.",
            parameters: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING", description: "Название задачи" },
                    description: { type: "STRING", description: "Описание задачи" },
                },
                required: ["title"],
            },
        });
    }

    if (declarations.length === 0) return undefined;
    return [{ functionDeclarations: declarations }];
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
        const systemText = buildSystemInstruction(opts.vaultContext);
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
            opts.onLog("toolCall received", { calls: toolCall.functionCalls.map(c => c.name) });

            const responses = await Promise.all(
                toolCall.functionCalls.map(async (call) => {
                    try {
                        const res = await fetch("/api/gemini-tool-exec", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ tool: call.name, args: call.args }),
                            signal: AbortSignal.timeout(5000), // 5s max — don't block Gemini
                        });
                        const json = await res.json() as { result: unknown };
                        opts.onLog(`toolCall ${call.name} completed`, json.result);
                        return {
                            name: call.name,
                            id: call.id,
                            response: { result: json.result },
                        };
                    } catch (err) {
                        opts.onLog(`toolCall ${call.name} failed`, err);
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
        opts.onOrbState("idle");
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
    ws?.close();
    ws = null;
    stopPlayback();
    if (playbackCtx && playbackCtx.state !== "closed") {
        playbackCtx.close().catch(() => { /* silent */ });
    }
    playbackCtx = null;
    isSpeaking = false;
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
