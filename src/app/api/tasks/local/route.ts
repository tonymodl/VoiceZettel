/**
 * @module /api/tasks/local
 * Read tasks from .antigravity/tasks/ directory (filesystem fallback).
 * GET: List all local task files
 * PATCH: Update task status
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const TASKS_DIR = path.join(process.cwd(), ".antigravity", "tasks");

interface LocalTask {
    id: string;
    title: string;
    description: string;
    priority: string;
    assignee: string;
    status: string;
    source: string;
    createdAt: string;
    updatedAt: string;
}

export async function GET() {
    try {
        await fs.mkdir(TASKS_DIR, { recursive: true });
        const files = await fs.readdir(TASKS_DIR);
        const tasks: LocalTask[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            try {
                const raw = await fs.readFile(path.join(TASKS_DIR, file), "utf-8");
                tasks.push(JSON.parse(raw) as LocalTask);
            } catch { /* skip corrupted files */ }
        }

        // Sort by creation date, newest first
        tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return NextResponse.json({ tasks, total: tasks.length, source: "filesystem" });
    } catch (err) {
        return NextResponse.json({ tasks: [], error: (err as Error).message });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const { id, status } = await req.json() as { id: string; status: string };
        if (!id || !status) {
            return NextResponse.json({ error: "id and status required" }, { status: 400 });
        }

        await fs.mkdir(TASKS_DIR, { recursive: true });
        const files = await fs.readdir(TASKS_DIR);

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const filePath = path.join(TASKS_DIR, file);
            try {
                const raw = await fs.readFile(filePath, "utf-8");
                const task = JSON.parse(raw) as LocalTask;
                if (task.id === id) {
                    task.status = status;
                    task.updatedAt = new Date().toISOString();
                    await fs.writeFile(filePath, JSON.stringify(task, null, 2));
                    return NextResponse.json({ task, updated: true });
                }
            } catch { /* skip */ }
        }

        return NextResponse.json({ error: "Task not found" }, { status: 404 });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
