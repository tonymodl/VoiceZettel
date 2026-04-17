"""
summarize_investor.py - Progressive summarizer for investor (Kostya) Telegram chats.
Uses google.genai (new SDK).
"""

import os
import re
import sys
import io
import time
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

from google import genai

# Config
GEMINI_API_KEY = os.environ.get("GOOGLE_GEMINI_API_KEY", "")
VAULT_PATH = os.environ.get("VAULT_PATH", "")

KOSTYA_DIRS = [
    "📬 Telegram/Личные/Константин Денисенко Lixiang",
    "📬 Telegram/Личные/Анна (Секретарь Константина)",
]

OUTPUT_FILE = PROJECT_ROOT / "data" / "investor_kostya_context.md"

# Init client
client = genai.Client(api_key=GEMINI_API_KEY)
MODEL = "gemini-2.5-flash"


def strip_frontmatter(content):
    if content.startswith("---"):
        match = re.match(r"^---\s*\n.*?\n---\s*\n?(.*)", content, re.DOTALL)
        if match:
            return match.group(1)
    return content


def strip_html_comments(content):
    return re.sub(r"<!--.*?-->", "", content)


def clean_message_text(content):
    content = strip_frontmatter(content)
    content = strip_html_comments(content)
    content = re.sub(r"^#\s+.+$", "", content, flags=re.MULTILINE)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()


def read_all_kostya_files():
    by_month = defaultdict(list)
    
    for chat_dir in KOSTYA_DIRS:
        full_dir = Path(VAULT_PATH) / chat_dir
        if not full_dir.exists():
            print(f"[WARN] Dir not found: {full_dir}")
            continue
        
        chat_label = chat_dir.split("/")[-1]
        md_files = sorted(full_dir.glob("*.md"))
        print(f"[DIR] {chat_label}: {len(md_files)} files")
        
        for md_file in md_files:
            date_match = re.search(r"(\d{4})-(\d{2})-(\d{2})", md_file.stem)
            if not date_match:
                continue
            
            year, month = date_match.group(1), date_match.group(2)
            month_key = f"{year}-{month}"
            
            try:
                raw = md_file.read_text(encoding="utf-8")
                cleaned = clean_message_text(raw)
                if len(cleaned) > 50:
                    by_month[month_key].append((
                        f"[{chat_label}] {md_file.name}",
                        cleaned
                    ))
            except Exception as e:
                print(f"  [ERR] {md_file.name}: {e}")
    
    return dict(sorted(by_month.items()))


def summarize_month(month_key, files, retry=3):
    combined = []
    for filename, content in files:
        truncated = content[:15000] if len(content) > 15000 else content
        combined.append(f"=== {filename} ===\n{truncated}")
    
    batch_text = "\n\n".join(combined)
    
    prompt = f"""Ты -- аналитик деловых переписок. Проанализируй Telegram-переписку Антона Евсина с его инвестором Константином Денисенко (и его секретарём Анной) за {month_key}.

ПЕРЕПИСКА:
{batch_text}

ЗАДАЧА: Создай ДЕТАЛЬНУЮ сводку за этот месяц. Включи:

1. **Ключевые темы и решения** -- о чём договорились, какие решения приняты
2. **Финансовые вопросы** -- суммы, платежи, инвестиции, бюджеты (ТОЧНЫЕ цифры!)
3. **Проекты и задачи** -- что обсуждали, статусы, дедлайны
4. **Обязательства и обещания** -- кто что обещал кому (конкретно!) 
5. **Настроение и динамика** -- как складываются отношения, есть ли напряжение
6. **Бизнес Lixiang** -- всё что связано с автомобильным бизнесом
7. **Dominion** -- всё что связано с проектом Dominion
8. **Важные люди** -- кого упоминали, какие контакты

ФОРМАТ: Компактный, но информативный. Используй маркированные списки. 
Пиши на РУССКОМ. Не опускай важные детали и цифры.
Объём: 500-1500 слов в зависимости от количества материала."""

    for attempt in range(retry):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
            )
            return response.text
        except Exception as e:
            print(f"  [GEMINI ERR] attempt {attempt+1}/{retry}: {e}")
            if attempt < retry - 1:
                wait = (attempt + 1) * 10
                print(f"  Waiting {wait}s...")
                time.sleep(wait)
    
    return f"[Error summarizing {month_key}]"


def create_final_briefing(month_summaries):
    combined = []
    for month, summary in sorted(month_summaries.items()):
        combined.append(f"## {month}\n{summary}")
    
    all_summaries = "\n\n---\n\n".join(combined)
    
    prompt = f"""Ты -- персональный AI-ассистент Антона Евсина. На основе помесячных сводок переписки с инвестором Константином Денисенко, создай ВСЕОБЪЕМЛЮЩИЙ БРИФИНГ.

ПОМЕСЯЧНЫЕ СВОДКИ:
{all_summaries}

СОЗДАЙ СТРУКТУРИРОВАННЫЙ БРИФИНГ в формате:

# БРИФИНГ: Константин Денисенко (Инвестор)

## Кто такой Костя
[Краткое описание: кто он, какой бизнес, характер общения, стиль принятия решений]

## Финансовые отношения
[Все инвестиции, суммы, условия, текущие обязательства -- КОНКРЕТНЫЕ ЦИФРЫ]

## Бизнес Lixiang
[Всё про автомобильный бизнес -- поставки, продажи, планы, проблемы]

## Проект Dominion  
[Инвестиции Кости в Dominion, что он ожидает, текущий статус]

## Текущие обязательства
[Что Антон должен Косте, что Костя обещал Антону -- АКТУАЛЬНЫЙ статус]

## Горячие темы (последние 2 месяца)
[Самые свежие и актуальные вопросы между ними]

## Как общаться с Костей
[Стиль общения, что ему важно, что его раздражает, как лучше подавать информацию]

## Связанные люди
[Анна-секретарь, другие упоминаемые люди в контексте Кости]

ПРАВИЛА:
- Пиши компактно но ИНФОРМАТИВНО -- это будет в контексте AI-ассистента
- ВСЕ цифры, даты и обязательства должны быть ТОЧНЫМИ  
- Максимум 3000 слов
- Формат: Markdown
- Язык: Русский"""

    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
            )
            return response.text
        except Exception as e:
            print(f"[FINAL ERR] attempt {attempt+1}: {e}")
            if attempt < 2:
                time.sleep(15)
    
    return "# Briefing: Konstantin Denisenko\n\n" + all_summaries


def main():
    print("=" * 60)
    print("INVESTOR CONTEXT BUILDER -- Kostya (Konstantin Denisenko)")
    print("=" * 60)
    
    if not GEMINI_API_KEY:
        print("[FATAL] GOOGLE_GEMINI_API_KEY not set!")
        sys.exit(1)
    if not VAULT_PATH:
        print("[FATAL] VAULT_PATH not set!")
        sys.exit(1)
    
    # Step 1: Read all files
    print("\n[STEP 1] Reading all Kostya chat files...")
    by_month = read_all_kostya_files()
    
    total_files = sum(len(files) for files in by_month.values())
    total_chars = sum(sum(len(c) for _, c in files) for files in by_month.values())
    print(f"\n[STATS] Total: {total_files} files, {total_chars:,} chars, {len(by_month)} months")
    
    # Step 2: Summarize each month
    print("\n[STEP 2] Summarizing each month with Gemini...")
    month_summaries = {}
    
    for i, (month_key, files) in enumerate(sorted(by_month.items())):
        chars = sum(len(c) for _, c in files)
        print(f"\n  [{i+1}/{len(by_month)}] {month_key}: {len(files)} files, {chars:,} chars")
        
        summary = summarize_month(month_key, files)
        month_summaries[month_key] = summary
        print(f"  [OK] Summary: {len(summary)} chars")
        
        if i < len(by_month) - 1:
            time.sleep(2)
    
    # Step 3: Create final briefing  
    print("\n[STEP 3] Creating final comprehensive briefing...")
    final_briefing = create_final_briefing(month_summaries)
    print(f"  [OK] Final briefing: {len(final_briefing)} chars")
    
    # Step 4: Save
    print(f"\n[STEP 4] Saving to {OUTPUT_FILE}...")
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    header = f"""---
generated: {datetime.now().isoformat()}
source: Telegram chats with Konstantin Denisenko
files_analyzed: {total_files}
chars_analyzed: {total_chars}
months_covered: {len(by_month)}
---

"""
    OUTPUT_FILE.write_text(header + final_briefing, encoding="utf-8")
    print(f"  [OK] Saved: {OUTPUT_FILE.stat().st_size:,} bytes")
    
    # Step 5: Save monthly summaries
    monthly_file = PROJECT_ROOT / "data" / "investor_kostya_monthly.md"
    monthly_content = "# Monthly summaries: Konstantin Denisenko\n\n"
    for month, summary in sorted(month_summaries.items()):
        monthly_content += f"## {month}\n\n{summary}\n\n---\n\n"
    monthly_file.write_text(monthly_content, encoding="utf-8")
    print(f"  [OK] Monthly summaries: {monthly_file.stat().st_size:,} bytes")
    
    print("\n" + "=" * 60)
    print("[DONE] Investor context ready for voice assistant injection.")
    print("=" * 60)


if __name__ == "__main__":
    main()
