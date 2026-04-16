import { NextResponse } from "next/server";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * GET /api/auth/google/callback — OAuth 2.0 callback handler.
 * Exchanges authorization code for access + refresh tokens,
 * stores them locally, and redirects back to admin dashboard.
 */

const TOKEN_DIR = join(process.cwd(), ".google");
const TOKEN_FILE = join(TOKEN_DIR, "tokens.json");

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
        return NextResponse.redirect(
            new URL(`/admin?tab=workspace&error=${encodeURIComponent(error)}`, request.url),
        );
    }

    if (!code) {
        return NextResponse.redirect(
            new URL("/admin?tab=workspace&error=no_code", request.url),
        );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback";

    if (!clientId || !clientSecret) {
        return NextResponse.redirect(
            new URL("/admin?tab=workspace&error=missing_credentials", request.url),
        );
    }

    try {
        // Exchange code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            console.error("[Google OAuth] Token exchange failed:", err);
            return NextResponse.redirect(
                new URL(`/admin?tab=workspace&error=token_exchange_failed`, request.url),
            );
        }

        const tokens = await tokenRes.json();

        // Get user info
        let userEmail = "unknown";
        try {
            const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (infoRes.ok) {
                const info = await infoRes.json();
                userEmail = info.email || "unknown";
            }
        } catch { /* non-critical */ }

        // Store tokens securely
        const tokenData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type || "Bearer",
            expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
            scope: tokens.scope,
            user_email: userEmail,
            created_at: new Date().toISOString(),
        };

        if (!existsSync(TOKEN_DIR)) {
            mkdirSync(TOKEN_DIR, { recursive: true });
        }
        writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

        console.log(`[Google OAuth] ✅ Authorized as ${userEmail}`);

        return NextResponse.redirect(
            new URL(`/admin?tab=workspace&success=google_connected&email=${encodeURIComponent(userEmail)}`, request.url),
        );
    } catch (err) {
        console.error("[Google OAuth] Callback error:", err);
        return NextResponse.redirect(
            new URL("/admin?tab=workspace&error=callback_exception", request.url),
        );
    }
}
