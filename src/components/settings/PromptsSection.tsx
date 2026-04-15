"use client";

import { useRef, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

/** Auto-resize textarea to match content */
function autoResize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 56)}px`;
}

function AdaptiveTextarea({
    value,
    onChange,
    placeholder,
    minRows,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    minRows?: number;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(e.target.value);
            autoResize(e.target);
        },
        [onChange],
    );

    return (
        <textarea
            ref={(el) => {
                (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
                // Auto-resize on mount
                requestAnimationFrame(() => autoResize(el));
            }}
            className="w-full resize-none rounded-xl border border-white/10 bg-zinc-800/60 px-3.5 py-3 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-colors"
            rows={minRows ?? 2}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
        />
    );
}

export function PromptsSection() {
    const settings = useSettingsStore();

    return (
        <div className="space-y-6">
            {/* System prompt */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">🧠</span>
                    Системный промт
                </h3>
                <p className="mb-2.5 text-[11px] leading-relaxed text-zinc-600">
                    Главный промт, определяющий личность и поведение ассистента.
                    Влияет на <strong className="text-zinc-500">все ответы</strong> ИИ: стиль речи, язык, тон, правила
                    взаимодействия. Отправляется первым сообщением в каждом запросе к API.
                </p>
                <AdaptiveTextarea
                    value={settings.systemPrompt}
                    onChange={(v) => settings.setSystemPrompt(v)}
                    placeholder="Вы — дружелюбный ассистент для заметок..."
                    minRows={4}
                />
            </section>

            {/* Zettelkasten prompt */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">📝</span>
                    Промт Zettelkasten
                </h3>
                <p className="mb-2.5 text-[11px] leading-relaxed text-zinc-600">
                    Инструкции для классификации заметок по методу Zettelkasten.
                    Влияет на <strong className="text-zinc-500">распознавание тегов</strong>: как ИИ определяет
                    категорию (идея / факт / персона / задача) и формулирует ключевые мысли.
                </p>
                <AdaptiveTextarea
                    value={settings.zettelkastenPrompt}
                    onChange={(v) => settings.setZettelkastenPrompt(v)}
                    placeholder="Когда пользователь диктует заметку..."
                    minRows={3}
                />
            </section>

            {/* Custom Widget Prompts */}
            {settings.customWidgets.length > 0 && (
                <section>
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                        <span className="text-base">🏷</span>
                        Промты кастомных виджетов
                    </h3>
                    <p className="mb-3 text-[11px] leading-relaxed text-zinc-600">
                        Индивидуальные инструкции для каждого виджета.
                        Влияют на <strong className="text-zinc-500">автотегирование</strong>: ИИ будет ставить тег
                        <code className="mx-1 rounded bg-zinc-800 px-1 text-[10px] text-violet-400">[COUNTER:id]</code>
                        когда ответ соответствует описанному критерию.
                    </p>
                    <div className="space-y-3">
                        {settings.customWidgets.map((widget) => (
                            <div key={widget.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3.5">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-medium text-zinc-300">
                                        {widget.label}
                                    </span>
                                    <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-violet-400">
                                        [COUNTER:{widget.id}]
                                    </code>
                                </div>
                                <AdaptiveTextarea
                                    value={widget.prompt}
                                    onChange={(v) => {
                                        const updated = settings.customWidgets.map((w) =>
                                            w.id === widget.id ? { ...w, prompt: v } : w,
                                        );
                                        useSettingsStore.setState({ customWidgets: updated });
                                    }}
                                    placeholder="Опишите когда AI должен использовать этот тег..."
                                    minRows={2}
                                />
                                <p className="mt-1.5 text-[10px] text-zinc-700">
                                    {widget.enabled ? "✅ Активен" : "⏸ Отключён"} · Счётчик: {widget.count}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
