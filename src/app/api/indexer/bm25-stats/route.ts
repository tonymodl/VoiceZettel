/**
 * /api/indexer/bm25-stats — BM25 index statistics for dashboard.
 */
import { NextResponse } from "next/server";

const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:8030";

export async function GET() {
    try {
        const res = await fetch(`${INDEXER_URL}/bm25-stats`, {
            signal: AbortSignal.timeout(4000),
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ available: false, status: "unreachable" });
    }
}
