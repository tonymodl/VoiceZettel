"""
exporter.py — Headless Telegram exporter using Telethon.

Extracted and adapted from github.com/morf3uzzz/telegram-exporter.
Removes all GUI (CustomTkinter) dependencies — pure async export.
"""

import asyncio
import re
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, AsyncIterator, Callable

from telethon.sync import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError
from telethon.utils import get_display_name, get_peer_id
from telethon import functions, types

logger = logging.getLogger("exporter")

# Lazy import — transcriber is optional
try:
    from transcriber import Transcriber
    _HAS_TRANSCRIBER = True
except ImportError:
    _HAS_TRANSCRIBER = False


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name or "chat_export"


def normalize_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if hasattr(value, "text"):
        return str(getattr(value, "text"))
    return str(value)


def build_forwarded_from(fwd_from) -> Optional[str]:
    if not fwd_from:
        return None
    if getattr(fwd_from, "from_name", None):
        return fwd_from.from_name
    if getattr(fwd_from, "from_id", None):
        return f"from_id:{fwd_from.from_id}"
    if getattr(fwd_from, "channel_post", None):
        return f"channel_post:{fwd_from.channel_post}"
    return None


def build_reactions(message) -> Optional[list]:
    reactions = getattr(message, "reactions", None)
    if not reactions or not getattr(reactions, "results", None):
        return None
    results = []
    for result in reactions.results:
        reaction = result.reaction
        emoji = getattr(reaction, "emoticon", None) or str(reaction)
        results.append({"emoji": emoji, "count": result.count})
    return results or None


def _extract_links(message) -> Optional[list[dict]]:
    entities = getattr(message, "entities", None) or []
    raw = getattr(message, "raw_text", "") or ""
    links: list[dict] = []
    seen: set[str] = set()
    for ent in entities:
        cls_name = type(ent).__name__
        if cls_name == "MessageEntityTextUrl":
            url = getattr(ent, "url", None)
            if url and url not in seen:
                label = raw[ent.offset : ent.offset + ent.length] if ent.offset + ent.length <= len(raw) else ""
                links.append({"url": url, "text": label} if label and label != url else {"url": url})
                seen.add(url)
        elif cls_name == "MessageEntityUrl":
            url = raw[ent.offset : ent.offset + ent.length] if ent.offset + ent.length <= len(raw) else ""
            if url and url not in seen:
                links.append({"url": url})
                seen.add(url)
    return links or None


def message_to_dict(message) -> dict:
    """Convert a Telethon Message to a serializable dict."""
    msg_type = "service" if message.action else "message"
    sender = None
    username = None
    if message.sender:
        sender = get_display_name(message.sender)
        username = getattr(message.sender, "username", None)

    raw_text = getattr(message, "raw_text", None)
    msg_text = raw_text if raw_text is not None else message.message

    msg = {
        "id": message.id,
        "type": msg_type,
        "date": message.date.isoformat() if message.date else "",
        "from": sender,
        "from_username": username,
        "from_id": message.sender_id,
        "text": normalize_text(msg_text),
    }

    links = _extract_links(message)
    if links:
        msg["links"] = links

    views = getattr(message, "views", None)
    if views is not None:
        msg["views"] = views

    forwards = getattr(message, "forwards", None)
    if forwards is not None:
        msg["forwards"] = forwards

    reply_to_msg_id = getattr(message, "reply_to_msg_id", None)
    if reply_to_msg_id:
        msg["reply_to_message_id"] = reply_to_msg_id

    forwarded = build_forwarded_from(message.fwd_from)
    if forwarded:
        msg["forwarded_from"] = forwarded

    reactions = build_reactions(message)
    if reactions:
        msg["reactions"] = reactions

    # Media type detection
    if message.media:
        if hasattr(message.media, "photo"):
            msg["media_type"] = "photo"
        elif hasattr(message.media, "document"):
            doc = message.media.document
            if doc:
                for attr in getattr(doc, "attributes", []):
                    cls = type(attr).__name__
                    if cls == "DocumentAttributeAudio":
                        msg["media_type"] = "voice" if getattr(attr, "voice", False) else "audio"
                        break
                    elif cls == "DocumentAttributeVideo":
                        msg["media_type"] = "video_note" if getattr(attr, "round_message", False) else "video"
                        break
                    elif cls == "DocumentAttributeSticker":
                        msg["media_type"] = "sticker"
                        break
                    elif cls == "DocumentAttributeAnimated":
                        msg["media_type"] = "gif"
                        break
                else:
                    msg["media_type"] = "document"
        elif hasattr(message.media, "geo"):
            msg["media_type"] = "location"
        elif hasattr(message.media, "contact"):
            msg["media_type"] = "contact"
        elif hasattr(message.media, "poll"):
            msg["media_type"] = "poll"
        else:
            msg["media_type"] = "other"

    return msg


def _classify_dialog(dialog) -> str:
    """Classify a Telethon dialog into private/group/supergroup/channel."""
    entity = dialog.entity
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


class TelegramExporter:
    """Headless Telegram exporter — manages auth & message retrieval."""

    def __init__(self, session_dir: str = "./session"):
        self.session_dir = Path(session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self._client: Optional[TelegramClient] = None
        self._api_id: Optional[int] = None
        self._api_hash: Optional[str] = None
        self._phone: Optional[str] = None
        self._phone_code_hash: Optional[str] = None
        self._cancel_event = asyncio.Event()
        # Voice transcription
        self._transcriber: Optional["Transcriber"] = None
        if _HAS_TRANSCRIBER:
            self._transcriber = Transcriber()
            logger.info(f"Voice transcription: {'enabled' if self._transcriber.is_enabled else 'disabled (no API key)'}")

    @property
    def is_connected(self) -> bool:
        return self._client is not None and self._client.is_connected()

    @property
    def is_authorized(self) -> bool:
        return self._client is not None and self._client.loop.run_until_complete(
            self._client.is_user_authorized()
        ) if self._client else False

    async def connect(self, api_id: int, api_hash: str) -> bool:
        """Initialize Telethon client and connect."""
        self._api_id = api_id
        self._api_hash = api_hash

        session_file = str(self.session_dir / "telegram_session")
        self._client = TelegramClient(session_file, api_id, api_hash)
        await self._client.connect()
        logger.info("Connected to Telegram")
        return True

    async def send_code(self, phone: str) -> bool:
        """Send auth code to phone."""
        if not self._client:
            raise RuntimeError("Not connected")
        self._phone = phone
        result = await self._client.send_code_request(phone)
        self._phone_code_hash = result.phone_code_hash
        logger.info(f"Code sent to {phone[:4]}***")
        return True

    async def verify_code(self, code: str, password: Optional[str] = None) -> dict:
        """Verify the auth code (and optional 2FA password)."""
        if not self._client or not self._phone:
            raise RuntimeError("Not connected or no phone set")

        try:
            await self._client.sign_in(
                self._phone, code, phone_code_hash=self._phone_code_hash
            )
        except SessionPasswordNeededError:
            if not password:
                return {"status": "2fa_required"}
            await self._client.sign_in(password=password)

        me = await self._client.get_me()
        return {
            "status": "authorized",
            "user": {
                "id": me.id,
                "name": get_display_name(me),
                "phone": me.phone,
                "username": me.username,
            },
        }

    async def get_auth_status(self) -> dict:
        """Check current authorization status."""
        if not self._client or not self._client.is_connected():
            return {"status": "disconnected"}
        try:
            authorized = await self._client.is_user_authorized()
        except Exception:
            return {"status": "disconnected"}
        if not authorized:
            return {"status": "not_authorized"}
        me = await self._client.get_me()
        return {
            "status": "authorized",
            "user": {
                "id": me.id,
                "name": get_display_name(me),
                "phone": me.phone,
                "username": me.username,
            },
        }

    async def get_chats(self) -> list[dict]:
        """Get all dialogs (chats, groups, channels)."""
        if not self._client:
            raise RuntimeError("Not connected")

        dialogs = await self._client.get_dialogs()
        result = []
        for d in dialogs:
            chat_type = _classify_dialog(d)
            result.append({
                "id": get_peer_id(d.entity),
                "name": d.name or "Без названия",
                "type": chat_type,
                "unread_count": d.unread_count,
                "message_count": getattr(d, "total_count", None) or 0,
                "last_date": d.date.isoformat() if d.date else None,
            })

        logger.info(f"Loaded {len(result)} chats")
        return result

    def cancel_export(self):
        """Signal cancellation for the current export operation."""
        self._cancel_event.set()

    async def export_chat(
        self,
        chat_id: int,
        on_progress: Optional[Callable[[int, Optional[int]], None]] = None,
        min_id: int = 0,
        limit: Optional[int] = None,
    ) -> list[dict]:
        """
        Export all messages from a chat.
        Args:
            chat_id: Telegram chat/channel ID.
            on_progress: callback(exported_count, total_estimate).
            min_id: Only export messages with id > min_id (for incremental).
            limit: Max messages to export. None = all.
        Returns list of message dicts.
        """
        if not self._client:
            raise RuntimeError("Not connected")

        from telethon.errors import FloodWaitError

        self._cancel_event.clear()
        messages = []
        count = 0
        retries = 0
        max_retries = 5

        # Get total estimate
        total = None
        try:
            entity = await self._client.get_entity(chat_id)
            if hasattr(entity, "participants_count"):
                pass  # Can't reliably get message count this way
        except Exception:
            pass

        while retries < max_retries:
            try:
                async for message in self._client.iter_messages(
                    chat_id,
                    min_id=min_id,
                    limit=limit,
                    reverse=True,  # oldest first
                ):
                    if self._cancel_event.is_set():
                        logger.info("Export cancelled by user")
                        break

                    if message.action and not message.message:
                        continue

                    msg_dict = message_to_dict(message)

                    # Transcribe voice messages
                    if msg_dict.get("media_type") == "voice" and self._transcriber and self._transcriber.is_enabled:
                        try:
                            transcription = await self._transcriber.transcribe_telethon_message(
                                self._client, message
                            )
                            if transcription:
                                msg_dict["transcription"] = transcription
                        except Exception as e:
                            logger.warning(f"Voice transcription failed for msg {message.id}: {e}")

                    messages.append(msg_dict)
                    count += 1

                    if on_progress and count % 500 == 0:
                        on_progress(count, total)

                # Completed successfully
                break

            except FloodWaitError as e:
                wait_seconds = e.seconds
                logger.warning(f"FloodWait: waiting {wait_seconds}s before retry (attempt {retries + 1}/{max_retries})")
                if on_progress:
                    on_progress(count, total)  # update UI while waiting
                await asyncio.sleep(wait_seconds + 1)
                retries += 1
                # Update min_id to resume from where we left off
                if messages:
                    min_id = messages[-1].get("id", min_id)
                continue

            except (ConnectionError, OSError) as e:
                retries += 1
                logger.warning(f"Network error during export: {e} (attempt {retries}/{max_retries})")
                await asyncio.sleep(5)
                # Try to reconnect
                try:
                    if self._client and not self._client.is_connected():
                        await self._client.connect()
                except Exception:
                    pass
                if messages:
                    min_id = messages[-1].get("id", min_id)
                continue

        if on_progress:
            on_progress(count, count)

        logger.info(f"Exported {count} messages from chat {chat_id}")
        return messages

    async def disconnect(self):
        """Disconnect from Telegram."""
        if self._client:
            await self._client.disconnect()
            self._client = None
            logger.info("Disconnected from Telegram")
