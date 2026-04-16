/**
 * /api/chat-lite — Experimental LiteLLM chat route.
 * SHADOW INTEGRATION: Parallel to /api/chat, does NOT replace it.
 * Activated only when settings.useLiteLLM === true on the frontend.
 */

import { NextRequest, NextResponse } from "next/server";
import { litellmProvider } from "@/lib/providers/litellm";
import { stripToolInstructions } from "@/lib/providers/base";
import { logger } from "@/lib/logger";
import {
    buildMemoryContext,
    buildEnrichedPrompt,
    fetchChromaContext,
    ensureVaultPreloaded,
    autoSaveUserMessage,
    loadVaultContext,
} from "@/lib/chatContext";
import { classifyAndSave } from "@/lib/messageClassifier";
import { appendCounterTags, createSSEResponse } from "@/lib/sseStream";

export async function POST(req: NextRequest) {
    try {
        const { messages, systemPrompt, userId, source, litellm_model, customWidgetPrompts } =
            await req.json() as {
                messages: Array<{ role: string; content: string }>;
                systemPrompt?: string;
                userId: string;
                source?: string;
                litellm_model?: string;
                customWidgetPrompts?: Array<{ id: string; label: string; prompt: string }>;
            };

        const isVoice = source === "voice";

        // 1. Build context (same as /api/chat)
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        const userQuery = lastUserMsg?.content ?? "";

        const [vaultContext, memoryContext] = await Promise.all([
            loadVaultContext(userId),
            buildMemoryContext(userId, userQuery),
        ]);

        await ensureVaultPreloaded(userId);

        const chromaContext = userQuery.length > 3
            ? await fetchChromaContext(userQuery)
            : "";

        const enrichedPrompt = buildEnrichedPrompt({
            systemPrompt: systemPrompt ?? "",
            provider: "openai", // LiteLLM uses OpenAI-compatible format
            isVoice,
            memoryContext,
            vaultContext,
            chromaContext,
            customWidgetPrompts,
        });

        // 2. Auto-save (fire-and-forget)
        autoSaveUserMessage(userId, messages);

        // 3. Classify for widget counters
        const classifyMsg = messages.filter((m) => m.role === "user").pop();
        const classifyPromise = classifyMsg
            ? classifyAndSave(userId, classifyMsg.content)
            : Promise.resolve({ items: [], counterTags: [] });

        // 4. Strip tool instructions (LiteLLM models may not support native tools)
        const cleanPrompt = stripToolInstructions(enrichedPrompt);

        const finalMsgs: Array<Record<string, unknown>> = messages.map((m) => ({
            role: m.role,
            content: m.content,
        }));

        // 5. Stream through LiteLLM
        const model = litellm_model ?? "gpt-4o";
        logger.info(`[chat-lite] Routing to LiteLLM model: ${model}`);

        const baseStream = await litellmProvider.streamChat(finalMsgs, cleanPrompt, model);
        return createSSEResponse(appendCounterTags(baseStream, classifyPromise, userId, isVoice));

    } catch (err) {
        const message = err instanceof Error ? err.message : "LiteLLM error";
        logger.error(`[chat-lite] Error: ${message}`);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
