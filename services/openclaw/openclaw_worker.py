"""
openclaw_worker.py — Background daemon for OpenClaw LLM-Wiki Agent.
VoiceZettel 3.0 Phase 2

Reads raw data from /Raw_v2, extracts entities via LLM,
and compiles structured Wiki pages in /Wiki_v2.

Runs as a background service with configurable intervals.
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("openclaw")

# ── Configuration ─────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
CONFIG_PATH = PROJECT_ROOT / ".openclaw" / "openclaw.json"
RAW_DIR = PROJECT_ROOT / "VoiceZettel" / "Raw_v2"
WIKI_DIR = PROJECT_ROOT / "VoiceZettel" / "Wiki_v2"
LOG_PATH = PROJECT_ROOT / ".antigravity" / "logs" / "openclaw.log"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OPENCLAW_MODEL", "qwen2.5:14b")


def load_config() -> dict:
    """Load OpenClaw configuration."""
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {
        "agent": {"model": OLLAMA_MODEL, "temperature": 0.3},
        "schedule": {"ingest_interval_minutes": 15, "max_files_per_run": 50},
    }


class OpenClawWorker:
    """Background worker that processes raw data into Wiki pages."""

    def __init__(self):
        self.config = load_config()
        self.processed_files: set[str] = set()
        self._running = False
        self._stats = {
            "last_run": None,
            "files_processed": 0,
            "entities_extracted": 0,
            "errors": 0,
            "status": "idle",
        }
        self._load_processed_index()

    def _load_processed_index(self) -> None:
        """Load index of already-processed files."""
        index_path = WIKI_DIR / ".processed_index.json"
        if index_path.exists():
            try:
                data = json.loads(index_path.read_text(encoding="utf-8"))
                self.processed_files = set(data.get("files", []))
            except Exception:
                self.processed_files = set()

    def _save_processed_index(self) -> None:
        """Persist the index of processed files."""
        index_path = WIKI_DIR / ".processed_index.json"
        WIKI_DIR.mkdir(parents=True, exist_ok=True)
        index_path.write_text(
            json.dumps({"files": list(self.processed_files), "updated": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @property
    def stats(self) -> dict:
        return {**self._stats, "processed_count": len(self.processed_files)}

    def scan_new_files(self) -> list[Path]:
        """Find unprocessed .md files in Raw_v2."""
        if not RAW_DIR.exists():
            return []

        new_files = []
        for md_file in RAW_DIR.rglob("*.md"):
            rel_path = str(md_file.relative_to(RAW_DIR))
            if rel_path not in self.processed_files:
                new_files.append(md_file)

        max_files = self.config.get("schedule", {}).get("max_files_per_run", 50)
        return sorted(new_files, key=lambda f: f.stat().st_mtime)[:max_files]

    async def _call_ollama(self, prompt: str) -> Optional[str]:
        """Call Ollama API for entity extraction."""
        model = self.config.get("agent", {}).get("model", OLLAMA_MODEL)
        temp = self.config.get("agent", {}).get("temperature", 0.3)

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": temp, "num_predict": 4096},
                    },
                )
                if r.status_code == 200:
                    return r.json().get("response", "")
                else:
                    logger.error(f"Ollama error {r.status_code}: {r.text[:200]}")
                    return None
        except httpx.ConnectError:
            logger.warning("Ollama not available — skipping extraction")
            return None
        except Exception as e:
            logger.error(f"Ollama call failed: {e}")
            return None

    async def extract_entities(self, content: str, source_file: str) -> dict:
        """Extract entities from raw content via LLM."""
        prompt = f"""Analyze the following Telegram conversation log and extract structured entities.

Source file: {source_file}

INSTRUCTIONS:
1. Extract PEOPLE mentioned (name, relationship, sentiment)
2. Extract TASKS or action items (title, assignee, deadline if any)
3. Extract KEY FACTS or notable events
4. Resolve coreferences (same person mentioned differently)
5. Rate overall sentiment (-2 to +2)

Output ONLY valid JSON in this format:
{{
  "people": [
    {{"name": "...", "aliases": [], "relationship": "...", "sentiment": 0}}
  ],
  "tasks": [
    {{"title": "...", "assignee": "...", "status": "draft", "deadline": null}}
  ],
  "facts": [
    {{"text": "...", "category": "...", "importance": "low|medium|high"}}
  ],
  "overall_sentiment": 0,
  "summary": "..."
}}

CONVERSATION LOG:
{content[:4000]}"""

        result = await self._call_ollama(prompt)
        if not result:
            return {}

        # Parse JSON from LLM response
        try:
            # Find JSON in response
            json_start = result.find("{")
            json_end = result.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                return json.loads(result[json_start:json_end])
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse LLM response as JSON for {source_file}")

        return {}

    def _write_person_page(self, person: dict, source: str) -> None:
        """Create or update a Person wiki page."""
        name = person.get("name", "Unknown").strip()
        if not name or name == "Unknown":
            return

        safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in name).strip()
        person_dir = WIKI_DIR / "People"
        person_dir.mkdir(parents=True, exist_ok=True)
        person_file = person_dir / f"{safe_name}.md"

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        if person_file.exists():
            # Append interaction
            existing = person_file.read_text(encoding="utf-8")
            interaction = f"\n- **{now}** ({source}): sentiment={person.get('sentiment', 0)}\n"
            if interaction.strip() not in existing:
                updated = existing.rstrip() + f"\n{interaction}"
                person_file.write_text(updated, encoding="utf-8")
        else:
            # Create new page
            content = f"""---
name: "{name}"
type: person
aliases: {json.dumps(person.get("aliases", []), ensure_ascii=False)}
relationship: "{person.get("relationship", "unknown")}"
first_seen: "{now}"
last_seen: "{now}"
health_score: 100
dunbar_layer: 4
---

# {name}

## Relationship
{person.get("relationship", "Не определено")}

## Interactions
- **{now}** ({source}): sentiment={person.get("sentiment", 0)}
"""
            person_file.write_text(content, encoding="utf-8")

    def _write_task_page(self, task: dict, source: str) -> None:
        """Create a Task wiki page."""
        title = task.get("title", "").strip()
        if not title:
            return

        safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in title)[:60].strip()
        task_dir = WIKI_DIR / "Tasks"
        task_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        task_file = task_dir / f"{now}-{safe_title}.md"

        if task_file.exists():
            return  # Don't overwrite

        content = f"""---
title: "{title}"
type: task
status: "{task.get("status", "draft")}"
assignee: "{task.get("assignee", "unassigned")}"
created: "{now}"
deadline: {json.dumps(task.get("deadline"))}
source: "{source}"
---

# {title}

**Статус**: {task.get("status", "draft")}
**Исполнитель**: {task.get("assignee", "не назначен")}
**Источник**: {source}
"""
        task_file.write_text(content, encoding="utf-8")

    async def process_file(self, file_path: Path) -> bool:
        """Process a single raw file: extract entities and write Wiki pages."""
        rel_path = str(file_path.relative_to(RAW_DIR))
        try:
            content = file_path.read_text(encoding="utf-8")
            if len(content.strip()) < 50:
                # Skip near-empty files
                self.processed_files.add(rel_path)
                return True

            entities = await self.extract_entities(content, rel_path)

            if entities:
                # Write Person pages
                for person in entities.get("people", []):
                    self._write_person_page(person, rel_path)
                    self._stats["entities_extracted"] += 1

                # Write Task pages
                for task in entities.get("tasks", []):
                    self._write_task_page(task, rel_path)
                    self._stats["entities_extracted"] += 1

            self.processed_files.add(rel_path)
            self._stats["files_processed"] += 1
            return True

        except Exception as e:
            logger.error(f"Error processing {rel_path}: {e}")
            self._stats["errors"] += 1
            return False

    async def run_once(self) -> dict:
        """Run a single ingest cycle."""
        self._stats["status"] = "running"
        self._stats["last_run"] = datetime.now(timezone.utc).isoformat()

        new_files = self.scan_new_files()
        logger.info(f"Ingest cycle: {len(new_files)} new files found")

        for file_path in new_files:
            await self.process_file(file_path)

        self._save_processed_index()
        self._stats["status"] = "idle"

        return {
            "new_files": len(new_files),
            "processed": self._stats["files_processed"],
            "entities": self._stats["entities_extracted"],
            "errors": self._stats["errors"],
        }

    async def run_daemon(self) -> None:
        """Run as a continuous background daemon."""
        interval = self.config.get("schedule", {}).get("ingest_interval_minutes", 15)
        self._running = True
        logger.info(f"OpenClaw daemon started (interval: {interval}min)")

        while self._running:
            try:
                result = await self.run_once()
                logger.info(f"Cycle complete: {result}")
            except Exception as e:
                logger.error(f"Daemon cycle error: {e}")

            await asyncio.sleep(interval * 60)

    def stop(self) -> None:
        """Stop the daemon."""
        self._running = False
        self._stats["status"] = "stopped"
        logger.info("OpenClaw daemon stopped")


# ── Standalone entry point ────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    worker = OpenClawWorker()
    asyncio.run(worker.run_daemon())
