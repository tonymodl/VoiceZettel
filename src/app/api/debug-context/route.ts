import { NextResponse } from "next/server";
import { loadVaultContext } from "@/lib/vaultContext";

const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";

export async function GET() {
    const results: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        indexer_url: INDEXER_URL,
    };

    // 1. Test vault context
    try {
        const vault = await loadVaultContext("test");
        results.vault_length = vault.length;
        results.vault_preview = vault.slice(0, 200);
    } catch (e) {
        results.vault_error = String(e);
    }

    // 2. Test ChromaDB search
    try {
        const res = await fetch(`${INDEXER_URL}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "переписка Настя диалог", top_k: 3 }),
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            const data = await res.json();
            results.chroma_results = data.length;
            results.chroma_preview = data.map((r: { metadata?: { title?: string; source_type?: string }; text?: string; relevance_pct?: number }) => ({
                title: r.metadata?.title,
                source: r.metadata?.source_type,
                text_len: r.text?.length,
                relevance: r.relevance_pct,
            }));
        } else {
            results.chroma_error = `HTTP ${res.status}`;
        }
    } catch (e) {
        results.chroma_error = String(e);
    }

    // 3. Test indexer health
    try {
        const res = await fetch(`${INDEXER_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            results.indexer_health = await res.json();
        }
    } catch (e) {
        results.indexer_health_error = String(e);
    }

    return NextResponse.json(results, { status: 200 });
}
