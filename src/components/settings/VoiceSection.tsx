"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Slider } from "@/components/ui/slider";

/** Human-readable timeout consequences */
function getTimeoutHint(minutes: number): { label: string; description: string; color: string } {
    if (minutes === 0) return {
        label: "Выключен",
        description: "Фоновый прогрев отключён. Каждый клик по шару будет заново запрашивать микрофон и токены — задержка 3-10 секунд.",
        color: "text-red-400",
    };
    if (minutes <= 1) return {
        label: `${minutes} мин`,
        description: "Минимальный кеш. Микрофон и токены освобождаются через минуту бездействия. Экономит ресурсы, но быстрый повторный старт не гарантирован.",
        color: "text-amber-400",
    };
    if (minutes <= 5) return {
        label: `${minutes} мин`,
        description: "Оптимальный баланс. Микрофон удерживается в фоне — повторный старт голоса мгновенный. Индикатор записи виден в Chrome. Zoom/Teams не блокируется (авто-освобождение при переключении вкладки).",
        color: "text-emerald-400",
    };
    if (minutes <= 15) return {
        label: `${minutes} мин`,
        description: "Длительный кеш. Удобно для частых голосовых сессий. Микрофон занят дольше — индикатор записи будет виден. Токены обновляются реже, возможна разовая задержка после истечения.",
        color: "text-cyan-400",
    };
    return {
        label: `${minutes} мин`,
        description: "Максимальное удержание. Микрофон и токены в фоне почти постоянно. Мгновенный старт в любой момент, но ресурсы заняты. Не рекомендуется при работе с другими голосовыми приложениями.",
        color: "text-violet-400",
    };
}

export function VoiceSection() {
    const settings = useSettingsStore();
    const addNotification = useNotificationStore((s) => s.addNotification);
    const timeout = settings.prewarmTimeoutMinutes ?? 5;
    const hint = getTimeoutHint(timeout);

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

            {/* Antigravity: Pre-warm Timeout */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">🚀</span>
                    Фоновый прогрев (Antigravity)
                </h3>
                <p className="mb-2 text-[11px] text-zinc-600">
                    Время удержания микрофона и кеша токенов в фоновом режиме.
                    Чем дольше — тем быстрее мгновенный старт голоса, но ресурсы заняты.
                </p>
                <div className="flex items-center gap-4">
                    <Slider
                        className="flex-1"
                        min={0}
                        max={30}
                        step={1}
                        value={[timeout]}
                        onValueChange={(v: number[]) => settings.setPrewarmTimeoutMinutes(v[0])}
                    />
                    <span className={`min-w-[3.5rem] text-right text-sm font-semibold ${hint.color}`}>
                        {hint.label}
                    </span>
                </div>
                <div className="mt-2 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2">
                    <p className={`text-[11px] leading-relaxed ${hint.color}`}>
                        {hint.description}
                    </p>
                </div>
                {timeout > 0 && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/10 bg-amber-500/5 px-3 py-2">
                        <span className="mt-0.5 text-[11px]">⚠️</span>
                        <p className="text-[11px] leading-relaxed text-amber-400/80">
                            При активном прогреве Chrome показывает индикатор записи (красная точка).
                            Микрофон автоматически освобождается при переключении на другую вкладку
                            (Zoom, Teams, Discord не блокируются).
                        </p>
                    </div>
                )}
            </section>
        </div>
    );
}

