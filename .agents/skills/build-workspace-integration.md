---
name: build-workspace-integration
description: Добавление вкладки Workspace в админ-панель и настройка API Gemini.
---

# Модуль интеграции Workspace

## Директивы кодогенерации

1. **API Мост**: Настрой методы авторизации Google OAuth.

2. **Function Calling**: В `src/lib/providers/google.ts` реализуй схемы `FunctionDeclaration` для работы с Google Docs/Sheets (методы `create_spreadsheet`, `batch_update_cells`).

3. **Интеграция в UI Админки**: Создай `src/components/admin/WorkspaceTab.tsx`. В этом файле сделай интерфейс с Google Drive Picker для прикрепления документов и текстовым полем для "Системного промпта документа".

4. Открой `src/components/admin/AdminSidebar.tsx` и добавь ссылку на новую вкладку "Документы" в список навигации админ-панели.

5. Синхронизируй добавленные документы с новой выделенной коллекцией ChromaDB.
