import { NextRequest, NextResponse } from "next/server";
import { getGoldenCircle, saveGoldenCircle, GoldenPerson, DEFAULT_GOLDEN_CIRCLE } from "@/lib/goldenContext";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get("userId") || "anonymous";

        const people = getGoldenCircle(userId);
        return NextResponse.json({
            success: true,
            people
        });
    } catch (err) {
        logger.error(`[API] GET /api/golden-context error: ${err}`);
        return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const userId = body.userId || "anonymous";
        const people = body.people as GoldenPerson[];

        if (!Array.isArray(people)) {
            return NextResponse.json({ success: false, error: "Invalid payload: people must be an array" }, { status: 400 });
        }

        saveGoldenCircle(people, userId);

        return NextResponse.json({
            success: true,
            message: "Golden Context updated successfully",
        });
    } catch (err) {
        logger.error(`[API] PUT /api/golden-context error: ${err}`);
        return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
    }
}
