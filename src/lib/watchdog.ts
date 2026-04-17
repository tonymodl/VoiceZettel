/**
 * @module watchdog
 * Background service monitor that periodically checks service health
 * and attempts auto-healing when services go down.
 * 
 * Runs server-side as a singleton. Provides:
 * - Periodic health checks every 30 seconds
 * - Automatic restart of dead services
 * - Status API for dashboard
 * - Heal action history
 */

import { logger } from "@/lib/logger";
import {
    checkServiceHealth,
    checkObsidianHealth,
    healService,
    SERVICES,
    type ServiceStatus,
    type HealResult,
} from "@/lib/serviceManager";

const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const MAX_HEAL_HISTORY = 50;
const MAX_AUTO_HEALS_PER_SERVICE = 5; // Don't keep restarting forever

interface WatchdogState {
    running: boolean;
    lastCheck: number;
    services: ServiceStatus[];
    healHistory: HealResult[];
    intervalId: ReturnType<typeof setInterval> | null;
    autoHealCounts: Map<string, number>;
}

const state: WatchdogState = {
    running: false,
    lastCheck: 0,
    services: [],
    healHistory: [],
    intervalId: null,
    autoHealCounts: new Map(),
};

async function checkAndHeal(): Promise<void> {
    const results: ServiceStatus[] = [];

    for (const svc of SERVICES) {
        const alive = await checkServiceHealth(svc.port);
        const status: ServiceStatus = {
            name: svc.name,
            port: svc.port,
            alive,
            lastCheck: Date.now(),
            healAttempts: state.autoHealCounts.get(svc.name) ?? 0,
        };

        // Auto-heal if dead and under the retry limit
        if (!alive) {
            const healCount = state.autoHealCounts.get(svc.name) ?? 0;
            if (healCount < MAX_AUTO_HEALS_PER_SERVICE) {
                logger.warn(`[Watchdog] ${svc.name} is DOWN, attempting auto-heal (attempt ${healCount + 1})`);
                const healResult = await healService(svc.name, svc.port, svc.dir, svc.cmd, [...svc.args]);
                state.healHistory.unshift(healResult);
                if (state.healHistory.length > MAX_HEAL_HISTORY) {
                    state.healHistory.pop();
                }
                state.autoHealCounts.set(svc.name, healCount + 1);
                status.alive = healResult.success;
                status.lastHeal = Date.now();
            } else {
                logger.error(`[Watchdog] ${svc.name} exceeded max auto-heal attempts (${MAX_AUTO_HEALS_PER_SERVICE})`);
                status.error = `Exceeded max auto-heal attempts`;
            }
        } else {
            // Reset heal counter on successful check
            state.autoHealCounts.set(svc.name, 0);
        }

        results.push(status);
    }

    // Obsidian (no auto-heal for Obsidian — requires manual launch)
    const obsOk = await checkObsidianHealth();
    results.push({
        name: "Obsidian",
        port: 27123,
        alive: obsOk,
        lastCheck: Date.now(),
        healAttempts: 0,
    });

    state.services = results;
    state.lastCheck = Date.now();
}

/**
 * Start the watchdog monitoring loop.
 */
export function startWatchdog(): void {
    if (state.running) return;
    state.running = true;

    logger.info("[Watchdog] Starting service monitor");

    // Initial check
    checkAndHeal().catch((err) => {
        logger.error(`[Watchdog] Initial check failed: ${err}`);
    });

    // Periodic checks
    state.intervalId = setInterval(() => {
        checkAndHeal().catch((err) => {
            logger.error(`[Watchdog] Check failed: ${err}`);
        });
    }, CHECK_INTERVAL_MS);
}

/**
 * Stop the watchdog monitoring loop.
 */
export function stopWatchdog(): void {
    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
    }
    state.running = false;
    logger.info("[Watchdog] Stopped");
}

/**
 * Force an immediate health check and heal cycle.
 */
export async function healAll(): Promise<HealResult[]> {
    const results: HealResult[] = [];

    for (const svc of SERVICES) {
        const alive = await checkServiceHealth(svc.port);
        if (!alive) {
            const result = await healService(svc.name, svc.port, svc.dir, svc.cmd, [...svc.args]);
            results.push(result);
            state.healHistory.unshift(result);
            if (state.healHistory.length > MAX_HEAL_HISTORY) {
                state.healHistory.pop();
            }
        } else {
            results.push({
                service: svc.name,
                action: "check",
                descRu: `✅ ${svc.name} уже работает`,
                success: true,
                durationMs: 0,
            });
        }
    }

    state.lastCheck = Date.now();
    return results;
}

/**
 * Get current watchdog status (for dashboard API).
 */
export function getWatchdogStatus(): {
    running: boolean;
    lastCheck: number;
    services: ServiceStatus[];
    healHistory: HealResult[];
    allHealthy: boolean;
} {
    return {
        running: state.running,
        lastCheck: state.lastCheck,
        services: state.services,
        healHistory: state.healHistory.slice(0, 20),
        allHealthy: state.services.every((s) => s.alive),
    };
}

/**
 * Reset heal counters (for manual override from dashboard).
 */
export function resetHealCounters(): void {
    state.autoHealCounts.clear();
    logger.info("[Watchdog] Heal counters reset");
}
