"use client";

import dynamic from "next/dynamic";
import { Terminal, GitBranch, Activity, HeartPulse, Play, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

/**
 * MissionControlTab — Engineering dashboard for monitoring OpenClaw agent.
 * Split view: Terminal (left) + Trace Visualizer (right).
 * Bottom: Heartbeat daemon status bar.
 * Completely isolated from main app — read-only, zero mutations.
 */

const TerminalView = dynamic(() => import("./TerminalView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-zinc-950 text-zinc-600 text-sm">
      Загрузка терминала...
    </div>
  ),
});

const TraceVisualizer = dynamic(() => import("./TraceVisualizer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-zinc-950 text-zinc-600 text-sm">
      Загрузка визуализатора...
    </div>
  ),
});

interface HeartbeatStatus {
  active: boolean;
  interval_min: number;
  last_run: string | null;
  uptime: number;
}

interface OpenClawStatusData {
  status: string;
  configured: boolean;
  raw_files: number;
  wiki_pages: number;
  processed_files: number;
  pending_files: number;
  entities: { people: number; tasks: number };
  directories: { raw_v2: boolean; wiki_v2: boolean };
  heartbeat?: HeartbeatStatus;
}

export default function MissionControlTab() {
  const [activePanel, setActivePanel] = useState<"split" | "terminal" | "traces">("split");
  const [openclawData, setOpenclawData] = useState<OpenClawStatusData | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/status", { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        setOpenclawData(data);
      }
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 10000);
    return () => clearInterval(iv);
  }, [fetchStatus]);

  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch("/api/openclaw/trigger", { method: "POST" });
      const data = await res.json();
      if (data.status === "ok" && data.result) {
        setTriggerResult(`✅ Обработано: ${data.result.new_files} файлов, ${data.result.entities} сущностей`);
      } else {
        setTriggerResult("⚠️ " + (data.error || "Неизвестная ошибка"));
      }
      await fetchStatus();
    } catch {
      setTriggerResult("❌ Демон не отвечает");
    } finally {
      setTriggering(false);
    }
  }, [fetchStatus]);

  const hb = openclawData?.heartbeat;
  const lastRunFormatted = hb?.last_run
    ? new Date(hb.last_run).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Activity className="size-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Mission Control</h2>
            <p className="text-xs text-zinc-500">Мониторинг и трассировки агента OpenClaw</p>
          </div>
        </div>

        {/* Layout toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
          <button
            onClick={() => setActivePanel("split")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activePanel === "split"
                ? "bg-purple-500/20 text-purple-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Сплит
          </button>
          <button
            onClick={() => setActivePanel("terminal")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activePanel === "terminal"
                ? "bg-purple-500/20 text-purple-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Terminal className="size-3" />
            Терминал
          </button>
          <button
            onClick={() => setActivePanel("traces")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activePanel === "traces"
                ? "bg-purple-500/20 text-purple-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <GitBranch className="size-3" />
            Трассы
          </button>
        </div>
      </div>

      {/* Heartbeat Status Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg ${hb?.active ? "bg-pink-500/10 border border-pink-500/20" : "bg-zinc-800 border border-zinc-700"}`}>
              <HeartPulse className={`size-4 ${hb?.active ? "text-pink-400 animate-pulse" : "text-zinc-500"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-200">Heartbeat Daemon</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  hb?.active
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-zinc-700/50 text-zinc-500 border border-zinc-700"
                }`}>
                  {hb?.active ? "ACTIVE" : "INACTIVE"}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-0.5 text-[11px] text-zinc-500">
                <span>Интервал: {hb?.interval_min ?? 30} мин</span>
                <span>Последний: {lastRunFormatted}</span>
                {openclawData && (
                  <>
                    <span>Raw: {openclawData.raw_files}</span>
                    <span>Wiki: {openclawData.wiki_pages}</span>
                    <span>Pending: {openclawData.pending_files}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {triggerResult && (
              <span className="text-[10px] text-zinc-400 max-w-[200px] truncate">{triggerResult}</span>
            )}
            <button
              onClick={handleTrigger}
              disabled={triggering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-medium transition-all hover:bg-pink-500/20 disabled:opacity-50"
            >
              {triggering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {triggering ? "Обработка..." : "Запустить цикл"}
            </button>
          </div>
        </div>

        {/* Entity counts ribbon */}
        {openclawData && (openclawData.entities.people > 0 || openclawData.entities.tasks > 0) && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-800/50">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Извлечённые сущности:</span>
            <span className="text-[11px] font-medium text-teal-400">👤 {openclawData.entities.people} персон</span>
            <span className="text-[11px] font-medium text-amber-400">📋 {openclawData.entities.tasks} задач</span>
            <span className="text-[11px] text-zinc-600">|</span>
            <span className="text-[11px] text-zinc-500">Обработано: {openclawData.processed_files} файлов</span>
          </div>
        )}
      </div>

      {/* Panels */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* Terminal Panel */}
        {(activePanel === "split" || activePanel === "terminal") && (
          <div
            className={`rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 ${
              activePanel === "split" ? "flex-1" : "w-full"
            }`}
          >
            <TerminalView />
          </div>
        )}

        {/* Trace Visualizer Panel */}
        {(activePanel === "split" || activePanel === "traces") && (
          <div
            className={`rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 ${
              activePanel === "split" ? "w-[400px] shrink-0" : "w-full"
            }`}
          >
            <TraceVisualizer />
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="flex items-center justify-between text-xs text-zinc-600 px-1">
        <span>Фаза 1/5 — Наблюдаемость активна</span>
        <span>Shadow Mode: /Raw_v2, /Wiki_v2{openclawData?.directories.raw_v2 ? " ✓" : " ✗"}</span>
      </div>
    </div>
  );
}
