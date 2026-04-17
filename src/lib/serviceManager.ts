/**
 * @module serviceManager
 * Shared service management utilities extracted from auto-heal route.
 * Used by both /api/auto-heal and the watchdog daemon.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { logger } from "@/lib/logger";

const execAsync = promisify(exec);
const ROOT = process.env.PROJECT_ROOT || path.resolve(process.cwd());

export interface ServiceStatus {
    name: string;
    port: number;
    alive: boolean;
    lastCheck: number;
    lastHeal?: number;
    healAttempts: number;
    error?: string;
}

export interface HealResult {
    service: string;
    action: string;
    descRu: string;
    success: boolean;
    durationMs: number;
    error?: string;
}

// ── Service definitions ──────────────────────────────────────

export const SERVICES = [
    { name: "Indexer", port: 8030, dir: "services/indexer", cmd: "python", args: ["main.py"] },
    { name: "Telegram", port: 8038, dir: "services/telegram", cmd: "python", args: ["main.py"] },
    { name: "WS Proxy", port: 3099, dir: ".", cmd: "node", args: ["ws-proxy.js"] },
    { name: "OpenClaw", port: 8040, dir: "services/openclaw", cmd: "python", args: ["main.py"] },
] as const;

// ── Health check ─────────────────────────────────────────────

export async function checkServiceHealth(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) return true;
        // WS Proxy: HTTP 426 Upgrade Required = alive (WebSocket-only server)
        if (port === 3099 && res.status === 426) return true;
        return false;
    } catch {
        // Connection refused or timeout = service is truly dead
        return false;
    }
}

export async function checkObsidianHealth(): Promise<boolean> {
    const obsidianKey = process.env.OBSIDIAN_REST_API_KEY || "";
    for (const url of ["http://127.0.0.1:27123", "https://127.0.0.1:27124"]) {
        try {
            const res = await fetch(`${url}/`, {
                headers: obsidianKey ? { Authorization: `Bearer ${obsidianKey}` } : {},
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok) return true;
        } catch {
            continue;
        }
    }
    return false;
}

// ── Kill process on port ─────────────────────────────────────

export async function killPort(port: number): Promise<void> {
    try {
        await execAsync(
            `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
            { timeout: 10000 },
        );
    } catch {
        // Port might not be in use
    }
}

// ── Start a service ──────────────────────────────────────────

export async function startService(cwd: string, command: string, args: string[]): Promise<void> {
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

// ── Heal a single service ────────────────────────────────────

export async function healService(
    name: string,
    port: number,
    dir: string,
    cmd: string,
    args: string[],
): Promise<HealResult> {
    const startMs = Date.now();

    try {
        await killPort(port);
        const fullDir = path.join(ROOT, dir);

        if (!fs.existsSync(fullDir)) {
            return {
                service: name,
                action: "not_found",
                descRu: `❌ Директория ${dir} не найдена`,
                success: false,
                durationMs: Date.now() - startMs,
            };
        }

        await startService(fullDir, cmd, args);
        const alive = await checkServiceHealth(port);

        logger.info(`[ServiceManager] ${name} heal: ${alive ? "OK" : "FAILED"} (${Date.now() - startMs}ms)`);

        return {
            service: name,
            action: "restart",
            descRu: alive ? `✅ ${name} перезапущен` : `❌ Не удалось запустить ${name}`,
            success: alive,
            durationMs: Date.now() - startMs,
        };
    } catch (err) {
        return {
            service: name,
            action: "restart",
            descRu: `❌ Ошибка: ${err instanceof Error ? err.message : "unknown"}`,
            success: false,
            durationMs: Date.now() - startMs,
            error: err instanceof Error ? err.message : "unknown",
        };
    }
}

// ── Check all services ───────────────────────────────────────

export async function checkAllServices(): Promise<ServiceStatus[]> {
    const results: ServiceStatus[] = [];

    for (const svc of SERVICES) {
        const alive = await checkServiceHealth(svc.port);
        results.push({
            name: svc.name,
            port: svc.port,
            alive,
            lastCheck: Date.now(),
            healAttempts: 0,
        });
    }

    // Obsidian
    const obsOk = await checkObsidianHealth();
    results.push({
        name: "Obsidian",
        port: 27123,
        alive: obsOk,
        lastCheck: Date.now(),
        healAttempts: 0,
    });

    return results;
}
