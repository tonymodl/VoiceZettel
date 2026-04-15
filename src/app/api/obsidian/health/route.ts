/**
 * /api/obsidian/health — proxy health check to Obsidian REST API.
 * Tries HTTP (27123) first, then HTTPS (27124) as fallback.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OBSIDIAN_URL = process.env.OBSIDIAN_REST_URL || "http://127.0.0.1:27123";
const OBSIDIAN_KEY = process.env.OBSIDIAN_REST_API_KEY || "";

async function tryFetch(url: string): Promise<{ ok: boolean; data?: Record<string, unknown> }> {
    try {
        const res = await fetch(`${url}/`, {
            headers: OBSIDIAN_KEY ? { Authorization: `Bearer ${OBSIDIAN_KEY}` } : {},
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            return { ok: true, data };
        }
        return { ok: false };
    } catch {
        return { ok: false };
    }
}

export async function GET() {
    // Try primary URL from env
    let result = await tryFetch(OBSIDIAN_URL);

    // Fallback: try HTTP 27123 if primary failed
    if (!result.ok && !OBSIDIAN_URL.includes("27123")) {
        result = await tryFetch("http://127.0.0.1:27123");
    }

    // Fallback: try HTTPS 27124 (may fail due to self-signed cert)
    if (!result.ok) {
        result = await tryFetch("https://127.0.0.1:27124");
    }

    if (result.ok) {
        return NextResponse.json({
            status: "ok",
            version: (result.data as { versions?: { self?: string } })?.versions?.self ?? "unknown",
            authenticated: (result.data as { authenticated?: boolean })?.authenticated ?? false,
        });
    }

    return NextResponse.json({
        status: "offline",
        error: "Obsidian REST API не отвечает ни на одном порту (27123/27124)",
    }, { status: 503 });
}
