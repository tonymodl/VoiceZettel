import { create } from "zustand";
import type { CounterType, FlyingAnimation } from "@/types/animation";

interface AnimationState {
    pendingAnimations: FlyingAnimation[];
    /** Track which widgets are currently "glowing" after receiving an effect */
    glowingWidgets: Set<string>;
}

interface AnimationActions {
    triggerAnimation: (counterType: CounterType) => void;
    removeAnimation: (id: string) => void;
    addGlow: (widgetId: string) => void;
    removeGlow: (widgetId: string) => void;
}

export const useAnimationStore = create<AnimationState & AnimationActions>()(
    (set) => ({
        pendingAnimations: [],
        glowingWidgets: new Set(),

        triggerAnimation: (counterType) =>
            set((state) => ({
                pendingAnimations: [
                    ...state.pendingAnimations,
                    { id: crypto.randomUUID(), counterType },
                ],
            })),

        removeAnimation: (id) =>
            set((state) => ({
                pendingAnimations: state.pendingAnimations.filter(
                    (a) => a.id !== id,
                ),
            })),

        addGlow: (widgetId) =>
            set((state) => {
                const next = new Set(state.glowingWidgets);
                next.add(widgetId);
                return { glowingWidgets: next };
            }),

        removeGlow: (widgetId) =>
            set((state) => {
                const next = new Set(state.glowingWidgets);
                next.delete(widgetId);
                return { glowingWidgets: next };
            }),
    }),
);
