"use client";

import { useEffect, useState, useCallback } from "react";
import {
    ClipboardList, Loader2, CheckCircle2, Circle, PlayCircle,
    XCircle, RefreshCw, AlertTriangle, ArrowRight,
} from "lucide-react";

interface TaskItem {
    id: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "done" | "cancelled";
    priority: "low" | "medium" | "high" | "critical";
    createdAt: string;
    updatedAt: string;
    assignee: string;
    tags: string[];
}

const STATUS_ICONS: Record<TaskItem["status"], React.ReactNode> = {
    pending: <Circle className="size-4 text-zinc-500" />,
    in_progress: <PlayCircle className="size-4 text-cyan-400 animate-pulse" />,
    done: <CheckCircle2 className="size-4 text-emerald-400" />,
    cancelled: <XCircle className="size-4 text-red-400" />,
};

const STATUS_LABELS: Record<TaskItem["status"], string> = {
    pending: "Ожидает",
    in_progress: "В работе",
    done: "Выполнено",
    cancelled: "Отменено",
};

const PRIORITY_COLORS: Record<TaskItem["priority"], string> = {
    low: "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
    medium: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    high: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    critical: "text-red-400 bg-red-500/10 border-red-500/20",
};

const PRIORITY_LABELS: Record<TaskItem["priority"], string> = {
    low: "Низкий",
    medium: "Средний",
    high: "Высокий",
    critical: "Критичный",
};

export function VoiceTasksPanel() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTasks = useCallback(async () => {
        try {
            setLoading(true);
            const allTasks: TaskItem[] = [];

            // Source 1: ChromaDB via /api/tasks
            try {
                const res = await fetch("/api/tasks", { signal: AbortSignal.timeout(4000) });
                if (res.ok) {
                    const data = await res.json() as { tasks: TaskItem[] };
                    allTasks.push(...(data.tasks || []));
                }
            } catch { /* ChromaDB offline */ }

            // Source 2: Local filesystem via /api/tasks/local
            try {
                const res = await fetch("/api/tasks/local", { signal: AbortSignal.timeout(3000) });
                if (res.ok) {
                    const data = await res.json() as { tasks: TaskItem[] };
                    allTasks.push(...(data.tasks || []));
                }
            } catch { /* filesystem read failed */ }

            // Deduplicate by title (same task may exist in both)
            const seen = new Set<string>();
            const unique = allTasks.filter((t) => {
                const key = t.title.toLowerCase().trim();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            setTasks(unique);
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(fetchTasks, 10000);
        return () => clearInterval(interval);
    }, [fetchTasks]);

    const pendingCount = tasks.filter((t) => t.status === "pending").length;
    const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
    const doneCount = tasks.filter((t) => t.status === "done").length;

    // Sort: in_progress first, then pending, then done
    const sortedTasks = [...tasks].sort((a, b) => {
        const order = { in_progress: 0, pending: 1, cancelled: 2, done: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

    return (
        <section>
            <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] to-transparent p-5 backdrop-blur">
                {/* Header */}
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-violet-500/15">
                            <ClipboardList className="size-5 text-violet-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-zinc-100">
                                Задачи от голосового ассистента
                            </h3>
                            <p className="text-xs text-zinc-500">
                                Создаются голосом → выполняются Антигравити
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Status counters */}
                        <div className="hidden items-center gap-1.5 sm:flex">
                            {pendingCount > 0 && (
                                <span className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
                                    <Circle className="size-2.5" /> {pendingCount}
                                </span>
                            )}
                            {inProgressCount > 0 && (
                                <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400">
                                    <PlayCircle className="size-2.5" /> {inProgressCount}
                                </span>
                            )}
                            {doneCount > 0 && (
                                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                                    <CheckCircle2 className="size-2.5" /> {doneCount}
                                </span>
                            )}
                        </div>
                        <button
                            onClick={fetchTasks}
                            className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-1.5 text-zinc-500 transition hover:bg-zinc-700/50 hover:text-zinc-300"
                        >
                            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                {loading && tasks.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-5 animate-spin text-violet-400" />
                        <span className="ml-2 text-sm text-zinc-500">Загрузка задач...</span>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 rounded-xl bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                        <AlertTriangle className="size-4 shrink-0" />
                        <span>Сервис задач недоступен — нужен запущенный Indexer (ChromaDB)</span>
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="rounded-xl bg-zinc-800/30 px-4 py-6 text-center">
                        <ClipboardList className="mx-auto mb-2 size-8 text-zinc-600" />
                        <p className="text-sm text-zinc-500">Нет активных задач</p>
                        <p className="mt-1 text-xs text-zinc-600">
                            Скажите ассистенту: &quot;Создай задачу — ...&quot;
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sortedTasks.slice(0, 10).map((task) => (
                            <div
                                key={task.id}
                                className={`group flex items-start gap-3 rounded-xl border px-4 py-3 transition-all ${
                                    task.status === "in_progress"
                                        ? "border-cyan-500/20 bg-cyan-500/[0.03] hover:border-cyan-500/30"
                                        : task.status === "done"
                                            ? "border-emerald-500/10 bg-emerald-500/[0.02] opacity-60 hover:opacity-80"
                                            : "border-white/[0.04] bg-zinc-900/40 hover:border-zinc-700/50"
                                }`}
                            >
                                <div className="mt-0.5 shrink-0">
                                    {STATUS_ICONS[task.status]}
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`truncate text-sm font-semibold ${
                                            task.status === "done" ? "text-zinc-500 line-through" : "text-zinc-200"
                                        }`}>
                                            {task.title}
                                        </span>
                                        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase ${PRIORITY_COLORS[task.priority]}`}>
                                            {PRIORITY_LABELS[task.priority]}
                                        </span>
                                    </div>
                                    {task.description && (
                                        <p className="mt-1 truncate text-xs leading-relaxed text-zinc-500">
                                            {task.description}
                                        </p>
                                    )}
                                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-600">
                                        <span className="flex items-center gap-1">
                                            <ArrowRight className="size-2.5" />
                                            {task.assignee === "antigravity" ? "🤖 Антигравити" : "👤 Антон"}
                                        </span>
                                        <span>{STATUS_LABELS[task.status]}</span>
                                        <span>{new Date(task.createdAt).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {tasks.length > 10 && (
                            <p className="text-center text-xs text-zinc-600">
                                + ещё {tasks.length - 10} задач
                            </p>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
