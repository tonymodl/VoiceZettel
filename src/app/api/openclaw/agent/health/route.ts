/**
 * /api/openclaw/agent/health — Deep Agent health for dashboard.
 */
import { NextResponse } from "next/server";

const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://localhost:8040";

export async function GET() {
    try {
        const res = await fetch(`${OPENCLAW_URL}/agent/health`, {
            signal: AbortSignal.timeout(4000),
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ service: "deep-agent", status: "unreachable", enabled: false });
    }
}
