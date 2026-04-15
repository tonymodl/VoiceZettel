"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { IconPicker } from "@/components/settings/IconPicker";

interface AddWidgetScreenProps {
    onBack: () => void;
}

export function AddWidgetScreen({ onBack }: AddWidgetScreenProps) {
    const addCustomWidget = useSettingsStore((s) => s.addCustomWidget);

    const [iconEmoji, setIconEmoji] = useState("📑");
    const [iconName, setIconName] = useState("bookmark");
    const [label, setLabel] = useState("Термины");
    const [prompt, setPrompt] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleIconSelect = useCallback((icon: { name: string; label: string; emoji: string }) => {
        setIconName(icon.name);
        setIconEmoji(icon.emoji);
        setLabel(icon.label);
        setPickerOpen(false);
    }, []);

    const handleSave = useCallback(() => {
        if (!label.trim()) return;
        setSaving(true);

        addCustomWidget({
            iconName,
            label: label.trim(),
            prompt: prompt.trim(),
            enabled: true,
        });

        setTimeout(() => {
            setSaving(false);
            onBack();
        }, 300);
    }, [addCustomWidget, iconName, label, prompt, onBack]);

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="relative flex h-full flex-col bg-zinc-950"
        >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                <button
                    onClick={onBack}
                    className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                    <ArrowLeft className="size-5" />
                </button>
                <h2 className="text-lg font-bold text-zinc-100">Новый виджет</h2>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto px-5 pb-32 scrollbar-none">
                {/* Icon + name selector */}
                <div className="mb-6">
                    <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-medium text-zinc-500">
                            Выбор иконки и названия
                        </label>
                        <span className="text-[10px] text-zinc-600">Обязательно</span>
                    </div>
                    <button
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-zinc-900 px-4 py-3.5 transition-colors hover:border-zinc-700"
                        onClick={() => setPickerOpen(true)}
                    >
                        <div className="flex items-center gap-3">
                            <span className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-lg">
                                {iconEmoji}
                            </span>
                            <div className="text-left">
                                <p className="text-sm font-medium text-zinc-200">{label}</p>
                                <p className="text-[11px] text-zinc-500">Нажми, чтобы выбрать</p>
                            </div>
                        </div>
                        <ChevronRight className="size-4 text-zinc-600" />
                    </button>
                </div>

                {/* Custom name */}
                <div className="mb-6">
                    <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                        Переименовать
                    </label>
                    <input
                        type="text"
                        className="w-full rounded-xl border border-white/5 bg-zinc-900 px-4 py-3 text-base text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                        placeholder="Короткое название для виджета"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-zinc-600">
                        Короткое название, которое будет видно на карточке счётчика.
                    </p>
                </div>

                {/* Prompt */}
                <div className="mb-6">
                    <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                        Промт для виджета
                    </label>
                    <textarea
                        className="min-h-[120px] w-full resize-none rounded-xl border border-white/5 bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/20"
                        placeholder="Сохраняй сюда термины"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-zinc-600">
                        Лучше использовать понятную инструкцию в 1–3 предложениях.
                    </p>
                </div>
            </div>

            {/* Save button (fixed bottom) */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent px-5 pb-6 pt-4">
                <button
                    disabled={saving || !label.trim()}
                    className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 py-4 text-base font-bold text-white transition-all hover:from-violet-500 hover:to-violet-400 disabled:opacity-40"
                    onClick={handleSave}
                >
                    {saving ? "Сохранение..." : "Сохранить"}
                </button>
            </div>

            {/* Icon Picker bottom sheet */}
            <IconPicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelect={handleIconSelect}
            />
        </motion.div>
    );
}
