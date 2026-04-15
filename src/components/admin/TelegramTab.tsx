"use client";

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
    Plug,
    Phone,
    KeyRound,
    Shield,
    MessageSquare,
    Download,
    Radio,
    CheckCircle2,
    XCircle,
    Loader2,
    RefreshCw,
    Play,
    Square,
    ExternalLink,
    Filter,
    Eye,
    Search,
    Brain,
    Mic,
    AlertTriangle,
    StopCircle,
    RotateCcw,
    X,
    Ban,
    Trash2,
    Undo2,
    ScrollText,
    Clock,
    ChevronDown,
    ChevronRight,
    Zap,
    Archive,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────
interface AuthStatus {
    status: "disconnected" | "not_authorized" | "authorized" | "code_sent" | "2fa_required";
    user?: { id: number; name: string; phone: string; username: string };
}

interface ChatExportProgress {
    chat_id: number;
    chat_name: string;
    last_message_id: number;
    exported_count: number;
    total_count: number;
    percent: number;
    vectorized: boolean;
    vectorized_chunks: number;
    last_export_time: string | null;
    live_sync_active: boolean;
    status: string; // idle | exporting | completed | error
    error: string | null;
}

interface ChatInfo {
    id: number;
    name: string;
    type: string;
    unread_count: number;
    message_count: number;
    last_date: string | null;
    export_progress?: ChatExportProgress | null;
}

interface QueueItem {
    chat_id: number;
    chat_name: string;
    chat_type: string;
    msg_count: number;
    incremental: boolean;
    status: string; // queued | exporting | vectorizing | done | error
    error: string | null;
}

interface ExportStatus {
    running: boolean;
    status: string;
    stop_reason: string | null;
    chat_name: string;
    exported: number;
    total: number | null;
    chats_done: number;
    chats_total: number;
    error: string | null;
    auto_retry_at: string | null;
    queue?: QueueItem[];
    queue_processing?: boolean;
    tracker?: {
        total_chats_tracked: number;
        completed: number;
        vectorized: number;
        exporting: number;
        chats: Record<string, ChatExportProgress>;
    };
}

interface RecentMessage {
    chat: string;
    chat_id?: number;
    text: string;
    from: string;
    time: string;
    vectorization_status?: string;
    transcription_status?: string;
    media_type?: string;
}

interface ExcludedChat {
    id: number;
    name: string;
}

interface SyncStatus {
    active: boolean;
    messages_received: number;
    messages_written: number;
    messages_skipped: number;
    messages_excluded: number;
    messages_vectorized: number;
    messages_transcribed: number;
    last_message_time: string | null;
    last_chat: string | null;
    errors: number;
    monitored_chats: number | string;
    monitored_chat_ids?: number[] | null;
    excluded_chats: ExcludedChat[];
    recent_messages: RecentMessage[];
}

interface ExportLogEntry {
    ts: string;
    level: "info" | "warn" | "error" | "success";
    message: string;
    chat_name: string;
    chat_id: number;
}

// ── API helpers ───────────────────────────────────────────────
async function tgApi<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api/telegram/${path}`, opts);
    return res.json() as Promise<T>;
}

// ── Status Badge ──────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { color: string; label: string }> = {
        authorized: { color: "bg-emerald-500", label: "Подключен" },
        disconnected: { color: "bg-zinc-600", label: "Не подключен" },
        not_authorized: { color: "bg-amber-500", label: "Требуется вход" },
        code_sent: { color: "bg-blue-500", label: "Код отправлен" },
        "2fa_required": { color: "bg-amber-500", label: "Нужен 2FA" },
    };
    const info = map[status] || { color: "bg-zinc-600", label: status };
    return (
        <span className="flex items-center gap-1.5 text-xs font-medium">
            <span className={`size-2 animate-pulse rounded-full ${info.color}`} />
            {info.label}
        </span>
    );
}

// ── Chat type helpers ─────────────────────────────────────────
const CHAT_TYPE_EMOJI: Record<string, string> = {
    private: "👤",
    group: "👥",
    supergroup: "👥",
    channel: "📢",
};

const CHAT_TYPE_LABELS: Record<string, string> = {
    all: "Все",
    private: "Личные",
    group: "Группы",
    channel: "Каналы",
};

type ChatTypeFilter = "all" | "private" | "group" | "channel";

// ── Tracked Chat Row (compact, status-rich) ───────────────────
function TrackedChatRow({
    progress,
    onDelete,
}: {
    progress: ChatExportProgress;
    onDelete: () => void;
}) {
    const isComplete = progress.status === "completed";
    const isExporting = progress.status === "exporting";
    const isError = progress.status === "error";
    const percent = progress.percent || 0;

    const statusColor = isComplete
        ? "text-emerald-400"
        : isExporting
            ? "text-blue-400"
            : isError
                ? "text-red-400"
                : "text-zinc-500";

    const statusIcon = isComplete ? (
        <CheckCircle2 className="size-3.5" />
    ) : isExporting ? (
        <Loader2 className="size-3.5 animate-spin" />
    ) : isError ? (
        <AlertTriangle className="size-3.5" />
    ) : (
        <Clock className="size-3.5" />
    );

    return (
        <div className="group flex items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-3 py-2.5 transition-all hover:border-zinc-700 hover:bg-zinc-800/40">
            {/* Status icon */}
            <div className={`shrink-0 ${statusColor}`}>
                {statusIcon}
            </div>

            {/* Chat name */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-zinc-200">
                        {progress.chat_name || `Chat #${progress.chat_id}`}
                    </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                    <span>{progress.exported_count.toLocaleString()} сообщ.</span>
                    {progress.last_export_time && (
                        <span>
                            {new Date(progress.last_export_time).toLocaleDateString("ru-RU", {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                            })}
                        </span>
                    )}
                </div>
            </div>

            {/* Progress bar (only if exporting) */}
            {isExporting && (
                <div className="w-16 shrink-0">
                    <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${Math.max(percent, 2)}%` }}
                        />
                    </div>
                    <span className="block text-center text-[9px] text-blue-400">{Math.round(percent)}%</span>
                </div>
            )}

            {/* Status badges */}
            <div className="flex shrink-0 items-center gap-1">
                {isComplete && (
                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
                        ✓
                    </span>
                )}
                {progress.live_sync_active && (
                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300" title="Live">
                        <Radio className="inline size-2.5" />
                    </span>
                )}
                {progress.vectorized && (
                    <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-400" title={`${progress.vectorized_chunks} chunks`}>
                        <Brain className="inline size-2.5" />
                    </span>
                )}
                {isError && progress.error && (
                    <span className="max-w-[100px] truncate rounded-md bg-red-500/10 px-1.5 py-0.5 text-[9px] text-red-400" title={progress.error}>
                        {progress.error}
                    </span>
                )}
            </div>

            {/* Delete button */}
            <button
                type="button"
                onClick={onDelete}
                className="shrink-0 rounded-lg p-1 text-zinc-700 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                title="Удалить из Obsidian"
            >
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}

// ── Log entry row ─────────────────────────────────────────────
function LogRow({ entry }: { entry: ExportLogEntry }) {
    const colors: Record<string, string> = {
        info: "text-zinc-400 border-l-zinc-600",
        warn: "text-amber-400 border-l-amber-500",
        error: "text-red-400 border-l-red-500",
        success: "text-emerald-400 border-l-emerald-500",
    };
    const icons: Record<string, string> = {
        info: "ℹ",
        warn: "⚠",
        error: "✗",
        success: "✓",
    };
    const c = colors[entry.level] || colors.info;
    return (
        <div className={`flex items-start gap-2 border-l-2 px-2.5 py-1.5 ${c}`}>
            <span className="mt-0.5 shrink-0 text-[10px] font-bold">{icons[entry.level]}</span>
            <div className="min-w-0 flex-1">
                <span className="text-[11px] leading-tight">
                    {entry.chat_name && (
                        <span className="mr-1 font-semibold text-violet-400">[{entry.chat_name}]</span>
                    )}
                    {entry.message}
                </span>
            </div>
            <span className="shrink-0 text-[9px] text-zinc-600">
                {new Date(entry.ts).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                })}
            </span>
        </div>
    );
}

// ── Chat Card for Selection ───────────────────────────────────
function ChatCard({
    chat,
    selected,
    onToggle,
    exportProgress,
}: {
    chat: ChatInfo;
    selected: boolean;
    onToggle: () => void;
    exportProgress?: ChatExportProgress | null;
}) {
    const isExported = exportProgress?.status === "completed";
    const total = exportProgress?.total_count || chat.message_count || 0;

    return (
        <button
            type="button"
            onClick={onToggle}
            className={`group flex items-center gap-2 rounded-xl border p-2.5 text-left transition-all ${
                selected
                    ? "border-violet-500/40 bg-violet-500/10 shadow-lg shadow-violet-500/5"
                    : isExported
                        ? "border-emerald-500/15 bg-zinc-900/60 hover:border-emerald-500/25"
                        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
            }`}
        >
            <div className={`flex size-4 shrink-0 items-center justify-center rounded border transition-all ${
                selected
                    ? "border-violet-500 bg-violet-500 text-white"
                    : "border-zinc-700 bg-zinc-800"
            }`}>
                {selected && <CheckCircle2 className="size-2.5" />}
            </div>
            <span className="text-xs">{CHAT_TYPE_EMOJI[chat.type] || "💬"}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">
                {chat.name}
            </span>
            <span className="shrink-0 text-[10px] text-zinc-600">{total.toLocaleString()}</span>
            {isExported && <CheckCircle2 className="size-3 shrink-0 text-emerald-500/60" />}
        </button>
    );
}

// ── Main Component ────────────────────────────────────────────
export function TelegramTab() {
    // ── Auth state ────────────────────────────────────────────
    const [authStatus, setAuthStatus] = useState<AuthStatus>({ status: "disconnected" });
    const [apiId, setApiId] = useState("");
    const [apiHash, setApiHash] = useState("");
    const [phone, setPhone] = useState("");
    const [code, setCode] = useState("");
    const [password2fa, setPassword2fa] = useState("");
    const [loading, setLoading] = useState("");
    const [error, setError] = useState("");

    // ── Chat state ────────────────────────────────────────────
    const [chats, setChats] = useState<ChatInfo[]>([]);
    const [chatFilter, setChatFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState<ChatTypeFilter>("all");

    // ── Export state ──────────────────────────────────────────
    const [exportSelected, setExportSelected] = useState<Set<number>>(() => {
        if (typeof window === "undefined") return new Set();
        try {
            const saved = localStorage.getItem("tg_export_selected");
            if (saved) return new Set(JSON.parse(saved) as number[]);
        } catch { /* ignore */ }
        return new Set();
    });
    const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
    const [incrementalExport, setIncrementalExport] = useState(true);
    const [exportLogs, setExportLogs] = useState<ExportLogEntry[]>([]);
    const [showSelector, setShowSelector] = useState(false);
    const [showLogs, setShowLogs] = useState(false);

    // ── Sync state ────────────────────────────────────────────
    const [syncMonitorAll, setSyncMonitorAll] = useState(false);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Persist selection to localStorage ─────────────────────
    useEffect(() => {
        try {
            localStorage.setItem("tg_export_selected", JSON.stringify([...exportSelected]));
        } catch { /* ignore */ }
    }, [exportSelected]);

    // ── Filtered chats ────────────────────────────────────────
    const filteredChats = useMemo(() => {
        return chats.filter((c) => {
            if (typeFilter !== "all") {
                const isGroup = typeFilter === "group" && (c.type === "group" || c.type === "supergroup");
                const isMatch = c.type === typeFilter || isGroup;
                if (!isMatch) return false;
            }
            if (chatFilter && !c.name.toLowerCase().includes(chatFilter.toLowerCase())) return false;
            return true;
        });
    }, [chats, typeFilter, chatFilter]);

    const counts = useMemo(() => ({
        all: chats.length,
        private: chats.filter((c) => c.type === "private").length,
        group: chats.filter((c) => c.type === "group" || c.type === "supergroup").length,
        channel: chats.filter((c) => c.type === "channel").length,
    }), [chats]);

    // ── Tracked chats from tracker ────────────────────────────
    const trackedChats = useMemo((): ChatExportProgress[] => {
        if (!exportStatus?.tracker?.chats) return [];
        return Object.values(exportStatus.tracker.chats)
            .sort((a, b) => {
                // Exporting first, then completed, then errors
                const order: Record<string, number> = { exporting: 0, error: 1, completed: 2, idle: 3 };
                const oa = order[a.status] ?? 4;
                const ob = order[b.status] ?? 4;
                if (oa !== ob) return oa - ob;
                // Then by last export time desc
                return (b.last_export_time || "").localeCompare(a.last_export_time || "");
            });
    }, [exportStatus]);

    const trackerSummary = exportStatus?.tracker;

    // ── Check auth on mount ──────────────────────────────────
    useEffect(() => {
        tgApi<AuthStatus>("auth/status").then(setAuthStatus).catch(() => { });
    }, []);

    // ── Poll export & sync status ────────────────────────────
    useEffect(() => {
        if (authStatus.status !== "authorized") return;

        const poll = async () => {
            try {
                const [exp, sync] = await Promise.all([
                    tgApi<ExportStatus>("export/status"),
                    tgApi<SyncStatus>("sync/status"),
                ]);
                setExportStatus(exp);
                setSyncStatus(sync);
            } catch { }
        };
        poll();
        // Also load logs on mount
        tgApi<{ logs: ExportLogEntry[] }>("export/logs?limit=100")
            .then((r) => setExportLogs(r.logs || []))
            .catch(() => { });

        pollRef.current = setInterval(poll, 2000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [authStatus.status]);

    // ── Refresh logs periodically when visible ────────────────
    useEffect(() => {
        if (!showLogs) return;
        const interval = setInterval(() => {
            tgApi<{ logs: ExportLogEntry[] }>("export/logs?limit=100")
                .then((r) => setExportLogs(r.logs || []))
                .catch(() => { });
        }, 3000);
        return () => clearInterval(interval);
    }, [showLogs]);

    // ── Auth handlers ────────────────────────────────────────
    const handleConnect = useCallback(async () => {
        setLoading("connect");
        setError("");
        try {
            const res = await tgApi<AuthStatus>("auth/connect", "POST", {
                api_id: parseInt(apiId, 10),
                api_hash: apiHash,
            });
            setAuthStatus(res);
        } catch (e) {
            setError(`Ошибка подключения: ${(e as Error).message}`);
        } finally {
            setLoading("");
        }
    }, [apiId, apiHash]);

    const handleSendCode = useCallback(async () => {
        setLoading("code");
        setError("");
        try {
            await tgApi("auth/send-code", "POST", { phone });
            setAuthStatus((prev) => ({ ...prev, status: "code_sent" }));
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        } finally {
            setLoading("");
        }
    }, [phone]);

    const handleVerify = useCallback(async () => {
        setLoading("verify");
        setError("");
        try {
            const res = await tgApi<AuthStatus>("auth/verify", "POST", {
                code,
                password: password2fa || undefined,
            });
            setAuthStatus(res);
            if (res.status === "authorized") {
                const c = await tgApi<{ chats: ChatInfo[] }>("chats");
                setChats(c.chats || []);
            }
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        } finally {
            setLoading("");
        }
    }, [code, password2fa]);

    // ── Chat handlers ────────────────────────────────────────
    const loadChats = useCallback(async () => {
        setLoading("chats");
        try {
            const res = await tgApi<{ chats: ChatInfo[] }>("chats");
            setChats(res.chats || []);
        } catch (e) {
            setError(`Ошибка загрузки чатов: ${(e as Error).message}`);
        } finally {
            setLoading("");
        }
    }, []);

    // ── Export handlers ──────────────────────────────────────
    const toggleExportChat = useCallback((id: number) => {
        setExportSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        setExportSelected(new Set(filteredChats.map((c) => c.id)));
    }, [filteredChats]);

    const handleDeselectAll = useCallback(() => {
        setExportSelected(new Set());
    }, []);

    const handleAddToQueue = useCallback(async () => {
        if (exportSelected.size === 0) {
            setError("Выберите хотя бы один чат");
            return;
        }
        setLoading("export");
        setError("");
        try {
            await tgApi("export/queue", "POST", {
                chat_ids: Array.from(exportSelected),
                incremental: incrementalExport,
            });
            // Don't clear selection — user asked to keep it
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        } finally {
            setLoading("");
        }
    }, [exportSelected, incrementalExport]);

    const handleRemoveFromQueue = useCallback(async (chatIds: number[]) => {
        try {
            await tgApi("export/queue/remove", "POST", { chat_ids: chatIds });
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleClearDoneQueue = useCallback(async () => {
        try {
            await tgApi("export/queue/clear-done", "POST");
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleRetryChat = useCallback(async (chatIds: number[]) => {
        try {
            await tgApi("export/queue/retry", "POST", { chat_ids: chatIds });
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleCancelExport = useCallback(async () => {
        try {
            await tgApi("export/cancel", "POST");
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    // ── Sync handlers ────────────────────────────────────────
    const handleSyncStart = useCallback(async () => {
        try {
            // syncMonitorAll=false → send null (backend defaults to exported chats)
            // syncMonitorAll=true  → send chat_ids=[] explicitly (backend treats as "all")
            const body = syncMonitorAll ? { chat_ids: null, monitor_all: true } : {};
            await tgApi("sync/start", "POST", body);
            const s = await tgApi<SyncStatus>("sync/status");
            setSyncStatus(s);
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, [syncMonitorAll]);

    const handleSyncStop = useCallback(async () => {
        try {
            await tgApi("sync/stop", "POST");
            const s = await tgApi<SyncStatus>("sync/status");
            setSyncStatus(s);
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    // ── Exclude/manage handlers ───────────────────────────────
    const handleExcludeChat = useCallback(async (chatId: number, chatName: string) => {
        try {
            await tgApi("sync/exclude", "POST", { chat_id: chatId, chat_name: chatName });
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleUnexcludeChat = useCallback(async (chatId: number) => {
        try {
            await tgApi("sync/unexclude", "POST", { chat_id: chatId });
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleClearExcluded = useCallback(async () => {
        try {
            await tgApi("sync/clear-excluded", "POST");
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleRemoveMessage = useCallback(async (index: number) => {
        try {
            await tgApi("sync/remove-message", "POST", { index });
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    const handleClearFeed = useCallback(async () => {
        try {
            await tgApi("sync/clear-messages", "POST");
        } catch (e) {
            setError(`Ошибка: ${(e as Error).message}`);
        }
    }, []);

    // ── Delete from Obsidian handler ─────────────────────────
    const handleDeleteChat = useCallback(async (chatId: number, chatName: string, chatType: string) => {
        if (!confirm(`Удалить чат «${chatName}» из Obsidian? Все экспортированные файлы будут удалены.`)) return;
        try {
            await tgApi("export/delete-chat", "POST", { chat_id: chatId, chat_name: chatName, chat_type: chatType });
            const data = await tgApi<{ chats: ChatInfo[] }>("chats");
            setChats(data.chats || []);
        } catch (e) {
            setError(`Ошибка удаления: ${(e as Error).message}`);
        }
    }, []);

    // ── Helper: get export progress for a chat ───────────────
    const getExportProgress = useCallback((chatId: number): ChatExportProgress | null => {
        const chat = chats.find(c => c.id === chatId);
        if (chat?.export_progress) return chat.export_progress;
        if (!exportStatus?.tracker?.chats) return null;
        const p = exportStatus.tracker.chats[String(chatId)];
        return p || null;
    }, [chats, exportStatus]);

    // ── Render ────────────────────────────────────────────────
    return (
        <div className="space-y-5 pb-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-zinc-100">
                        <MessageSquare className="size-5 text-blue-400" />
                        Telegram → Obsidian
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-500">
                        Архив переписок + live-синхронизация + автовекторизация
                    </p>
                </div>
                <StatusBadge status={authStatus.status} />
            </div>

            {/* Error toast */}
            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {error}
                    <button type="button" onClick={() => setError("")} className="ml-auto text-red-400/60 hover:text-red-400">×</button>
                </div>
            )}

            {/* ══════════════════════════════════════════════════
                Section 1: Connection
               ══════════════════════════════════════════════════ */}
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-300">
                    <Plug className="size-4 text-violet-400" />
                    Подключение к Telegram
                </h3>

                {authStatus.status === "authorized" ? (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                        <CheckCircle2 className="size-5 text-emerald-400" />
                        <div>
                            <div className="text-sm font-medium text-zinc-200">
                                {authStatus.user?.name}
                            </div>
                            <div className="text-xs text-zinc-500">
                                @{authStatus.user?.username || "—"} · {authStatus.user?.phone}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Step 1: API credentials */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                                <KeyRound className="size-3" />
                                API ID & Hash
                                <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer" className="ml-1 text-violet-400 hover:text-violet-300">
                                    <ExternalLink className="size-3" />
                                </a>
                            </label>
                            <div className="flex gap-2">
                                <input type="text" placeholder="API ID" value={apiId} onChange={(e) => setApiId(e.target.value)}
                                    className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none" />
                                <input type="password" placeholder="API Hash" value={apiHash} onChange={(e) => setApiHash(e.target.value)}
                                    className="flex-[2] rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none" />
                            </div>
                            <button type="button" onClick={handleConnect} disabled={!apiId || !apiHash || loading === "connect"}
                                className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 disabled:opacity-50">
                                {loading === "connect" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
                                Подключить
                            </button>
                        </div>

                        {/* Step 2: Phone + Code */}
                        {(authStatus.status === "not_authorized" || authStatus.status === "code_sent" || authStatus.status === "2fa_required") && (
                            <div className="space-y-2 border-t border-zinc-800 pt-4">
                                <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                                    <Phone className="size-3" /> Номер телефона
                                </label>
                                <div className="flex gap-2">
                                    <input type="tel" placeholder="+7..." value={phone} onChange={(e) => setPhone(e.target.value)}
                                        className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none" />
                                    <button type="button" onClick={handleSendCode} disabled={!phone || loading === "code"}
                                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50">
                                        {loading === "code" ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
                                        Получить код
                                    </button>
                                </div>

                                {(authStatus.status === "code_sent" || authStatus.status === "2fa_required") && (
                                    <div className="space-y-2 pt-2">
                                        <input type="text" placeholder="Код из Telegram" value={code} onChange={(e) => setCode(e.target.value)}
                                            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none" />
                                        <input type="password" placeholder="Пароль 2FA (если есть)" value={password2fa} onChange={(e) => setPassword2fa(e.target.value)}
                                            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none" />
                                        <button type="button" onClick={handleVerify} disabled={!code || loading === "verify"}
                                            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-50">
                                            {loading === "verify" ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}
                                            Войти
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ══════════════════════════════════════════════════
                Section 2: EXPORT TO OBSIDIAN
               ══════════════════════════════════════════════════ */}
            {authStatus.status === "authorized" && (
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                    {/* ── Header ────────────────────────────────── */}
                    <div className="flex items-center gap-3 px-5 py-3">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                            <Archive className="size-4 text-blue-400" />
                            Экспорт в Obsidian
                        </h3>
                        <div className="flex items-center gap-1.5 ml-auto">
                            {trackerSummary && (
                                <>
                                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                        <CheckCircle2 className="size-2.5" /> {trackerSummary.completed}
                                    </span>
                                    <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
                                        <Brain className="size-2.5" /> {trackerSummary.vectorized}
                                    </span>
                                    {(() => {
                                        const queueItems = exportStatus?.queue || [];
                                        const activeCount = queueItems.filter((q: QueueItem) => q.status === "exporting" || q.status === "vectorizing").length;
                                        const queuedCount = queueItems.filter((q: QueueItem) => q.status === "queued").length;
                                        return (
                                            <>
                                                {activeCount > 0 && (
                                                    <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                                                        <Loader2 className="size-2.5 animate-spin" /> {activeCount}
                                                    </span>
                                                )}
                                                {queuedCount > 0 && (
                                                    <span className="flex items-center gap-1 rounded-full bg-zinc-700/40 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                                                        <Clock className="size-2.5" /> {queuedCount}
                                                    </span>
                                                )}
                                            </>
                                        );
                                    })()}
                                    {syncStatus?.active && (
                                        <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                                            <Radio className="size-2.5 animate-pulse" /> Live
                                        </span>
                                    )}
                                </>
                            )}
                            {exportStatus?.queue_processing && (
                                <button type="button" onClick={handleCancelExport}
                                    className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400 transition hover:bg-red-500/20">
                                    <StopCircle className="size-3" /> Стоп
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setShowSelector(!showSelector)}
                                className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400 transition-all hover:bg-violet-500/20"
                            >
                                <Download className="size-3" />
                                Добавить чаты
                                {showSelector ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            </button>
                        </div>
                    </div>

                    {/* ── Unified list: queue + tracked chats ────── */}
                    {(() => {
                        const queueItems: QueueItem[] = exportStatus?.queue || [];
                        const queueIds = new Set(queueItems.map((q: QueueItem) => q.chat_id));
                        const queueOrder: Record<string, number> = { exporting: 0, vectorizing: 1, queued: 2, error: 3, done: 4 };

                        type UnifiedRow = {
                            id: number; name: string;
                            qStatus?: string; qError?: string | null;
                            msgCount: number; tracker?: ChatExportProgress;
                        };

                        const rows: UnifiedRow[] = [];

                        // Queue items first (sorted: active → queued → error → done)
                        [...queueItems]
                            .sort((a: QueueItem, b: QueueItem) => (queueOrder[a.status] ?? 5) - (queueOrder[b.status] ?? 5))
                            .forEach((q: QueueItem) => {
                                rows.push({
                                    id: q.chat_id,
                                    name: q.chat_name || `#${q.chat_id}`,
                                    qStatus: q.status,
                                    qError: q.error,
                                    msgCount: q.msg_count,
                                    tracker: trackedChats.find(t => t.chat_id === q.chat_id),
                                });
                            });

                        // Tracked chats NOT in queue
                        trackedChats.forEach(t => {
                            if (!queueIds.has(t.chat_id)) {
                                rows.push({
                                    id: t.chat_id,
                                    name: t.chat_name,
                                    msgCount: t.exported_count,
                                    tracker: t,
                                });
                            }
                        });

                        const hasDone = queueItems.some((q: QueueItem) => q.status === "done");

                        if (rows.length === 0) {
                            return (
                                <div className="flex flex-col items-center gap-1.5 border-t border-zinc-800/50 py-8 text-center">
                                    <Archive className="size-6 text-zinc-700" />
                                    <p className="text-xs text-zinc-500">Нажмите «Добавить чаты» → выберите → «В очередь»</p>
                                </div>
                            );
                        }

                        return (
                            <div className="max-h-[40vh] overflow-y-auto border-t border-zinc-800/50">
                                {hasDone && (
                                    <div className="flex justify-end px-4 py-1">
                                        <button type="button" onClick={handleClearDoneQueue}
                                            className="text-[10px] text-zinc-600 transition hover:text-zinc-300">
                                            Очистить готовые ✓
                                        </button>
                                    </div>
                                )}
                                {rows.map((item) => {
                                    const isExp = item.qStatus === "exporting";
                                    const isVec = item.qStatus === "vectorizing";
                                    const isQueued = item.qStatus === "queued";
                                    const isErr = item.qStatus === "error";
                                    const isQDone = item.qStatus === "done";
                                    const t = item.tracker;
                                    const isDone = t?.status === "completed";
                                    const isVectorized = !!t?.vectorized;
                                    const count = t?.exported_count || item.msgCount;
                                    const lastTime = t?.last_export_time;

                                    // Left border accent
                                    const border = isExp ? "border-l-blue-500" : isVec ? "border-l-violet-500"
                                        : isErr ? "border-l-red-500/60" : isQueued ? "border-l-zinc-600"
                                        : "border-l-transparent";

                                    // Status icon
                                    let icon: React.ReactNode;
                                    if (isExp) icon = <Loader2 className="size-3.5 animate-spin text-blue-400" />;
                                    else if (isVec) icon = <Brain className="size-3.5 animate-pulse text-violet-400" />;
                                    else if (isQueued) icon = <Clock className="size-3.5 text-zinc-500" />;
                                    else if (isErr) icon = <AlertTriangle className="size-3.5 text-red-400" />;
                                    else if (isVectorized) icon = <CheckCircle2 className="size-3.5 text-emerald-400" />;
                                    else if (isDone) icon = <CheckCircle2 className="size-3.5 text-emerald-400/60" />;
                                    else icon = <div className="size-3.5 rounded-full border border-zinc-700" />;

                                    // Live-sync check: all exported chats are monitored by default
                                    const excludedIds = new Set((syncStatus?.excluded_chats || []).map(ec => ec.id));
                                    const isLive = syncStatus?.active && !excludedIds.has(item.id) && (
                                        syncStatus.monitored_chats === "all" || isDone
                                    );

                                    // Progress %
                                    const pct = isExp && t?.exported_count && t?.total_messages && t.total_messages > 0
                                        ? Math.min(100, Math.round((t.exported_count / t.total_messages) * 100)) : null;

                                    return (
                                        <div key={item.id}
                                            className={`group border-l-2 ${border} px-4 py-1.5 transition-colors hover:bg-zinc-800/30`}>
                                            <div className="flex items-center gap-2.5">
                                                <div className="shrink-0 w-4">{icon}</div>
                                                <div className="min-w-0 flex-1">
                                                    <span className="truncate text-[13px] font-medium text-zinc-200 block">{item.name}</span>
                                                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                                                        <span>{count.toLocaleString()} сообщ.</span>
                                                        {lastTime && <span>· {new Date(lastTime).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })}</span>}
                                                        {isExp && <span className="text-blue-400 font-medium">Экспорт{pct !== null ? ` ${pct}%` : "..."}</span>}
                                                        {isVec && <span className="text-violet-400 font-medium">Векторизация...</span>}
                                                        {isQueued && <span className="text-zinc-500">В очереди</span>}
                                                    </div>
                                                    {pct !== null && (
                                                        <div className="mt-0.5 h-[3px] w-full overflow-hidden rounded-full bg-zinc-800">
                                                            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                                                                style={{ width: `${pct}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Right badges */}
                                                <div className="flex items-center gap-0.5 shrink-0">
                                                    {isDone && <span className="rounded p-0.5" title="Экспортировано"><CheckCircle2 className="size-3 text-emerald-400" /></span>}
                                                    {isLive && <span className="rounded p-0.5" title="Live-синхронизация"><Radio className="size-3 text-cyan-400" /></span>}
                                                    {isVectorized && <span className="rounded p-0.5" title="Векторизовано"><Brain className="size-3 text-violet-400" /></span>}
                                                    {(isQueued || isQDone) && (
                                                        <button type="button" onClick={() => handleRemoveFromQueue([item.id])}
                                                            className="rounded p-0.5 text-zinc-700 opacity-0 transition hover:text-red-400 group-hover:opacity-100" title="Убрать">
                                                            <X className="size-3" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Error block with description + retry */}
                                            {isErr && item.qError && (
                                                <div className="mt-1 ml-6 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                                                    <p className="text-[11px] leading-relaxed text-red-300">{item.qError}</p>
                                                    <div className="mt-1.5 flex items-center gap-2">
                                                        <button type="button"
                                                            onClick={() => handleRetryChat([item.id])}
                                                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-blue-500">
                                                            <RotateCcw className="size-3" />
                                                            Перезапустить
                                                        </button>
                                                        <button type="button"
                                                            onClick={() => handleRemoveFromQueue([item.id])}
                                                            className="rounded-lg px-2 py-1 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300">
                                                            Убрать
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* ── Chat Selector (collapsible) ──────────── */}
                    {showSelector && (
                        <div className="border-t border-zinc-800 bg-zinc-950/50 p-4">
                            <div className="mb-2 flex items-center gap-1.5">
                                <div className="flex flex-wrap gap-0.5">
                                    {(["all", "private", "group", "channel"] as const).map((t) => (
                                        <button key={t} type="button" onClick={() => setTypeFilter(t)}
                                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${typeFilter === t
                                                ? "bg-violet-500/20 text-violet-300"
                                                : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
                                            }`}>
                                            {CHAT_TYPE_LABELS[t]} ({counts[t]})
                                        </button>
                                    ))}
                                </div>
                                <div className="relative flex-1 ml-1">
                                    <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-zinc-600" />
                                    <input type="text" placeholder="Поиск..."
                                        value={chatFilter} onChange={(e) => setChatFilter(e.target.value)}
                                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-1 pl-6 pr-2 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none" />
                                </div>
                                <button type="button" onClick={handleSelectAll}
                                    className="rounded-md border border-zinc-700 px-1.5 py-1 text-[10px] text-violet-400 hover:bg-zinc-800">Все</button>
                                <button type="button" onClick={handleDeselectAll}
                                    className="rounded-md border border-zinc-700 px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800">Снять</button>
                                <button type="button" onClick={loadChats} disabled={loading === "chats"}
                                    className="rounded-md border border-zinc-700 p-1 text-zinc-500 transition hover:bg-zinc-800">
                                    {loading === "chats" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                                </button>
                            </div>

                            <div className="mb-2 grid max-h-[30vh] grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                                {filteredChats.map((c) => (
                                    <ChatCard key={c.id} chat={c} selected={exportSelected.has(c.id)}
                                        onToggle={() => toggleExportChat(c.id)} exportProgress={getExportProgress(c.id)} />
                                ))}
                                {filteredChats.length === 0 && (
                                    <div className="col-span-full py-4 text-center text-[11px] text-zinc-600">
                                        {chats.length === 0 ? "Нажмите ↻ для загрузки" : "Ничего не найдено"}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2 border-t border-zinc-800/50 pt-2">
                                <button type="button" onClick={handleAddToQueue}
                                    disabled={exportSelected.size === 0 || loading === "export"}
                                    className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-[11px] font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-40">
                                    {loading === "export" ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                                    В очередь ({exportSelected.size})
                                </button>
                                <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer select-none">
                                    <input type="checkbox" checked={incrementalExport}
                                        onChange={(e) => setIncrementalExport(e.target.checked)}
                                        className="size-3 rounded border-zinc-600 bg-zinc-800 accent-violet-500" />
                                    Только новые
                                </label>
                                <span className="ml-auto text-[10px] text-zinc-600">{exportSelected.size} / {chats.length}</span>
                            </div>
                        </div>
                    )}

                    {/* ── Logs (collapsible) ──────────────────── */}
                    <div className="border-t border-zinc-800">
                        <button type="button" onClick={() => setShowLogs(!showLogs)}
                            className="flex w-full items-center gap-2 px-5 py-2 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-800/30 hover:text-zinc-400">
                            <ScrollText className="size-3" /> Журнал ({exportLogs.length})
                            {showLogs ? <ChevronDown className="ml-auto size-3" /> : <ChevronRight className="ml-auto size-3" />}
                        </button>
                        {showLogs && (
                            <div className="max-h-44 overflow-y-auto border-t border-zinc-800/50 bg-zinc-950/50">
                                {exportLogs.length === 0 ? (
                                    <div className="py-4 text-center text-[11px] text-zinc-600">Логов пока нет</div>
                                ) : (
                                    [...exportLogs].reverse().map((entry, i) => (
                                        <LogRow key={i} entry={entry} />
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </section>
            )}



            {/* ══════════════════════════════════════════════════
                Section 3: Live Sync
               ══════════════════════════════════════════════════ */}
            {authStatus.status === "authorized" && (
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                            <Radio className={`size-4 ${syncStatus?.active ? "text-emerald-400 animate-pulse" : "text-zinc-500"}`} />
                            Live-синхронизация
                        </h3>
                        <div className="flex gap-2">
                            <button type="button" onClick={syncStatus?.active ? handleSyncStop : handleSyncStart}
                                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${syncStatus?.active
                                    ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                                    : "bg-emerald-600 text-white hover:bg-emerald-500"
                                }`}>
                                {syncStatus?.active ? (
                                    <><Square className="size-3" /> Остановить</>
                                ) : (
                                    <><Play className="size-3" /> Запустить</>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Monitor mode toggle */}
                    <div className="mb-3 flex items-center gap-3">
                        <button type="button" onClick={() => setSyncMonitorAll(true)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${syncMonitorAll
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                            }`}>
                            <Eye className="size-3" /> Все чаты
                        </button>
                        <button type="button" onClick={() => setSyncMonitorAll(false)}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${!syncMonitorAll
                                ? "bg-violet-500/20 text-violet-300"
                                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                            }`}>
                            <Filter className="size-3" /> Только экспортированные
                        </button>
                    </div>

                    {/* Stats grid */}
                    {syncStatus && (
                        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                            {[
                                { label: "Получено", value: syncStatus.messages_received, icon: "📥" },
                                { label: "Записано", value: syncStatus.messages_written, icon: "💾" },
                                { label: "Вектор.", value: syncStatus.messages_vectorized ?? 0, icon: "🧠" },
                                { label: "Транскр.", value: syncStatus.messages_transcribed ?? 0, icon: "🎤" },
                                { label: "Исключено", value: syncStatus.messages_excluded ?? 0, icon: "🚫" },
                                { label: "Ошибки", value: syncStatus.errors, icon: "⚠️" },
                                { label: "Чатов", value: syncStatus.monitored_chats === "all" ? "Все" : `${syncStatus.monitored_chats}`, icon: "💬" },
                            ].map((item) => (
                                <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                                    <div className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">
                                        {item.icon} {item.label}
                                    </div>
                                    <div className="mt-0.5 truncate text-sm font-bold text-zinc-300">
                                        {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Recent messages feed */}
                    {syncStatus?.active && syncStatus.recent_messages && syncStatus.recent_messages.length > 0 && (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden">
                            <div className="border-b border-zinc-800 px-3 py-1.5 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                    Live поток ({syncStatus.recent_messages.length})
                                </span>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                                        <span className="flex items-center gap-0.5"><Brain className="size-3 text-emerald-400" /> V</span>
                                        <span className="flex items-center gap-0.5"><Mic className="size-3 text-cyan-400" /> T</span>
                                    </div>
                                    <button type="button" onClick={handleClearFeed}
                                        className="flex items-center gap-1 rounded-md border border-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                                        title="Очистить ленту">
                                        <Trash2 className="size-3" /> Очистить
                                    </button>
                                </div>
                            </div>
                            <div className="max-h-56 overflow-y-auto">
                                {syncStatus.recent_messages.slice().reverse().slice(0, 15).map((msg, i) => {
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
                                    const vs = msg.vectorization_status || "pending";
                                    const ts = msg.transcription_status || "skipped";
                                    const realIndex = syncStatus.recent_messages.length - 1 - i;
                                    return (
                                        <div key={i} className="group flex items-center gap-1.5 border-b border-zinc-800/30 px-2 py-1.5 text-xs last:border-b-0 hover:bg-zinc-800/30">
                                            <span className="shrink-0 font-mono text-[11px] text-zinc-600">{msg.time}</span>
                                            <span className="shrink-0 max-w-[80px] truncate font-bold text-violet-400">{msg.chat}</span>
                                            <span className="min-w-0 flex-1 truncate text-zinc-500">
                                                {msg.from && <span className="text-zinc-600">{msg.from}: </span>}
                                                {msg.text || "📎"}
                                            </span>
                                            <span className={`shrink-0 text-[10px] font-bold ${vColors[vs] || "text-zinc-600"}`}
                                                  title={`Векторизация: ${vs}`}>V</span>
                                            {ts !== "skipped" && (
                                                <span className={`shrink-0 text-[10px] font-bold ${tColors[ts] || "text-zinc-600"}`}
                                                      title={`Транскрипция: ${ts}`}>T</span>
                                            )}
                                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                                {msg.chat_id && (
                                                    <button type="button"
                                                        onClick={() => handleExcludeChat(msg.chat_id!, msg.chat)}
                                                        className="rounded p-0.5 text-zinc-600 transition hover:bg-red-500/20 hover:text-red-400"
                                                        title={`Исключить «${msg.chat}»`}>
                                                        <Ban className="size-3.5" />
                                                    </button>
                                                )}
                                                <button type="button"
                                                    onClick={() => handleRemoveMessage(realIndex)}
                                                    className="rounded p-0.5 text-zinc-600 transition hover:bg-zinc-700 hover:text-zinc-400"
                                                    title="Удалить">
                                                    <X className="size-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Excluded chats list */}
                    {syncStatus?.excluded_chats && syncStatus.excluded_chats.length > 0 && (
                        <div className="mt-3 rounded-xl border border-red-500/10 bg-red-500/5 p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                                    <Ban className="size-3.5" />
                                    Исключённые ({syncStatus.excluded_chats.length})
                                </span>
                                <button type="button" onClick={handleClearExcluded}
                                    className="flex items-center gap-1 rounded-md border border-zinc-700/50 px-2 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300">
                                    <Undo2 className="size-3" /> Восстановить
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {syncStatus.excluded_chats.map((ec) => (
                                    <span key={ec.id}
                                        className="group inline-flex items-center gap-1 rounded-lg border border-red-500/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
                                        {ec.name}
                                        <button type="button" onClick={() => handleUnexcludeChat(ec.id)}
                                            className="rounded p-0.5 text-zinc-600 transition hover:text-emerald-400" title="Вернуть">
                                            <Undo2 className="size-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* ── Info footer ──────────────────────────────── */}
            <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 px-4 py-3 text-xs text-zinc-600">
                <p>📂 Vault: <code className="text-zinc-500">📬 Telegram/{"{тип}"}/{"{чат}"}/{"{дата}"}.md</code></p>
                <p className="mt-1">🔌 Obsidian REST API + прямая запись в файловую систему (fallback)</p>
                <p className="mt-1">🎤 Транскрипция голосовых: <span className="font-medium text-emerald-400">OpenAI Whisper (авто)</span></p>
                <p className="mt-1">🧠 Автовекторизация: <span className="font-medium text-violet-400">ChromaDB (real-time)</span></p>
            </div>
        </div>
    );
}
