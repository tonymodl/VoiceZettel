/**
 * Premium Sound Effects Library — 10 rich, multi-layered procedural sounds.
 * All generated via Web Audio API with proper harmonic layering, reverb simulation,
 * and careful frequency tuning. No external files needed.
 */

import type { SoundEffectId } from "@/types/animation";

let audioCtx: AudioContext | null = null;
let isUnlocked = false;

function ctx(): AudioContext | null {
    if (!audioCtx) {
        try { audioCtx = new AudioContext(); } catch { return null; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
}

/** Must be called from a user gesture to unlock iOS audio */
export function warmUpAudio(): void {
    if (isUnlocked) return;
    const c = ctx();
    if (!c) return;
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
    isUnlocked = true;
}

// ── Helpers ──

/** Create a simple convolution-style reverb tail */
function makeReverb(c: AudioContext, duration = 1.5, decay = 2): ConvolverNode {
    const len = c.sampleRate * duration;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
    }
    const conv = c.createConvolver();
    conv.buffer = buf;
    return conv;
}

/** Route source through reverb + dry mix */
function withReverb(c: AudioContext, source: AudioNode, wetGain = 0.15): AudioNode {
    const dry = c.createGain();
    const wet = c.createGain();
    const reverb = makeReverb(c, 1.0, 2.5);
    dry.gain.value = 1;
    wet.gain.value = wetGain;
    source.connect(dry).connect(c.destination);
    source.connect(reverb).connect(wet).connect(c.destination);
    return dry;
}

function tone(c: AudioContext, freq: number, type: OscillatorType, vol: number, start: number, dur: number, freqEnd?: number): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.01);
}

// ── Sound generators (10 premium effects) ──────────────────

/** 1. Crystal Chime — layered crystal harmonic resonance with shimmer */
function playCrystalChime(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    // Fundamental + 3 harmonics with staggered attacks for shimmer
    const harmonics = [
        { f: 2093, vol: 0.08, delay: 0,    dur: 0.5  },  // C7
        { f: 2637, vol: 0.06, delay: 0.02, dur: 0.45 },  // E7
        { f: 3136, vol: 0.05, delay: 0.04, dur: 0.4  },  // G7
        { f: 4186, vol: 0.03, delay: 0.06, dur: 0.35 },  // C8
    ];
    const mix = c.createGain();
    mix.gain.value = 1;
    harmonics.forEach(({ f, vol, delay, dur }) => {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, t + delay);
        // Subtle vibrato for shimmer
        const lfo = c.createOscillator();
        const lfoG = c.createGain();
        lfo.frequency.value = 6;
        lfoG.gain.value = f * 0.003;
        lfo.connect(lfoG).connect(osc.frequency);
        lfo.start(t + delay);
        lfo.stop(t + delay + dur);

        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(vol, t + delay + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
        osc.connect(g).connect(mix);
        osc.start(t + delay);
        osc.stop(t + delay + dur + 0.01);
    });
    withReverb(c, mix, 0.2);
}

/** 2. Coin Cascade — multiple coin clinks with metallic resonance */
function playCoinCascade(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // 4 coins with slight delays
    [0, 0.06, 0.13, 0.22].forEach((delay, i) => {
        const baseF = 3000 + i * 400;
        // Metallic click (noise-like via detuned square)
        const click = c.createOscillator();
        const cg = c.createGain();
        click.type = "square";
        click.frequency.setValueAtTime(baseF, t + delay);
        click.frequency.exponentialRampToValueAtTime(baseF * 0.3, t + delay + 0.04);
        cg.gain.setValueAtTime(0.06, t + delay);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.08);
        click.connect(cg).connect(mix);
        click.start(t + delay);
        click.stop(t + delay + 0.08);

        // Resonant ring
        const ring = c.createOscillator();
        const rg = c.createGain();
        ring.type = "sine";
        ring.frequency.setValueAtTime(1800 + i * 200, t + delay + 0.01);
        rg.gain.setValueAtTime(0.04, t + delay + 0.01);
        rg.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.25);
        ring.connect(rg).connect(mix);
        ring.start(t + delay + 0.01);
        ring.stop(t + delay + 0.25);
    });
    withReverb(c, mix, 0.12);
}

/** 3. Level Up — ascending major arpeggio with rich harmonics */
function playLevelUp(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
    const mix = c.createGain();
    mix.gain.value = 1;

    notes.forEach((freq, i) => {
        const st = t + i * 0.07;
        // Main tone
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, st);
        g.gain.setValueAtTime(0, st);
        g.gain.linearRampToValueAtTime(0.08, st + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.3);
        osc.connect(g).connect(mix);
        osc.start(st);
        osc.stop(st + 0.3);

        // Octave shimmer
        const osc2 = c.createOscillator();
        const g2 = c.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(freq * 2, st);
        g2.gain.setValueAtTime(0.03, st + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.0001, st + 0.2);
        osc2.connect(g2).connect(mix);
        osc2.start(st);
        osc2.stop(st + 0.2);
    });
    withReverb(c, mix, 0.18);
}

/** 4. Zen Bowl — singing bowl with rich beating overtones */
function playZenBowl(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Singing bowl partials (slightly detuned for beating)
    const partials = [
        { f: 395, vol: 0.06, dur: 1.8 },
        { f: 397, vol: 0.05, dur: 1.6 },   // beating pair
        { f: 790, vol: 0.03, dur: 1.2 },
        { f: 1185, vol: 0.02, dur: 0.9 },
        { f: 1580, vol: 0.01, dur: 0.7 },
    ];

    partials.forEach(({ f, vol, dur }) => {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.05);
        g.gain.setValueAtTime(vol * 0.8, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(mix);
        osc.start(t);
        osc.stop(t + dur + 0.01);
    });

    // Strike transient
    const noise = c.createOscillator();
    const ng = c.createGain();
    noise.type = "sawtooth";
    noise.frequency.setValueAtTime(800, t);
    noise.frequency.exponentialRampToValueAtTime(200, t + 0.03);
    ng.gain.setValueAtTime(0.04, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    noise.connect(ng).connect(mix);
    noise.start(t);
    noise.stop(t + 0.06);

    withReverb(c, mix, 0.25);
}

/** 5. Achievement — triumphant brass-like chord with swell */
function playAchievement(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Power chord: C4 E4 G4 C5
    const chord = [261.63, 329.63, 392, 523.25];
    chord.forEach((f) => {
        // Brass-like (triangle + sawtooth mix)
        ["triangle", "sawtooth"].forEach((type, ti) => {
            const osc = c.createOscillator();
            const g = c.createGain();
            osc.type = type as OscillatorType;
            osc.frequency.setValueAtTime(f * 0.5, t);
            osc.frequency.linearRampToValueAtTime(f, t + 0.08);
            const vol = ti === 0 ? 0.05 : 0.02;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(vol, t + 0.1);
            g.gain.setValueAtTime(vol * 0.7, t + 0.2);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
            osc.connect(g).connect(mix);
            osc.start(t);
            osc.stop(t + 0.6);
        });
    });

    // High sparkle accent
    tone(c, 2093, "sine", 0.04, t + 0.12, 0.3, 1568);
    withReverb(c, mix, 0.2);
}

/** 6. Harp Gliss — descending harp glissando */
function playHarpGliss(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Pentatonic scale descending: C6 A5 G5 E5 D5 C5
    const notes = [1046.5, 880, 783.99, 659.25, 587.33, 523.25];
    notes.forEach((freq, i) => {
        const st = t + i * 0.06;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, st);
        // Sharp pluck attack
        g.gain.setValueAtTime(0.1, st);
        g.gain.exponentialRampToValueAtTime(0.04, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.35);
        osc.connect(g).connect(mix);
        osc.start(st);
        osc.stop(st + 0.35);

        // 2nd harmonic for richness
        const h2 = c.createOscillator();
        const hg = c.createGain();
        h2.type = "sine";
        h2.frequency.setValueAtTime(freq * 2, st);
        hg.gain.setValueAtTime(0.03, st);
        hg.gain.exponentialRampToValueAtTime(0.0001, st + 0.2);
        h2.connect(hg).connect(mix);
        h2.start(st);
        h2.stop(st + 0.2);
    });
    withReverb(c, mix, 0.2);
}

/** 7. Magic Wand — sparkly whoosh with rising tones */
function playMagicWand(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Whoosh (filtered noise via detuned oscillators)
    for (let i = 0; i < 6; i++) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        const startF = 800 + Math.random() * 2000;
        osc.frequency.setValueAtTime(startF, t);
        osc.frequency.exponentialRampToValueAtTime(startF * 3, t + 0.15);
        osc.frequency.exponentialRampToValueAtTime(startF * 0.5, t + 0.4);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.015, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(g).connect(mix);
        osc.start(t);
        osc.stop(t + 0.4);
    }

    // Sparkle pings
    [0.05, 0.1, 0.18, 0.25].forEach((delay) => {
        const freq = 2500 + Math.random() * 2000;
        tone(c, freq, "sine", 0.04, t + delay, 0.15, freq * 0.6);
    });
    withReverb(c, mix, 0.15);
}

/** 8. Cash Register — kaching with bell */
function playCashRegister(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Mechanical click
    const click = c.createOscillator();
    const cg = c.createGain();
    click.type = "square";
    click.frequency.setValueAtTime(4000, t);
    click.frequency.exponentialRampToValueAtTime(200, t + 0.02);
    cg.gain.setValueAtTime(0.06, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    click.connect(cg).connect(mix);
    click.start(t);
    click.stop(t + 0.05);

    // Bell ding (two octaves)
    [1568, 3136].forEach((f, i) => {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, t + 0.03);
        g.gain.setValueAtTime(i === 0 ? 0.07 : 0.04, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(g).connect(mix);
        osc.start(t + 0.03);
        osc.stop(t + 0.5);
    });

    // Slide accent
    const sl = c.createOscillator();
    const sg = c.createGain();
    sl.type = "triangle";
    sl.frequency.setValueAtTime(800, t + 0.05);
    sl.frequency.exponentialRampToValueAtTime(2000, t + 0.1);
    sg.gain.setValueAtTime(0.03, t + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    sl.connect(sg).connect(mix);
    sl.start(t + 0.05);
    sl.stop(t + 0.2);

    withReverb(c, mix, 0.1);
}

/** 9. Power Up — modernized 8-bit ascending sweep */
function playPowerUp(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Rising sweep
    const sweep = c.createOscillator();
    const sg = c.createGain();
    sweep.type = "square";
    sweep.frequency.setValueAtTime(200, t);
    sweep.frequency.exponentialRampToValueAtTime(1200, t + 0.2);
    sweep.frequency.exponentialRampToValueAtTime(800, t + 0.3);
    sg.gain.setValueAtTime(0.04, t);
    sg.gain.setValueAtTime(0.04, t + 0.2);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    sweep.connect(sg).connect(mix);
    sweep.start(t);
    sweep.stop(t + 0.35);

    // Soften with sine layer
    const sine = c.createOscillator();
    const sineg = c.createGain();
    sine.type = "sine";
    sine.frequency.setValueAtTime(400, t);
    sine.frequency.exponentialRampToValueAtTime(2400, t + 0.2);
    sine.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    sineg.gain.setValueAtTime(0.05, t);
    sineg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    sine.connect(sineg).connect(mix);
    sine.start(t);
    sine.stop(t + 0.4);

    // Burst accent at peak
    tone(c, 1600, "triangle", 0.05, t + 0.2, 0.15);
    withReverb(c, mix, 0.1);
}

/** 10. Celestial — ethereal pad swell with choir-like tones */
function playCelestial(): void {
    const c = ctx(); if (!c) return;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.value = 1;

    // Choir-like tones (detuned pairs for width)
    const voices = [
        { f: 440, f2: 442, dur: 1.0 },   // A4
        { f: 554, f2: 555.5, dur: 0.9 },  // C#5
        { f: 659, f2: 661, dur: 0.8 },    // E5
    ];

    voices.forEach(({ f, f2, dur }) => {
        [f, f2].forEach((freq) => {
            const osc = c.createOscillator();
            const g = c.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, t);
            // Slow swell in, slow fade
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.04, t + 0.2);
            g.gain.setValueAtTime(0.035, t + dur * 0.5);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

            // Subtle vibrato
            const lfo = c.createOscillator();
            const lg = c.createGain();
            lfo.frequency.value = 4.5;
            lg.gain.value = freq * 0.004;
            lfo.connect(lg).connect(osc.frequency);
            lfo.start(t);
            lfo.stop(t + dur);

            osc.connect(g).connect(mix);
            osc.start(t);
            osc.stop(t + dur + 0.01);
        });
    });

    // Sparkle accent
    [0.15, 0.25].forEach((d) => {
        tone(c, 2637 + Math.random() * 500, "sine", 0.02, t + d, 0.2);
    });
    withReverb(c, mix, 0.3);
}

// ── Public API ──────────────────────────────────────────────

const SOUND_PLAYERS: Record<SoundEffectId, () => void> = {
    crystal_chime:  playCrystalChime,
    coin_cascade:   playCoinCascade,
    level_up:       playLevelUp,
    zen_bowl:       playZenBowl,
    achievement:    playAchievement,
    harp_gliss:     playHarpGliss,
    magic_wand:     playMagicWand,
    cash_register:  playCashRegister,
    power_up:       playPowerUp,
    celestial:      playCelestial,
    none:           () => {},
};

/** Play a named sound effect */
export function playSound(id: SoundEffectId): void {
    if (id === "none") return;
    try {
        SOUND_PLAYERS[id]();
    } catch {
        // not available
    }
}

/** Legacy compat */
export function playCounterDing(): void {
    playSound("crystal_chime");
}
