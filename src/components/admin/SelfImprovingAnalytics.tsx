"use client";

import { useState, useEffect, useCallback } from "react";
import {
    TrendingUp, TrendingDown, Minus, AlertTriangle,
    Brain, Heart, Zap, Clock, BarChart3, RefreshCw, Loader2,
    Settings2, Save, X
} from "lucide-react";

/* ── Types — aligned with backend (session_analytics table + empathyEngine) ── */
interface SessionAnalytic {
    sessionId: string;
    satisfaction: number;        // 1-10
    painCount: number;
    createdAt: string;
    summary: string;
}

interface BackendEmpathyProfile {
    empathyScore: number;
    totalSessions: number;
    satisfiedSessions: number;
    communicationDNA: {
        preferredTone: string;
        avgMessageLength: string;
        patienceLevel: string;
        detailPreference: string;
        humorTolerance: string;
        decisionStyle: string;
        frustrationTriggers: string[];
        delightTriggers: string[];
    };
    patterns: {
        peakHours: string[];
        topTopicsAllTime: string[];
        moodByTimeOfDay: Record<string, string>;
        devicePreferences: Record<string, number>;
    };
    evolvedRules: string[];
    automationOpportunities: string[];
    proactiveActions: string[];
    updatedAt: string;
}

/* ── Component ── */
export function SelfImprovingAnalytics() {
    const [analytics, setAnalytics] = useState<SessionAnalytic[]>([]);
    const [empathy, setEmpathy] = useState<BackendEmpathyProfile | null>(null);
    const [empathyExists, setEmpathyExists] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    
    // --- Edit Mode States ---
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [analyticsRes, empathyRes] = await Promise.allSettled([
                fetch("/api/session-analytics?userId=anonymous&limit=20").then((r) => r.json()),
                fetch("/api/empathy-profile?userId=anonymous").then((r) => r.json()),
            ]);

            if (analyticsRes.status === "fulfilled") {
                const data = analyticsRes.value as { sessions?: SessionAnalytic[] };
                setAnalytics(data.sessions ?? []);
            }
            if (empathyRes.status === "fulfilled") {
                const data = empathyRes.value as { exists?: boolean; profile?: BackendEmpathyProfile };
                if (data.exists && data.profile) {
                    setEmpathy(data.profile);
                    setEmpathyExists(true);
                }
            }
        } catch {
            // Silent fail
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const parsed = JSON.parse(editValue);
            const res = await fetch("/api/empathy-profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: "anonymous", profile: parsed })
            });
            if (res.ok) {
                setEmpathy(parsed);
                setIsEditing(false);
            } else {
                alert("Ошибка сохранения");
            }
        } catch (e) {
            alert("Невалидный JSON: " + String(e));
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Trends
    const recentSessions = analytics.slice(0, 5);
    const olderSessions = analytics.slice(5, 10);
    const avgRecent = recentSessions.length > 0
        ? recentSessions.reduce((s, a) => s + a.satisfaction, 0) / recentSessions.length
        : 0;
    const avgOlder = olderSessions.length > 0
        ? olderSessions.reduce((s, a) => s + a.satisfaction, 0) / olderSessions.length
        : 0;
    const trend = avgRecent - avgOlder;
    const totalPainCount = analytics.reduce((s, a) => s + a.painCount, 0);

    const TrendIcon = trend > 0.3 ? TrendingUp : trend < -0.3 ? TrendingDown : Minus;
    const trendColor = trend > 0.3 ? "text-emerald-400" : trend < -0.3 ? "text-red-400" : "text-zinc-400";
    const trendLabel = trend > 0.3 ? "Улучшается" : trend < -0.3 ? "Ухудшается" : "Стабильно";

    // Map communicationDNA to visual bars (normalize string values to 0-1)
    const dnaToNumber = (val: string, map: Record<string, number>): number => map[val] ?? 0.5;
    const dnaValues = empathy ? [
        { label: "Теплота", value: dnaToNumber(empathy.communicationDNA.preferredTone, { formal: 0.2, direct: 0.5, friendly: 0.9 }), icon: <Heart className="size-3" /> },
        { label: "Подробность", value: dnaToNumber(empathy.communicationDNA.detailPreference, { minimal: 0.2, moderate: 0.5, detailed: 0.9 }), icon: <Brain className="size-3" /> },
        { label: "Юмор", value: dnaToNumber(empathy.communicationDNA.humorTolerance, { none: 0.1, subtle: 0.5, full: 0.9 }), icon: <Zap className="size-3" /> },
        { label: "Терпение", value: dnaToNumber(empathy.communicationDNA.patienceLevel, { low: 0.2, medium: 0.5, high: 0.9 }), icon: <Clock className="size-3" /> },
        { label: "Решения", value: dnaToNumber(empathy.communicationDNA.decisionStyle, { fast: 0.2, collaborative: 0.5, deliberate: 0.8 }), icon: <TrendingUp className="size-3" /> },
    ] : [];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8">
                <Loader2 className="size-5 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent p-4">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-base">📈</span>
                    <h3 className="text-sm font-bold text-zinc-200">Аналитика самоулучшения</h3>
                </div>
                <div className="flex items-center gap-2">
                    {empathyExists && (
                        <button
                            onClick={() => {
                                if (isEditing) {
                                    setIsEditing(false);
                                } else {
                                    setEditValue(JSON.stringify(empathy, null, 2));
                                    setIsEditing(true);
                                }
                            }}
                            className={`rounded-lg border px-2 py-1.5 transition-colors ${
                                isEditing 
                                    ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20" 
                                    : "border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20"
                            }`}
                            title={isEditing ? "Отмена" : "Редактировать профиль и выводы"}
                        >
                            {isEditing ? <X className="size-3.5" /> : <Settings2 className="size-3.5" />}
                        </button>
                    )}
                    <button
                        onClick={fetchData}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:text-zinc-200"
                    >
                        <RefreshCw className="size-3.5" />
                    </button>
                </div>
            </div>

            {isEditing ? (
                <div className="animate-in fade-in space-y-3">
                    <p className="text-[11px] text-violet-300">
                        Вы можете вручную скорректировать ДНК общения, выученные правила и автоматизации в формате JSON.
                    </p>
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-[400px] w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-4 font-mono text-[11px] text-green-400 focus:border-violet-500 focus:outline-none"
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-violet-500 disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            Сохранить изменения
                        </button>
                    </div>
                </div>
            ) : analytics.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-700 p-6 text-center">
                    <Brain className="mx-auto mb-2 size-8 text-zinc-600" />
                    <p className="text-[12px] text-zinc-500">
                        Нет данных аналитики. Проведите голосовую сессию — анализ произойдёт автоматически.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* ── KPI Cards ── */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                            <p className="text-[10px] text-zinc-500">Удовлетворённость</p>
                            <p className="text-2xl font-bold text-zinc-200">
                                {avgRecent.toFixed(1)}
                            </p>
                            <div className={`flex items-center justify-center gap-1 ${trendColor}`}>
                                <TrendIcon className="size-3" />
                                <span className="text-[10px] font-bold">{trendLabel}</span>
                            </div>
                        </div>

                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                            <p className="text-[10px] text-zinc-500">Сессий</p>
                            <p className="text-2xl font-bold text-zinc-200">{analytics.length}</p>
                            <span className="text-[10px] text-zinc-600">проанализировано</span>
                        </div>

                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                            <p className="text-[10px] text-zinc-500">Проблем</p>
                            <p className={`text-2xl font-bold ${totalPainCount > 5 ? "text-red-400" : "text-emerald-400"}`}>
                                {totalPainCount}
                            </p>
                            <span className="text-[10px] text-zinc-600">pain points</span>
                        </div>

                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                            <p className="text-[10px] text-zinc-500">Эмпатия</p>
                            <p className="text-2xl font-bold text-violet-400">
                                {empathy?.empathyScore ?? 0}
                            </p>
                            <span className="text-[10px] text-zinc-600">из 100</span>
                        </div>
                    </div>

                    {/* ── Satisfaction Timeline ── */}
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                        <p className="mb-2 text-[11px] font-bold text-zinc-300">
                            <BarChart3 className="mb-0.5 mr-1 inline-block size-3" />
                            Удовлетворённость по сессиям
                        </p>
                        <div className="flex items-end gap-1" style={{ height: "60px" }}>
                            {analytics.slice(0, 20).reverse().map((session, i) => {
                                const height = (session.satisfaction / 10) * 100;
                                const color = session.satisfaction >= 7
                                    ? "bg-emerald-500"
                                    : session.satisfaction >= 4
                                        ? "bg-amber-500"
                                        : "bg-red-500";
                                return (
                                    <div
                                        key={session.sessionId || i}
                                        className={`flex-1 rounded-t ${color} transition-all duration-300`}
                                        style={{ height: `${height}%`, minWidth: "4px" }}
                                        title={`${new Date(session.createdAt).toLocaleDateString("ru-RU")}: ${session.satisfaction}/10 — ${session.summary}`}
                                    />
                                );
                            })}
                        </div>
                        <div className="mt-1 flex justify-between text-[9px] text-zinc-600">
                            <span>Старые →</span>
                            <span>→ Новые</span>
                        </div>
                    </div>

                    {/* ── Communication DNA ── */}
                    {empathyExists && dnaValues.length > 0 && (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                            <p className="mb-2 text-[11px] font-bold text-zinc-300">
                                <Heart className="mb-0.5 mr-1 inline-block size-3 text-pink-400" />
                                Communication DNA
                            </p>
                            <div className="grid grid-cols-5 gap-2">
                                {dnaValues.map((dim) => {
                                    const pct = Math.round(dim.value * 100);
                                    return (
                                        <div key={dim.label} className="text-center">
                                            <div className="mx-auto mb-1 flex items-center justify-center text-zinc-500">
                                                {dim.icon}
                                            </div>
                                            <div className="mx-auto h-16 w-2 overflow-hidden rounded-full bg-zinc-800">
                                                <div
                                                    className="w-full rounded-full bg-gradient-to-t from-violet-600 to-pink-500 transition-all duration-500"
                                                    style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
                                                />
                                            </div>
                                            <p className="mt-1 text-[8px] text-zinc-600">{dim.label}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── Frustration & Delight triggers ── */}
                    {empathy && (empathy.communicationDNA.frustrationTriggers.length > 0 || empathy.communicationDNA.delightTriggers.length > 0) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                            {empathy.communicationDNA.frustrationTriggers.length > 0 && (
                                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                                    <p className="mb-1.5 text-[11px] font-bold text-zinc-300">
                                        <AlertTriangle className="mb-0.5 mr-1 inline-block size-3 text-red-400" />
                                        Раздражители
                                    </p>
                                    <ul className="space-y-0.5">
                                        {empathy.communicationDNA.frustrationTriggers.map((t, i) => (
                                            <li key={i} className="text-[10px] text-red-300/70">• {t}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {empathy.communicationDNA.delightTriggers.length > 0 && (
                                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                                    <p className="mb-1.5 text-[11px] font-bold text-zinc-300">
                                        <Heart className="mb-0.5 mr-1 inline-block size-3 text-emerald-400" />
                                        Что радует
                                    </p>
                                    <ul className="space-y-0.5">
                                        {empathy.communicationDNA.delightTriggers.map((t, i) => (
                                            <li key={i} className="text-[10px] text-emerald-300/70">• {t}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Evolved Rules ── */}
                    {empathy?.evolvedRules && empathy.evolvedRules.length > 0 && (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                            <p className="mb-2 text-[11px] font-bold text-zinc-300">
                                <Zap className="mb-0.5 mr-1 inline-block size-3 text-yellow-400" />
                                Выученные правила ({empathy.evolvedRules.length})
                            </p>
                            <ul className="space-y-1">
                                {empathy.evolvedRules.map((rule, i) => (
                                    <li key={i} className="text-[10px] text-zinc-400">
                                        • {rule}
                                    </li>
                                ))}
                            </ul>
                            {empathy.updatedAt && (
                                <p className="mt-2 flex items-center gap-1 text-[9px] text-zinc-600">
                                    <Clock className="size-2.5" />
                                    Обновлено: {new Date(empathy.updatedAt).toLocaleString("ru-RU")}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
