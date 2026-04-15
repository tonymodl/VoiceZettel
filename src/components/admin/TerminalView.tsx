"use client";

import { useEffect, useRef, useState } from "react";

/**
 * TerminalView — xterm.js terminal for real-time log streaming.
 * Connects to SSE endpoint /api/logs/stream and renders logs in a terminal emulator.
 */

// Color codes for log levels
const LEVEL_COLORS = {
  ERROR: "\x1b[31m",   // Red
  WARN: "\x1b[33m",    // Yellow
  INFO: "\x1b[36m",    // Cyan
  DEBUG: "\x1b[90m",   // Gray
  RESET: "\x1b[0m",
};

function colorize(text: string): string {
  if (text.includes("ERROR") || text.includes("error")) return `${LEVEL_COLORS.ERROR}${text}${LEVEL_COLORS.RESET}`;
  if (text.includes("WARN") || text.includes("warn")) return `${LEVEL_COLORS.WARN}${text}${LEVEL_COLORS.RESET}`;
  if (text.includes("INFO") || text.includes("info")) return `${LEVEL_COLORS.INFO}${text}${LEVEL_COLORS.RESET}`;
  if (text.includes("DEBUG") || text.includes("debug")) return `${LEVEL_COLORS.DEBUG}${text}${LEVEL_COLORS.RESET}`;
  return text;
}

export default function TerminalView() {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [lineCount, setLineCount] = useState(0);

  useEffect(() => {
    if (!termRef.current) return;

    let terminal: import("@xterm/xterm").Terminal | null = null;
    let eventSource: EventSource | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      
      // Import CSS
      await import("@xterm/xterm/css/xterm.css");

      terminal = new Terminal({
        theme: {
          background: "#0a0a0f",
          foreground: "#a0a0b0",
          cursor: "#7c3aed",
          selectionBackground: "#7c3aed40",
          black: "#0a0a0f",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e2e8f0",
        },
        fontSize: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 5000,
        disableStdin: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current!);
      fitAddon.fit();

      // Welcome message
      terminal.writeln("\x1b[35m╔══════════════════════════════════════════════╗\x1b[0m");
      terminal.writeln("\x1b[35m║\x1b[0m  🚀 VoiceZettel Mission Control               \x1b[35m║\x1b[0m");
      terminal.writeln("\x1b[35m║\x1b[0m  OpenClaw Agent Log Stream                     \x1b[35m║\x1b[0m");
      terminal.writeln("\x1b[35m╚══════════════════════════════════════════════╝\x1b[0m");
      terminal.writeln("");

      // Connect to SSE
      terminal.writeln("\x1b[36m⟳ Подключение к потоку логов...\x1b[0m");
      eventSource = new EventSource("/api/logs/stream");

      eventSource.onopen = () => {
        setConnected(true);
        terminal?.writeln("\x1b[32m✓ Подключено к SSE /api/logs/stream\x1b[0m\n");
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log" && data.text) {
            const coloredLine = colorize(data.text);
            terminal?.writeln(coloredLine);
            setLineCount((c) => c + 1);
          }
          // Heartbeats are silent
        } catch {
          terminal?.writeln(event.data);
        }
      };

      eventSource.onerror = () => {
        setConnected(false);
        terminal?.writeln("\x1b[31m✗ Соединение потеряно. Переподключение через 5с...\x1b[0m");
      };

      // Responsive resize
      const resizeObserver = new ResizeObserver(() => fitAddon?.fit());
      resizeObserver.observe(termRef.current!);

      return () => resizeObserver.disconnect();
    };

    init();

    return () => {
      eventSource?.close();
      terminal?.dispose();
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <div className={`size-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
          <span className="text-zinc-400">
            {connected ? "Подключено" : "Отключено"}
          </span>
        </div>
        <span className="text-zinc-500">{lineCount} строк</span>
      </div>
      {/* Terminal container */}
      <div ref={termRef} className="flex-1 min-h-0" />
    </div>
  );
}
