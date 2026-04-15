"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { MoreVertical, Lightbulb, Heart, Users, ListChecks, CloudOff, Tag } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { NoteListItem, NoteCategory } from "@/types/notes";
import { CATEGORY_LABEL_SINGULAR, SOURCE_LABELS } from "@/types/notes";
import { stripMarkdown } from "@/lib/stripMarkdown";
import { useSettingsStore } from "@/stores/settingsStore";

/* ── Visual config ── */

const BUILTIN_CATEGORY_ICON: Record<string, React.ElementType> = {
    idea: Lightbulb,
    fact: Heart,
    persona: Users,
    task: ListChecks,
};

const CATEGORY_CHIP_STYLE: Record<string, string> = {
    idea: "border-violet-500/40 text-violet-300",
    fact: "border-violet-500/40 text-violet-300",
    task: "border-violet-500/40 text-violet-300",
    persona: "border-violet-500/40 text-violet-300",
};

const SOURCE_CHIP: Record<string, string> = {
    voice: "bg-zinc-800 text-zinc-400",
    text: "bg-zinc-800 text-zinc-400",
};

interface NoteCardProps {
    note: NoteListItem;
    onView: (note: NoteListItem) => void;
    onEdit: (note: NoteListItem) => void;
    onDelete: (id: string) => void;
}

export function NoteCard({ note, onView, onEdit, onDelete }: NoteCardProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const customWidgets = useSettingsStore((s) => s.customWidgets);

    // Resolve icon: built-in or custom widget
    const Icon = BUILTIN_CATEGORY_ICON[note.category] ?? Tag;
    const chipStyle = CATEGORY_CHIP_STYLE[note.category] ?? "border-zinc-500/40 text-zinc-300";

    // Resolve label for custom categories
    const categoryLabel = CATEGORY_LABEL_SINGULAR[note.category]
        ?? customWidgets.find((w) => w.id === note.category)?.label
        ?? note.category;

    const isPending = note.id.startsWith("pending_");

    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [menuOpen]);

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
        return `${time} ${date}`;
    };

    const cleanTitle = useMemo(() => stripMarkdown(note.title), [note.title]);
    const cleanContent = useMemo(() => stripMarkdown(note.content), [note.content]);
    const preview = cleanContent.length > 140
        ? cleanContent.slice(0, 140) + "…"
        : cleanContent;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`group rounded-2xl border p-4 transition-colors cursor-pointer ${
                isPending
                    ? "border-dashed border-amber-500/30 bg-zinc-900/60"
                    : "border-white/5 bg-zinc-900/80 hover:border-violet-500/20"
            }`}
            onClick={() => onView(note)}
        >
            {/* Tags row + type icon */}
            <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${chipStyle}`}>
                        {categoryLabel}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${SOURCE_CHIP[note.source] ?? "bg-zinc-800 text-zinc-400"}`}>
                        {SOURCE_LABELS[note.source] ?? note.source}
                    </span>
                    {isPending && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                            <CloudOff className="size-3" /> Оффлайн
                        </span>
                    )}
                </div>
                <Icon className="size-4" style={{ color: "#B78EFF" }} />
            </div>

            {/* Title */}
            <h3 className="text-[15px] font-semibold text-zinc-100 leading-snug mb-1.5">
                {cleanTitle}
            </h3>

            {/* Preview */}
            {preview && (
                <p className="text-[13px] leading-relaxed text-zinc-400 mb-3">
                    {preview}
                </p>
            )}

            {/* Footer: time + menu */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-zinc-600">
                    <span className="text-[11px]">🕐</span>
                    <span className="text-[11px]">{formatTime(note.createdAt)}</span>
                </div>
                <div className="relative" ref={menuRef}>
                    <button
                        className="rounded-lg p-1 text-zinc-600 opacity-0 transition-all hover:bg-zinc-800 hover:text-zinc-400 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen((p) => !p);
                        }}
                        aria-label="Действия"
                    >
                        <MoreVertical className="size-4" />
                    </button>
                    {menuOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="absolute right-0 bottom-full z-20 mb-1 w-36 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                        >
                            <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpen(false);
                                    onEdit(note);
                                }}
                            >
                                ✏️ Редактировать
                            </button>
                            <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-zinc-800"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpen(false);
                                    onDelete(note.id);
                                }}
                            >
                                🗑 Удалить
                            </button>
                        </motion.div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
