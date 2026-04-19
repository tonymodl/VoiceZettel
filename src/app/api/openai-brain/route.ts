import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import OpenAI from "openai";
import { MEMORY_TOOLS, handleToolCalls } from "@/lib/chatTools";

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { query, context, userId = "anonymous" } = body;

        if (!query) {
            return NextResponse.json({ error: "Query is required" }, { status: 400 });
        }

        logger.info(`[OpenAIBrain] Received query: ${query.slice(0, 100)}`);

        const systemPrompt = `
Ты — мощный когнитивный мозг VoiceZettel.
Твоя задача — принимать запросы от голосового интерфейса (Gemini) и выполнять полезные действия, используя доступные инструменты (tools).
Gemini выступает только как уши и рот, а ты — мозг, который понимает сложный контекст и дирижирует ресурсами.
Если пользователь просит создать документ, добавить событие в календарь — сделай это.
НЕ используй send_telegram — Telegram отправляется напрямую через Gemini. Ты занимаешься ТОЛЬКО Google Docs/Sheets/Calendar.
Всегда возвращай четкий словесный ответ на русском языке о том, что было сделано, чтобы Gemini мог его озвучить.
Если создала документ или таблицу — ОБЯЗАТЕЛЬНО верни ссылку (URL).
Пользователь живёт в Барнауле (UTC+7). Используй Asia/Barnaul для всех дат/времён.

Контекст сессии (что обсуждалось ранее в разговоре):
${context ?? "нет контекста"}
`;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
        ];

        // 1. Initial call to GPT-4o with tools
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            tools: MEMORY_TOOLS as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
            tool_choice: "auto",
        });

        const responseMessage = completion.choices[0].message;

        // 2. Execute tools if GPT-4o decides to call them
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            logger.info(`[OpenAIBrain] GPT-4o invoked tools: ${responseMessage.tool_calls.map(tc => tc.type === 'function' ? tc.function.name : 'unknown').join(", ")}`);
            
            // Append assistant message with tool calls
            messages.push(responseMessage);

            // Execute the tools using our existing handleToolCalls function
            const toolResults = await handleToolCalls(userId, responseMessage.tool_calls as any);
            
            // Append tool results to messages
            for (const result of toolResults) {
                messages.push(result as OpenAI.Chat.Completions.ChatCompletionMessageParam);
            }

            // 3. Get final response from GPT-4o after tool execution
            const secondCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages,
            });
            
            const finalReply = secondCompletion.choices[0].message.content;
            return NextResponse.json({ result: finalReply });
        }

        // If no tools were called, return direct response
        return NextResponse.json({ result: responseMessage.content });

    } catch (err) {
        logger.error(`[OpenAIBrain] Error:`, err instanceof Error ? err.message : String(err));
        return NextResponse.json({ error: "Internal OpenAI error" }, { status: 500 });
    }
}
