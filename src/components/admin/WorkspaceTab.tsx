"use client";

import { useState, useCallback } from "react";
import {
  FileText, Table2, Upload, Link2, RefreshCw,
  ExternalLink, Settings, Plus, Trash2, CheckCircle2
} from "lucide-react";

/**
 * WorkspaceTab — Google Workspace integration panel.
 * Phase 5: Manages linked Google Docs/Sheets, system prompts,
 * and ChromaDB synchronization for document-aware AI conversations.
 */

interface LinkedDocument {
  id: string;
  title: string;
  type: "doc" | "sheet" | "slides";
  url: string;
  systemPrompt: string;
  lastSync: string | null;
  chunkCount: number;
  status: "synced" | "pending" | "error";
}

// Demo data — will be replaced with real API calls
const DEMO_DOCS: LinkedDocument[] = [];

export default function WorkspaceTab() {
  const [documents, setDocuments] = useState<LinkedDocument[]>(DEMO_DOCS);
  const [addingNew, setAddingNew] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);

  const handleAddDocument = useCallback(() => {
    if (!newUrl.trim()) return;

    const urlMatch = newUrl.match(/\/d\/([\w-]+)/);
    const docId = urlMatch ? urlMatch[1] : crypto.randomUUID().slice(0, 12);
    const isSheet = newUrl.includes("spreadsheets");

    const doc: LinkedDocument = {
      id: docId,
      title: `Document ${docId.slice(0, 8)}...`,
      type: isSheet ? "sheet" : "doc",
      url: newUrl,
      systemPrompt: newPrompt || "Используй содержимое этого документа как контекст для ответов.",
      lastSync: null,
      chunkCount: 0,
      status: "pending",
    };

    setDocuments((prev) => [...prev, doc]);
    setNewUrl("");
    setNewPrompt("");
    setAddingNew(false);
  }, [newUrl, newPrompt]);

  const handleSync = useCallback(async (docId: string) => {
    setSyncing(docId);
    try {
      const res = await fetch("/api/workspace/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === docId
              ? { ...d, status: "synced", lastSync: new Date().toISOString(), chunkCount: data.chunkCount || 0 }
              : d
          )
        );
      }
    } catch {
      // Non-critical
    } finally {
      setSyncing(null);
    }
  }, []);

  const handleRemove = useCallback((docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <FileText className="size-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Google Workspace</h2>
            <p className="text-xs text-zinc-500">Привязка документов для контекстного AI</p>
          </div>
        </div>

        <button
          onClick={() => setAddingNew(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium transition-all hover:bg-blue-500/20"
        >
          <Plus className="size-3.5" />
          Добавить документ
        </button>
      </div>

      {/* OAuth Status */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-zinc-500" />
            <span className="text-sm text-zinc-300">Google OAuth</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              Настройте API ключи
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Для полной интеграции необходимо настроить Google OAuth credentials в .env файле.
          Пока работает режим ручного добавления URL.
        </p>
      </div>

      {/* Add new document form */}
      {addingNew && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">Добавить документ</h3>
          
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">URL документа Google</label>
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-zinc-600 shrink-0" />
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://docs.google.com/document/d/..."
                className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Системный промпт документа</label>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="Описание контекста: например, 'Это мастер-план проекта, используй для стратегических вопросов'"
              rows={3}
              className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setAddingNew(false); setNewUrl(""); setNewPrompt(""); }}
              className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleAddDocument}
              disabled={!newUrl.trim()}
              className="px-4 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-medium transition-all hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload className="size-3.5 inline mr-1.5" />
              Добавить
            </button>
          </div>
        </div>
      )}

      {/* Document list */}
      <div className="space-y-3">
        {documents.length > 0 ? (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 transition-all hover:border-zinc-700"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`p-2 rounded-lg shrink-0 ${
                    doc.type === "sheet" ? "bg-emerald-500/10" : "bg-blue-500/10"
                  }`}>
                    {doc.type === "sheet" ? (
                      <Table2 className="size-4 text-emerald-400" />
                    ) : (
                      <FileText className="size-4 text-blue-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-zinc-200 truncate">{doc.title}</h4>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-zinc-600 hover:text-blue-400 flex items-center gap-1 mt-0.5"
                    >
                      <ExternalLink className="size-2.5" />
                      Открыть в Google
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleSync(doc.id)}
                    disabled={syncing === doc.id}
                    className="p-1.5 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-colors disabled:opacity-50"
                    title="Синхронизировать"
                  >
                    <RefreshCw className={`size-3.5 ${syncing === doc.id ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => handleRemove(doc.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* System prompt */}
              <div className="mt-3 p-2 rounded-lg bg-zinc-800/30 border border-zinc-800/50">
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Системный промпт</span>
                <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{doc.systemPrompt}</p>
              </div>

              {/* Status bar */}
              <div className="mt-3 flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-4">
                  <span className={`flex items-center gap-1 ${
                    doc.status === "synced" ? "text-emerald-400" : 
                    doc.status === "error" ? "text-red-400" : "text-zinc-500"
                  }`}>
                    {doc.status === "synced" && <CheckCircle2 className="size-3" />}
                    {doc.status === "synced" ? "Синхронизирован" : doc.status === "error" ? "Ошибка" : "Ожидает"}
                  </span>
                  {doc.chunkCount > 0 && (
                    <span className="text-zinc-600">{doc.chunkCount} чанков в ChromaDB</span>
                  )}
                </div>
                {doc.lastSync && (
                  <span className="text-zinc-600">
                    {new Date(doc.lastSync).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-zinc-800/30 border border-zinc-800 mb-4">
              <FileText className="size-8 text-zinc-600" />
            </div>
            <p className="text-sm text-zinc-400">Нет привязанных документов</p>
            <p className="text-xs text-zinc-600 mt-1">
              Добавьте Google Docs/Sheets для контекстного общения с AI
            </p>
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-4">
        <h4 className="text-xs font-medium text-zinc-400 mb-2">Как это работает</h4>
        <ul className="space-y-1.5 text-xs text-zinc-600">
          <li className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">1.</span>
            Привяжите Google Doc или Sheet по URL
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">2.</span>
            Задайте системный промпт — он определит контекст использования
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">3.</span>
            Документ разбивается на чанки и индексируется в выделенную коллекцию ChromaDB
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">4.</span>
            AI ассистент автоматически находит релевантные фрагменты при разговоре
          </li>
        </ul>
      </div>
    </div>
  );
}
