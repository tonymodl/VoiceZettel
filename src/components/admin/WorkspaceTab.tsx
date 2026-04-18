"use client";

import { useState, useCallback, useEffect } from "react";
import {
  FileText, Table2, Upload, Link2, RefreshCw,
  ExternalLink, Plus, Trash2, CheckCircle2,
  Loader2, AlertTriangle, FileSearch, Presentation,
  LogIn, LogOut, ShieldCheck, Globe, HardDrive
} from "lucide-react";

/**
 * WorkspaceTab — Google Workspace integration panel.
 * Full integration: Docs + Sheets + Slides via OAuth.
 * Falls back to public export for unauthenticated users.
 */

interface LinkedDocument {
  id: string;
  title: string;
  type: "doc" | "sheet" | "slides";
  url: string;
  systemPrompt: string;
  lastSync: string | null;
  chunkCount: number;
  indexedCount: number;
  fetchMethod: "oauth" | "public" | null;
  status: "synced" | "pending" | "syncing" | "error";
  errorMessage?: string;
}

interface GoogleStatus {
  connected: boolean;
  email: string | null;
  clientConfigured: boolean;
}

// localStorage persistence
function loadDocuments(): LinkedDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem("voicezettel_workspace_docs");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveDocuments(docs: LinkedDocument[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem("voicezettel_workspace_docs", JSON.stringify(docs));
}

function detectDocType(url: string): "doc" | "sheet" | "slides" {
  if (url.includes("spreadsheets")) return "sheet";
  if (url.includes("presentation")) return "slides";
  return "doc";
}

const DOC_TYPE_LABELS = {
  doc: "Документ",
  sheet: "Таблица",
  slides: "Презентация",
};

/** Load Google Picker API script dynamically */
function loadPickerScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as Record<string, unknown>).__pickerLoaded) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => {
      (window as unknown as Record<string, { load: (lib: string, cb: { callback: () => void }) => void }>).gapi.load("picker", {
        callback: () => {
          (window as unknown as Record<string, boolean>).__pickerLoaded = true;
          resolve();
        },
      });
    };
    script.onerror = () => reject(new Error("Failed to load Google Picker API"));
    document.head.appendChild(script);
  });
}

export default function WorkspaceTab() {
  const [documents, setDocuments] = useState<LinkedDocument[]>(loadDocuments);
  const [addingNew, setAddingNew] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Check Google connection status
  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((r) => r.json())
      .then((d) => setGoogleStatus(d as GoogleStatus))
      .catch(() => setGoogleStatus({ connected: false, email: null, clientConfigured: false }));
  }, []);

  const updateAndSave = useCallback((updater: (prev: LinkedDocument[]) => LinkedDocument[]) => {
    setDocuments((prev) => {
      const next = updater(prev);
      saveDocuments(next);
      return next;
    });
  }, []);

  /** Open Google Drive Picker to browse and select documents */
  const handleOpenPicker = useCallback(async () => {
    setPickerLoading(true);
    try {
      // 1. Get access token
      const tokenRes = await fetch("/api/auth/google/picker-token");
      if (!tokenRes.ok) throw new Error("Не удалось получить токен");
      const { accessToken, clientId, appId } = (await tokenRes.json()) as any;

      // 2. Load Picker script
      await loadPickerScript();

      // 3. Open Picker
      const google = (window as any).google as {
        picker: {
          PickerBuilder: new () => {
            addView: (view: unknown) => any;
            setOAuthToken: (token: string) => any;
            setDeveloperKey: (key: string) => any;
            setAppId: (id: string) => any;
            setCallback: (cb: (data: { action: string; docs?: Array<{ id: string; name: string; url: string; mimeType: string }> }) => void) => any;
            build: () => { setVisible: (visible: boolean) => void };
          };
          ViewId: { DOCS: string; SPREADSHEETS: string; PRESENTATIONS: string };
          DocsView: new (viewId: string) => unknown;
          Action: { PICKED: string };
        };
      };

      const picker = new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView(google.picker.ViewId.DOCS))
        .addView(new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS))
        .addView(new google.picker.DocsView(google.picker.ViewId.PRESENTATIONS))
        .setOAuthToken(accessToken)
        .setAppId(appId || clientId?.split("-")[0] || "")
        .setCallback((data: { action: string; docs?: Array<{ id: string; name: string; url: string; mimeType: string }> }) => {
          if (data.action === google.picker.Action.PICKED && data.docs) {
            for (const pickedDoc of data.docs) {
              const docType = pickedDoc.mimeType.includes("spreadsheet")
                ? "sheet" as const
                : pickedDoc.mimeType.includes("presentation")
                ? "slides" as const
                : "doc" as const;

              const newDoc: LinkedDocument = {
                id: pickedDoc.id,
                title: pickedDoc.name,
                type: docType,
                url: pickedDoc.url,
                systemPrompt: `Используй содержимое ${DOC_TYPE_LABELS[docType].toLowerCase()} "${pickedDoc.name}" как контекст для ответов.`,
                lastSync: null,
                chunkCount: 0,
                indexedCount: 0,
                fetchMethod: "oauth",
                status: "pending",
              };
              updateAndSave((prev) => {
                if (prev.some((d) => d.id === pickedDoc.id)) return prev;
                return [...prev, newDoc];
              });
            }
          }
        })
        .build();
      picker.setVisible(true);
    } catch (err) {
      console.error("[Picker]", err);
    } finally {
      setPickerLoading(false);
    }
  }, [updateAndSave]);

  const handleAddDocument = useCallback(() => {
    if (!newUrl.trim()) return;

    const urlMatch = newUrl.match(/\/d\/([\w-]+)/);
    const docId = urlMatch ? urlMatch[1] : crypto.randomUUID().slice(0, 12);
    const docType = detectDocType(newUrl);

    const doc: LinkedDocument = {
      id: docId,
      title: `${DOC_TYPE_LABELS[docType]} ${docId.slice(0, 8)}...`,
      type: docType,
      url: newUrl,
      systemPrompt: newPrompt || "Используй содержимое этого документа как контекст для ответов.",
      lastSync: null,
      chunkCount: 0,
      indexedCount: 0,
      fetchMethod: null,
      status: "pending",
    };

    updateAndSave((prev) => [...prev, doc]);
    setNewUrl("");
    setNewPrompt("");
    setAddingNew(false);
  }, [newUrl, newPrompt, updateAndSave]);

  const handleSync = useCallback(async (docId: string) => {
    setSyncing(docId);
    updateAndSave((prev) =>
      prev.map((d) => d.id === docId ? { ...d, status: "syncing" as const, errorMessage: undefined } : d)
    );

    try {
      const doc = documents.find((d) => d.id === docId);
      const res = await fetch("/api/workspace/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: docId,
          url: doc?.url,
          systemPrompt: doc?.systemPrompt,
        }),
      });
      const data = await res.json();

      if (data.status === "ok") {
        updateAndSave((prev) =>
          prev.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  status: "synced" as const,
                  lastSync: new Date().toISOString(),
                  chunkCount: data.chunkCount || 0,
                  indexedCount: data.indexedCount || 0,
                  title: data.documentTitle || d.title,
                  type: data.documentType || d.type,
                  fetchMethod: data.fetchMethod || null,
                  errorMessage: undefined,
                }
              : d
          )
        );
      } else {
        updateAndSave((prev) =>
          prev.map((d) =>
            d.id === docId
              ? { ...d, status: "error" as const, errorMessage: data.message || "Ошибка синхронизации" }
              : d
          )
        );
      }
    } catch (err) {
      updateAndSave((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, status: "error" as const, errorMessage: err instanceof Error ? err.message : "Неизвестная ошибка" }
            : d
        )
      );
    } finally {
      setSyncing(null);
    }
  }, [documents, updateAndSave]);

  const handleSyncAll = useCallback(async () => {
    for (const doc of documents) {
      await handleSync(doc.id);
    }
  }, [documents, handleSync]);

  const handleRemove = useCallback((docId: string) => {
    updateAndSave((prev) => prev.filter((d) => d.id !== docId));
  }, [updateAndSave]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/auth/google/status", { method: "DELETE" });
      setGoogleStatus({ connected: false, email: null, clientConfigured: googleStatus?.clientConfigured || false });
    } catch { /* ignore */ }
    setDisconnecting(false);
  }, [googleStatus]);

  const syncedCount = documents.filter((d) => d.status === "synced").length;
  const totalChunks = documents.reduce((acc, d) => acc + d.chunkCount, 0);

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
            <p className="text-xs text-zinc-500">Документы • Таблицы • Презентации → ChromaDB</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {documents.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span>{syncedCount}/{documents.length} синхр.</span>
              <span>•</span>
              <span>{totalChunks} чанков</span>
            </div>
          )}
          {documents.length > 1 && (
            <button
              onClick={handleSyncAll}
              disabled={!!syncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium transition-all hover:bg-violet-500/20 disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" />
              Синхронизировать все
            </button>
          )}
          {googleStatus?.connected && (
            <button
              onClick={handleOpenPicker}
              disabled={pickerLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium transition-all hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {pickerLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <HardDrive className="size-3.5" />
              )}
              Выбрать из Drive
            </button>
          )}
          <button
            onClick={() => setAddingNew(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium transition-all hover:bg-blue-500/20"
          >
            <Plus className="size-3.5" />
            По URL
          </button>
        </div>
      </div>

      {/* Google OAuth Status */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {googleStatus?.connected ? (
              <>
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <ShieldCheck className="size-4 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">Google подключён</span>
                    <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      Полный доступ ✓
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {googleStatus.email} • Docs + Sheets + Slides + Drive
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="p-2 rounded-lg bg-zinc-800">
                  <Globe className="size-4 text-zinc-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-300">Google не подключён</span>
                    <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                      Только публичные ✓
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Подключите Google для доступа к приватным документам, таблицам и презентациям
                  </p>
                </div>
              </>
            )}
          </div>

          <div>
            {googleStatus?.connected ? (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-zinc-500 text-xs transition-all hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
              >
                <LogOut className="size-3.5" />
                Отключить
              </button>
            ) : (
              <a
                href="/api/auth/google"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium transition-all hover:bg-blue-500 shadow-lg shadow-blue-500/20"
              >
                <LogIn className="size-3.5" />
                Подключить Google
              </a>
            )}
          </div>
        </div>
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
                placeholder="https://docs.google.com/document/d/... или /spreadsheets/d/... или /presentation/d/..."
                className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
              />
            </div>
            {newUrl && (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                {detectDocType(newUrl) === "doc" && <><FileText className="size-3 text-blue-400" /> Документ</>}
                {detectDocType(newUrl) === "sheet" && <><Table2 className="size-3 text-emerald-400" /> Таблица {!googleStatus?.connected && <span className="text-amber-400">(нужна авторизация Google)</span>}</>}
                {detectDocType(newUrl) === "slides" && <><Presentation className="size-3 text-orange-400" /> Презентация {!googleStatus?.connected && <span className="text-amber-400">(нужна авторизация Google)</span>}</>}
              </div>
            )}
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
                    doc.type === "sheet" ? "bg-emerald-500/10" : 
                    doc.type === "slides" ? "bg-orange-500/10" : "bg-blue-500/10"
                  }`}>
                    {doc.type === "sheet" ? (
                      <Table2 className="size-4 text-emerald-400" />
                    ) : doc.type === "slides" ? (
                      <Presentation className="size-4 text-orange-400" />
                    ) : (
                      <FileText className="size-4 text-blue-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-zinc-200 truncate">{doc.title}</h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-zinc-600 hover:text-blue-400 flex items-center gap-1"
                      >
                        <ExternalLink className="size-2.5" />
                        Открыть в Google
                      </a>
                      {doc.fetchMethod && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          doc.fetchMethod === "oauth" 
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-zinc-700 text-zinc-400"
                        }`}>
                          {doc.fetchMethod === "oauth" ? "Google API" : "Публичный"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleSync(doc.id)}
                    disabled={syncing === doc.id}
                    className="p-1.5 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-colors disabled:opacity-50"
                    title="Синхронизировать"
                  >
                    {syncing === doc.id ? (
                      <Loader2 className="size-3.5 animate-spin text-blue-400" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
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

              {/* Error message */}
              {doc.status === "error" && doc.errorMessage && (
                <div className="mt-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-2">
                  <AlertTriangle className="size-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{doc.errorMessage}</p>
                </div>
              )}

              {/* Sync progress */}
              {doc.status === "syncing" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-blue-400">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Загрузка и чанкирование документа...</span>
                </div>
              )}

              {/* Status bar */}
              <div className="mt-3 flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-4">
                  <span className={`flex items-center gap-1 ${
                    doc.status === "synced" ? "text-emerald-400" : 
                    doc.status === "error" ? "text-red-400" : 
                    doc.status === "syncing" ? "text-blue-400" : "text-zinc-500"
                  }`}>
                    {doc.status === "synced" && <CheckCircle2 className="size-3" />}
                    {doc.status === "syncing" && <Loader2 className="size-3 animate-spin" />}
                    {doc.status === "error" && <AlertTriangle className="size-3" />}
                    {doc.status === "synced" ? "Синхронизирован" : 
                     doc.status === "error" ? "Ошибка" : 
                     doc.status === "syncing" ? "Синхронизация..." : "Ожидает"}
                  </span>
                  {doc.chunkCount > 0 && (
                    <span className="text-zinc-600 flex items-center gap-1">
                      <FileSearch className="size-2.5" />
                      {doc.chunkCount} чанков
                      {doc.indexedCount > 0 && ` (${doc.indexedCount} в ChromaDB)`}
                    </span>
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
              Добавьте Google Docs, Sheets или Slides для контекстного общения с AI
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
            {googleStatus?.connected 
              ? "Google подключён — доступны приватные документы, таблицы и презентации"
              : "Подключите Google для полного доступа (или добавляйте публичные документы без авторизации)"}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">2.</span>
            Привяжите документ по URL и задайте системный промпт — он определит контекст использования
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">3.</span>
            Нажмите sync — документ загрузится, разобьётся на чанки и проиндексируется в ChromaDB
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
