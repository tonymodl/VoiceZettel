"use client";

import { Bot, Zap } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { Switch } from "@/components/ui/switch";

export function AgentsSection() {
    const lavMode = useSettingsStore((s) => s.lavMode);
    const toggleLavMode = useSettingsStore((s) => s.toggleLavMode);

    return (
        <div className="space-y-6">
            {/* Shelestun */}
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

                    {/* Future agents placeholder */}
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
