import { describe, it, expect } from 'vitest';

/**
 * Smoke tests for service health endpoints.
 * These tests verify the API route handlers can be imported and respond correctly.
 * They run in isolation (no live servers needed) by testing the route handler functions directly.
 */

describe('Service Health Endpoints (Unit)', () => {
  it('GET /api/health route handler exists and exports GET', async () => {
    const mod = await import('@/app/api/health/route');
    expect(mod.GET).toBeDefined();
    expect(typeof mod.GET).toBe('function');
  });

  it('/api/health returns valid JSON with expected shape', async () => {
    const { GET } = await import('@/app/api/health/route');
    const request = new Request('http://localhost:3000/api/health');
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('status');
  });

  it('WebSocket proxy config is correct (port 3099)', () => {
    // Verify the ws-proxy.js configuration without starting a server
    const fs = require('fs');
    const proxyCode = fs.readFileSync('ws-proxy.js', 'utf-8');
    expect(proxyCode).toContain('3099');
    expect(proxyCode).toContain('generativelanguage.googleapis.com');
    expect(proxyCode).toContain('WebSocketServer');
  });

  it('Telegram service main.py exists and has /health endpoint', () => {
    const fs = require('fs');
    const mainPy = fs.readFileSync('services/telegram/main.py', 'utf-8');
    expect(mainPy).toContain('/health');
    expect(mainPy).toContain('FastAPI');
    expect(mainPy).toContain('8038');
  });

  it('Indexer service main.py exists and has /health endpoint', () => {
    const fs = require('fs');
    const mainPy = fs.readFileSync('services/indexer/main.py', 'utf-8');
    expect(mainPy).toContain('/health');
    expect(mainPy).toContain('FastAPI');
    expect(mainPy).toContain('8030');
  });
});

describe('Critical File Integrity', () => {
  it('obsidian_writer.py exists and has write functions', () => {
    const fs = require('fs');
    const writer = fs.readFileSync('services/telegram/obsidian_writer.py', 'utf-8');
    expect(writer).toContain('class ObsidianWriter');
    expect(writer).toContain('def ');
  });

  it('live_sync.py exists and has LiveSync class', () => {
    const fs = require('fs');
    const sync = fs.readFileSync('services/telegram/live_sync.py', 'utf-8');
    expect(sync).toContain('class LiveSync');
  });

  it('.env.example exists with required variables', () => {
    const fs = require('fs');
    const env = fs.readFileSync('.env.example', 'utf-8');
    expect(env).toContain('GOOGLE_GEMINI_API_KEY');
  });
});
