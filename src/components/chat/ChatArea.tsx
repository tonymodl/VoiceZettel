"use client";

import { useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useEdgeTTS } from "@/hooks/useElevenLabsTTS";
import type { Message } from "@/types/chat";

function bubbleClasses(role: Message["role"]): string {
    if (role === "user") {
        return "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-[#7F22FE] px-4 py-2.5 text-sm text-white";
    }
    if (role === "assistant") {
        return "mr-auto max-w-[80%] rounded-2xl rounded-bl-sm bg-[#BA38BE] px-4 py-2.5 text-sm text-zinc-100";
    }
    return "mx-auto max-w-[80%] rounded-xl bg-zinc-900 px-3 py-1.5 text-center text-xs text-zinc-500";
}

/** Map counter type → emoji + label + color */
const COUNTER_BADGE_MAP: Record<string, { emoji: string; label: string; bg: string; text: string }> = {
    tasks: { emoji: "📋", label: "Задача", bg: "rgba(236, 72, 153, 0.15)", text: "rgb(244, 114, 182)" },
    ideas: { emoji: "💡", label: "Идея", bg: "rgba(168, 85, 247, 0.15)", text: "rgb(192, 132, 252)" },
    facts: { emoji: "📊", label: "Факт", bg: "rgba(59, 130, 246, 0.15)", text: "rgb(96, 165, 250)" },
    persons: { emoji: "👤", label: "Персона", bg: "rgba(34, 197, 94, 0.15)", text: "rgb(74, 222, 128)" },
};

/** Render message content with [COUNTER:*] badges */
function renderContent(content: string) {
    const TAG_REGEX = /\[COUNTER:(\w+)\]/gi;
    const parts: Array<string | { type: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TAG_REGEX.exec(content)) !== null) {
        if (match.index > lastIndex) {
            parts.push(content.slice(lastIndex, match.index));
        }
        parts.push({ type: match[1].toLowerCase() });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex));
    }

    // If no tags found, return plain text
    if (parts.length === 1 && typeof parts[0] === "string") {
        return <p className="whitespace-pre-wrap break-words">{content}</p>;
    }

    return (
        <p className="whitespace-pre-wrap break-words">
            {parts.map((part, i) => {
                if (typeof part === "string") return <span key={i}>{part}</span>;

                const badge = COUNTER_BADGE_MAP[part.type];
                if (!badge) return null;

                return (
                    <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ml-1 align-baseline"
                        style={{ background: badge.bg, color: badge.text }}
                    >
                        {badge.emoji} {badge.label}
                    </span>
                );
            })}
        </p>
    );
}

function MessageBubble({ message }: { message: Message }) {
    const hasAttachment = message.role === "user" && message.content.includes("\ud83d\udcce");
    return (
        <div className={bubbleClasses(message.role)}>
            {message.role === "assistant" ? renderContent(message.content) : (
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
            {hasAttachment && (
                <span className="mt-1.5 flex items-center gap-1 text-[10px] text-violet-300/70">
                    <svg className="size-3" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 00-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/></svg>
                    Файл отправлен на анализ ИИ
                </span>
            )}
            {message.metadata?.rewardType && (
                <span className="mt-1 block text-[10px] uppercase tracking-widest text-violet-300/60">
                    {message.metadata.rewardType}
                </span>
            )}
        </div>
    );
}

function LiveTranscriptBubble() {
    const liveTranscript = useChatStore((s) => s.liveTranscript);
    const orbState = useChatStore((s) => s.orbState);

    // Показываем если: слушаем ИЛИ есть текст транскрипции (не скрываем при speaking)
    if (orbState !== "listening" && !liveTranscript) return null;

    return (
        <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-[#7F22FE]/40 px-4 py-2.5 text-sm text-white/70 backdrop-blur-sm">
            <p className="whitespace-pre-wrap break-words">
                {liveTranscript || (
                    <span className="animate-pulse text-white/40">🎙 Слушаю…</span>
                )}
            </p>
        </div>
    );
}

export function ChatArea() {
    const messages = useChatStore((s) => s.messages);
    const orbState = useChatStore((s) => s.orbState);
    const liveTranscript = useChatStore((s) => s.liveTranscript);
    const bottomRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const spokenIdRef = useRef<string | null>(null);

    // TTS
    const { speak } = useEdgeTTS();
    const aiVoiceEnabled = useSettingsStore((s) => s.aiVoiceEnabled);
    const ttsProvider = useSettingsStore((s) => s.ttsProvider);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, liveTranscript]);

    // Auto-speak completed assistant messages via ElevenLabs
    useEffect(() => {
        if (orbState !== "idle") return;
        if (!aiVoiceEnabled || ttsProvider !== "edge") return;

        const lastMsg = messages[messages.length - 1];
        if (
            lastMsg &&
            lastMsg.role === "assistant" &&
            lastMsg.source === "text" &&
            lastMsg.id !== "seed-1" &&
            lastMsg.id !== spokenIdRef.current
        ) {
            spokenIdRef.current = lastMsg.id;
            void speak(lastMsg.content);
        }
    }, [orbState, messages, aiVoiceEnabled, ttsProvider, speak]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onScroll = () => {
            el.classList.add("is-scrolling");
            clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => {
                el.classList.remove("is-scrolling");
            }, 1500);
        };

        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            clearTimeout(scrollTimer.current);
        };
    }, []);

    if (messages.length === 0) {
        return (
            <div className="flex flex-1 flex-col items-center overflow-y-auto py-6">
                <p className="mt-auto text-sm text-zinc-600">
                    No messages yet
                </p>
            </div>
        );
    }

    return (
        <div className="relative flex flex-1 flex-col min-h-0">
            {/* Gradient fade at top — messages disappear behind orb */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-40 bg-gradient-to-b from-zinc-950 via-zinc-950/50 to-transparent" />

            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto py-6 pr-5 chat-scrollbar">
                {/* Spacer pushes messages to bottom when few */}
                <div className="flex-1" />
                {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                ))}
                <LiveTranscriptBubble />
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
