/**
 * @module api/google/list-files
 * Lists recent Google Docs/Sheets files from Drive.
 * Used by DocsSection in Settings panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { driveListFiles } from "@/lib/googleClient";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({})) as { query?: string; maxResults?: number };
        const files = await driveListFiles(body.query, body.maxResults ?? 20);

        // Add webViewLink to each file
        const enrichedFiles = files.map((f) => ({
            ...f,
            webViewLink: f.mimeType === "application/vnd.google-apps.spreadsheet"
                ? `https://docs.google.com/spreadsheets/d/${f.id}/edit`
                : `https://docs.google.com/document/d/${f.id}/edit`,
        }));

        return NextResponse.json({ files: enrichedFiles });
    } catch (err) {
        const message = (err as Error).message;
        logger.error("[Google ListFiles]", message);

        // If tokens missing, return empty list with hint
        if (message.includes("No Google tokens") || message.includes("GOOGLE_CLIENT")) {
            return NextResponse.json({
                files: [],
                error: "Google OAuth not configured. Run the setup flow first.",
            });
        }

        return NextResponse.json({ files: [], error: message }, { status: 500 });
    }
}
