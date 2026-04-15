"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Slider } from "@/components/ui/slider";

export function VoiceSection() {
    const settings = useSettingsStore();
    const addNotification = useNotificationStore((s) => s.addNotification);

    return (
        <div className="mt-6 space-y-6">
            {/* Voice Mode — Lavalier */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">🎙</span>
                    Голосовой движок
                </h3>
                <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-zinc-300">Петличка</p>
                            <p className="text-[11px] text-zinc-600">Фоновая запись встречи</p>
                        </div>
                        <button
                            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${settings.lavMode
                                ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/20"
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                            }`}
                            onClick={() => {
                                settings.toggleLavMode();
                                const newState = !settings.lavMode;
                                addNotification(
                                    newState
                                        ? "Петличка включена — запись началась"
                                        : "Петличка выключена — генерируется конспект",
                                    "info",
                                );
                            }}
                        >
                            {settings.lavMode ? "⏹ Выкл" : "▶ Вкл"}
                        </button>
                    </div>
                </div>
            </section>

            {/* Orb Particles */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">✨</span>
                    Частицы сферы
                </h3>
                <p className="mb-3 text-[11px] text-zinc-600">
                    Количество частиц (3–10000). Изменение применится только после перезагрузки
                </p>
                <div className="flex items-center gap-4">
                    <Slider
                        className="flex-1"
                        min={3}
                        max={10000}
                        step={10}
                        value={[settings.orbParticles]}
                        onValueChange={(v: number[]) => settings.setOrbParticles(v[0])}
                    />
                    <span className="min-w-[3rem] text-right text-sm font-medium text-zinc-200">
                        {settings.orbParticles}
                    </span>
                </div>
            </section>
        </div>
    );
}
