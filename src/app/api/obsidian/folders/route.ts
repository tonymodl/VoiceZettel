import { NextResponse } from "next/server";

const OBSIDIAN_REST_URL = process.env.OBSIDIAN_REST_URL || "http://127.0.0.1:27123";
const OBSIDIAN_REST_API_KEY = process.env.OBSIDIAN_REST_API_KEY || "";
const VAULT_PATH = process.env.VAULT_PATH || "";

interface VaultFolder {
    id: string;
    name: string;
    path: string;
    description: string;
    noteCount: number;
}

/**
 * GET /api/obsidian/folders
 * Returns all top-level folders in the Obsidian vault as potential sync sources.
 * Tries Obsidian REST API first, falls back to VAULT_PATH filesystem scan.
 */
export async function GET() {
    const folders: VaultFolder[] = [];

    // Strategy 1: Obsidian Local REST API
    try {
        const res = await fetch(`${OBSIDIAN_REST_URL}/vault/`, {
            headers: {
                Authorization: `Bearer ${OBSIDIAN_REST_API_KEY}`,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(3000),
        });

        if (res.ok) {
            const data = (await res.json()) as { files?: string[] };
            const allFiles = data.files ?? [];

            // Extract unique top-level folders
            const folderSet = new Map<string, number>();
            for (const file of allFiles) {
                const parts = file.split("/");
                if (parts.length > 1) {
                    const folder = parts[0];
                    // Skip hidden folders like .obsidian
                    if (!folder.startsWith(".")) {
                        folderSet.set(folder, (folderSet.get(folder) || 0) + 1);
                    }
                }
            }

            for (const [name, count] of folderSet) {
                folders.push({
                    id: name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "_"),
                    name,
                    path: name,
                    description: `${count} заметок в папке "${name}"`,
                    noteCount: count,
                });
            }

            // Sort: emoji folders first, then alphabetically
            folders.sort((a, b) => {
                const aEmoji = /^[\u{1F300}-\u{1FAD6}]/u.test(a.name) ? 0 : 1;
                const bEmoji = /^[\u{1F300}-\u{1FAD6}]/u.test(b.name) ? 0 : 1;
                if (aEmoji !== bEmoji) return aEmoji - bEmoji;
                return a.name.localeCompare(b.name, "ru");
            });

            return NextResponse.json({ source: "obsidian_api", folders });
        }
    } catch {
        // Obsidian REST API unavailable, try filesystem
    }

    // Strategy 2: Direct filesystem scan via VAULT_PATH
    if (VAULT_PATH) {
        try {
            const fs = await import("fs/promises");
            const path = await import("path");
            const entries = await fs.readdir(VAULT_PATH, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith(".")) {
                    const folderPath = path.join(VAULT_PATH, entry.name);
                    let noteCount = 0;
                    try {
                        const files = await fs.readdir(folderPath, { recursive: true });
                        noteCount = files.filter((f) =>
                            typeof f === "string" && f.endsWith(".md")
                        ).length;
                    } catch {
                        noteCount = 0;
                    }

                    folders.push({
                        id: entry.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "_"),
                        name: entry.name,
                        path: entry.name,
                        description: `${noteCount} заметок в папке "${entry.name}"`,
                        noteCount,
                    });
                }
            }

            folders.sort((a, b) => {
                const aEmoji = /^[\u{1F300}-\u{1FAD6}]/u.test(a.name) ? 0 : 1;
                const bEmoji = /^[\u{1F300}-\u{1FAD6}]/u.test(b.name) ? 0 : 1;
                if (aEmoji !== bEmoji) return aEmoji - bEmoji;
                return a.name.localeCompare(b.name, "ru");
            });

            return NextResponse.json({ source: "filesystem", folders });
        } catch {
            // Filesystem scan failed
        }
    }

    return NextResponse.json({
        source: "none",
        folders: [],
        error: "Не удалось получить папки. Проверьте Obsidian REST API или VAULT_PATH.",
    });
}
