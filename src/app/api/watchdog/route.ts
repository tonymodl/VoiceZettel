/**
 * /api/watchdog — Watchdog daemon control API.
 * 
 * GET  → Current watchdog status
 * POST → Start watchdog / trigger heal-all / reset counters
 */
import { NextRequest, NextResponse } from "next/server";
import { startWatchdog, stopWatchdog, getWatchdogStatus, healAll, resetHealCounters } from "@/lib/watchdog";

export const dynamic = "force-dynamic";

export async function GET() {
    const status = getWatchdogStatus();
    return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
    let body: { action?: string } = {};
    try {
        body = await req.json() as { action?: string };
    } catch { /* empty body */ }

    const action = body.action ?? "start";

    switch (action) {
        case "start":
            startWatchdog();
            return NextResponse.json({ ok: true, action: "started", status: getWatchdogStatus() });

        case "stop":
            stopWatchdog();
            return NextResponse.json({ ok: true, action: "stopped" });

        case "heal": {
            const results = await healAll();
            return NextResponse.json({ ok: true, action: "healed", results });
        }

        case "reset":
            resetHealCounters();
            return NextResponse.json({ ok: true, action: "counters_reset" });

        default:
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
}
