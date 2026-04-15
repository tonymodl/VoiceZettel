"""
obsidian_writer.py — Write Telegram messages to Obsidian Vault.

Uses Obsidian Local REST API when available, falls back to direct filesystem writes.
Structure:
    📬 Telegram/
    ├── Личные/{ChatName}/{YYYY-MM-DD}.md
    ├── Группы/{ChatName}/{YYYY-MM-DD}.md
    └── Каналы/{ChatName}/{YYYY-MM-DD}.md
"""

import os
import re
import ssl
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("obsidian_writer")

INDEXER_URL = os.environ.get("INDEXER_SERVICE_URL", "http://127.0.0.1:8030")

# ── Constants ──────────────────────────────────────────────────
TELEGRAM_ROOT = "📬 Telegram"
CHAT_TYPE_DIRS = {
    "private": "Личные",
    "group": "Группы",
    "supergroup": "Группы",
    "channel": "Каналы",
}


def _sanitize(name: str) -> str:
    """Sanitize filename: remove illegal chars, collapse spaces."""
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name or "Unnamed"


def _frontmatter(chat_name: str, chat_type: str, date_str: str, msg_count: int) -> str:
    return (
        f"---\n"
        f'chat: "{chat_name}"\n'
        f"type: {chat_type}\n"
        f"date: {date_str}\n"
        f"messages: {msg_count}\n"
        f"source: telegram-export\n"
        f"---\n\n"
    )


def _format_message(msg: dict) -> str:
    """Format a single message to Markdown line with dedup marker."""
    parts = []

    # Dedup marker (invisible in rendered markdown)
    msg_id = msg.get("id")
    if msg_id:
        parts.append(f"<!-- msg:{msg_id} -->")

    # Timestamp
    date_str = msg.get("date", "")
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        time_str = dt.strftime("%H:%M")
    except Exception:
        time_str = "??:??"
    parts.append(f"[{time_str}]")

    # Author
    author = msg.get("from", "")
    if author:
        parts.append(f"**{author}**:")

    # Forwarded
    fwd = msg.get("forwarded_from")
    if fwd:
        parts.append(f"_(переслано от {fwd})_")

    # Reply
    reply_id = msg.get("reply_to_message_id")
    if reply_id:
        parts.append(f"↪ ответ на #{reply_id}")

    # Text
    text = msg.get("text", "").strip()
    if text:
        parts.append(text)

    # Media indicator
    media = msg.get("media_type")
    if media:
        parts.append(f"📎 [{media}]")

    # Voice transcription
    transcription = msg.get("transcription")
    if transcription:
        parts.append(f"\n> 🎤 _{transcription}_")

    return " ".join(parts)


class ObsidianWriter:
    """Writes Telegram messages to Obsidian vault via REST API with filesystem fallback."""

    def __init__(
        self,
        vault_path: str,
        rest_api_url: Optional[str] = None,
        rest_api_key: Optional[str] = None,
    ):
        self.vault_path = Path(vault_path)
        self.rest_api_url = (rest_api_url or "").rstrip("/")
        self.rest_api_key = rest_api_key or ""
        self._rest_available: Optional[bool] = None

        # Create SSL context that trusts self-signed certs (Obsidian plugin uses self-signed)
        self._ssl_ctx = ssl.create_default_context()
        self._ssl_ctx.check_hostname = False
        self._ssl_ctx.verify_mode = ssl.CERT_NONE

    async def _check_rest_api(self) -> bool:
        """Check if Obsidian REST API is reachable."""
        if not self.rest_api_url or not self.rest_api_key:
            return False
        try:
            async with httpx.AsyncClient(verify=False, timeout=3.0) as client:
                r = await client.get(
                    f"{self.rest_api_url}/",
                    headers={"Authorization": f"Bearer {self.rest_api_key}"},
                )
                return r.status_code == 200
        except Exception as e:
            logger.debug(f"Obsidian REST API not available: {e}")
            return False

    async def _ensure_rest_check(self) -> bool:
        if self._rest_available is None:
            self._rest_available = await self._check_rest_api()
            if self._rest_available:
                logger.info("Obsidian REST API is available — using API mode")
            else:
                logger.info("Obsidian REST API not available — using filesystem fallback")
        return self._rest_available

    def _get_note_path(self, chat_name: str, chat_type: str, date: datetime) -> str:
        """Build the vault-relative path for a note."""
        type_dir = CHAT_TYPE_DIRS.get(chat_type, "Другое")
        safe_name = _sanitize(chat_name)
        date_str = date.strftime("%Y-%m-%d")
        return f"{TELEGRAM_ROOT}/{type_dir}/{safe_name}/{date_str}.md"

    def get_note_path_for_message(self, chat_name: str, chat_type: str, msg: dict) -> Optional[Path]:
        """Get the absolute path of the note file a message would be written to.
        Used by LiveSync to trigger vectorization on the correct file."""
        date_str = msg.get("date", "")
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except Exception:
            dt = datetime.now(timezone.utc)
        rel_path = self._get_note_path(chat_name, chat_type, dt)
        return self.vault_path / rel_path

    def _check_message_exists(self, note_path: Path, msg_id: int) -> bool:
        """Check if a message ID already exists in a note file (dedup)."""
        if not note_path.exists():
            return False
        try:
            content = note_path.read_text(encoding="utf-8")
            # Messages are formatted as "[HH:MM] **Author**: text"
            # We'll use a simple marker: <!-- msg:ID -->
            return f"<!-- msg:{msg_id} -->" in content
        except Exception:
            return False

    async def _write_via_rest(self, path: str, content: str) -> bool:
        """Write/append content via Obsidian REST API."""
        try:
            async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
                # Try to get existing content first
                existing = ""
                r = await client.get(
                    f"{self.rest_api_url}/vault/{path}",
                    headers={
                        "Authorization": f"Bearer {self.rest_api_key}",
                        "Accept": "text/markdown",
                    },
                )
                if r.status_code == 200:
                    existing = r.text

                # Merge: append new content
                if existing:
                    merged = existing.rstrip() + "\n\n" + content
                else:
                    merged = content

                # Write back
                r = await client.put(
                    f"{self.rest_api_url}/vault/{path}",
                    headers={
                        "Authorization": f"Bearer {self.rest_api_key}",
                        "Content-Type": "text/markdown",
                    },
                    content=merged.encode("utf-8"),
                )
                return r.status_code in (200, 201, 204)
        except Exception as e:
            logger.error(f"REST API write failed for {path}: {e}")
            return False

    def _write_via_fs(self, path: str, content: str) -> bool:
        """Write content directly to filesystem."""
        try:
            full_path = self.vault_path / path
            full_path.parent.mkdir(parents=True, exist_ok=True)

            if full_path.exists():
                existing = full_path.read_text(encoding="utf-8")
                merged = existing.rstrip() + "\n\n" + content
            else:
                merged = content

            full_path.write_text(merged, encoding="utf-8")
            return True
        except Exception as e:
            logger.error(f"Filesystem write failed for {path}: {e}")
            return False

    async def write_messages(
        self,
        chat_name: str,
        chat_type: str,
        messages: list[dict],
    ) -> int:
        """
        Write a batch of messages to the vault, grouped by day.
        Returns the number of messages successfully written.
        """
        if not messages:
            return 0

        use_rest = await self._ensure_rest_check()
        written = 0

        # Group messages by date
        by_date: dict[str, list[dict]] = {}
        for msg in messages:
            date_str = msg.get("date", "")
            try:
                dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                day_key = dt.strftime("%Y-%m-%d")
            except Exception:
                day_key = "unknown"
            by_date.setdefault(day_key, []).append(msg)

        for day_key, day_msgs in sorted(by_date.items()):
            try:
                dt = datetime.strptime(day_key, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except Exception:
                dt = datetime.now(timezone.utc)

            note_path = self._get_note_path(chat_name, chat_type, dt)

            # Build content for this day
            lines = []
            # Add frontmatter only for new files
            check_path = self.vault_path / note_path
            is_new = not check_path.exists()

            if is_new:
                lines.append(_frontmatter(chat_name, chat_type, day_key, len(day_msgs)))
                lines.append(f"# {chat_name} — {dt.strftime('%d.%m.%Y')}\n")

            for msg in sorted(day_msgs, key=lambda m: m.get("date", "")):
                # Dedup check: skip if message already written
                msg_id = msg.get("id")
                if msg_id and self._check_message_exists(check_path, msg_id):
                    continue
                formatted = _format_message(msg)
                if formatted.strip():
                    lines.append(formatted)

            content = "\n".join(lines)

            if use_rest:
                ok = await self._write_via_rest(note_path, content)
                if not ok:
                    # Fallback to filesystem
                    ok = self._write_via_fs(note_path, content)
            else:
                ok = self._write_via_fs(note_path, content)

            if ok:
                written += len(day_msgs)

        return written

    async def write_index(self, chats: list[dict]) -> bool:
        """Write _index.md with a table of all exported chats."""
        lines = [
            "---",
            "title: Telegram Archive Index",
            "source: telegram-export",
            f"updated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            "---",
            "",
            "# 📬 Telegram Archive",
            "",
            "| Чат | Тип | Сообщений | Последнее |",
            "|-----|-----|-----------|-----------|",
        ]

        for chat in sorted(chats, key=lambda c: c.get("name", "")):
            name = chat.get("name", "?")
            ctype = CHAT_TYPE_DIRS.get(chat.get("type", ""), "?")
            count = chat.get("message_count", 0)
            last = chat.get("last_date", "—")
            safe = _sanitize(name)
            link = f"[[{TELEGRAM_ROOT}/{ctype}/{safe}/|{name}]]"
            lines.append(f"| {link} | {ctype} | {count} | {last} |")

        content = "\n".join(lines)
        path = f"{TELEGRAM_ROOT}/_index.md"

        use_rest = await self._ensure_rest_check()
        if use_rest:
            # Overwrite index completely
            try:
                async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
                    r = await client.put(
                        f"{self.rest_api_url}/vault/{path}",
                        headers={
                            "Authorization": f"Bearer {self.rest_api_key}",
                            "Content-Type": "text/markdown",
                        },
                        content=content.encode("utf-8"),
                    )
                    return r.status_code in (200, 201, 204)
            except Exception:
                pass

        # Fallback: filesystem
        try:
            full_path = self.vault_path / path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")
            return True
        except Exception as e:
            logger.error(f"Failed to write index: {e}")
            return False
