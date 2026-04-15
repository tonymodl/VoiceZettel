"use client";

import { useState } from "react";
import { GitBranch, Clock, CheckCircle2, AlertTriangle, Zap } from "lucide-react";

/**
 * TraceVisualizer — Visualizes agent decision traces.
 * Shows hierarchical call tree of OpenClaw agent actions.
 * Currently renders a placeholder until real trace data is available.
 */

interface TraceNode {
  id: string;
  name: string;
  status: "success" | "error" | "running" | "pending";
  duration_ms: number;
  children: TraceNode[];
  input?: string;
  output?: string;
  timestamp: string;
}

// Demo trace data for visualization
const SAMPLE_TRACES: TraceNode[] = [
  {
    id: "1",
    name: "OpenClaw: Ingest Pipeline",
    status: "pending",
    duration_ms: 0,
    timestamp: new Date().toISOString(),
    children: [
      {
        id: "1.1",
        name: "Scan /Raw_v2 directory",
        status: "pending",
        duration_ms: 0,
        timestamp: "",
        children: [],
      },
      {
        id: "1.2",
        name: "NLP Entity Extraction",
        status: "pending",
        duration_ms: 0,
        timestamp: "",
        children: [
          { id: "1.2.1", name: "Extract Person entities", status: "pending", duration_ms: 0, timestamp: "", children: [] },
          { id: "1.2.2", name: "Extract Task entities", status: "pending", duration_ms: 0, timestamp: "", children: [] },
          { id: "1.2.3", name: "Resolve coreferences", status: "pending", duration_ms: 0, timestamp: "", children: [] },
        ],
      },
      {
        id: "1.3",
        name: "Update /Wiki_v2 pages",
        status: "pending",
        duration_ms: 0,
        timestamp: "",
        children: [],
      },
    ],
  },
];

function StatusIcon({ status }: { status: TraceNode["status"] }) {
  switch (status) {
    case "success": return <CheckCircle2 className="size-3.5 text-emerald-400" />;
    case "error": return <AlertTriangle className="size-3.5 text-red-400" />;
    case "running": return <Zap className="size-3.5 text-amber-400 animate-pulse" />;
    default: return <Clock className="size-3.5 text-zinc-600" />;
  }
}

function TraceNodeView({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        {node.children.length > 0 && (
          <span className={`text-zinc-500 text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        )}
        <StatusIcon status={node.status} />
        <span className="text-sm text-zinc-300 truncate">{node.name}</span>
        {node.duration_ms > 0 && (
          <span className="text-xs text-zinc-600 ml-auto">{node.duration_ms}ms</span>
        )}
      </div>
      {expanded && node.children.map((child) => (
        <TraceNodeView key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function TraceVisualizer() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 text-xs">
        <GitBranch className="size-3.5 text-purple-400" />
        <span className="text-zinc-400">Трассировки агента</span>
        <span className="ml-auto text-zinc-600">OpenClaw</span>
      </div>

      {/* Trace tree */}
      <div className="flex-1 overflow-auto p-2 custom-scrollbar">
        {SAMPLE_TRACES.length > 0 ? (
          SAMPLE_TRACES.map((trace) => (
            <TraceNodeView key={trace.id} node={trace} />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Агент не активен
          </div>
        )}

        {/* Placeholder notice */}
        <div className="mt-4 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20 text-xs text-purple-300/60">
          <p className="font-medium mb-1">🔮 Ожидание данных</p>
          <p>Трассировки появятся после запуска демона OpenClaw (Фаза 3). Структура дерева визуализирует цепочку решений агента в реальном времени.</p>
        </div>
      </div>
    </div>
  );
}
