import { z } from "zod";

/** All possible counter types: built-in + dynamic custom widgets */
export const BuiltinCounterSchema = z.enum(["ideas", "facts", "persons", "tasks"]);
export type BuiltinCounterType = z.infer<typeof BuiltinCounterSchema>;

/** CounterType is now a string to support custom widget IDs (e.g. "cw_1713200000000") */
export type CounterType = BuiltinCounterType | (string & {});

export function isBuiltinCounter(type: string): type is BuiltinCounterType {
    return BuiltinCounterSchema.safeParse(type).success;
}

export interface FlyingAnimation {
    id: string;
    counterType: CounterType;
}

// ── Visual Effects Library (10 + none) ──────────────────────

export type VisualEffectId =
    | "sparkle_burst"     // radial sparkle particles
    | "golden_rain"       // falling gold coins
    | "ring_pulse"        // expanding ring waves
    | "confetti"          // colorful confetti pieces
    | "plasma_wave"       // purple plasma ripple
    | "star_shower"       // shooting stars cascade
    | "fire_burst"        // fiery ember explosion
    | "diamond_cascade"   // diamond/crystal shards
    | "neon_flash"        // neon strobe + afterglow
    | "aurora"            // aurora borealis ribbons
    | "none";

export type SoundEffectId =
    | "crystal_chime"     // layered crystal resonance
    | "coin_cascade"      // multiple coins + reverb
    | "level_up"          // ascending arpeggio fanfare
    | "zen_bowl"          // singing bowl overtones
    | "achievement"       // triumphant chord swell
    | "harp_gliss"        // harp glissando sweep
    | "magic_wand"        // magical sparkle whoosh
    | "cash_register"     // kaching register ding
    | "power_up"          // 8-bit power-up modernized
    | "celestial"         // ethereal pad swell
    | "none";

// ── Trail Styles (matched to visual effects) ──

export type TrailStyle = "sparkle" | "gold" | "ring" | "confetti" | "plasma"
    | "star" | "fire" | "diamond" | "neon" | "aurora" | "default";

export const VISUAL_TO_TRAIL: Record<VisualEffectId, TrailStyle> = {
    sparkle_burst:   "sparkle",
    golden_rain:     "gold",
    ring_pulse:      "ring",
    confetti:        "confetti",
    plasma_wave:     "plasma",
    star_shower:     "star",
    fire_burst:      "fire",
    diamond_cascade: "diamond",
    neon_flash:      "neon",
    aurora:          "aurora",
    none:            "default",
};

export const TRAIL_COLORS: Record<TrailStyle, string[]> = {
    sparkle:  ["#c4b5fd", "#a78bfa", "#8b5cf6"],
    gold:     ["#ffd700", "#ffaa00", "#ff8800"],
    ring:     ["#60a5fa", "#3b82f6", "#2563eb"],
    confetti: ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff"],
    plasma:   ["#a855f7", "#7c3aed", "#6d28d9"],
    star:     ["#fef08a", "#fde047", "#facc15"],
    fire:     ["#f97316", "#ef4444", "#dc2626"],
    diamond:  ["#67e8f9", "#22d3ee", "#06b6d4"],
    neon:     ["#34d399", "#10b981", "#059669"],
    aurora:   ["#c084fc", "#818cf8", "#38bdf8"],
    default:  ["#a78bfa", "#8b5cf6", "#7c3aed"],
};

// ── Effect presets ──────────────────────────────────────────

export interface EffectPreset {
    id: string;
    nameRu: string;
    visual: VisualEffectId;
    sound: SoundEffectId;
}

export const EFFECT_PRESETS: EffectPreset[] = [
    { id: "crystal",     nameRu: "✨ Кристалл",       visual: "sparkle_burst",   sound: "crystal_chime" },
    { id: "casino",      nameRu: "🎰 Казино",         visual: "golden_rain",     sound: "coin_cascade" },
    { id: "gamer",       nameRu: "🎮 Геймерский",     visual: "confetti",        sound: "level_up" },
    { id: "zen",         nameRu: "🧘 Дзен",            visual: "ring_pulse",      sound: "zen_bowl" },
    { id: "epic",        nameRu: "🏆 Достижение",     visual: "plasma_wave",     sound: "achievement" },
    { id: "magic",       nameRu: "🪄 Магия",           visual: "star_shower",     sound: "magic_wand" },
    { id: "fire",        nameRu: "🔥 Огонь",           visual: "fire_burst",      sound: "power_up" },
    { id: "luxury",      nameRu: "💎 Люкс",            visual: "diamond_cascade", sound: "harp_gliss" },
    { id: "cyber",       nameRu: "🌐 Кибер",           visual: "neon_flash",      sound: "cash_register" },
    { id: "cosmic",      nameRu: "🌌 Космос",          visual: "aurora",          sound: "celestial" },
    { id: "silent",      nameRu: "🔇 Тишина",          visual: "none",            sound: "none" },
];

export const VISUAL_EFFECT_LABELS: Record<VisualEffectId, string> = {
    sparkle_burst:   "✨ Искры",
    golden_rain:     "🪙 Золотой дождь",
    ring_pulse:      "🔵 Пульс кольца",
    confetti:        "🎊 Конфетти",
    plasma_wave:     "🟣 Плазма",
    star_shower:     "⭐ Звёздный дождь",
    fire_burst:      "🔥 Огненный взрыв",
    diamond_cascade: "💎 Алмазный каскад",
    neon_flash:      "💚 Неоновая вспышка",
    aurora:          "🌌 Северное сияние",
    none:            "Нет",
};

export const SOUND_EFFECT_LABELS: Record<SoundEffectId, string> = {
    crystal_chime:  "🔔 Кристалл",
    coin_cascade:   "🪙 Монеты",
    level_up:       "⬆️ Левел-ап",
    zen_bowl:       "🔔 Тибетская чаша",
    achievement:    "🏆 Триумф",
    harp_gliss:     "🎵 Арфа",
    magic_wand:     "🪄 Магия",
    cash_register:  "💰 Кассовый аппарат",
    power_up:       "⚡ Энергия",
    celestial:      "🌌 Небесный",
    none:            "Нет",
};

/** Per-widget effect configuration (stored in settings) */
export interface WidgetEffectConfig {
    widgetId: string;
    visualEffect: VisualEffectId;
    soundEffect: SoundEffectId;
}
