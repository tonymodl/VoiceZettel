"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, X, Lightbulb, Heart, Users, ListChecks, Tag } from "lucide-react";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUser } from "@/components/providers/UserProvider";
import {
    NOTE_CATEGORIES,
    CATEGORY_LABEL_SINGULAR,
} from "@/types/notes";
import type { NoteCategory } from "@/types/notes";

const BUILTIN_CATEGORY_ICON: Record<string, React.ElementType> = {
    idea: Lightbulb,
    fact: Heart,
    persona: Users,
    task: ListChecks,
};

export function NoteEdit() {
    const { userId } = useUser();
    const { activeNote, goToList, goToView, createNote, updateNote, deleteNote } = useNotesStore();
    const customWidgets = useSettingsStore((s) => s.customWidgets);

    const isNew = !activeNote;

    const [title, setTitle] = useState(activeNote?.title ?? "");
    const [content, setContent] = useState(activeNote?.content ?? "");
    const [category, setCategory] = useState<NoteCategory>(activeNote?.category ?? "idea");
    const [tags, setTags] = useState<string[]>(activeNote?.tags ?? []);
    const [tagInput, setTagInput] = useState("");
    const [saving, setSaving] = useState(false);

    // Build all categories: built-in + custom widgets
    const allCategories = useMemo(() => {
        const built = NOTE_CATEGORIES.map((c) => ({
            key: c as NoteCategory,
            label: CATEGORY_LABEL_SINGULAR[c],
            Icon: BUILTIN_CATEGORY_ICON[c] ?? Tag,
        }));
        const custom = customWidgets
            .filter((w) => w.enabled)
            .map((w) => ({
                key: w.id as NoteCategory,
                label: w.label,
                Icon: Tag,
            }));
        return [...built, ...custom];
    }, [customWidgets]);

    const addTag = useCallback(() => {
        const t = tagInput.trim().toLowerCase();
        if (t && !tags.includes(t)) {
            setTags((prev) => [...prev, t]);
        }
        setTagInput("");
    }, [tagInput, tags]);

    const removeTag = useCallback((tag: string) => {
        setTags((prev) => prev.filter((t) => t !== tag));
    }, []);

    const handleSave = useCallback(async () => {
        if (!userId || !title.trim()) return;
        setSaving(true);

        if (isNew) {
            const created = await createNote(userId, {
                title,
                content,
                category,
                tags,
                source: "text",
            });
            setSaving(false);
            if (created) goToView(created);
        } else {
            await updateNote(userId, activeNote.id, {
                title,
                content,
                category,
                tags,
            });
            setSaving(false);
            goToView({ ...activeNote, title, content, category, tags });
        }
    }, [userId, title, content, category, tags, isNew, createNote, updateNote, activeNote, goToView]);

    const handleDelete = useCallback(async () => {
        if (!userId || !activeNote) return;
        const ok = await deleteNote(userId, activeNote.id);
        if (ok) goToList();
    }, [userId, activeNote, deleteNote, goToList]);

    const handleBack = useCallback(() => {
        if (activeNote) {
            goToView(activeNote);
        } else {
            goToList();
        }
    }, [activeNote, goToView, goToList]);

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="flex h-full flex-col"
        >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800/50 px-5 pb-3 pt-5">
                <button
                    onClick={handleBack}
                    className="flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
                >
                    <ArrowLeft className="size-4" />
                    Назад
                </button>
                <h2 className="text-base font-semibold text-zinc-100">
                    {isNew ? "Новая заметка" : "Редактирование"}
                </h2>
                <button
                    onClick={handleSave}
                    disabled={saving || !title.trim()}
                    className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:bg-violet-500 disabled:opacity-40"
                >
                    {saving ? "..." : "Сохранить"}
                </button>
            </div>

            {/* Body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-none">
                {/* ── Category selector ── */}
                <div className="mb-5">
                    <label className="mb-2 block text-xs font-medium text-zinc-500">
                        Категория
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {allCategories.map(({ key, label, Icon }) => (
                            <button
                                key={key}
                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                                    category === key
                                        ? "border-violet-500 bg-violet-500/15 text-violet-300"
                                        : "border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                                }`}
                                onClick={() => setCategory(key)}
                            >
                                <Icon className="size-3.5" />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── Title ── */}
                <div className="mb-4">
                    <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                        Заголовок
                    </label>
                    <input
                        type="text"
                        className="w-full rounded-xl border border-white/5 bg-zinc-800/60 px-4 py-3 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                        placeholder="Заголовок заметки"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                </div>

                {/* ── Content ── */}
                <div className="mb-5">
                    <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                        Содержание
                    </label>
                    <textarea
                        className="min-h-[200px] w-full resize-none rounded-xl border border-white/5 bg-zinc-800/60 px-4 py-3 text-sm leading-relaxed text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                        placeholder="Запишите свою мысль…"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                    />
                </div>

                {/* ── Tags ── */}
                <div className="mb-6">
                    <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                        Теги
                    </label>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        {tags.map((tag) => (
                            <span
                                key={tag}
                                className="flex items-center gap-1 rounded-full border border-zinc-700/50 bg-zinc-800/60 px-3 py-1 text-xs text-zinc-400"
                            >
                                #{tag}
                                <button
                                    className="ml-0.5 text-zinc-600 transition-colors hover:text-zinc-300"
                                    onClick={() => removeTag(tag)}
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            className="flex-1 rounded-lg border border-white/5 bg-zinc-800/60 px-3 py-1.5 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
                            placeholder="Добавить тег…"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); addTag(); }
                            }}
                        />
                        <button
                            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
                            onClick={addTag}
                        >
                            +
                        </button>
                    </div>
                </div>

                {/* ── Delete (only on edit) ── */}
                {!isNew && (
                    <button
                        className="w-full rounded-xl border border-red-500/20 bg-red-500/5 py-3 text-sm font-medium text-red-400 transition-all hover:bg-red-500/10"
                        onClick={() => void handleDelete()}
                    >
                        🗑 Удалить заметку
                    </button>
                )}
            </div>
        </motion.div>
    );
}
