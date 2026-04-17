/**
 * @module contextCache
 * Server-side LRU cache for vault context, ChromaDB results, and compiled rules.
 * 
 * Reduces mic activation latency from 6-8 sec to <2 sec by caching
 * expensive context-building operations.
 * 
 * TTL: 60 seconds (configurable).
 * Invalidated when vault changes or user explicitly requests refresh.
 */

import { logger } from "@/lib/logger";

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    createdAt: number;
}

const DEFAULT_TTL_MS = 60_000; // 60 seconds

class ContextCacheStore {
    private store = new Map<string, CacheEntry<unknown>>();
    private maxEntries = 50;

    get<T>(key: string): T | null {
        const entry = this.store.get(key) as CacheEntry<T> | undefined;
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    set<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
        // Evict oldest entries if at capacity
        if (this.store.size >= this.maxEntries) {
            const oldest = [...this.store.entries()]
                .sort((a, b) => a[1].createdAt - b[1].createdAt);
            if (oldest.length > 0) {
                this.store.delete(oldest[0][0]);
            }
        }

        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
            createdAt: Date.now(),
        });
    }

    invalidate(key: string): void {
        this.store.delete(key);
    }

    invalidateAll(): void {
        this.store.clear();
        logger.info("[ContextCache] All entries invalidated");
    }

    has(key: string): boolean {
        const entry = this.store.get(key);
        if (!entry) return false;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return false;
        }
        return true;
    }

    getStats(): { size: number; keys: string[] } {
        // Clean expired entries first
        for (const [key, entry] of this.store.entries()) {
            if (Date.now() > entry.expiresAt) {
                this.store.delete(key);
            }
        }
        return {
            size: this.store.size,
            keys: [...this.store.keys()],
        };
    }
}

/** Singleton cache instance */
export const contextCache = new ContextCacheStore();

// ── Typed cache helpers ──────────────────────────────────────

export function getCachedVaultContext(): string | null {
    return contextCache.get<string>("vault_context");
}

export function setCachedVaultContext(ctx: string, ttlMs = DEFAULT_TTL_MS): void {
    contextCache.set("vault_context", ctx, ttlMs);
}

export function getCachedChromaResults(query: string): string | null {
    return contextCache.get<string>(`chroma:${query.slice(0, 50)}`);
}

export function setCachedChromaResults(query: string, results: string, ttlMs = DEFAULT_TTL_MS): void {
    contextCache.set(`chroma:${query.slice(0, 50)}`, results, ttlMs);
}

export function getCachedCompiledRules(): string | null {
    return contextCache.get<string>("compiled_rules");
}

export function setCachedCompiledRules(rules: string, ttlMs = 300_000): void {
    // 5 min TTL — rules change rarely
    contextCache.set("compiled_rules", rules, ttlMs);
}

export function getCachedGoldenContext(): string | null {
    return contextCache.get<string>("golden_context");
}

export function setCachedGoldenContext(ctx: string): void {
    // Golden context is static — cache for 10 minutes
    contextCache.set("golden_context", ctx, 600_000);
}

// ── Full token response cache (fast reconnect) ─────────────

interface CachedTokenResponse {
    vaultContext: string;
    compiledRules: string;
    empathyBlock: string;
    contextSummary: Record<string, unknown>;
}

export function getCachedTokenResponse(): CachedTokenResponse | null {
    return contextCache.get<CachedTokenResponse>("token_full_response");
}

export function setCachedTokenResponse(data: CachedTokenResponse): void {
    // 30s TTL — enough for rapid reconnects but fresh enough for real context
    contextCache.set("token_full_response", data, 30_000);
    logger.info(`[ContextCache] Token response cached (30s TTL, ${data.vaultContext.length} chars)`);
}
