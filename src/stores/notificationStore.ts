import { create } from "zustand";
import type {
    AppNotification,
    NotificationLevel,
    NotificationCategory,
} from "@/types/notification";

// ── Offload Action (Phase 4: Daily Offload Dashboard) ────
export interface OffloadAction {
    id: number;
    type: "reminder" | "message_draft" | "task_followup" | "birthday" | "health_alert";
    person_name: string | null;
    person_id: number | null;
    title: string;
    body: string;
    priority: "low" | "medium" | "high" | "critical";
    status: "pending" | "approved" | "dismissed" | "executed";
    trigger_reason: string;
    created_at: string;
}

interface NotificationState {
    notifications: AppNotification[];
    unreadCount: number;
    offloadActions: OffloadAction[];
    offloadOpen: boolean;
    offloadLoading: boolean;
}

interface NotificationActions {
    addNotification: (message: string, level: NotificationLevel, category?: NotificationCategory) => void;
    markAllRead: () => void;
    clearAll: () => void;
    removeNotification: (id: string) => void;
    // Offload actions
    setOffloadOpen: (open: boolean) => void;
    loadOffloadActions: () => Promise<void>;
    resolveOffloadAction: (actionId: number, status: "approved" | "dismissed") => Promise<void>;
}

export const useNotificationStore = create<
    NotificationState & NotificationActions
>()((set, get) => ({
    notifications: [],
    unreadCount: 0,
    offloadActions: [],
    offloadOpen: false,
    offloadLoading: false,

    addNotification: (message, level, category) =>
        set((state) => {
            const notification: AppNotification = {
                id: crypto.randomUUID(),
                message,
                level,
                timestamp: new Date().toISOString(),
                read: false,
                category,
            };
            return {
                notifications: [notification, ...state.notifications].slice(
                    0,
                    50,
                ),
                unreadCount: state.unreadCount + 1,
            };
        }),

    markAllRead: () =>
        set((state) => ({
            notifications: state.notifications.map((n) => ({
                ...n,
                read: true,
            })),
            unreadCount: 0,
        })),

    clearAll: () => set({ notifications: [], unreadCount: 0 }),

    removeNotification: (id) =>
        set((state) => {
            const target = state.notifications.find((n) => n.id === id);
            return {
                notifications: state.notifications.filter(
                    (n) => n.id !== id,
                ),
                unreadCount:
                    target && !target.read
                        ? state.unreadCount - 1
                        : state.unreadCount,
            };
        }),

    // ── Offload Dashboard Actions ────────────────────────
    setOffloadOpen: (open) => set({ offloadOpen: open }),

    loadOffloadActions: async () => {
        set({ offloadLoading: true });
        try {
            const res = await fetch("/api/crm?view=actions");
            const data = await res.json();
            if (data.status === "ok" && data.data) {
                set({ offloadActions: data.data, offloadLoading: false });
            } else {
                set({ offloadActions: [], offloadLoading: false });
            }
        } catch {
            set({ offloadActions: [], offloadLoading: false });
        }
    },

    resolveOffloadAction: async (actionId, status) => {
        try {
            await fetch(`/api/crm/actions/${actionId}/resolve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
        } catch { /* non-critical */ }

        // Optimistic UI update — remove from list
        set((state) => ({
            offloadActions: state.offloadActions.filter((a) => a.id !== actionId),
        }));
    },
}));
