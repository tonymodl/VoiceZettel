import { NextResponse } from "next/server";
import { isGoogleConnected, getGoogleUserEmail, disconnectGoogle } from "@/lib/googleTokens";

/**
 * GET /api/auth/google/status — Check Google OAuth connection status.
 * DELETE /api/auth/google/status — Disconnect Google account.
 */

export async function GET() {
    const connected = isGoogleConnected();
    const email = getGoogleUserEmail();

    return NextResponse.json({
        connected,
        email,
        clientConfigured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    });
}

export async function DELETE() {
    const success = disconnectGoogle();
    return NextResponse.json({
        disconnected: success,
        connected: false,
    });
}
