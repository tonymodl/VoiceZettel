"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    ChevronRight,
    LayoutGrid,
    Sparkles,
    Bot,
    MessageSquareText,
    ShieldCheck,
    FileText,
    ScrollText,
    ExternalLink,
    ListChecks,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

import { WidgetsSection } from "./WidgetsSection";
import { AiSection } from "./AiSection";
import { VoiceSection } from "./VoiceSection";
import { AgentsSection } from "./AgentsSection";
import { PromptsSection } from "./PromptsSection";
import { ObsidianSection } from "./ObsidianSection";
import { LiteLLMSection } from "./LiteLLMSection";
import { LogsSection } from "./LogsSection";
import { NotesSection } from "./NotesSection";
import { VoiceTaskSidebar } from "@/components/tasks/VoiceTaskSidebar";
import { useNotesStore } from "@/stores/notesStore";
import type { SettingsSectionId, SettingsMenuItem } from "./types";

const MENU_ITEMS: SettingsMenuItem[] = [
    { id: "notes", label: "Мои заметки", icon: FileText },
    { id: "tasks", label: "Задачи", icon: ListChecks },
    { id: "widgets", label: "Виджеты", icon: LayoutGrid },
    { id: "ai", label: "Настройки ИИ", icon: Sparkles },
    { id: "agents", label: "Агенты", icon: Bot },
    { id: "prompts", label: "Промты", icon: MessageSquareText },
    { id: "logs", label: "Логи", icon: ScrollText },
    { id: "admin", label: "Админ-панель", icon: ShieldCheck },
];

const SECTION_TITLES: Record<SettingsSectionId, string> = {
    notes: "Мои заметки",
    tasks: "Задачи",
    widgets: "Виджеты",
    ai: "Настройки ИИ",
    agents: "Агенты",
    prompts: "Промты",
    logs: "Логи",
    admin: "Админ-панель",
};

/* Full-screen slide from right */
const screenVariants = {
    enter: { x: "100%", opacity: 0 },
    center: {
        x: 0,
        opacity: 1,
        transition: { type: "spring" as const, damping: 28, stiffness: 300 },
    },
    exit: {
        x: "100%",
        opacity: 0,
        transition: { duration: 0.2 },
    },
};

/* Section content slide */
const sectionVariants = {
    enter: { x: "100%", opacity: 0 },
    center: {
        x: 0,
        opacity: 1,
        transition: { type: "spring" as const, damping: 28, stiffness: 300 },
    },
    exit: {
        x: "-30%",
        opacity: 0,
        transition: { duration: 0.2 },
    },
};

function SectionContent({ id }: { id: SettingsSectionId }) {
    switch (id) {
        case "notes":
            return <NotesSection />;
        case "tasks":
            return <VoiceTaskSidebar userId="anton" />;
        case "widgets":
            return <WidgetsSection />;
        case "ai":
            return (
                <>
                    <AiSection />
                    <VoiceSection />
                    <ObsidianSection />
                    <LiteLLMSection />
                </>
            );
        case "agents":
            return <AgentsSection />;
        case "prompts":
            return <PromptsSection />;
        case "logs":
            return <LogsSection />;
        case "admin":
            return (
                <div className="flex flex-col items-center gap-4 py-8">
                    <div className="flex size-16 items-center justify-center rounded-2xl bg-violet-500/10">
                        <ShieldCheck className="size-8 text-violet-400" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-base font-semibold text-zinc-200">
                            Полная админ-панель
                        </h3>
                        <p className="mt-1 text-sm text-zinc-500">
                            Мониторинг всех сервисов, API ключи, балансы, логи и диагностика
                        </p>
                    </div>
                    <Link
                        href="/admin"
                        className="flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:bg-violet-500 hover:shadow-violet-500/30"
                    >
                        <ExternalLink className="size-4" />
                        Открыть админ-панель
                    </Link>
                </div>
            );
    }
}

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
    /** Pre-select a section on open */
    initialSection?: SettingsSectionId | null;
}

export function SettingsPanel({ open, onClose, initialSection }: SettingsPanelProps) {
    const [activeSection, setActiveSection] =
        useState<SettingsSectionId | null>(null);
    const notesView = useNotesStore((s) => s.view);
    const notesGoToList = useNotesStore((s) => s.goToList);

    // Handle initial section
    useEffect(() => {
        if (open && initialSection) {
            setActiveSection(initialSection);
        }
    }, [open, initialSection]);

    // Reset when closing
    useEffect(() => {
        if (!open) {
            setActiveSection(null);
            notesGoToList();
        }
    }, [open, notesGoToList]);

    // Close on Escape key
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (activeSection) {
                    setActiveSection(null);
                } else {
                    onClose();
                }
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, activeSection, onClose]);

    const handleOpenSection = (id: SettingsSectionId) => {
        setActiveSection(id);
    };

    const handleBack = useCallback(() => {
        setActiveSection(null);
    }, []);

    const handleClose = useCallback(() => {
        setActiveSection(null);
        onClose();
    }, [onClose]);

    /** Smart back: for notes, step back within notes first */
    const handleSectionBack = useCallback(() => {
        if (activeSection === "notes" && notesView !== "list") {
            notesGoToList();
        } else {
            handleBack();
        }
    }, [activeSection, notesView, notesGoToList, handleBack]);

    /** Dynamic title for notes section */
    const getSectionTitle = useCallback(() => {
        if (activeSection === null) return "Настройки";
        if (activeSection === "notes") {
            if (notesView === "edit") return "Новая заметка";
            return "Мои заметки";
        }
        return SECTION_TITLES[activeSection];
    }, [activeSection, notesView]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="settings-screen"
                    className="fixed inset-0 z-50 flex flex-col bg-zinc-950"
                    variants={screenVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                >
                    {/* Nested AnimatePresence for menu ↔ section */}
                    <AnimatePresence mode="wait">
                        {activeSection === null ? (
                            /* ── MENU SCREEN ── */
                            <motion.div
                                key="menu-screen"
                                className="flex h-full flex-col"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, x: "-30%" }}
                                transition={{ duration: 0.2 }}
                            >
                                {/* Header */}
                                <div className="flex h-14 shrink-0 items-center px-4">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-zinc-400 hover:text-zinc-100"
                                        onClick={handleClose}
                                        aria-label="Закрыть настройки"
                                    >
                                        <ArrowLeft className="size-5" />
                                    </Button>
                                    <h2 className="flex-1 text-center text-base font-semibold text-zinc-100">
                                        Настройки
                                    </h2>
                                    <div className="size-8" />
                                </div>

                                {/* Menu items */}
                                <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-none">
                                    <nav className="mx-auto flex max-w-[480px] flex-col gap-1">
                                        {MENU_ITEMS.map((item, idx) => (
                                            <div key={item.id}>
                                                {/* Separator before admin */}
                                                {idx === MENU_ITEMS.length - 1 && (
                                                    <div className="my-2 border-t border-zinc-800/60" />
                                                )}
                                                <button
                                                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3.5 transition-colors hover:bg-zinc-800/70 active:bg-zinc-800"
                                                    onClick={() =>
                                                        handleOpenSection(item.id)
                                                    }
                                                >
                                                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                                                        item.id === "admin" ? "bg-amber-500/15" : "bg-violet-500/15"
                                                    }`}>
                                                        <item.icon className={`size-4.5 ${
                                                            item.id === "admin" ? "text-amber-400" : "text-violet-400"
                                                        }`} />
                                                    </div>
                                                    <span className="flex-1 text-left text-sm font-medium text-zinc-200">
                                                        {item.label}
                                                    </span>
                                                    <ChevronRight className="size-4 text-zinc-600" />
                                                </button>
                                            </div>
                                        ))}
                                    </nav>
                                </div>
                            </motion.div>
                        ) : (
                            /* ── SECTION SCREEN ── */
                            <motion.div
                                key={activeSection}
                                className="flex h-full flex-col"
                                variants={sectionVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                            >
                                {/* Header */}
                                <div className="flex h-14 shrink-0 items-center px-4">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-zinc-400 hover:text-zinc-100"
                                        onClick={handleSectionBack}
                                        aria-label="Назад"
                                    >
                                        <ArrowLeft className="size-5" />
                                    </Button>
                                    <h2 className="flex-1 text-center text-base font-semibold text-zinc-100">
                                        {getSectionTitle()}
                                    </h2>
                                    <div className="size-8" />
                                </div>

                                {/* Section content */}
                                {activeSection === "notes" || activeSection === "tasks" ? (
                                    <div className="flex flex-1 flex-col overflow-hidden">
                                        <SectionContent id={activeSection} />
                                    </div>
                                ) : (
                                    <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col overflow-y-auto px-5 pb-8 scrollbar-none">
                                        <SectionContent id={activeSection} />
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
