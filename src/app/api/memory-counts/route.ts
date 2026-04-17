/**
 * @module api/memory-counts
 * Returns counts of memories grouped by category tag.
 * GET ?userId=anonymous → { ideas: 5, facts: 3, persons: 1, tasks: 2, total: 42 }
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemoryCountsByTag } from "@/lib/memoryStore";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId") ?? "anonymous";

    try {
        const counts = getMemoryCountsByTag(userId);
        return NextResponse.json(counts);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
        );
    }
}
