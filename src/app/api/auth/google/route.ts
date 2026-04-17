import { NextResponse } from "next/server";

/**
 * GET /api/auth/google — Initiates Google OAuth 2.0 flow.
 * Redirects user to Google's consent screen with required scopes.
 */

const SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar",
].join(" ");

export async function GET() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback";

    if (!clientId) {
        return NextResponse.json(
            { status: "error", message: "GOOGLE_CLIENT_ID not configured in .env" },
            { status: 500 },
        );
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", "voicezettel_workspace");

    return NextResponse.redirect(authUrl.toString());
}
