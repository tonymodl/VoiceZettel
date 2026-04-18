"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Users, RefreshCw, Loader2, Search, UserCircle,
    MessageSquare, Phone, Heart, Calendar, MapPin,
    Star, Circle as CircleIcon,
} from "lucide-react";

/* ── Types ── */
interface DunbarPerson {
    id: string;
    name: string;
    circle: 1 | 2 | 3 | 4 | 5;   // 1 = inner (5 people), 5 = outer (150)
    relation: string;              // e.g., "жена", "коллега", "друг"
    lastContact: string;           // ISO date
    contactFrequency: "daily" | "weekly" | "monthly" | "rarely";
    channels: string[];            // telegram, phone, meet
    notes: string;
    sentiment: number;             // -1 to 1
}

const CIRCLE_CONFIG = [
    { circle: 1, name: "Ядро", max: 5, color: "text-pink-400", borderColor: "border-pink-500/30", bgColor: "bg-pink-500/10", desc: "Самые близкие люди" },
    { circle: 2, name: "Близкие", max: 15, color: "text-violet-400", borderColor: "border-violet-500/30", bgColor: "bg-violet-500/10", desc: "Близкие друзья и семья" },
    { circle: 3, name: "Друзья", max: 50, color: "text-blue-400", borderColor: "border-blue-500/30", bgColor: "bg-blue-500/10", desc: "Хорошие знакомые, коллеги" },
    { circle: 4, name: "Знакомые", max: 100, color: "text-cyan-400", borderColor: "border-cyan-500/30", bgColor: "bg-cyan-500/10", desc: "Деловые контакты, приятели" },
    { circle: 5, name: "Периферия", max: 150, color: "text-zinc-400", borderColor: "border-zinc-600", bgColor: "bg-zinc-500/10", desc: "Все остальные контакты" },
];

import { GoldenContextEditor } from "./GoldenContextEditor";

/* ── Component ── */
export function DunbarTab() {
    const [people, setPeople] = useState<DunbarPerson[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCircle, setSelectedCircle] = useState<number | null>(null);
    const [selectedPerson, setSelectedPerson] = useState<DunbarPerson | null>(null);

    const fetchPeople = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/dunbar/list");
            if (res.ok) {
                const data = await res.json() as { people?: DunbarPerson[] };
                setPeople(data.people ?? []);
            }
        } catch {
            // Use demo data
            setPeople([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPeople();
    }, [fetchPeople]);

    const filteredPeople = people
        .filter((p) => {
            if (selectedCircle && p.circle !== selectedCircle) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return p.name.toLowerCase().includes(q) || p.relation.toLowerCase().includes(q);
            }
            return true;
        })
        .sort((a, b) => a.circle - b.circle);

    const circleStats = CIRCLE_CONFIG.map((c) => ({
        ...c,
        count: people.filter((p) => p.circle === c.circle).length,
    }));

    const daysSinceContact = (dateStr: string) => {
        const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
        if (d === 0) return "сегодня";
        if (d === 1) return "вчера";
        if (d < 7) return `${d} дн. назад`;
        if (d < 30) return `${Math.floor(d / 7)} нед. назад`;
        return `${Math.floor(d / 30)} мес. назад`;
    };

    const sentimentEmoji = (s: number) => s > 0.3 ? "😊" : s < -0.3 ? "😔" : "😐";

    return (
        <div className="space-y-5 pb-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-pink-500/15">
                        <Users className="size-5 text-pink-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-zinc-100">Круги Данбара</h2>
                        <p className="text-xs text-zinc-500">
                            {people.length} человек · Управление социальным окружением
                        </p>
                    </div>
                </div>
                <button
                    onClick={fetchPeople}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 transition hover:bg-zinc-700/50"
                >
                    <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
                    Обновить
                </button>
            </div>

            {/* Editable Golden Context (Priority Memory) */}
            <GoldenContextEditor />

            {/* Circle rings visualization */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">
                    Концентрические круги (Общая статистика)
                </h3>
                <div className="grid grid-cols-5 gap-3">
                    {circleStats.map((c) => (
                        <button
                            key={c.circle}
                            onClick={() => setSelectedCircle(selectedCircle === c.circle ? null : c.circle)}
                            className={`rounded-xl border p-3 text-center transition-all ${
                                selectedCircle === c.circle
                                    ? `${c.borderColor} ${c.bgColor} ring-1 ring-current`
                                    : "border-zinc-800 hover:border-zinc-700"
                            }`}
                        >
                            <div className="relative mx-auto mb-2 flex items-center justify-center">
                                <CircleIcon className={`size-10 ${c.color} opacity-20`} strokeWidth={1} />
                                <span className={`absolute text-lg font-bold ${c.color}`}>
                                    {c.count}
                                </span>
                            </div>
                            <p className={`text-[11px] font-bold ${c.color}`}>{c.name}</p>
                            <p className="text-[9px] text-zinc-600">{c.desc}</p>
                            <p className="mt-1 text-[8px] text-zinc-700">макс. {c.max}</p>
                        </button>
                    ))}
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Найти человека..."
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 pl-9 pr-3 text-xs text-zinc-300 outline-none focus:border-violet-500/50"
                />
            </div>

            {/* People grid */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-5 animate-spin text-zinc-500" />
                </div>
            ) : filteredPeople.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-700 py-12 text-center">
                    <Users className="mx-auto mb-3 size-10 text-zinc-700" />
                    <p className="text-sm text-zinc-500">
                        {searchQuery ? "Нет результатов" : "Нет контактов"}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-600">
                        Голосом: &quot;Запомни что Настя — моя жена&quot; → автоматическое добавление
                    </p>
                </div>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredPeople.map((person) => {
                        const circleConf = CIRCLE_CONFIG[person.circle - 1];
                        return (
                            <button
                                key={person.id}
                                onClick={() => setSelectedPerson(selectedPerson?.id === person.id ? null : person)}
                                className={`group rounded-xl border p-3 text-left transition-all hover:shadow-lg ${
                                    selectedPerson?.id === person.id
                                        ? `${circleConf.borderColor} ${circleConf.bgColor}`
                                        : "border-zinc-800 hover:border-zinc-700"
                                }`}
                            >
                                <div className="flex items-start gap-2.5">
                                    <div className={`flex size-9 items-center justify-center rounded-lg ${circleConf.bgColor}`}>
                                        <UserCircle className={`size-5 ${circleConf.color}`} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[12px] font-medium text-zinc-200">
                                            {person.name}
                                        </p>
                                        <p className="text-[10px] text-zinc-500">{person.relation}</p>
                                        <div className="mt-1 flex items-center gap-2">
                                            <span className="text-[9px] text-zinc-600">
                                                {daysSinceContact(person.lastContact)}
                                            </span>
                                            <span className="text-[10px]">{sentimentEmoji(person.sentiment)}</span>
                                        </div>
                                    </div>
                                    <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${circleConf.color} ${circleConf.bgColor}`}>
                                        {circleConf.name}
                                    </span>
                                </div>

                                {/* Expanded details */}
                                {selectedPerson?.id === person.id && (
                                    <div className="mt-3 space-y-2 border-t border-zinc-800/50 pt-2">
                                        {person.notes && (
                                            <p className="text-[10px] text-zinc-400">{person.notes}</p>
                                        )}
                                        <div className="flex flex-wrap gap-1.5">
                                            {person.channels.includes("telegram") && (
                                                <span className="flex items-center gap-0.5 text-[9px] text-blue-400">
                                                    <MessageSquare className="size-2.5" /> Telegram
                                                </span>
                                            )}
                                            {person.channels.includes("phone") && (
                                                <span className="flex items-center gap-0.5 text-[9px] text-emerald-400">
                                                    <Phone className="size-2.5" /> Телефон
                                                </span>
                                            )}
                                            {person.channels.includes("meet") && (
                                                <span className="flex items-center gap-0.5 text-[9px] text-violet-400">
                                                    <Calendar className="size-2.5" /> Встречи
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Voice commands hint */}
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                <p className="text-[10px] font-semibold text-cyan-500/70">🎙 Голосовые команды</p>
                <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-zinc-500">
                    <p>• &quot;Добавь Сашу, это мой друг&quot;</p>
                    <p>• &quot;Перенеси Олега в ближний круг&quot;</p>
                    <p>• &quot;Когда я последний раз общался с Настей?&quot;</p>
                    <p>• &quot;Кому давно не писал?&quot;</p>
                </div>
            </div>
        </div>
    );
}
