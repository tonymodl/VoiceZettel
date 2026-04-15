"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useNotesStore } from "@/stores/notesStore";
import { NotesList } from "@/components/notes/NotesList";
import { NoteView } from "@/components/notes/NoteView";
import { NoteEdit } from "@/components/notes/NoteEdit";

export function NotesSection() {
    const { view } = useNotesStore();

    return (
        <div className="flex h-full flex-col">
            <AnimatePresence mode="wait">
                {view === "list" && (
                    <motion.div
                        key="notes-list"
                        className="flex-1 flex flex-col min-h-0"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <NotesList onClose={() => {}} embedded />
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
                        <NoteView embedded />
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
        </div>
    );
}
