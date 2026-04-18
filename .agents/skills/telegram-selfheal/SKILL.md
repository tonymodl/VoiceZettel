---
name: telegram-selfheal
description: Самовосстановление Telegram-интеграции. Auto-reconnect, heartbeat, миграция на webhooks.
triggers:
  - "telegram упал"
  - "telegram reconnect"
  - "фикс телеграм"
  - "self-heal telegram"
  - "telegram webhook"
---

# Telegram Self-Heal — Самовосстановление Соединения

## Назначение
Устранение хронической нестабильности Telegram-интеграции: 
таймауты Long Polling, `httpx.RemoteProtocolError`, блокировки фаерволов.

## Текущая проблема
- `services/telegram/main.py` использует **Long Polling** (постоянные запросы)
- Холостые циклы при отсутствии обновлений
- Периодические разрывы без автовосстановления
- Потеря сообщений при рестарте

## Архитектура Self-Healing

### 1. Heartbeat-мониторинг
```python
async def heartbeat_loop(client: TelegramClient, interval: int = 120):
    """Каждые 2 минуты проверяем жизнеспособность соединения"""
    while True:
        try:
            me = await asyncio.wait_for(client.get_me(), timeout=10)
            logger.info(f"Heartbeat OK: @{me.username}")
        except Exception as e:
            logger.warning(f"Heartbeat FAIL: {e}, reconnecting...")
            await reconnect_with_backoff(client)
        await asyncio.sleep(interval)
```

### 2. Auto-Reconnect с Exponential Backoff
```python
async def reconnect_with_backoff(client: TelegramClient, max_retries: int = 12):
    """Переподключение с экспоненциальной задержкой"""
    for attempt in range(1, max_retries + 1):
        delay = min(0.3 * (1.5 ** (attempt - 1)), 30)
        logger.info(f"Reconnect attempt {attempt}/{max_retries} in {delay:.1f}s")
        await asyncio.sleep(delay)
        try:
            await client.disconnect()
            await client.connect()
            if await client.is_user_authorized():
                logger.info("Reconnected successfully!")
                return
        except Exception as e:
            logger.error(f"Reconnect failed: {e}")
    logger.critical("Max reconnect attempts exhausted!")
```

### 3. Исключение-безопасный Event Loop
```python
async def safe_event_loop(client: TelegramClient):
    """Обёртка для event loop с полным try-except"""
    while True:
        try:
            await client.run_until_disconnected()
        except (ConnectionError, TimeoutError, OSError) as e:
            logger.warning(f"Connection lost: {e}")
            await reconnect_with_backoff(client)
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            await asyncio.sleep(5)
            await reconnect_with_backoff(client)
```

### 4. Медиа-обработка (async)
```python
# БЫЛО (блокирующее):
audio_bytes = io.BytesIO()
await message.download_media(file=audio_bytes)

# СТАЛО (неблокирующее):
audio_bytes = await asyncio.to_thread(
    lambda: io.BytesIO()
)
await message.download_media(file=audio_bytes)
# Или использовать aiofiles для файлового I/O
```

## Миграция на Webhooks (Production)

### Преимущества
- Нет холостых циклов — push-модель от серверов Telegram
- Снижение задержки
- Стабильнее за NAT/фаерволами
- Меньше нагрузка на сервер

### Реализация
1. Настроить HTTPS endpoint: `https://voicezettel.app/api/telegram/webhook`
2. Зарегистрировать webhook: `bot.set_webhook(url=WEBHOOK_URL)`
3. FastAPI route для приёма обновлений
4. Валидация `X-Telegram-Bot-Api-Secret-Token`

## Дублирование в Shadow-хранилище
При каждом сохранении через `obsidian_writer.py`:
```python
# Сохранение в основной Vault (как раньше)
save_to_vault(data, vault_path)

# Параллельное сохранение в Raw_v2 для LLM-Wiki обработки
save_to_raw_v2(data, raw_v2_path)
```

## Constraints
- ❌ НЕ ломать текущий парсер `main.py` — только добавлять Self-Heal обёртки
- ❌ НЕ менять формат сохранения в основной Vault
- ✅ МОЖНО добавлять heartbeat-корутины
- ✅ МОЖНО создавать webhook endpoint в Next.js API routes
- ✅ МОЖНО дублировать данные в `/Raw_v2/`
