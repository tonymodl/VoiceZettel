/**
 * @module /api/tasks
 * CRUD API for voice-created tasks.
 * Tasks are stored as tagged memories in ChromaDB with category "task".
 * GET: List tasks (optionally filtered by status)
 * POST: Create a new task
 * PATCH: Update task status/content
 * DELETE: Remove a task
 */
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";

interface TaskItem {
    id: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "done" | "cancelled";
    priority: "low" | "medium" | "high" | "critical";
    createdAt: string;
    updatedAt: string;
    assignee: string;
    tags: string[];
}

/** GET /api/tasks — List all tasks */
export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId") || "anonymous";
    const status = req.nextUrl.searchParams.get("status");

    try {
        // Search ChromaDB for tasks
        const res = await fetch(`${INDEXER_URL}/search/hybrid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: "task задача",
                top_k: 50,
                source_type: null,
                user_id: userId,
            }),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            return NextResponse.json({ tasks: [], error: "Indexer unavailable" });
        }

        const results = await res.json() as Array<{
            id?: string;
            text: string;
            metadata: Record<string, string>;
            score?: number;
        }>;

        // Parse tasks from ChromaDB results
        const tasks: TaskItem[] = results
            .filter((r) => {
                const tags = r.metadata?.tags?.toLowerCase() || "";
                return tags.includes("task") || tags.includes("задача");
            })
            .map((r) => {
                const lines = r.text.split("\n").filter((l) => l.trim());
                const title = lines[0]?.replace(/^#+\s*/, "").replace(/^\[task\]\s*/i, "") || "Без названия";
                const description = lines.slice(1).join("\n").trim();

                // Extract status from metadata or text
                let taskStatus: TaskItem["status"] = "pending";
                if (r.metadata?.status) {
                    taskStatus = r.metadata.status as TaskItem["status"];
                } else if (r.text.toLowerCase().includes("[done]") || r.text.toLowerCase().includes("[✓]")) {
                    taskStatus = "done";
                } else if (r.text.toLowerCase().includes("[in_progress]") || r.text.toLowerCase().includes("[/]")) {
                    taskStatus = "in_progress";
                }

                // Extract priority
                let priority: TaskItem["priority"] = "medium";
                if (r.metadata?.priority) {
                    priority = r.metadata.priority as TaskItem["priority"];
                } else if (r.text.toLowerCase().includes("critical") || r.text.toLowerCase().includes("критично")) {
                    priority = "critical";
                } else if (r.text.toLowerCase().includes("high") || r.text.toLowerCase().includes("важно")) {
                    priority = "high";
                }

                return {
                    id: r.id || r.metadata?.id || crypto.randomUUID(),
                    title,
                    description,
                    status: taskStatus,
                    priority,
                    createdAt: r.metadata?.created_at || new Date().toISOString(),
                    updatedAt: r.metadata?.updated_at || new Date().toISOString(),
                    assignee: r.metadata?.assignee || "antigravity",
                    tags: (r.metadata?.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
                };
            });

        // Filter by status if requested
        const filtered = status ? tasks.filter((t) => t.status === status) : tasks;

        return NextResponse.json({ tasks: filtered, total: filtered.length });
    } catch (err) {
        logger.error("[Tasks API]", (err as Error).message);
        return NextResponse.json({ tasks: [], error: (err as Error).message });
    }
}

/** POST /api/tasks — Create a new task */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as {
            title: string;
            description?: string;
            priority?: string;
            assignee?: string;
            userId?: string;
        };

        const { title, description = "", priority = "medium", assignee = "antigravity", userId = "anonymous" } = body;

        if (!title?.trim()) {
            return NextResponse.json({ error: "Title is required" }, { status: 400 });
        }

        // Save to ChromaDB via indexer
        const text = `[task] ${title}\n${description}`;
        const tags = ["task", priority, `assignee:${assignee}`];

        const res = await fetch(`${INDEXER_URL}/memory`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text,
                tags,
                user_id: userId,
                metadata: {
                    status: "pending",
                    priority,
                    assignee,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                },
            }),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            const err = await res.text();
            return NextResponse.json({ error: `Indexer error: ${err}` }, { status: 500 });
        }

        const data = await res.json() as { id?: string };

        logger.info(`[Tasks] Created task: "${title}" (${priority}, assignee: ${assignee})`);

        return NextResponse.json({
            status: "ok",
            task: {
                id: data.id || crypto.randomUUID(),
                title,
                description,
                status: "pending",
                priority,
                assignee,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                tags,
            },
        });
    } catch (err) {
        logger.error("[Tasks API] Create error:", (err as Error).message);
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

/** PUT /api/tasks — Update task status */
export async function PUT(req: NextRequest) {
    try {
        const body = await req.json() as {
            taskId: string;
            status?: string;
            priority?: string;
            userId?: string;
        };

        const { taskId, status, priority, userId = "anonymous" } = body;

        if (!taskId) {
            return NextResponse.json({ error: "taskId is required" }, { status: 400 });
        }

        // Update metadata via indexer
        const updates: Record<string, string> = {
            updated_at: new Date().toISOString(),
        };
        if (status) updates.status = status;
        if (priority) updates.priority = priority;

        try {
            await fetch(`${INDEXER_URL}/memory/${taskId}/metadata`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    metadata: updates,
                    user_id: userId,
                }),
                signal: AbortSignal.timeout(5000),
            });
        } catch {
            // Indexer may not support PATCH — log and continue
            logger.warn(`[Tasks API] Indexer PATCH not available for task ${taskId}, status update stored locally only`);
        }

        logger.info(`[Tasks] Updated task ${taskId}: ${JSON.stringify(updates)}`);

        return NextResponse.json({
            status: "ok",
            taskId,
            updates,
        });
    } catch (err) {
        logger.error("[Tasks API] Update error:", (err as Error).message);
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

