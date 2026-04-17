import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/logs/stream — Server-Sent Events endpoint for real-time log streaming.
 * 
 * Reads log files from data/logs/ and .antigravity/logs/ directories
 * and streams new entries via SSE. Read-only, zero side effects.
 */

const LOG_DIRS = [
  path.join(process.cwd(), "data", "logs"),
  path.join(process.cwd(), ".antigravity", "logs"),
];

function getRecentLogs(maxLines = 100): string[] {
  const lines: string[] = [];

  for (const dir of LOG_DIRS) {
    if (!fs.existsSync(dir)) continue;

    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".log") || f.endsWith(".json"))
        .sort()
        .slice(-5); // Last 5 log files

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          const fileLines = content.split("\n").filter(Boolean).slice(-maxLines);
          lines.push(...fileLines.map((l) => `[${file}] ${l}`));
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return lines.slice(-maxLines);
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial burst of recent logs
      const recentLogs = getRecentLogs(50);
      for (const line of recentLogs) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "log", text: line, ts: Date.now() })}\n\n`)
        );
      }

      // Then poll for new logs every 2 seconds
      let lastCount = recentLogs.length;
      const interval = setInterval(() => {
        try {
          const currentLogs = getRecentLogs(200);
          if (currentLogs.length > lastCount) {
            const newLines = currentLogs.slice(lastCount);
            for (const line of newLines) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "log", text: line, ts: Date.now() })}\n\n`)
              );
            }
            lastCount = currentLogs.length;
          }

          // Send heartbeat
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", ts: Date.now() })}\n\n`)
          );
        } catch {
          clearInterval(interval);
          try { controller.close(); } catch { /* already closed */ }
        }
      }, 2000);

      // Cleanup on client disconnect
      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Auto-close after 5 minutes to prevent zombie connections
      setTimeout(cleanup, 5 * 60 * 1000);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
