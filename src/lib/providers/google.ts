/**
 * @module providers/google
 * Google Gemini 2.0 Flash provider. Transforms Gemini SSE format
 * to OpenAI-compatible SSE for unified downstream processing.
 */
import type { ChatMessage, LLMProvider } from "./base";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

/** Google Gemini streaming with SSE transform to OpenAI-compatible format */
async function streamGemini(
    messages: Array<Record<string, unknown>>,
    systemPrompt?: string,
): Promise<ReadableStream<Uint8Array>> {
    if (!GOOGLE_GEMINI_API_KEY) {
        throw new Error("GOOGLE_GEMINI_API_KEY is not configured");
    }

    const chatMessages = messages as unknown as Array<{
        role: string;
        content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>;

    const contents = chatMessages.map((m) => {
        const role = m.role === "assistant" ? "model" : "user";

        // Handle multimodal content (array of parts)
        if (Array.isArray(m.content)) {
            const parts: Array<Record<string, unknown>> = [];
            for (const part of m.content) {
                if (part.type === "text" && part.text) {
                    parts.push({ text: part.text });
                } else if (part.type === "image_url" && part.image_url?.url) {
                    const url = part.image_url.url;
                    // Handle base64 data URLs
                    if (url.startsWith("data:")) {
                        const [meta, base64] = url.split(",");
                        const mimeType = meta?.match(/data:(.*?);/)?.[1] || "image/jpeg";
                        parts.push({
                            inlineData: { mimeType, data: base64 },
                        });
                    } else {
                        // External URL — use file URI
                        parts.push({
                            fileData: { mimeType: "image/jpeg", fileUri: url },
                        });
                    }
                }
            }
            if (parts.length === 0) parts.push({ text: "" });
            return { role, parts };
        }

        // Simple text content
        return {
            role,
            parts: [{ text: m.content as string }],
        };
    });

    const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature: 0.7 },
    };

    if (systemPrompt) {
        body.systemInstruction = {
            parts: [{ text: systemPrompt }],
        };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GOOGLE_GEMINI_API_KEY}`;

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(`Gemini error ${res.status}: ${errText}`);
    }

    // Transform Gemini SSE to OpenAI-compatible SSE format
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                return;
            }

            const text = decoder.decode(value, { stream: true });
            const lines = text.split("\n");

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(jsonStr) as {
                        candidates?: Array<{
                            content?: {
                                parts?: Array<{ text?: string }>;
                            };
                        }>;
                    };
                    const part = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (part) {
                        const chunk = JSON.stringify({
                            choices: [{ delta: { content: part }, index: 0 }],
                        });
                        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                    }
                } catch {
                    // skip unparseable lines
                }
            }
        },
    });
}

/**
 * Gemini provider uses a different streamChat signature:
 * it accepts (messages, systemPrompt) directly rather than
 * pre-assembled messages with system prompt inline.
 */
export const googleProvider: LLMProvider & {
    streamWithPrompt(messages: ChatMessage[], systemPrompt?: string): Promise<ReadableStream<Uint8Array>>;
} = {
    name: "google",
    streamChat: streamGemini,
    streamWithPrompt: streamGemini as unknown as (messages: ChatMessage[], systemPrompt?: string) => Promise<ReadableStream<Uint8Array>>,
};
