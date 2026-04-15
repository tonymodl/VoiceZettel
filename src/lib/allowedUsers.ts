/**
 * @module lib/allowedUsers
 * Manages the allowed-users whitelist via a simple JSON file.
 * This avoids importing better-sqlite3 in auth.ts (which runs in Edge middleware).
 * The SQLite DB is used separately for heavier per-user data (settings, memories, etc.).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export interface AllowedUser {
    email: string;
    role: "admin" | "user";
    name?: string;
    created_at: string;
    last_login?: string;
}

const DATA_DIR = join(process.cwd(), "data");
const FILE_PATH = join(DATA_DIR, "allowed_users.json");

function ensureFile(): AllowedUser[] {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(FILE_PATH)) {
        // Seed with default admin
        const adminEmail = process.env.ADMIN_EMAIL || "evsinantongpt@gmail.com";
        const seed: AllowedUser[] = [
            {
                email: adminEmail,
                role: "admin",
                name: "Admin",
                created_at: new Date().toISOString(),
            },
        ];
        writeFileSync(FILE_PATH, JSON.stringify(seed, null, 2), "utf-8");
        return seed;
    }
    try {
        return JSON.parse(readFileSync(FILE_PATH, "utf-8")) as AllowedUser[];
    } catch {
        return [];
    }
}

export function getAllowedUsers(): AllowedUser[] {
    return ensureFile();
}

export function isAllowed(email: string): { allowed: boolean; role: string } {
    const users = ensureFile();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return { allowed: false, role: "user" };
    return { allowed: true, role: user.role };
}

export function addUser(email: string, role: "admin" | "user" = "user", name?: string): AllowedUser {
    const users = ensureFile();
    const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) throw new Error(`Пользователь ${email} уже существует`);

    const newUser: AllowedUser = {
        email: email.toLowerCase(),
        role,
        name: name || email.split("@")[0],
        created_at: new Date().toISOString(),
    };
    users.push(newUser);
    writeFileSync(FILE_PATH, JSON.stringify(users, null, 2), "utf-8");
    return newUser;
}

export function removeUser(email: string): boolean {
    const users = ensureFile();
    const idx = users.findIndex((u) => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return false;
    users.splice(idx, 1);
    writeFileSync(FILE_PATH, JSON.stringify(users, null, 2), "utf-8");
    return true;
}

export function updateLastLogin(email: string): void {
    const users = ensureFile();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
        user.last_login = new Date().toISOString();
        writeFileSync(FILE_PATH, JSON.stringify(users, null, 2), "utf-8");
    }
}
