/**
 * @module api/google/create-doc
 * Creates a new Google Document via Drive API.
 * Used by DocsSection in Settings panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { driveCreateDoc } from "@/lib/googleClient";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as { title?: string; content?: string };
        const title = body.title?.trim();

        if (!title) {
            return NextResponse.json({ error: "Title is required" }, { status: 400 });
        }

        const result = await driveCreateDoc(title, body.content);

        logger.info(`[Google CreateDoc] Created "${title}" → ${result.url}`);

        return NextResponse.json({
            id: result.id,
            name: result.name,
            url: result.url,
        });
    } catch (err) {
        const message = (err as Error).message;
        logger.error("[Google CreateDoc]", message);

        if (message.includes("No Google tokens") || message.includes("GOOGLE_CLIENT")) {
            return NextResponse.json({
                error: "Google OAuth not configured. Run the setup flow first.",
            }, { status: 503 });
        }

        return NextResponse.json({ error: message }, { status: 500 });
    }
}
