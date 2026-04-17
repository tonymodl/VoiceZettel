"use client";

import { Bot, Zap, Bell, Gauge, Brain } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { Switch } from "@/components/ui/switch";

const AUTONOMY_LEVELS = [
    { level: 0, name: "Автоматический", desc: "ИИ сам решает по контексту: рутина — молча, важное — спрашивает", emoji: "🧠" },
    { level: 1, name: "Ручной", desc: "Только по прямой команде, всё переспрашивает", emoji: "🛡️" },
    { level: 2, name: "Осторожный", desc: "Предлагает действия, ждёт подтверждения", emoji: "🔒" },
    { level: 3, name: "Умеренный", desc: "Поиск и чтение сам, запись — спрашивает", emoji: "🔍" },
    { level: 4, name: "Сбалансированный", desc: "Мелкие решения сам, крупные — спрашивает", emoji: "⚖️" },
    { level: 5, name: "Продвинутый", desc: "Большинство действий сам, спрашивает при неоднозначности", emoji: "📊" },
    { level: 6, name: "Проактивный", desc: "Действует сам, сообщает о результате", emoji: "🚀" },
    { level: 7, name: "Быстрый", desc: "Всё сам, спрашивает только при возможном ущербе", emoji: "⚡" },
    { level: 8, name: "Агрессивный", desc: "Полная инициатива. Решает и делает", emoji: "🔥" },
    { level: 9, name: "Максимальный", desc: "Всё сам без подтверждений. Логирует решения", emoji: "💎" },
    { level: 10, name: "Полная автономия", desc: "Абсолютная свобода. Второй мозг", emoji: "🤖" },
] as const;

export function AgentsSection() {
    const lavMode = useSettingsStore((s) => s.lavMode);
    const toggleLavMode = useSettingsStore((s) => s.toggleLavMode);
    const voiceNotifications = useSettingsStore((s) => s.voiceNotifications);
    const toggleVoiceNotifications = useSettingsStore((s) => s.toggleVoiceNotifications);
    const autonomyLevel = useSettingsStore((s) => s.autonomyLevel);
    const setAutonomyLevel = useSettingsStore((s) => s.setAutonomyLevel);

    const currentLevel = AUTONOMY_LEVELS.find((l) => l.level === autonomyLevel) ?? AUTONOMY_LEVELS[4];
    const isAutoMode = autonomyLevel === 0;

    return (
        <div className="space-y-6">
            {/* Antigravity Autonomy */}
            <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <Gauge className="size-4 text-violet-400" />
                    Самостоятельность ИИ
                </h3>

                {/* Current level display */}
                <div className={`rounded-xl border p-4 mb-3 ${
                    isAutoMode
                        ? "border-cyan-500/20 bg-cyan-500/5"
                        : "border-violet-500/20 bg-violet-500/5"
                }`}>
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">{currentLevel.emoji}</span>
                        <div className="flex-1">
                            <p className={`text-sm font-semibold ${isAutoMode ? "text-cyan-300" : "text-violet-300"}`}>
                                {currentLevel.name}
                            </p>
                            <p className="text-[11px] text-zinc-500">{currentLevel.desc}</p>
                        </div>
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-bold text-zinc-400">
                            {autonomyLevel}/10
                        </span>
                    </div>
                </div>

                {/* Auto mode checkbox */}
                <div className="mb-3 flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                        <Brain className="size-4 text-cyan-400" />
                        <div>
                            <p className="text-[12px] font-medium text-zinc-300">Автоматически</p>
                            <p className="text-[10px] text-zinc-600">
                                ИИ сам по контексту и опыту определяет когда спросить, а когда сделать молча
                            </p>
                        </div>
                    </div>
                    <Switch
                        checked={isAutoMode}
                        onCheckedChange={(checked) => {
                            setAutonomyLevel(checked ? 0 : 4);
                        }}
                    />
                </div>

                {/* Slider (disabled when auto mode) */}
                <div className={`px-1 ${isAutoMode ? "opacity-40 pointer-events-none" : ""}`}>
                    <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={isAutoMode ? 5 : autonomyLevel}
                        onChange={(e) => setAutonomyLevel(Number(e.target.value))}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer accent-violet-500"
                        style={{
                            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${((isAutoMode ? 5 : autonomyLevel) - 1) / 9 * 100}%, #27272a ${((isAutoMode ? 5 : autonomyLevel) - 1) / 9 * 100}%, #27272a 100%)`,
                        }}
                        disabled={isAutoMode}
                    />
                    <div className="flex justify-between mt-1">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
                            <button
                                key={l}
                                onClick={() => setAutonomyLevel(l)}
                                disabled={isAutoMode}
                                className={`text-[8px] font-medium transition-colors ${
                                    l === autonomyLevel ? "text-violet-400" : "text-zinc-600 hover:text-zinc-400"
                                }`}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                    <div className="flex justify-between mt-0.5 text-[8px] text-zinc-600">
                        <span>🛡️ Спрашивает всё</span>
                        <span>🤖 Всё решает сам</span>
                    </div>
                </div>
            </section>

            {/* Voice Notifications */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <Bell className="size-4 text-amber-400" />
                    Уведомления
                </h3>
                <div className="divide-y divide-white/5">
                    <div className="flex items-center justify-between py-3">
                        <div className="flex flex-col gap-0.5 pr-3">
                            <span className="text-sm text-zinc-300">🔔 Голосовые уведомления</span>
                            <span className="text-[11px] text-zinc-600">
                                Озвучивать &quot;Задача готова&quot; при завершении
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-600">
                                {voiceNotifications ? "Вкл" : "Выкл"}
                            </span>
                            <Switch checked={voiceNotifications} onCheckedChange={toggleVoiceNotifications} />
                        </div>
                    </div>
                </div>
            </section>

            {/* Agents */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <Bot className="size-4 text-violet-400" />
                    Агенты
                </h3>
                <div className="divide-y divide-white/5">
                    {/* Lapel / Shelestun */}
                    <div className="flex items-center justify-between py-3">
                        <div className="flex flex-col gap-0.5 pr-3">
                            <span className="text-sm text-zinc-300">🎙 Петличка</span>
                            <span className="text-[11px] text-zinc-600">
                                Фоновая запись встречи с дневризацией
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-600">
                                {lavMode ? "▶ Вкл" : "Выключен"}
                            </span>
                            <Switch checked={lavMode} onCheckedChange={toggleLavMode} />
                        </div>
                    </div>

                    {/* Future agents */}
                    <div className="flex items-center gap-3 py-4 text-zinc-600">
                        <Zap className="size-4" />
                        <span className="text-xs">
                            Больше агентов будет добавлено позже
                        </span>
                    </div>
                </div>
            </section>
        </div>
    );
}
