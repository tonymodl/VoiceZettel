---
name: identity-resolution
description: Кросс-платформенная склейка персон. Разрешение идентичности контактов через Telegram, голос, email, Obsidian.
triggers:
  - "identity resolution"
  - "склей персону"
  - "кто это"
  - "объедини контакты"
  - "merge profiles"
  - "voice fingerprint"
---

# Identity Resolution — Кросс-Платформенная Склейка Персон

## Назначение
Автономное распознавание и объединение профилей одного человека 
из разных источников: Telegram (никнейм), телефон (голос), 
Google Календарь (официальное имя), Obsidian (упоминания в заметках).

## Двухуровневый Алгоритм Слияния

### Уровень 1: Детерминированный (Auto-Merge)
Точные совпадения по уникальным идентификаторам:
- Одинаковый email
- Одинаковый номер телефона
- Email найденный в био Telegram/Twitter
- Telegram user_id ↔ контакт в телефонной книге

**Действие**: Автоматическое слияние без участия пользователя.

### Уровень 2: Вероятностный (Scored)
Формула вычисления уверенности:

```
confidence = 
    domain_match * 0.40 +      # Совпадение домена email
    name_similarity * 0.20 +   # Схожесть имени (Levenshtein/Jaro-Winkler)
    company_match * 0.20 +     # Совпадение компании
    username_sim * 0.10 +      # Схожесть юзернейма кросс-платформ
    mutual_signals * 0.10      # Общие контакты/взаимодействия
```

**Действие**: Слияние при `confidence > 0.85`

### Защитные механизмы
| Guard | Логика |
|-------|--------|
| **Colleague Guard** | Ограничить score если имена различаются при совпадении домена |
| **Family Guard** | Не сливать людей с одним адресом но разными именами |
| **Temporal Guard** | Проверить хронологическую совместимость (нельзя быть в двух местах одновременно) |

## Voice Fingerprinting

### Создание отпечатков
1. **Диаризация**: pyannote.audio сегментирует аудио по спикерам
2. **Векторизация**: Из каждого сегмента — вектор каждые 100мс (shape: `(N, 128)`)
3. **Хэширование**: Нормализация → компактные хэши (AcoustID-подобная архитектура)
4. **Хранение**: PostgreSQL/SQLite с усечёнными битами для быстрого сканирования

### Матчинг на совещаниях
```
[Входящий голос] → [Вектор] → [База хэшей] → [Person: Иванов]
                                                    ↓
                                    [Identity Graph] → [Telegram: @ivanov_biz]
                                                    → [Obsidian: /People/Иванов.md]
                                                    → [Последняя сделка: 500К, Июнь 2025]
```

### Конфиденциальность
- ⚠️ ВСЯ обработка биометрии **строго локально**
- ❌ Никаких внешних API для голосовых данных
- Защита от синтеза голоса (anti-replay attacks)

## Схема данных (sqlite_v2.db)
```sql
CREATE TABLE entity_person (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    aliases TEXT,          -- JSON array: ["Саша", "@alex_dev", "мой брат"]
    emails TEXT,           -- JSON array
    phones TEXT,           -- JSON array
    telegram_id TEXT,
    dunbar_layer INTEGER,  -- 1-4
    health_score REAL,     -- 0.0-1.0
    voice_hash TEXT,       -- Fingerprint hash
    metadata TEXT,         -- JSON: company, role, notes
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE interaction_event (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES entity_person(id),
    type TEXT,             -- call, message, meeting, mention
    platform TEXT,         -- telegram, phone, obsidian, calendar
    sentiment REAL,        -- -1.0 to 1.0
    emotional_intensity REAL, -- 0.0 to 1.0
    financial_amount REAL,
    summary TEXT,
    raw_source TEXT,       -- Path to /Raw_v2/ file
    timestamp TEXT
);

CREATE TABLE identity_merge (
    id TEXT PRIMARY KEY,
    person_a TEXT REFERENCES entity_person(id),
    person_b TEXT REFERENCES entity_person(id),
    confidence REAL,
    method TEXT,           -- deterministic | probabilistic
    merged_at TEXT,
    merged_by TEXT         -- auto | manual
);
```

## Constraints
- ❌ НЕ отправлять биометрические данные во внешние API
- ❌ НЕ сливать профили при confidence < 0.85 без подтверждения
- ✅ МОЖНО создавать `services/identity/` микросервис
- ✅ МОЖНО расширять sqlite_v2.db новыми таблицами
