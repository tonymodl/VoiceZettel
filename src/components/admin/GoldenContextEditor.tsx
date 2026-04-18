"use client";

import { useState, useEffect, useCallback } from "react";
import { Edit3, Save, X, Users, Loader2 } from "lucide-react";
import { GoldenPerson } from "@/lib/goldenContext";

export function GoldenContextEditor() {
    const [people, setPeople] = useState<GoldenPerson[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/golden-context?userId=anonymous");
            if (res.ok) {
                const data = await res.json();
                if (data.people) {
                    setPeople(data.people);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleEditClick = () => {
        setEditValue(JSON.stringify(people, null, 4));
        setIsEditing(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const parsed = JSON.parse(editValue);
            const res = await fetch("/api/golden-context", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: "anonymous", people: parsed }),
            });
            if (res.ok) {
                setPeople(parsed);
                setIsEditing(false);
            } else {
                alert("Ошибка сохранения Золотого Контекста");
            }
        } catch (e) {
            alert("Невалидный JSON: " + String(e));
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
                <Loader2 className="size-5 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-pink-500/20 bg-gradient-to-b from-pink-500/5 to-transparent p-5">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-pink-500/20">
                        <Users className="size-5 text-pink-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-zinc-200">Ближний круг (Golden Context)</h3>
                        <p className="text-xs text-zinc-500">
                            Всегда присутствует в памяти ИИ • {people.length} персон
                        </p>
                    </div>
                </div>
                {!isEditing && (
                    <button
                        onClick={handleEditClick}
                        className="flex items-center gap-1.5 rounded-xl border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
                    >
                        <Edit3 className="size-3.5" />
                        Редактировать
                    </button>
                )}
            </div>

            {isEditing ? (
                <div className="space-y-4">
                    <p className="text-[11px] text-amber-500">
                        Внимание: вы редактируете JSON-массив сырых данных, которые встраиваются в промпт. Не сломайте синтаксис!
                    </p>
                    <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-96 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 font-mono text-[11px] text-zinc-300 outline-none focus:border-pink-500/50"
                        spellCheck={false}
                    />
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-pink-500 disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                            Сохранить и применить
                        </button>
                        <button
                            onClick={() => setIsEditing(false)}
                            disabled={isSaving}
                            className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
                        >
                            <X className="size-3.5" />
                            Отмена
                        </button>
                    </div>
                </div>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {people.map((p, i) => (
                        <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                            <p className="text-[12px] font-bold text-zinc-200">{p.name}</p>
                            <p className="text-[10px] text-pink-400">{p.relation}</p>
                            {p.notes && <p className="mt-1 text-[10px] text-zinc-500 line-clamp-2">{p.notes}</p>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
