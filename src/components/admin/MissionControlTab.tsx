"use client";

import dynamic from "next/dynamic";
import { Terminal, GitBranch, Activity } from "lucide-react";
import { useState } from "react";

/**
 * MissionControlTab — Engineering dashboard for monitoring OpenClaw agent.
 * Split view: Terminal (left) + Trace Visualizer (right).
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

export default function MissionControlTab() {
  const [activePanel, setActivePanel] = useState<"split" | "terminal" | "traces">("split");

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
        <span>Shadow Mode: /Raw_v2, /Wiki_v2</span>
      </div>
    </div>
  );
}
