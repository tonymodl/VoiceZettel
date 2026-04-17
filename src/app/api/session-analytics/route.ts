/**
 * @module api/session-analytics
 * GET: Returns session analytics data for admin dashboard.
 * POST: Accepts session transcripts (backward compat — delegates to session-summary pipeline).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSatisfactionTrend } from "@/lib/sessionAnalyzer";
import { saveSessionSummary } from "@/lib/sessionSummary";
import { analyzeSession } from "@/lib/sessionAnalyzer";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId") ?? "anonymous";
    const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

    const trend = getSatisfactionTrend(userId, limit);

    // Calculate aggregate stats
    const totalSessions = trend.length;
    const avgSatisfaction = totalSessions > 0
        ? trend.reduce((sum, s) => sum + s.satisfaction, 0) / totalSessions
        : 0;
    const totalPains = trend.reduce((sum, s) => sum + s.painCount, 0);
    const recentTrend = trend.slice(0, 5);
    const olderTrend = trend.slice(5, 10);
    const recentAvg = recentTrend.length > 0
        ? recentTrend.reduce((s, t) => s + t.satisfaction, 0) / recentTrend.length
        : 0;
    const olderAvg = olderTrend.length > 0
        ? olderTrend.reduce((s, t) => s + t.satisfaction, 0) / olderTrend.length
        : 0;
    const trendDirection = recentAvg > olderAvg ? "improving" : recentAvg < olderAvg ? "declining" : "stable";

    return NextResponse.json({
        totalSessions,
        avgSatisfaction: Math.round(avgSatisfaction * 10) / 10,
        totalPains,
        trendDirection,
        sessions: trend,
    });
}

/**
 * POST /api/session-analytics
 * Backward-compatible handler. Previously this endpoint was GET-only,
 * causing all POST requests from triggerSessionAnalysis() to silently fail (405).
 * Now properly processes session transcripts via the memory pipeline.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as {
            userId?: string;
            transcript?: string | Array<{ role: string; text: string }>;
            sessionStart?: string;
            sessionEnd?: string;
        };

        const userId = body.userId ?? "anonymous";

        // Handle both formats: raw string transcript or structured array
        let transcript: Array<{ role: string; text: string }>;

        if (typeof body.transcript === "string") {
            // Legacy format: "USER: text\nASSISTANT: text"
            transcript = body.transcript.split("\n")
                .filter((l: string) => l.startsWith("USER: ") || l.startsWith("ASSISTANT: "))
                .map((l: string) => {
                    if (l.startsWith("USER: ")) return { role: "user", text: l.slice(6) };
                    return { role: "assistant", text: l.slice(11) };
                });
        } else if (Array.isArray(body.transcript)) {
            transcript = body.transcript;
        } else {
            return NextResponse.json({ saved: false, reason: "no_transcript" });
        }

        if (transcript.length < 2) {
            return NextResponse.json({ saved: false, reason: "too_short" });
        }

        // Step 1: Save session summary
        await saveSessionSummary(userId, transcript);

        // Step 2: Deep analysis (fire-and-forget)
        if (transcript.length >= 4) {
            void analyzeSession(
                {
                    sessionId: `sa_compat_${Date.now()}`,
                    userId,
                    startedAt: body.sessionStart ?? new Date().toISOString(),
                    endedAt: body.sessionEnd ?? new Date().toISOString(),
                    durationMs: 0,
                    messageCount: transcript.length,
                    userMessageCount: transcript.filter(m => m.role === "user").length,
                },
                transcript,
            ).catch(err => logger.error(`[SessionAnalytics] Analysis failed: ${err}`));
        }

        logger.info(`[SessionAnalytics] POST: saved ${transcript.length} turns for ${userId}`);
        return NextResponse.json({ saved: true, turns: transcript.length });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown" },
            { status: 500 },
        );
    }
}
