/**
 * /api/voice-health — comprehensive health check for the voice assistant pipeline.
 * 
 * Checks:
 *  1. GOOGLE_GEMINI_API_KEY configured
 *  2. Gemini API reachable (models list)
 *  3. WS Proxy (ws-proxy.js) reachable on port 3099
 *  4. ChromaDB/Indexer has documents for RAG context
 *  5. Vault context loadable
 */
import { NextResponse } from "next/server";
import { loadVaultContext } from "@/lib/vaultContext";

export const dynamic = "force-dynamic";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const INDEXER_URL = process.env.INDEXER_SERVICE_URL || "http://127.0.0.1:8030";

interface CheckResult {
    name: string;
    nameRu: string;
    ok: boolean;
    details: string;
    descRu: string;
}

export async function GET() {
    const checks: CheckResult[] = [];

    // 1) Gemini API Key
    const hasKey = !!GOOGLE_GEMINI_API_KEY && GOOGLE_GEMINI_API_KEY.length > 10;
    checks.push({
        name: "gemini_api_key",
        nameRu: "Ключ Gemini API",
        ok: hasKey,
        details: hasKey ? `Настроен (${GOOGLE_GEMINI_API_KEY!.slice(0, 6)}...)` : "Отсутствует",
        descRu: hasKey
            ? "✅ API-ключ Google Gemini настроен. Ассистент сможет подключиться."
            : "❌ GOOGLE_GEMINI_API_KEY не задан в .env. Голосовой ассистент не запустится без этого ключа.",
    });

    // 2) Gemini API reachable
    if (hasKey) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_GEMINI_API_KEY}`,
                { signal: AbortSignal.timeout(15000) }
            );
            if (res.ok) {
                const data = await res.json() as { models?: Array<{ name: string }> };
                const modelCount = data.models?.length ?? 0;
                checks.push({
                    name: "gemini_api_reachable",
                    nameRu: "Google Gemini API",
                    ok: true,
                    details: `${modelCount} моделей доступно`,
                    descRu: `✅ Google Gemini API доступен. Найдено ${modelCount} моделей — голосовая связь возможна.`,
                });
            } else {
                const errText = await res.text().catch(() => "");
                checks.push({
                    name: "gemini_api_reachable",
                    nameRu: "Google Gemini API",
                    ok: false,
                    details: `HTTP ${res.status}`,
                    descRu: `❌ Google Gemini API отвечает ошибкой (${res.status}). ${errText.includes("API_KEY_INVALID") ? "API-ключ недействителен — замените его." : errText.includes("QUOTA") ? "Квота исчерпана — дождитесь сброса или обновите тарифный план." : "Проверьте ключ и баланс Google Cloud."}`,
                });
            }
        } catch (err) {
            checks.push({
                name: "gemini_api_reachable",
                nameRu: "Google Gemini API",
                ok: false,
                details: err instanceof Error ? err.message : "Timeout",
                descRu: "❌ Google Gemini API не отвечает. Нет подключения к интернету или сервис Google недоступен.",
            });
        }
    } else {
        checks.push({
            name: "gemini_api_reachable",
            nameRu: "Google Gemini API",
            ok: false,
            details: "Ключ не задан",
            descRu: "⏭ Проверка пропущена — сначала нужно добавить GOOGLE_GEMINI_API_KEY в .env.",
        });
    }

    // 3) WS Proxy health (try TCP connection to port 3099)
    try {
        const wsProxyUrl = process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL}/ws-gemini`
            : "http://127.0.0.1:3099";
        // We can't do a real WS check from server, but we can try an HTTP request
        const res = await fetch(wsProxyUrl.replace("ws://", "http://").replace("wss://", "https://"), {
            signal: AbortSignal.timeout(10000),
        });
        // Any response (even 400/404) means the proxy process is running
        checks.push({
            name: "ws_proxy",
            nameRu: "WebSocket прокси",
            ok: true,
            details: `HTTP ${res.status}`,
            descRu: "✅ WebSocket прокси (ws-proxy.js) запущен и принимает подключения.",
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isRefused = msg.includes("ECONNREFUSED") || msg.includes("fetch failed");
        checks.push({
            name: "ws_proxy",
            nameRu: "WebSocket прокси",
            ok: false,
            details: isRefused ? "Не запущен (timeout 10s)" : msg,
            descRu: isRefused
                ? "❌ WebSocket прокси не запущен. Ассистент не сможет передавать голос. Запустите: node ws-proxy.js"
                : `❌ Ошибка подключения к WebSocket прокси: ${msg}. Запустите: node ws-proxy.js`,
        });
    }

    // 4) ChromaDB has documents
    try {
        const res = await fetch(`${INDEXER_URL}/health`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
            const data = await res.json() as { chroma_documents: number; watcher_active: boolean };
            const hasDocs = data.chroma_documents > 0;
            checks.push({
                name: "chroma_context",
                nameRu: "Контекст (ChromaDB)",
                ok: hasDocs,
                details: `${data.chroma_documents} чанков`,
                descRu: hasDocs
                    ? `✅ В памяти ${data.chroma_documents.toLocaleString()} фрагментов — ассистент ответит с контекстом ваших данных.`
                    : "⚠️ Память пуста — ассистент не видит переписки и заметки. Запустите индексацию на вкладке Дашборд.",
            });
        } else {
            throw new Error("non-200");
        }
    } catch {
        checks.push({
            name: "chroma_context",
            nameRu: "Контекст (ChromaDB)",
            ok: false,
            details: "Indexer недоступен",
            descRu: "❌ Сервис индексации не запущен — ассистент будет отвечать без контекста ваших данных.",
        });
    }

    // 5) Vault context loadable
    try {
        const vault = await loadVaultContext("anonymous");
        const hasVault = vault.length > 100;
        checks.push({
            name: "vault_context",
            nameRu: "Заметки Obsidian",
            ok: hasVault,
            details: hasVault ? `${vault.length} символов` : "Пусто или недоступно",
            descRu: hasVault
                ? `✅ Загружено ${vault.length.toLocaleString()} символов заметок из Obsidian для контекста.`
                : "⚠️ Заметки Obsidian не загружаются. Проверьте что Obsidian открыт с плагином REST API.",
        });
    } catch {
        checks.push({
            name: "vault_context",
            nameRu: "Заметки Obsidian",
            ok: false,
            details: "Ошибка загрузки",
            descRu: "⚠️ Не удалось загрузить заметки из Obsidian. Ассистент будет работать без них.",
        });
    }

    const allOk = checks.every((c) => c.ok);
    const criticalOk = checks.filter((c) => ["gemini_api_key", "gemini_api_reachable", "ws_proxy"].includes(c.name)).every((c) => c.ok);

    let overallStatus: "ready" | "degraded" | "broken";
    let overallDescRu: string;

    if (allOk) {
        overallStatus = "ready";
        overallDescRu = "✅ Голосовой ассистент полностью готов к работе. Все зависимости подключены.";
    } else if (criticalOk) {
        overallStatus = "degraded";
        overallDescRu = "⚠️ Ассистент может работать, но некоторые источники данных недоступны. Ответы будут менее точными.";
    } else {
        overallStatus = "broken";
        const broken = checks.filter((c) => !c.ok && ["gemini_api_key", "gemini_api_reachable", "ws_proxy"].includes(c.name));
        overallDescRu = `❌ Ассистент не работает. Проблема: ${broken.map((b) => b.nameRu).join(", ")}.`;
    }

    return NextResponse.json({
        status: overallStatus,
        descRu: overallDescRu,
        checks,
    });
}
