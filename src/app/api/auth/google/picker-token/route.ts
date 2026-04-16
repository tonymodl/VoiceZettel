import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * GET /api/auth/google/picker-token
 * Returns a short-lived access token for Google Picker API.
 * Refreshes the token if expired.
 */

const TOKEN_FILE = join(process.cwd(), ".google", "tokens.json");

interface StoredTokens {
    access_token: string;
    refresh_token?: string;
    expires_at: number;
    user_email?: string;
}

async function refreshAccessToken(tokens: StoredTokens): Promise<string | null> {
    if (!tokens.refresh_token) return null;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: tokens.refresh_token,
                grant_type: "refresh_token",
            }),
        });

        if (!res.ok) return null;
        const data = await res.json();
        return data.access_token || null;
    } catch {
        return null;
    }
}

export async function GET() {
    if (!existsSync(TOKEN_FILE)) {
        return NextResponse.json(
            { status: "error", message: "Google not connected" },
            { status: 401 },
        );
    }

    try {
        const raw = readFileSync(TOKEN_FILE, "utf-8");
        const tokens: StoredTokens = JSON.parse(raw);

        let accessToken = tokens.access_token;

        // Check if token is expired (with 5min buffer)
        if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
            const refreshed = await refreshAccessToken(tokens);
            if (!refreshed) {
                return NextResponse.json(
                    { status: "error", message: "Token expired, re-authenticate" },
                    { status: 401 },
                );
            }
            accessToken = refreshed;
        }

        return NextResponse.json({
            status: "ok",
            accessToken,
            clientId: process.env.GOOGLE_CLIENT_ID,
            appId: process.env.GOOGLE_APP_ID || "",
        });
    } catch (err) {
        return NextResponse.json(
            { status: "error", message: (err as Error).message },
            { status: 500 },
        );
    }
}
