"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useEffect, useState } from "react";

/**
 * LiteLLMSection — Settings panel for enabling the experimental LiteLLM gateway.
 * Shadow Integration: does not affect existing provider settings.
 */
export function LiteLLMSection() {
    const useLiteLLM = useSettingsStore((s) => s.useLiteLLM);
    const litellmModel = useSettingsStore((s) => s.litellmModel);
    const useHybridSearch = useSettingsStore((s) => s.useHybridSearch);
    const useDeepAgent = useSettingsStore((s) => s.useDeepAgent);
    const toggleUseLiteLLM = useSettingsStore((s) => s.toggleUseLiteLLM);
    const setLitellmModel = useSettingsStore((s) => s.setLitellmModel);
    const toggleHybridSearch = useSettingsStore((s) => s.toggleHybridSearch);
    const toggleDeepAgent = useSettingsStore((s) => s.toggleDeepAgent);

    const [models, setModels] = useState<Array<{ id: string; owned_by: string }>>([]);
    const [loading, setLoading] = useState(false);

    // Fetch available models when LiteLLM is enabled
    useEffect(() => {
        if (!useLiteLLM) return;
        setLoading(true);
        fetch("/api/litellm/models")
            .then((r) => r.json())
            .then((d) => setModels(d.models ?? []))
            .catch(() => setModels([]))
            .finally(() => setLoading(false));
    }, [useLiteLLM]);

    return (
        <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <span className="inline-flex size-6 items-center justify-center rounded-md bg-violet-500/20 text-violet-400">
                    🔬
                </span>
                Фаза 2 — Экспериментальные функции
            </h3>

            <p className="text-xs text-zinc-500 leading-relaxed">
                Эти функции внедрены параллельно с основными. При ошибках система автоматически откатывается к стандартному поведению.
            </p>

            {/* LiteLLM Toggle */}
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="text-sm font-medium text-zinc-200">LiteLLM шлюз</span>
                        <span className="ml-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-400">
                            ЭКСПЕРИМЕНТ
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={toggleUseLiteLLM}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useLiteLLM ? "bg-violet-600" : "bg-zinc-700"}`}
                    >
                        <span className={`inline-block size-4 transform rounded-full bg-white transition-transform ${useLiteLLM ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                    Перенаправляет чат через LiteLLM прокси (порт 4000), открывая доступ к 100+ моделям:
                    Anthropic Claude, Mistral, Ollama (локальные), vLLM и другие.
                    <br />
                    <span className="text-amber-400">⚠ При ошибках система НЕ переключается на стандартный чат автоматически.</span>
                </p>

                {useLiteLLM && (
                    <div className="mt-2 space-y-1">
                        <label className="text-xs font-medium text-zinc-400">Модель:</label>
                        {loading ? (
                            <div className="text-xs text-zinc-600">Загрузка моделей...</div>
                        ) : models.length > 0 ? (
                            <select
                                value={litellmModel}
                                onChange={(e) => setLitellmModel(e.target.value)}
                                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200"
                            >
                                {models.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.id} ({m.owned_by})
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <div className="text-xs text-zinc-600">
                                Прокси не отвечает. Запустите: <code className="text-violet-400">cd services/litellm && docker compose up -d</code>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Hybrid Search Toggle */}
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="text-sm font-medium text-zinc-200">Гибридный поиск (BM25 + RRF)</span>
                    </div>
                    <button
                        type="button"
                        onClick={toggleHybridSearch}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useHybridSearch ? "bg-lime-600" : "bg-zinc-700"}`}
                    >
                        <span className={`inline-block size-4 transform rounded-full bg-white transition-transform ${useHybridSearch ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                    Объединяет векторный поиск (ChromaDB) с полнотекстовым (BM25) через алгоритм Reciprocal Rank Fusion.
                    Улучшает точность поиска по заметкам и переписками.
                    <br />
                    <span className="text-emerald-400">✓ При ошибке автоматически откатывается к стандартному поиску.</span>
                </p>
            </div>

            {/* Deep Agent Toggle */}
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-center justify-between">
                    <div>
                        <span className="text-sm font-medium text-zinc-200">Deep Agent (обогащение)</span>
                    </div>
                    <button
                        type="button"
                        onClick={toggleDeepAgent}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useDeepAgent ? "bg-yellow-600" : "bg-zinc-700"}`}
                    >
                        <span className={`inline-block size-4 transform rounded-full bg-white transition-transform ${useDeepAgent ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                    LangChain агент автоматически ищет связанные концепции перед сохранением заметки.
                    Пишет черновики в <code className="text-yellow-400">Wiki_v2/.drafts/</code> (песочница).
                    <br />
                    <span className="text-amber-400">⚠ Требует DEEP_AGENT_ENABLED=true в .env и pip install langchain</span>
                </p>
            </div>
        </section>
    );
}
