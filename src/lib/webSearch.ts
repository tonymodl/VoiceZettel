/**
 * @module webSearch
 * Zero-dependency web search via DuckDuckGo HTML endpoint.
 * Parses top-N results (title + snippet + URL) from the HTML response.
 * Designed for LLM function calling — returns structured JSON.
 */
import { logger } from "@/lib/logger";

export interface SearchResult {
    title: string;
    snippet: string;
    url: string;
}

export interface SearchResponse {
    results: SearchResult[];
    query: string;
    timestamp: string;
    source: "duckduckgo";
}

const DDG_URL = "https://html.duckduckgo.com/html/";
const MAX_RESULTS = 5;
const TIMEOUT_MS = 6000;

/**
 * Search the web via DuckDuckGo HTML endpoint.
 * Zero external dependencies — uses only fetch + regex parsing.
 */
export async function webSearch(query: string): Promise<SearchResponse> {
    const timestamp = new Date().toISOString();

    if (!query.trim()) {
        return { results: [], query, timestamp, source: "duckduckgo" };
    }

    try {
        const formData = new URLSearchParams({ q: query, kl: "ru-ru" });

        const res = await fetch(DDG_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: formData.toString(),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
            logger.warn(`[webSearch] DuckDuckGo returned ${res.status}`);
            return { results: [], query, timestamp, source: "duckduckgo" };
        }

        const html = await res.text();
        const results = parseResults(html);

        logger.info(`[webSearch] "${query}" → ${results.length} results`);
        return { results, query, timestamp, source: "duckduckgo" };
    } catch (err) {
        logger.warn(`[webSearch] Error: ${err instanceof Error ? err.message : String(err)}`);
        return { results: [], query, timestamp, source: "duckduckgo" };
    }
}

/**
 * Parse DuckDuckGo HTML response into structured results.
 * Uses regex to extract result blocks — no DOM parser needed.
 */
function parseResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo HTML results are in <div class="result ..."> blocks
    // Each has: <a class="result__a" href="...">Title</a>
    // And: <a class="result__snippet">Snippet text</a>

    // Extract result blocks
    const resultBlockRegex = /<div[^>]*class="[^"]*result[^"]*results_links[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = resultBlockRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
        const block = blockMatch[1];

        // Extract URL from result__a link
        const urlMatch = block.match(/href="([^"]+)"/);
        // Extract title text
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
        // Extract snippet
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

        if (urlMatch && titleMatch) {
            let url = urlMatch[1];
            // DuckDuckGo wraps URLs in redirect — extract real URL
            if (url.includes("uddg=")) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
            }

            const title = decodeHtmlEntities(titleMatch[1].trim());
            const snippet = snippetMatch
                ? decodeHtmlEntities(stripHtml(snippetMatch[1]).trim())
                : "";

            // Skip DuckDuckGo internal links
            if (url.startsWith("http")) {
                results.push({ title, snippet, url });
            }
        }
    }

    // Fallback: try simpler pattern if above yields nothing
    if (results.length === 0) {
        const simpleLinkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        let linkMatch: RegExpExecArray | null;

        while ((linkMatch = simpleLinkRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
            let url = linkMatch[1];
            if (url.includes("uddg=")) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
            }
            if (url.startsWith("http")) {
                results.push({
                    title: decodeHtmlEntities(linkMatch[2].trim()),
                    snippet: "",
                    url,
                });
            }
        }
    }

    return results;
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}
