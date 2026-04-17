/**
 * @module /api/auth/google/status
 * Returns Google OAuth status: whether tokens exist, scopes, and if write access is available.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const TOKENS_PATH = path.join(process.cwd(), ".google", "tokens.json");

export async function GET() {
    try {
        const raw = await fs.readFile(TOKENS_PATH, "utf-8");
        const tokens = JSON.parse(raw) as {
            scope: string;
            expires_at: number;
            user_email?: string;
        };

        const scopes = tokens.scope.split(" ");
        const hasWrite = scopes.some(
            (s) =>
                s === "https://www.googleapis.com/auth/spreadsheets" ||
                s === "https://www.googleapis.com/auth/documents",
        );
        const hasCalendar = scopes.some(
            (s) => s === "https://www.googleapis.com/auth/calendar",
        );
        const isExpired = Date.now() > tokens.expires_at;

        return NextResponse.json({
            connected: true,
            hasWriteAccess: hasWrite,
            hasCalendarAccess: hasCalendar,
            isExpired,
            email: tokens.user_email || "unknown",
            scopes,
        });
    } catch {
        return NextResponse.json({
            connected: false,
            hasWriteAccess: false,
            isExpired: true,
            email: null,
            scopes: [],
        });
    }
}
