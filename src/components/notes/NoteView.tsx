"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Share2, Pencil, Trash2 } from "lucide-react";
import { stripMarkdown } from "@/lib/stripMarkdown";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUser } from "@/components/providers/UserProvider";
import {
    CATEGORY_LABELS,
    SOURCE_LABELS,
} from "@/types/notes";
import type { NoteCategory } from "@/types/notes";

const CATEGORY_CHIP_STYLE: Record<string, string> = {
    idea: "border-violet-500 bg-violet-500/15 text-violet-300",
    fact: "border-red-500/40 bg-red-500/10 text-red-300",
    task: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    persona: "border-pink-500/40 bg-pink-500/10 text-pink-300",
};

export function NoteView({ embedded }: { embedded?: boolean }) {
    const { userId } = useUser();
    const { activeNote, goToList, goToEdit, deleteNote } = useNotesStore();
    const customWidgets = useSettingsStore((s) => s.customWidgets);

    if (!activeNote) return null;

    const chipStyle = CATEGORY_CHIP_STYLE[activeNote.category]
        ?? "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
    const categoryLabel = CATEGORY_LABELS[activeNote.category]
        ?? customWidgets.find((w) => w.id === activeNote.category)?.label
        ?? activeNote.category;

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
        return `${time} ${date}`;
    };

    const handleShare = async () => {
        const shareText = `${activeNote.title}\n\n${activeNote.content}`;
        if (navigator.share) {
            await navigator.share({ title: activeNote.title, text: shareText });
        } else {
            await navigator.clipboard.writeText(shareText);
        }
    };

    const handleDelete = async () => {
        if (!userId) return;
        const ok = await deleteNote(userId, activeNote.id);
        if (ok) goToList();
    };

    /* ── Clean markdown and split into paragraphs ── */
    const cleanTitle = useMemo(() => stripMarkdown(activeNote.title), [activeNote.title]);
    const paragraphs = useMemo(() => {
        const cleaned = stripMarkdown(activeNote.content);
        return cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    }, [activeNote.content]);

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="flex h-full flex-col"
        >
            {/* Header */}
            {!embedded && (
                <div className="flex items-center justify-between px-5 pb-3 pt-5">
                    <h1 className="text-xl font-bold text-zinc-100">Мои заметки</h1>
                    <button
                        onClick={goToList}
                        className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                        aria-label="Назад"
                    >
                        <ArrowLeft className="size-5" />
                    </button>
                </div>
            )}

            {/* Category + source + actions */}
            <div className="flex items-center justify-between px-5 pb-4">
                <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${chipStyle}`}>
                        {categoryLabel}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                        <span className="text-[10px]">📋</span>
                        {SOURCE_LABELS[activeNote.source] ?? activeNote.source}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                        onClick={() => void handleShare()}
                        aria-label="Поделиться"
                    >
                        <Share2 className="size-4" />
                    </button>
                    <button
                        className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                        onClick={() => goToEdit(activeNote)}
                        aria-label="Редактировать"
                    >
                        <Pencil className="size-4" />
                    </button>
                    <button
                        className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
                        onClick={() => void handleDelete()}
                        aria-label="Удалить"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </div>
            </div>

            {/* Body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 pb-8 scrollbar-none">
                {/* Title */}
                <h2 className="mb-4 text-xl font-bold leading-snug text-zinc-100">
                    {cleanTitle}
                </h2>

                {/* Hashtags */}
                {activeNote.tags.length > 0 && (
                    <div className="mb-5 flex flex-wrap gap-2">
                        {activeNote.tags.map((tag) => (
                            <span
                                key={tag}
                                className="rounded-full border border-zinc-700/50 bg-zinc-800/60 px-3 py-1 text-xs text-zinc-400"
                            >
                                #{tag}
                            </span>
                        ))}
                    </div>
                )}

                {/* Content paragraphs */}
                <div className="space-y-4">
                    {paragraphs.map((p, i) => (
                        <p key={i} className="text-[14px] leading-relaxed text-zinc-300">
                            {p}
                        </p>
                    ))}
                </div>

                {/* Timestamp */}
                <div className="mt-6 flex items-center gap-1.5 text-zinc-600">
                    <span className="text-xs">📅</span>
                    <span className="text-xs">{formatTime(activeNote.createdAt)}</span>
                </div>
            </div>
        </motion.div>
    );
}
