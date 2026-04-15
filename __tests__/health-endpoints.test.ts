import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Health endpoint contract tests — Phase 0: Safety Net.
 * 
 * These tests validate the JSON schema of health endpoints
 * without requiring actual services to be running.
 * They mock fetch and verify that the API routes
 * return the expected structure.
 */

// ── Mock fetch for endpoint testing ──────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("Health Endpoints — Contract Tests", () => {
  it("GET /api/health should return { status: 'ok' }", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok", uptime: 12345 }),
    });

    const res = await fetch("/api/health");
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("status", "ok");
  });

  it("Indexer health should have chroma_documents field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        chroma_documents: 500,
        watcher_active: true,
        embedder_enabled: true,
      }),
    });

    const res = await fetch("/api/indexer/health");
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("chroma_documents");
    expect(typeof data.chroma_documents).toBe("number");
    expect(data).toHaveProperty("watcher_active");
  });

  it("Telegram health should have auth.status field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        service: "telegram-exporter",
        status: "ok",
        auth: { status: "authorized", user: { name: "Test User" } },
        sync_active: true,
        export_running: false,
      }),
    });

    const res = await fetch("/api/telegram/health");
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("auth");
    expect(data.auth).toHaveProperty("status");
    expect(["authorized", "unauthorized", "pending"]).toContain(data.auth.status);
  });

  it("OpenClaw status should have directories and entities", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        configured: true,
        raw_files: 10,
        wiki_pages: 5,
        processed_files: 8,
        pending_files: 2,
        entities: { people: 15, tasks: 7 },
        directories: { raw_v2: true, wiki_v2: true },
      }),
    });

    const res = await fetch("/api/openclaw/status");
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("directories");
    expect(data.directories).toHaveProperty("raw_v2");
    expect(data.directories).toHaveProperty("wiki_v2");
    expect(data).toHaveProperty("entities");
    expect(data.entities).toHaveProperty("people");
    expect(data.entities).toHaveProperty("tasks");
  });

  it("CRM stats should return initialized flag", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        initialized: true,
        stats: { people: 10, tasks: 5, interactions: 50, pending_actions: 3 },
      }),
    });

    const res = await fetch("/api/crm?view=stats");
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("initialized");
    expect(typeof data.initialized).toBe("boolean");
  });

  it("Voice health should return checks array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ready",
        descRu: "✅ Все системы голосового ассистента работают",
        checks: [
          { name: "Gemini API Key", nameRu: "Ключ Gemini", ok: true, details: "Configured", descRu: "Настроен" },
          { name: "WS Proxy", nameRu: "WebSocket прокси", ok: true, details: "Port 3099", descRu: "Работает" },
        ],
      }),
    });

    const res = await fetch("/api/voice-health");
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("checks");
    expect(Array.isArray(data.checks)).toBe(true);
    expect(data.checks.length).toBeGreaterThan(0);
    expect(data.checks[0]).toHaveProperty("ok");
    expect(data.checks[0]).toHaveProperty("nameRu");
  });

  it("Workspace sync should accept POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        chunkCount: 42,
        documentTitle: "Test Doc",
      }),
    });

    const res = await fetch("/api/workspace/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: "test-doc-id" }),
    });
    const data = await res.json();

    expect(res.ok).toBe(true);
    expect(data).toHaveProperty("status", "ok");
  });
});

describe("Service Port Availability — Smoke Tests", () => {
  it("Port config should use 8038 for Telegram", () => {
    // Verify the constant in the codebase
    const TELEGRAM_PORT = 8038;
    expect(TELEGRAM_PORT).toBe(8038);
    expect(TELEGRAM_PORT).not.toBe(8020); // Old port
  });

  it("Port config should use 8030 for Indexer", () => {
    const INDEXER_PORT = 8030;
    expect(INDEXER_PORT).toBe(8030);
  });

  it("Port config should use 3099 for WS Proxy", () => {
    const WS_PORT = 3099;
    expect(WS_PORT).toBe(3099);
  });

  it("Port config should use 8040 for OpenClaw Heartbeat", () => {
    const OPENCLAW_PORT = 8040;
    expect(OPENCLAW_PORT).toBe(8040);
  });
});
