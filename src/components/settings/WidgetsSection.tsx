"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2, ChevronDown, Volume2, Sparkles, Play } from "lucide-react";
import { useSettingsStore, getWidgetEffect } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { Switch } from "@/components/ui/switch";
import { AddWidgetScreen } from "@/components/settings/AddWidgetScreen";
import { playSound } from "@/lib/sounds";
import type { VisualEffectId, SoundEffectId, WidgetEffectConfig } from "@/types/animation";
import { VISUAL_EFFECT_LABELS, SOUND_EFFECT_LABELS, EFFECT_PRESETS } from "@/types/animation";

// ── Built-in widget definitions ──
const BUILTIN_WIDGETS = [
    { id: "ideas", label: "Счётчик идей", settingsKey: "showIdeasCounter" as const, toggleKey: "toggleShowIdeasCounter" as const },
    { id: "facts", label: "Счётчик фактов", settingsKey: "showFactsCounter" as const, toggleKey: "toggleShowFactsCounter" as const },
    { id: "persons", label: "Счётчик персон", settingsKey: "showPersonsCounter" as const, toggleKey: "toggleShowPersonsCounter" as const },
    { id: "tasks", label: "Счётчик задач", settingsKey: "showTasksCounter" as const, toggleKey: "toggleShowTasksCounter" as const },
];

const TOKEN_WIDGETS = [
    { id: "_usd", label: "Токены ($)", settingsKey: "showUsdTokens" as const, toggleKey: "toggleShowUsdTokens" as const },
    { id: "_rub", label: "Токены (₽)", settingsKey: "showRubTokens" as const, toggleKey: "toggleShowRubTokens" as const },
    { id: "_balance", label: "Баланс токенов", settingsKey: "showTokenBalance" as const, toggleKey: "toggleShowTokenBalance" as const },
    { id: "_openai", label: "Баланс OpenAI ($)", settingsKey: "showOpenAIBalance" as const, toggleKey: "toggleShowOpenAIBalance" as const, description: "Реальный остаток на счёте OpenAI" },
];

// ── Widget row (expanded to include effect config) ──
function WidgetRow({
    widgetId,
    label,
    description,
    checked,
    onToggle,
    onDelete,
    hasEffects,
}: {
    widgetId: string;
    label: string;
    description?: string;
    checked: boolean;
    onToggle: () => void;
    onDelete?: () => void;
    hasEffects: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const settings = useSettingsStore();
    const triggerAnimation = useAnimationStore((s) => s.triggerAnimation);

    // Load effect config for this widget
    const effectConfig = getWidgetEffect(widgetId);

    const handleVisualChange = (visual: VisualEffectId) => {
        settings.setWidgetEffect({ ...effectConfig, widgetId, visualEffect: visual });
    };
    const handleSoundChange = (sound: SoundEffectId) => {
        settings.setWidgetEffect({ ...effectConfig, widgetId, soundEffect: sound });
    };
    const handlePresetSelect = (preset: typeof EFFECT_PRESETS[0]) => {
        settings.setWidgetEffect({ widgetId, visualEffect: preset.visual, soundEffect: preset.sound });
    };

    const handleTest = () => {
        // Test: play sound + trigger animation
        playSound(effectConfig.soundEffect);
        triggerAnimation(widgetId);
    };

    return (
        <div className="border-b border-white/5 last:border-0">
            {/* Main row */}
            <div className="flex items-center justify-between py-3">
                <div className="flex flex-1 flex-col gap-0.5 pr-3">
                    <span className="text-sm text-zinc-300">{label}</span>
                    {description && (
                        <span className="text-[11px] text-zinc-600">{description}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {hasEffects && (
                        <button
                            className={`rounded p-1 transition-colors ${expanded ? "bg-violet-500/20 text-violet-400" : "text-zinc-600 hover:text-zinc-400"}`}
                            onClick={() => setExpanded(!expanded)}
                            aria-label="Настроить эффекты"
                        >
                            <Sparkles className="size-3.5" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            className="rounded p-1 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                            onClick={onDelete}
                            aria-label="Удалить"
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    )}
                    <Switch checked={checked} onCheckedChange={onToggle} />
                </div>
            </div>

            {/* Expandable effect settings */}
            <AnimatePresence>
                {expanded && hasEffects && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-3 rounded-xl bg-zinc-900/60 p-3 mb-3">
                            {/* Presets */}
                            <div>
                                <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Пресеты</span>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {EFFECT_PRESETS.map((preset) => {
                                        const isActive = effectConfig.visualEffect === preset.visual && effectConfig.soundEffect === preset.sound;
                                        return (
                                            <button
                                                key={preset.id}
                                                onClick={() => handlePresetSelect(preset)}
                                                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                                                    isActive
                                                        ? "bg-violet-500/30 text-violet-300 ring-1 ring-violet-500/50"
                                                        : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-300"
                                                }`}
                                            >
                                                {preset.nameRu}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Visual effect selector */}
                            <div>
                                <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide flex items-center gap-1">
                                    <Sparkles className="size-3" /> Визуальный эффект
                                </span>
                                <div className="mt-1 relative">
                                    <select
                                        value={effectConfig.visualEffect}
                                        onChange={(e) => handleVisualChange(e.target.value as VisualEffectId)}
                                        className="w-full appearance-none rounded-lg bg-zinc-800/80 px-3 py-2 text-xs text-zinc-300 outline-none ring-1 ring-white/5 focus:ring-violet-500/50"
                                    >
                                        {Object.entries(VISUAL_EFFECT_LABELS).map(([id, name]) => (
                                            <option key={id} value={id}>{name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3 text-zinc-500" />
                                </div>
                            </div>

                            {/* Sound effect selector */}
                            <div>
                                <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide flex items-center gap-1">
                                    <Volume2 className="size-3" /> Звуковой эффект
                                </span>
                                <div className="mt-1 relative">
                                    <select
                                        value={effectConfig.soundEffect}
                                        onChange={(e) => handleSoundChange(e.target.value as SoundEffectId)}
                                        className="w-full appearance-none rounded-lg bg-zinc-800/80 px-3 py-2 text-xs text-zinc-300 outline-none ring-1 ring-white/5 focus:ring-violet-500/50"
                                    >
                                        {Object.entries(SOUND_EFFECT_LABELS).map(([id, name]) => (
                                            <option key={id} value={id}>{name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3 text-zinc-500" />
                                </div>
                            </div>

                            {/* Test button */}
                            <button
                                onClick={handleTest}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600/20 py-2 text-[11px] font-semibold text-violet-300 transition-colors hover:bg-violet-600/30"
                            >
                                <Play className="size-3" />
                                Протестировать
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Simple setting row (for token widgets without effects) ──
function SimpleSettingRow({
    label,
    description,
    checked,
    onToggle,
}: {
    label: string;
    description?: string;
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
            <div className="flex flex-1 flex-col gap-0.5 pr-3">
                <span className="text-sm text-zinc-300">{label}</span>
                {description && (
                    <span className="text-[11px] text-zinc-600">{description}</span>
                )}
            </div>
            <Switch checked={checked} onCheckedChange={onToggle} />
        </div>
    );
}

interface WidgetsSectionProps {
    onNavigateAddWidget?: () => void;
}

export function WidgetsSection({ onNavigateAddWidget }: WidgetsSectionProps) {
    const settings = useSettingsStore();
    const [addingWidget, setAddingWidget] = useState(false);

    if (addingWidget) {
        return (
            <AnimatePresence mode="wait">
                <AddWidgetScreen onBack={() => setAddingWidget(false)} />
            </AnimatePresence>
        );
    }

    return (
        <div className="space-y-6">
            {/* ── Token / balance widgets (no effects) ── */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-[16px]">💰</span>
                    Токены и баланс
                </h3>
                <div>
                    {TOKEN_WIDGETS.map((tw) => (
                        <SimpleSettingRow
                            key={tw.id}
                            label={tw.label}
                            description={tw.description}
                            checked={settings[tw.settingsKey]}
                            onToggle={settings[tw.toggleKey]}
                        />
                    ))}
                </div>
            </section>

            {/* ── Counter widgets with effects ── */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-[16px]">✨</span>
                    Счётчики с эффектами
                </h3>
                <p className="mb-2 text-[11px] text-zinc-600">
                    Нажмите <Sparkles className="inline size-3 text-violet-400" /> для настройки визуального и звукового эффекта
                </p>
                <div>
                    {BUILTIN_WIDGETS.map((bw) => (
                        <WidgetRow
                            key={bw.id}
                            widgetId={bw.id}
                            label={bw.label}
                            checked={settings[bw.settingsKey]}
                            onToggle={settings[bw.toggleKey]}
                            hasEffects={true}
                        />
                    ))}

                    {/* Custom widgets */}
                    {settings.customWidgets.map((w) => (
                        <WidgetRow
                            key={w.id}
                            widgetId={w.id}
                            label={w.label}
                            description={w.prompt ? `Промт: ${w.prompt.slice(0, 60)}${w.prompt.length > 60 ? "…" : ""}` : undefined}
                            checked={w.enabled}
                            onToggle={() => settings.toggleCustomWidget(w.id)}
                            onDelete={() => settings.removeCustomWidget(w.id)}
                            hasEffects={true}
                        />
                    ))}
                </div>

                {/* Add Widget button */}
                <button
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 py-3.5 text-sm font-bold text-white transition-all hover:from-violet-500 hover:to-violet-400"
                    onClick={() => setAddingWidget(true)}
                >
                    <Plus className="size-4" />
                    Добавить виджет
                </button>
            </section>

        </div>
    );
}
