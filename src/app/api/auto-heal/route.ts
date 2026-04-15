/**
 * /api/auto-heal — diagnoses broken services and attempts to fix them.
 * 
 * Actions:
 *  - Restart indexer (kill port 8030 + start python main.py)
 *  - Restart telegram service (kill port 8020 + start python main.py)
 *  - Start ws-proxy (node ws-proxy.js on port 3099)
 *  - Clear corrupted ChromaDB and restart
 *  - Report all actions taken
 */
import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execAsync = promisify(exec);
const ROOT = process.env.PROJECT_ROOT || path.resolve(process.cwd());

interface HealAction {
    service: string;
    action: string;
    descRu: string;
    success: boolean;
    error?: string;
}

async function checkPort(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function killPort(port: number): Promise<void> {
    try {
        // Windows: find PID using port and kill it
        const { stdout } = await execAsync(
            `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
            { timeout: 10000 }
        );
        void stdout;
    } catch {
        // Port might not be in use
    }
}

async function startService(cwd: string, command: string, args: string[]): Promise<void> {
    const { spawn } = await import("child_process");
    const child = spawn(command, args, {
        cwd,
        detached: true,
        stdio: "ignore",
        shell: true,
    });
    child.unref();
    // Give it time to start
    await new Promise((resolve) => setTimeout(resolve, 4000));
}

export async function POST() {
    const actions: HealAction[] = [];

    // 1) Check & heal Indexer (port 8030)
    const indexerOk = await checkPort(8030);
    if (!indexerOk) {
        try {
            await killPort(8030);

            // Check if ChromaDB is corrupted - if chroma_data exists but indexer fails, delete it
            const chromaDir = path.join(ROOT, "services", "indexer", "chroma_data");
            const indexerDir = path.join(ROOT, "services", "indexer");

            // Try starting first
            await startService(indexerDir, "python", ["main.py"]);

            const okNow = await checkPort(8030);
            if (!okNow) {
                // ChromaDB might be corrupted — nuke and restart
                if (fs.existsSync(chromaDir)) {
                    fs.rmSync(chromaDir, { recursive: true, force: true });
                    actions.push({
                        service: "ChromaDB",
                        action: "delete_data",
                        descRu: "🗑 Удалена повреждённая база ChromaDB — будет создана заново",
                        success: true,
                    });
                }
                await startService(indexerDir, "python", ["main.py"]);
                const okAfterReset = await checkPort(8030);
                actions.push({
                    service: "Indexer",
                    action: "restart_with_reset",
                    descRu: okAfterReset
                        ? "✅ Сервис индексации перезапущен (база пересоздана)"
                        : "❌ Не удалось запустить сервис индексации",
                    success: okAfterReset,
                });
            } else {
                actions.push({
                    service: "Indexer",
                    action: "restart",
                    descRu: "✅ Сервис индексации перезапущен",
                    success: true,
                });
            }
        } catch (err) {
            actions.push({
                service: "Indexer",
                action: "restart",
                descRu: `❌ Ошибка при перезапуске индексера: ${err instanceof Error ? err.message : "unknown"}`,
                success: false,
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    } else {
        actions.push({
            service: "Indexer",
            action: "check",
            descRu: "✅ Сервис индексации уже работает",
            success: true,
        });
    }

    // 2) Check & heal Telegram (port 8020)
    const telegramOk = await checkPort(8020);
    if (!telegramOk) {
        try {
            await killPort(8020);
            const telegramDir = path.join(ROOT, "services", "telegram");
            await startService(telegramDir, "python", ["main.py"]);
            const okNow = await checkPort(8020);
            actions.push({
                service: "Telegram",
                action: "restart",
                descRu: okNow
                    ? "✅ Сервис Telegram перезапущен"
                    : "❌ Не удалось запустить Telegram сервис",
                success: okNow,
            });
        } catch (err) {
            actions.push({
                service: "Telegram",
                action: "restart",
                descRu: `❌ Ошибка: ${err instanceof Error ? err.message : "unknown"}`,
                success: false,
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    } else {
        actions.push({
            service: "Telegram",
            action: "check",
            descRu: "✅ Сервис Telegram уже работает",
            success: true,
        });
    }

    // 3) Check & heal WS Proxy (port 3099)
    let wsOk = false;
    try {
        const res = await fetch("http://127.0.0.1:3099", { signal: AbortSignal.timeout(2000) });
        wsOk = true;
        void res;
    } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // 426 Upgrade Required = server is running (just expects WebSocket)
        if (msg.includes("426") || msg.includes("Upgrade")) {
            wsOk = true;
        }
    }

    if (!wsOk) {
        try {
            await killPort(3099);
            await startService(ROOT, "node", ["ws-proxy.js"]);

            // Check again
            let wsOkNow = false;
            try {
                await fetch("http://127.0.0.1:3099", { signal: AbortSignal.timeout(2000) });
                wsOkNow = true;
            } catch (e2) {
                const m = e2 instanceof Error ? e2.message : "";
                if (m.includes("426") || m.includes("Upgrade")) wsOkNow = true;
            }

            actions.push({
                service: "WS Proxy",
                action: "start",
                descRu: wsOkNow
                    ? "✅ WebSocket прокси запущен — голосовой ассистент доступен"
                    : "❌ Не удалось запустить ws-proxy.js",
                success: wsOkNow,
            });
        } catch (err) {
            actions.push({
                service: "WS Proxy",
                action: "start",
                descRu: `❌ Ошибка: ${err instanceof Error ? err.message : "unknown"}`,
                success: false,
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    } else {
        actions.push({
            service: "WS Proxy",
            action: "check",
            descRu: "✅ WebSocket прокси уже работает",
            success: true,
        });
    }

    // 4) Check & heal Obsidian REST API
    const obsidianUrl = process.env.OBSIDIAN_REST_URL || "http://127.0.0.1:27123";
    const obsidianKey = process.env.OBSIDIAN_REST_API_KEY || "";
    let obsidianOk = false;

    // Try HTTP first, then HTTPS
    for (const url of [obsidianUrl, "http://127.0.0.1:27123", "https://127.0.0.1:27124"]) {
        try {
            const res = await fetch(`${url}/`, {
                headers: obsidianKey ? { Authorization: `Bearer ${obsidianKey}` } : {},
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok) {
                obsidianOk = true;
                break;
            }
        } catch {
            // try next
        }
    }

    if (!obsidianOk) {
        try {
            // Check if Obsidian process is running
            let obsidianRunning = false;
            try {
                const { stdout } = await execAsync(
                    'powershell -Command "Get-Process -Name Obsidian -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id }"',
                    { timeout: 5000 }
                );
                obsidianRunning = stdout.trim().length > 0;
            } catch {
                // not running
            }

            if (!obsidianRunning) {
                // Launch Obsidian with vault
                const vaultPath = process.env.VAULT_PATH || path.join(ROOT, "VoiceZettel");
                const obsidianExe = "C:\\Program Files\\Obsidian\\Obsidian.exe";

                if (fs.existsSync(obsidianExe)) {
                    const { spawn } = await import("child_process");
                    const child = spawn(obsidianExe, [`--vault=${vaultPath}`], {
                        detached: true,
                        stdio: "ignore",
                        shell: false,
                    });
                    child.unref();

                    // Wait for Obsidian to fully start and plugin to initialize
                    await new Promise((resolve) => setTimeout(resolve, 10000));

                    // Re-check
                    let okNow = false;
                    for (const url of ["http://127.0.0.1:27123", "https://127.0.0.1:27124"]) {
                        try {
                            const res = await fetch(`${url}/`, {
                                headers: obsidianKey ? { Authorization: `Bearer ${obsidianKey}` } : {},
                                signal: AbortSignal.timeout(3000),
                            });
                            if (res.ok) { okNow = true; break; }
                        } catch { /* try next */ }
                    }

                    actions.push({
                        service: "Obsidian",
                        action: "launch",
                        descRu: okNow
                            ? "✅ Obsidian запущен и REST API плагин активен"
                            : "⚠️ Obsidian запущен, но REST API ещё не готов — подождите 10-15 секунд",
                        success: okNow,
                    });
                } else {
                    actions.push({
                        service: "Obsidian",
                        action: "not_found",
                        descRu: "❌ Obsidian не найден в Program Files. Установите или запустите вручную.",
                        success: false,
                    });
                }
            } else {
                // Obsidian running but REST API not responding — plugin disabled?
                actions.push({
                    service: "Obsidian",
                    action: "plugin_issue",
                    descRu: "⚠️ Obsidian запущен, но REST API плагин не отвечает. Откройте Obsidian → Настройки → Плагины сообщества → включите Local REST API.",
                    success: false,
                });
            }
        } catch (err) {
            actions.push({
                service: "Obsidian",
                action: "error",
                descRu: `❌ Ошибка при запуске Obsidian: ${err instanceof Error ? err.message : "unknown"}`,
                success: false,
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    } else {
        actions.push({
            service: "Obsidian",
            action: "check",
            descRu: "✅ Obsidian REST API уже работает",
            success: true,
        });
    }

    // 5) Trigger re-index if ChromaDB is empty
    try {
        const res = await fetch("http://127.0.0.1:8030/health", { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            const data = await res.json() as { chroma_documents: number };
            if (data.chroma_documents === 0) {
                // Trigger full reindex
                fetch("http://127.0.0.1:8030/index/full", { method: "POST" }).catch(() => {});
                actions.push({
                    service: "ChromaDB",
                    action: "reindex",
                    descRu: "🔄 Запущена полная переиндексация — база была пуста",
                    success: true,
                });
            }
        }
    } catch {
        // Indexer might still be starting
    }

    const allOk = actions.every((a) => a.success);

    return NextResponse.json({
        status: allOk ? "healed" : "partial",
        descRu: allOk
            ? "✅ Все сервисы работают! Система готова."
            : "⚠️ Часть проблем решена, но некоторые сервисы требуют ручного вмешательства.",
        actions,
    });
}
