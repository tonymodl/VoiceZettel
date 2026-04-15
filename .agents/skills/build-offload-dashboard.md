# build-offload-dashboard.md — Артефакт 2: UI разгрузки (Daily Offload)

## Назначение
Glassmorphism overlay для одобрения действий, предложенных OpenClaw.

## Компоненты

### Zustand Store
- `src/stores/notificationStore.ts`
- State: `offloadActions`, `offloadOpen`, `offloadLoading`
- Actions: `loadOffloadActions()`, `resolveOffloadAction(id, status)`
- Источник данных: `GET /api/crm?view=actions`

### Overlay Component
- `src/components/layout/DailyOffloadOverlay.tsx`
- Выезжает справа при клике на NotificationBell
- Карточки с Approve/Edit кнопками
- Приоритеты: critical (red), high (amber), medium, low
- Типы: reminder, message_draft, task_followup, birthday, health_alert

### NotificationBell
- `src/components/layout/NotificationBell.tsx`
- Клик → `setOffloadOpen(true)`
- Badge с количеством pending actions

### API
- `GET /api/crm?view=actions` — pending draft actions
- `POST /api/crm/actions/:id/resolve` — approve/dismiss
