"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, AlertTriangle, Zap } from "lucide-react";
import { useAntigravityStore } from "@/stores/antigravityStore";
import { playVoiceNotification } from "@/lib/notifications";

/**
 * Compact progress indicator for Antigravity agent tasks.
 * Shows in the top bar when the agent is working on something.
 */
export function AntigravityProgress() {
    const status = useAntigravityStore((s) => s.status);
    const currentTask = useAntigravityStore((s) => s.currentTask);
    const progress = useAntigravityStore((s) => s.progress);
    const [visible, setVisible] = useState(false);

    // Show/hide logic with auto-dismiss for "done"
    useEffect(() => {
        if (status === "idle") {
            setVisible(false);
            return;
        }

        setVisible(true);

        if (status === "done") {
            const timer = setTimeout(() => {
                setVisible(false);
                useAntigravityStore.getState().reset();
            }, 4000);
            return () => clearTimeout(timer);
        }

        if (status === "error") {
            const timer = setTimeout(() => {
                setVisible(false);
                useAntigravityStore.getState().reset();
            }, 6000);
            return () => clearTimeout(timer);
        }
    }, [status]);

    // Voice notification on task completion
    const prevStatus = useRef(status);
    useEffect(() => {
        if (prevStatus.current === "working" && status === "done") {
            const taskName = useAntigravityStore.getState().lastCompletedTask;
            void playVoiceNotification(taskName ? `Задача готова: ${taskName}` : "Задача готова");
        }
        prevStatus.current = status;
    }, [status]);

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ type: "spring", damping: 20, stiffness: 300 }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border backdrop-blur-sm"
                    style={{
                        background:
                            status === "done"
                                ? "rgba(16, 185, 129, 0.08)"
                                : status === "error"
                                ? "rgba(239, 68, 68, 0.08)"
                                : "rgba(139, 92, 246, 0.08)",
                        borderColor:
                            status === "done"
                                ? "rgba(16, 185, 129, 0.2)"
                                : status === "error"
                                ? "rgba(239, 68, 68, 0.2)"
                                : "rgba(139, 92, 246, 0.2)",
                    }}
                >
                    {/* Icon */}
                    {status === "working" && (
                        <div className="relative">
                            <Zap className="size-3.5 text-violet-400" />
                            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-violet-400 animate-ping" />
                        </div>
                    )}
                    {status === "done" && <CheckCircle2 className="size-3.5 text-emerald-400" />}
                    {status === "error" && <AlertTriangle className="size-3.5 text-red-400" />}

                    {/* Task name */}
                    <span
                        className="text-[11px] font-medium max-w-[180px] truncate"
                        style={{
                            color:
                                status === "done"
                                    ? "rgb(110, 231, 183)"
                                    : status === "error"
                                    ? "rgb(252, 165, 165)"
                                    : "rgb(196, 181, 253)",
                        }}
                    >
                        {status === "done"
                            ? "✓ Готово"
                            : status === "error"
                            ? "Ошибка"
                            : currentTask || "Антигравити работает..."}
                    </span>

                    {/* Progress bar (only when working) */}
                    {status === "working" && (
                        <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            {progress > 0 ? (
                                <motion.div
                                    className="h-full rounded-full"
                                    style={{
                                        background: "linear-gradient(90deg, #8b5cf6, #a78bfa)",
                                    }}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ duration: 0.3, ease: "easeOut" }}
                                />
                            ) : (
                                /* Indeterminate shimmer */
                                <motion.div
                                    className="h-full w-8 rounded-full"
                                    style={{
                                        background: "linear-gradient(90deg, transparent, #8b5cf6, transparent)",
                                    }}
                                    animate={{ x: ["-100%", "300%"] }}
                                    transition={{
                                        duration: 1.5,
                                        repeat: Infinity,
                                        ease: "easeInOut",
                                    }}
                                />
                            )}
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
