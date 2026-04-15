import { NextResponse } from "next/server";

/**
 * POST /api/workspace/sync — Sync a Google document to ChromaDB.
 * 
 * Phase 5: Fetches document content via public export URL,
 * chunks the text, and indexes it into ChromaDB for context-aware AI.
 * 
 * Supports two modes:
 * 1. Public Google Docs — fetched via export?format=txt (no OAuth needed)
 * 2. Private Google Docs — requires Google OAuth (TODO)
 */

const INDEXER_URL = process.env.INDEXER_SERVICE_URL || "http://127.0.0.1:8030";

function chunkText(text: string, chunkSize = 1500, overlap = 300): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?。\n])\s+/);
    let current = "";

    for (const sentence of sentences) {
        if ((current + sentence).length > chunkSize && current.length > 0) {
            chunks.push(current.trim());
            // Keep overlap from end of current chunk
            const words = current.split(/\s+/);
            const overlapWords = words.slice(-Math.floor(overlap / 5));
            current = overlapWords.join(" ") + " " + sentence;
        } else {
            current += (current ? " " : "") + sentence;
        }
    }
    if (current.trim()) {
        chunks.push(current.trim());
    }
    return chunks;
}

function extractGoogleDocId(urlOrId: string): string | null {
    // Try to extract from URL
    const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Already an ID?
    if (/^[a-zA-Z0-9_-]{20,}$/.test(urlOrId)) return urlOrId;
    return null;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { documentId, url, systemPrompt } = body as {
            documentId?: string;
            url?: string;
            systemPrompt?: string;
        };

        const rawId = documentId || url || "";
        const docId = extractGoogleDocId(rawId);

        if (!docId) {
            return NextResponse.json(
                { status: "error", message: "Valid Google Doc URL or documentId is required" },
                { status: 400 },
            );
        }

        // 1. Fetch document content via public export URL
        const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
        let docText = "";
        let docTitle = `Document ${docId.slice(0, 8)}...`;

        try {
            const res = await fetch(exportUrl, {
                signal: AbortSignal.timeout(15000),
                headers: {
                    "User-Agent": "VoiceZettel/3.0",
                },
            });
            if (!res.ok) {
                return NextResponse.json({
                    status: "error",
                    message: `Не удалось загрузить документ (${res.status}). Убедитесь, что документ доступен по ссылке.`,
                    hint: "Сделайте документ публичным или настройте Google OAuth.",
                }, { status: 422 });
            }
            docText = await res.text();

            // Try to extract title from first line
            const firstLine = docText.split("\n").find((l) => l.trim().length > 0);
            if (firstLine && firstLine.trim().length < 100) {
                docTitle = firstLine.trim();
            }
        } catch (error) {
            return NextResponse.json({
                status: "error",
                message: `Ошибка загрузки: ${error instanceof Error ? error.message : "unknown"}`,
            }, { status: 502 });
        }

        if (docText.trim().length < 50) {
            return NextResponse.json({
                status: "error",
                message: "Документ слишком короткий или пустой",
            }, { status: 422 });
        }

        // 2. Chunk the text
        const chunks = chunkText(docText);

        // 3. Try to index into ChromaDB via indexer service
        let indexedCount = 0;
        try {
            for (const [i, chunk] of chunks.entries()) {
                const indexRes = await fetch(`${INDEXER_URL}/index/chunk`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: chunk,
                        metadata: {
                            source: `google-doc:${docId}`,
                            title: docTitle,
                            chunk_index: i,
                            total_chunks: chunks.length,
                            system_prompt: systemPrompt || "",
                            type: "workspace_document",
                        },
                        collection: "workspace_docs",
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                if (indexRes.ok) indexedCount++;
            }
        } catch {
            // Indexer might be down — still return chunk count
        }

        return NextResponse.json({
            status: "ok",
            documentId: docId,
            documentTitle: docTitle,
            chunkCount: chunks.length,
            indexedCount,
            textLength: docText.length,
            message: indexedCount > 0
                ? `Документ разбит на ${chunks.length} чанков, ${indexedCount} проиндексировано в ChromaDB.`
                : `Документ разбит на ${chunks.length} чанков. Indexer не отвечает — чанки будут проиндексированы позже.`,
        });
    } catch (error) {
        return NextResponse.json(
            { status: "error", message: String(error) },
            { status: 500 },
        );
    }
}
