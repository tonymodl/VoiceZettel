import { z } from "zod";

// Multimodal content part — text or inline data (base64 image/document)
const ContentPartSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("text"),
        text: z.string(),
    }),
    z.object({
        type: z.literal("image_url"),
        image_url: z.object({
            url: z.string(), // data:image/jpeg;base64,... or URL
        }),
    }),
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;

export const ChatRequestSchema = z.object({
    messages: z.array(
        z.object({
            role: z.enum(["user", "assistant", "system"]),
            // content can be a simple string OR array of content parts (multimodal)
            content: z.union([z.string(), z.array(ContentPartSchema)]),
        }),
    ),
    provider: z.enum(["openai", "google", "deepseek"]).default("openai"),
    systemPrompt: z.string().optional(),
    userId: z.string().default("anonymous"),
    source: z.enum(["text", "voice"]).default("text"),
    customWidgetPrompts: z.array(
        z.object({
            id: z.string(),
            label: z.string(),
            prompt: z.string(),
        }),
    ).optional(),
    /** Phase 2: use hybrid BM25+ChromaDB search instead of pure vector */
    useHybridSearch: z.boolean().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Extract text content from a message (handles both string and multimodal) */
export function extractTextContent(content: string | ContentPart[]): string {
    if (typeof content === "string") return content;
    return content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
}

/** Check if message has image attachments */
export function hasImageContent(content: string | ContentPart[]): boolean {
    if (typeof content === "string") return false;
    return content.some((p) => p.type === "image_url");
}
