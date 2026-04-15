/**
 * /api/api-credits — Check API credits, limits, and usage for all AI services.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ServiceCredits {
    name: string;
    nameRu: string;
    configured: boolean;
    keyPreview?: string;
    balance?: string;
    balanceRu?: string;
    rateLimit?: string;
    rateLimitRu?: string;
    resetTime?: string;
    resetTimeRu?: string;
    error?: string;
}

export async function GET() {
    const services: ServiceCredits[] = [];

    // 1) Google Gemini
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (geminiKey) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
                { signal: AbortSignal.timeout(5000) }
            );
            if (res.ok) {
                const data = await res.json() as { models?: Array<{ name: string; displayName: string }> };
                const liveModels = data.models?.filter(m => m.name.includes("live") || m.name.includes("flash")) ?? [];
                services.push({
                    name: "google_gemini",
                    nameRu: "Google Gemini",
                    configured: true,
                    keyPreview: `${geminiKey.slice(0, 8)}...${geminiKey.slice(-4)}`,
                    balance: "Бесплатный тариф",
                    balanceRu: `✅ Ключ активен. Доступно ${data.models?.length ?? 0} моделей (${liveModels.length} live).`,
                    rateLimit: "15 RPM / 1M TPM (Free)",
                    rateLimitRu: "Бесплатный тариф: 15 запросов/мин, 1 млн токенов/мин. При превышении — 429 ошибка.",
                });
            } else {
                const errText = await res.text().catch(() => "");
                let errRu = "Ошибка проверки ключа.";
                if (errText.includes("API_KEY_INVALID")) errRu = "❌ Ключ недействителен — замените его в .env.";
                else if (errText.includes("QUOTA")) errRu = "⚠️ Квота исчерпана — дождитесь сброса (обычно в полночь PST).";
                services.push({
                    name: "google_gemini",
                    nameRu: "Google Gemini",
                    configured: true,
                    keyPreview: `${geminiKey.slice(0, 8)}...${geminiKey.slice(-4)}`,
                    balance: `HTTP ${res.status}`,
                    balanceRu: errRu,
                    error: errText.slice(0, 200),
                });
            }
        } catch (err) {
            services.push({
                name: "google_gemini",
                nameRu: "Google Gemini",
                configured: true,
                keyPreview: `${geminiKey.slice(0, 8)}...${geminiKey.slice(-4)}`,
                balanceRu: "❌ Не удалось проверить — нет интернета или сервис Google недоступен.",
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    } else {
        services.push({
            name: "google_gemini",
            nameRu: "Google Gemini",
            configured: false,
            balanceRu: "❌ GOOGLE_GEMINI_API_KEY не настроен в .env. Голосовой ассистент не будет работать.",
        });
    }

    // 2) OpenAI
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
        try {
            // Check models
            const res = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${openaiKey}` },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = await res.json() as { data?: Array<{ id: string }> };
                const modelCount = data.data?.length ?? 0;
                const hasGpt4 = data.data?.some(m => m.id.includes("gpt-4")) ?? false;
                const hasEmbed = data.data?.some(m => m.id.includes("embedding")) ?? false;

                // Do a 1-token billing test to confirm funds available
                let billingStatus = "✅ Баланс активен";
                try {
                    const billingRes = await fetch("https://api.openai.com/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${openaiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [{ role: "user", content: "1" }],
                            max_tokens: 1,
                        }),
                        signal: AbortSignal.timeout(8000),
                    });
                    if (billingRes.ok) {
                        billingStatus = "✅ Баланс активен — тестовый запрос прошёл успешно";
                    } else if (billingRes.status === 402) {
                        billingStatus = "❌ Средства закончились — пополните на platform.openai.com/billing";
                    } else if (billingRes.status === 429) {
                        billingStatus = "⚠️ Лимит запросов — подождите или увеличьте тариф";
                    }
                } catch {
                    billingStatus = "⏳ Не удалось проверить баланс (таймаут)";
                }

                const remaining = res.headers.get("x-ratelimit-remaining-requests");

                services.push({
                    name: "openai",
                    nameRu: "OpenAI",
                    configured: true,
                    keyPreview: `sk-...${openaiKey.slice(-4)}`,
                    balance: billingStatus.startsWith("✅") ? "Активен" : billingStatus.startsWith("❌") ? "Пусто" : "Неизвестно",
                    balanceRu: `${billingStatus}. ${modelCount} моделей. GPT-4: ${hasGpt4 ? "✓" : "✗"}, Embeddings: ${hasEmbed ? "✓" : "✗"}.`,
                    rateLimit: remaining ? `Осталось: ${remaining} запросов` : undefined,
                    rateLimitRu: `Проверьте расход и баланс на platform.openai.com/usage.${remaining ? ` Осталось: ${remaining} запросов в окне.` : ""}`,
                });
            } else {
                const errText = await res.text().catch(() => "");
                let errRu = "Ошибка проверки.";
                if (res.status === 401) errRu = "❌ Ключ недействителен или истёк. Замените в .env.";
                else if (res.status === 429) errRu = "⚠️ Лимит запросов превышен. Подождите или обновите тарифный план.";
                else if (res.status === 402) errRu = "❌ Недостаточно средств на счёте OpenAI. Пополните на platform.openai.com/billing.";
                services.push({
                    name: "openai",
                    nameRu: "OpenAI",
                    configured: true,
                    keyPreview: `sk-...${openaiKey.slice(-4)}`,
                    balance: `HTTP ${res.status}`,
                    balanceRu: errRu,
                    error: errText.slice(0, 200),
                });
            }
        } catch (err) {
            services.push({
                name: "openai",
                nameRu: "OpenAI",
                configured: true,
                keyPreview: `sk-...${openaiKey.slice(-4)}`,
                balanceRu: "❌ Не удалось проверить — нет интернета или API недоступен.",
                error: err instanceof Error ? err.message : "unknown",
            });
        }
    } else {
        services.push({
            name: "openai",
            nameRu: "OpenAI",
            configured: false,
            balanceRu: "⚠️ OPENAI_API_KEY не настроен. Эмбеддинги и классификация через OpenAI недоступны.",
        });
    }

    // 3) DeepSeek (if configured)
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
        try {
            const res = await fetch("https://api.deepseek.com/v1/models", {
                headers: { Authorization: `Bearer ${deepseekKey}` },
                signal: AbortSignal.timeout(5000),
            });
            services.push({
                name: "deepseek",
                nameRu: "DeepSeek",
                configured: true,
                keyPreview: `${deepseekKey.slice(0, 6)}...${deepseekKey.slice(-4)}`,
                balanceRu: res.ok ? "✅ Ключ активен." : `⚠️ Ошибка ${res.status}.`,
            });
        } catch {
            services.push({
                name: "deepseek",
                nameRu: "DeepSeek",
                configured: true,
                keyPreview: `${deepseekKey.slice(0, 6)}...${deepseekKey.slice(-4)}`,
                balanceRu: "❌ Не удалось проверить.",
            });
        }
    }

    // 4) Obsidian REST API
    const obsidianKey = process.env.OBSIDIAN_REST_API_KEY;
    services.push({
        name: "obsidian_rest",
        nameRu: "Obsidian Local REST API",
        configured: !!obsidianKey,
        keyPreview: obsidianKey ? `${obsidianKey.slice(0, 8)}...` : undefined,
        balanceRu: obsidianKey
            ? "✅ Ключ настроен. Не имеет лимитов (локальный)."
            : "⚠️ OBSIDIAN_REST_API_KEY не настроен.",
    });

    // 5) Telegram API
    const tgApiId = process.env.TELEGRAM_API_ID;
    const tgApiHash = process.env.TELEGRAM_API_HASH;
    services.push({
        name: "telegram",
        nameRu: "Telegram MTProto",
        configured: !!(tgApiId && tgApiHash),
        keyPreview: tgApiId ? `ID: ${tgApiId}` : undefined,
        balanceRu: tgApiId && tgApiHash
            ? "✅ API ID и Hash настроены. Лимит: 30 запросов/сек (MTProto)."
            : "❌ TELEGRAM_API_ID / TELEGRAM_API_HASH не настроены.",
        rateLimitRu: "Telegram MTProto не имеет кредитов — работает бесплатно, но есть rate limit ~30 req/sec.",
    });

    return NextResponse.json({ services });
}
