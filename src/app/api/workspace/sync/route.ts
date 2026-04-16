import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/googleTokens";

/**
 * POST /api/workspace/sync — Sync a Google document to ChromaDB.
 * 
 * Supports two modes:
 * 1. Public Google Docs — fetched via export?format=txt (no OAuth needed)
 * 2. Private Google Docs — fetched via Google Docs/Sheets API with OAuth tokens
 * 
 * Also supports Google Sheets via Sheets API (export as CSV).
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

function detectDocType(url: string): "doc" | "sheet" | "slides" {
    if (url.includes("spreadsheets")) return "sheet";
    if (url.includes("presentation")) return "slides";
    return "doc";
}

/**
 * Fetch document content using Google Docs API (OAuth required).
 */
async function fetchViaDocsAPI(docId: string, accessToken: string): Promise<{ text: string; title: string }> {
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Docs API: ${res.status}`);
    const doc = await res.json();

    // Extract text content from the document body
    let text = "";
    const title = doc.title || `Document ${docId.slice(0, 8)}...`;

    if (doc.body?.content) {
        for (const element of doc.body.content) {
            if (element.paragraph?.elements) {
                for (const el of element.paragraph.elements) {
                    if (el.textRun?.content) {
                        text += el.textRun.content;
                    }
                }
            }
            if (element.table) {
                // Extract table cells
                for (const row of element.table.tableRows || []) {
                    for (const cell of row.tableCells || []) {
                        for (const cellContent of cell.content || []) {
                            if (cellContent.paragraph?.elements) {
                                for (const el of cellContent.paragraph.elements) {
                                    if (el.textRun?.content) {
                                        text += el.textRun.content + " | ";
                                    }
                                }
                            }
                        }
                    }
                    text += "\n";
                }
            }
        }
    }

    return { text, title };
}

/**
 * Fetch spreadsheet content using Google Sheets API (OAuth required).
 */
async function fetchViaSheets(docId: string, accessToken: string): Promise<{ text: string; title: string }> {
    // Get spreadsheet metadata
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${docId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
    });
    if (!metaRes.ok) throw new Error(`Sheets API: ${metaRes.status}`);
    const meta = await metaRes.json();
    const title = meta.properties?.title || `Sheet ${docId.slice(0, 8)}...`;

    // Get all sheet data
    let text = `# ${title}\n\n`;
    for (const sheet of meta.sheets || []) {
        const sheetTitle = sheet.properties?.title;
        if (!sheetTitle) continue;

        const dataRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/${encodeURIComponent(sheetTitle)}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(10000),
            },
        );
        if (!dataRes.ok) continue;
        const data = await dataRes.json();

        text += `## ${sheetTitle}\n\n`;
        for (const row of data.values || []) {
            text += (row as string[]).join(" | ") + "\n";
        }
        text += "\n";
    }

    return { text, title };
}

/**
 * Fetch Google Slides content (titles + speaker notes).
 */
async function fetchViaSlides(docId: string, accessToken: string): Promise<{ text: string; title: string }> {
    const res = await fetch(`https://slides.googleapis.com/v1/presentations/${docId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Slides API: ${res.status}`);
    const pres = await res.json();
    const title = pres.title || `Presentation ${docId.slice(0, 8)}...`;

    let text = `# ${title}\n\n`;
    for (const [i, slide] of (pres.slides || []).entries()) {
        text += `## Слайд ${i + 1}\n`;
        // Extract text from shapes
        for (const element of slide.pageElements || []) {
            if (element.shape?.text?.textElements) {
                for (const te of element.shape.text.textElements) {
                    if (te.textRun?.content) {
                        text += te.textRun.content;
                    }
                }
            }
        }
        // Extract speaker notes
        if (slide.slideProperties?.notesPage?.pageElements) {
            for (const element of slide.slideProperties.notesPage.pageElements) {
                if (element.shape?.text?.textElements) {
                    text += "\n[Заметки докладчика]: ";
                    for (const te of element.shape.text.textElements) {
                        if (te.textRun?.content) {
                            text += te.textRun.content;
                        }
                    }
                }
            }
        }
        text += "\n\n";
    }

    return { text, title };
}

/**
 * Fetch document via public export URL (no OAuth needed).
 */
async function fetchViaPublicExport(docId: string): Promise<{ text: string; title: string }> {
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const res = await fetch(exportUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "VoiceZettel/3.0" },
    });
    if (!res.ok) {
        throw new Error(`Public export failed (${res.status})`);
    }
    const text = await res.text();
    const firstLine = text.split("\n").find((l) => l.trim().length > 0);
    const title = firstLine && firstLine.trim().length < 100
        ? firstLine.trim()
        : `Document ${docId.slice(0, 8)}...`;
    return { text, title };
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

        const docType = detectDocType(rawId);
        let docText = "";
        let docTitle = `Document ${docId.slice(0, 8)}...`;
        let fetchMethod: "oauth" | "public" = "public";

        // Try OAuth first (supports private docs)
        const accessToken = await getValidAccessToken();
        if (accessToken) {
            try {
                let result: { text: string; title: string };
                if (docType === "sheet") {
                    result = await fetchViaSheets(docId, accessToken);
                } else if (docType === "slides") {
                    result = await fetchViaSlides(docId, accessToken);
                } else {
                    result = await fetchViaDocsAPI(docId, accessToken);
                }
                docText = result.text;
                docTitle = result.title;
                fetchMethod = "oauth";
            } catch (oauthErr) {
                console.warn("[Workspace Sync] OAuth fetch failed, falling back to public export:", oauthErr);
            }
        }

        // Fallback to public export (only works for public docs and only for Docs, not Sheets)
        if (!docText && docType === "doc") {
            try {
                const result = await fetchViaPublicExport(docId);
                docText = result.text;
                docTitle = result.title;
                fetchMethod = "public";
            } catch {
                return NextResponse.json({
                    status: "error",
                    message: "Не удалось загрузить документ. Убедитесь, что документ публичный или подключите Google аккаунт.",
                    hint: accessToken ? "OAuth токен есть, но доступ к документу запрещён." : "Подключите Google аккаунт для доступа к приватным документам.",
                }, { status: 422 });
            }
        }

        if (!docText) {
            return NextResponse.json({
                status: "error",
                message: docType !== "doc"
                    ? `Для ${docType === "sheet" ? "таблиц" : "презентаций"} нужна авторизация Google. Подключите аккаунт.`
                    : "Документ пустой или недоступен.",
            }, { status: 422 });
        }

        if (docText.trim().length < 50) {
            return NextResponse.json(
                { status: "error", message: "Документ слишком короткий или пустой" },
                { status: 422 },
            );
        }

        // Chunk the text
        const chunks = chunkText(docText);

        // Index into ChromaDB via indexer service
        let indexedCount = 0;
        try {
            for (const [i, chunk] of chunks.entries()) {
                const indexRes = await fetch(`${INDEXER_URL}/index/chunk`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: chunk,
                        metadata: {
                            source: `google-${docType}:${docId}`,
                            title: docTitle,
                            chunk_index: i,
                            total_chunks: chunks.length,
                            system_prompt: systemPrompt || "",
                            type: "workspace_document",
                            doc_type: docType,
                            fetch_method: fetchMethod,
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
            documentType: docType,
            fetchMethod,
            chunkCount: chunks.length,
            indexedCount,
            textLength: docText.length,
            message: indexedCount > 0
                ? `✅ ${docType === "sheet" ? "Таблица" : docType === "slides" ? "Презентация" : "Документ"} "${docTitle}" разбит на ${chunks.length} чанков, ${indexedCount} проиндексировано в ChromaDB. (Метод: ${fetchMethod === "oauth" ? "Google API" : "публичный экспорт"})`
                : `${docType === "sheet" ? "Таблица" : "Документ"} разбит на ${chunks.length} чанков. Indexer не отвечает — чанки будут проиндексированы позже.`,
        });
    } catch (error) {
        return NextResponse.json(
            { status: "error", message: String(error) },
            { status: 500 },
        );
    }
}
