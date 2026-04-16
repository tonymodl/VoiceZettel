"use client";

import { useEffect, useCallback } from "react";
import { Lightbulb, Heart, Users, ListChecks, Tag, Wallet } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCountersStore } from "@/stores/countersStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useNotesStore } from "@/stores/notesStore";
import type { NoteCategory } from "@/types/notes";

/** Map badge keys to NoteCategory for filtering */
const BADGE_TO_CATEGORY: Record<string, NoteCategory> = {
    ideas: "idea",
    facts: "fact",
    persons: "persona",
    tasks: "task",
};

interface BadgeConfig {
    key: string;
    label: string;
    icon: React.ElementType;
    getValue: () => number;
    showFlag: boolean;
    filterCategory?: NoteCategory;
}

function CounterBadge({
    icon: Icon,
    value,
    label,
    badgeKey,
    onClick,
}: {
    icon: React.ElementType;
    value: number;
    label: string;
    badgeKey: string;
    onClick?: () => void;
}) {
    const isGlowing = useAnimationStore((s) => s.glowingWidgets.has(badgeKey));

    return (
        <motion.div
            layout
            data-counter-type={badgeKey}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
                opacity: 1,
                scale: isGlowing ? [1, 1.15, 1] : 1,
            }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{
                duration: isGlowing ? 0.4 : 0.2,
                ...(isGlowing ? { times: [0, 0.3, 1] } : {}),
            }}
            className="flex cursor-pointer flex-col items-center gap-0.5"
            onClick={onClick}
            role="button"
            tabIndex={0}
        >
            {/* Pill: icon + number */}
            <div
                className="flex h-7 items-center gap-1 rounded-full px-2.5 transition-all duration-500"
                style={{
                    background: isGlowing
                        ? "rgba(139, 92, 246, 0.3)"
                        : "rgba(39, 39, 42, 0.8)",
                    boxShadow: isGlowing
                        ? "0 0 16px rgba(139, 92, 246, 0.5), 0 0 32px rgba(139, 92, 246, 0.2)"
                        : "none",
                }}
            >
                <Icon
                    className="size-3 transition-colors duration-300"
                    style={{ color: isGlowing ? "#c4b5fd" : "#a78bfa" }}
                />
                <motion.span
                    key={value}
                    initial={isGlowing ? { scale: 1.4, color: "#c4b5fd" } : false}
                    animate={{ scale: 1, color: "#f4f4f5" }}
                    transition={{ duration: 0.3, type: "spring", stiffness: 400 }}
                    className="text-xs font-semibold leading-none"
                >
                    {value}
                </motion.span>
            </div>
            {/* Label below */}
            <span className="text-xs leading-none text-zinc-500">
                {label}
            </span>
        </motion.div>
    );
}

function TokenDisplay({
    usd,
    rub,
    balance,
    showUsd,
    showRub,
    showBalance,
}: {
    usd: number;
    rub: number;
    balance: number;
    showUsd: boolean;
    showRub: boolean;
    showBalance: boolean;
}) {
    if (!showUsd && !showRub && !showBalance) return null;

    const parts: string[] = [];
    if (showUsd) parts.push(`$ ${usd.toFixed(4)}`);
    if (showRub) parts.push(`₽ ${rub.toFixed(2)}`);
    if (showBalance) parts.push(`${balance} ток`);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-end gap-0.5"
        >
            <div className="flex h-7 items-center rounded-full bg-zinc-800/80 px-2.5">
                <span className="text-xs font-medium leading-none text-zinc-300">
                    {parts.join(" / ")}
                </span>
            </div>
            <span className="text-xs leading-none text-zinc-500">
                Потрачено
            </span>
        </motion.div>
    );
}

function OpenAIBalanceDisplay({
    balanceUsd,
    balanceRub,
    error,
}: {
    balanceUsd: number;
    balanceRub: number;
    error: string | null;
}) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-end gap-0.5"
        >
            <div className={`flex h-7 items-center gap-1 rounded-full px-2.5 ${
                error
                    ? "bg-amber-500/10"
                    : balanceUsd > 1
                        ? "bg-emerald-500/10"
                        : "bg-red-500/10"
            }`}>
                <Wallet className={`size-3 ${
                    error
                        ? "text-amber-400"
                        : balanceUsd > 1
                            ? "text-emerald-400"
                            : "text-red-400"
                }`} />
                <span className={`text-xs font-semibold leading-none ${
                    error
                        ? "text-amber-300"
                        : balanceUsd > 1
                            ? "text-emerald-300"
                            : "text-red-300"
                }`}>
                    {error
                        ? "—"
                        : `$${balanceUsd.toFixed(2)} / ₽${balanceRub.toFixed(0)}`
                    }
                </span>
            </div>
            <span className="text-xs leading-none text-zinc-500">
                {error ? "Баланс N/A" : "Баланс OpenAI"}
            </span>
        </motion.div>
    );
}

export function TopCountersBar() {
    const {
        ideas, facts, persons, tasks,
        tokensUsd, tokensRub, tokensBalance,
        openaiBalanceUsd, openaiBalanceRub, openaiBalanceError,
        loadOpenAIBalance,
    } = useCountersStore();
    const {
        showIdeasCounter,
        showFactsCounter,
        showPersonsCounter,
        showTasksCounter,
        showUsdTokens,
        showRubTokens,
        showTokenBalance,
        showOpenAIBalance,
        customWidgets,
    } = useSettingsStore();

    useEffect(() => {
        if (!showOpenAIBalance) return;
        void loadOpenAIBalance();
        const interval = setInterval(() => {
            void loadOpenAIBalance();
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [showOpenAIBalance, loadOpenAIBalance]);

    const setFilter = useNotesStore((s) => s.setFilter);

    const handleBadgeClick = useCallback((badgeKey: string) => {
        // Set the filter in notes store
        const category = BADGE_TO_CATEGORY[badgeKey] ?? badgeKey;
        setFilter(category as NoteCategory);
        // Dispatch event for TopBar to open SettingsPanel at "notes"
        window.dispatchEvent(
            new CustomEvent("open-notes-filter", { detail: { filter: category } })
        );
    }, [setFilter]);

    const badges: BadgeConfig[] = [
        {
            key: "ideas",
            label: "Идеи",
            icon: Lightbulb,
            getValue: () => ideas,
            showFlag: showIdeasCounter,
        },
        {
            key: "facts",
            label: "Факты",
            icon: Heart,
            getValue: () => facts,
            showFlag: showFactsCounter,
        },
        {
            key: "persons",
            label: "Персоны",
            icon: Users,
            getValue: () => persons,
            showFlag: showPersonsCounter,
        },
        {
            key: "tasks",
            label: "Задачи",
            icon: ListChecks,
            getValue: () => tasks,
            showFlag: showTasksCounter,
        },
        // Custom widgets
        ...customWidgets.map((w) => ({
            key: w.id,
            label: w.label,
            icon: Tag,
            getValue: () => w.count,
            showFlag: w.enabled,
        })),
    ];

    const visibleBadges = badges.filter((b) => b.showFlag);
    const hasTokens = showUsdTokens || showRubTokens || showTokenBalance;

    if (visibleBadges.length === 0 && !hasTokens && !showOpenAIBalance) return null;

    return (
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 overflow-x-auto py-2 scrollbar-none">
            {/* Left: counter badges */}
            <div className="flex items-start gap-2">
                <AnimatePresence mode="popLayout">
                    {visibleBadges.map((badge) => (
                        <CounterBadge
                            key={badge.key}
                            badgeKey={badge.key}
                            icon={badge.icon}
                            value={badge.getValue()}
                            label={badge.label}
                            onClick={() => handleBadgeClick(badge.key)}
                        />
                    ))}
                </AnimatePresence>
            </div>

            {/* Right: tokens + balance */}
            <div className="flex items-start gap-2">
                <AnimatePresence>
                    {hasTokens && (
                        <TokenDisplay
                            usd={tokensUsd}
                            rub={tokensRub}
                            balance={tokensBalance}
                            showUsd={showUsdTokens}
                            showRub={showRubTokens}
                            showBalance={showTokenBalance}
                        />
                    )}
                </AnimatePresence>
                <AnimatePresence>
                    {showOpenAIBalance && (
                        <OpenAIBalanceDisplay
                            balanceUsd={openaiBalanceUsd}
                            balanceRub={openaiBalanceRub}
                            error={openaiBalanceError}
                        />
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
