/**
 * @module providers/litellm
 * LiteLLM Provider — routes chat through local LiteLLM proxy (port 4000).
 * Supports 100+ models via a single OpenAI-compatible API.
 *
 * SHADOW INTEGRATION: This provider is ADDITIVE. It does not modify
 * or replace existing providers (openai, deepseek, google).
 * Activated only when settings.useLiteLLM === true.
 */

import { logger, SSE_HEADERS } from "./base";
import type { LLMProvider } from "./base";

const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
const LITELLM_API_KEY = process.env.LITELLM_API_KEY ?? "sk-vz-litellm-local";

class LiteLLMProvider implements LLMProvider {
    readonly name = "litellm";

    async streamChat(
        messages: Array<Record<string, unknown>>,
        systemPrompt?: string,
        model?: string,
    ): Promise<ReadableStream<Uint8Array>> {
        const finalModel = model ?? "gpt-4o";

        const body: Record<string, unknown> = {
            model: finalModel,
            messages: systemPrompt
                ? [{ role: "system", content: systemPrompt }, ...messages]
                : messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 4096,
        };

        const response = await fetch(`${LITELLM_BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${LITELLM_API_KEY}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            logger.error(`[LiteLLM] ${response.status}: ${errText.slice(0, 200)}`);
            throw new Error(`LiteLLM proxy error: ${response.status}`);
        }

        if (!response.body) {
            throw new Error("LiteLLM: no response body");
        }

        return response.body;
    }

    /**
     * List available models from LiteLLM proxy.
     */
    async listModels(): Promise<Array<{ id: string; owned_by: string }>> {
        try {
            const res = await fetch(`${LITELLM_BASE_URL}/v1/models`, {
                headers: { Authorization: `Bearer ${LITELLM_API_KEY}` },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) return [];
            const data = await res.json() as { data?: Array<{ id: string; owned_by: string }> };
            return data.data ?? [];
        } catch {
            return [];
        }
    }

    /**
     * Health check for LiteLLM proxy.
     */
    async isHealthy(): Promise<{ ok: boolean; models: number }> {
        try {
            const res = await fetch(`${LITELLM_BASE_URL}/health`, {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) return { ok: false, models: 0 };
            const models = await this.listModels();
            return { ok: true, models: models.length };
        } catch {
            return { ok: false, models: 0 };
        }
    }
}

export const litellmProvider = new LiteLLMProvider();
