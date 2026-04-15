---
name: build-mission-control
description: Реализация дашборда Mission Control как новой вкладки в админке.
---

# Имплементация VoiceZettel Mission Control

## Директивы кодогенерации

1. **Подготовка**: Установи `@xterm/xterm`, `@xterm/addon-fit`.

2. **SSE Backend**: Создай изолированный эндпоинт `src/app/api/logs/stream/route.ts`. Используй `ReadableStream` для трансляции логов демона OpenClaw через SSE.

3. **Терминал UI**: В `src/components/admin/TerminalView.tsx` динамически импортируй xterm.

4. **AgentPrism**: В `src/components/admin/TraceVisualizer.tsx` настрой визуализацию трассировок агента.

5. **Интеграция в UI**: Собери интерфейс в `src/components/admin/MissionControlTab.tsx`. Открой файл `src/components/admin/AdminSidebar.tsx` и аккуратно добавь ссылку на Mission Control в список существующих вкладок. Не меняй стили сайдбара.
