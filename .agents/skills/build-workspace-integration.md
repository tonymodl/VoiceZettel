# build-workspace-integration.md — Артефакт 3: Google Workspace

## Назначение
Интеграция Google Docs/Sheets как внешних узлов базы знаний.

## Компоненты

### Workspace Tab
- `src/components/admin/WorkspaceTab.tsx`
- Добавление документов по URL
- Системный промпт для контекста
- Sync кнопка → загрузка + чанкирование + индексация
- Хранение в localStorage

### Sync API
- `POST /api/workspace/sync`
- Загружает Google Doc через export?format=txt (public)
- Чанкирует текст (1500 chars, 300 overlap)
- Индексирует в ChromaDB через Indexer (port 8030)
- Возвращает: chunkCount, indexedCount, documentTitle

### Gemini Function Calling (TODO)
- `src/lib/providers/google.ts` — FunctionDeclaration schemas
- batch_update_cells для Google Sheets
- Через Gemini API (не прямой Sheets API)

### Sidebar
- `AdminSidebar.tsx` → tab "workspace" с иконкой FileText
- Метка "Документы"
