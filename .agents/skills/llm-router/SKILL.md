---
name: llm-router
description: Динамическая маршрутизация между когнитивными ядрами OpenAI и Google Gemini. Переключение LLM провайдера без потери интеграций.
triggers:
  - "переключи модель"
  - "смени мозги"
  - "используй openai"
  - "используй gemini"
  - "switch to openai"
  - "switch to gemini"
  - "LLM router"
---

# LLM Router — Динамическое Переключение Когнитивных Ядер

## Назначение
Обеспечивает бесшовное переключение между **OpenAI API** и **Google Gemini** 
без потери функциональности интеграций (Google Docs, Calendar, Telegram).

## Архитектура

### Провайдеры
Система маршрутизации через `src/lib/providers/`:
- `openai.ts` — OpenAI GPT-4o / GPT-4o-mini
- `google.ts` — Gemini 2.5 Flash / Pro  
- `router.ts` — Диспетчер, выбирающий провайдера по конфигурации

### Переменные окружения
```env
LLM_PROVIDER=openai        # openai | google
LLM_MODEL=gpt-4o           # gpt-4o | gpt-4o-mini | gemini-2.5-flash | gemini-2.5-pro
LLM_VOICE_PROVIDER=google  # Голосовой канал всегда через Gemini Live
```

### Механизм переключения
1. Пользователь даёт команду или меняет настройку в UI (Settings → LLM Provider)
2. `useSettingsStore.ts` обновляет `llmProvider` и `llmModel`
3. `router.ts` читает конфигурацию и маршрутизирует запросы
4. **Интеграции НЕ затрагиваются** — OpenClaw абстрагирует tool use от модели

### Критические ограничения
- Голосовой канал (Gemini Live WebSocket) **ВСЕГДА** работает через Google
- Текстовый чат может использовать **любой** провайдер
- Function Calling для Google Docs/Calendar проксируется через Next.js API routes
- При смене провайдера **сохраняется** системный промпт и контекст сессии

## Constraints (Ограничения)
- ❌ НЕ менять `ws-proxy.js` — WebSocket прокси для Gemini Live
- ❌ НЕ менять `geminiLiveClient.ts` — клиент голоса
- ❌ НЕ удалять существующие провайдеры
- ✅ МОЖНО добавлять новые провайдеры в `src/lib/providers/`
- ✅ МОЖНО расширять `settingsStore.ts` новыми полями
