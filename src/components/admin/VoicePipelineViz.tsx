"use client";

import { useState } from "react";
import {
    Mic, Radio, Brain, Volume2, Database, Search,
    BookOpen, MessageSquare, FileText, Zap, ArrowRight,
    ChevronDown, ChevronUp, Shield, Heart,
} from "lucide-react";

/* ── Types ── */
interface PipelineNode {
    id: string;
    icon: React.ReactNode;
    label: string;
    description: string;
    status: "active" | "idle" | "error";
    side?: "left" | "right" | "center";
}

interface PipelineConnection {
    from: string;
    to: string;
    label?: string;
    animated?: boolean;
}

/* ── Node Data ── */
function getNodes(isSessionActive: boolean): PipelineNode[] {
    return [
        {
            id: "mic",
            icon: <Mic className="size-5" />,
            label: "🎙 Микрофон",
            description: "Захват аудио (PCM 16kHz). Обработка: эхоподавление, шумоподавление. Barge-in: если RMS > порога во время ответа — ассистент замолкает.",
            status: isSessionActive ? "active" : "idle",
            side: "center",
        },
        {
            id: "proxy",
            icon: <Radio className="size-5" />,
            label: "📡 WS Прокси",
            description: "WebSocket мост (порт 3099). Принимает PCM-аудио от браузера и транслирует в Gemini Live API. Автоматический реконнект при обрыве (3 попытки с backoff 1с→2с→4с).",
            status: isSessionActive ? "active" : "idle",
            side: "center",
        },
        {
            id: "gemini",
            icon: <Brain className="size-5" />,
            label: "🧠 Gemini Live",
            description: "Google Gemini 2.5 Flash (native audio). Speech-to-Speech: понимает русскую речь напрямую, отвечает голосом. Эмпатия интонации. Function Calling для инструментов.",
            status: isSessionActive ? "active" : "idle",
            side: "center",
        },
        {
            id: "speaker",
            icon: <Volume2 className="size-5" />,
            label: "🔊 Динамик",
            description: "Воспроизведение PCM 24kHz. Очередь аудио-буферов для плавного потока. Lip-sync анимация Orb по RMS.",
            status: isSessionActive ? "active" : "idle",
            side: "center",
        },
        // Left branch — Memory
        {
            id: "context",
            icon: <FileText className="size-5" />,
            label: "📝 Контекст",
            description: "Context Manager (6 слотов): 🔴 Замечания (NEVER evicted) → 🟠 Задачи → 🟡 Предсказанные → 🔵 Свежие → ⚪ Vault → 🟣 Инструменты. Бюджет: 80K символов (~32K токенов). Приоритеты настраиваются слайдерами.",
            status: "active",
            side: "left",
        },
        {
            id: "memory",
            icon: <Database className="size-5" />,
            label: "📦 Память (SQLite)",
            description: "Долгосрочная память: замечания, требования, поправки, предпочтения, факты, саммари сессий. Эмбеддинги через OpenAI для семантического поиска. Compiled Rules — компиляция ВСЕХ требований в краткие правила.",
            status: "active",
            side: "left",
        },
        {
            id: "empathy",
            icon: <Heart className="size-5" />,
            label: "💜 Эмпатия",
            description: "Empathy Engine: DNA коммуникации (тональность, формальность, юмор, эмоджи, проактивность). Evolved Rules — правила из анализа сессий. Обновляется автоматически после каждой сессии.",
            status: "active",
            side: "left",
        },
        // Right branch — Tools
        {
            id: "chroma",
            icon: <Search className="size-5" />,
            label: "🔍 ChromaDB",
            description: "Векторная БД: хранит ВСЕ переписки Telegram, заметки Zettelkasten, саммари сессий. Гибридный поиск (семантический + BM25). Динамические запросы по времени суток.",
            status: "active",
            side: "right",
        },
        {
            id: "obsidian",
            icon: <BookOpen className="size-5" />,
            label: "📚 Obsidian",
            description: "Zettelkasten vault: заметки, Inbox, задачи для Антигравити. REST API (порт 27124). Ассистент читает заметки и создаёт задачи голосом.",
            status: "idle",
            side: "right",
        },
        {
            id: "telegram",
            icon: <MessageSquare className="size-5" />,
            label: "📬 Telegram",
            description: "MTProto (Telethon): экспорт переписок, live-синхронизация новых сообщений, отправка сообщений от лица Антона. Все чаты векторизуются в ChromaDB.",
            status: "idle",
            side: "right",
        },
        {
            id: "tools",
            icon: <Zap className="size-5" />,
            label: "⚡ Function Calling",
            description: "Инструменты Gemini Live: search_knowledge, send_telegram, save_memory, create_task, google_docs_action, browse_url, web_search. Вкл/выкл в Настройках → Возможности ИИ.",
            status: isSessionActive ? "active" : "idle",
            side: "right",
        },
        {
            id: "analytics",
            icon: <Shield className="size-5" />,
            label: "📊 Аналитика",
            description: "Пост-сессионный анализ через OpenAI: satisfaction, pain points, mood arc. Результат → обновление Empathy Profile + Compiled Rules. Самоулучшение после КАЖДОЙ сессии.",
            status: "idle",
            side: "left",
        },
        {
            id: "openai_brain",
            icon: <Brain className="size-5" />,
            label: "🧠 OpenAI (мозг)",
            description: "OpenAI gpt-4o-mini: пост-сессионный анализ, embeddings для памяти (text-embedding-3-small), Zettelkasten-генерация, billing health-check. Это \'second brain\' — прослойка мозгов между голосовым Gemini и долговременной памятью.",
            status: "active",
            side: "left",
        },
    ];
}

const CONNECTIONS: PipelineConnection[] = [
    // Audio flow
    { from: "mic", to: "proxy", label: "PCM 16kHz", animated: true },
    { from: "proxy", to: "gemini", label: "WebSocket", animated: true },
    { from: "gemini", to: "speaker", label: "PCM 24kHz", animated: true },
    // Context injection (context → gemini setup, NOT proxy)
    { from: "context", to: "gemini", label: "System Prompt" },
    { from: "memory", to: "context", label: "Critical + Active" },
    { from: "empathy", to: "context", label: "DNA + Evolved" },
    { from: "chroma", to: "context", label: "Predicted + Recent" },
    { from: "obsidian", to: "context", label: "Vault Notes" },
    // Function Calling (gemini ↔ tools ↔ services)
    { from: "gemini", to: "tools", label: "Function Call" },
    { from: "tools", to: "chroma", label: "search_knowledge" },
    { from: "tools", to: "obsidian", label: "create_task" },
    { from: "tools", to: "telegram", label: "send_telegram" },
    // Self-improvement loop
    { from: "analytics", to: "empathy", label: "Evolve Profile" },
    { from: "analytics", to: "memory", label: "Compile Rules" },
    // OpenAI Brain connections (second brain layer)
    { from: "openai_brain", to: "analytics", label: "Post-session GPT-4" },
    { from: "openai_brain", to: "memory", label: "Embeddings" },
    { from: "openai_brain", to: "obsidian", label: "Zettel Gen" },
];

/* ── Component ── */
export function VoicePipelineViz({ isSessionActive = false }: { isSessionActive?: boolean }) {
    const [expandedNode, setExpandedNode] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    const nodes = getNodes(isSessionActive);

    const mainFlow = nodes.filter((n) => n.side === "center");
    const leftBranch = nodes.filter((n) => n.side === "left");
    const rightBranch = nodes.filter((n) => n.side === "right");

    const statusColors = {
        active: "border-emerald-500/50 bg-emerald-500/10 shadow-emerald-500/10",
        idle: "border-zinc-700/50 bg-zinc-800/50",
        error: "border-red-500/50 bg-red-500/10 shadow-red-500/10",
    };
    const statusDotColors = {
        active: "bg-emerald-400",
        idle: "bg-zinc-600",
        error: "bg-red-400",
    };

    const renderNode = (node: PipelineNode) => (
        <button
            key={node.id}
            onClick={() => setExpandedNode(expandedNode === node.id ? null : node.id)}
            className={`group relative flex items-center gap-3 rounded-xl border p-3 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${statusColors[node.status]} ${
                expandedNode === node.id ? "ring-1 ring-violet-500/50" : ""
            }`}
        >
            <span className={`absolute -right-1 -top-1 size-2.5 rounded-full ${statusDotColors[node.status]} ${
                node.status === "active" ? "animate-pulse" : ""
            }`} />

            <span className={`flex size-9 items-center justify-center rounded-lg ${
                node.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-700/50 text-zinc-400"
            }`}>
                {node.icon}
            </span>

            <div className="flex-1 text-left">
                <p className="text-[13px] font-semibold text-zinc-200">{node.label}</p>
                {expandedNode === node.id && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                        {node.description}
                    </p>
                )}
            </div>
        </button>
    );

    const renderArrow = (animated?: boolean) => (
        <div className="flex justify-center py-1">
            <ArrowRight className={`size-4 rotate-90 text-zinc-600 ${animated ? "animate-bounce" : ""}`} />
        </div>
    );

    return (
        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent p-4">
            {/* Header */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="mb-3 flex w-full items-center justify-between"
            >
                <div className="flex items-center gap-2">
                    <span className="text-base">🔄</span>
                    <h3 className="text-sm font-bold text-zinc-200">
                        Пайплайн потока данных
                    </h3>
                    {isSessionActive && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                            LIVE
                        </span>
                    )}
                </div>
                {isCollapsed ? (
                    <ChevronDown className="size-4 text-zinc-500" />
                ) : (
                    <ChevronUp className="size-4 text-zinc-500" />
                )}
            </button>

            {!isCollapsed && (
                <div className="grid gap-4 lg:grid-cols-3">
                    {/* Left — Memory Stack */}
                    <div className="space-y-2">
                        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-violet-400/70">
                            Память и обучение
                        </p>
                        {leftBranch.map((node) => renderNode(node))}
                        <div className="mt-2 rounded-lg border border-dashed border-violet-500/20 p-2 text-center text-[10px] text-zinc-500">
                            ♻️ Цикл самоулучшения: сессия → анализ → обновление правил
                        </div>
                    </div>

                    {/* Center — Main Audio Flow */}
                    <div className="space-y-1">
                        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-cyan-400/70">
                            Голосовой поток
                        </p>
                        {mainFlow.map((node, i) => (
                            <div key={node.id}>
                                {renderNode(node)}
                                {i < mainFlow.length - 1 && renderArrow(isSessionActive)}
                            </div>
                        ))}
                    </div>

                    {/* Right — Tools */}
                    <div className="space-y-2">
                        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-amber-400/70">
                            Инструменты и данные
                        </p>
                        {rightBranch.map((node) => renderNode(node))}
                    </div>
                </div>
            )}

            {/* How learning works — always visible summary */}
            {!isCollapsed && (
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                    <p className="mb-2 text-[11px] font-bold text-zinc-300">
                        🧬 Как ассистент учится общаться
                    </p>
                    <div className="grid gap-2 text-[10px] leading-relaxed text-zinc-500 sm:grid-cols-3">
                        <div className="rounded-lg bg-zinc-800/50 p-2">
                            <span className="font-bold text-violet-400">1. Сессия</span>
                            <br />Разговор записывается (транскрипт). Замечания → save_memory. Мат/перебивание → маркер сбоя.
                        </div>
                        <div className="rounded-lg bg-zinc-800/50 p-2">
                            <span className="font-bold text-cyan-400">2. Анализ</span>
                            <br />OpenAI анализирует: satisfaction, pain points, mood arc. Обновляет Empathy DNA и Compiled Rules.
                        </div>
                        <div className="rounded-lg bg-zinc-800/50 p-2">
                            <span className="font-bold text-emerald-400">3. Эволюция</span>
                            <br />Новые правила → первый блок system prompt. Следующая сессия = лучше предыдущей. Кривая ошибок → к нулю.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
