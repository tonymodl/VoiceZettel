/**
 * @module circuitBreaker
 * Circuit breaker pattern for tool calls.
 * 
 * Prevents infinite error loops when a tool repeatedly fails.
 * States:
 *   CLOSED  — normal operation, calls pass through
 *   OPEN    — tool is broken, calls are rejected immediately
 *   HALF_OPEN — one probe call allowed to test recovery
 * 
 * Transition: CLOSED → (maxFailures reached) → OPEN → (cooldown) → HALF_OPEN → (success) → CLOSED
 *                                                                              → (failure) → OPEN
 */

import { logger } from "@/lib/logger";

type CircuitState = "closed" | "open" | "half_open";

interface BreakerEntry {
    state: CircuitState;
    failures: number;
    lastFailure: number;
    lastSuccess: number;
    totalCalls: number;
    totalFailures: number;
}

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_COOLDOWN_MS = 30_000; // 30 seconds

const breakers = new Map<string, BreakerEntry>();

function getEntry(tool: string): BreakerEntry {
    let entry = breakers.get(tool);
    if (!entry) {
        entry = {
            state: "closed",
            failures: 0,
            lastFailure: 0,
            lastSuccess: 0,
            totalCalls: 0,
            totalFailures: 0,
        };
        breakers.set(tool, entry);
    }
    return entry;
}

/**
 * Check if a tool call should be allowed.
 * Returns true if the call can proceed, false if blocked by circuit breaker.
 */
export function canCallTool(tool: string): boolean {
    const entry = getEntry(tool);

    switch (entry.state) {
        case "closed":
            return true;

        case "open": {
            // Check if cooldown has elapsed → transition to half_open
            const elapsed = Date.now() - entry.lastFailure;
            if (elapsed >= DEFAULT_COOLDOWN_MS) {
                entry.state = "half_open";
                logger.info(`[CircuitBreaker] ${tool}: OPEN → HALF_OPEN (cooldown elapsed)`);
                return true; // Allow one probe call
            }
            return false;
        }

        case "half_open":
            return true; // Allow one probe call
    }
}

/**
 * Record a successful tool call.
 */
export function recordSuccess(tool: string): void {
    const entry = getEntry(tool);
    entry.totalCalls++;
    entry.lastSuccess = Date.now();

    if (entry.state === "half_open" || entry.state === "open") {
        logger.info(`[CircuitBreaker] ${tool}: ${entry.state} → CLOSED (success)`);
    }

    entry.state = "closed";
    entry.failures = 0;
}

/**
 * Record a failed tool call. May trigger state transition to OPEN.
 */
export function recordFailure(tool: string): void {
    const entry = getEntry(tool);
    entry.totalCalls++;
    entry.totalFailures++;
    entry.failures++;
    entry.lastFailure = Date.now();

    if (entry.state === "half_open") {
        // Probe failed → back to open
        entry.state = "open";
        logger.info(`[CircuitBreaker] ${tool}: HALF_OPEN → OPEN (probe failed, ${entry.failures} consecutive failures)`);
        return;
    }

    if (entry.failures >= DEFAULT_MAX_FAILURES) {
        entry.state = "open";
        logger.info(`[CircuitBreaker] ${tool}: CLOSED → OPEN (${entry.failures} consecutive failures)`);
    }
}

/**
 * Get the blocking message for the LLM when circuit is open.
 */
export function getBlockedMessage(tool: string): string {
    const entry = getEntry(tool);
    const remainingMs = DEFAULT_COOLDOWN_MS - (Date.now() - entry.lastFailure);
    const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));
    return `Инструмент "${tool}" временно недоступен (${entry.failures} ошибок подряд). Автовосстановление через ${remainingSec} сек. Предложи пользователю альтернативу или смени тему.`;
}

/**
 * Get status of all circuit breakers (for dashboard).
 */
export function getAllBreakerStatus(): Array<{
    tool: string;
    state: CircuitState;
    failures: number;
    totalCalls: number;
    totalFailures: number;
}> {
    const result: Array<{
        tool: string;
        state: CircuitState;
        failures: number;
        totalCalls: number;
        totalFailures: number;
    }> = [];
    for (const [tool, entry] of breakers.entries()) {
        result.push({
            tool,
            state: entry.state,
            failures: entry.failures,
            totalCalls: entry.totalCalls,
            totalFailures: entry.totalFailures,
        });
    }
    return result;
}

/**
 * Reset a specific circuit breaker (manual override from dashboard).
 */
export function resetBreaker(tool: string): void {
    breakers.delete(tool);
    logger.info(`[CircuitBreaker] ${tool}: RESET by operator`);
}
