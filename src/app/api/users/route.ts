/**
 * @module api/users
 * Manage allowed users (email whitelist for Google Auth).
 * Only admin users can manage this list.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
    getAllowedUsers,
    isAllowed,
    addUser,
    removeUser,
} from "@/lib/allowedUsers";

const AddUserSchema = z.object({
    email: z.string().email("Некорректный email"),
    role: z.enum(["admin", "user"]).default("user"),
    name: z.string().optional(),
});

const DeleteUserSchema = z.object({
    email: z.string().email(),
});

/**
 * Check if the current session user is an admin.
 */
async function requireAdmin(): Promise<{ ok: true; email: string } | NextResponse> {
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed, role } = isAllowed(session.user.email);
    if (!allowed || role !== "admin") {
        return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
    }

    return { ok: true, email: session.user.email };
}

/**
 * GET /api/users — list all allowed users
 */
export async function GET() {
    const check = await requireAdmin();
    if (check instanceof NextResponse) return check;

    const users = getAllowedUsers();
    return NextResponse.json({ users });
}

/**
 * POST /api/users — add a new allowed user
 */
export async function POST(req: NextRequest) {
    const check = await requireAdmin();
    if (check instanceof NextResponse) return check;

    const raw: unknown = await req.json();
    const parsed = AddUserSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const { email, role, name } = parsed.data;

    try {
        const user = addUser(email, role, name);
        return NextResponse.json({ ok: true, user });
    } catch (err) {
        return NextResponse.json(
            { error: (err as Error).message },
            { status: 409 },
        );
    }
}

/**
 * DELETE /api/users — remove an allowed user
 */
export async function DELETE(req: NextRequest) {
    const check = await requireAdmin();
    if (check instanceof NextResponse) return check;

    const raw: unknown = await req.json();
    const parsed = DeleteUserSchema.safeParse(raw);

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const { email } = parsed.data;

    // Don't allow deleting yourself
    if (email.toLowerCase() === check.email.toLowerCase()) {
        return NextResponse.json(
            { error: "Нельзя удалить себя" },
            { status: 400 },
        );
    }

    const deleted = removeUser(email);
    if (!deleted) {
        return NextResponse.json(
            { error: "Пользователь не найден" },
            { status: 404 },
        );
    }

    return NextResponse.json({ ok: true, deleted: email });
}
