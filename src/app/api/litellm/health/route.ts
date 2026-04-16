/**
 * /api/litellm/health — LiteLLM proxy health check for dashboard.
 */
import { NextResponse } from "next/server";
import { litellmProvider } from "@/lib/providers/litellm";

export async function GET() {
    const health = await litellmProvider.isHealthy();
    return NextResponse.json({
        service: "litellm-proxy",
        status: health.ok ? "ok" : "offline",
        models: health.models,
    });
}
