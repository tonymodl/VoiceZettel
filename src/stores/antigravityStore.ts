import { create } from "zustand";

export type AntigravityStatus = "idle" | "working" | "done" | "error";

interface AntigravityState {
    /** Current task being worked on */
    currentTask: string | null;
    /** Progress 0-100 */
    progress: number;
    /** Current status */
    status: AntigravityStatus;
    /** Last completed task */
    lastCompletedTask: string | null;
    /** Timestamp of last status change */
    lastUpdated: number;
}

interface AntigravityActions {
    /** Start working on a task */
    startTask: (taskName: string) => void;
    /** Update progress (0-100) */
    setProgress: (progress: number) => void;
    /** Mark current task as done */
    completeTask: () => void;
    /** Mark current task as failed */
    failTask: (error?: string) => void;
    /** Reset to idle */
    reset: () => void;
}

export const useAntigravityStore = create<AntigravityState & AntigravityActions>()(
    (set) => ({
        currentTask: null,
        progress: 0,
        status: "idle",
        lastCompletedTask: null,
        lastUpdated: Date.now(),

        startTask: (taskName: string) =>
            set({
                currentTask: taskName,
                progress: 0,
                status: "working",
                lastUpdated: Date.now(),
            }),

        setProgress: (progress: number) =>
            set({ progress: Math.min(100, Math.max(0, progress)), lastUpdated: Date.now() }),

        completeTask: () =>
            set((s) => ({
                status: "done",
                progress: 100,
                lastCompletedTask: s.currentTask,
                lastUpdated: Date.now(),
            })),

        failTask: (_error?: string) =>
            set({
                status: "error",
                lastUpdated: Date.now(),
            }),

        reset: () =>
            set({
                currentTask: null,
                progress: 0,
                status: "idle",
                lastUpdated: Date.now(),
            }),
    })
);
