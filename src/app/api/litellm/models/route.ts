/**
 * /api/litellm/models — List available models from LiteLLM proxy.
 */
import { NextResponse } from "next/server";
import { litellmProvider } from "@/lib/providers/litellm";

export async function GET() {
    const models = await litellmProvider.listModels();
    return NextResponse.json({ models });
}
