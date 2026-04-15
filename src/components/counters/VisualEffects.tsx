"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { VisualEffectId } from "@/types/animation";

interface EffectProps {
    x: number;
    y: number;
    onComplete: () => void;
}

// ── Helper: track completions ──
function useCompletionTracker(total: number, onComplete: () => void) {
    const [done, setDone] = useState(0);
    const handleDone = useCallback(() => {
        setDone((p) => { if (p + 1 >= total) onComplete(); return p + 1; });
    }, [total, onComplete]);
    return { done, handleDone };
}

// ── 1. Sparkle Burst — violet/purple sparkle particles ──
function SparkleBurst({ x, y, onComplete }: EffectProps) {
    const count = 14;
    const particles = useMemo(() =>
        Array.from({ length: count }, (_, i) => ({
            id: i,
            angle: (360 / count) * i + (Math.random() - 0.5) * 25,
            distance: 25 + Math.random() * 40,
            size: 2 + Math.random() * 4,
            delay: Math.random() * 0.06,
            hue: 260 + Math.random() * 40,
            lightness: 60 + Math.random() * 25,
        })), []);
    const { done, handleDone } = useCompletionTracker(count, onComplete);
    return (
        <AnimatePresence>
            {particles.map((p) => {
                const rad = (p.angle * Math.PI) / 180;
                const color = `hsl(${p.hue}, 80%, ${p.lightness}%)`;
                return (
                    <motion.div key={p.id}
                        initial={{ x: x - p.size / 2, y: y - p.size / 2, scale: 1.5, opacity: 1 }}
                        animate={{ x: x + Math.cos(rad) * p.distance, y: y + Math.sin(rad) * p.distance, scale: 0, opacity: 0 }}
                        transition={{ duration: 0.55, delay: p.delay, ease: "easeOut" }}
                        onAnimationComplete={done < count ? handleDone : undefined}
                        style={{ position: "fixed", width: p.size, height: p.size, borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: color, boxShadow: `0 0 8px ${color}` }}
                    />
                );
            })}
        </AnimatePresence>
    );
}

// ── 2. Golden Rain — coins tumbling down ──
function GoldenRain({ x, y, onComplete }: EffectProps) {
    const count = 10;
    const coins = useMemo(() =>
        Array.from({ length: count }, (_, i) => ({
            id: i, offsetX: (Math.random() - 0.5) * 70, fall: 35 + Math.random() * 55,
            size: 4 + Math.random() * 5, delay: i * 0.035, rotation: Math.random() * 540 - 270,
            brightness: 40 + Math.random() * 20,
        })), []);
    const { done, handleDone } = useCompletionTracker(count, onComplete);
    return (
        <AnimatePresence>
            {coins.map((p) => (
                <motion.div key={p.id}
                    initial={{ x: x + p.offsetX, y: y - 5, scale: 1, opacity: 1, rotate: 0 }}
                    animate={{ x: x + p.offsetX + (Math.random() - 0.5) * 15, y: y + p.fall, scale: 0.2, opacity: 0, rotate: p.rotation }}
                    transition={{ duration: 0.7, delay: p.delay, ease: "easeIn" }}
                    onAnimationComplete={done < count ? handleDone : undefined}
                    style={{
                        position: "fixed", width: p.size, height: p.size, borderRadius: "50%", pointerEvents: "none", zIndex: 9999,
                        background: `linear-gradient(135deg, hsl(45,100%,${p.brightness}%), hsl(35,100%,${p.brightness - 15}%))`,
                        boxShadow: "0 0 8px rgba(255,215,0,0.5)",
                    }}
                />
            ))}
        </AnimatePresence>
    );
}

// ── 3. Ring Pulse — expanding concentric rings ──
function RingPulse({ x, y, onComplete }: EffectProps) {
    const rings = [0, 0.08, 0.16, 0.24];
    return (<>{rings.map((delay, i) => (
        <motion.div key={i}
            initial={{ x: x - 12, y: y - 12, width: 24, height: 24, opacity: 0.7 }}
            animate={{ x: x - 50, y: y - 50, width: 100, height: 100, opacity: 0 }}
            transition={{ duration: 0.6, delay, ease: "easeOut" }}
            onAnimationComplete={i === rings.length - 1 ? onComplete : undefined}
            style={{ position: "fixed", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, border: `2px solid rgba(96,165,250,${0.6 - i * 0.1})`, boxShadow: `0 0 12px rgba(59,130,246,${0.3 - i * 0.05})` }}
        />
    ))}</>);
}

// ── 4. Confetti — colorful celebration pieces ──
function Confetti({ x, y, onComplete }: EffectProps) {
    const count = 20;
    const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c084fc", "#fb923c", "#f472b6", "#34d399"];
    const pieces = useMemo(() =>
        Array.from({ length: count }, (_, i) => ({
            id: i, angle: (360 / count) * i + Math.random() * 15, distance: 30 + Math.random() * 50,
            w: 3 + Math.random() * 4, h: 2 + Math.random() * 5, delay: Math.random() * 0.08,
            color: colors[i % colors.length], rotation: Math.random() * 720 - 360, gravity: 15 + Math.random() * 25,
        })), []);
    const { done, handleDone } = useCompletionTracker(count, onComplete);
    return (
        <AnimatePresence>
            {pieces.map((p) => {
                const rad = (p.angle * Math.PI) / 180;
                return (
                    <motion.div key={p.id}
                        initial={{ x, y, scale: 1, opacity: 1, rotate: 0 }}
                        animate={{ x: x + Math.cos(rad) * p.distance, y: y + Math.sin(rad) * p.distance + p.gravity, scale: 0.3, opacity: 0, rotate: p.rotation }}
                        transition={{ duration: 0.7, delay: p.delay, ease: "easeOut" }}
                        onAnimationComplete={done < count ? handleDone : undefined}
                        style={{ position: "fixed", width: p.w, height: p.h, borderRadius: "1px", pointerEvents: "none", zIndex: 9999, background: p.color }}
                    />
                );
            })}
        </AnimatePresence>
    );
}

// ── 5. Plasma Wave — purple plasma expanding ──
function PlasmaWave({ x, y, onComplete }: EffectProps) {
    return (<>
        {/* Central flash */}
        <motion.div
            initial={{ x: x - 10, y: y - 10, width: 20, height: 20, opacity: 0.9, scale: 1 }}
            animate={{ opacity: 0, scale: 3.5 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            style={{ position: "fixed", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: "radial-gradient(circle, rgba(168,85,247,0.9), rgba(124,58,237,0.3) 50%, transparent 70%)" }}
        />
        {/* Rings */}
        {[0, 0.06, 0.12, 0.18].map((delay, i) => (
            <motion.div key={i}
                initial={{ x: x - 15, y: y - 15, width: 30, height: 30, opacity: 0.5 }}
                animate={{ x: x - 55, y: y - 55, width: 110, height: 110, opacity: 0 }}
                transition={{ duration: 0.5, delay, ease: "easeOut" }}
                onAnimationComplete={i === 3 ? onComplete : undefined}
                style={{ position: "fixed", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: `radial-gradient(circle, transparent 35%, rgba(168,85,247,${0.3 - i * 0.06}) 65%, transparent 100%)` }}
            />
        ))}
    </>);
}

// ── 6. Star Shower — shooting star trails ──
function StarShower({ x, y, onComplete }: EffectProps) {
    const count = 8;
    const stars = useMemo(() =>
        Array.from({ length: count }, (_, i) => ({
            id: i, angle: -30 + Math.random() * 60 - 90, // mostly upward
            distance: 40 + Math.random() * 60, size: 3 + Math.random() * 3,
            delay: i * 0.05, tailLen: 15 + Math.random() * 20,
        })), []);
    const { done, handleDone } = useCompletionTracker(count, onComplete);
    return (
        <AnimatePresence>
            {stars.map((s) => {
                const rad = (s.angle * Math.PI) / 180;
                const dx = Math.cos(rad) * s.distance;
                const dy = Math.sin(rad) * s.distance;
                return (
                    <motion.div key={s.id}
                        initial={{ x: x, y: y, opacity: 1, scale: 1 }}
                        animate={{ x: x + dx, y: y + dy, opacity: 0, scale: 0.3 }}
                        transition={{ duration: 0.5, delay: s.delay, ease: "easeOut" }}
                        onAnimationComplete={done < count ? handleDone : undefined}
                        style={{
                            position: "fixed", pointerEvents: "none", zIndex: 9999,
                            width: s.size, height: s.size, borderRadius: "50%",
                            background: "linear-gradient(135deg, #fef08a, #fde047)",
                            boxShadow: `0 0 6px #fde047, ${-dx * 0.3}px ${-dy * 0.3}px ${s.tailLen}px rgba(253,224,71,0.3)`,
                        }}
                    />
                );
            })}
        </AnimatePresence>
    );
}

// ── 7. Fire Burst — fiery ember explosion ──
function FireBurst({ x, y, onComplete }: EffectProps) {
    const count = 16;
    const embers = useMemo(() =>
        Array.from({ length: count }, (_, i) => ({
            id: i, angle: (360 / count) * i + (Math.random() - 0.5) * 20,
            distance: 20 + Math.random() * 45, size: 2 + Math.random() * 4,
            delay: Math.random() * 0.06, hue: Math.random() * 40, // 0=red to 40=orange
            rise: -10 - Math.random() * 20, // embers float up
        })), []);
    const { done, handleDone } = useCompletionTracker(count, onComplete);
    return (
        <AnimatePresence>
            {/* Central flash */}
            <motion.div
                initial={{ x: x - 12, y: y - 12, width: 24, height: 24, opacity: 0.8 }}
                animate={{ scale: 2.5, opacity: 0 }}
                transition={{ duration: 0.3 }}
                style={{ position: "fixed", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: "radial-gradient(circle, rgba(249,115,22,0.8), transparent 70%)" }}
            />
            {embers.map((e) => {
                const rad = (e.angle * Math.PI) / 180;
                const color = `hsl(${e.hue}, 100%, 55%)`;
                return (
                    <motion.div key={e.id}
                        initial={{ x, y, scale: 1.2, opacity: 1 }}
                        animate={{ x: x + Math.cos(rad) * e.distance, y: y + Math.sin(rad) * e.distance + e.rise, scale: 0, opacity: 0 }}
                        transition={{ duration: 0.6, delay: e.delay, ease: "easeOut" }}
                        onAnimationComplete={done < count ? handleDone : undefined}
                        style={{ position: "fixed", width: e.size, height: e.size, borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: color, boxShadow: `0 0 6px ${color}` }}
                    />
                );
            })}
        </AnimatePresence>
    );
}

// ── 8. Diamond Cascade — crystal shards radiating ──
function DiamondCascade({ x, y, onComplete }: EffectProps) {
    const count = 12;
    const shards = useMemo(() =>
        Array.from({ length: count }, (_, i) => ({
            id: i, angle: (360 / count) * i + (Math.random() - 0.5) * 20,
            distance: 25 + Math.random() * 40, w: 4 + Math.random() * 4, h: 6 + Math.random() * 6,
            delay: Math.random() * 0.07, rotation: Math.random() * 180 - 90,
            lightness: 70 + Math.random() * 20,
        })), []);
    const { done, handleDone } = useCompletionTracker(count, onComplete);
    return (
        <AnimatePresence>
            {shards.map((s) => {
                const rad = (s.angle * Math.PI) / 180;
                const color = `hsl(190, 90%, ${s.lightness}%)`;
                return (
                    <motion.div key={s.id}
                        initial={{ x, y, scale: 1, opacity: 1, rotate: 0 }}
                        animate={{ x: x + Math.cos(rad) * s.distance, y: y + Math.sin(rad) * s.distance, scale: 0.2, opacity: 0, rotate: s.rotation }}
                        transition={{ duration: 0.55, delay: s.delay, ease: "easeOut" }}
                        onAnimationComplete={done < count ? handleDone : undefined}
                        style={{
                            position: "fixed", pointerEvents: "none", zIndex: 9999,
                            width: s.w, height: s.h,
                            background: `linear-gradient(135deg, ${color}, hsl(195, 100%, 85%))`,
                            clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", // diamond shape
                            boxShadow: `0 0 8px ${color}`,
                        }}
                    />
                );
            })}
        </AnimatePresence>
    );
}

// ── 9. Neon Flash — neon strobe with afterglow ──
function NeonFlash({ x, y, onComplete }: EffectProps) {
    return (<>
        {/* Bright strobe flash */}
        {[0, 0.08, 0.16].map((delay, i) => (
            <motion.div key={`flash-${i}`}
                initial={{ x: x - 20, y: y - 20, width: 40, height: 40, opacity: 0.8 }}
                animate={{ opacity: 0, scale: i === 0 ? 3 : 2 }}
                transition={{ duration: 0.25, delay }}
                style={{ position: "fixed", borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: `radial-gradient(circle, rgba(52,211,153,${0.8 - i * 0.2}), transparent 60%)` }}
            />
        ))}
        {/* Neon line bursts */}
        {Array.from({ length: 8 }, (_, i) => {
            const angle = (360 / 8) * i;
            const rad = (angle * Math.PI) / 180;
            return (
                <motion.div key={`line-${i}`}
                    initial={{ x: x, y: y, opacity: 0.9, width: 2, height: 2 }}
                    animate={{ x: x + Math.cos(rad) * 50, y: y + Math.sin(rad) * 50, opacity: 0, width: 3, height: 20 }}
                    transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
                    onAnimationComplete={i === 7 ? onComplete : undefined}
                    style={{
                        position: "fixed", pointerEvents: "none", zIndex: 9999, borderRadius: "2px",
                        background: "#34d399", boxShadow: "0 0 8px #34d399",
                        transform: `rotate(${angle}deg)`, transformOrigin: "center",
                    }}
                />
            );
        })}
    </>);
}

// ── 10. Aurora — aurora borealis ribbon waves ──
function Aurora({ x, y, onComplete }: EffectProps) {
    const ribbons = useMemo(() => [
        { color: "rgba(192,132,252,0.5)", offsetY: -20, width: 80, delay: 0 },
        { color: "rgba(129,140,248,0.4)", offsetY: -5, width: 90, delay: 0.06 },
        { color: "rgba(56,189,248,0.4)", offsetY: 10, width: 70, delay: 0.12 },
        { color: "rgba(52,211,153,0.3)", offsetY: 20, width: 60, delay: 0.18 },
    ], []);
    return (<>
        {ribbons.map((r, i) => (
            <motion.div key={i}
                initial={{ x: x - r.width / 2, y: y + r.offsetY, width: r.width, height: 6, opacity: 0, scaleX: 0.3 }}
                animate={{ opacity: [0, 0.8, 0.6, 0], scaleX: [0.3, 1.2, 1.5, 2], scaleY: [1, 1.5, 0.5, 0.2] }}
                transition={{ duration: 0.8, delay: r.delay, ease: "easeOut", times: [0, 0.3, 0.6, 1] }}
                onAnimationComplete={i === ribbons.length - 1 ? onComplete : undefined}
                style={{
                    position: "fixed", pointerEvents: "none", zIndex: 9999,
                    borderRadius: "20px",
                    background: r.color,
                    boxShadow: `0 0 20px ${r.color}`,
                    filter: "blur(2px)",
                }}
            />
        ))}
        {/* Sparkle dots */}
        {Array.from({ length: 6 }, (_, i) => (
            <motion.div key={`dot-${i}`}
                initial={{ x: x + (Math.random() - 0.5) * 60, y: y + (Math.random() - 0.5) * 40, opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 0], scale: [0, 1, 0] }}
                transition={{ duration: 0.5, delay: 0.1 + Math.random() * 0.3 }}
                style={{ position: "fixed", width: 3, height: 3, borderRadius: "50%", pointerEvents: "none", zIndex: 9999, background: "#c4b5fd", boxShadow: "0 0 6px #c4b5fd" }}
            />
        ))}
    </>);
}

// ── None ──
function NoEffect({ onComplete }: EffectProps) {
    onComplete();
    return null;
}

// ── Render by ID ──
const EFFECT_MAP: Record<VisualEffectId, React.ComponentType<EffectProps>> = {
    sparkle_burst:   SparkleBurst,
    golden_rain:     GoldenRain,
    ring_pulse:      RingPulse,
    confetti:        Confetti,
    plasma_wave:     PlasmaWave,
    star_shower:     StarShower,
    fire_burst:      FireBurst,
    diamond_cascade: DiamondCascade,
    neon_flash:      NeonFlash,
    aurora:          Aurora,
    none:            NoEffect,
};

export function VisualEffect({ effectId, ...props }: EffectProps & { effectId: VisualEffectId }) {
    const Component = EFFECT_MAP[effectId] ?? SparkleBurst;
    return <Component {...props} />;
}
