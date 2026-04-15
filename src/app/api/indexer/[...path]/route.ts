/**
 * /api/indexer/[...path]/route.ts
 * 
 * Universal proxy to the Python Indexer microservice.
 * Forwards all requests to INDEXER_SERVICE_URL (default: http://127.0.0.1:8030).
 */

import { NextRequest, NextResponse } from "next/server";

const INDEXER_URL = process.env.INDEXER_SERVICE_URL || "http://127.0.0.1:8030";

async function proxyRequest(req: NextRequest, params: { path: string[] }) {
    const path = params.path.join("/");
    const url = `${INDEXER_URL}/${path}`;

    try {
        const headers: Record<string, string> = {
            "Content-Type": req.headers.get("content-type") || "application/json",
        };

        const fetchOpts: RequestInit = {
            method: req.method,
            headers,
        };

        if (req.method !== "GET" && req.method !== "HEAD") {
            try {
                const body = await req.text();
                if (body) fetchOpts.body = body;
            } catch {
                // No body
            }
        }

        const res = await fetch(url, fetchOpts);
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
            return NextResponse.json(
                {
                    error: "Indexer сервис не запущен",
                    hint: "Запустите: cd services/indexer && python main.py",
                    details: message,
                },
                { status: 503 },
            );
        }

        return NextResponse.json({ error: message }, { status: 502 });
    }
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ path: string[] }> },
) {
    const params = await context.params;
    return proxyRequest(req, params);
}

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ path: string[] }> },
) {
    const params = await context.params;
    return proxyRequest(req, params);
}
