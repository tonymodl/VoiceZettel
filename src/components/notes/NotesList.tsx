"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, FileText, Pencil, ChevronDown, CloudOff, LayoutList, LayoutGrid, Settings2, Loader2 } from "lucide-react";
import { NoteCard } from "@/components/notes/NoteCard";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUser } from "@/components/providers/UserProvider";
import { NOTE_CATEGORIES, CATEGORY_LABELS, SYNC_SOURCE_LABELS, SYNC_SOURCE_DESCRIPTIONS } from "@/types/notes";
import type { NoteCategory, VaultFolder } from "@/types/notes";
import type { SyncSourceId } from "@/types/counters";
import { Switch } from "@/components/ui/switch";

interface NotesListProps {
    onClose: () => void;
    embedded?: boolean;
}

export function NotesList({ onClose, embedded }: NotesListProps) {
    const { userId } = useUser();
    const customWidgets = useSettingsStore((s) => s.customWidgets);
    const syncSources = useSettingsStore((s) => s.syncSources);
    const toggleSyncSource = useSettingsStore((s) => s.toggleSyncSource);
    const {
        notes, total, loading, filter, searchQuery,
        setFilter, setSearchQuery, fetchNotes,
        goToView, goToEdit, deleteNote,
        pendingSyncCount, syncing, syncPendingNotes, refreshPendingCount,
    } = useNotesStore();

    const [collapsed, setCollapsed] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");
    const [showSyncSources, setShowSyncSources] = useState(false);
    const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([]);
    const [foldersLoading, setFoldersLoading] = useState(false);
    const lastScrollY = useRef(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch vault folders when sync sources panel opens
    useEffect(() => {
        if (!showSyncSources) return;
        setFoldersLoading(true);
        fetch("/api/obsidian/folders")
            .then((r) => r.json())
            .then((data: { folders?: VaultFolder[] }) => {
                if (data.folders) setVaultFolders(data.folders);
            })
            .catch(() => {/* use static fallback */})
            .finally(() => setFoldersLoading(false));
    }, [showSyncSources]);

    // Build filter options: built-in + custom widgets
    const FILTER_OPTIONS: Array<{ key: NoteCategory | null; label: string }> = [
        { key: null, label: "Все" },
        ...NOTE_CATEGORIES.map((c) => ({ key: c as NoteCategory, label: CATEGORY_LABELS[c] })),
        ...customWidgets.filter((w) => w.enabled).map((w) => ({ key: w.id as NoteCategory, label: w.label })),
    ];

    const doFetch = useCallback(() => {
        if (userId) void fetchNotes(userId);
    }, [userId, fetchNotes]);

    useEffect(() => { doFetch(); }, [doFetch, filter]);

    /* ── Auto-sync when online ── */
    useEffect(() => {
        void refreshPendingCount();

        const handleOnline = () => {
            if (userId) void syncPendingNotes(userId);
        };

        window.addEventListener("online", handleOnline);
        if (navigator.onLine && userId) {
            void syncPendingNotes(userId);
        }
        return () => window.removeEventListener("online", handleOnline);
    }, [userId, syncPendingNotes, refreshPendingCount]);

    const handleSearch = useCallback(() => {
        doFetch();
    }, [doFetch]);

    const handleDelete = useCallback((id: string) => {
        if (userId) void deleteNote(userId, id);
    }, [userId, deleteNote]);

    /* ── Scroll collapse logic ── */
    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const y = el.scrollTop;
        if (y > 40 && y > lastScrollY.current) {
            setCollapsed(true);
        } else if (y < lastScrollY.current) {
            setCollapsed(false);
        }
        lastScrollY.current = y;
    }, []);

    /* ── Open search field ── */
    const openSearch = useCallback(() => {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }, []);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        setSearchQuery("");
        doFetch();
    }, [setSearchQuery, doFetch]);

    /* ── Close dropdown on outside click ── */
    useEffect(() => {
        if (!dropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [dropdownOpen]);

    const activeLabel = FILTER_OPTIONS.find((o) => o.key === filter)?.label ?? "Все";

    return (
        <div className="relative flex h-full flex-col">
            {/* ── Header (always visible) ── */}
            {!embedded && (
                <div className="flex items-center justify-between px-5 pb-3 pt-5">
                    <h1 className="text-xl font-bold text-zinc-100">Мои заметки</h1>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                        aria-label="Закрыть"
                    >
                        <X className="size-5" />
                    </button>
                </div>
            )}

            {/* ── Toolbar: expanded vs collapsed ── */}
            <AnimatePresence mode="wait">
                {!collapsed ? (
                    /* === EXPANDED: full search + filter chips === */
                    <motion.div
                        key="expanded"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        {/* Search bar + view toggle + sync toggle */}
                        <div className="flex items-center gap-2 px-5 pb-3">
                            <div className="relative flex-1">
                                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" />
                                <input
                                    type="text"
                                    className="w-full rounded-xl border border-white/5 bg-zinc-800/60 py-2.5 pl-9 pr-4 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                                    placeholder="Поиск заметок"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                />
                            </div>
                            {/* View mode toggle */}
                            <button
                                className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                                onClick={() => setViewMode((m) => m === "list" ? "grid" : "list")}
                                aria-label={viewMode === "list" ? "Плитка" : "Список"}
                                title={viewMode === "list" ? "Плитка" : "Список"}
                            >
                                {viewMode === "list" ? <LayoutGrid className="size-5" /> : <LayoutList className="size-5" />}
                            </button>
                            {/* Sync sources toggle */}
                            <button
                                className={`shrink-0 rounded-lg p-2 transition-colors ${
                                    showSyncSources ? "bg-violet-500/15 text-violet-400" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                                }`}
                                onClick={() => setShowSyncSources((p) => !p)}
                                aria-label="Источники"
                                title="Источники заметок"
                            >
                                <Settings2 className="size-5" />
                            </button>
                        </div>

                        {/* Sync sources panel (collapsible) */}
                        <AnimatePresence>
                        {showSyncSources && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden px-5 pb-3"
                                >
                                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                            Источники заметок
                                        </p>
                                        {foldersLoading ? (
                                            <div className="flex items-center gap-2 py-3">
                                                <Loader2 className="size-4 animate-spin text-violet-400" />
                                                <span className="text-xs text-zinc-500">Загрузка папок из Obsidian...</span>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {/* Dynamic vault folders from API */}
                                                {vaultFolders.length > 0
                                                    ? vaultFolders.map((folder) => (
                                                        <div key={folder.id} className="flex items-center justify-between">
                                                            <div>
                                                                <span className="text-xs text-zinc-300">{folder.name}</span>
                                                                <p className="text-[10px] text-zinc-600">{folder.description}</p>
                                                            </div>
                                                            <Switch
                                                                checked={syncSources[folder.id] ?? false}
                                                                onCheckedChange={() => toggleSyncSource(folder.id as SyncSourceId)}
                                                            />
                                                        </div>
                                                    ))
                                                    : /* Static fallback when API is unavailable */
                                                    (Object.keys(SYNC_SOURCE_LABELS) as SyncSourceId[]).map((sourceId) => (
                                                        <div key={sourceId} className="flex items-center justify-between">
                                                            <div>
                                                                <span className="text-xs text-zinc-300">{SYNC_SOURCE_LABELS[sourceId]}</span>
                                                                <p className="text-[10px] text-zinc-600">{SYNC_SOURCE_DESCRIPTIONS[sourceId]}</p>
                                                            </div>
                                                            <Switch
                                                                checked={syncSources[sourceId] ?? false}
                                                                onCheckedChange={() => toggleSyncSource(sourceId)}
                                                            />
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Filter chips */}
                        <div className="flex gap-2 overflow-x-auto px-5 pb-4 scrollbar-none">
                            {FILTER_OPTIONS.map((opt) => (
                                <button
                                    key={opt.label}
                                    className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
                                        filter === opt.key
                                            ? "border-violet-500 bg-violet-500/15 text-violet-300"
                                            : "border-zinc-700/50 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
                                    }`}
                                    onClick={() => setFilter(opt.key)}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                ) : (
                    /* === COLLAPSED: dropdown + search icon === */
                    <motion.div
                        key="collapsed"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="flex items-center justify-between px-5 pb-3">
                            <AnimatePresence mode="wait">
                                {searchOpen ? (
                                    <motion.div
                                        key="search-input"
                                        initial={{ width: 40, opacity: 0 }}
                                        animate={{ width: "100%", opacity: 1 }}
                                        exit={{ width: 40, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="relative flex-1 mr-2"
                                    >
                                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600" />
                                        <input
                                            ref={searchInputRef}
                                            type="text"
                                            className="w-full rounded-xl border border-white/5 bg-zinc-800/60 py-2 pl-9 pr-8 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
                                            placeholder="Поиск заметок"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleSearch();
                                                if (e.key === "Escape") closeSearch();
                                            }}
                                            onBlur={() => {
                                                if (!searchQuery.trim()) closeSearch();
                                            }}
                                        />
                                        <button
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-600 hover:text-zinc-400"
                                            onClick={closeSearch}
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="filter-dropdown"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="relative"
                                        ref={dropdownRef}
                                    >
                                        <button
                                            className="flex items-center gap-1 rounded-full border border-zinc-700/50 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600"
                                            onClick={() => setDropdownOpen((p) => !p)}
                                        >
                                            {activeLabel}
                                            <ChevronDown className="size-3" />
                                        </button>
                                        {dropdownOpen && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -4 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="absolute left-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                                            >
                                                {FILTER_OPTIONS.map((opt) => (
                                                    <button
                                                        key={opt.label}
                                                        className={`flex w-full px-3 py-2 text-xs transition-colors hover:bg-zinc-800 ${
                                                            filter === opt.key ? "text-violet-400" : "text-zinc-400"
                                                        }`}
                                                        onClick={() => {
                                                            setFilter(opt.key);
                                                            setDropdownOpen(false);
                                                        }}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Right: view mode + search icon */}
                            <div className="flex items-center gap-1">
                                <button
                                    className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                                    onClick={() => setViewMode((m) => m === "list" ? "grid" : "list")}
                                    aria-label={viewMode === "list" ? "Плитка" : "Список"}
                                >
                                    {viewMode === "list" ? <LayoutGrid className="size-4" /> : <LayoutList className="size-4" />}
                                </button>
                                {!searchOpen && (
                                    <button
                                        className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                                        onClick={openSearch}
                                        aria-label="Поиск"
                                    >
                                        <Search className="size-5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Pending sync banner ── */}
            {pendingSyncCount > 0 && (
                <div className="mx-5 mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                    <CloudOff className="size-4 shrink-0 text-amber-400" />
                    <span className="text-xs text-amber-300">
                        {syncing
                            ? "Синхронизация..."
                            : `${pendingSyncCount} ${pendingSyncCount === 1 ? "заметка ожидает" : "заметок ожидают"} синхронизации`
                        }
                    </span>
                </div>
            )}

            {/* ── Notes list (scrollable) ── */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-5 pb-20 scrollbar-none"
                onScroll={handleScroll}
            >
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <div className="size-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                    </div>
                )}

                {!loading && notes.length === 0 && (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                        <FileText className="size-10 text-zinc-700" />
                        <p className="text-sm text-zinc-600">
                            {searchQuery ? "Ничего не найдено" : "Пока нет заметок"}
                        </p>
                    </div>
                )}

                {/* Adaptive container: max-width on desktop */}
                <div className="mx-auto max-w-[960px]">
                    {viewMode === "list" ? (
                        /* ── LIST VIEW ── */
                        <div className="flex flex-col gap-3">
                            {!loading && notes.map((note) => (
                                <NoteCard
                                    key={note.id}
                                    note={note}
                                    onView={goToView}
                                    onEdit={goToEdit}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </div>
                    ) : (
                        /* ── GRID VIEW (Google Keep style) ── */
                        <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
                            {!loading && notes.map((note) => (
                                <div key={note.id} className="mb-3 break-inside-avoid">
                                    <NoteCard
                                        note={note}
                                        onView={goToView}
                                        onEdit={goToEdit}
                                        onDelete={handleDelete}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {!loading && total > 0 && (
                    <p className="mt-4 text-center text-[11px] text-zinc-700">
                        {total} {total === 1 ? "заметка" : total < 5 ? "заметки" : "заметок"}
                    </p>
                )}
            </div>

            {/* ── FAB: New Note (bottom-right, always visible) ── */}
            <motion.button
                whileTap={{ scale: 0.9 }}
                className="absolute bottom-6 right-5 z-10 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-violet-500 shadow-lg shadow-violet-500/30 transition-shadow hover:shadow-violet-500/50"
                onClick={() => goToEdit(null)}
                aria-label="Новая заметка"
            >
                <Pencil className="size-5 text-white" />
            </motion.button>
        </div>
    );
}
