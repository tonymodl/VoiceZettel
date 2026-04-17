"use client";

import { useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Save, RotateCcw, Brain, Gauge, Sparkles, FileText, Eye, EyeOff } from "lucide-react";

const VARIABLES = [
    { name: "{{user_name}}", desc: "Имя пользователя (Антон)" },
    { name: "{{language}}", desc: "Язык ответа (RU)" },
    { name: "{{context}}", desc: "Контекст из ChromaDB + Vault" },
    { name: "{{timestamp}}", desc: "Текущая дата/время" },
    { name: "{{compiled_rules}}", desc: "Compiled Rules из памяти" },
    { name: "{{empathy_block}}", desc: "Empathy DNA профиль" },
    { name: "{{autonomy_level}}", desc: "Уровень автономности (0-10)" },
];

export function PromptsTab() {
    const systemPrompt = useSettingsStore((s) => s.systemPrompt);
    const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);
    const zettelkastenPrompt = useSettingsStore((s) => s.zettelkastenPrompt);
    const setZettelkastenPrompt = useSettingsStore((s) => s.setZettelkastenPrompt);
    const orbParticles = useSettingsStore((s) => s.orbParticles);
    const setOrbParticles = useSettingsStore((s) => s.setOrbParticles);
    const autonomyLevel = useSettingsStore((s) => s.autonomyLevel);
    const setAutonomyLevel = useSettingsStore((s) => s.setAutonomyLevel);
    const addNotification = useNotificationStore((s) => s.addNotification);

    const [activeTab, setActiveTab] = useState<"system" | "zettelkasten">("system");
    const [showPreview, setShowPreview] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSave = useCallback(() => {
        setSaved(true);
        addNotification("Промпт сохранён ✓", "info");
        setTimeout(() => setSaved(false), 2000);
    }, [addNotification]);

    const handleReset = useCallback(() => {
        if (activeTab === "system") {
            setSystemPrompt("");
            addNotification("Системный промпт сброшен — будет использован встроенный", "info");
        } else {
            setZettelkastenPrompt("");
            addNotification("Промпт Zettelkasten сброшен", "info");
        }
    }, [activeTab, setSystemPrompt, setZettelkastenPrompt, addNotification]);

    const currentPrompt = activeTab === "system" ? systemPrompt : zettelkastenPrompt;
    const setCurrentPrompt = activeTab === "system" ? setSystemPrompt : setZettelkastenPrompt;

    const AUTONOMY_LABELS: Record<number, string> = {
        0: "🧠 Авто",
        1: "🛡️ Ручной",
        2: "🔒 Осторожный",
        3: "🔍 Умеренный",
        4: "⚖️ Баланс",
        5: "📊 Продвинутый",
        6: "🚀 Проактивный",
        7: "⚡ Быстрый",
        8: "🔥 Агрессивный",
        9: "💎 Максимум",
        10: "🤖 Полная",
    };

    return (
        <div className="space-y-4">
            {/* ── Tab switcher ── */}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setActiveTab("system")}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        activeTab === "system"
                            ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                >
                    <Brain className="size-3.5" />
                    Системный промпт
                </button>
                <button
                    onClick={() => setActiveTab("zettelkasten")}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        activeTab === "zettelkasten"
                            ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                >
                    <FileText className="size-3.5" />
                    Zettelkasten промпт
                </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                {/* ── Editor ── */}
                <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-4 backdrop-blur-md">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                            {activeTab === "system" ? "Системный промпт ассистента" : "Промпт для классификации заметок"}
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 transition hover:text-zinc-300"
                            >
                                {showPreview ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                                {showPreview ? "Редактор" : "Превью"}
                            </button>
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 transition hover:text-zinc-300"
                            >
                                <RotateCcw className="size-3" />
                                Сбросить
                            </button>
                            <button
                                onClick={handleSave}
                                className={`flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-medium transition-all ${
                                    saved
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                        : "border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20"
                                }`}
                            >
                                <Save className="size-3" />
                                {saved ? "✓ Сохранено" : "Сохранить"}
                            </button>
                        </div>
                    </div>

                    {showPreview ? (
                        <div className="h-[400px] overflow-y-auto rounded-xl border border-white/[0.04] bg-black/30 p-4 text-xs leading-relaxed text-zinc-400 whitespace-pre-wrap">
                            {currentPrompt || "(Пусто — используется встроенный промпт)"}
                        </div>
                    ) : (
                        <textarea
                            value={currentPrompt}
                            onChange={(e) => setCurrentPrompt(e.target.value)}
                            placeholder={activeTab === "system"
                                ? "Оставьте пустым чтобы использовать встроенный системный промпт голосового ассистента..."
                                : "Промпт для классификации заметок Zettelkasten..."
                            }
                            className="h-[400px] w-full resize-none rounded-xl border border-white/[0.04] bg-black/30 p-3.5 font-mono text-xs leading-relaxed text-zinc-300 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500/25"
                        />
                    )}
                    <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
                        <span>
                            {currentPrompt ? `${currentPrompt.length} символов` : "Встроенный промпт (~6000 символов)"}
                        </span>
                        <span>⚡ Изменения применяются к следующей сессии</span>
                    </div>
                </div>

                {/* ── Sidebar (Variables + AI Controls) ── */}
                <div className="space-y-4">
                    {/* AI Parameters */}
                    <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-4 backdrop-blur-md">
                        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                            ⚙️ Параметры ИИ
                        </h3>

                        {/* Particles */}
                        <div className="mb-4">
                            <div className="mb-1 flex items-center justify-between">
                                <span className="text-[11px] text-zinc-400">
                                    <Sparkles className="mr-1 inline-block size-3 text-violet-400" />
                                    Частицы Orb
                                </span>
                                <span className="font-mono text-[11px] text-violet-400">{orbParticles}</span>
                            </div>
                            <input
                                type="range"
                                min={500}
                                max={10000}
                                step={500}
                                value={orbParticles}
                                onChange={(e) => setOrbParticles(Number(e.target.value))}
                                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-violet-500"
                                style={{
                                    background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${((orbParticles - 500) / 9500) * 100}%, #27272a ${((orbParticles - 500) / 9500) * 100}%, #27272a 100%)`,
                                }}
                            />
                        </div>

                        {/* Autonomy */}
                        <div>
                            <div className="mb-1 flex items-center justify-between">
                                <span className="text-[11px] text-zinc-400">
                                    <Gauge className="mr-1 inline-block size-3 text-cyan-400" />
                                    Самостоятельность
                                </span>
                                <span className="text-[10px] text-cyan-400">{AUTONOMY_LABELS[autonomyLevel] ?? autonomyLevel}</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={10}
                                step={1}
                                value={autonomyLevel}
                                onChange={(e) => setAutonomyLevel(Number(e.target.value))}
                                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-cyan-500"
                                style={{
                                    background: `linear-gradient(to right, #06b6d4 0%, #06b6d4 ${(autonomyLevel / 10) * 100}%, #27272a ${(autonomyLevel / 10) * 100}%, #27272a 100%)`,
                                }}
                            />
                            <div className="mt-0.5 flex justify-between text-[8px] text-zinc-600">
                                <span>🛡️ Спрашивает</span>
                                <span>🤖 Сам</span>
                            </div>
                        </div>
                    </div>

                    {/* Variables */}
                    <div className="rounded-2xl border border-violet-500/15 bg-zinc-900/60 p-4 backdrop-blur-md">
                        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                            Переменные
                        </h3>
                        <div className="space-y-1.5">
                            {VARIABLES.map((v) => (
                                <div
                                    key={v.name}
                                    className="rounded-lg border border-white/[0.04] bg-black/20 px-2.5 py-1.5"
                                >
                                    <code className="text-[10px] font-semibold text-violet-400">
                                        {v.name}
                                    </code>
                                    <div className="mt-0.5 text-[9px] text-zinc-600">
                                        {v.desc}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Hint */}
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                        <div className="text-[10px] font-semibold uppercase text-cyan-500/70">
                            💡 Подсказка
                        </div>
                        <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                            Системный промпт определяет личность ассистента. Оставьте пустым = будет использован
                            встроенный промпт VoiceZettel с полным набором инструкций. Ваши добавления объединяются с
                            compiled rules и empathy profile автоматически.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
