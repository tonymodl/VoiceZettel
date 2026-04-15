"""
export_tracker.py — Persistent per-chat export progress tracker.

Stores progress in JSON so exports can resume incrementally,
and the UI can show "already exported" vs "not yet" per chat.
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("export_tracker")

DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "session", "export_progress.json")


class ChatExportProgress:
    """Progress record for a single chat."""

    def __init__(
        self,
        chat_id: int,
        chat_name: str = "",
        last_message_id: int = 0,
        exported_count: int = 0,
        total_count: int = 0,
        vectorized: bool = False,
        vectorized_chunks: int = 0,
        last_export_time: Optional[str] = None,
        live_sync_active: bool = False,
        status: str = "idle",  # idle | exporting | completed | error
        error: Optional[str] = None,
    ):
        self.chat_id = chat_id
        self.chat_name = chat_name
        self.last_message_id = last_message_id
        self.exported_count = exported_count
        self.total_count = total_count
        self.vectorized = vectorized
        self.vectorized_chunks = vectorized_chunks
        self.last_export_time = last_export_time
        self.live_sync_active = live_sync_active
        self.status = status
        self.error = error

    @property
    def percent(self) -> float:
        if self.total_count <= 0:
            return 0.0 if self.exported_count == 0 else 100.0
        return min(round((self.exported_count / self.total_count) * 100, 1), 100.0)

    @property
    def is_complete(self) -> bool:
        return self.status == "completed" and self.exported_count > 0

    def to_dict(self) -> dict:
        return {
            "chat_id": self.chat_id,
            "chat_name": self.chat_name,
            "last_message_id": self.last_message_id,
            "exported_count": self.exported_count,
            "total_count": self.total_count,
            "percent": self.percent,
            "vectorized": self.vectorized,
            "vectorized_chunks": self.vectorized_chunks,
            "last_export_time": self.last_export_time,
            "live_sync_active": self.live_sync_active,
            "status": self.status,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ChatExportProgress":
        return cls(
            chat_id=data.get("chat_id", 0),
            chat_name=data.get("chat_name", ""),
            last_message_id=data.get("last_message_id", 0),
            exported_count=data.get("exported_count", 0),
            total_count=data.get("total_count", 0),
            vectorized=data.get("vectorized", False),
            vectorized_chunks=data.get("vectorized_chunks", 0),
            last_export_time=data.get("last_export_time"),
            live_sync_active=data.get("live_sync_active", False),
            status=data.get("status", "idle"),
            error=data.get("error"),
        )


class ExportTracker:
    """Persistent JSON-backed export progress tracker."""

    def __init__(self, path: str = DEFAULT_PATH):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._data: dict[int, ChatExportProgress] = {}
        self._load()

    def _load(self):
        """Load progress from disk."""
        if not self._path.exists():
            self._data = {}
            return
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for chat_id_str, entry in raw.items():
                chat_id = int(chat_id_str)
                self._data[chat_id] = ChatExportProgress.from_dict(entry)
            logger.info(f"Loaded export progress for {len(self._data)} chats")
        except Exception as e:
            logger.warning(f"Failed to load export progress: {e}")
            self._data = {}

    def _save(self):
        """Persist progress to disk."""
        try:
            raw = {str(cid): cp.to_dict() for cid, cp in self._data.items()}
            with open(self._path, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save export progress: {e}")

    def get(self, chat_id: int) -> Optional[ChatExportProgress]:
        """Get progress for a chat, or None if never exported."""
        return self._data.get(chat_id)

    def get_all(self) -> dict[int, ChatExportProgress]:
        """Get all tracked chats."""
        return dict(self._data)

    def get_all_serialized(self) -> dict[str, dict]:
        """Get all as JSON-serializable dict (keyed by string chat_id)."""
        return {str(cid): cp.to_dict() for cid, cp in self._data.items()}

    def start_export(self, chat_id: int, chat_name: str, total_count: int = 0):
        """Mark a chat as exporting."""
        existing = self._data.get(chat_id)
        if existing:
            existing.chat_name = chat_name
            existing.status = "exporting"
            existing.error = None
            if total_count > 0:
                existing.total_count = total_count
        else:
            self._data[chat_id] = ChatExportProgress(
                chat_id=chat_id,
                chat_name=chat_name,
                total_count=total_count,
                status="exporting",
            )
        self._save()

    def update_progress(self, chat_id: int, exported_count: int, last_message_id: int = 0):
        """Update export count during export."""
        cp = self._data.get(chat_id)
        if cp:
            cp.exported_count = exported_count
            if last_message_id > cp.last_message_id:
                cp.last_message_id = last_message_id
            # Don't save on every progress update — too frequent
            # Save every 500 messages
            if exported_count % 500 == 0:
                self._save()

    def complete_export(self, chat_id: int, exported_count: int, last_message_id: int):
        """Mark export as completed."""
        cp = self._data.get(chat_id)
        if cp:
            cp.exported_count = exported_count
            cp.last_message_id = last_message_id
            cp.status = "completed"
            cp.error = None
            cp.last_export_time = datetime.now(timezone.utc).isoformat()
            cp.live_sync_active = True  # auto-activate live sync
            self._save()

    def mark_error(self, chat_id: int, error: str):
        """Mark export as failed with error."""
        cp = self._data.get(chat_id)
        if cp:
            cp.status = "error"
            cp.error = error
            self._save()

    def mark_vectorized(self, chat_id: int, chunks: int = 0):
        """Mark that this chat's exported data has been vectorized."""
        cp = self._data.get(chat_id)
        if cp:
            cp.vectorized = True
            cp.vectorized_chunks = chunks
            self._save()

    def get_min_id(self, chat_id: int) -> int:
        """Get the last exported message ID for incremental export."""
        cp = self._data.get(chat_id)
        return cp.last_message_id if cp else 0

    def get_exported_chat_ids(self) -> list[int]:
        """Get IDs of all chats that have been exported (for auto live sync)."""
        return [cid for cid, cp in self._data.items() if cp.is_complete]

    def remove_chat(self, chat_id: int):
        """Remove a chat from tracking entirely (used when deleting from Obsidian)."""
        if chat_id in self._data:
            del self._data[chat_id]
            self._save()
            logger.info(f"Removed chat {chat_id} from export tracker")

    def get_summary(self) -> dict:
        """Get a summary of all export progress."""
        total = len(self._data)
        completed = sum(1 for cp in self._data.values() if cp.is_complete)
        vectorized = sum(1 for cp in self._data.values() if cp.vectorized)
        exporting = sum(1 for cp in self._data.values() if cp.status == "exporting")
        return {
            "total_chats_tracked": total,
            "completed": completed,
            "vectorized": vectorized,
            "exporting": exporting,
            "chats": self.get_all_serialized(),
        }
