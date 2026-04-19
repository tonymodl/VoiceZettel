"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Radio, Brain, Mic, Volume2, FileText, Heart,
    Shield, RefreshCw, Loader2, Wrench, CheckCircle2,
    XCircle, AlertTriangle, Clock, Database,
} from "lucide-react";

/* ── Types ── */
interface VoiceService {
    id: string;
    nameRu: string;
    icon: React.ReactNode;
    status: "ok" | "degraded" | "error" | "checking";
    detail: string;
    healAction?: string;
}

interface ContextSlotInfo {
    name: string;
    emoji: string;
    usedChars: number;
    maxChars: number;
    itemCount: number;
}

/* ── Component ── */
export function VoiceServicesHealth() {
    const [services, setServices] = useState<VoiceService[]>([]);
    const [contextSlots, setContextSlots] = useState<ContextSlotInfo[] | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isHealing, setIsHealing] = useState<string | null>(null);
    const [lastCheck, setLastCheck] = useState<Date | null>(null);

    const checkHealth = useCallback(async () => {
        setIsChecking(true);
        const results: VoiceService[] = [];

        // 1. WS Proxy (port 3099)
        try {
            const res = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                results.push({
                    id: "ws-proxy",
                    nameRu: "WebSocket Прокси",
                    icon: <Radio className="size-4 text-cyan-400" />,
                    status: "ok",
                    detail: "Порт 3099 — голосовой канал работает",
                });
            } else {
                throw new Error("не отвечает");
            }
        } catch {
            results.push({
                id: "ws-proxy",
                nameRu: "WebSocket Прокси",
                icon: <Radio className="size-4 text-red-400" />,
                status: "error",
                detail: "Порт 3099 не отвечает. Голос не будет работать.",
                healAction: "Запустите: node ws-proxy.js",
            });
        }

        // 2. Gemini API
        try {
            const res = await fetch("/api/gemini-live-token", {
                method: "POST",
                signal: AbortSignal.timeout(6000),
            });
            const data = await res.json() as {
                disabled?: boolean;
                wsUrl?: string;
                contextSummary?: {
                    totalTokens: number;
                    maxTokens: number;
                    percentUsed: number;
                    slots?: Record<string, ContextSlotInfo>;
                };
                compiledRules?: string;
                empathyBlock?: string;
            };

            if (data.disabled) {
                results.push({
                    id: "gemini-api",
                    nameRu: "Gemini API",
                    icon: <Brain className="size-4 text-red-400" />,
                    status: "error",
                    detail: "GOOGLE_GEMINI_API_KEY не настроен",
                    healAction: "Добавьте ключ в .env",
                });
            } else {
                results.push({
                    id: "gemini-api",
                    nameRu: "Gemini API",
                    icon: <Brain className="size-4 text-emerald-400" />,
                    status: "ok",
                    detail: `Ключ настроен. Контекст: ${data.contextSummary?.percentUsed?.toFixed(1) ?? "?"}%`,
                });

                // Parse context slots
                if (data.contextSummary?.slots) {
                    const slots = Object.values(data.contextSummary.slots) as ContextSlotInfo[];
                    setContextSlots(slots);
                }

                // 3. Compiled Rules
                if (data.compiledRules && data.compiledRules.length > 0) {
                    results.push({
                        id: "compiled-rules",
                        nameRu: "Compiled Rules",
                        icon: <Shield className="size-4 text-violet-400" />,
                        status: "ok",
                        detail: `${data.compiledRules.length} символов поведенческих правил загружено`,
                    });
                } else {
                    results.push({
                        id: "compiled-rules",
                        nameRu: "Compiled Rules",
                        icon: <Shield className="size-4 text-amber-400" />,
                        status: "degraded",
                        detail: "Нет compiled rules — замечания не компилированы",
                        healAction: "Перегенерировать правила",
                    });
                }

                // 4. Empathy Profile
                if (data.empathyBlock && data.empathyBlock.length > 0) {
                    results.push({
                        id: "empathy",
                        nameRu: "Empathy Profile",
                        icon: <Heart className="size-4 text-pink-400" />,
                        status: "ok",
                        detail: `Профиль эмпатии загружен (${data.empathyBlock.length} символов)`,
                    });
                } else {
                    results.push({
                        id: "empathy",
                        nameRu: "Empathy Profile",
                        icon: <Heart className="size-4 text-zinc-500" />,
                        status: "degraded",
                        detail: "Профиль эмпатии не создан — нужна хотя бы 1 сессия",
                    });
                }
            }
        } catch {
            results.push({
                id: "gemini-api",
                nameRu: "Gemini API",
                icon: <Brain className="size-4 text-red-400" />,
                status: "error",
                detail: "Не удалось проверить Gemini API",
            });
        }

        // 5. Microphone (browser)
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const mics = devices.filter((d) => d.kind === "audioinput");
            results.push({
                id: "microphone",
                nameRu: "Микрофон",
                icon: <Mic className={`size-4 ${mics.length > 0 ? "text-emerald-400" : "text-red-400"}`} />,
                status: mics.length > 0 ? "ok" : "error",
                detail: mics.length > 0
                    ? `${mics.length} устройств(а) доступно`
                    : "Нет аудио-устройств",
            });
        } catch {
            results.push({
                id: "microphone",
                nameRu: "Микрофон",
                icon: <Mic className="size-4 text-amber-400" />,
                status: "degraded",
                detail: "Нет доступа к микрофону — проверьте разрешения",
            });
        }

        // 6. Audio Context
        try {
            const testCtx = new AudioContext();
            const state = testCtx.state;
            await testCtx.close();
            results.push({
                id: "audio-ctx",
                nameRu: "AudioContext",
                icon: <Volume2 className="size-4 text-emerald-400" />,
                status: "ok",
                detail: `WebAudio API (${state})`,
            });
        } catch {
            results.push({
                id: "audio-ctx",
                nameRu: "AudioContext",
                icon: <Volume2 className="size-4 text-red-400" />,
                status: "error",
                detail: "WebAudio API заблокирован браузером",
            });
        }

        // 7. Auto-reconnect status
        results.push({
            id: "reconnect",
            nameRu: "Авто-реконнект",
            icon: <RefreshCw className="size-4 text-cyan-400" />,
            status: "ok",
            detail: "3 попытки, backoff 1с→4с",
        });

        // 8. ChromaDB Context
        try {
            const res = await fetch("/api/indexer/health", { signal: AbortSignal.timeout(4000) });
            if (res.ok) {
                const data = await res.json() as { chroma_documents: number; embedder_enabled: boolean };
                if (data.chroma_documents > 5000) {
                    results.push({
                        id: "chroma",
                        nameRu: "Контекст (ChromaDB)",
                        icon: <Database className="size-4 text-emerald-400" />,
                        status: "ok",
                        detail: `${data.chroma_documents.toLocaleString()} чанков`,
                    });
                } else if (data.chroma_documents > 0) {
                    results.push({
                        id: "chroma",
                        nameRu: "Контекст (ChromaDB)",
                        icon: <Database className="size-4 text-amber-400" />,
                        status: "degraded",
                        detail: `${data.chroma_documents.toLocaleString()} чанков — неполная база`,
                         healAction: "Запустить индексацию",
                    });
                } else {
                    results.push({
                        id: "chroma",
                        nameRu: "Контекст (ChromaDB)",
                        icon: <Database className="size-4 text-red-500" />,
                        status: "error",
                        detail: "База пуста (0 чанков)",
                        healAction: "Запустить индексацию",
                    });
                }
            } else {
                throw new Error("HTTP " + res.status);
            }
        } catch {
            results.push({
                id: "chroma",
                nameRu: "Контекст (ChromaDB)",
                icon: <Database className="size-4 text-red-400" />,
                status: "error",
                detail: "Сервис не отвечает (8030)",
                healAction: "Перезапустить службу",
            });
        }

        setServices(results);
        setLastCheck(new Date());
        setIsChecking(false);
    }, []);

    useEffect(() => {
        checkHealth();
        const interval = setInterval(checkHealth, 15000);
        return () => clearInterval(interval);
    }, [checkHealth]);

    const handleHeal = useCallback(async (serviceId: string) => {
        setIsHealing(serviceId);
        try {
            if (serviceId === "compiled-rules") {
                await fetch("/api/synthesize-rules", { method: "POST" });
            } else {
                await fetch("/api/auto-heal", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ target: serviceId }),
                });
            }
            // Re-check after heal
            setTimeout(() => checkHealth(), 2000);
        } catch {
            // Silent fail
        } finally {
            setIsHealing(null);
        }
    }, [checkHealth]);

    const okCount = services.filter((s) => s.status === "ok").length;
    const totalCount = services.length;
    const overallStatus = okCount === totalCount ? "ready" : okCount > totalCount / 2 ? "degraded" : "broken";

    const borderColor = {
        ready: "border-emerald-500/20",
        degraded: "border-amber-500/20",
        broken: "border-red-500/20",
    };

    const statusBg = (s: VoiceService["status"]) => {
        switch (s) {
            case "ok": return "border-emerald-500/20 bg-emerald-500/5";
            case "degraded": return "border-amber-500/20 bg-amber-500/5";
            case "error": return "border-red-500/20 bg-red-500/5";
            case "checking": return "border-zinc-700 bg-zinc-800/50";
        }
    };

    const statusIcon = (s: VoiceService["status"]) => {
        switch (s) {
            case "ok": return <CheckCircle2 className="size-3.5 text-emerald-400" />;
            case "degraded": return <AlertTriangle className="size-3.5 text-amber-400" />;
            case "error": return <XCircle className="size-3.5 text-red-400" />;
            case "checking": return <Loader2 className="size-3.5 animate-spin text-zinc-500" />;
        }
    };

    return (
        <div className={`rounded-2xl border ${borderColor[overallStatus]} bg-zinc-900/40 p-4 backdrop-blur`}>
            {/* Header row */}
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className={`flex size-8 items-center justify-center rounded-lg ${
                        overallStatus === "ready" ? "bg-emerald-500/15" :
                        overallStatus === "degraded" ? "bg-amber-500/15" : "bg-red-500/15"
                    }`}>
                        <Mic className={`size-4 ${
                            overallStatus === "ready" ? "text-emerald-400" :
                            overallStatus === "degraded" ? "text-amber-400" : "text-red-400"
                        }`} />
                    </div>
                    <h3 className="text-sm font-bold text-zinc-200">🎙 Здоровье голоса</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        overallStatus === "ready"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : overallStatus === "degraded"
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-red-500/20 text-red-400"
                    }`}>
                        {okCount}/{totalCount}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {lastCheck && (
                        <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                            <Clock className="size-3" />
                            {lastCheck.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    )}
                    <button
                        onClick={checkHealth}
                        disabled={isChecking}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
                    >
                        {isChecking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    </button>
                </div>
            </div>

            {/* Services grid — compact cards in a responsive grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {services.map((svc) => (
                    <div
                        key={svc.id}
                        className={`group relative rounded-xl border p-2.5 transition-all hover:shadow-md ${statusBg(svc.status)}`}
                    >
                        <div className="mb-1 flex items-center gap-1.5">
                            {statusIcon(svc.status)}
                            {svc.icon}
                            <span className="truncate text-[11px] font-bold text-zinc-200">{svc.nameRu}</span>
                        </div>
                        <p className="text-[10px] leading-snug text-zinc-500">{svc.detail}</p>
                        {svc.healAction && (
                            <button
                                onClick={() => handleHeal(svc.id)}
                                disabled={isHealing === svc.id}
                                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-400 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                                title={svc.healAction}
                            >
                                {isHealing === svc.id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                ) : (
                                    <Wrench className="size-3" />
                                )}
                                Починить
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Context Window — compact horizontal bar */}
            {contextSlots && contextSlots.length > 0 && (
                <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2.5">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        📊 Окно контекста
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                        {contextSlots.map((slot) => {
                            const pct = slot.maxChars > 0 ? Math.min((slot.usedChars / slot.maxChars) * 100, 100) : 0;
                            const barColor = pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500";
                            return (
                                <div key={slot.name} className="flex items-center gap-1.5">
                                    <span className="text-[11px]">{slot.emoji}</span>
                                    <span className="w-16 truncate text-[9px] text-zinc-400">{slot.name}</span>
                                    <div className="flex-1">
                                        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                                            <div
                                                className={`h-full rounded-full ${barColor} transition-all duration-300`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                    <span className="w-8 text-right font-mono text-[8px] text-zinc-600">
                                        {slot.itemCount > 0 ? `${slot.itemCount}` : "—"}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
