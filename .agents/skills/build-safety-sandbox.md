# build-safety-sandbox.md — Артефакт 0: Инфраструктура безопасности

## Назначение
Защитный периметр для всех изменений в VoiceZettel 2.0.

## Реализовано

### CI/CD Pipeline
- `.github/workflows/ci.yml` — lint → typecheck → test → build
- Запускается на каждый push/PR в main

### Тесты безопасности (Vitest)
- `__tests__/health-endpoints.test.ts` — 11 contract tests
- Проверяют JSON schema всех health endpoints
- Проверяют корректность портов (8038, 8030, 3099, 8040)

### Технический долг
- ✅ `io.BytesIO` заменён (больше нет в codebase)
- ✅ Порты выровнены: Telegram=8038, Indexer=8030, OpenClaw=8040

### Порты системы
| Порт | Сервис |
|------|--------|
| 3000 | Next.js (веб-сервер) |
| 3099 | Gemini WS Proxy |
| 8030 | ChromaDB Indexer |
| 8038 | Telegram Service |
| 8040 | OpenClaw Heartbeat |
| 27124 | Obsidian REST API |
