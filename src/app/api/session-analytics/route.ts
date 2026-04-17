/**
 * @module api/session-analytics
 * Returns session analytics data for admin dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSatisfactionTrend } from "@/lib/sessionAnalyzer";

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
