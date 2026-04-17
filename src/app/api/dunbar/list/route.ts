/**
 * @module api/dunbar/list
 * Lists people in Dunbar circles from ChromaDB/memory.
 * People are stored as memories tagged with "person" category.
 * Used by DunbarTab in admin panel.
 * Falls back to GOLDEN_CIRCLE when ChromaDB has no person data.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { GOLDEN_CIRCLE, type GoldenPerson } from "@/lib/goldenContext";

const INDEXER_URL = process.env.INDEXER_SERVICE_URL ?? "http://127.0.0.1:8030";

interface DunbarPerson {
    id: string;
    name: string;
    circle: 1 | 2 | 3 | 4 | 5;
    relation: string;
    lastContact: string;
    contactFrequency: "daily" | "weekly" | "monthly" | "rarely";
    channels: string[];
    notes: string;
    sentiment: number;
    source: "golden" | "chroma" | "memory";
}

/**
 * Convert a GoldenPerson to a DunbarPerson for the UI.
 */
function goldenToDunbar(p: GoldenPerson): DunbarPerson {
    const freqMap: Record<number, DunbarPerson["contactFrequency"]> = {
        1: "daily",
        2: "weekly",
        3: "monthly",
    };
    return {
        id: `golden-${p.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: p.name,
        circle: p.circle as 1 | 2 | 3,
        relation: p.relation,
        lastContact: new Date().toISOString(),
        contactFrequency: freqMap[p.circle] ?? "monthly",
        channels: p.channels ?? ["telegram"],
        notes: [p.role, p.notes].filter(Boolean).join(" | "),
        sentiment: p.circle === 1 ? 0.8 : p.circle === 2 ? 0.5 : 0.3,
        source: "golden",
    };
}

export async function GET(req: NextRequest) {
    const userId = req.nextUrl.searchParams.get("userId") ?? "anonymous";

    // Start with golden circle as the guaranteed base
    const goldenPeople = GOLDEN_CIRCLE.map(goldenToDunbar);

    try {
        // Search ChromaDB for person memories
        const res = await fetch(`${INDEXER_URL}/search/hybrid`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: "person человек контакт друг семья коллега",
                top_k: 150,
                source_type: null,
                user_id: userId,
            }),
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            // ChromaDB unavailable — return golden circle only
            return NextResponse.json({ people: goldenPeople, total: goldenPeople.length, source: "golden_only" });
        }

        const results = await res.json() as Array<{
            id?: string;
            text: string;
            metadata: Record<string, string>;
            score?: number;
        }>;

        // Filter for person-tagged entries
        const chromaPeople: DunbarPerson[] = results
            .filter((r) => {
                const tags = (r.metadata?.tags ?? "").toLowerCase();
                const category = (r.metadata?.category ?? "").toLowerCase();
                return tags.includes("person") || tags.includes("человек") ||
                       category === "person" || category === "persons" ||
                       tags.includes("[counter:persons]");
            })
            .map((r) => {
                const lines = r.text.split("\n").filter((l) => l.trim());
                const name = lines[0]?.replace(/^#+\s*/, "").replace(/^\[person\]\s*/i, "").trim() || "Без имени";
                const description = lines.slice(1).join(" ").trim();

                // Parse circle from metadata or default to 3
                let circle: DunbarPerson["circle"] = 3;
                const circleStr = r.metadata?.circle ?? r.metadata?.dunbar_circle;
                if (circleStr) {
                    const parsed = parseInt(circleStr, 10);
                    if (parsed >= 1 && parsed <= 5) circle = parsed as DunbarPerson["circle"];
                }

                // Infer circle from relation keywords
                const lowerText = (r.text + " " + (r.metadata?.relation ?? "")).toLowerCase();
                if (!circleStr) {
                    if (lowerText.includes("жена") || lowerText.includes("муж") || lowerText.includes("мама") || lowerText.includes("папа")) {
                        circle = 1;
                    } else if (lowerText.includes("друг") || lowerText.includes("подруга") || lowerText.includes("брат") || lowerText.includes("сестра")) {
                        circle = 2;
                    } else if (lowerText.includes("коллег") || lowerText.includes("партнёр")) {
                        circle = 3;
                    }
                }

                // Parse relation
                const relation = r.metadata?.relation ?? (
                    lowerText.includes("жена") ? "жена" :
                    lowerText.includes("друг") ? "друг" :
                    lowerText.includes("коллег") ? "коллега" : "контакт"
                );

                // Channels
                const channels: string[] = [];
                if (lowerText.includes("telegram") || lowerText.includes("тг")) channels.push("telegram");
                if (lowerText.includes("телефон") || lowerText.includes("звон")) channels.push("phone");
                if (lowerText.includes("встреч") || lowerText.includes("meet")) channels.push("meet");
                if (channels.length === 0) channels.push("telegram");

                return {
                    id: r.id || r.metadata?.id || crypto.randomUUID(),
                    name,
                    circle,
                    relation,
                    lastContact: r.metadata?.last_contact ?? r.metadata?.updated_at ?? new Date().toISOString(),
                    contactFrequency: (r.metadata?.frequency as DunbarPerson["contactFrequency"]) ?? "monthly",
                    channels,
                    notes: description.slice(0, 200),
                    sentiment: parseFloat(r.metadata?.sentiment ?? "0") || 0,
                    source: "chroma" as const,
                };
            });

        // Merge: golden circle + chroma people (golden takes priority by name)
        const allPeople = [...goldenPeople];
        const goldenNames = new Set(goldenPeople.map((p) => p.name.toLowerCase().replace(/\s+/g, " ").trim()));

        for (const cp of chromaPeople) {
            const key = cp.name.toLowerCase().replace(/\s+/g, " ").trim();
            if (!goldenNames.has(key)) {
                allPeople.push(cp);
                goldenNames.add(key);
            }
        }

        // Deduplicate by name (keep most recent)
        const seen = new Map<string, DunbarPerson>();
        for (const p of allPeople) {
            const key = p.name.toLowerCase().replace(/\s+/g, " ").trim();
            if (!seen.has(key) || new Date(p.lastContact) > new Date(seen.get(key)!.lastContact)) {
                seen.set(key, p);
            }
        }

        const deduped = Array.from(seen.values()).sort((a, b) => a.circle - b.circle);

        return NextResponse.json({ people: deduped, total: deduped.length, source: "merged" });
    } catch (err) {
        logger.error("[Dunbar API]", (err as Error).message);
        // Even on error, return golden circle
        return NextResponse.json({ people: goldenPeople, total: goldenPeople.length, source: "golden_fallback" });
    }
}

