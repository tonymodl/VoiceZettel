/**
 * @module api/synthesize-rules
 * Manually triggers re-synthesis of compiled behavioral rules.
 * Called from VoiceServicesHealth "Починить" button when rules are missing.
 */

import { NextRequest, NextResponse } from "next/server";
import { synthesizeRequirements, loadCompiledRules } from "@/lib/requirementsSynthesizer";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({})) as { userId?: string };
    const userId = body.userId ?? "anonymous";

    try {
        logger.info(`[SynthesizeRules] Manual re-synthesis triggered for ${userId}`);

        const result = await synthesizeRequirements(userId);

        if (!result || result.length === 0) {
            return NextResponse.json({
                ok: false,
                error: "No session data to synthesize from. Complete at least one voice session first.",
            }, { status: 422 });
        }

        // Verify by loading back
        const compiled = loadCompiledRules(userId);

        return NextResponse.json({
            ok: true,
            rulesLength: compiled.length,
            message: `Compiled ${compiled.length} characters of behavioral rules.`,
        });
    } catch (err) {
        logger.error("[SynthesizeRules] Error:", (err as Error).message);
        return NextResponse.json({
            ok: false,
            error: (err as Error).message,
        }, { status: 500 });
    }
}
