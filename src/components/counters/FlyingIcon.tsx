"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Lightbulb, Heart, Users, ListChecks, Tag } from "lucide-react";
import type { CounterType, BuiltinCounterType, TrailStyle } from "@/types/animation";
import { isBuiltinCounter, VISUAL_TO_TRAIL, TRAIL_COLORS } from "@/types/animation";
import { useAnimationStore } from "@/stores/animationStore";
import { useCountersStore } from "@/stores/countersStore";
import { useSettingsStore, getWidgetEffect } from "@/stores/settingsStore";
import { playSound } from "@/lib/sounds";
import { VisualEffect } from "./VisualEffects";

const BUILTIN_ICON_MAP: Record<BuiltinCounterType, React.ElementType> = {
    ideas: Lightbulb,
    facts: Heart,
    persons: Users,
    tasks: ListChecks,
};

const BUILTIN_INCREMENT_MAP: Record<BuiltinCounterType, string> = {
    ideas: "incrementIdeas",
    facts: "incrementFacts",
    persons: "incrementPersons",
    tasks: "incrementTasks",
};

function computeOrbCenter() {
    const orbEl = document.querySelector("[data-orb-center]");
    if (orbEl) {
        const rect = orbEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function computeCounterCenter(counterType: CounterType) {
    const badgeEl = document.querySelector(`[data-counter-type="${counterType}"]`);
    if (badgeEl) {
        const rect = badgeEl.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: 0, y: 0 };
}

// ── Trail particle component ──
interface TrailParticle {
    id: number;
    x: number;
    y: number;
    color: string;
    size: number;
}

function TrailRenderer({ particles, trailStyle }: { particles: TrailParticle[]; trailStyle: TrailStyle }) {
    return (
        <>
            {particles.map((p) => (
                <motion.div
                    key={p.id}
                    initial={{ opacity: 0.8, scale: 1 }}
                    animate={{ opacity: 0, scale: 0.2 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    style={{
                        position: "fixed",
                        left: p.x - p.size / 2,
                        top: p.y - p.size / 2,
                        width: p.size,
                        height: p.size,
                        borderRadius: trailStyle === "diamond" ? "0" : "50%",
                        pointerEvents: "none",
                        zIndex: 9998,
                        background: p.color,
                        boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
                        transform: trailStyle === "diamond" ? "rotate(45deg)" : undefined,
                    }}
                />
            ))}
        </>
    );
}

// ── Flying icon instance ──
function FlyingIconInstance({ id, counterType }: { id: string; counterType: CounterType }) {
    const removeAnimation = useAnimationStore((s) => s.removeAnimation);
    const addGlow = useAnimationStore((s) => s.addGlow);
    const removeGlow = useAnimationStore((s) => s.removeGlow);
    const [phase, setPhase] = useState<"flying" | "burst" | "done">("flying");
    const hasTriggered = useRef(false);
    const trailIdRef = useRef(0);
    const [trailParticles, setTrailParticles] = useState<TrailParticle[]>([]);
    const posRef = useRef({ x: 0, y: 0 });
    const flyRef = useRef<HTMLDivElement>(null);

    const Icon = isBuiltinCounter(counterType) ? BUILTIN_ICON_MAP[counterType] : Tag;
    const effectConfig = getWidgetEffect(counterType);
    const trailStyle = VISUAL_TO_TRAIL[effectConfig.visualEffect] ?? "default";
    const trailColors = TRAIL_COLORS[trailStyle];

    const [startPos] = useState(computeOrbCenter);
    const [targetPos] = useState(() => computeCounterCenter(counterType));

    // Emit trail particles during flight
    useEffect(() => {
        if (phase !== "flying") return;
        const interval = setInterval(() => {
            const el = flyRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            posRef.current = { x: cx, y: cy };

            const newParticle: TrailParticle = {
                id: trailIdRef.current++,
                x: cx + (Math.random() - 0.5) * 8,
                y: cy + (Math.random() - 0.5) * 8,
                color: trailColors[Math.floor(Math.random() * trailColors.length)],
                size: 2 + Math.random() * 3,
            };
            setTrailParticles((prev) => [...prev.slice(-20), newParticle]);
        }, 35);
        return () => clearInterval(interval);
    }, [phase, trailColors]);

    // Clean up trail after flight
    useEffect(() => {
        if (phase === "burst" || phase === "done") {
            const timer = setTimeout(() => setTrailParticles([]), 500);
            return () => clearTimeout(timer);
        }
    }, [phase]);

    const handleFlyComplete = useCallback(() => {
        if (hasTriggered.current) return;
        hasTriggered.current = true;

        playSound(effectConfig.soundEffect);

        if (isBuiltinCounter(counterType)) {
            const action = BUILTIN_INCREMENT_MAP[counterType] as keyof ReturnType<typeof useCountersStore.getState>;
            const fn = useCountersStore.getState()[action];
            if (typeof fn === "function") (fn as () => void)();
        } else {
            useSettingsStore.getState().incrementCustomWidget(counterType);
        }

        addGlow(counterType);
        setTimeout(() => removeGlow(counterType), 1200);
        setPhase("burst");
    }, [counterType, effectConfig.soundEffect, addGlow, removeGlow]);

    const handleBurstComplete = useCallback(() => {
        setPhase("done");
        removeAnimation(id);
    }, [id, removeAnimation]);

    if (phase === "done") return null;

    // Glowing trail color for the flying orb itself
    const orbGlow = trailColors[0];

    if (phase === "burst") {
        return (
            <>
                <TrailRenderer particles={trailParticles} trailStyle={trailStyle} />
                <VisualEffect
                    effectId={effectConfig.visualEffect}
                    x={targetPos.x}
                    y={targetPos.y}
                    onComplete={handleBurstComplete}
                />
            </>
        );
    }

    const midX = (startPos.x + targetPos.x) / 2;
    const midY = Math.min(startPos.y, targetPos.y) - 60;

    return (
        <>
            <TrailRenderer particles={trailParticles} trailStyle={trailStyle} />
            <motion.div
                ref={flyRef}
                initial={{
                    x: startPos.x - 12,
                    y: startPos.y - 12,
                    scale: 1.2,
                    opacity: 0.9,
                }}
                animate={{
                    x: [startPos.x - 12, midX - 12, targetPos.x - 12],
                    y: [startPos.y - 12, midY - 12, targetPos.y - 12],
                    scale: [1.2, 1, 0.6],
                    opacity: [0.9, 1, 1],
                }}
                transition={{
                    duration: 0.6,
                    ease: "easeInOut",
                    times: [0, 0.5, 1],
                }}
                onAnimationComplete={handleFlyComplete}
                style={{
                    position: "fixed",
                    pointerEvents: "none",
                    zIndex: 9999,
                }}
            >
                <div
                    className="flex items-center justify-center rounded-full p-1.5"
                    style={{
                        background: `${orbGlow}33`,
                        boxShadow: `0 0 16px ${orbGlow}88, 0 0 32px ${orbGlow}44`,
                    }}
                >
                    <Icon className="size-4" style={{ color: orbGlow }} />
                </div>
            </motion.div>
        </>
    );
}

export function AnimationOverlay() {
    const pendingAnimations = useAnimationStore((s) => s.pendingAnimations);
    if (pendingAnimations.length === 0) return null;
    return (
        <>
            {pendingAnimations.map((anim) => (
                <FlyingIconInstance key={anim.id} id={anim.id} counterType={anim.counterType} />
            ))}
        </>
    );
}
