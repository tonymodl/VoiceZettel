"use client";

import { useState, useEffect, useCallback } from "react";
import {
    UserPlus,
    Trash2,
    Shield,
    User,
    Mail,
    Clock,
    RefreshCw,
    Loader2,
    Crown,
} from "lucide-react";

interface AllowedUser {
    email: string;
    role: "admin" | "user";
    name: string | null;
    created_at: string;
    last_login: string | null;
}

export function UsersTab() {
    const [users, setUsers] = useState<AllowedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState<"user" | "admin">("user");
    const [adding, setAdding] = useState(false);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/users");
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: "Ошибка" }));
                throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
            }
            const data = await res.json() as { users: AllowedUser[] };
            setUsers(data.users || []);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleAdd = useCallback(async () => {
        if (!newEmail.trim()) return;
        setAdding(true);
        setError(null);
        try {
            const res = await fetch("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: "Ошибка" }));
                throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
            }
            setNewEmail("");
            await fetchUsers();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setAdding(false);
        }
    }, [newEmail, newRole, fetchUsers]);

    const handleDelete = useCallback(async (email: string) => {
        if (!confirm(`Удалить пользователя ${email}? Он больше не сможет войти.`)) return;
        setError(null);
        try {
            const res = await fetch("/api/users", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: "Ошибка" }));
                throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
            }
            await fetchUsers();
        } catch (e) {
            setError((e as Error).message);
        }
    }, [fetchUsers]);

    const admins = users.filter((u) => u.role === "admin");
    const regularUsers = users.filter((u) => u.role === "user");

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-200">
                    <Shield className="size-5 text-violet-400" />
                    Управление пользователями
                </h2>
                <button
                    type="button"
                    onClick={fetchUsers}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                    <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
                    Обновить
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                    ⚠️ {error}
                </div>
            )}

            {/* Add user form */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
                    <UserPlus className="size-4 text-emerald-400" />
                    Добавить пользователя
                </h3>
                <div className="flex flex-wrap gap-2">
                    <div className="relative flex-1">
                        <Mail className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                        <input
                            type="email"
                            placeholder="email@example.com"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 py-2.5 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
                        />
                    </div>
                    <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
                        className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-300 focus:border-violet-500 focus:outline-none"
                    >
                        <option value="user">👤 Пользователь</option>
                        <option value="admin">👑 Админ</option>
                    </select>
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={!newEmail.trim() || adding}
                        className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 disabled:opacity-50"
                    >
                        {adding ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <UserPlus className="size-4" />
                        )}
                        Добавить
                    </button>
                </div>
                <p className="mt-2 text-[11px] text-zinc-600">
                    Добавленный email сможет войти через Google OAuth. У каждого пользователя своё хранилище настроек.
                </p>
            </div>

            {/* Users list */}
            {loading && users.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Загрузка...
                </div>
            ) : (
                <div className="space-y-3">
                    {/* Admins */}
                    {admins.length > 0 && (
                        <div>
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400/80">
                                <Crown className="size-3" /> Администраторы ({admins.length})
                            </h4>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {admins.map((u) => (
                                    <UserCard key={u.email} user={u} onDelete={handleDelete} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Regular users */}
                    {regularUsers.length > 0 && (
                        <div>
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                <User className="size-3" /> Пользователи ({regularUsers.length})
                            </h4>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {regularUsers.map((u) => (
                                    <UserCard key={u.email} user={u} onDelete={handleDelete} />
                                ))}
                            </div>
                        </div>
                    )}

                    {users.length === 0 && (
                        <div className="py-8 text-center text-sm text-zinc-500">
                            Нет пользователей. Добавьте первого!
                        </div>
                    )}
                </div>
            )}

            {/* Info card */}
            <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-4 text-xs text-zinc-600">
                <p className="mb-1 font-medium text-zinc-500">ℹ️ Как работает</p>
                <ul className="ml-4 list-disc space-y-0.5">
                    <li>Только email из этого списка могут войти через Google OAuth</li>
                    <li>У каждого пользователя свои настройки и счётчики в SQLite (userId = email)</li>
                    <li>Админы имеют доступ к этой панели и управлению пользователями</li>
                    <li>Неавторизованные email получат ошибку при попытке входа</li>
                </ul>
            </div>
        </div>
    );
}

function UserCard({
    user,
    onDelete,
}: {
    user: AllowedUser;
    onDelete: (email: string) => void;
}) {
    const isAdmin = user.role === "admin";

    return (
        <div className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${
            isAdmin
                ? "border-amber-500/20 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
        }`}>
            {/* Avatar */}
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                isAdmin ? "bg-amber-500/15 text-amber-400" : "bg-zinc-800 text-zinc-500"
            }`}>
                {isAdmin ? <Crown className="size-4" /> : <User className="size-4" />}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-zinc-200">
                        {user.name || user.email.split("@")[0]}
                    </span>
                    <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                        isAdmin
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-zinc-800 text-zinc-500"
                    }`}>
                        {user.role}
                    </span>
                </div>
                <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                    <span className="flex items-center gap-0.5">
                        <Clock className="size-2.5" />
                        {new Date(user.created_at).toLocaleDateString("ru-RU")}
                    </span>
                    {user.last_login && (
                        <span>вход: {new Date(user.last_login).toLocaleDateString("ru-RU")}</span>
                    )}
                </div>
            </div>

            {/* Delete button */}
            <button
                type="button"
                onClick={() => onDelete(user.email)}
                className="shrink-0 rounded-lg p-1.5 text-zinc-600 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                title="Удалить пользователя"
            >
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}
