---
name: build-offload-dashboard
description: Бесшовная интеграция Daily Offload Dashboard в компонент колокольчика.
---

# Верстка оверлея Daily Offload Dashboard

## Директивы кодогенерации

1. **Стейт-менеджер**: Добавь в `src/stores/notificationStore.ts` интерфейс `OffloadAction` и массив действий.

2. **Оверлей (Не ломать MainLayout!)**: Модифицируй `src/components/layout/NotificationBell.tsx` (или создай рядом `DailyOffloadOverlay.tsx`). Интерфейс должен открываться как выезжающая панель с эффектом glassmorphism ПОВЕРХ основного интерфейса, когда пользователь кликает на колокольчик.

3. Внутри панели отрендери стек карточек-действий. Каждая карточка должна иметь только две кнопки: **Approve** и **Edit**.

4. Реализуй анимации растворения карточки при клике **Approve**.
