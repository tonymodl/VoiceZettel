"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    Activity, Database, MessageSquare, FileText, Wifi, WifiOff,
    RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle,
    Zap, HardDrive, Radio, Bot, BookOpen, Search, ArrowUpDown,
    Mic, ShieldCheck, ShieldAlert, ShieldX,
    Wrench, Key, CreditCard, Clock,
    Brain, FolderSync, Users, Globe,
    HeartPulse, Workflow, Satellite,
    Server, FileSearch, TextSearch, Sparkles, Monitor,
} from "lucide-react";
import { VoiceTasksPanel } from "./VoiceTasksPanel";
import { VoicePipelineViz } from "./VoicePipelineViz";
import { VoiceServicesHealth } from "./VoiceServicesHealth";
import { SelfImprovingAnalytics } from "./SelfImprovingAnalytics";

// ── Types ─────────────────────────────────────────────────────

interface ServiceNode {
    name: string;
    nameRu: string;
    icon: React.ReactNode;
    status: "online" | "degraded" | "offline" | "loading";
    latency: number | null;
    details: string;
    descRu: string;
    badge?: string;
}

interface IndexerStats {
    total_chunks: number;
    by_source: Record<string, number>;
    watcher_active: boolean;
    embedder: { requests: number; cached: number };
    index_state: { running: boolean; last_indexed: string | null; total_documents: number; total_chunks: number; errors: number };
}

interface TelegramHealth {
    auth: { status: string; user?: { name: string } };
    sync_active: boolean;
    export_running: boolean;
    voice_transcription: { transcribed: number; errors: number; enabled: boolean };
}

interface SyncStatus {
    messages_received: number;
    messages_written: number;
    messages_skipped: number;
    messages_vectorized: number;
    messages_transcribed: number;
    errors: number;
    active: boolean;
    monitored_chats: string | number;
    recent_messages: Array<{
        chat: string;
        text: string;
        time: string;
        from?: string;
        vectorization_status?: "pending" | "vectorizing" | "vectorized" | "error";
        transcription_status?: "skipped" | "pending" | "transcribing" | "transcribed" | "error";
        media_type?: string;
    }>;
}

interface ExportStatus {
    running: boolean;
    status: string;         // idle | exporting | completed | stopped | rate_limited | vectorizing
    stop_reason: string | null; // user | rate_limit | error
    chat_name: string;
    exported: number;
    total: number | null;
    chats_done: number;
    chats_total: number;
    error: string | null;
    auto_retry_at: string | null;
    tracker?: {
        total_chats_tracked: number;
        completed: number;
        vectorized: number;
        exporting: number;
    };
}

interface VoiceHealthCheck {
    name: string;
    nameRu: string;
    ok: boolean;
    details: string;
    descRu: string;
}

interface VoiceHealth {
    status: "ready" | "degraded" | "broken";
    descRu: string;
    checks: VoiceHealthCheck[];
}

interface OpenClawStatus {
    status: string;
    configured: boolean;
    raw_files: number;
    wiki_pages: number;
    processed_files: number;
    pending_files: number;
    entities: { people: number; tasks: number };
    directories: { raw_v2: boolean; wiki_v2: boolean };
}

interface CrmStats {
    status: string;
    initialized: boolean;
    stats?: { people: number; tasks: number; interactions: number; pending_actions: number };
}

// ── Helpers ───────────────────────────────────────────────────

const POLL_INTERVAL = 5000;

async function fetchWithTimeout(url: string, timeoutMs = 4000): Promise<{ data: unknown; latency: number }> {
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        const latency = Math.round(performance.now() - start);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return { data, latency };
    } finally {
        clearTimeout(timer);
    }
}

function StatusDot({ status }: { status: ServiceNode["status"] }) {
    const colors = {
        online: "bg-emerald-400",
        degraded: "bg-amber-400",
        offline: "bg-red-400",
        loading: "bg-zinc-500",
    };
    return (
        <span className={`relative flex size-2.5`}>
            {status === "online" && (
                <span className={`absolute inline-flex size-full animate-ping rounded-full ${colors[status]} opacity-50`} />
            )}
            <span className={`relative inline-flex size-2.5 rounded-full ${colors[status]}`} />
        </span>
    );
}

function StatusBadge({ status }: { status: ServiceNode["status"] }) {
    const styles = {
        online: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        degraded: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        offline: "border-red-500/30 bg-red-500/10 text-red-400",
        loading: "border-zinc-600/30 bg-zinc-700/20 text-zinc-500",
    };
    const labels = { online: "Работает", degraded: "Частично", offline: "Не работает", loading: "..." };
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${styles[status]}`}>
            <StatusDot status={status} />
            {labels[status]}
        </span>
    );
}

function ProgressBar({ value, max, color = "from-violet-500 to-cyan-400", label, sub }: {
    value: number; max: number; color?: string; label: string; sub?: string;
}) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-300">{label}</span>
                <span className="font-mono text-[11px] text-zinc-500">{value.toLocaleString()} / {max.toLocaleString()}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            {sub && <div className="mt-1 text-[11px] text-zinc-500">{sub}</div>}
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────

export function DashboardTab() {
    const [nodes, setNodes] = useState<ServiceNode[]>([]);
    const [indexerStats, setIndexerStats] = useState<IndexerStats | null>(null);
    const [telegramHealth, setTelegramHealth] = useState<TelegramHealth | null>(null);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
    const [voiceHealth, setVoiceHealth] = useState<VoiceHealth | null>(null);
    const [openclawStatus, setOpenclawStatus] = useState<OpenClawStatus | null>(null);
    const [crmStats, setCrmStats] = useState<CrmStats | null>(null);
    const [isHealing, setIsHealing] = useState(false);
    const [healLog, setHealLog] = useState<Array<{ service: string; descRu: string; success: boolean }> | null>(null);
    const [apiCredits, setApiCredits] = useState<Array<{
        name: string; nameRu: string; configured: boolean;
        keyPreview?: string; balanceRu?: string; rateLimitRu?: string; resetTimeRu?: string;
    }> | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

    const pollAll = useCallback(async () => {
        setIsRefreshing(true);
        const results: ServiceNode[] = [];

        // 1) Next.js Server
        try {
            const { latency } = await fetchWithTimeout("/api/health", 3000);
            results.push({ name: "Next.js Server", nameRu: "Веб-сервер", icon: <Zap className="size-4 text-emerald-400" />, status: "online", latency, details: "App Router + API", descRu: "Основной сервер приложения — страницы, API, интерфейс. Всё в порядке.", badge: "3000" });
        } catch {
            results.push({ name: "Next.js Server", nameRu: "Веб-сервер", icon: <Zap className="size-4 text-red-400" />, status: "offline", latency: null, details: "Нет ответа", descRu: "❌ Веб-сервер не отвечает. Интерфейс не будет работать. Запустите: npm run dev", badge: "3000" });
        }

        // 2) ChromaDB / Indexer
        try {
            const { data, latency } = await fetchWithTimeout("/api/indexer/health", 4000);
            const d = data as { chroma_documents: number; watcher_active: boolean; embedder_enabled: boolean };
            const hasDocs = d.chroma_documents > 0;
            results.push({
                name: "ChromaDB Indexer",
                nameRu: "Поиск и память",
                icon: <Database className={`size-4 ${hasDocs ? "text-violet-400" : "text-amber-400"}`} />,
                status: hasDocs ? "online" : "degraded",
                latency,
                details: `${d.chroma_documents.toLocaleString()} чанков | Watcher: ${d.watcher_active ? "✓" : "✗"}`,
                descRu: hasDocs
                    ? `✅ Векторная база работает. Проиндексировано ${d.chroma_documents.toLocaleString()} фрагментов — ассистент может искать по вашим данным.`
                    : "⚠️ База пуста — ассистент не сможет находить ваши заметки и переписки. Нужна индексация.",
                badge: "8030",
            });
        } catch {
            results.push({ name: "ChromaDB Indexer", nameRu: "Поиск и память", icon: <Database className="size-4 text-red-400" />, status: "offline", latency: null, details: "Сервис не отвечает", descRu: "❌ Сервис поиска не запущен. Ассистент не видит ваши заметки и переписки. Запустите: cd services/indexer && python main.py", badge: "8030" });
        }

        // Indexer stats (detailed)
        try {
            const { data } = await fetchWithTimeout("/api/indexer/stats", 4000);
            setIndexerStats(data as IndexerStats);
        } catch {
            setIndexerStats(null);
        }

        // 3) Telegram Service
        try {
            const { data, latency } = await fetchWithTimeout("/api/telegram/health", 4000);
            const d = data as TelegramHealth;
            setTelegramHealth(d);
            const authOk = d.auth?.status === "authorized";
            results.push({
                name: "Telegram Service",
                nameRu: "Телеграм",
                icon: <MessageSquare className={`size-4 ${authOk ? "text-blue-400" : "text-amber-400"}`} />,
                status: authOk ? "online" : "degraded",
                latency,
                details: authOk ? `✓ ${d.auth.user?.name || "authorized"} | Sync: ${d.sync_active ? "ON" : "OFF"}` : `Auth: ${d.auth?.status}`,
                descRu: authOk
                    ? `✅ Подключён как ${d.auth.user?.name}. ${d.sync_active ? "Новые сообщения приходят в реальном времени." : "Live-синхронизация выключена — новые сообщения не отслеживаются."}`
                    : "⚠️ Не авторизован в Telegram. Зайдите на вкладку Telegram и введите API-ключи + код.",
                badge: "8038",
            });
        } catch {
            setTelegramHealth(null);
            results.push({ name: "Telegram Service", nameRu: "Телеграм", icon: <MessageSquare className="size-4 text-red-400" />, status: "offline", latency: null, details: "Сервис не отвечает", descRu: "❌ Сервис Telegram не запущен. Экспорт и синхронизация переписок невозможны. Запустите: cd services/telegram && python main.py", badge: "8038" });
        }

        // Sync status
        try {
            const { data } = await fetchWithTimeout("/api/telegram/sync/status", 3000);
            setSyncStatus(data as SyncStatus);
        } catch {
            setSyncStatus(null);
        }

        // Export status
        try {
            const { data } = await fetchWithTimeout("/api/telegram/export/status", 3000);
            setExportStatus(data as ExportStatus);
        } catch {
            setExportStatus(null);
        }

        // 4) Obsidian REST API
        try {
            const { latency } = await fetchWithTimeout("/api/obsidian/health", 3000);
            results.push({ name: "Obsidian REST API", nameRu: "Obsidian (заметки)", icon: <BookOpen className="size-4 text-purple-400" />, status: "online", latency, details: "Vault доступен", descRu: "✅ Obsidian открыт, хранилище заметок доступно.", badge: "27124" });
        } catch {
            results.push({ name: "Obsidian REST API", nameRu: "Obsidian (заметки)", icon: <BookOpen className="size-4 text-red-400" />, status: "offline", latency: null, details: "Нет ответа", descRu: "⚠️ Obsidian не открыт или плагин REST API не включён. Откройте Obsidian и убедитесь, что плагин Local REST API активен.", badge: "27124" });
        }

        // 5) Gemini WS Proxy
        try {
            const { latency } = await fetchWithTimeout("/api/health", 3000).catch(() => {
                return { data: null, latency: -1 };
            });
            if (latency > 0) {
                results.push({ name: "Gemini WS Proxy", nameRu: "Голосовой канал", icon: <Radio className="size-4 text-cyan-400" />, status: "online", latency, details: "WebSocket ↔ Gemini Live", descRu: "✅ Голосовой канал к Google Gemini работает. Можно разговаривать с ассистентом.", badge: "3099" });
            } else {
                results.push({ name: "Gemini WS Proxy", nameRu: "Голосовой канал", icon: <Radio className="size-4 text-amber-400" />, status: "degraded", latency: null, details: "WS-only", descRu: "⚠️ Прокси работает только по WebSocket — проверка здоровья недоступна, но голос может работать.", badge: "3099" });
            }
        } catch {
            results.push({ name: "Gemini WS Proxy", nameRu: "Голосовой канал", icon: <Radio className="size-4 text-red-400" />, status: "offline", latency: null, details: "Нет ответа", descRu: "❌ Голосовой прокси не запущен. Разговор с ассистентом невозможен. Запустите: node ws-proxy.js", badge: "3099" });
        }

        // 6) OpenAI API
        try {
            const { data, latency } = await fetchWithTimeout("/api/health-openai", 12000);
            const d = data as {
                status: string; models?: number; hasGpt4?: boolean; hasEmbed?: boolean;
                billingOk?: boolean; billingError?: string | null; balance?: string | null;
                balanceRu?: string | null; rateLimitRemaining?: string | null; descRu?: string;
            };
            if (d.status === "ok") {
                const details = [`${d.models ?? "?"} моделей`, d.hasGpt4 ? "GPT-4 ✓" : "", d.hasEmbed ? "Embed ✓" : ""].filter(Boolean).join(", ");
                results.push({ name: "OpenAI API", nameRu: "OpenAI (мозг)", icon: <Bot className="size-4 text-green-400" />, status: "online", latency, details, descRu: d.descRu || "✅ OpenAI работает.", badge: "API" });
            } else if (d.status === "no_funds") {
                results.push({ name: "OpenAI API", nameRu: "OpenAI (мозг)", icon: <Bot className="size-4 text-red-400" />, status: "offline", latency, details: "Нет средств", descRu: d.descRu || "❌ Средства на счёте OpenAI закончились.", badge: "API" });
            } else {
                results.push({ name: "OpenAI API", nameRu: "OpenAI (мозг)", icon: <Bot className="size-4 text-amber-400" />, status: "degraded", latency, details: d.billingError || "Ошибка", descRu: d.descRu || "⚠️ OpenAI отвечает с ошибкой.", badge: "API" });
            }
        } catch {
            results.push({ name: "OpenAI API", nameRu: "OpenAI (мозг)", icon: <Bot className="size-4 text-amber-400" />, status: "degraded", latency: null, details: "Не проверяется", descRu: "⚠️ Не удалось проверить OpenAI. Проверьте подключение к интернету.", badge: "API" });
        }

        // 7) Live Sync (Telegram → Obsidian realtime)
        // syncStatus is fetched below, so we read it from state at render time via a separate mechanism
        // For the service card, we do a lightweight check here
        try {
            const { data } = await fetchWithTimeout("/api/telegram/sync/status", 3000);
            const sd = data as SyncStatus;
            const isActive = sd.active;
            const chatCount = sd.monitored_chats === "all" ? "все" : sd.monitored_chats;
            results.push({
                name: "Live Sync",
                nameRu: "Live-синхронизация",
                icon: <Radio className={`size-4 ${isActive ? "text-cyan-400" : "text-zinc-500"}`} />,
                status: isActive ? "online" : "degraded",
                latency: null,
                details: isActive ? `${sd.messages_received} сообщ. | ${chatCount} чатов` : "Не запущена",
                descRu: isActive
                    ? `📡 Работает. Мониторинг ${chatCount} чатов в реальном времени. Получено ${sd.messages_received} сообщений.`
                    : "⚠️ Live-синхронизация не запущена. Новые сообщения не будут автоматически попадать в Obsidian.",
                badge: "RT",
            });
        } catch {
            results.push({
                name: "Live Sync",
                nameRu: "Live-синхронизация",
                icon: <Radio className="size-4 text-red-400" />,
                status: "offline",
                latency: null,
                details: "Нет ответа",
                descRu: "❌ Не удалось проверить статус Live-синхронизации. Telegram-сервис не отвечает.",
                badge: "RT",
            });
        }

        // ── V3.0 Services (OpenClaw — single fetch, 3 cards) ──────

        // 8–9–13) Fetch OpenClaw status ONCE, reuse for Agent + Shadow Mode + NLP cards
        let openClawData: OpenClawStatus | null = null;
        let openClawLatency: number | null = null;
        try {
            const { data, latency } = await fetchWithTimeout("/api/openclaw/status", 4000);
            openClawData = data as OpenClawStatus;
            openClawLatency = latency;
            setOpenclawStatus(openClawData);
        } catch {
            setOpenclawStatus(null);
        }

        // 8) OpenClaw Agent card
        if (openClawData) {
            const d = openClawData;
            const configured = d.configured;
            const hasData = d.raw_files > 0 || d.wiki_pages > 0;
            results.push({
                name: "OpenClaw Agent",
                nameRu: "OpenClaw (Wiki)",
                icon: <Brain className={`size-4 ${configured ? "text-fuchsia-400" : "text-zinc-500"}`} />,
                status: configured ? (hasData ? "online" : "degraded") : "degraded",
                latency: openClawLatency,
                details: configured
                    ? `Raw: ${d.raw_files} | Wiki: ${d.wiki_pages} | People: ${d.entities.people} | Tasks: ${d.entities.tasks}`
                    : "Не настроен",
                descRu: configured
                    ? hasData
                        ? `✅ OpenClaw настроен. ${d.raw_files} сырых файлов, ${d.wiki_pages} wiki-страниц. Извлечено: ${d.entities.people} персон, ${d.entities.tasks} задач.`
                        : "⚠️ OpenClaw настроен, но данных пока нет. Запустите экспорт Telegram или Shadow Mode для наполнения Raw_v2/."
                    : "⚠️ OpenClaw не настроен. Запустите: bash scripts/setup-openclaw.sh",
                badge: "LLM",
            });
        } else {
            results.push({
                name: "OpenClaw Agent",
                nameRu: "OpenClaw (Wiki)",
                icon: <Brain className="size-4 text-zinc-500" />,
                status: "degraded",
                latency: null,
                details: "Не проверяется — ожидает настройки",
                descRu: "⚠️ Эндпоинт OpenClaw не отвечает. Убедитесь, что конфигурация .openclaw/ существует.",
                badge: "LLM",
            });
        }

        // 9) Shadow Mode card (reuses openClawData)
        if (openClawData) {
            const d = openClawData;
            const bothExist = d.directories.raw_v2 && d.directories.wiki_v2;
            results.push({
                name: "Shadow Mode",
                nameRu: "Shadow Mode",
                icon: <FolderSync className={`size-4 ${bothExist ? "text-indigo-400" : "text-amber-400"}`} />,
                status: bothExist ? "online" : "degraded",
                latency: null,
                details: `Raw_v2: ${d.directories.raw_v2 ? "✓" : "✗"} | Wiki_v2: ${d.directories.wiki_v2 ? "✓" : "✗"} | ${d.pending_files} ожидает`,
                descRu: bothExist
                    ? `✅ Shadow Mode активен. Директории Raw_v2/ и Wiki_v2/ существуют. ${d.pending_files} файлов ожидают обработки.`
                    : "⚠️ Директории Shadow Mode не найдены. Создайте: VoiceZettel/Raw_v2/ и VoiceZettel/Wiki_v2/",
                badge: "v2",
            });
        } else {
            results.push({
                name: "Shadow Mode",
                nameRu: "Shadow Mode",
                icon: <FolderSync className="size-4 text-red-400" />,
                status: "offline",
                latency: null,
                details: "Не проверяется",
                descRu: "❌ Не удалось проверить Shadow Mode.",
                badge: "v2",
            });
        }

        // 10) CRM Database (sqlite_v2)
        try {
            const { data, latency } = await fetchWithTimeout("/api/crm?view=stats", 4000);
            const d = data as CrmStats;
            setCrmStats(d);
            results.push({
                name: "CRM Database",
                nameRu: "CRM (граф знаний)",
                icon: <Users className={`size-4 ${d.initialized ? "text-teal-400" : "text-zinc-500"}`} />,
                status: d.initialized ? "online" : "degraded",
                latency,
                details: d.initialized && d.stats
                    ? `People: ${d.stats.people} | Tasks: ${d.stats.tasks} | Events: ${d.stats.interactions} | Actions: ${d.stats.pending_actions}`
                    : "БД не инициализирована",
                descRu: d.initialized && d.stats
                    ? `✅ CRM работает. ${d.stats.people} персон, ${d.stats.tasks} задач, ${d.stats.interactions} взаимодействий. Ожидает действий: ${d.stats.pending_actions}.`
                    : "⚠️ CRM база данных (sqlite_v2.db) ещё не создана. Она будет создана при первом запуске OpenClaw.",
                badge: "DB",
            });
        } catch {
            setCrmStats(null);
            results.push({
                name: "CRM Database",
                nameRu: "CRM (граф знаний)",
                icon: <Users className="size-4 text-zinc-500" />,
                status: "degraded",
                latency: null,
                details: "Ожидает инициализации",
                descRu: "⚠️ CRM база данных (sqlite_v2.db) ещё не создана. Она будет создана при первом запуске OpenClaw агента.",
                badge: "DB",
            });
        }

        // 11) Google Workspace
        try {
            const { data, latency } = await fetchWithTimeout("/api/auth/google/status", 3000);
            const d = data as { connected: boolean; hasWriteAccess: boolean; email: string | null };
            if (d.connected) {
                results.push({
                    name: "Google Workspace",
                    nameRu: "Google Workspace",
                    icon: <Globe className={`size-4 ${d.hasWriteAccess ? "text-blue-400" : "text-amber-400"}`} />,
                    status: d.hasWriteAccess ? "online" : "degraded",
                    latency,
                    details: d.hasWriteAccess ? `✓ Чтение + запись | ${d.email}` : `⚠ Только чтение | ${d.email}`,
                    descRu: d.hasWriteAccess
                        ? `✅ Google подключён (${d.email}). Полный доступ к документам и таблицам. Ассистент может читать и редактировать файлы.`
                        : `⚠️ Google подключён (${d.email}), но только для чтения. Перейдите в Настройки → Возможности ИИ → «Обновить доступ» для записи.`,
                    badge: "API",
                });
            } else {
                results.push({
                    name: "Google Workspace",
                    nameRu: "Google Workspace",
                    icon: <Globe className="size-4 text-zinc-500" />,
                    status: "degraded",
                    latency,
                    details: "Не подключён",
                    descRu: "⚠️ Google не подключён. Перейдите: /api/auth/google для авторизации.",
                    badge: "API",
                });
            }
        } catch {
            results.push({
                name: "Google Workspace",
                nameRu: "Google Workspace",
                icon: <Globe className="size-4 text-zinc-500" />,
                status: "degraded",
                latency: null,
                details: "Не настроен",
                descRu: "⚠️ Google Workspace ожидает настройки OAuth. Перейдите в Настройки → Возможности ИИ → подключить Google.",
                badge: "API",
            });
        }

        // 12) OpenClaw Heartbeat Daemon (port 8040)
        try {
            const { data, latency } = await fetchWithTimeout("/api/openclaw/health", 4000);
            const d = data as { service: string; status: string; heartbeat_active: boolean; heartbeat_interval_min: number; last_run: string | null; uptime_seconds: number; worker_status: string; files_processed: number; entities_extracted: number; errors: number };
            const isActive = d.heartbeat_active;
            results.push({
                name: "OpenClaw Heartbeat",
                nameRu: "Heartbeat (демон)",
                icon: <HeartPulse className={`size-4 ${isActive ? "text-pink-400" : "text-zinc-500"}`} />,
                status: isActive ? "online" : "degraded",
                latency,
                details: isActive
                    ? `Every ${d.heartbeat_interval_min}min | ${d.files_processed} files | ${d.entities_extracted} entities`
                    : `Worker: ${d.worker_status}`,
                descRu: isActive
                    ? `✅ Heartbeat активен. Цикл каждые ${d.heartbeat_interval_min} мин. Обработано ${d.files_processed} файлов, извлечено ${d.entities_extracted} сущностей.`
                    : "⚠️ Heartbeat демон запущен, но не активен. Проверьте конфигурацию.",
                badge: "8040",
            });
        } catch {
            results.push({
                name: "OpenClaw Heartbeat",
                nameRu: "Heartbeat (демон)",
                icon: <HeartPulse className="size-4 text-zinc-500" />,
                status: "degraded",
                latency: null,
                details: "Демон не запущен",
                descRu: "⚠️ OpenClaw Heartbeat демон не запущен. Автоматическая обработка файлов не работает. Запустите: cd services/openclaw && python main.py",
                badge: "8040",
            });
        }

        // 13) NLP Pipeline (entity extraction status — reuses openClawData)
        if (openClawData) {
            const d = openClawData;
            const totalEntities = d.entities.people + d.entities.tasks;
            const hasEntities = totalEntities > 0;
            results.push({
                name: "NLP Pipeline",
                nameRu: "NLP конвейер",
                icon: <Workflow className={`size-4 ${hasEntities ? "text-amber-400" : "text-zinc-500"}`} />,
                status: hasEntities ? "online" : "degraded",
                latency: null,
                details: `Персоны: ${d.entities.people} | Задачи: ${d.entities.tasks} | Raw: ${d.raw_files} | Wiki: ${d.wiki_pages}`,
                descRu: hasEntities
                    ? `✅ NLP конвейер работает. Извлечено ${d.entities.people} персон и ${d.entities.tasks} задач из ${d.raw_files} сырых файлов.`
                    : "⚠️ NLP конвейер настроен, но сущности ещё не извлечены. Добавьте файлы в Raw_v2/ и запустите Heartbeat.",
                badge: "NLP",
            });
        } else {
            results.push({
                name: "NLP Pipeline",
                nameRu: "NLP конвейер",
                icon: <Workflow className="size-4 text-zinc-500" />,
                status: "degraded",
                latency: null,
                details: "Не проверяется",
                descRu: "⚠️ Не удалось получить статус NLP конвейера.",
                badge: "NLP",
            });
        }

        // 14) Mission Control SSE (log stream health)
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const sseRes = await fetch("/api/logs/stream", { signal: controller.signal });
            clearTimeout(timer);
            const isStreaming = sseRes.ok && sseRes.headers.get("content-type")?.includes("text/event-stream");
            results.push({
                name: "Mission Control SSE",
                nameRu: "Лог-стриминг",
                icon: <Satellite className={`size-4 ${isStreaming ? "text-indigo-400" : "text-zinc-500"}`} />,
                status: isStreaming ? "online" : "degraded",
                latency: null,
                details: isStreaming ? "SSE поток активен" : "Поток недоступен",
                descRu: isStreaming
                    ? "✅ Server-Sent Events активен. Логи стримятся в Mission Control терминал в реальном времени."
                    : "⚠️ SSE лог-стриминг не отвечает. Mission Control терминал не сможет показывать логи.",
                badge: "SSE",
            });
            // Abort the SSE connection — we only tested connectivity
            controller.abort();
        } catch {
            results.push({
                name: "Mission Control SSE",
                nameRu: "Лог-стриминг",
                icon: <Satellite className="size-4 text-zinc-500" />,
                status: "degraded",
                latency: null,
                details: "SSE не проверяется",
                descRu: "⚠️ Лог-стриминг (SSE) не отвечает.",
                badge: "SSE",
            });
        }

        // 7) Voice Assistant Health
        try {
            const { data } = await fetchWithTimeout("/api/voice-health", 6000);
            setVoiceHealth(data as VoiceHealth);
        } catch {
            setVoiceHealth(null);
        }

        // 8) API Credits
        try {
            const { data } = await fetchWithTimeout("/api/api-credits", 8000);
            const d = data as { services: typeof apiCredits };
            setApiCredits(d.services ?? null);
        } catch {
            setApiCredits(null);
        }

        // ── Phase 2: Shadow Integration Services ──────────────

        // 15) LiteLLM Proxy (port 4000)
        try {
            const { data, latency } = await fetchWithTimeout("/api/litellm/health", 4000);
            const d = data as { status: string; models: number };
            const isOk = d.status === "ok";
            results.push({
                name: "LiteLLM Proxy",
                nameRu: "LiteLLM (шлюз)",
                icon: <Server className={`size-4 ${isOk ? "text-violet-400" : "text-zinc-500"}`} />,
                status: isOk ? "online" : "degraded",
                latency,
                details: isOk ? `${d.models} моделей доступно` : "Прокси не отвечает",
                descRu: isOk
                    ? `✅ LiteLLM прокси работает. Доступно ${d.models} моделей (100+ провайдеров). Экспериментальный шлюз для /api/chat-lite.`
                    : "⚠️ LiteLLM прокси не запущен. Для запуска: cd services/litellm && docker compose up -d",
                badge: "4000",
            });
        } catch {
            results.push({ name: "LiteLLM Proxy", nameRu: "LiteLLM (шлюз)", icon: <Server className="size-4 text-zinc-500" />, status: "degraded", latency: null, details: "Не запущен", descRu: "⚠️ LiteLLM Docker-контейнер не запущен. Запустите: cd services/litellm && docker compose up -d", badge: "4000" });
        }

        // 16) Docling Parser
        try {
            const { data, latency } = await fetchWithTimeout("/api/openclaw/docling/health", 4000);
            const d = data as { status: string; available: boolean };
            results.push({
                name: "Docling Parser",
                nameRu: "Docling (документы)",
                icon: <FileSearch className={`size-4 ${d.available ? "text-orange-400" : "text-zinc-500"}`} />,
                status: d.available ? "online" : "degraded",
                latency,
                details: d.available ? "PDF/PPTX/XLSX + OCR" : "Не установлен",
                descRu: d.available
                    ? "✅ Docling установлен. Парсинг PDF, PPTX, XLSX с OCR и сохранением таблиц."
                    : "⚠️ Docling не установлен. Для установки: pip install 'docling[ocr]' в окружении OpenClaw.",
                badge: "DOC",
            });
        } catch {
            results.push({ name: "Docling Parser", nameRu: "Docling (документы)", icon: <FileSearch className="size-4 text-zinc-500" />, status: "degraded", latency: null, details: "Не проверяется", descRu: "⚠️ Не удалось проверить Docling — OpenClaw демон не отвечает.", badge: "DOC" });
        }

        // 17) BM25 Full-Text Index
        try {
            const { data, latency } = await fetchWithTimeout("/api/indexer/bm25-stats", 3000);
            const d = data as { available: boolean; total_docs: number; index_builds: number; status: string };
            results.push({
                name: "BM25 Index",
                nameRu: "BM25 (полнотекст)",
                icon: <TextSearch className={`size-4 ${d.available && d.total_docs > 0 ? "text-lime-400" : "text-zinc-500"}`} />,
                status: d.available && d.total_docs > 0 ? "online" : "degraded",
                latency,
                details: d.available ? `${d.total_docs.toLocaleString()} документов | ${d.index_builds} перестроек` : "Не инициализирован",
                descRu: d.available && d.total_docs > 0
                    ? `✅ Полнотекстовый BM25 индекс: ${d.total_docs.toLocaleString()} документов. Используется в гибридном поиске (RRF).`
                    : "⚠️ BM25 индекс пуст. Запустите полную индексацию для наполнения. pip install rank-bm25",
                badge: "BM25",
            });
        } catch {
            results.push({ name: "BM25 Index", nameRu: "BM25 (полнотекст)", icon: <TextSearch className="size-4 text-zinc-500" />, status: "degraded", latency: null, details: "Не проверяется", descRu: "⚠️ BM25 индекс недоступен — сервис Indexer не отвечает.", badge: "BM25" });
        }

        // 18) Deep Agent (LangChain)
        try {
            const { data, latency } = await fetchWithTimeout("/api/openclaw/agent/health", 4000);
            const d = data as { service: string; enabled: boolean; status: string; langchain_available?: boolean };
            results.push({
                name: "Deep Agent",
                nameRu: "Deep Agent (ИИ)",
                icon: <Sparkles className={`size-4 ${d.enabled && d.status === "ok" ? "text-yellow-400" : "text-zinc-500"}`} />,
                status: d.enabled && d.status === "ok" ? "online" : "degraded",
                latency,
                details: d.enabled
                    ? d.status === "ok" ? "LangChain ✓ | Sandbox активен" : "LangChain не установлен"
                    : "Отключён (DEEP_AGENT_ENABLED=false)",
                descRu: d.enabled
                    ? d.status === "ok"
                        ? "✅ Deep Agent активен. LangChain агент обогащает заметки связанными концепциями. Песочница: Wiki_v2/.drafts/"
                        : "⚠️ Deep Agent включён, но LangChain не установлен. pip install langchain langchain-openai"
                    : "⚠️ Deep Agent отключён. Установите DEEP_AGENT_ENABLED=true в .env для активации.",
                badge: "AGT",
            });
        } catch {
            results.push({ name: "Deep Agent", nameRu: "Deep Agent (ИИ)", icon: <Sparkles className="size-4 text-zinc-500" />, status: "degraded", latency: null, details: "Не проверяется", descRu: "⚠️ Не удалось проверить Deep Agent — OpenClaw демон не отвечает.", badge: "AGT" });
        }

        // 19) Desktop App (Tauri/Electron)
        results.push({
            name: "Desktop App",
            nameRu: "Desktop (оболочка)",
            icon: <Monitor className="size-4 text-sky-400" />,
            status: "degraded",
            latency: null,
            details: "Tauri + Electron | Ctrl+Shift+Space",
            descRu: "ℹ️ Desktop-оболочка (Tauri/Electron) готова к сборке. Запуск: cd desktop-app && npm run electron:dev. Хоткей: Ctrl+Shift+Space для мгновенного вызова.",
            badge: "APP",
        });

        setNodes(results);
        setLastRefresh(new Date());
        setIsRefreshing(false);
    }, []);

    useEffect(() => {
        pollAll();
        intervalRef.current = setInterval(pollAll, POLL_INTERVAL);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [pollAll]);

    const onlineCount = nodes.filter((n) => n.status === "online").length;
    const totalCount = nodes.length;
    const hasProblems = nodes.some((n) => n.status !== "online") || voiceHealth?.status !== "ready";

    const handleHeal = useCallback(async () => {
        setIsHealing(true);
        setHealLog(null);
        try {
            const res = await fetch("/api/auto-heal", { method: "POST" });
            const data = await res.json() as { actions: Array<{ service: string; descRu: string; success: boolean }> };
            setHealLog(data.actions);
            // Re-poll after healing
            setTimeout(() => pollAll(), 2000);
        } catch {
            setHealLog([{ service: "System", descRu: "❌ Не удалось выполнить автолечение", success: false }]);
        } finally {
            setIsHealing(false);
        }
    }, [pollAll]);

    return (
        <div className="space-y-5 pb-6">
            {/* ══════════════════════════════════════════
                HEADER — Status banner + actions
               ══════════════════════════════════════════ */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className={`flex size-10 items-center justify-center rounded-xl ${
                        onlineCount === totalCount ? "bg-emerald-500/15" : onlineCount === 0 ? "bg-red-500/15" : "bg-amber-500/15"
                    }`}>
                        <Activity className={`size-5 ${
                            onlineCount === totalCount ? "text-emerald-400" : onlineCount === 0 ? "text-red-400" : "text-amber-400"
                        }`} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-zinc-100">Здоровье системы</h2>
                        <p className="text-sm text-zinc-500">
                            {onlineCount === totalCount
                                ? "Все сервисы работают в штатном режиме"
                                : `${onlineCount} из ${totalCount} сервисов активны`}
                        </p>
                    </div>
                    <span className={`ml-1 rounded-full border px-3 py-1 text-xs font-bold ${
                        onlineCount === totalCount
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : onlineCount === 0
                                ? "border-red-500/30 bg-red-500/10 text-red-400"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    }`}>
                        {onlineCount}/{totalCount}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    {hasProblems && (
                        <button
                            onClick={handleHeal}
                            disabled={isHealing}
                            className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-400 transition-all hover:bg-amber-500/20 hover:shadow-lg hover:shadow-amber-500/5 active:scale-[0.97] disabled:opacity-50"
                        >
                            {isHealing ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                            {isHealing ? "Чиню..." : "🔧 Решить проблему"}
                        </button>
                    )}
                    <button
                        onClick={pollAll}
                        disabled={isRefreshing}
                        className="flex items-center gap-1.5 rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 transition hover:bg-zinc-700/50"
                    >
                        <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">Обновить</span>
                    </button>
                    <span className="text-xs text-zinc-600">
                        {lastRefresh.toLocaleTimeString()}
                    </span>
                </div>
            </div>

            {/* ══════════════════════════════════════════
                SELF-HEALING — Always visible diagnostics section
               ══════════════════════════════════════════ */}
            <section>
                <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] to-transparent p-5 backdrop-blur">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-xl bg-violet-500/15">
                                <Wrench className="size-5 text-violet-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-zinc-100">🏥 Самоисцеление системы</h3>
                                <p className="text-xs text-zinc-500">
                                    Автодиагностика и перезапуск упавших сервисов
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleHeal}
                                disabled={isHealing}
                                className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-400 transition-all hover:bg-violet-500/20 hover:shadow-lg hover:shadow-violet-500/5 active:scale-[0.97] disabled:opacity-50"
                            >
                                {isHealing ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                                {isHealing ? "Диагностика..." : "🔧 Запустить диагностику + лечение"}
                            </button>
                        </div>
                    </div>

                    {/* Status indicators */}
                    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3 text-center">
                            <p className="text-lg font-bold text-emerald-400">{onlineCount}</p>
                            <p className="text-[10px] text-zinc-500">Онлайн</p>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3 text-center">
                            <p className="text-lg font-bold text-amber-400">{nodes.filter(n => n.status === "degraded").length}</p>
                            <p className="text-[10px] text-zinc-500">Частично</p>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3 text-center">
                            <p className="text-lg font-bold text-red-400">{nodes.filter(n => n.status === "offline").length}</p>
                            <p className="text-[10px] text-zinc-500">Оффлайн</p>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3 text-center">
                            <p className="text-lg font-bold text-zinc-300">{totalCount}</p>
                            <p className="text-[10px] text-zinc-500">Всего</p>
                        </div>
                    </div>

                    {/* Heal Log */}
                    {healLog && (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-xs font-bold text-zinc-300">📋 Результат последнего лечения:</span>
                                <button
                                    onClick={() => setHealLog(null)}
                                    className="rounded-lg px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                                >✕ Скрыть</button>
                            </div>
                            <div className="space-y-2">
                                {healLog.map((a, i) => (
                                    <div key={i} className="flex items-start gap-2.5 text-sm">
                                        {a.success
                                            ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                                            : <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
                                        }
                                        <span className={a.success ? "text-zinc-400" : "text-red-300"}>
                                            <strong className="text-zinc-200">{a.service}:</strong> {a.descRu}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!healLog && (
                        <p className="text-center text-[11px] text-zinc-600">
                            Нажмите кнопку выше для запуска полной диагностики всех сервисов и автоматического перезапуска упавших.
                        </p>
                    )}
                </div>
            </section>

            {/* ══════════════════════════════════════════
                WATCHDOG DAEMON — Background service monitor
               ══════════════════════════════════════════ */}
            <WatchdogWidget />

            {/* ══════════════════════════════════════════
                PRIORITY 1 — Voice Assistant (main product)
               ══════════════════════════════════════════ */}
            <section>
                <div className={`rounded-2xl border p-5 backdrop-blur transition-colors ${
                    voiceHealth?.status === "ready" ? "border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] to-transparent" :
                    voiceHealth?.status === "degraded" ? "border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-transparent" :
                    "border-red-500/20 bg-gradient-to-br from-red-500/[0.04] to-transparent"
                }`}>
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`flex size-10 items-center justify-center rounded-xl ${
                                voiceHealth?.status === "ready" ? "bg-emerald-500/15" :
                                voiceHealth?.status === "degraded" ? "bg-amber-500/15" : "bg-red-500/15"
                            }`}>
                                <Mic className={`size-5 ${
                                    voiceHealth?.status === "ready" ? "text-emerald-400" :
                                    voiceHealth?.status === "degraded" ? "text-amber-400" : "text-red-400"
                                }`} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-zinc-100">Голосовой ассистент</h3>
                                <p className="text-xs text-zinc-500">Gemini Live — основной продукт</p>
                            </div>
                        </div>
                        {voiceHealth && (
                            <span className={`flex items-center gap-2 self-start rounded-full border px-4 py-1.5 text-xs font-bold ${
                                voiceHealth.status === "ready" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                                voiceHealth.status === "degraded" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" :
                                "border-red-500/30 bg-red-500/10 text-red-400"
                            }`}>
                                {voiceHealth.status === "ready" ? <ShieldCheck className="size-4" /> :
                                 voiceHealth.status === "degraded" ? <ShieldAlert className="size-4" /> :
                                 <ShieldX className="size-4" />}
                                {voiceHealth.status === "ready" ? "Готов к работе" :
                                 voiceHealth.status === "degraded" ? "Работает частично" : "Не работает"}
                            </span>
                        )}
                    </div>

                    {voiceHealth ? (
                        <>
                            <div className={`mb-4 rounded-xl px-4 py-3 text-sm leading-relaxed ${
                                voiceHealth.status === "ready" ? "bg-emerald-500/8 text-emerald-200" :
                                voiceHealth.status === "degraded" ? "bg-amber-500/8 text-amber-200" :
                                "bg-red-500/8 text-red-200"
                            }`}>
                                {voiceHealth.descRu}
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                                {voiceHealth.checks.map((check) => (
                                    <div key={check.name} className="rounded-xl border border-white/[0.06] bg-zinc-900/60 p-3">
                                        <div className="mb-1.5 flex items-center gap-2">
                                            {check.ok
                                                ? <CheckCircle2 className="size-4 text-emerald-400" />
                                                : <XCircle className="size-4 text-red-400" />
                                            }
                                            <span className="text-xs font-bold text-zinc-200">{check.nameRu}</span>
                                        </div>
                                        <p className="text-[11px] leading-relaxed text-zinc-500">
                                            {check.descRu}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-3 text-sm text-zinc-500">
                            <Loader2 className="size-4 animate-spin" />
                            Проверка голосового ассистента...
                        </div>
                    )}
                </div>
            </section>

            {/* ══════════════════════════════════════════
                VOICE SERVICES HEALTH — Detailed health checks
               ══════════════════════════════════════════ */}
            <VoiceServicesHealth />

            {/* ══════════════════════════════════════════
                VOICE PIPELINE — Data flow visualization
               ══════════════════════════════════════════ */}
            <VoicePipelineViz />

            {/* ══════════════════════════════════════════
                VOICE TASKS — Tasks from assistant
               ══════════════════════════════════════════ */}
            <VoiceTasksPanel />

            {/* ══════════════════════════════════════════
                SELF-IMPROVING ANALYTICS — Satisfaction trends
               ══════════════════════════════════════════ */}
            <SelfImprovingAnalytics />

            {/* ══════════════════════════════════════════
                PRIORITY 2 — Service Health Grid
               ══════════════════════════════════════════ */}
            <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                    <Zap className="size-4" /> Сервисы и подключения
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {nodes.map((node) => (
                        <div
                            key={node.name}
                            className={`group rounded-2xl border p-4 backdrop-blur transition-all hover:shadow-lg ${
                                node.status === "online"
                                    ? "border-white/[0.06] bg-zinc-900/60 hover:border-emerald-500/20 hover:shadow-emerald-500/5"
                                    : node.status === "degraded"
                                        ? "border-amber-500/15 bg-amber-500/[0.02] hover:border-amber-500/30 hover:shadow-amber-500/5"
                                        : "border-red-500/15 bg-red-500/[0.02] hover:border-red-500/30 hover:shadow-red-500/5"
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`flex size-9 items-center justify-center rounded-lg ${
                                    node.status === "online" ? "bg-emerald-500/10" :
                                    node.status === "degraded" ? "bg-amber-500/10" : "bg-red-500/10"
                                }`}>
                                    {node.icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-zinc-100">{node.nameRu}</span>
                                        {node.badge && (
                                            <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                                                :{node.badge}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <StatusBadge status={node.status} />
                                        {node.latency !== null && (
                                            <span className="font-mono text-[11px] text-zinc-600">{node.latency}ms</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className={`mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed ${
                                node.status === "online" ? "bg-emerald-500/5 text-zinc-400" :
                                node.status === "degraded" ? "bg-amber-500/5 text-amber-200/80" :
                                "bg-red-500/5 text-red-200/80"
                            }`}>
                                {node.descRu}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ══════════════════════════════════════════
                PRIORITY 3 — Data pipeline & progress
               ══════════════════════════════════════════ */}
            <section className="grid gap-4 lg:grid-cols-5">
                {/* ── ChromaDB / Vectorization — 3 cols ──── */}
                <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-5 backdrop-blur lg:col-span-3">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-violet-500/10">
                            <Search className="size-4 text-violet-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-zinc-100">Векторизация</h3>
                            <p className="text-xs text-zinc-500">ChromaDB — поисковая база знаний</p>
                        </div>
                        {indexerStats?.index_state?.running && (
                            <Loader2 className="ml-auto size-4 animate-spin text-amber-400" />
                        )}
                    </div>

                    {indexerStats ? (
                        <div className="space-y-4">
                            {/* Total + Sources in a row */}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div className="rounded-xl bg-violet-500/10 px-3 py-2.5 text-center">
                                    <div className="text-[10px] font-medium uppercase text-violet-300/70">Всего чанков</div>
                                    <div className="text-xl font-black text-violet-300">{indexerStats.total_chunks.toLocaleString()}</div>
                                </div>
                                <div className="rounded-xl bg-zinc-800/50 px-3 py-2.5 text-center">
                                    <div className="text-[10px] font-medium uppercase text-zinc-500">Документов</div>
                                    <div className="text-xl font-black text-zinc-300">{indexerStats.index_state.total_documents}</div>
                                </div>
                                <div className="rounded-xl bg-zinc-800/50 px-3 py-2.5 text-center">
                                    <div className="text-[10px] font-medium uppercase text-zinc-500">Watcher</div>
                                    <div className="mt-0.5">
                                        {indexerStats.watcher_active
                                            ? <CheckCircle2 className="mx-auto size-5 text-emerald-400" />
                                            : <XCircle className="mx-auto size-5 text-red-400" />
                                        }
                                    </div>
                                </div>
                                <div className="rounded-xl bg-zinc-800/50 px-3 py-2.5 text-center">
                                    <div className="text-[10px] font-medium uppercase text-zinc-500">Ошибки</div>
                                    <div className={`text-xl font-black ${indexerStats.index_state.errors > 0 ? "text-red-400" : "text-zinc-300"}`}>
                                        {indexerStats.index_state.errors}
                                    </div>
                                </div>
                            </div>

                            {/* Source breakdown */}
                            {Object.keys(indexerStats.by_source).length > 0 && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {Object.entries(indexerStats.by_source).map(([src, count]) => {
                                        const icons: Record<string, string> = { telegram: "📬", zettelkasten: "🗃", session: "📝" };
                                        const labels: Record<string, string> = { telegram: "Telegram", zettelkasten: "Zettelkasten", session: "Сессии" };
                                        return (
                                            <div key={src} className="flex items-center justify-between rounded-xl bg-zinc-800/40 px-3 py-2">
                                                <span className="text-xs text-zinc-400">
                                                    {icons[src] || "📄"} {labels[src] || src}
                                                </span>
                                                <span className="font-mono text-sm font-bold text-zinc-200">{count.toLocaleString()}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Pipeline progress */}
                            <div className="space-y-2">
                                {syncStatus && (
                                    <ProgressBar
                                        value={syncStatus.messages_written}
                                        max={Math.max(syncStatus.messages_received, 1)}
                                        color="from-blue-500 to-purple-500"
                                        label="Sync → Obsidian"
                                        sub={`${syncStatus.messages_received} получено → ${syncStatus.messages_written} записано`}
                                    />
                                )}
                                <ProgressBar
                                    value={indexerStats.total_chunks}
                                    max={Math.max(indexerStats.total_chunks, 1)}
                                    color="from-violet-500 to-cyan-400"
                                    label="Obsidian → ChromaDB"
                                    sub={`${indexerStats.index_state.total_documents} файлов → ${indexerStats.total_chunks} чанков`}
                                />
                            </div>

                            {/* Actions */}
                            {!indexerStats.index_state.running ? (
                                <button
                                    onClick={async () => {
                                        try {
                                            await fetch("/api/indexer/index/full", { method: "POST" });
                                            pollAll();
                                        } catch { /* */ }
                                    }}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 py-2.5 text-xs font-bold text-violet-400 transition hover:bg-violet-500/10"
                                >
                                    <ArrowUpDown className="size-4" />
                                    Запустить полную переиндексацию
                                </button>
                            ) : (
                                <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
                                    <Loader2 className="size-4 animate-spin text-amber-400" />
                                    <span className="text-xs font-medium text-amber-300">Индексация идёт...</span>
                                </div>
                            )}

                            {indexerStats.index_state.last_indexed && (
                                <p className="text-[11px] text-zinc-600">
                                    Последняя индексация: {new Date(indexerStats.index_state.last_indexed).toLocaleString()}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-zinc-500">
                            <WifiOff className="size-4" /> Indexer недоступен
                        </div>
                    )}
                </div>

                {/* ── Telegram Live — 2 cols ──────────────── */}
                <div className="rounded-2xl border border-blue-500/15 bg-zinc-900/60 p-5 backdrop-blur lg:col-span-2">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10">
                            <MessageSquare className="size-4 text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-zinc-100">Telegram</h3>
                            <p className="text-xs text-zinc-500">Синхронизация переписок</p>
                        </div>
                        {syncStatus?.active && (
                            <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                                <Radio className="size-3 animate-pulse" /> Live
                            </span>
                        )}
                    </div>

                    {telegramHealth ? (
                        <div className="space-y-3">
                            {/* Auth */}
                            <div className="flex items-center justify-between rounded-xl bg-zinc-800/40 px-3 py-2">
                                <span className="text-xs text-zinc-400">Авторизация</span>
                                {telegramHealth.auth?.status === "authorized" ? (
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                                        <CheckCircle2 className="size-3.5" /> {telegramHealth.auth.user?.name}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                                        <XCircle className="size-3.5" /> {telegramHealth.auth?.status}
                                    </span>
                                )}
                            </div>

                            {/* Stats grid — enhanced with vectorization */}
                            {syncStatus && (
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { label: "Получено", value: syncStatus.messages_received, icon: "📥" },
                                        { label: "Записано", value: syncStatus.messages_written, icon: "💾" },
                                        { label: "Векторизовано", value: syncStatus.messages_vectorized ?? 0, icon: "🧠" },
                                        { label: "Транскрибировано", value: syncStatus.messages_transcribed ?? 0, icon: "🎤" },
                                        { label: "Пропущено", value: syncStatus.messages_skipped, icon: "⏭" },
                                        { label: "Чатов", value: syncStatus.monitored_chats === "all" ? "Все" : syncStatus.monitored_chats, icon: "💬" },
                                    ].map((s) => (
                                        <div key={s.label} className="rounded-xl bg-zinc-800/30 px-3 py-2">
                                            <div className="text-[10px] font-medium uppercase text-zinc-500">{s.icon} {s.label}</div>
                                            <div className="text-base font-black text-zinc-200">
                                                {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Export status — enhanced */}
                            {exportStatus && exportStatus.status !== "idle" && (
                                <div className={`rounded-xl border p-3 ${
                                    exportStatus.status === "exporting" || exportStatus.status === "vectorizing"
                                        ? "border-blue-500/20 bg-blue-500/5"
                                        : exportStatus.status === "completed"
                                            ? "border-emerald-500/20 bg-emerald-500/5"
                                            : exportStatus.status === "rate_limited"
                                                ? "border-amber-500/20 bg-amber-500/5"
                                                : "border-red-500/20 bg-red-500/5"
                                }`}>
                                    <div className="mb-1.5 flex items-center gap-2">
                                        {exportStatus.running ? (
                                            <Loader2 className={`size-3.5 animate-spin ${
                                                exportStatus.status === "vectorizing" ? "text-violet-400" : "text-blue-400"
                                            }`} />
                                        ) : exportStatus.status === "completed" ? (
                                            <CheckCircle2 className="size-3.5 text-emerald-400" />
                                        ) : (
                                            <AlertTriangle className="size-3.5 text-amber-400" />
                                        )}
                                        <span className={`text-xs font-medium ${
                                            exportStatus.status === "completed" ? "text-emerald-300" :
                                            exportStatus.status === "rate_limited" ? "text-amber-300" :
                                            exportStatus.status === "vectorizing" ? "text-violet-300" :
                                            exportStatus.status === "stopped" ? "text-red-300" : "text-blue-300"
                                        }`}>
                                            {exportStatus.status === "exporting" ? `Экспорт: ${exportStatus.chat_name}` :
                                             exportStatus.status === "vectorizing" ? `Векторизация: ${exportStatus.chat_name}` :
                                             exportStatus.status === "completed" ? "Экспорт завершён ✓" :
                                             exportStatus.status === "rate_limited" ? "⏸ Ожидание (лимиты Telegram)" :
                                             exportStatus.status === "stopped" ? `⏹ Остановлено: ${exportStatus.stop_reason === "user" ? "пользователем" : exportStatus.stop_reason === "rate_limit" ? "лимиты" : "ошибка"}` :
                                             exportStatus.status}
                                        </span>
                                        {exportStatus.running && (
                                            <span className="ml-auto text-[11px] text-zinc-500">
                                                {exportStatus.chats_done}/{exportStatus.chats_total}
                                            </span>
                                        )}
                                    </div>
                                    {exportStatus.running && (
                                        <ProgressBar
                                            value={exportStatus.exported}
                                            max={exportStatus.total || exportStatus.exported * 2}
                                            color={exportStatus.status === "vectorizing" ? "from-violet-500 to-purple-400" : "from-blue-500 to-blue-400"}
                                            label={`${exportStatus.exported.toLocaleString()} сообщений`}
                                        />
                                    )}
                                    {exportStatus.error && (
                                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400">
                                            <AlertTriangle className="size-3" /> {exportStatus.error}
                                        </div>
                                    )}
                                    {/* Tracker summary */}
                                    {exportStatus.tracker && exportStatus.tracker.total_chats_tracked > 0 && (
                                        <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
                                            <span>📦 {exportStatus.tracker.completed} экспорт.</span>
                                            <span>🧠 {exportStatus.tracker.vectorized} вектор.</span>
                                            {exportStatus.tracker.exporting > 0 && (
                                                <span className="text-blue-400">⏳ {exportStatus.tracker.exporting} в процессе</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Transcription */}
                            {telegramHealth.voice_transcription?.enabled && (
                                <div className="flex items-center justify-between rounded-xl bg-zinc-800/40 px-3 py-2">
                                    <span className="text-xs text-zinc-400">🎙 Транскрипция</span>
                                    <span className="font-mono text-xs font-medium text-zinc-300">
                                        {telegramHealth.voice_transcription.transcribed} / {telegramHealth.voice_transcription.errors} err
                                    </span>
                                </div>
                            )}

                            {/* Recent messages with vectorization/transcription status */}
                            {syncStatus?.active && syncStatus.recent_messages.length > 0 && (
                                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden">
                                    <div className="border-b border-zinc-800 px-3 py-1.5 flex items-center justify-between">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Live поток</span>
                                        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                                            <span>V = векторизация</span>
                                            <span>T = транскрипция</span>
                                        </div>
                                    </div>
                                    <div className="max-h-40 overflow-y-auto">
                                        {syncStatus.recent_messages.slice().reverse().slice(0, 8).map((msg, i) => {
                                            const vColors: Record<string, string> = {
                                                pending: "text-zinc-600",
                                                vectorizing: "text-amber-400 animate-pulse",
                                                vectorized: "text-emerald-400",
                                                error: "text-red-400",
                                            };
                                            const tColors: Record<string, string> = {
                                                skipped: "",
                                                pending: "text-zinc-600",
                                                transcribing: "text-amber-400 animate-pulse",
                                                transcribed: "text-cyan-400",
                                                error: "text-red-400",
                                            };
                                            const vStatus = msg.vectorization_status || "pending";
                                            const tStatus = msg.transcription_status || "skipped";
                                            return (
                                                <div key={i} className="flex items-center gap-2 border-b border-zinc-800/30 px-3 py-1.5 text-xs last:border-b-0">
                                                    <span className="shrink-0 font-mono text-[11px] text-zinc-600">{msg.time}</span>
                                                    <span className="shrink-0 max-w-[80px] truncate font-bold text-violet-400">{msg.chat}</span>
                                                    <span className="min-w-0 flex-1 truncate text-zinc-500">
                                                        {msg.from && <span className="text-zinc-600">{msg.from}: </span>}
                                                        {msg.text || "📎"}
                                                    </span>
                                                    {/* Status badges */}
                                                    <span className={`shrink-0 text-[10px] font-bold ${vColors[vStatus] || "text-zinc-600"}`}
                                                          title={`Векторизация: ${vStatus}`}>
                                                        V
                                                    </span>
                                                    {tStatus !== "skipped" && (
                                                        <span className={`shrink-0 text-[10px] font-bold ${tColors[tStatus] || "text-zinc-600"}`}
                                                              title={`Транскрипция: ${tStatus}`}>
                                                            T
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-zinc-500">
                            <WifiOff className="size-4" /> Telegram сервис недоступен
                        </div>
                    )}
                </div>
            </section>

            {/* ══════════════════════════════════════════
                PRIORITY 4 — API Keys & Credits
               ══════════════════════════════════════════ */}
            <section>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                    <Key className="size-4" /> API-ключи и лимиты
                </h3>
                {apiCredits ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {apiCredits.map((svc) => (
                            <div key={svc.name} className={`rounded-2xl border p-4 transition-all ${
                                svc.configured ? "border-white/[0.06] bg-zinc-900/60 hover:border-white/10" : "border-red-500/15 bg-red-500/[0.03]"
                            }`}>
                                <div className="mb-2 flex items-center gap-2">
                                    {svc.configured
                                        ? <CheckCircle2 className="size-4 text-emerald-400" />
                                        : <XCircle className="size-4 text-red-400" />}
                                    <span className="text-sm font-bold text-zinc-200">{svc.nameRu}</span>
                                </div>
                                {svc.keyPreview && (
                                    <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-zinc-800/40 px-2 py-1 font-mono text-[11px] text-zinc-500">
                                        <CreditCard className="size-3 shrink-0 text-zinc-600" /> {svc.keyPreview}
                                    </div>
                                )}
                                {svc.balanceRu && (
                                    <p className="mb-1.5 text-xs leading-relaxed text-zinc-400">{svc.balanceRu}</p>
                                )}
                                {svc.rateLimitRu && (
                                    <div className="flex items-start gap-1.5 text-[11px] text-zinc-500">
                                        <Clock className="mt-0.5 size-3 shrink-0" />
                                        <span>{svc.rateLimitRu}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 className="size-4 animate-spin" /> Проверка API-ключей...
                    </div>
                )}
            </section>

            {/* ══════════════════════════════════════════
                PRIORITY 5 — System info (secondary)
               ══════════════════════════════════════════ */}
            <section className="grid gap-4 sm:grid-cols-2">
                {/* Prompt & Context */}
                <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/40 p-4 backdrop-blur">
                    <div className="mb-3 flex items-center gap-2">
                        <FileText className="size-4 text-emerald-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Системный промпт</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-zinc-800/40 px-3 py-2.5 text-center">
                            <div className="text-[10px] font-medium uppercase text-zinc-500">Модель</div>
                            <div className="text-xs font-bold text-cyan-400">Gemini 2.0 Flash</div>
                        </div>
                        <div className="rounded-xl bg-zinc-800/40 px-3 py-2.5 text-center">
                            <div className="text-[10px] font-medium uppercase text-zinc-500">RAG чанки</div>
                            <div className="text-xs font-bold text-violet-400">
                                {indexerStats ? indexerStats.total_chunks.toLocaleString() : "—"}
                            </div>
                        </div>
                        <div className="rounded-xl bg-zinc-800/40 px-3 py-2.5 text-center">
                            <div className="text-[10px] font-medium uppercase text-zinc-500">Max контекст</div>
                            <div className="text-xs font-bold text-amber-400">15 000</div>
                        </div>
                    </div>
                </div>

                {/* Data Pipeline */}
                <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/40 p-4 backdrop-blur">
                    <div className="mb-3 flex items-center gap-2">
                        <HardDrive className="size-4 text-zinc-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Пайплайн данных</h3>
                        <span className="ml-auto">
                            {syncStatus?.active && indexerStats?.watcher_active ? (
                                <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                                    <Wifi className="size-3" /> Активен
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
                                    <WifiOff className="size-3" /> Частично
                                </span>
                            )}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="flex items-center gap-1 text-blue-400"><MessageSquare className="size-3.5" /> Telegram</span>
                        <span className="text-zinc-600">→</span>
                        <span className="flex items-center gap-1 text-purple-400"><BookOpen className="size-3.5" /> Obsidian</span>
                        <span className="text-zinc-600">→</span>
                        <span className="flex items-center gap-1 text-violet-400"><Database className="size-3.5" /> ChromaDB</span>
                        <span className="text-zinc-600">→</span>
                        <span className="flex items-center gap-1 text-cyan-400"><Bot className="size-3.5" /> Gemini Live</span>
                    </div>
                    {/* Extended pipeline: Shadow Mode */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="flex items-center gap-1 text-indigo-400"><FolderSync className="size-3.5" /> Shadow (Raw_v2)</span>
                        <span className="text-zinc-600">→</span>
                        <span className="flex items-center gap-1 text-fuchsia-400"><Brain className="size-3.5" /> OpenClaw</span>
                        <span className="text-zinc-600">→</span>
                        <span className="flex items-center gap-1 text-teal-400"><Users className="size-3.5" /> CRM (Wiki_v2)</span>
                    </div>
                </div>
            </section>

            {/* ══════════════════════════════════════════
                PRIORITY 6 — OpenClaw Knowledge Graph
               ══════════════════════════════════════════ */}
            <section className="rounded-2xl border border-fuchsia-500/15 bg-zinc-900/60 p-5 backdrop-blur">
                <div className="mb-4 flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-fuchsia-500/10">
                        <Brain className="size-4 text-fuchsia-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-zinc-100">Knowledge Graph</h3>
                        <p className="text-xs text-zinc-500">OpenClaw LLM-Wiki + CRM</p>
                    </div>
                </div>

                {openclawStatus ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div className="rounded-xl bg-fuchsia-500/10 px-3 py-2.5 text-center">
                                <div className="text-[10px] font-medium uppercase text-fuchsia-300/70">Raw файлов</div>
                                <div className="text-xl font-black text-fuchsia-300">{openclawStatus.raw_files}</div>
                            </div>
                            <div className="rounded-xl bg-indigo-500/10 px-3 py-2.5 text-center">
                                <div className="text-[10px] font-medium uppercase text-indigo-300/70">Wiki страниц</div>
                                <div className="text-xl font-black text-indigo-300">{openclawStatus.wiki_pages}</div>
                            </div>
                            <div className="rounded-xl bg-teal-500/10 px-3 py-2.5 text-center">
                                <div className="text-[10px] font-medium uppercase text-teal-300/70">Персоны</div>
                                <div className="text-xl font-black text-teal-300">{openclawStatus.entities.people}</div>
                            </div>
                            <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-center">
                                <div className="text-[10px] font-medium uppercase text-amber-300/70">Задачи</div>
                                <div className="text-xl font-black text-amber-300">{openclawStatus.entities.tasks}</div>
                            </div>
                        </div>

                        {openclawStatus.pending_files > 0 && (
                            <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
                                <AlertTriangle className="size-4 text-amber-400" />
                                <span className="text-xs text-amber-300">
                                    {openclawStatus.pending_files} файлов ожидают обработки OpenClaw
                                </span>
                            </div>
                        )}

                        {/* CRM stats */}
                        {crmStats?.initialized && crmStats.stats && (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {[
                                    { label: "Взаимодействия", value: crmStats.stats.interactions, icon: "💬" },
                                    { label: "Health Alerts", value: crmStats.stats.pending_actions, icon: "❤️" },
                                ].map((s) => (
                                    <div key={s.label} className="rounded-xl bg-zinc-800/30 px-3 py-2">
                                        <div className="text-[10px] font-medium uppercase text-zinc-500">{s.icon} {s.label}</div>
                                        <div className="text-base font-black text-zinc-200">{s.value}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="flex items-center gap-1 text-fuchsia-400"><Brain className="size-3.5" /> Ollama + Qwen2.5</span>
                            <span className="text-zinc-600">→</span>
                            <span className="flex items-center gap-1 text-indigo-400"><FolderSync className="size-3.5" /> Wiki_v2/</span>
                            <span className="text-zinc-600">→</span>
                            <span className="flex items-center gap-1 text-teal-400"><Users className="size-3.5" /> Dunbar CRM</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 className="size-4 animate-spin" /> Проверка OpenClaw...
                    </div>
                )}
            </section>
        </div>
    );
}

// ── Watchdog Widget ─────────────────────────────────────────

interface WatchdogData {
    running: boolean;
    lastCheck: number;
    allHealthy: boolean;
    servicesOnline: number;
    servicesTotal: number;
    circuitBreakers: Record<string, { state: string; failCount: number; lastFail: number }>;
    context: {
        goldenCircle: number;
        goldenCircleNames: string[];
        cacheEntries: number;
        cachedKeys: string[];
    };
}

function WatchdogWidget() {
    const [data, setData] = useState<WatchdogData | null>(null);

    useEffect(() => {
        const fetchWatchdog = async () => {
            try {
                const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(4000) });
                if (res.ok) {
                    const json = await res.json();
                    setData({
                        running: json.watchdog?.running ?? false,
                        lastCheck: json.watchdog?.lastCheck ?? 0,
                        allHealthy: json.watchdog?.allHealthy ?? true,
                        servicesOnline: json.watchdog?.servicesOnline ?? 0,
                        servicesTotal: json.watchdog?.servicesTotal ?? 0,
                        circuitBreakers: json.circuitBreakers ?? {},
                        context: json.context ?? { goldenCircle: 0, goldenCircleNames: [], cacheEntries: 0, cachedKeys: [] },
                    });
                }
            } catch { /* silent */ }
        };

        fetchWatchdog();
        const interval = setInterval(fetchWatchdog, 10000);
        return () => clearInterval(interval);
    }, []);

    if (!data) return null;

    const openBreakers = Object.entries(data.circuitBreakers).filter(([, v]) => v.state === "OPEN");

    return (
        <section>
            <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.04] to-transparent p-5 backdrop-blur">
                <div className="mb-4 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/15">
                        <Activity className="size-5 text-cyan-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-zinc-100">🐕 Watchdog {data.running ? "(активен)" : "(остановлен)"}</h3>
                        <p className="text-xs text-zinc-500">
                            Фоновый мониторинг сервисов + circuit breakers + контекст
                        </p>
                    </div>
                    {data.running && (
                        <span className={`ml-auto rounded-full border px-3 py-1 text-xs font-bold ${
                            data.allHealthy
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                        }`}>
                            {data.allHealthy ? "✅ Все ОК" : `⚠ ${data.servicesOnline}/${data.servicesTotal}`}
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {/* Golden Circle */}
                    <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Users className="size-3.5 text-amber-400" />
                            <span className="text-[11px] font-bold text-zinc-300">Golden Circle</span>
                        </div>
                        <p className="text-lg font-bold text-amber-400">{data.context.goldenCircle}</p>
                        <p className="text-[10px] text-zinc-500 truncate">{data.context.goldenCircleNames.slice(0, 3).join(", ")}...</p>
                    </div>

                    {/* Context Cache */}
                    <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Database className="size-3.5 text-violet-400" />
                            <span className="text-[11px] font-bold text-zinc-300">Кеш контекста</span>
                        </div>
                        <p className="text-lg font-bold text-violet-400">{data.context.cacheEntries}</p>
                        <p className="text-[10px] text-zinc-500">записей в LRU</p>
                    </div>

                    {/* Circuit Breakers */}
                    <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="size-3.5 text-emerald-400" />
                            <span className="text-[11px] font-bold text-zinc-300">Circuit Breakers</span>
                        </div>
                        <p className={`text-lg font-bold ${openBreakers.length > 0 ? "text-red-400" : "text-emerald-400"}`}>
                            {openBreakers.length > 0 ? `${openBreakers.length} OPEN` : "ALL OK"}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                            {Object.keys(data.circuitBreakers).length} инструментов
                        </p>
                    </div>

                    {/* Watchdog Timer */}
                    <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-3">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="size-3.5 text-cyan-400" />
                            <span className="text-[11px] font-bold text-zinc-300">Последняя проверка</span>
                        </div>
                        <p className="text-sm font-bold text-cyan-400">
                            {data.lastCheck > 0 ? `${Math.round((Date.now() - data.lastCheck) / 1000)}с назад` : "—"}
                        </p>
                        <p className="text-[10px] text-zinc-500">каждые 30с</p>
                    </div>
                </div>

                {/* Open circuit breakers warning */}
                {openBreakers.length > 0 && (
                    <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2">
                        <p className="text-xs font-bold text-red-400">⚠️ Заблокированные инструменты:</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                            {openBreakers.map(([name, info]) => (
                                <span key={name} className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-mono text-red-300">
                                    {name} ({info.failCount} ошибок)
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
