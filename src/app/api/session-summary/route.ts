import { NextRequest, NextResponse } from "next/server";
import { saveSessionSummary } from "@/lib/sessionSummary";
import { analyzeSession } from "@/lib/sessionAnalyzer";
import { synthesizeRequirements } from "@/lib/requirementsSynthesizer";
import { evolveEmpathyProfile } from "@/lib/empathyEngine";
import { logger } from "@/lib/logger";

/**
 * POST /api/session-summary
 * Saves a summary of the completed voice session to SQLite.
 * Also triggers deep session analysis (fire-and-forget) for self-improvement.
 * Called by stopVoice() on the client when a session ends.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as {
            userId?: string;
            transcript?: Array<{ role: string; text: string }>;
            sessionMeta?: {
                sessionId?: string;
                startedAt?: string;
                endedAt?: string;
                durationMs?: number;
                deviceType?: "desktop" | "mobile" | "tablet";
            };
        };

        const userId = body.userId ?? "anonymous";
        const transcript = body.transcript ?? [];

        if (transcript.length < 2) {
            return NextResponse.json({ saved: false, reason: "too_short" });
        }

        // Step 1: Save basic session summary (fast)
        await saveSessionSummary(userId, transcript);

        // Step 2: Deep session analysis in background (fire-and-forget)
        // This extracts satisfaction, pain points, improvement tasks
        const meta = body.sessionMeta;
        if (transcript.length >= 4) {
            void (async () => {
                try {
                    const analysis = await analyzeSession(
                        {
                            sessionId: meta?.sessionId ?? `s_${Date.now()}`,
                            userId,
                            startedAt: meta?.startedAt ?? new Date().toISOString(),
                            endedAt: meta?.endedAt ?? new Date().toISOString(),
                            durationMs: meta?.durationMs ?? 0,
                            messageCount: transcript.length,
                            userMessageCount: transcript.filter(m => m.role === "user").length,
                            deviceType: meta?.deviceType,
                        },
                        transcript,
                    );

                    // If analysis generated new requirements, re-synthesize compiled rules
                    if (analysis && (analysis.improvementTasks.length > 0 || analysis.painPoints.some(p => p.severity === "critical" || p.severity === "high"))) {
                        await synthesizeRequirements(userId);
                        logger.info("[SessionSummary] Re-synthesized rules after session analysis");
                    }

                    // Evolve empathy profile with ALL accumulated data
                    await evolveEmpathyProfile(userId);
                    logger.info("[SessionSummary] Empathy profile evolved");
                } catch (err) {
                    logger.error(`[SessionSummary] Analysis failed: ${err}`);
                }
            })();
        }

        return NextResponse.json({ saved: true });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Unknown" },
            { status: 500 },
        );
    }
}
