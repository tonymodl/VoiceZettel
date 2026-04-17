import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";
import { logger } from "@/lib/logger";

const VAULT_PATH = process.env.VAULT_PATH ?? "";
const MAX_CONTEXT_CHARS = 30000;
const CACHE_TTL_MS = 60_000; // 1 minute

interface VaultCache {
    text: string;
    timestamp: number;
}

const cache: VaultCache = { text: "", timestamp: 0 };

/**
 * Recursively collect all .md files from a directory.
 */
async function collectMdFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            // Skip .obsidian config folder
            if (entry.name.startsWith(".")) continue;

            if (entry.isDirectory()) {
                const nested = await collectMdFiles(fullPath);
                results.push(...nested);
            } else if (extname(entry.name) === ".md") {
                results.push(fullPath);
            }
        }
    } catch {
        // Directory might not exist yet
    }

    return results;
}

/**
 * Load vault context from unified structure:
 *   🗃 Zettelkasten/ — notes (priority)
 *   📝 Сессии/       — session logs (recent only)
 *   📬 Telegram/     — skipped (too large, use ChromaDB RAG instead)
 *
 * Cached for 60 seconds.
 */
export async function loadVaultContext(_userId: string): Promise<string> {
    if (!VAULT_PATH) return "";

    // Return cached if fresh
    if (cache.text && Date.now() - cache.timestamp < CACHE_TTL_MS) {
        return cache.text;
    }

    try {
        const chunks: string[] = [];
        let totalChars = 0;

        // 1. Zettelkasten notes (highest priority) — includes subdirs
        const zettelDirs = [
            join(VAULT_PATH, "🗃 Zettelkasten"),
            join(VAULT_PATH, "🗃 Zettelkasten", "ideas"),
            join(VAULT_PATH, "🗃 Zettelkasten", "facts"),
            join(VAULT_PATH, "🗃 Zettelkasten", "persons"),
            join(VAULT_PATH, "🗃 Zettelkasten", "tasks"),
            join(VAULT_PATH, "🗃 Zettelkasten", "Zettelkasten"),
        ];

        const allZettelFiles: string[] = [];
        for (const dir of zettelDirs) {
            const files = await collectMdFiles(dir);
            allZettelFiles.push(...files);
        }
        // Deduplicate (recursive scan may re-discover subdirs)
        const uniqueZettelFiles = [...new Set(allZettelFiles)];

        for (const filePath of uniqueZettelFiles) {
            if (totalChars >= MAX_CONTEXT_CHARS) break;
            try {
                const content = await readFile(filePath, "utf-8");
                const relativePath = filePath.replace(VAULT_PATH, "").replace(/\\/g, "/");
                const chunk = `\n--- ${relativePath} ---\n${content.trim()}\n`;
                chunks.push(chunk);
                totalChars += chunk.length;
            } catch {
                // Skip unreadable files
            }
        }

        // 1b. Root-level notes (Vault root .md files)
        try {
            const rootFiles = await collectMdFiles(VAULT_PATH);
            const rootOnlyFiles = rootFiles.filter(
                (f) => !f.includes("🗃") && !f.includes("📝") && !f.includes("📬") && !f.includes(".obsidian"),
            );
            for (const filePath of rootOnlyFiles.slice(0, 10)) {
                if (totalChars >= MAX_CONTEXT_CHARS) break;
                try {
                    const content = await readFile(filePath, "utf-8");
                    const relativePath = filePath.replace(VAULT_PATH, "").replace(/\\/g, "/");
                    const chunk = `\n--- ${relativePath} ---\n${content.trim().slice(0, 2000)}\n`;
                    chunks.push(chunk);
                    totalChars += chunk.length;
                } catch {
                    // Skip
                }
            }
        } catch {
            // Root scan failed — skip
        }

        // 2. Recent sessions (last 3 days only — keep context small)
        const sessionDir = join(VAULT_PATH, "📝 Сессии");
        const sessionFiles = (await collectMdFiles(sessionDir))
            .sort()
            .slice(-3); // last 3 files = last 3 days

        for (const filePath of sessionFiles) {
            if (totalChars >= MAX_CONTEXT_CHARS) break;
            try {
                const content = await readFile(filePath, "utf-8");
                const relativePath = filePath.replace(VAULT_PATH, "").replace(/\\/g, "/");
                // Only last 2000 chars of session (most recent conversation)
                const trimmed = content.slice(-2000);
                const chunk = `\n--- ${relativePath} (последние записи) ---\n${trimmed.trim()}\n`;
                chunks.push(chunk);
                totalChars += chunk.length;
            } catch {
                // Skip
            }
        }

        // NOTE: 📬 Telegram/ is NOT loaded here — it's too large.
        // Telegram context comes via ChromaDB RAG search in chatContext.ts.

        const result = chunks.join("");

        cache.text = result;
        cache.timestamp = Date.now();

        logger.info(
            `Vault context: ${uniqueZettelFiles.length} zettel notes + ${sessionFiles.length} sessions, ${totalChars} chars`,
        );

        return result;
    } catch (err) {
        logger.error(
            `Failed to load vault: ${err instanceof Error ? err.message : "Unknown"}`,
        );
        return "";
    }
}

/**
 * Load vault notes as structured {title, content} pairs for memory preloading.
 */
export async function loadVaultNotes(
    _userId: string,
): Promise<Array<{ title: string; content: string }>> {
    if (!VAULT_PATH) return [];

    try {
        // Load from all Zettelkasten subdirectories + sessions + root notes
        const dirs = [
            join(VAULT_PATH, "🗃 Zettelkasten"),
            join(VAULT_PATH, "🗃 Zettelkasten", "ideas"),
            join(VAULT_PATH, "🗃 Zettelkasten", "facts"),
            join(VAULT_PATH, "🗃 Zettelkasten", "persons"),
            join(VAULT_PATH, "🗃 Zettelkasten", "tasks"),
            join(VAULT_PATH, "🗃 Zettelkasten", "Zettelkasten"),
            join(VAULT_PATH, "📝 Сессии"),
        ];

        const notes: Array<{ title: string; content: string }> = [];

        for (const dir of dirs) {
            const files = await collectMdFiles(dir);
            for (const filePath of files) {
                try {
                    const content = await readFile(filePath, "utf-8");
                    const headingMatch = /^#\s+(.+)$/m.exec(content);
                    const fileName = filePath
                        .replace(/\\/g, "/")
                        .split("/")
                        .pop()
                        ?.replace(".md", "");
                    const title = headingMatch?.[1] ?? fileName ?? "Untitled";

                    if (content.trim().length < 20) continue;

                    notes.push({ title, content: content.trim() });
                } catch {
                    // Skip unreadable
                }
            }
        }

        return notes;
    } catch {
        return [];
    }
}
