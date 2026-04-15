# build-mission-control.md — Артефакт 1: Наблюдаемость (Mission Control)

## Назначение
Вкладка Mission Control для инженерного мониторинга OpenClaw агента.

## Компоненты

### SSE Endpoint
- `src/app/api/logs/stream/route.ts` — ReadableStream SSE
- Читает `data/logs/` и `.antigravity/logs/`
- Пульсация heartbeat каждые 2 сек
- Auto-close через 5 мин (anti-zombie)

### Terminal (xterm.js)
- `src/components/admin/TerminalView.tsx`
- Подключается к SSE `/api/logs/stream`
- Цветная подсветка по уровню (ERROR=red, WARN=yellow, INFO=cyan)
- JetBrains Mono шрифт, 5000 строк scrollback

### Trace Visualizer  
- `src/components/admin/TraceVisualizer.tsx`
- Показывает дерево сущностей из `/api/openclaw/entities`

### Heartbeat Status Bar
- Встроен в `MissionControlTab.tsx`
- Polling `/api/openclaw/status` каждые 10 сек
- Кнопка "Запустить цикл" → POST `/api/openclaw/trigger`
- Показывает: interval, last_run, raw_files, wiki_pages, pending

### Sidebar
- `AdminSidebar.tsx` → tab "mission-control" с иконкой Activity
