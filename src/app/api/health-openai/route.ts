/**
 * /api/health-openai — health check for OpenAI API.
 * 
 * Checks:
 *  1. API key valid (via /v1/models)
 *  2. GPT-4 and embeddings available
 *  3. Rate limit headers
 *  4. Quick chat completion test (1 token) for billing status
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENAI_KEY = process.env.OPENAI_API_KEY;

export async function GET() {
    if (!OPENAI_KEY) {
        return NextResponse.json({
            status: "unconfigured",
            descRu: "❌ OPENAI_API_KEY не задан в .env",
        }, { status: 503 });
    }

    try {
        // 1) Check models list
        const modelsRes = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${OPENAI_KEY}` },
            signal: AbortSignal.timeout(8000),
        });

        if (!modelsRes.ok) {
            const errText = await modelsRes.text().catch(() => "");
            let descRu = `❌ OpenAI API ошибка ${modelsRes.status}`;
            if (modelsRes.status === 401) descRu = "❌ API-ключ недействителен. Замените OPENAI_API_KEY в .env.";
            else if (modelsRes.status === 429) descRu = "⚠️ Лимит запросов превышен. Подождите или увеличьте тариф.";
            else if (modelsRes.status === 402) descRu = "❌ Недостаточно средств. Пополните на platform.openai.com/billing.";
            return NextResponse.json({
                status: "error",
                httpCode: modelsRes.status,
                descRu,
                error: errText.slice(0, 300),
            }, { status: 503 });
        }

        const modelsData = await modelsRes.json() as { data: Array<{ id: string }> };
        const models = modelsData.data || [];
        const hasGpt4 = models.some(m => m.id.includes("gpt-4"));
        const hasEmbed = models.some(m => m.id.includes("embedding"));
        const hasO = models.some(m => m.id.startsWith("o1") || m.id.startsWith("o3") || m.id.startsWith("o4"));

        // Rate limit headers from models response
        const rlRemaining = modelsRes.headers.get("x-ratelimit-remaining-requests");
        const rlReset = modelsRes.headers.get("x-ratelimit-reset-requests");

        // 2) Quick billing test — send a minimal completion
        let billingOk = true;
        let billingError = "";
        try {
            const billingRes = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENAI_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{ role: "user", content: "1" }],
                    max_tokens: 1,
                }),
                signal: AbortSignal.timeout(8000),
            });
            if (!billingRes.ok) {
                billingOk = false;
                const errBody = await billingRes.text().catch(() => "");
                if (billingRes.status === 402 || errBody.includes("insufficient_quota")) {
                    billingError = "insufficient_quota";
                } else if (billingRes.status === 429) {
                    billingError = "rate_limited";
                    billingOk = true; // rate limit = key works, just throttled
                } else {
                    billingError = `HTTP ${billingRes.status}`;
                }
            }
        } catch {
            billingError = "timeout";
            billingOk = true; // Network issue, not billing
        }

        // 3) Try to get billing info (only works with admin keys)
        let balance: string | null = null;
        let balanceRu: string | null = null;
        try {
            // Try the billing subscription endpoint
            const subRes = await fetch("https://api.openai.com/v1/dashboard/billing/subscription", {
                headers: { Authorization: `Bearer ${OPENAI_KEY}` },
                signal: AbortSignal.timeout(5000),
            });
            if (subRes.ok) {
                const sub = await subRes.json() as {
                    hard_limit_usd?: number;
                    soft_limit_usd?: number;
                    plan?: { title?: string };
                };
                if (sub.hard_limit_usd !== undefined) {
                    balance = `$${sub.hard_limit_usd.toFixed(2)} лимит`;
                    balanceRu = `Тарифный план: ${sub.plan?.title ?? "unknown"}. Лимит: $${sub.hard_limit_usd.toFixed(2)}.`;
                }
            }
        } catch {
            // Project keys can't access billing — that's OK
        }

        // Build descriptive status
        let descRu: string;
        if (!billingOk && billingError === "insufficient_quota") {
            descRu = "❌ Средства на счёте OpenAI закончились. Пополните на platform.openai.com/settings/billing.";
        } else if (billingOk) {
            descRu = `✅ OpenAI работает. ${models.length} моделей. GPT-4: ${hasGpt4 ? "✓" : "✗"}, Embeddings: ${hasEmbed ? "✓" : "✗"}${hasO ? ", o-серия: ✓" : ""}.`;
        } else {
            descRu = `⚠️ OpenAI ответил ошибкой при тестовом запросе: ${billingError}`;
        }

        return NextResponse.json({
            status: billingOk ? "ok" : (billingError === "insufficient_quota" ? "no_funds" : "error"),
            models: models.length,
            hasGpt4,
            hasEmbed,
            hasO,
            billingOk,
            billingError: billingError || null,
            balance,
            balanceRu,
            rateLimitRemaining: rlRemaining,
            rateLimitReset: rlReset,
            descRu,
        });
    } catch (err) {
        return NextResponse.json({
            status: "error",
            descRu: `❌ Не удалось подключиться к OpenAI: ${err instanceof Error ? err.message : "unknown"}`,
        }, { status: 503 });
    }
}
