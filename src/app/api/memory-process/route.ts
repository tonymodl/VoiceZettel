/**
 * @module api/memory-process
 * Server-side endpoint for OpenAI memory processing.
 * Extracts requirements, mood, facts from user turns and stores them.
 * Also triggers requirements re-synthesis when needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { synthesizeRequirements } from "@/lib/requirementsSynthesizer";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

const EXTRACTION_PROMPT = `Ты — модуль памяти AI-ассистента. Анализируй сообщение пользователя и извлеки:

1. **requirements** — требования к поведению ассистента ("не спрашивай подтверждение", "отвечай короче")
2. **preferences** — предпочтения стиля ("говори как друг", "используй markdown")
3. **corrections** — исправления поведения ("ты неправильно понял", "я имел в виду...")
4. **facts** — личные факты ("моя собака Шарик", "я работаю в Google")
5. **tasks** — задачи ("напомни позвонить маме", "купить молоко")
6. **mood** — настроение (frustrated/satisfied/neutral/curious/urgent)

ВАЖНО: Извлекай ТОЛЬКО то, что ЯВНО сказано. НЕ придумывай.
Если сообщение не содержит ничего из вышеперечисленного — верни пустой список.

Ответ строго в JSON:
{
  "memories": [
    { "type": "requirement|preference|fact|task|correction", "text": "краткое описание", "priority": "critical|high|medium|low", "tags": ["remark", "тег2"] }
  ],
  "mood": "frustrated|satisfied|neutral|curious|urgent",
  "moodConfidence": 0.0-1.0,
  "summary": "одно предложение суть сообщения"
}

Для mood анализируй:
- Ругательства, "блин", "ппц", "пипец" → frustrated
- Похвала, "круто", "отлично", "молодец" → satisfied
- Вопросы, "а как", "почему" → curious  
- "Срочно", "быстро", "давай" → urgent
- Остальное → neutral`;

interface ExtractedMemory {
    type: string;
    text: string;
    priority: string;
    tags: string[];
}

interface ExtractionResult {
    memories: ExtractedMemory[];
    mood: string;
    moodConfidence: number;
    summary: string;
}

export async function POST(req: NextRequest) {
    const { userId, userText, assistantText } = await req.json() as {
        userId: string;
        userText: string;
        assistantText?: string;
    };

    if (!OPENAI_API_KEY || !userText || userText.length < 5) {
        return NextResponse.json({ skipped: true });
    }

    const startMs = Date.now();

    try {
        // Step 1: Extract memories via OpenAI
        const context = assistantText
            ? `Сообщение пользователя: "${userText}"\nОтвет ассистента: "${assistantText}"`
            : `Сообщение пользователя: "${userText}"`;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: EXTRACTION_PROMPT },
                    { role: "user", content: context },
                ],
                temperature: 0.1,
                max_tokens: 1000,
                response_format: { type: "json_object" },
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            logger.error(`[MemoryProcess] OpenAI error: ${res.status} ${body}`);
            return NextResponse.json({ error: "OpenAI failed" }, { status: 500 });
        }

        const json = await res.json() as { choices: Array<{ message: { content: string } }> };
        const raw = json.choices[0]?.message?.content ?? "";
        const result = JSON.parse(raw) as ExtractionResult;

        // Step 2: Store extracted memories in SQLite via voice-memory API (internal)
        let hasRequirements = false;
        for (const mem of result.memories) {
            const tags = [...mem.tags];
            if (!tags.includes(mem.type)) tags.push(mem.type);
            if (mem.priority === "critical") tags.push("remark");
            if (mem.type === "requirement" || mem.type === "correction") hasRequirements = true;

            try {
                const { saveMemory } = await import("@/lib/memoryStore");
                await saveMemory(userId, mem.text, tags);
            } catch (err) {
                logger.error(`[MemoryProcess] Store failed: ${err}`);
            }
        }

        // Step 3: Re-synthesize compiled rules if new requirements found
        if (hasRequirements) {
            try {
                await synthesizeRequirements(userId);
            } catch (err) {
                logger.error(`[MemoryProcess] Synthesis failed: ${err}`);
            }
        }

        const elapsed = Date.now() - startMs;
        logger.info(
            `[MemoryProcess] ${result.memories.length} memories, mood=${result.mood} (${elapsed}ms)`,
        );

        return NextResponse.json({
            memories: result.memories.length,
            mood: result.mood,
            moodConfidence: result.moodConfidence,
            hasRequirements,
            elapsed,
        });
    } catch (err) {
        logger.error(`[MemoryProcess] Failed: ${err}`);
        return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
}
