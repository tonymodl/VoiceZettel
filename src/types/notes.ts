// ── Note types ─────────────────────────────────────

/** Built-in categories — custom widgets add arbitrary string ids */
export type NoteCategory = "idea" | "fact" | "persona" | "task" | (string & {});

export const NOTE_CATEGORIES: NoteCategory[] = ["idea", "fact", "persona", "task"];

export const CATEGORY_LABELS: Record<string, string> = {
    idea: "Идеи",
    fact: "Факты",
    persona: "Персоны",
    task: "Задачи",
};

export const CATEGORY_LABEL_SINGULAR: Record<string, string> = {
    idea: "Идея",
    fact: "Факт",
    persona: "Персона",
    task: "Задача",
};

export type NoteSource = "voice" | "text";

export const SOURCE_LABELS: Record<string, string> = {
    voice: "Голос",
    text: "Текст",
};

export interface NoteListItem {
    id: string;
    title: string;
    content: string;
    category: NoteCategory;
    source: NoteSource;
    tags: string[];
    createdAt: string;
    updatedAt?: string;
}

export interface NoteDetail extends NoteListItem {
    /** Full markdown content */
    fullContent?: string;
}

export interface CreateNotePayload {
    title: string;
    content: string;
    category: NoteCategory;
    tags: string[];
    source?: NoteSource;
}

export interface UpdateNotePayload {
    title?: string;
    content?: string;
    category?: NoteCategory;
    tags?: string[];
}

// ── Sync source types ─────────────────────────────
export type SyncSourceId = "zettelkasten" | "telegram" | "voice_sessions" | "obsidian";

export const SYNC_SOURCE_LABELS: Record<SyncSourceId, string> = {
    zettelkasten: "Zettelkasten заметки",
    telegram: "Архив переписок Telegram",
    voice_sessions: "Сессии голосового ассистента",
    obsidian: "Obsidian Vault",
};

export const SYNC_SOURCE_DESCRIPTIONS: Record<SyncSourceId, string> = {
    zettelkasten: "Автоматически созданные заметки по методу Zettelkasten",
    telegram: "Экспортированные сообщения и чаты из Telegram",
    voice_sessions: "Все транскрипции и сессии голосового ассистента",
    obsidian: "Двусторонняя синхронизация с хранилищем Obsidian",
};
