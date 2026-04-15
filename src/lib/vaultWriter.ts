import { writeFile, mkdir, appendFile, access } from "fs/promises";
import { join } from "path";
import { logger } from "@/lib/logger";

const VAULT_PATH = process.env.VAULT_PATH;
const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";

interface WriteResult {
    success: boolean;
    error?: string;
    method: string;
}

/**
 * Notify the indexer service that a file was created/updated.
 * Fire-and-forget — never blocks the main flow.
 */
async function notifyIndexer(filePath: string): Promise<void> {
    try {
        await fetch(`${INDEXER_URL}/index/file`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: filePath }),
            signal: AbortSignal.timeout(3000),
        });
    } catch {
        // Silent — indexer may not be running
    }
}

/**
 * Write a Zettelkasten note to the vault.
 * Path: VAULT_PATH/🗃 Zettelkasten/<folder>/<title>.md
 *
 * Unified structure — no per-user subdirectories.
 */
export async function writeNoteToVault(
    userId: string,
    title: string,
    content: string,
    folder: string = "Zettelkasten",
): Promise<WriteResult> {
    if (!VAULT_PATH) {
        return { success: false, error: "VAULT_PATH not configured", method: "none" };
    }

    const filename = `${title}.md`;

    try {
        // Unified path: 🗃 Zettelkasten/<subfolder>/<title>.md
        const targetDir = join(VAULT_PATH, "🗃 Zettelkasten", folder);
        await mkdir(targetDir, { recursive: true });
        const filePath = join(targetDir, filename);
        await writeFile(filePath, content, "utf-8");
        logger.info(`Vault write: 🗃 Zettelkasten/${folder}/${filename}`);

        // Notify indexer for real-time vectorization
        notifyIndexer(filePath).catch(() => {});

        return { success: true, method: "filesystem" };
    } catch (err) {
        const fsErr = err instanceof Error ? err.message : "Unknown";
        return { success: false, error: fsErr, method: "filesystem" };
    }
}

/**
 * Append a dialog entry to session archive.
 * Path: VAULT_PATH/📝 Сессии/YYYY-MM-DD.md
 *
 * Unified structure — no per-user subdirectories.
 */
export async function appendToSessionArchive(
    userId: string,
    userText: string,
    assistantText: string,
): Promise<void> {
    if (!VAULT_PATH) return;

    const now = new Date();
    const today = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const time = now.toTimeString().slice(0, 8);    // HH:MM:SS

    const archiveDir = join(VAULT_PATH, "📝 Сессии");
    await mkdir(archiveDir, { recursive: true });

    const filePath = join(archiveDir, `${today}.md`);

    const entry = `\n---\n**${time}**\n\n🗣 **Пользователь:** ${userText}\n\n🤖 **Ассистент:** ${assistantText}\n`;

    try {
        try {
            await access(filePath);
            // File exists — append
            await appendFile(filePath, entry, "utf-8");
        } catch {
            // File doesn't exist — create with header
            const header = `---\ntitle: "Сессия ${today}"\ntype: session\ndate: ${today}\nsource: voicezettel\n---\n\n# 📅 Сессия ${today}\n\nАрхив диалогов VoiceZettel за ${today}.\n`;
            await writeFile(filePath, header + entry, "utf-8");
        }

        // Notify indexer
        notifyIndexer(filePath).catch(() => {});
    } catch {
        // Silent fail — archive is best-effort
    }
}
