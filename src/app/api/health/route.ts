import { NextResponse } from "next/server";
import { getWatchdogStatus } from "@/lib/watchdog";
import { getGoldenCircle, type GoldenPerson } from "@/lib/goldenContext";
import { contextCache } from "@/lib/contextCache";
import { toBangkokISO } from "@/lib/timezone";
import { getAllBreakerStatus } from "@/lib/circuitBreaker";

export const dynamic = "force-dynamic";

export function GET() {
    let watchdog: ReturnType<typeof getWatchdogStatus> | null = null;
    try {
        watchdog = getWatchdogStatus();
    } catch {
        // Watchdog might not be initialized yet
    }

    const cacheStats = contextCache.getStats();
    const breakerStatus = getAllBreakerStatus();
    
    // Load dynamic Golden Context from SQLite
    let goldenContexts: GoldenPerson[] = [];
    try {
        goldenContexts = getGoldenCircle();
    } catch {
        // Fallback or ignore
    }

    return NextResponse.json({
        status: "ok",
        service: "voicezettel-nextjs",
        version: process.env.npm_package_version ?? "2.0.0",
        environment: process.env.NODE_ENV ?? "development",
        timestamp: toBangkokISO(),
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
        context: {
            goldenCircle: goldenContexts.length,
            goldenCircleNames: goldenContexts.map(p => p.name),
            cacheEntries: cacheStats.size,
            cachedKeys: cacheStats.keys,
        },
        circuitBreakers: Object.fromEntries(
            breakerStatus.map(b => [b.tool, { state: b.state.toUpperCase(), failCount: b.failures, lastFail: 0 }])
        ),
        watchdog: watchdog
            ? {
                  running: watchdog.running,
                  lastCheck: watchdog.lastCheck,
                  allHealthy: watchdog.allHealthy,
                  servicesOnline: watchdog.services.filter(s => s.alive).length,
                  servicesTotal: watchdog.services.length,
              }
            : null,
    });
}
