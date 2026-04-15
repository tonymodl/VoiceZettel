"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X } from "lucide-react";

/* ── Icon data ── */
interface IconDef {
    name: string;         // lucide icon name
    label: string;        // Russian display name
    emoji: string;        // Fallback emoji
    categories: string[]; // "Базовые" | "Знания" | "Продуктивность"
}

const ICON_DATABASE: IconDef[] = [
    // Базовые
    { name: "bookmark", label: "Термины", emoji: "📑", categories: ["Базовые", "Знания"] },
    { name: "target", label: "Цели", emoji: "🎯", categories: ["Базовые", "Продуктивность"] },
    { name: "clock", label: "Дедлайны", emoji: "⏰", categories: ["Базовые", "Продуктивность"] },
    { name: "calendar", label: "Встречи", emoji: "📅", categories: ["Базовые", "Продуктивность"] },
    { name: "crosshair", label: "Фокус", emoji: "🎯", categories: ["Базовые", "Продуктивность"] },
    { name: "quote", label: "Цитаты", emoji: "💬", categories: ["Базовые", "Знания"] },
    { name: "help-circle", label: "Вопрос", emoji: "❓", categories: ["Базовые"] },
    { name: "link", label: "Ресурсы", emoji: "🔗", categories: ["Базовые"] },
    // Знания
    { name: "beaker", label: "Теории", emoji: "🧪", categories: ["Знания"] },
    { name: "sparkles", label: "Открытия", emoji: "✨", categories: ["Знания"] },
    { name: "book-open", label: "Книги", emoji: "📚", categories: ["Знания"] },
    { name: "film", label: "Фильмы", emoji: "🎬", categories: ["Знания"] },
    { name: "music", label: "Музыка", emoji: "🎵", categories: ["Знания"] },
    { name: "newspaper", label: "Статьи", emoji: "📰", categories: ["Знания"] },
    { name: "headphones", label: "Подкасты", emoji: "🎧", categories: ["Знания"] },
    { name: "video", label: "Видео", emoji: "📹", categories: ["Знания"] },
    // Продуктивность
    { name: "notebook", label: "Дневник", emoji: "📓", categories: ["Продуктивность"] },
    { name: "moon", label: "Сны", emoji: "🌙", categories: ["Продуктивность"] },
    { name: "heart-handshake", label: "Благодарности", emoji: "🤝", categories: ["Продуктивность"] },
    { name: "rewind", label: "Воспоминания", emoji: "📼", categories: ["Продуктивность"] },
    { name: "trophy", label: "Достижения", emoji: "🏆", categories: ["Продуктивность"] },
    { name: "compass", label: "Навигация", emoji: "🧭", categories: ["Продуктивность"] },
    { name: "zap", label: "Инсайты", emoji: "⚡", categories: ["Продуктивность"] },
    { name: "brain", label: "Ментальное", emoji: "🧠", categories: ["Знания", "Продуктивность"] },
    { name: "flame", label: "Мотивация", emoji: "🔥", categories: ["Продуктивность"] },
    { name: "shield", label: "Привычки", emoji: "🛡", categories: ["Продуктивность"] },
    { name: "star", label: "Избранное", emoji: "⭐", categories: ["Базовые"] },
    { name: "briefcase", label: "Работа", emoji: "💼", categories: ["Продуктивность"] },
    { name: "home", label: "Дом", emoji: "🏠", categories: ["Базовые"] },
    { name: "graduation-cap", label: "Учёба", emoji: "🎓", categories: ["Знания"] },
];

const FILTER_TABS = ["Все", "Базовые", "Знания", "Продуктивность"] as const;

interface IconPickerProps {
    open: boolean;
    onClose: () => void;
    onSelect: (icon: { name: string; label: string; emoji: string }) => void;
}

export function IconPicker({ open, onClose, onSelect }: IconPickerProps) {
    const [search, setSearch] = useState("");
    const [tab, setTab] = useState<string>("Все");

    const filtered = useMemo(() => {
        let list = ICON_DATABASE;
        if (tab !== "Все") {
            list = list.filter((i) => i.categories.includes(tab));
        }
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter((i) => i.label.toLowerCase().includes(q));
        }
        return list;
    }, [tab, search]);

    const handleSelect = useCallback((icon: IconDef) => {
        onSelect({ name: icon.name, label: icon.label, emoji: icon.emoji });
        setSearch("");
        setTab("Все");
    }, [onSelect]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-zinc-800 bg-zinc-950 shadow-2xl"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3">
                        <h3 className="text-sm font-semibold text-zinc-300">Выбор иконки</h3>
                        <button
                            onClick={onClose}
                            className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                        >
                            <X className="size-4" />
                        </button>
                    </div>

                    {/* Search */}
                    <div className="px-5 pb-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" />
                            <input
                                type="text"
                                className="w-full rounded-xl border border-white/5 bg-zinc-800/60 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
                                placeholder="Поиск иконки"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Filter tabs */}
                    <div className="flex gap-2 overflow-x-auto px-5 pb-3 scrollbar-none">
                        {FILTER_TABS.map((t) => (
                            <button
                                key={t}
                                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                                    tab === t
                                        ? "bg-violet-600 text-white"
                                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                                }`}
                                onClick={() => setTab(t)}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    {/* Grid */}
                    <div className="flex-1 overflow-y-auto px-5 pb-6 scrollbar-none">
                        <div className="grid grid-cols-4 gap-3">
                            {filtered.map((icon) => (
                                <button
                                    key={icon.name}
                                    className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-3 transition-all hover:border-violet-500/30 hover:bg-zinc-800"
                                    onClick={() => handleSelect(icon)}
                                >
                                    <span className="text-2xl">{icon.emoji}</span>
                                    <span className="text-[10px] leading-tight text-zinc-500 text-center">
                                        {icon.label}
                                    </span>
                                </button>
                            ))}
                            {filtered.length === 0 && (
                                <p className="col-span-4 text-center text-xs text-zinc-600 py-4">
                                    Ничего не найдено
                                </p>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
