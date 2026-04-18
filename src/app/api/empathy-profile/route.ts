/**
 * @module api/empathy-profile
 * Returns the empathy profile for admin dashboard display.
 * Also supports manual trigger of empathy evolution.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadEmpathyProfile, evolveEmpathyProfile, saveEmpathyProfile } from "@/lib/empathyEngine";

export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId") ?? "anonymous";
    
    const profile = loadEmpathyProfile(userId);
    
    if (!profile) {
        return NextResponse.json({
            exists: false,
            message: "No empathy profile yet. It will be created after first voice session.",
        });
    }

    return NextResponse.json({
        exists: true,
        profile,
    });
}

/**
 * POST /api/empathy-profile
 * Manually trigger empathy profile evolution.
 */
export async function POST(req: NextRequest) {
    const { userId } = await req.json() as { userId: string };

    const profile = await evolveEmpathyProfile(userId ?? "anonymous");

    if (!profile) {
        return NextResponse.json({ error: "Evolution failed" }, { status: 500 });
    }

    return NextResponse.json({
        evolved: true,
        empathyScore: profile.empathyScore,
        rulesCount: profile.evolvedRules.length,
        automationsCount: profile.automationOpportunities.length,
    });
}

/**
 * PUT /api/empathy-profile
 * Manually update the empathy profile.
 */
export async function PUT(req: NextRequest) {
    try {
        const { userId, profile } = await req.json();
        if (!profile) {
            return NextResponse.json({ error: "Missing profile" }, { status: 400 });
        }
        
        saveEmpathyProfile(userId ?? "anonymous", profile);
        
        return NextResponse.json({ success: true, profile });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
