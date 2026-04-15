"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Check, Edit3, Bell, User, CalendarDays,
  AlertTriangle, MessageSquare, ListTodo, Heart
} from "lucide-react";
import { useNotificationStore, type OffloadAction } from "@/stores/notificationStore";

/**
 * DailyOffloadOverlay — Glassmorphism panel that slides out
 * when user clicks the notification bell. Shows pending actions
 * from OpenClaw agent for human approval.
 */

const TYPE_CONFIG: Record<OffloadAction["type"], {
  icon: React.ElementType;
  color: string;
  label: string;
}> = {
  reminder: { icon: Bell, color: "text-amber-400", label: "Напоминание" },
  message_draft: { icon: MessageSquare, color: "text-blue-400", label: "Черновик" },
  task_followup: { icon: ListTodo, color: "text-emerald-400", label: "Фоллоу-ап" },
  birthday: { icon: CalendarDays, color: "text-pink-400", label: "День рождения" },
  health_alert: { icon: Heart, color: "text-red-400", label: "Health Alert" },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/5",
  high: "border-amber-500/30 bg-amber-500/5",
  medium: "border-zinc-700/50 bg-zinc-800/30",
  low: "border-zinc-800/50 bg-zinc-900/30",
};

function ActionCard({
  action,
  index,
  onApprove,
  onDismiss,
}: {
  action: OffloadAction;
  index: number;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const config = TYPE_CONFIG[action.type] || TYPE_CONFIG.reminder;
  const Icon = config.icon;
  const priorityClass = PRIORITY_COLORS[action.priority] || PRIORITY_COLORS.medium;

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.9, filter: "blur(4px)" }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 300, damping: 30 }}
      className={`rounded-xl border p-3.5 ${priorityClass} transition-all hover:scale-[1.01]`}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className={`mt-0.5 ${config.color}`}>
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
              {config.label}
            </span>
            {action.priority === "critical" && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                <AlertTriangle className="size-2.5" />
                СРОЧНО
              </span>
            )}
          </div>
          <h4 className="text-sm font-medium text-zinc-100 mt-0.5 leading-tight">
            {action.title}
          </h4>
        </div>
      </div>

      {/* Person badge */}
      {action.person_name && (
        <div className="flex items-center gap-1.5 mb-2 text-xs text-zinc-400">
          <User className="size-3" />
          <span>{action.person_name}</span>
        </div>
      )}

      {/* Body */}
      {action.body && (
        <p className="text-xs text-zinc-500 mb-3 line-clamp-2 leading-relaxed">
          {action.body}
        </p>
      )}

      {/* Trigger reason */}
      {action.trigger_reason && (
        <p className="text-[10px] text-zinc-600 mb-3 italic">
          💡 {action.trigger_reason}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 text-xs font-medium transition-all hover:bg-emerald-500/25 hover:scale-[1.02] active:scale-95"
        >
          <Check className="size-3.5" />
          Approve
        </button>
        <button
          onClick={onDismiss}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-400 text-xs font-medium transition-all hover:bg-zinc-700/50 hover:text-zinc-300 hover:scale-[1.02] active:scale-95"
        >
          <Edit3 className="size-3.5" />
          Edit
        </button>
      </div>
    </motion.div>
  );
}

export default function DailyOffloadOverlay() {
  const offloadOpen = useNotificationStore((s) => s.offloadOpen);
  const offloadActions = useNotificationStore((s) => s.offloadActions);
  const offloadLoading = useNotificationStore((s) => s.offloadLoading);
  const setOffloadOpen = useNotificationStore((s) => s.setOffloadOpen);
  const loadOffloadActions = useNotificationStore((s) => s.loadOffloadActions);
  const resolveOffloadAction = useNotificationStore((s) => s.resolveOffloadAction);

  useEffect(() => {
    if (offloadOpen) {
      loadOffloadActions();
    }
  }, [offloadOpen, loadOffloadActions]);

  const handleApprove = useCallback(
    (id: number) => resolveOffloadAction(id, "approved"),
    [resolveOffloadAction]
  );

  const handleDismiss = useCallback(
    (id: number) => resolveOffloadAction(id, "dismissed"),
    [resolveOffloadAction]
  );

  return (
    <AnimatePresence>
      {offloadOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setOffloadOpen(false)}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col overflow-hidden border-l border-white/10 bg-zinc-950/95 backdrop-blur-2xl shadow-2xl"
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <span className="text-lg">📋</span>
                  Daily Offload
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Действия, предложенные OpenClaw
                </p>
              </div>
              <button
                onClick={() => setOffloadOpen(false)}
                className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Action cards */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {offloadLoading ? (
                <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
                  <div className="animate-spin size-5 border-2 border-zinc-600 border-t-violet-400 rounded-full" />
                </div>
              ) : offloadActions.length > 0 ? (
                <AnimatePresence mode="popLayout">
                  {offloadActions.map((action, i) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      index={i}
                      onApprove={() => handleApprove(action.id)}
                      onDismiss={() => handleDismiss(action.id)}
                    />
                  ))}
                </AnimatePresence>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center h-48 text-center"
                >
                  <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 mb-3">
                    <Check className="size-8 text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium text-zinc-300">Всё чисто 🎉</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Нет ожидающих действий. Agent спит.
                  </p>
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-white/5 px-5 py-3 flex items-center justify-between text-[10px] text-zinc-600">
              <span>OpenClaw v3.0 • Shadow Mode</span>
              <span>{offloadActions.length} ожидает</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
