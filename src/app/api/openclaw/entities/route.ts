/**
 * /api/openclaw/entities/route.ts
 * 
 * Proxy to OpenClaw Heartbeat Daemon entities endpoint.
 */

import { NextResponse } from "next/server";

const OPENCLAW_URL = process.env.OPENCLAW_SERVICE_URL || "http://127.0.0.1:8040";

export async function GET() {
    try {
        const res = await fetch(`${OPENCLAW_URL}/entities`, {
            signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
            { error: "OpenClaw entities unavailable", details: msg },
            { status: 503 },
        );
    }
}
