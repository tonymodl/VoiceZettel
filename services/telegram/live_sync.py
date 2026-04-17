"""
live_sync.py — Real-time Telegram message listener using Telethon events.

Supports filtering by chat IDs — only monitored chats are written to Obsidian.
Now includes real-time vectorization: every new message is immediately sent to
the indexer service for embedding into ChromaDB after being written to Obsidian.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from telethon import TelegramClient, events
from telethon.utils import get_display_name, get_peer_id
from telethon import types

from exporter import message_to_dict
from obsidian_writer import ObsidianWriter

try:
    from transcriber import Transcriber
    _HAS_TRANSCRIBER = True
except ImportError:
    _HAS_TRANSCRIBER = False

logger = logging.getLogger("live_sync")

INDEXER_URL = os.environ.get("INDEXER_SERVICE_URL", "http://127.0.0.1:8030")


def _classify_entity(entity) -> str:
    """Classify a Telethon entity into private/group/supergroup/channel."""
    if isinstance(entity, types.User):
        return "private"
    elif isinstance(entity, types.Chat):
        return "group"
    elif isinstance(entity, types.Channel):
        if entity.megagroup:
            return "supergroup"
        elif entity.broadcast:
            return "channel"
        return "supergroup"
    return "group"


class LiveSync:
    """Real-time Telegram → Obsidian synchronization with per-chat filtering
    and immediate vectorization."""

    def __init__(
        self,
        client: TelegramClient,
        writer: ObsidianWriter,
        chat_ids: Optional[list[int]] = None,
    ):
        self._client = client
        self._writer = writer
        self._active = False
        self._handler = None
        self._chat_ids: Optional[set[int]] = set(chat_ids) if chat_ids else None
        self._excluded_chat_ids: set[int] = set()  # blacklisted chats
        self._excluded_chat_names: dict[int, str] = {}  # id -> name for UI
        self._transcriber: Optional["Transcriber"] = None
        if _HAS_TRANSCRIBER:
            self._transcriber = Transcriber()
        self._stats = {
            "messages_received": 0,
            "messages_written": 0,
            "messages_skipped": 0,
            "messages_excluded": 0,
            "messages_vectorized": 0,
            "messages_transcribed": 0,
            "last_message_time": None,
            "last_chat": None,
            "errors": 0,
        }
        self._recent_messages: list[dict] = []  # last N messages for UI display

    @property
    def is_active(self) -> bool:
        return self._active

    @property
    def monitored_chat_ids(self) -> Optional[list[int]]:
        return list(self._chat_ids) if self._chat_ids else None

    @property
    def stats(self) -> dict:
        return {
            **self._stats,
            "active": self._active,
            "monitored_chats": len(self._chat_ids) if self._chat_ids else "all",
            "monitored_chat_ids": list(self._chat_ids) if self._chat_ids else None,
            "excluded_chats": [
                {"id": cid, "name": self._excluded_chat_names.get(cid, str(cid))}
                for cid in self._excluded_chat_ids
            ],
            "recent_messages": self._recent_messages[-15:],  # last 15
        }

    def update_chat_filter(self, chat_ids: Optional[list[int]]):
        """Update the chat filter without restarting."""
        if chat_ids is None or len(chat_ids) == 0:
            self._chat_ids = None
            logger.info("LiveSync: monitoring ALL chats")
        else:
            self._chat_ids = set(chat_ids)
            logger.info(f"LiveSync: monitoring {len(self._chat_ids)} chats")

    def exclude_chat(self, chat_id: int, chat_name: str = ""):
        """Add a chat to the exclusion (blacklist) list."""
        self._excluded_chat_ids.add(chat_id)
        if chat_name:
            self._excluded_chat_names[chat_id] = chat_name
        logger.info(f"LiveSync: excluded chat {chat_name or chat_id}")

    def unexclude_chat(self, chat_id: int):
        """Remove a chat from the exclusion list."""
        self._excluded_chat_ids.discard(chat_id)
        self._excluded_chat_names.pop(chat_id, None)
        logger.info(f"LiveSync: unexcluded chat {chat_id}")

    def clear_excluded(self):
        """Clear all excluded chats."""
        self._excluded_chat_ids.clear()
        self._excluded_chat_names.clear()
        logger.info("LiveSync: cleared all exclusions")

    def remove_recent_message(self, index: int):
        """Remove a message from the recent messages list by index."""
        if 0 <= index < len(self._recent_messages):
            self._recent_messages.pop(index)

    def clear_recent_messages(self):
        """Clear all recent messages from the feed."""
        self._recent_messages.clear()

    async def _vectorize_file(self, file_path: str, msg_entry: dict) -> bool:
        """Send a written file to the indexer for vectorization.
        Updates the message entry's vectorization_status in-place.
        
        IMPORTANT: Checks response body for {"status": "ok"}, not just HTTP 200.
        The indexer returns 200 with {"status": "skipped"} for files < 20 chars,
        which previously caused the dashboard to falsely show "vectorized".
        """
        msg_entry["vectorization_status"] = "vectorizing"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    f"{INDEXER_URL}/index/file",
                    json={"file_path": file_path},
                )
                if r.status_code == 200:
                    body = r.json()
                    actual_status = body.get("status", "unknown")
                    if actual_status == "ok":
                        chunks = body.get("chunks", 0)
                        msg_entry["vectorization_status"] = "vectorized"
                        self._stats["messages_vectorized"] += 1
                        logger.debug(f"Vectorized {file_path}: {chunks} chunks")
                        return True
                    else:
                        # Indexer returned 200 but skipped the file (too short, etc.)
                        reason = body.get("reason", "unknown")
                        msg_entry["vectorization_status"] = f"skipped: {reason}"
                        logger.info(f"Indexer skipped {file_path}: {reason}")
                        return False
                else:
                    logger.warning(f"Indexer returned {r.status_code} for {file_path}")
                    msg_entry["vectorization_status"] = "error"
                    return False
        except Exception as e:
            logger.warning(f"Vectorization failed for {file_path}: {e}")
            msg_entry["vectorization_status"] = "error"
            return False

    async def start(self):
        """Start listening for new messages."""
        if self._active:
            logger.warning("LiveSync already active")
            return

        async def on_new_message(event):
            """Handle incoming/outgoing messages."""
            try:
                message = event.message
                if not message or (message.action and not message.message):
                    return

                # Get chat info
                chat = await message.get_chat()
                if not chat:
                    return

                chat_id = get_peer_id(chat)
                chat_name = get_display_name(chat)
                chat_type = _classify_entity(chat)

                # Check exclusion list (blacklist)
                if chat_id in self._excluded_chat_ids:
                    self._stats["messages_excluded"] += 1
                    return

                # Check if this chat is in the filter (whitelist)
                if self._chat_ids is not None and chat_id not in self._chat_ids:
                    self._stats["messages_skipped"] += 1
                    return

                # Convert to dict
                msg_dict = message_to_dict(message)

                # Prepare recent message entry with status tracking
                msg_entry = {
                    "chat": chat_name,
                    "chat_id": chat_id,
                    "text": (msg_dict.get("text", "") or "")[:80],
                    "from": msg_dict.get("from", ""),
                    "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                    "vectorization_status": "pending",   # pending → vectorizing → vectorized → error
                    "transcription_status": "skipped",   # skipped → pending → transcribing → transcribed → error
                    "media_type": msg_dict.get("media_type"),
                }

                # Mark voice messages for transcription
                if msg_dict.get("media_type") == "voice":
                    msg_entry["transcription_status"] = "pending"

                # Add to recent messages early so UI shows "pending" state
                self._recent_messages.append(msg_entry)
                if len(self._recent_messages) > 50:
                    self._recent_messages = self._recent_messages[-30:]

                # Transcribe voice messages
                if msg_dict.get("media_type") == "voice" and self._transcriber and self._transcriber.is_enabled:
                    msg_entry["transcription_status"] = "transcribing"
                    try:
                        transcription = await self._transcriber.transcribe_telethon_message(
                            self._client, message
                        )
                        if transcription:
                            msg_dict["transcription"] = transcription
                            msg_entry["transcription_status"] = "transcribed"
                            self._stats["messages_transcribed"] += 1
                        else:
                            msg_entry["transcription_status"] = "error"
                    except Exception as e:
                        logger.warning(f"LiveSync voice transcription failed: {e}")
                        msg_entry["transcription_status"] = "error"

                # Write to Obsidian
                written = await self._writer.write_messages(
                    chat_name=chat_name,
                    chat_type=chat_type,
                    messages=[msg_dict],
                )

                self._stats["messages_received"] += 1
                self._stats["messages_written"] += written
                self._stats["last_message_time"] = datetime.now(timezone.utc).isoformat()
                self._stats["last_chat"] = chat_name

                # Update message text in entry (may have transcription appended)
                if msg_dict.get("transcription"):
                    msg_entry["text"] = (msg_entry["text"] + " 🎤 " + msg_dict["transcription"][:40])[:120]

                # Vectorize the written file immediately
                if written > 0:
                    # Build the file path that was written
                    note_path = self._writer.get_note_path_for_message(chat_name, chat_type, msg_dict)
                    if note_path:
                        # Run vectorization in background to not block message processing
                        asyncio.create_task(self._vectorize_file(str(note_path), msg_entry))
                    else:
                        msg_entry["vectorization_status"] = "error"

                logger.debug(f"LiveSync: {chat_name} — {msg_dict.get('text', '')[:50]}")

            except Exception as e:
                self._stats["errors"] += 1
                logger.error(f"LiveSync handler error: {e}")

        # Register handler for both incoming and outgoing
        self._handler = self._client.on(events.NewMessage(incoming=True, outgoing=True))(on_new_message)
        self._active = True

        filter_desc = f"{len(self._chat_ids)} chats" if self._chat_ids else "ALL chats"
        logger.info(f"LiveSync started — monitoring {filter_desc}")

    async def stop(self):
        """Stop listening for new messages."""
        if not self._active:
            return

        if self._handler:
            self._client.remove_event_handler(self._handler)
            self._handler = None

        self._active = False
        logger.info("LiveSync stopped")

    def reset_stats(self):
        """Reset sync statistics."""
        self._stats = {
            "messages_received": 0,
            "messages_written": 0,
            "messages_skipped": 0,
            "messages_excluded": 0,
            "messages_vectorized": 0,
            "messages_transcribed": 0,
            "last_message_time": None,
            "last_chat": None,
            "errors": 0,
        }
        self._recent_messages = []
