"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Bell, X, Trash2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/stores/notificationStore";
import type { NotificationLevel, AppNotification } from "@/types/notification";

const LEVEL_STYLES: Record<NotificationLevel, string> = {
    error: "border-l-red-500 bg-red-500/10",
    warning: "border-l-amber-500 bg-amber-500/10",
    info: "border-l-violet-500 bg-violet-500/10",
};

const LEVEL_DOT: Record<NotificationLevel, string> = {
    error: "bg-red-400",
    warning: "bg-amber-400",
    info: "bg-violet-400",
};

type TabType = "all" | "whats_new";

function NotificationItem({
    n,
    onRemove,
}: {
    n: AppNotification;
    onRemove: () => void;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className={`group flex items-start gap-2 border-l-2 px-3 py-2.5 ${LEVEL_STYLES[n.level]} ${n.read ? "opacity-60" : "opacity-100"}`}
        >
            <span
                className={`mt-1.5 size-1.5 shrink-0 rounded-full ${LEVEL_DOT[n.level]}`}
            />
            <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug text-zinc-300">
                    {n.message}
                </p>
                <span className="mt-0.5 block text-[10px] text-zinc-600">
                    {new Date(n.timestamp).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </span>
            </div>
            <button
                className="mt-0.5 shrink-0 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-300 group-hover:opacity-100"
                onClick={onRemove}
                aria-label="Удалить"
            >
                <X className="size-3" />
            </button>
        </motion.div>
    );
}

export function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<TabType>("all");
    const panelRef = useRef<HTMLDivElement>(null);

    const notifications = useNotificationStore((s) => s.notifications);
    const unreadCount = useNotificationStore((s) => s.unreadCount);
    const markAllRead = useNotificationStore((s) => s.markAllRead);
    const clearAll = useNotificationStore((s) => s.clearAll);
    const removeNotification = useNotificationStore(
        (s) => s.removeNotification,
    );

    const whatsNewItems = useMemo(
        () => notifications.filter((n) => n.category === "whats_new"),
        [notifications],
    );
    const systemItems = useMemo(
        () => notifications.filter((n) => n.category !== "whats_new"),
        [notifications],
    );

    const visibleItems = tab === "whats_new" ? whatsNewItems : notifications;

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const handleToggle = () => {
        setOpen((prev) => {
            if (!prev) markAllRead();
            return !prev;
        });
    };

    return (
        <div className="relative" ref={panelRef}>
            {/* Bell button */}
            <Button
                variant="ghost"
                size="icon-sm"
                className="relative text-zinc-400 hover:text-zinc-200"
                aria-label="Уведомления"
                onClick={handleToggle}
            >
                <Bell className="size-5" />
                {/* Unread badge */}
                <AnimatePresence>
                    {unreadCount > 0 && (
                        <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white"
                        >
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </motion.span>
                    )}
                </AnimatePresence>
            </Button>

            {/* Dropdown panel */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                            <span className="text-sm font-semibold text-zinc-200">
                                Уведомления
                            </span>
                            {notifications.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-6 text-zinc-500 hover:text-zinc-300"
                                    onClick={clearAll}
                                    aria-label="Очистить все"
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            )}
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-zinc-800/50">
                            <button
                                type="button"
                                onClick={() => setTab("all")}
                                className={`flex-1 py-1.5 text-center text-[11px] font-medium transition-colors ${
                                    tab === "all"
                                        ? "border-b-2 border-violet-500 text-violet-400"
                                        : "text-zinc-500 hover:text-zinc-300"
                                }`}
                            >
                                Все ({notifications.length})
                            </button>
                            <button
                                type="button"
                                onClick={() => setTab("whats_new")}
                                className={`flex flex-1 items-center justify-center gap-1 py-1.5 text-center text-[11px] font-medium transition-colors ${
                                    tab === "whats_new"
                                        ? "border-b-2 border-emerald-500 text-emerald-400"
                                        : "text-zinc-500 hover:text-zinc-300"
                                }`}
                            >
                                <Sparkles className="size-3" />
                                Что нового ({whatsNewItems.length})
                            </button>
                        </div>

                        {/* List */}
                        <div className="max-h-72 overflow-y-auto scrollbar-none">
                            {visibleItems.length === 0 ? (
                                <div className="px-3 py-6 text-center text-xs text-zinc-500">
                                    {tab === "whats_new"
                                        ? "Нет новых фишек — пока 😊"
                                        : "Нет уведомлений"}
                                </div>
                            ) : (
                                visibleItems.map((n) => (
                                    <NotificationItem
                                        key={n.id}
                                        n={n}
                                        onRemove={() =>
                                            removeNotification(n.id)
                                        }
                                    />
                                ))
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
