"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ListChecks, Plus, CheckCircle2, Circle, Clock,
    XCircle, ChevronRight, AlertTriangle, Loader2,
    Sparkles, ArrowUpRight, Filter
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

const STATUS_CONFIG = {
    pending: { icon: Circle, label: "Ожидает", color: "text-zinc-400", bg: "bg-zinc-500/10" },
    in_progress: { icon: Clock, label: "В работе", color: "text-blue-400", bg: "bg-blue-500/10" },
    done: { icon: CheckCircle2, label: "Готово", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    cancelled: { icon: XCircle, label: "Отменено", color: "text-red-400", bg: "bg-red-500/10" },
};

const PRIORITY_COLORS = {
    low: "border-zinc-700 text-zinc-500",
    medium: "border-blue-500/30 text-blue-400",
    high: "border-orange-500/30 text-orange-400",
    critical: "border-red-500/30 text-red-400 animate-pulse",
};

type FilterStatus = "all" | TaskItem["status"];

export function VoiceTaskSidebar({ userId }: { userId: string }) {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterStatus>("all");
    const [expandedTask, setExpandedTask] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newDescription, setNewDescription] = useState("");

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        try {
            const allTasks: TaskItem[] = [];

            // Source 1: ChromaDB via /api/tasks
            try {
                const params = new URLSearchParams({ userId });
                if (filter !== "all") params.set("status", filter);
                const res = await fetch(`/api/tasks?${params}`, { signal: AbortSignal.timeout(4000) });
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

            // Deduplicate by title
            const seen = new Set<string>();
            const unique = allTasks.filter((t) => {
                const key = t.title.toLowerCase().trim();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            // Apply filter client-side if we merged local tasks
            const filtered = filter === "all" ? unique : unique.filter((t) => t.status === filter);
            setTasks(filtered);
        } catch {
            /* ignore */
        } finally {
            setLoading(false);
        }
    }, [userId, filter]);

    useEffect(() => {
        void fetchTasks();
    }, [fetchTasks]);

    const handleCreateTask = useCallback(async () => {
        if (!newTitle.trim()) return;
        setCreating(true);
        try {
            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: newTitle,
                    description: newDescription,
                    userId,
                    assignee: "antigravity",
                }),
            });
            if (res.ok) {
                const data = await res.json() as { task: TaskItem };
                setTasks((prev) => [data.task, ...prev]);
                setNewTitle("");
                setNewDescription("");
            }
        } catch {
            /* ignore */
        } finally {
            setCreating(false);
        }
    }, [newTitle, newDescription, userId]);

    const activeCount = tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length;
    const doneCount = tasks.filter((t) => t.status === "done").length;

    const handleStatusChange = useCallback(async (taskId: string, newStatus: TaskItem["status"]) => {
        // Optimistic update
        setTasks((prev) =>
            prev.map((t) =>
                t.id === taskId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t
            )
        );
        try {
            await fetch(`/api/tasks`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, status: newStatus, userId }),
            });
        } catch {
            // Revert on failure
            void fetchTasks();
        }
    }, [userId, fetchTasks]);

    const filteredTasks = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="shrink-0 border-b border-zinc-800 px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-violet-500/10">
                            <ListChecks className="size-4 text-violet-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-100">Задачи</h3>
                            <p className="text-[10px] text-zinc-600">
                                {activeCount} активных · {doneCount} выполнено
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={fetchTasks}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                    >
                        <Loader2 className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                </div>

                {/* Status filters */}
                <div className="flex gap-1 mt-2">
                    {(["all", "pending", "in_progress", "done"] as FilterStatus[]).map((s) => (
                        <button
                            key={s}
                            onClick={() => setFilter(s)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                                filter === s
                                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                            }`}
                        >
                            {s === "all" ? "Все" : STATUS_CONFIG[s].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Quick create */}
            <div className="shrink-0 px-4 py-2 border-b border-zinc-800/50">
                <div className="flex gap-2">
                    <input
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleCreateTask();
                            }
                        }}
                        placeholder="Новая задача для Антигравити..."
                        className="flex-1 bg-zinc-800/30 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50"
                    />
                    <button
                        onClick={handleCreateTask}
                        disabled={creating || !newTitle.trim()}
                        className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-400 text-xs font-medium transition-all hover:bg-violet-500/30 disabled:opacity-40"
                    >
                        {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    </button>
                </div>
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto scrollbar-none px-3 py-2 space-y-1.5">
                {loading && tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="size-6 animate-spin text-violet-400 mb-2" />
                        <p className="text-xs text-zinc-600">Загрузка задач...</p>
                    </div>
                ) : filteredTasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Sparkles className="size-8 text-zinc-700 mb-3" />
                        <p className="text-sm text-zinc-500">Нет задач</p>
                        <p className="text-[10px] text-zinc-600 mt-1">
                            Скажите голосом &quot;создай задачу&quot; или добавьте вручную
                        </p>
                    </div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        {filteredTasks.map((task) => {
                            const statusCfg = STATUS_CONFIG[task.status];
                            const StatusIcon = statusCfg.icon;
                            const isExpanded = expandedTask === task.id;

                            return (
                                <motion.div
                                    key={task.id}
                                    layout
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className={`rounded-xl border ${
                                        task.priority === "critical"
                                            ? "border-red-500/20 bg-red-500/5"
                                            : task.priority === "high"
                                            ? "border-orange-500/10 bg-zinc-900/30"
                                            : "border-zinc-800/50 bg-zinc-900/30"
                                    } p-3 cursor-pointer transition-all hover:border-zinc-700`}
                                    onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                                >
                                    <div className="flex items-start gap-2">
                                        <StatusIcon className={`size-4 mt-0.5 shrink-0 ${statusCfg.color}`} />
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-xs font-medium ${
                                                task.status === "done" ? "text-zinc-500 line-through" : "text-zinc-200"
                                            }`}>
                                                {task.title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${PRIORITY_COLORS[task.priority]}`}>
                                                    {task.priority}
                                                </span>
                                                <span className="text-[9px] text-zinc-600">
                                                    {new Date(task.createdAt).toLocaleDateString("ru-RU", {
                                                        day: "2-digit",
                                                        month: "short",
                                                    })}
                                                </span>
                                                {task.assignee && (
                                                    <span className="text-[9px] text-zinc-600 flex items-center gap-0.5">
                                                        <ArrowUpRight className="size-2" />
                                                        {task.assignee}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <ChevronRight className={`size-3 text-zinc-600 transition-transform ${
                                            isExpanded ? "rotate-90" : ""
                                        }`} />
                                    </div>

                                    {/* Expanded details */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: "auto" }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="mt-2 pt-2 border-t border-zinc-800/50 space-y-2">
                                                    {task.description && (
                                                        <p className="text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
                                                            {task.description}
                                                        </p>
                                                    )}

                                                    {/* Tags */}
                                                    {task.tags && task.tags.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {task.tags.map((tag) => (
                                                                <span
                                                                    key={tag}
                                                                    className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] text-violet-400"
                                                                >
                                                                    #{tag}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Action buttons */}
                                                    <div className="flex items-center gap-1.5 pt-1">
                                                        {task.status === "pending" && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void handleStatusChange(task.id, "in_progress");
                                                                }}
                                                                className="flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-medium text-blue-400 transition hover:bg-blue-500/20"
                                                            >
                                                                <ArrowUpRight className="size-3" />
                                                                Запустить
                                                            </button>
                                                        )}
                                                        {(task.status === "pending" || task.status === "in_progress") && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void handleStatusChange(task.id, "done");
                                                                }}
                                                                className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-400 transition hover:bg-emerald-500/20"
                                                            >
                                                                <CheckCircle2 className="size-3" />
                                                                Готово
                                                            </button>
                                                        )}
                                                        {task.status !== "cancelled" && task.status !== "done" && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void handleStatusChange(task.id, "cancelled");
                                                                }}
                                                                className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-medium text-red-400 transition hover:bg-red-500/20"
                                                            >
                                                                <XCircle className="size-3" />
                                                                Отменить
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
