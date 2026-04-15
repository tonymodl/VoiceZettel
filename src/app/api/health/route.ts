import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json({
        status: "ok",
        service: "voicezettel-nextjs",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
    });
}
