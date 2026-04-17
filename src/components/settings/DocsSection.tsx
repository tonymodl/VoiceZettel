"use client";

import { useState, useEffect, useCallback } from "react";
import {
    FileText, Table2, FolderOpen, ExternalLink, Plus,
    RefreshCw, Loader2, Search, Share2, Clock,
} from "lucide-react";

/* ── Types ── */
interface GoogleFile {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    webViewLink: string;
    iconLink?: string;
}

/* ── Component ── */
export function DocsSection() {
    const [files, setFiles] = useState<GoogleFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<"all" | "docs" | "sheets">("all");

    const fetchFiles = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/google/list-files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: searchQuery || undefined }),
            });
            if (res.ok) {
                const data = await res.json() as { files?: GoogleFile[] };
                setFiles(data.files ?? []);
            }
        } catch {
            // Silent fail
        } finally {
            setIsLoading(false);
        }
    }, [searchQuery]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const filteredFiles = files.filter((f) => {
        if (filter === "docs") return f.mimeType === "application/vnd.google-apps.document";
        if (filter === "sheets") return f.mimeType === "application/vnd.google-apps.spreadsheet";
        return true;
    });

    const handleOpen = (file: GoogleFile) => {
        window.open(file.webViewLink, "_blank", "noopener,noreferrer");
    };

    const handleCreateDoc = async () => {
        try {
            const title = prompt("Название нового документа:");
            if (!title) return;
            const res = await fetch("/api/google/create-doc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
            });
            if (res.ok) {
                const data = await res.json() as { url?: string };
                if (data.url) window.open(data.url, "_blank");
                fetchFiles();
            }
        } catch { /* silent */ }
    };

    const getFileIcon = (mimeType: string) => {
        if (mimeType.includes("spreadsheet")) {
            return <Table2 className="size-4 text-emerald-400" />;
        }
        return <FileText className="size-4 text-blue-400" />;
    };

    const getFileColor = (mimeType: string) => {
        if (mimeType.includes("spreadsheet")) return "border-emerald-500/20 hover:border-emerald-500/40";
        return "border-blue-500/20 hover:border-blue-500/40";
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-zinc-200">Google Документы</h3>
                    <p className="text-[11px] text-zinc-500">
                        Управление файлами. Клик → открытие. Голосом → создание и редактирование.
                    </p>
                </div>
                <button
                    onClick={handleCreateDoc}
                    className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400 transition hover:bg-violet-500/20"
                >
                    <Plus className="size-3.5" />
                    Новый документ
                </button>
            </div>

            {/* Search + Filters */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Найти файл..."
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-xs text-zinc-300 outline-none focus:border-violet-500/50"
                    />
                </div>
                <div className="flex rounded-lg border border-zinc-700 bg-zinc-900">
                    {(["all", "docs", "sheets"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-2.5 py-1.5 text-[10px] font-medium transition ${
                                filter === f
                                    ? "bg-violet-500/20 text-violet-400"
                                    : "text-zinc-500 hover:text-zinc-300"
                            }`}
                        >
                            {f === "all" ? "Все" : f === "docs" ? "📄 Документы" : "📊 Таблицы"}
                        </button>
                    ))}
                </div>
                <button
                    onClick={fetchFiles}
                    disabled={isLoading}
                    className="rounded-lg border border-zinc-700 p-2 text-zinc-400 transition hover:text-zinc-200"
                >
                    {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                </button>
            </div>

            {/* File Grid */}
            {isLoading && files.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-5 animate-spin text-zinc-500" />
                </div>
            ) : filteredFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-700 py-10 text-center">
                    <FolderOpen className="mx-auto mb-2 size-8 text-zinc-600" />
                    <p className="text-xs text-zinc-500">
                        {searchQuery ? "Ничего не найдено" : "Нет Google файлов. Создайте первый документ!"}
                    </p>
                </div>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                    {filteredFiles.map((file) => (
                        <button
                            key={file.id}
                            onClick={() => handleOpen(file)}
                            className={`group flex items-center gap-3 rounded-xl border bg-zinc-900/50 p-3 text-left transition-all hover:bg-zinc-800/50 ${getFileColor(file.mimeType)}`}
                        >
                            <div className="flex size-9 items-center justify-center rounded-lg bg-zinc-800/80">
                                {getFileIcon(file.mimeType)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-medium text-zinc-200 group-hover:text-white">
                                    {file.name}
                                </p>
                                <p className="flex items-center gap-1 text-[10px] text-zinc-600">
                                    <Clock className="size-2.5" />
                                    {new Date(file.modifiedTime).toLocaleDateString("ru-RU", {
                                        day: "numeric", month: "short", year: "numeric"
                                    })}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                <ExternalLink className="size-3 text-zinc-500" />
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Voice hint */}
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                <p className="text-[10px] font-semibold text-cyan-500/70">🎙 Голосовые команды</p>
                <div className="mt-1 space-y-0.5 text-[10px] text-zinc-500">
                    <p>• &quot;Создай документ [название]&quot; → create_google_doc</p>
                    <p>• &quot;Покажи таблицу Бюджет&quot; → google_docs_action(read_sheet)</p>
                    <p>• &quot;Добавь строку в таблицу&quot; → google_docs_action(append_sheet)</p>
                    <p>• &quot;Расшарь документ Насте&quot; → share + send_telegram</p>
                </div>
            </div>
        </div>
    );
}
