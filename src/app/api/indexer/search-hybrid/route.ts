/**
 * /api/indexer/search-hybrid — Proxy to Indexer hybrid search.
 * Shadow Integration: parallel to /api/indexer/search.
 */
import { NextRequest, NextResponse } from "next/server";

const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:8030";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const res = await fetch(`${INDEXER_URL}/search/hybrid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Hybrid search error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
