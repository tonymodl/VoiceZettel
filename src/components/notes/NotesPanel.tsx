"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useNotesStore } from "@/stores/notesStore";
import { NotesList } from "@/components/notes/NotesList";
import { NoteView } from "@/components/notes/NoteView";
import { NoteEdit } from "@/components/notes/NoteEdit";

const panelVariants = {
    hidden: { x: "100%", opacity: 0 },
    visible: {
        x: 0,
        opacity: 1,
        transition: { type: "spring" as const, damping: 28, stiffness: 300 },
    },
    exit: {
        x: "100%",
        opacity: 0,
        transition: { duration: 0.25 },
    },
};

const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
};

export function NotesPanel({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const { view, goToList } = useNotesStore();

    const handleClose = () => {
        goToList();
        onClose();
    };

    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        key="notes-backdrop"
                        className="fixed inset-0 z-40 bg-black/60"
                        variants={backdropVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        onClick={handleClose}
                    />

                    {/* Panel */}
                    <motion.div
                        key="notes-panel"
                        className="fixed inset-0 z-50 flex flex-col bg-zinc-950 sm:inset-y-0 sm:left-auto sm:right-0 sm:max-w-[480px] sm:border-l sm:border-zinc-800"
                        variants={panelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                    >
                        <AnimatePresence mode="wait">
                            {view === "list" && (
                                <motion.div
                                    key="notes-list"
                                    className="flex-1 flex flex-col min-h-0"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <NotesList onClose={handleClose} />
                                </motion.div>
                            )}

                            {view === "view" && (
                                <motion.div
                                    key="notes-view"
                                    className="flex-1 flex flex-col min-h-0"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <NoteView />
                                </motion.div>
                            )}

                            {view === "edit" && (
                                <motion.div
                                    key="notes-edit"
                                    className="flex-1 flex flex-col min-h-0"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <NoteEdit />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
