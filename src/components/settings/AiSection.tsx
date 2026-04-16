"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Switch } from "@/components/ui/switch";

const PROVIDERS = [
    { key: "openai" as const, label: "OpenAI", notif: "Мозги: OpenAI — применится к следующему сообщению" },
    { key: "google" as const, label: "Gemini", notif: "Мозги: Gemini — применится к следующему сообщению" },
];

const TTS_PROVIDERS = [
    { key: "gemini" as const, label: "Google TTS", notif: "Озвучка: Google Gemini — лучшие голоса ✨" },
    { key: "edge" as const, label: "Edge TTS", notif: "Озвучка: Edge TTS — применится к следующему ответу" },
    { key: "openai" as const, label: "OpenAI TTS", notif: "Озвучка: OpenAI — перезапустите сессию" },
];

const VOICE_MODES = [
    { key: "cloud" as const, label: "Облако", desc: "OpenAI / Edge TTS через API" },
    { key: "gemini-live" as const, label: "Gemini Live", desc: "WebSocket, низкая задержка" },
];

function ProviderButton({
    active,
    label,
    onClick,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${active
                ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

export function AiSection() {
    const settings = useSettingsStore();
    const addNotification = useNotificationStore((s) => s.addNotification);

    return (
        <div className="space-y-5">
            {/* ── AI Provider (Мозги) ── */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">🧠</span>
                    Мозги
                </h3>
                <p className="mb-3 text-[11px] text-zinc-600">
                    Основная модель для генерации ответов
                </p>
                <div className="flex gap-2">
                    {PROVIDERS.map((p) => (
                        <ProviderButton
                            key={p.key}
                            active={settings.aiProvider === p.key}
                            label={p.label}
                            onClick={() => {
                                settings.setAiProvider(p.key);
                                addNotification(p.notif, "info");
                            }}
                        />
                    ))}
                </div>
            </section>

            {/* ── Voice Mode ── */}
            <section>
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                    <span className="text-base">🎙</span>
                    Режим голоса
                </h3>
                <p className="mb-3 text-[11px] text-zinc-600">
                    Как ассистент обрабатывает голосовой ввод
                </p>
                <div className="flex flex-col gap-2">
                    {VOICE_MODES.map((m) => (
                        <button
                            key={m.key}
                            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                                settings.voiceMode === m.key
                                    ? "border-violet-500 bg-violet-500/10"
                                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                            }`}
                            onClick={() => {
                                settings.setVoiceMode(m.key);
                                addNotification(`Режим голоса: ${m.label}`, "info");
                            }}
                        >
                            <div>
                                <p className={`text-sm font-medium ${settings.voiceMode === m.key ? "text-violet-300" : "text-zinc-300"}`}>
                                    {m.label}
                                </p>
                                <p className="text-[11px] text-zinc-600">{m.desc}</p>
                            </div>
                            {settings.voiceMode === m.key && (
                                <span className="text-xs text-violet-400">✓</span>
                            )}
                        </button>
                    ))}
                </div>
            </section>

            {/* ── Voice AI toggle ── */}
            <section>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-400">
                            <span className="text-base">🔊</span>
                            Озвучка ответов
                        </h3>
                        <p className="text-[11px] text-zinc-600">
                            Голосовое воспроизведение ответов ИИ
                        </p>
                    </div>
                    <Switch checked={settings.aiVoiceEnabled} onCheckedChange={settings.toggleAiVoiceEnabled} />
                </div>
            </section>

            {/* ── TTS Provider (only when voice enabled) ── */}
            {settings.aiVoiceEnabled && (
                <section>
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-400">
                        <span className="text-base">🗣</span>
                        Движок озвучки
                    </h3>
                    <div className="flex gap-2">
                        {TTS_PROVIDERS.map((p) => (
                            <ProviderButton
                                key={p.key}
                                active={settings.ttsProvider === p.key}
                                label={p.label}
                                onClick={() => {
                                    settings.setTtsProvider(p.key);
                                    addNotification(p.notif, "info");
                                }}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
