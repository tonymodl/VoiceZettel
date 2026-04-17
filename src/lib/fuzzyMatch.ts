/**
 * @module fuzzyMatch
 * Fuzzy name matching for Telegram chat folders and Golden Circle people.
 * 
 * Uses Levenshtein distance + substring matching + alias lookup.
 * Critical for resolving "Настюша" → "Настя Рудакова" or
 * folder "Убн Настя" → person "Настя Рудакова".
 */

import type { GoldenPerson } from "@/lib/goldenContext";

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
    const la = a.length;
    const lb = b.length;
    const dp: number[][] = Array.from({ length: la + 1 }, () =>
        Array.from({ length: lb + 1 }, () => 0),
    );

    for (let i = 0; i <= la; i++) dp[i][0] = i;
    for (let j = 0; j <= lb; j++) dp[0][j] = j;

    for (let i = 1; i <= la; i++) {
        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,       // deletion
                dp[i][j - 1] + 1,       // insertion
                dp[i - 1][j - 1] + cost, // substitution
            );
        }
    }

    return dp[la][lb];
}

/**
 * Normalize a name for comparison: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check if query fuzzy-matches a target name.
 * Returns a score 0-100 (100 = exact match, 0 = no match).
 */
export function fuzzyScore(query: string, target: string): number {
    const q = normalize(query);
    const t = normalize(target);

    // Exact match
    if (q === t) return 100;

    // Substring match (either direction)
    if (t.includes(q)) return 85;
    if (q.includes(t)) return 80;

    // First name match
    const qFirst = q.split(" ")[0];
    const tFirst = t.split(" ")[0];
    if (qFirst === tFirst && qFirst.length >= 3) return 75;

    // First name substring
    if (tFirst.includes(qFirst) && qFirst.length >= 3) return 65;
    if (qFirst.includes(tFirst) && tFirst.length >= 3) return 60;

    // Levenshtein on the shorter string vs each word
    const tWords = t.split(" ");
    for (const word of tWords) {
        if (word.length < 3) continue;
        const dist = levenshtein(q, word);
        if (dist <= 2) return Math.max(0, 70 - dist * 10);
    }

    // Full levenshtein
    const fullDist = levenshtein(q, t);
    const maxLen = Math.max(q.length, t.length);
    if (maxLen === 0) return 0;
    const similarity = (1 - fullDist / maxLen) * 100;
    return Math.max(0, Math.floor(similarity));
}

/**
 * Find matching people from Golden Circle by query.
 * Checks name, aliases, relation, and notes.
 * Returns matches sorted by score, filtered by minScore.
 */
export function fuzzyFindPerson(
    query: string,
    people: GoldenPerson[],
    minScore = 50,
): Array<{ person: GoldenPerson; score: number; matchedOn: string }> {
    const results: Array<{ person: GoldenPerson; score: number; matchedOn: string }> = [];

    for (const person of people) {
        let bestScore = 0;
        let matchedOn = "";

        // Check main name
        const nameScore = fuzzyScore(query, person.name);
        if (nameScore > bestScore) {
            bestScore = nameScore;
            matchedOn = `name: ${person.name}`;
        }

        // Check aliases
        if (person.aliases) {
            for (const alias of person.aliases) {
                const aliasScore = fuzzyScore(query, alias);
                if (aliasScore > bestScore) {
                    bestScore = aliasScore;
                    matchedOn = `alias: ${alias}`;
                }
            }
        }

        // Check relation
        const relScore = fuzzyScore(query, person.relation);
        if (relScore > bestScore) {
            bestScore = relScore;
            matchedOn = `relation: ${person.relation}`;
        }

        if (bestScore >= minScore) {
            results.push({ person, score: bestScore, matchedOn });
        }
    }

    return results.sort((a, b) => b.score - a.score);
}

/**
 * Find the best matching Telegram folder name for a person query.
 * Scans a list of folder names and returns the best fuzzy match.
 */
export function fuzzyFindFolder(
    query: string,
    folderNames: string[],
    minScore = 45,
): Array<{ folder: string; score: number }> {
    const results: Array<{ folder: string; score: number }> = [];

    for (const folder of folderNames) {
        const score = fuzzyScore(query, folder);
        if (score >= minScore) {
            results.push({ folder, score });
        }
    }

    return results.sort((a, b) => b.score - a.score);
}

/**
 * Match a person name to their Telegram folder(s).
 * Uses both the person's name AND aliases to find folders.
 */
export function matchPersonToFolders(
    person: GoldenPerson,
    folderNames: string[],
    minScore = 45,
): string[] {
    const allQueries = [person.name, ...(person.aliases ?? [])];
    const matchedFolders = new Set<string>();

    for (const query of allQueries) {
        const matches = fuzzyFindFolder(query, folderNames, minScore);
        for (const m of matches) {
            matchedFolders.add(m.folder);
        }
    }

    return [...matchedFolders];
}
