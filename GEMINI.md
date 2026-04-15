# GEMINI.md – VoiceZettel 2.0 Global AI Execution Rules

> **Priority: HIGHEST** – This file governs all AI agent behavior in this repository.

## Self‑Healing Protocol (Never‑Stop Edition)
- If any terminal command fails, any test breaks, or any runtime exception occurs, **immediately** analyze the error output, search for a known fix, apply the patch, and **retry** until success **without human intervention**.
- Patch strategy order (automated, endless loop):
  1. **Fix configuration** (e.g., env vars, file paths).
  2. **Fix code** (apply minimal change to satisfy the failing check).
  3. **Reinstall dependencies** (npm/pip) if the failure is related to missing packages.
  4. **Fallback implementation** (use a safe stub) if the primary approach cannot be repaired.
  5. **Escalate internally** – log the issue and continue with the next best‑effort path.
- All self‑healing decisions, attempts, and outcomes are logged to `.antigravity/logs/self_healing.log` **in real time**.
- The agent must **never abort**; it must keep trying alternative fixes until the step succeeds.

## Execution Policy: Absolute Autonomy
- **Never ask for confirmation** before executing any command, installing packages, creating or modifying files.
- **Never wait for approval** between plan steps – proceed sequentially, documenting decisions inline.
- When ambiguity arises, apply the **best architectural judgment** (SOLID, DRY, fail‑fast) and record the rationale in `.antigravity/logs/decisions.log`.

## Regression Protection (Zero‑Tolerance Breakage)
- After **every** change, run the full test suite automatically: `npm test && npm run typecheck && npm run lint`.
- **If any test fails**, the agent must instantly revert the offending change, apply a new fix, and re‑run the suite until **all tests pass**.
- No step may ever leave the repository in a failing state; the agent must **self‑heal** until the repository is green.
- Follow strict TDD flow: write a failing test → implement → make test pass → commit → repeat.

## CI/CD Pipeline
- GitHub Actions workflow lives in `.github/workflows/ci.yml`. Pipeline stages: lint → typecheck → unit tests → integration tests → build.
- All secrets injected via environment variables (never hard‑coded).

## Architecture Principles
- **SOLID**: Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion.
- **DRY**: No duplicated logic — extract shared utilities to `src/lib/`.
- **Fail‑fast**: Validate at boundaries (API routes, service entry points) with Zod schemas.
- **Type‑safety**: `strict: true` TypeScript everywhere — no `any` casts without documented justification.

## Project Stack
- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Three.js (WebGL Orb), Zustand
- **Backend**: Next.js API routes + FastAPI microservices (Python 3.11)
- **AI Voice**: Google Gemini Multimodal Live API (WebSocket) + OpenAI API
- **Memory**: ChromaDB (vector), SQLite (structured), IndexedDB (offline PWA buffer)
- **Integrations**: Obsidian Local REST API, Telegram MTProto (Telethon), Google Workspace APIs
- **Audio**: pyannote.audio 3.1, faster‑whisper (Lapel Mode diarization)
- **Agents**: OpenClaw (SOUL.md, STYLE.md, HEARTBEAT.md), Shelestun background agent

## Module Owners (DO NOT break these interfaces)
- `src/lib/providers/` — LLM provider abstraction (OpenAI, DeepSeek, Gemini)
- `src/hooks/useVoiceSession` — core voice pipeline (STT → LLM → TTS)
- `src/components/orb/` — Three.js 3D Orb (lip‑sync + semantic color)
- `services/lapel/` — Python diarization microservice
- `services/telegram/` — Python Telethon parser microservice

---

*All future automation must obey the rules above.*
