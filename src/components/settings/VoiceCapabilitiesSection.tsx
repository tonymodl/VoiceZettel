"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Switch } from "@/components/ui/switch";

interface CapabilityRow {
    icon: string;
    label: string;
    desc: string;
    enabled: boolean;
    toggle: () => void;
    disabled?: boolean;
}

export function VoiceCapabilitiesSection() {
    const settings = useSettingsStore();
    const addNotification = useNotificationStore((s) => s.addNotification);

    const capabilities: CapabilityRow[] = [
        {
            icon: "🔍",
            label: "Поиск по хранилищам",
            desc: "Доступ к ChromaDB, Telegram, Zettelkasten",
            enabled: settings.voiceSearchKnowledge,
            toggle: () => {
                settings.toggleVoiceSearchKnowledge();
                addNotification(
                    settings.voiceSearchKnowledge ? "Поиск отключён" : "Поиск включён",
                    "info",
                );
            },
            disabled: !settings.voiceTools,
        },
        {
            icon: "📊",
            label: "Статус систем",
            desc: "Мониторинг сервисов, логи, дашборд",
            enabled: settings.voiceSystemStatus,
            toggle: () => {
                settings.toggleVoiceSystemStatus();
                addNotification(
                    settings.voiceSystemStatus ? "Мониторинг отключён" : "Мониторинг включён",
                    "info",
                );
            },
            disabled: !settings.voiceTools,
        },
        {
            icon: "🌐",
            label: "Просмотр ссылок",
            desc: "Открытие и чтение веб-страниц по URL",
            enabled: settings.voiceUrlAccess,
            toggle: () => {
                settings.toggleVoiceUrlAccess();
                addNotification(
                    settings.voiceUrlAccess ? "Просмотр ссылок отключён" : "Просмотр ссылок включён",
                    "info",
                );
            },
            disabled: !settings.voiceTools,
        },
        {
            icon: "📝",
            label: "Управление задачами",
            desc: "Сохранение заметок, создание задач в Obsidian",
            enabled: settings.voiceTaskManagement,
            toggle: () => {
                settings.toggleVoiceTaskManagement();
                addNotification(
                    settings.voiceTaskManagement ? "Управление задачами отключено" : "Управление задачами включено",
                    "info",
                );
            },
            disabled: !settings.voiceTools,
        },
    ];

    return (
        <section className="mt-6">
            {/* Master toggle */}
            <div className="mb-4 flex items-center justify-between rounded-xl border border-violet-500/30 bg-violet-500/5 px-4 py-3">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-300">
                        <span className="text-base">⚡</span>
                        Возможности ИИ-ассистента
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                        Function calling в Gemini Live — динамический доступ к данным
                    </p>
                </div>
                <Switch
                    checked={settings.voiceTools}
                    onCheckedChange={() => {
                        settings.toggleVoiceTools();
                        addNotification(
                            settings.voiceTools
                                ? "Инструменты ИИ отключены"
                                : "Инструменты ИИ включены — перезапустите сессию",
                            "info",
                        );
                    }}
                />
            </div>

            {/* Individual capabilities */}
            <div className="space-y-1">
                {capabilities.map((cap) => (
                    <div
                        key={cap.label}
                        className={`flex items-center justify-between rounded-lg px-4 py-2.5 transition-all ${
                            cap.disabled
                                ? "opacity-40"
                                : "hover:bg-zinc-800/50"
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-lg">{cap.icon}</span>
                            <div>
                                <p className={`text-[13px] font-medium ${
                                    cap.enabled && !cap.disabled ? "text-zinc-200" : "text-zinc-500"
                                }`}>
                                    {cap.label}
                                </p>
                                <p className="text-[11px] text-zinc-600">{cap.desc}</p>
                            </div>
                        </div>
                        <Switch
                            checked={cap.enabled}
                            onCheckedChange={cap.toggle}
                            disabled={cap.disabled}
                        />
                    </div>
                ))}
            </div>

            {settings.voiceTools && (
                <p className="mt-3 px-4 text-[10px] text-zinc-600">
                    💡 Изменения вступают в силу при следующем подключении к Gemini Live
                </p>
            )}
        </section>
    );
}
