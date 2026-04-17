/**
 * /api/voice-metrics — Returns voice session performance data.
 * Used by DashboardTab to show latency tracking.
 */
import { NextResponse } from "next/server";
import { contextCache } from "@/lib/contextCache";
import { getAllBreakerStatus } from "@/lib/circuitBreaker";
import { getWatchdogStatus } from "@/lib/watchdog";

export const dynamic = "force-dynamic";

// In-memory metrics store (latest N sessions)
interface VoiceMetric {
    sessionId: string;
    timestamp: number;
    micActivationMs: number;
    tokenGenerationMs: number;
    contextBuildMs: number;
    totalLatencyMs: number;
}

const metrics: VoiceMetric[] = [];
const MAX_METRICS = 50;

/**
 * Record a metric (called from gemini-live-token route).
 */
export function recordVoiceMetric(metric: VoiceMetric): void {
    metrics.unshift(metric);
    if (metrics.length > MAX_METRICS) {
        metrics.pop();
    }
}

export async function GET() {
    const cacheStats = contextCache.getStats();
    const breakerStatus = getAllBreakerStatus();
    const watchdog = getWatchdogStatus();

    return NextResponse.json({
        metrics: metrics.slice(0, 10),
        averages: {
            micActivationMs: avg(metrics.map(m => m.micActivationMs)),
            tokenGenerationMs: avg(metrics.map(m => m.tokenGenerationMs)),
            contextBuildMs: avg(metrics.map(m => m.contextBuildMs)),
            totalLatencyMs: avg(metrics.map(m => m.totalLatencyMs)),
        },
        cache: cacheStats,
        circuitBreakers: breakerStatus,
        watchdog: {
            running: watchdog.running,
            lastCheck: watchdog.lastCheck,
            allHealthy: watchdog.allHealthy,
            servicesDown: watchdog.services.filter(s => !s.alive).map(s => s.name),
        },
    });
}

function avg(nums: number[]): number {
    if (nums.length === 0) return 0;
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}
