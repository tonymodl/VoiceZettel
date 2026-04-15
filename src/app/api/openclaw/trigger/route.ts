/**
 * /api/openclaw/trigger/route.ts
 * 
 * Proxy to OpenClaw Heartbeat Daemon — triggers manual ingest cycle.
 */

import { NextResponse } from "next/server";

const OPENCLAW_URL = process.env.OPENCLAW_SERVICE_URL || "http://127.0.0.1:8040";

export async function POST() {
    try {
        const res = await fetch(`${OPENCLAW_URL}/trigger`, {
            method: "POST",
            signal: AbortSignal.timeout(120000), // 2 min — ingest can take time
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
            { error: "OpenClaw сервис не запущен", details: msg },
            { status: 503 },
        );
    }
}
