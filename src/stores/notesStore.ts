import { create } from "zustand";
import { logger } from "@/lib/logger";
import type { NoteListItem, NoteCategory, CreateNotePayload, UpdateNotePayload } from "@/types/notes";

interface MemoryApiItem {
    id: string;
    text: string;
    tags: string[];
    createdAt: string;
    relevance?: number;
}

/** Tags that are used as metadata, not displayed in the UI */
const KNOWN_META_TAGS = new Set(["idea", "fact", "persona", "task", "zettel", "voice", "text", "chat", "vault"]);
const BUILTIN_CATEGORIES = new Set(["idea", "fact", "persona", "task"]);

/** Map a raw memory from the API to our NoteListItem shape */
function memoryToNote(m: MemoryApiItem): NoteListItem {
    // Extract category from tags — built-in first, then custom widget (cw_*)
    let category: NoteCategory = "idea";
    const builtinTag = m.tags.find((t) => BUILTIN_CATEGORIES.has(t.toLowerCase()));
    const customTag = m.tags.find((t) => t.toLowerCase().startsWith("cw_"));

    if (builtinTag) {
        category = builtinTag.toLowerCase() as NoteCategory;
    } else if (customTag) {
        category = customTag.toLowerCase();
    } else if (m.tags.some((t) => t.toLowerCase() === "zettel")) {
        category = "idea"; // default zettel → idea
    }

    // Detect source from tags
    const isVoice = m.tags.some((t) => t.toLowerCase() === "voice");

    // Extract title: first line or first sentence
    const lines = m.text.split("\n").filter((l) => l.trim());
    const firstLine = lines[0] ?? "Без названия";
    const title = firstLine.replace(/^#+\s*/, "").slice(0, 100);
    const content = lines.slice(1).join("\n").trim() || m.text;

    return {
        id: m.id,
        title,
        content,
        category,
        source: isVoice ? "voice" : "text",
        tags: m.tags.filter((t) => !KNOWN_META_TAGS.has(t.toLowerCase()) && !t.toLowerCase().startsWith("cw_")),
        createdAt: m.createdAt,
    };
}

type NotesView = "list" | "view" | "edit";

interface NotesState {
    view: NotesView;
    notes: NoteListItem[];
    total: number;
    loading: boolean;
    filter: NoteCategory | null;
    searchQuery: string;
    activeNote: NoteListItem | null;
    pendingSyncCount: number;
    syncing: boolean;
}

interface NotesActions {
    setFilter: (filter: NoteCategory | null) => void;
    setSearchQuery: (q: string) => void;
    fetchNotes: (userId: string) => Promise<void>;
    goToList: () => void;
    goToView: (note: NoteListItem) => void;
    goToEdit: (note: NoteListItem | null) => void;
    createNote: (userId: string, payload: CreateNotePayload) => Promise<NoteListItem | null>;
    updateNote: (userId: string, id: string, payload: UpdateNotePayload) => Promise<boolean>;
    deleteNote: (userId: string, id: string) => Promise<boolean>;
    refreshPendingCount: () => Promise<void>;
    syncPendingNotes: (userId: string) => Promise<void>;
}

export const useNotesStore = create<NotesState & NotesActions>()((set, get) => ({
    view: "list",
    notes: [],
    total: 0,
    loading: false,
    filter: null,
    searchQuery: "",
    activeNote: null,
    pendingSyncCount: 0,
    syncing: false,

    setFilter: (filter) => set({ filter }),
    setSearchQuery: (q) => set({ searchQuery: q }),

    goToList: () => set({ view: "list", activeNote: null }),
    goToView: (note) => set({ view: "view", activeNote: note }),
    goToEdit: (note) => set({ view: "edit", activeNote: note }),

    fetchNotes: async (userId: string) => {
        set({ loading: true });
        try {
            const { filter, searchQuery } = get();
            const params = new URLSearchParams({ userId });

            if (searchQuery.trim()) {
                params.set("q", searchQuery.trim());
            } else {
                params.set("recent", "100");
            }

            const res = await fetch(`/api/memories?${params.toString()}`);
            if (!res.ok) {
                set({ loading: false });
                return;
            }
            const data = (await res.json()) as { memories: MemoryApiItem[]; total?: number };
            let notes = data.memories.map(memoryToNote);

            // Client-side category filtering (API doesn't support tag filtering)
            if (filter) {
                notes = notes.filter((n) => n.category === filter);
            }

            set({ notes, total: notes.length, loading: false });
        } catch (err) {
            logger.error("Failed to fetch notes:", (err as Error).message);
            set({ loading: false });
        }
    },

    createNote: async (userId, payload) => {
        try {
            // Build tags array: category + source + user tags
            const tags = [payload.category, payload.source ?? "text", ...payload.tags];
            const text = `# ${payload.title}\n\n${payload.content}`;

            const res = await fetch("/api/memories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, text, tags }),
            });

            if (!res.ok) return null;
            const data = (await res.json()) as { id: string };

            const note: NoteListItem = {
                id: data.id,
                title: payload.title,
                content: payload.content,
                category: payload.category,
                source: payload.source ?? "text",
                tags: payload.tags,
                createdAt: new Date().toISOString(),
            };

            set((s) => ({ notes: [note, ...s.notes], total: s.total + 1 }));
            return note;
        } catch (err) {
            logger.error("Failed to create note:", (err as Error).message);

            // Offline fallback: store pending
            const pendingNote: NoteListItem = {
                id: `pending_${Date.now()}`,
                title: payload.title,
                content: payload.content,
                category: payload.category,
                source: payload.source ?? "text",
                tags: payload.tags,
                createdAt: new Date().toISOString(),
            };

            set((s) => ({
                notes: [pendingNote, ...s.notes],
                total: s.total + 1,
                pendingSyncCount: s.pendingSyncCount + 1,
            }));

            return pendingNote;
        }
    },

    updateNote: async (userId, id, payload) => {
        try {
            const tags = [
                payload.category ?? get().activeNote?.category ?? "idea",
                ...(payload.tags ?? get().activeNote?.tags ?? []),
            ];
            const text = payload.title
                ? `# ${payload.title}\n\n${payload.content ?? ""}`
                : undefined;

            // Delete and recreate (memory API is append-only)
            await fetch(`/api/memories?userId=${userId}&id=${id}`, { method: "DELETE" });

            if (text) {
                await fetch("/api/memories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, text, tags }),
                });
            }

            // Update local state
            set((s) => ({
                notes: s.notes.map((n) =>
                    n.id === id
                        ? {
                              ...n,
                              title: payload.title ?? n.title,
                              content: payload.content ?? n.content,
                              category: payload.category ?? n.category,
                              tags: payload.tags ?? n.tags,
                          }
                        : n,
                ),
            }));

            return true;
        } catch (err) {
            logger.error("Failed to update note:", (err as Error).message);
            return false;
        }
    },

    deleteNote: async (userId, id) => {
        try {
            const res = await fetch(`/api/memories?userId=${userId}&id=${id}`, {
                method: "DELETE",
            });
            if (!res.ok) return false;

            set((s) => ({
                notes: s.notes.filter((n) => n.id !== id),
                total: Math.max(0, s.total - 1),
            }));
            return true;
        } catch {
            return false;
        }
    },

    refreshPendingCount: async () => {
        const pending = get().notes.filter((n) => n.id.startsWith("pending_")).length;
        set({ pendingSyncCount: pending });
    },

    syncPendingNotes: async (userId) => {
        const pending = get().notes.filter((n) => n.id.startsWith("pending_"));
        if (pending.length === 0) return;

        set({ syncing: true });
        for (const note of pending) {
            try {
                const tags = [note.category, note.source, ...note.tags];
                const text = `# ${note.title}\n\n${note.content}`;
                const res = await fetch("/api/memories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId, text, tags }),
                });
                if (res.ok) {
                    const data = (await res.json()) as { id: string };
                    set((s) => ({
                        notes: s.notes.map((n) => (n.id === note.id ? { ...n, id: data.id } : n)),
                        pendingSyncCount: Math.max(0, s.pendingSyncCount - 1),
                    }));
                }
            } catch {
                // Will retry on next online event
            }
        }
        set({ syncing: false });
    },
}));
