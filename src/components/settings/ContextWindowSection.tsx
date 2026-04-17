"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, ChevronDown, ChevronUp, Trash2, SlidersHorizontal } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";

interface SlotItem {
    id: string;
    text: string;
    tags: string[];
    createdAt: string;
    score: number;
}

interface SlotData {
    name: string;
    emoji: string;
    color: string;
    usedChars: number;
    maxChars: number;
    itemCount: number;
    items: SlotItem[];
}

interface ContextData {
    totalTokens: number;
    maxTokens: number;
    percentUsed: number;
    slots: Record<string, SlotData>;
}

function formatChars(chars: number): string {
    if (chars >= 1000) return `${(chars / 1000).toFixed(1)}K`;
    return `${chars}`;
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return "только что";
    if (diffH < 24) return `${diffH}ч назад`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}д назад`;
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function SlotCard({ slot, onDeleteItem }: { slot: SlotData; onDeleteItem?: (id: string) => void }) {
    const [expanded, setExpanded] = useState(false);
    const fillPercent = slot.maxChars > 0 ? (slot.usedChars / slot.maxChars) * 100 : 0;

    return (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
            {/* Header */}
            <button
                className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/40"
                onClick={() => setExpanded(!expanded)}
            >
                <span className="text-lg">{slot.emoji}</span>
                <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200">
                            {slot.name}
                        </span>
                        <span className="text-xs text-zinc-500">
                            ({slot.itemCount})
                        </span>
                    </div>
                    {/* Mini progress bar */}
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-800">
                        <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: slot.color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(fillPercent, 100)}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                        />
                    </div>
                </div>
                <span className="text-xs font-mono text-zinc-400">
                    {formatChars(slot.usedChars)}/{formatChars(slot.maxChars)}
                </span>
                {slot.items.length > 0 && (
                    expanded ? (
                        <ChevronUp className="size-4 text-zinc-500" />
                    ) : (
                        <ChevronDown className="size-4 text-zinc-500" />
                    )
                )}
            </button>

            {/* Expanded items */}
            <AnimatePresence>
                {expanded && slot.items.length > 0 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-zinc-800/40 px-4 py-2">
                            {slot.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/30"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-zinc-300 leading-relaxed truncate">
                                            {item.text}
                                        </p>
                                        <div className="mt-1 flex items-center gap-2">
                                            {item.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                            <span className="text-[10px] text-zinc-600">
                                                {formatDate(item.createdAt)}
                                            </span>
                                            <span className="text-[10px] text-zinc-600">
                                                score: {item.score.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                    {onDeleteItem && (
                                        <button
                                            className="shrink-0 rounded-md p-1 text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                                            onClick={() => onDeleteItem(item.id)}
                                            title="Удалить из памяти"
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export function ContextWindowSection() {
    const [data, setData] = useState<ContextData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const priorities = useSettingsStore((s) => s.contextPriorities);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/context-summary");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json() as ContextData;
            setData(json);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка загрузки");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const handleDeleteItem = useCallback(async (memoryId: string) => {
        try {
            await fetch("/api/voice-memory", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memoryId, userId: "anonymous" }),
            });
            void fetchData();
        } catch {
            // silent
        }
    }, [fetchData]);

    if (loading) {
        return (
            <div className="flex flex-col items-center gap-3 py-12">
                <div className="size-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                <p className="text-sm text-zinc-500">Анализ контекстного окна...</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex flex-col items-center gap-3 py-12">
                <p className="text-sm text-red-400">{error ?? "Нет данных"}</p>
                <button
                    className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
                    onClick={() => void fetchData()}
                >
                    Повторить
                </button>
            </div>
        );
    }

    // Recalculate maxChars from user priorities (overrides API defaults)
    const CONTEXT_BUDGET = 80000;
    const slotPriorityMap: Record<string, keyof typeof priorities> = {
        critical: "critical", active: "active", predicted: "predicted",
        recent: "recent", vault: "vault", tools: "tools",
    };
    const adjustedData = { ...data, slots: { ...data.slots } };
    for (const [slotKey, priorityKey] of Object.entries(slotPriorityMap)) {
        const slot = adjustedData.slots[slotKey];
        if (slot) {
            adjustedData.slots[slotKey] = {
                ...slot,
                maxChars: Math.floor(CONTEXT_BUDGET * (priorities[priorityKey] / 100)),
            };
        }
    }

    // Ordered slots for display
    const slotOrder = ["critical", "active", "predicted", "recent", "vault", "tools", "basePrompt"] as const;
    const totalUsedChars = Object.values(adjustedData.slots).reduce((sum, s) => sum + s.usedChars, 0);

    return (
        <div className="flex flex-col gap-5">
            {/* Header with refresh */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-zinc-100">
                        Контекстное окно
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                        Gemini 2.5 Flash Live • 128K токенов
                    </p>
                </div>
                <button
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                    onClick={() => void fetchData()}
                >
                    <RefreshCw className="size-3.5" />
                    Обновить
                </button>
            </div>

            {/* Main progress bar */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
                <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold text-zinc-100">
                        {adjustedData.totalTokens.toLocaleString("ru-RU")}
                    </span>
                    <span className="text-sm text-zinc-500">
                        / {adjustedData.maxTokens.toLocaleString("ru-RU")} токенов
                    </span>
                </div>

                {/* Segmented progress bar */}
                <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-zinc-800">
                    {slotOrder.map((key) => {
                        const slot = adjustedData.slots[key];
                        if (!slot || slot.usedChars === 0) return null;
                        const pct = (slot.usedChars / (totalUsedChars || 1)) * adjustedData.percentUsed;
                        return (
                            <motion.div
                                key={key}
                                className="h-full"
                                style={{ backgroundColor: slot.color }}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                title={`${slot.emoji} ${slot.name}: ${formatChars(slot.usedChars)}`}
                            />
                        );
                    })}
                </div>

                <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-zinc-500">
                        {adjustedData.percentUsed.toFixed(1)}% использовано
                    </span>
                    <span className="text-xs text-zinc-500">
                        {formatChars(totalUsedChars)} символов
                    </span>
                </div>

                {/* Legend */}
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                    {slotOrder.map((key) => {
                        const slot = adjustedData.slots[key];
                        if (!slot) return null;
                        return (
                            <div key={key} className="flex items-center gap-1">
                                <div
                                    className="size-2 rounded-full"
                                    style={{ backgroundColor: slot.color }}
                                />
                                <span className="text-[10px] text-zinc-500">
                                    {slot.emoji} {slot.name}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Slot cards */}
            <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-zinc-400">
                    Распределение по слотам
                </h4>
                {slotOrder.map((key) => {
                    const slot = adjustedData.slots[key];
                    if (!slot) return null;
                    return (
                        <SlotCard
                            key={key}
                            slot={slot}
                            onDeleteItem={
                                key === "critical" || key === "active" || key === "recent"
                                    ? handleDeleteItem
                                    : undefined
                            }
                        />
                    );
                })}
            </div>

            {/* Priority Sliders */}
            <PrioritySliders />

            {/* Info banner */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="text-xs leading-relaxed text-amber-200/70">
                    <span className="font-semibold text-amber-300">💡 Как это работает:</span>{" "}
                    Замечания (🔴) загружаются ПЕРВЫМИ при каждой сессии и никогда не вытесняются.
                    Когда вы говорите &ldquo;не спрашивай лишнее&rdquo; — это замечание сохраняется в память
                    и ассистент будет помнить его в каждой новой сессии.
                </p>
            </div>
        </div>
    );
}

const SLOT_META: Array<{ key: keyof ReturnType<typeof useSettingsStore.getState>["contextPriorities"]; name: string; emoji: string; color: string; min: number }> = [
    { key: "critical", name: "Замечания", emoji: "🔴", color: "#ff6b6b", min: 15 },
    { key: "active", name: "Задачи", emoji: "🟠", color: "#ffa94d", min: 5 },
    { key: "predicted", name: "Предсказано", emoji: "🟡", color: "#ffd43b", min: 5 },
    { key: "recent", name: "Свежее", emoji: "🔵", color: "#4dabf7", min: 5 },
    { key: "vault", name: "Vault", emoji: "⚪", color: "#e9ecef", min: 5 },
    { key: "tools", name: "Инструменты", emoji: "🟣", color: "#c084fc", min: 5 },
];

function PrioritySliders() {
    const priorities = useSettingsStore((s) => s.contextPriorities);
    const setPriorities = useSettingsStore((s) => s.setContextPriorities);
    const [showSliders, setShowSliders] = useState(false);

    const handleChange = useCallback(
        (slotKey: string, newVal: number) => {
            const current = { ...priorities };
            const oldVal = current[slotKey as keyof typeof current];
            const delta = newVal - oldVal;

            // Set the changed slot
            current[slotKey as keyof typeof current] = newVal;

            // Rebalance others proportionally
            const otherKeys = SLOT_META.filter((s) => s.key !== slotKey).map((s) => s.key);
            const otherTotal = otherKeys.reduce((sum, k) => sum + current[k], 0);
            if (otherTotal > 0) {
                let remaining = -delta;
                for (const k of otherKeys) {
                    const share = current[k] / otherTotal;
                    const adjust = Math.round(share * remaining);
                    const meta = SLOT_META.find((s) => s.key === k)!;
                    current[k] = Math.max(meta.min, current[k] + adjust);
                }
            }

            // Normalize to exactly 100
            const total = Object.values(current).reduce((a, b) => a + b, 0);
            if (total !== 100) {
                const diff = 100 - total;
                // Add diff to the largest non-changed slot
                const largest = otherKeys.sort((a, b) => current[b] - current[a])[0];
                current[largest] += diff;
            }

            setPriorities(current);
        },
        [priorities, setPriorities],
    );

    return (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
            <button
                className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-800/40"
                onClick={() => setShowSliders(!showSliders)}
            >
                <SlidersHorizontal className="size-4 text-violet-400" />
                <span className="flex-1 text-left text-sm font-medium text-zinc-200">
                    Приоритеты слотов
                </span>
                <span className="text-xs text-zinc-500">Настроить</span>
                {showSliders ? (
                    <ChevronUp className="size-4 text-zinc-500" />
                ) : (
                    <ChevronDown className="size-4 text-zinc-500" />
                )}
            </button>

            <AnimatePresence>
                {showSliders && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-zinc-800/40 px-4 py-3 flex flex-col gap-3">
                            {SLOT_META.map(({ key, name, emoji, color, min }) => {
                                const budgetChars = Math.floor(80000 * (priorities[key] / 100));
                                return (
                                <div key={key} className="flex items-center gap-3">
                                    <span className="w-5 text-center">{emoji}</span>
                                    <span className="w-24 text-xs text-zinc-400 truncate">{name}</span>
                                    <input
                                        type="range"
                                        min={min}
                                        max={60}
                                        value={priorities[key]}
                                        onChange={(e) => handleChange(key, parseInt(e.target.value))}
                                        className="flex-1 h-1.5 appearance-none rounded-full bg-zinc-700 cursor-pointer"
                                        style={{
                                            accentColor: color,
                                        }}
                                    />
                                    <span className="w-16 text-right text-xs font-mono text-zinc-300">
                                        {priorities[key]}% <span className="text-zinc-600">({formatChars(budgetChars)})</span>
                                    </span>
                                </div>
                                );
                            })}
                            <div className="mt-1 flex items-center justify-between">
                                <button
                                    className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
                                    onClick={() => setPriorities({
                                        critical: 28, active: 14, predicted: 16,
                                        recent: 14, vault: 15, tools: 13,
                                    })}
                                >
                                    ↩ Сбросить
                                </button>
                                <span className="text-[10px] text-zinc-600">
                                    Σ = {Object.values(priorities).reduce((a, b) => a + b, 0)}% • Бюджет: 80K символов
                                </span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

