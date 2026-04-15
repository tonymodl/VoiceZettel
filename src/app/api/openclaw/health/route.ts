/**
 * /api/openclaw/health/route.ts
 * 
 * Proxy to OpenClaw Heartbeat Daemon health endpoint (port 8040).
 */

import { NextResponse } from "next/server";

const OPENCLAW_URL = process.env.OPENCLAW_SERVICE_URL || "http://127.0.0.1:8040";

export async function GET() {
    try {
        const res = await fetch(`${OPENCLAW_URL}/health`, {
            signal: AbortSignal.timeout(4000),
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
            {
                service: "openclaw-heartbeat",
                status: "offline",
                error: msg,
            },
            { status: 503 },
        );
    }
}
