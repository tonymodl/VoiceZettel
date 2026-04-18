import { NextRequest, NextResponse } from "next/server";
import { loadVaultContext } from "@/lib/vaultContext";
import { logger } from "@/lib/logger";
import { allocateContext, getPredictedQueries } from "@/lib/contextManager";
import { loadCompiledRules } from "@/lib/requirementsSynthesizer";
import { buildEmpathyPromptBlock } from "@/lib/empathyEngine";
import { getBangkokToday, getBangkokYesterday } from "@/lib/timezone";
import { matchPersonToFolders } from "@/lib/fuzzyMatch";
import { getCachedVaultContext, setCachedVaultContext, getCachedGoldenContext, setCachedGoldenContext, getCachedTokenResponse, setCachedTokenResponse } from "@/lib/contextCache";
import { loadLastSessionSummary } from "@/lib/sessionSummarizer";

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

/**
 * Extract just title + short essence from each Zettelkasten note.
 * Deduplicates by normalized title. Returns newest first.
 */
function condenseVaultNotes(rawContext: string): string {
    const notes = rawContext.split(/\n---\s+\//).filter(Boolean);
    const seen = new Set<string>();
    const condensed: string[] = [];

    // Reverse so newest (last alphabetically / last loaded) come first
    for (const note of notes.reverse()) {
        const titleMatch = /^#\s+(.+)$/m.exec(note);
        const suttMatch = /^##\s+Суть\s*\n(.+)$/m.exec(note);
        
        let title = titleMatch ? titleMatch[1].trim() : "";
        let essence = "";

        // Zettelkasten: get from 💡 section
        const essenceMatch = /###\s+💡[^\n]*\n([\s\S]*?)(?=\n###|\n---|\n$)/m.exec(note);
        if (essenceMatch) {
            essence = essenceMatch[1].trim().split("\n")[0].trim();
        }
        // Classifier: get from ## Суть  
        if (!essence && suttMatch) {
            essence = suttMatch[1].trim();
        }
        // Fallback: blockquote
        if (!essence) {
            const ctxMatch = />\s*(.+)/m.exec(note);
            if (ctxMatch) essence = ctxMatch[1].trim();
        }

        if (!title && !essence) continue;
        if (!title) title = essence;

        // Dedup by normalized title
        const key = title.toLowerCase().replace(/[^а-яa-z0-9]/g, "").slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);

        // Just title — it already contains the key fact
        condensed.push(`• ${title}`);
    }

    return condensed.join("\n");
}

export async function POST(req: NextRequest) {
    if (!GOOGLE_GEMINI_API_KEY) {
        return NextResponse.json({
            disabled: true,
            reason: "GOOGLE_GEMINI_API_KEY не настроен. Добавьте ключ в .env для активации Gemini Live.",
        });
    }

    let userId = "anonymous";
    let contextPriorities: { critical: number; active: number; predicted: number; recent: number; vault: number; tools: number } | undefined;
    try {
        const body = await req.json() as { userId?: string; contextPriorities?: typeof contextPriorities };
        if (body.userId) userId = body.userId;
        if (body.contextPriorities) contextPriorities = body.contextPriorities;
    } catch {
        // нет тела — anonymous
    }

    // ══════ FAST PATH: Return cached response if available (30s TTL) ══════
    const cachedResponse = getCachedTokenResponse();
    if (cachedResponse) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
        const wsUrl = appUrl
            ? `${appUrl.replace("http://", "ws://").replace("https://", "wss://")}/ws-gemini`
            : "ws://localhost:3099";
        // eslint-disable-next-line no-console
        console.log(`[GeminiLiveToken] ⚡ CACHE HIT (${cachedResponse.vaultContext.length} chars)`);
        return NextResponse.json({
            wsUrl,
            vaultContext: cachedResponse.vaultContext,
            compiledRules: cachedResponse.compiledRules,
            empathyBlock: cachedResponse.empathyBlock,
            contextSummary: cachedResponse.contextSummary,
        });
    }

    // Antigravity: Load vault + ChromaDB in PARALLEL with Context Manager
    const startMs = Date.now();
    const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";
    const CONTEXT_BUDGET = 80000; // 80K chars (~32K tokens, ~25% of 128K) — was 30K which wasted 91% of capacity

    // Dynamic queries from PredictivePreFetcher (replaces hardcoded queries)
    const dynamicQueries = getPredictedQueries();

    // Fire vault + chroma + personal telegram + fresh files concurrently
    const results = await Promise.allSettled([
        // Task 1: Vault notes from Obsidian
        (async () => {
            try {
                const rawVault = await loadVaultContext(userId);
                return rawVault.length > 0 ? condenseVaultNotes(rawVault) : "";
            } catch {
                return "";
            }
        })(),
        // Task 2: ChromaDB context (DYNAMIC queries from PredictivePreFetcher)
        (async () => {
            try {
                const queryResults = await Promise.allSettled(
                    dynamicQueries.map(async (q) => {
                        const res = await fetch(`${INDEXER_URL}/search`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, top_k: 5 }),
                            signal: AbortSignal.timeout(2000),
                        });
                        if (!res.ok) return [];
                        return await res.json() as Array<{
                            text: string;
                            metadata: Record<string, string>;
                            relevance_pct: number;
                        }>;
                    })
                );

                const allResults: string[] = [];
                for (const result of queryResults) {
                    if (result.status !== "fulfilled" || !result.value) continue;
                    for (const r of result.value) {
                        const srcType = r.metadata?.source_type ?? "note";
                        const chatType = r.metadata?.chat_type ?? "";
                        const title = r.metadata?.title ?? "";
                        const date = r.metadata?.date ?? "";

                        let label = "";
                        if (srcType === "telegram") {
                            if (chatType === "private") {
                                label = `📬 ЛИЧНЫЙ ЧАТ с "${title}" (${date})`;
                            } else if (chatType === "group" || chatType === "supergroup") {
                                label = `📬 ГРУППА "${title}" (${date})`;
                            } else if (chatType === "channel") {
                                label = `📬 КАНАЛ "${title}" (${date})`;
                            } else {
                                label = `📬 Telegram "${title}" (${date})`;
                            }
                        } else if (srcType === "session") {
                            label = `📝 Сессия с ассистентом (${date})`;
                        } else {
                            label = `🗃 Заметка "${title}"`;
                        }

                        allResults.push(`${label}:\n${r.text.slice(0, 400)}`);
                    }
                }

                return allResults;
            } catch {
                return [];
            }
        })(),
        // Task 3: PERSONAL Telegram chats (critical for relationship awareness)
        (async () => {
            try {
                const personalQueries = [
                    "личные обсуждения планы обещания",
                    "работа обязательства дедлайн договорились встреча",
                    "настроение просьба помощь ответить",
                ];
                const results = await Promise.allSettled(
                    personalQueries.map(async (q) => {
                        const res = await fetch(`${INDEXER_URL}/search`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                query: q,
                                top_k: 5,
                                chat_type: "private",
                            }),
                            signal: AbortSignal.timeout(2000),
                        });
                        if (!res.ok) return [];
                        return await res.json() as Array<{
                            text: string;
                            metadata: Record<string, string>;
                            relevance_pct: number;
                        }>;
                    })
                );

                const personalCtx: string[] = [];
                const seenIds = new Set<string>();
                for (const result of results) {
                    if (result.status !== "fulfilled" || !result.value) continue;
                    for (const r of result.value) {
                        const id = r.metadata?.file_path ?? r.text.slice(0, 50);
                        if (seenIds.has(id)) continue;
                        seenIds.add(id);
                        const title = r.metadata?.title ?? "Личный чат";
                        const date = r.metadata?.date ?? "";
                        personalCtx.push(`📬 ЛИЧНЫЙ ЧАТ с "${title}" (${date}):\n${r.text.slice(0, 600)}`);
                    }
                }
                return personalCtx;
            } catch {
                return [];
            }
        })(),
        // Task 4: FRESH Telegram files from disk for inner circle contacts
        // ChromaDB semantic search returns stale results (ranked by meaning, not date).
        // Reading files directly GUARANTEES the assistant sees today's messages.
        (async () => {
            try {
                const fs = await import("fs");
                const path = await import("path");
                const { getGoldenCircle } = await import("@/lib/goldenContext");
                const gc = getGoldenCircle();
                
                const vaultPath = process.env.OBSIDIAN_VAULT_PATH 
                    ?? path.join(process.cwd(), "VoiceZettel");
                const telegramDir = path.join(vaultPath, "Raw_v2", "Telegram", "Личные");
                
                // UTC+7 dates — critical for correct day boundary
                const today = getBangkokToday();
                const yesterday = getBangkokYesterday();
                
                const freshChats: string[] = [];
                
                // Read files for each inner circle person (circle 1 & 2)
                for (const person of gc.filter((p: any) => p.circle <= 2)) {
                    // Fuzzy-match person to Telegram folder names using aliases
                    let folderNames: string[] = [];
                    try {
                        if (fs.existsSync(telegramDir)) {
                            const allDirs = fs.readdirSync(telegramDir);
                            folderNames = matchPersonToFolders(person, allDirs, 50);
                        }
                    } catch { /* dir read error */ }
                    
                    // Also include exact name as fallback
                    const possibleNames = new Set([person.name, ...folderNames, ...(person.aliases ?? [])]);
                    const firstName = person.name.split(" ")[0];
                    
                    for (const chatName of possibleNames) {
                        const chatDir = path.join(telegramDir, chatName);
                        
                        for (const dateStr of [today, yesterday]) {
                            const filePath = path.join(chatDir, `${dateStr}.md`);
                            try {
                                if (fs.existsSync(filePath)) {
                                    const content = fs.readFileSync(filePath, "utf-8").trim();
                                    if (content.length > 5) { // skip near-empty files
                                        freshChats.push(
                                            `📬 СВЕЖАЯ ПЕРЕПИСКА с "${person.name}" (${dateStr}):\n${content.slice(0, 2000)}`
                                        );
                                    }
                                }
                            } catch { /* file not found, skip */ }
                        }
                    }
                    
                    // Also search for folders containing person's first name
                    try {
                        if (fs.existsSync(telegramDir)) {
                            const dirs = fs.readdirSync(telegramDir);
                            const matchingDirs = dirs.filter(d => 
                                d.toLowerCase().includes(firstName.toLowerCase()) && 
                                !possibleNames.has(d)
                            );
                            for (const dir of matchingDirs.slice(0, 2)) {
                                for (const dateStr of [today, yesterday]) {
                                    const filePath = path.join(telegramDir, dir, `${dateStr}.md`);
                                    try {
                                        if (fs.existsSync(filePath)) {
                                            const content = fs.readFileSync(filePath, "utf-8").trim();
                                            if (content.length > 5) {
                                                freshChats.push(
                                                    `📬 СВЕЖАЯ ПЕРЕПИСКА с "${dir}" (${dateStr}):\n${content.slice(0, 2000)}`
                                                );
                                            }
                                        }
                                    } catch { /* skip */ }
                                }
                            }
                        }
                    } catch { /* dir read error */ }
                }
                
                return freshChats;
            } catch (e) {
                logger.debug(`[FreshTelegram] Error reading files: ${e}`);
                return [];
            }
        })(),
    ]);

    const condensedVault = results[0].status === "fulfilled" ? results[0].value as string : "";
    const generalChroma = results[1].status === "fulfilled" ? results[1].value as string[] : [];
    const personalTelegram = results[2].status === "fulfilled" ? results[2].value as string[] : [];
    const freshTelegram = results[3].status === "fulfilled" ? results[3].value as string[] : [];
    // Fresh telegram FIRST (today's messages), then personal chats, then general
    const chromaResults = [...freshTelegram, ...personalTelegram, ...generalChroma];

    // Use Context Manager to intelligently allocate budget
    const contextSummary = allocateContext({
        totalBudget: CONTEXT_BUDGET,
        vaultNotes: condensedVault,
        chromaResults,
        userId,
        priorities: contextPriorities,
    });

    // WS URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const wsUrl = appUrl
        ? `${appUrl.replace("http://", "ws://").replace("https://", "wss://")}/ws-gemini`
        : "ws://localhost:3099";

    const elapsedMs = Date.now() - startMs;

    // eslint-disable-next-line no-console
    console.log(`[GeminiLiveToken] userId=${userId}, context=${contextSummary.contextText.length}ch (~${contextSummary.totalTokens}t, ${contextSummary.percentUsed.toFixed(1)}%), critical=${contextSummary.slots.critical.items.length} items, ${elapsedMs}ms`);

    logger.info(`[GeminiLiveToken] userId=${userId}, ${contextSummary.contextText.length}ch, ${contextSummary.totalTokens}t, ${elapsedMs}ms`);

    // Load compiled behavior rules + empathy profile (server-only)
    const compiledRules = loadCompiledRules(userId);
    const empathyBlock = buildEmpathyPromptBlock(userId);

    // CRITICAL: Inject actual golden context text into vaultContext
    // contextManager only reserves BUDGET space with a placeholder,
    // but the actual "Настя Рудакова — жена", "Константин Денисенко — инвестор" text
    // was NEVER included. This caused the assistant to "not know" anyone.
    let goldenText = getCachedGoldenContext();
    if (!goldenText) {
        const { buildGoldenContextBlock } = await import("@/lib/goldenContext");
        goldenText = buildGoldenContextBlock();
        setCachedGoldenContext(goldenText);
    }

    // Load last session summary for context carry-over
    let sessionSummary = "";
    try {
        sessionSummary = await loadLastSessionSummary(userId);
    } catch {
        // non-critical, continue without
    }

    const fullContext = goldenText + "\n\n" + sessionSummary + contextSummary.contextText;

    const responseSummary = {
        totalTokens: contextSummary.totalTokens,
        maxTokens: contextSummary.maxTokens,
        percentUsed: contextSummary.percentUsed,
        slots: Object.fromEntries(
            Object.entries(contextSummary.slots).map(([k, v]) => [
                k,
                { name: v.name, emoji: v.emoji, usedChars: v.usedChars, maxChars: v.maxChars, itemCount: v.items.length },
            ]),
        ),
    };

    // Cache full response for 30s (fast reconnects + prewarm hits)
    setCachedTokenResponse({
        vaultContext: fullContext,
        compiledRules,
        empathyBlock,
        contextSummary: responseSummary,
    });

    return NextResponse.json({
        wsUrl,
        vaultContext: fullContext,
        compiledRules,
        empathyBlock,
        contextSummary: responseSummary,
    });
}
