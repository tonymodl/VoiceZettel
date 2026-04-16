import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Google OAuth Token Manager
 * 
 * Handles reading, refreshing, and validating Google OAuth tokens
 * stored in .google/tokens.json
 */

const TOKEN_DIR = join(process.cwd(), ".google");
const TOKEN_FILE = join(TOKEN_DIR, "tokens.json");

interface GoogleTokens {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_at: number;
    scope: string;
    user_email: string;
    created_at: string;
}

/**
 * Reads stored tokens from disk.
 * Returns null if not connected.
 */
export function getStoredTokens(): GoogleTokens | null {
    try {
        if (!existsSync(TOKEN_FILE)) return null;
        const raw = readFileSync(TOKEN_FILE, "utf-8");
        return JSON.parse(raw) as GoogleTokens;
    } catch {
        return null;
    }
}

/**
 * Checks if Google OAuth is connected and tokens exist.
 */
export function isGoogleConnected(): boolean {
    const tokens = getStoredTokens();
    return tokens !== null && !!tokens.refresh_token;
}

/**
 * Returns the connected user email, or null.
 */
export function getGoogleUserEmail(): string | null {
    const tokens = getStoredTokens();
    return tokens?.user_email || null;
}

/**
 * Gets a valid access token, refreshing if expired.
 * Returns null if not connected.
 */
export async function getValidAccessToken(): Promise<string | null> {
    const tokens = getStoredTokens();
    if (!tokens) return null;

    // If token is still valid (with 5-min buffer), return it
    if (tokens.expires_at > Date.now() + 5 * 60 * 1000) {
        return tokens.access_token;
    }

    // Refresh the token
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret || !tokens.refresh_token) return null;

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

        if (!res.ok) {
            console.error("[GoogleTokens] Refresh failed:", await res.text());
            return null;
        }

        const data = await res.json();

        // Update stored tokens
        const updated: GoogleTokens = {
            ...tokens,
            access_token: data.access_token,
            expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        };
        writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2));

        return data.access_token;
    } catch (err) {
        console.error("[GoogleTokens] Refresh error:", err);
        return null;
    }
}

/**
 * Disconnects Google by deleting stored tokens.
 */
export function disconnectGoogle(): boolean {
    try {
        if (existsSync(TOKEN_FILE)) {
            const { unlinkSync } = require("fs");
            unlinkSync(TOKEN_FILE);
        }
        return true;
    } catch {
        return false;
    }
}
