"""
main.py — FastAPI microservice for Telegram export & sync.

Endpoints:
  POST /auth/connect     — connect with API ID/Hash
  POST /auth/send-code   — send SMS code
  POST /auth/verify      — verify code + 2FA
  GET  /auth/status      — authorization status
  GET  /chats            — list all chats
  POST /export           — export chat(s) to Obsidian
  GET  /export/status    — export progress (global + per-chat)
  POST /export/cancel    — cancel running export
  POST /sync/start       — start live sync
  POST /sync/stop        — stop live sync
  GET  /sync/status      — live sync status
  POST /sync/filter      — update sync filter
  POST /disconnect       — disconnect from Telegram
"""

import asyncio
import os
import logging
import sys
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv

# Load .env from project root BEFORE importing modules that read env vars
env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

class UnicodeJSONResponse(JSONResponse):
    def render(self, content: any) -> bytes:
        import json
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")

from exporter import TelegramExporter
from obsidian_writer import ObsidianWriter
from live_sync import LiveSync
from export_tracker import ExportTracker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("telegram-service")

# ── Config ─────────────────────────────────────────────────────
VAULT_PATH = os.environ.get("VAULT_PATH", "")
OBSIDIAN_REST_URL = os.environ.get("OBSIDIAN_REST_URL", "https://127.0.0.1:27124")
OBSIDIAN_REST_API_KEY = os.environ.get("OBSIDIAN_REST_API_KEY", "")
INDEXER_URL = os.environ.get("INDEXER_SERVICE_URL", "http://127.0.0.1:8030")

# ── Global state ───────────────────────────────────────────────
exporter = TelegramExporter(session_dir=os.path.join(os.path.dirname(__file__), "session"))
writer: Optional[ObsidianWriter] = None
live_sync: Optional[LiveSync] = None
tracker = ExportTracker()

# Export progress tracking (enhanced)
export_state = {
    "running": False,
    "status": "idle",           # idle | exporting | completed | stopped | rate_limited
    "stop_reason": None,        # user | rate_limit | error | None
    "chat_name": "",
    "exported": 0,
    "total": None,
    "chats_done": 0,
    "chats_total": 0,
    "error": None,
    "auto_retry_at": None,      # ISO timestamp of next auto-retry
}

# ── Export Logs (persistent per-event log) ──────────────────────
EXPORT_LOGS_PATH = os.path.join(os.path.dirname(__file__), "session", "export_logs.json")
MAX_LOGS = 200

def _load_export_logs() -> list[dict]:
    """Load export logs from file."""
    try:
        if os.path.exists(EXPORT_LOGS_PATH):
            import json
            with open(EXPORT_LOGS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return []

def _save_export_logs(logs: list[dict]):
    """Persist export logs to file."""
    try:
        import json
        os.makedirs(os.path.dirname(EXPORT_LOGS_PATH), exist_ok=True)
        with open(EXPORT_LOGS_PATH, "w", encoding="utf-8") as f:
            json.dump(logs[-MAX_LOGS:], f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Failed to save export logs: {e}")

export_logs: list[dict] = _load_export_logs()

def add_export_log(level: str, message: str, chat_name: str = "", chat_id: int = 0):
    """Add an entry to the export log. level: info | warn | error | success"""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "message": message,
        "chat_name": chat_name,
        "chat_id": chat_id,
    }
    export_logs.append(entry)
    # Trim in memory
    if len(export_logs) > MAX_LOGS:
        del export_logs[:-MAX_LOGS]
    # Persist every 5 entries
    if len(export_logs) % 5 == 0:
        _save_export_logs(export_logs)

app = FastAPI(
    title="VoiceZettel Telegram Service",
    version="2.0.0",
    default_response_class=UnicodeJSONResponse
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _auto_reconnect():
    """Auto-reconnect to Telegram if a saved session exists."""
    session_file = os.path.join(os.path.dirname(__file__), "session", "telegram_session.session")
    if not os.path.exists(session_file):
        logger.info("No saved Telegram session — skipping auto-connect")
        return

    # Read API ID/Hash from env or use defaults saved during first connect
    api_id = int(os.environ.get("TELEGRAM_API_ID", "0"))
    api_hash = os.environ.get("TELEGRAM_API_HASH", "")

    if not api_id or not api_hash:
        # Try to read from session metadata file
        meta_file = os.path.join(os.path.dirname(__file__), "session", "api_credentials.json")
        if os.path.exists(meta_file):
            import json
            with open(meta_file, "r") as f:
                creds = json.load(f)
                api_id = creds.get("api_id", 0)
                api_hash = creds.get("api_hash", "")

    if not api_id or not api_hash:
        logger.warning("Session file exists but no API credentials saved — use /auth/connect")
        return

    try:
        await exporter.connect(api_id, api_hash)
        status = await exporter.get_auth_status()
        if status.get("status") == "authorized":
            logger.info(f"Auto-reconnected to Telegram as {status.get('user', {}).get('name', '?')}")
            # Auto-start live sync with exported chats
            asyncio.create_task(_auto_start_live_sync())
        else:
            logger.info(f"Session exists but not authorized: {status.get('status')}")
    except Exception as e:
        logger.warning(f"Auto-reconnect failed: {e}")


async def _auto_start_live_sync():
    """Auto-start live sync after Telegram reconnection."""
    global live_sync
    await asyncio.sleep(3)  # Let everything initialize
    try:
        if live_sync and live_sync.is_active:
            logger.info("Live sync already active — skip auto-start")
            return

        exported = tracker.get_exported_chat_ids()
        if not exported:
            logger.info("No exported chats — skip live sync auto-start")
            return

        w = _get_writer()
        live_sync = LiveSync(exporter._client, w, chat_ids=exported)
        await live_sync.start()
        logger.info(f"Live sync auto-started: мониторинг {len(exported)} экспортированных чатов")
    except Exception as e:
        logger.warning(f"Live sync auto-start failed: {e}")


def _get_writer() -> ObsidianWriter:
    global writer
    if writer is None:
        if not VAULT_PATH:
            raise HTTPException(500, "VAULT_PATH not configured in .env")
        writer = ObsidianWriter(
            vault_path=VAULT_PATH,
            rest_api_url=OBSIDIAN_REST_URL,
            rest_api_key=OBSIDIAN_REST_API_KEY,
        )
    return writer


# ── Pydantic Models ────────────────────────────────────────────

class ConnectRequest(BaseModel):
    api_id: int
    api_hash: str


class SendCodeRequest(BaseModel):
    phone: str


class VerifyRequest(BaseModel):
    code: str
    password: Optional[str] = None


class ExportRequest(BaseModel):
    chat_ids: list[int]
    incremental: bool = True  # default to incremental now


class ExportSingleRequest(BaseModel):
    chat_id: int
    incremental: bool = True


class SyncStartRequest(BaseModel):
    chat_ids: Optional[list[int]] = None
    monitor_all: bool = False  # True = explicitly monitor ALL chats


class SyncFilterRequest(BaseModel):
    chat_ids: Optional[list[int]] = None  # None = monitor all chats


# ── Auth Endpoints ─────────────────────────────────────────────

@app.post("/auth/connect")
async def auth_connect(req: ConnectRequest):
    """Connect to Telegram with API credentials."""
    try:
        await exporter.connect(req.api_id, req.api_hash)
        # Save credentials for auto-reconnect on restart
        import json
        meta_file = os.path.join(os.path.dirname(__file__), "session", "api_credentials.json")
        with open(meta_file, "w") as f:
            json.dump({"api_id": req.api_id, "api_hash": req.api_hash}, f)
        status = await exporter.get_auth_status()
        return status
    except Exception as e:
        logger.error(f"Connect failed: {e}")
        raise HTTPException(500, str(e))


@app.post("/auth/send-code")
async def auth_send_code(req: SendCodeRequest):
    """Send auth code to phone number."""
    try:
        await exporter.send_code(req.phone)
        return {"status": "code_sent", "phone": req.phone[:4] + "***"}
    except Exception as e:
        logger.error(f"Send code failed: {e}")
        raise HTTPException(500, str(e))


@app.post("/auth/verify")
async def auth_verify(req: VerifyRequest):
    """Verify auth code (and optional 2FA password)."""
    try:
        result = await exporter.verify_code(req.code, req.password)
        return result
    except Exception as e:
        logger.error(f"Verify failed: {e}")
        raise HTTPException(500, str(e))


@app.get("/auth/status")
async def auth_status():
    """Get current auth status."""
    return await exporter.get_auth_status()


@app.post("/disconnect")
async def disconnect():
    """Disconnect from Telegram."""
    global live_sync
    if live_sync and live_sync.is_active:
        await live_sync.stop()
        live_sync = None
    await exporter.disconnect()
    return {"status": "disconnected"}


# ── Chat Endpoints ─────────────────────────────────────────────

@app.get("/chats")
async def get_chats():
    """Get all Telegram chats with export progress."""
    try:
        chats = await exporter.get_chats()
        # Enrich with export progress from tracker
        for chat in chats:
            progress = tracker.get(chat["id"])
            if progress:
                chat["export_progress"] = progress.to_dict()
            else:
                chat["export_progress"] = None
        return {"chats": chats, "count": len(chats)}
    except Exception as e:
        logger.error(f"Get chats failed: {e}")
        raise HTTPException(500, str(e))


# ── Export Endpoints ───────────────────────────────────────────

async def _vectorize_chat_files(chat_name: str, chat_type: str, chat_id: int):
    """Trigger vectorization for all files of a chat after export."""
    import httpx
    from obsidian_writer import TELEGRAM_ROOT, CHAT_TYPE_DIRS, _sanitize

    type_dir = CHAT_TYPE_DIRS.get(chat_type, "Другое")
    safe_name = _sanitize(chat_name)
    chat_dir = os.path.join(VAULT_PATH, TELEGRAM_ROOT, type_dir, safe_name)

    if not os.path.isdir(chat_dir):
        return 0

    chunks = 0
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for fname in os.listdir(chat_dir):
                if fname.endswith(".md"):
                    file_path = os.path.join(chat_dir, fname)
                    try:
                        r = await client.post(
                            f"{INDEXER_URL}/index/file",
                            json={"file_path": file_path},
                        )
                        if r.status_code == 200:
                            data = r.json()
                            chunks += data.get("chunks", 0)
                    except Exception as e:
                        logger.warning(f"Vectorize file failed: {fname}: {e}")
    except Exception as e:
        logger.error(f"Vectorize chat dir failed: {e}")

    return chunks


# ── Export Queue ────────────────────────────────────────────────
EXPORT_QUEUE_PATH = os.path.join(os.path.dirname(__file__), "session", "export_queue.json")

class ExportQueueItem:
    """Represents a single chat in the export queue."""
    def __init__(self, chat_id: int, chat_name: str = "", chat_type: str = "group",
                 msg_count: int = 0, incremental: bool = True,
                 status: str = "queued", error: str | None = None):
        self.chat_id = chat_id
        self.chat_name = chat_name
        self.chat_type = chat_type
        self.msg_count = msg_count
        self.incremental = incremental
        self.status = status  # queued | exporting | vectorizing | done | error
        self.error = error

    def to_dict(self) -> dict:
        return {
            "chat_id": self.chat_id, "chat_name": self.chat_name,
            "chat_type": self.chat_type, "msg_count": self.msg_count,
            "incremental": self.incremental, "status": self.status,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ExportQueueItem":
        return cls(**{k: d[k] for k in ["chat_id","chat_name","chat_type","msg_count","incremental","status","error"] if k in d})


def _load_queue() -> list[ExportQueueItem]:
    try:
        if os.path.exists(EXPORT_QUEUE_PATH):
            import json
            with open(EXPORT_QUEUE_PATH, "r", encoding="utf-8") as f:
                return [ExportQueueItem.from_dict(d) for d in json.load(f)]
    except Exception:
        pass
    return []


def _save_queue(queue: list[ExportQueueItem]):
    try:
        import json
        os.makedirs(os.path.dirname(EXPORT_QUEUE_PATH), exist_ok=True)
        with open(EXPORT_QUEUE_PATH, "w", encoding="utf-8") as f:
            json.dump([item.to_dict() for item in queue], f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Failed to save queue: {e}")


export_queue: list[ExportQueueItem] = _load_queue()
queue_worker_running = False
QUEUE_CONCURRENCY = 5


async def _process_single_chat(item: ExportQueueItem, w: ObsidianWriter):
    """Export and vectorize a single chat from the queue."""
    chat_id = item.chat_id
    chat_name = item.chat_name
    chat_type = item.chat_type

    item.status = "exporting"
    _save_queue(export_queue)
    tracker.start_export(chat_id, chat_name, item.msg_count)
    add_export_log("info", f"Экспорт начат ({item.msg_count} сообщ.)", chat_name, chat_id)

    min_id = tracker.get_min_id(chat_id) if item.incremental else 0

    try:
        from telethon.errors import FloodWaitError

        def on_progress(count, total, _cid=chat_id):
            tracker.update_progress(_cid, count)

        messages = await exporter.export_chat(chat_id, on_progress=on_progress, min_id=min_id)

        if not messages:
            prev = tracker.get(chat_id)
            tracker.complete_export(chat_id, prev.exported_count if prev else 0, min_id)
            add_export_log("info", "Нет новых сообщений", chat_name, chat_id)
            item.status = "done"
            _save_queue(export_queue)
            return

        written = await w.write_messages(chat_name=chat_name, chat_type=chat_type, messages=messages)
        last_msg_id = max(m.get("id", 0) for m in messages) if messages else min_id
        prev = tracker.get(chat_id)
        total_exported = len(messages) if not item.incremental else (prev.exported_count if prev else 0) + len(messages)
        tracker.complete_export(chat_id, total_exported, last_msg_id)
        add_export_log("success", f"Записано {written} сообщений", chat_name, chat_id)

        # Vectorize
        item.status = "vectorizing"
        _save_queue(export_queue)
        chunks = await _vectorize_chat_files(chat_name, chat_type, chat_id)
        tracker.mark_vectorized(chat_id, chunks)
        add_export_log("success", f"Векторизация: {chunks} чанков", chat_name, chat_id)

        item.status = "done"
        _save_queue(export_queue)

    except FloodWaitError as e:
        wait_seconds = e.seconds
        msg = f"Telegram ограничил запросы. Ожидание {wait_seconds} сек. Повтор автоматически."
        add_export_log("warn", msg, chat_name, chat_id)
        tracker.mark_error(chat_id, msg)
        item.error = msg
        item.status = "queued"  # Re-queue for retry
        _save_queue(export_queue)
        await asyncio.sleep(wait_seconds + 2)

    except ConnectionError as e:
        err_msg = f"Потеряно соединение с Telegram. Проверьте интернет и VPN. ({e})"
        logger.error(f"Connection error for '{chat_name}': {e}")
        tracker.mark_error(chat_id, err_msg)
        add_export_log("error", err_msg, chat_name, chat_id)
        item.status = "error"
        item.error = err_msg
        _save_queue(export_queue)

    except PermissionError as e:
        err_msg = f"Нет доступа к чату. Возможно, вы вышли из группы или были забанены. ({e})"
        logger.error(f"Permission error for '{chat_name}': {e}")
        tracker.mark_error(chat_id, err_msg)
        add_export_log("error", err_msg, chat_name, chat_id)
        item.status = "error"
        item.error = err_msg
        _save_queue(export_queue)

    except OSError as e:
        if "No space" in str(e) or "disk" in str(e).lower():
            err_msg = f"Не хватает места на диске. Освободите место и повторите. ({e})"
        else:
            err_msg = f"Ошибка файловой системы при записи. Проверьте доступ к папке Obsidian. ({e})"
        logger.error(f"OS error for '{chat_name}': {e}")
        tracker.mark_error(chat_id, err_msg)
        add_export_log("error", err_msg, chat_name, chat_id)
        item.status = "error"
        item.error = err_msg
        _save_queue(export_queue)

    except Exception as e:
        err_str = str(e)
        # Classify known Telethon / network errors
        if "timeout" in err_str.lower() or "timed out" in err_str.lower():
            err_msg = f"Превышено время ожидания ответа от Telegram. Попробуйте позже. ({err_str})"
        elif "auth" in err_str.lower() or "session" in err_str.lower():
            err_msg = f"Ошибка авторизации Telegram. Перезапустите сервис и войдите заново. ({err_str})"
        elif "ChatAdminRequired" in err_str or "ChatWriteForbidden" in err_str:
            err_msg = f"Нет прав для чтения этого чата. Вы должны быть участником. ({err_str})"
        elif "ChannelPrivate" in err_str or "ChannelInvalid" in err_str:
            err_msg = f"Чат недоступен — возможно, он был удалён или стал приватным. ({err_str})"
        elif "chromadb" in err_str.lower() or "vector" in err_str.lower():
            err_msg = f"Ошибка векторизации (ChromaDB). Проверьте, что сервис индексации запущен. ({err_str})"
        elif "has no attribute" in err_str or isinstance(e, AttributeError):
            err_msg = f"Ошибка совместимости Telegram API при обработке сообщений. Обновите сервис или нажмите «Перезапустить». ({err_str})"
        else:
            err_msg = f"Неизвестная ошибка: {err_str}. Нажмите «Перезапустить» для повторной попытки."
        logger.error(f"Export error for '{chat_name}': {e}")
        tracker.mark_error(chat_id, err_msg)
        add_export_log("error", err_msg, chat_name, chat_id)
        item.status = "error"
        item.error = err_msg
        _save_queue(export_queue)


async def _queue_worker():
    """Background worker: processes export queue with concurrency limit."""
    global queue_worker_running, export_state
    if queue_worker_running:
        return
    queue_worker_running = True

    w = _get_writer()
    sem = asyncio.Semaphore(QUEUE_CONCURRENCY)

    export_state["running"] = True
    export_state["status"] = "exporting"

    try:
        while True:
            # Find queued items
            queued = [item for item in export_queue if item.status == "queued"]
            if not queued:
                break

            # Launch batch with semaphore
            tasks = []
            for item in queued[:QUEUE_CONCURRENCY * 2]:  # Look ahead
                async def _run(it=item):
                    async with sem:
                        await _process_single_chat(it, w)
                tasks.append(asyncio.create_task(_run()))

            await asyncio.gather(*tasks, return_exceptions=True)

            # Update state
            active = [it for it in export_queue if it.status in ("queued", "exporting", "vectorizing")]
            if not active:
                break

        # Done — clean up completed items (keep errors for visibility)
        done_count = sum(1 for it in export_queue if it.status == "done")
        add_export_log("success", f"Очередь завершена: {done_count} чатов экспортировано")
        _save_export_logs(export_logs)

        # Update live sync
        global live_sync
        if live_sync and live_sync.is_active:
            exported_ids = tracker.get_exported_chat_ids()
            if exported_ids:
                live_sync.update_chat_filter(exported_ids)

        # Write index
        try:
            all_chats = await exporter.get_chats()
            await w.write_index(all_chats)
        except Exception:
            pass

        export_state["status"] = "completed"

    except Exception as e:
        logger.error(f"Queue worker error: {e}")
        add_export_log("error", f"Ошибка воркера: {e}")
        export_state["status"] = "stopped"
        export_state["error"] = str(e)
    finally:
        queue_worker_running = False
        export_state["running"] = False
        _save_queue(export_queue)


class QueueAddRequest(BaseModel):
    chat_ids: list[int]
    incremental: bool = True


class QueueRemoveRequest(BaseModel):
    chat_ids: list[int]


@app.post("/export/queue")
async def add_to_queue(req: QueueAddRequest):
    """Add chats to the export queue. Safe to call multiple times."""
    # Get chat info for names/types
    try:
        all_chats = await exporter.get_chats()
        chat_map = {c["id"]: c for c in all_chats}
    except Exception:
        chat_map = {}

    added = 0
    existing_ids = {item.chat_id for item in export_queue if item.status in ("queued", "exporting", "vectorizing")}

    for chat_id in req.chat_ids:
        if chat_id in existing_ids:
            continue
        # Remove old done/error entry if exists
        export_queue[:] = [it for it in export_queue if not (it.chat_id == chat_id and it.status in ("done", "error"))]

        info = chat_map.get(chat_id, {"name": str(chat_id), "type": "group", "message_count": 0})
        item = ExportQueueItem(
            chat_id=chat_id,
            chat_name=info.get("name", str(chat_id)),
            chat_type=info.get("type", "group"),
            msg_count=info.get("message_count", 0),
            incremental=req.incremental,
        )
        export_queue.append(item)
        added += 1

    _save_queue(export_queue)
    add_export_log("info", f"Добавлено в очередь: {added} чатов")

    # Auto-start worker if not running
    if not queue_worker_running and added > 0:
        asyncio.create_task(_queue_worker())

    return {"status": "queued", "added": added, "total_queue": len(export_queue)}


@app.get("/export/queue")
async def get_queue():
    """Get current export queue state."""
    return {
        "items": [item.to_dict() for item in export_queue],
        "processing": queue_worker_running,
        "concurrency": QUEUE_CONCURRENCY,
    }


@app.post("/export/queue/remove")
async def remove_from_queue(req: QueueRemoveRequest):
    """Remove chats from queue (only if queued or done/error, not currently exporting)."""
    removed = 0
    remove_set = set(req.chat_ids)
    new_queue = []
    for item in export_queue:
        if item.chat_id in remove_set and item.status in ("queued", "done", "error"):
            removed += 1
        else:
            new_queue.append(item)
    export_queue.clear()
    export_queue.extend(new_queue)
    _save_queue(export_queue)
    return {"removed": removed}


@app.post("/export/queue/clear-done")
async def clear_done_queue():
    """Remove all done items from queue."""
    new_queue = [it for it in export_queue if it.status not in ("done",)]
    count = len(export_queue) - len(new_queue)
    export_queue.clear()
    export_queue.extend(new_queue)
    _save_queue(export_queue)
    return {"cleared": count}


@app.post("/export/queue/retry")
async def retry_failed(req: QueueRemoveRequest):
    """Re-queue failed chats for retry."""
    retried = 0
    retry_set = set(req.chat_ids)
    for item in export_queue:
        if item.chat_id in retry_set and item.status == "error":
            item.status = "queued"
            item.error = None
            retried += 1
    _save_queue(export_queue)

    if retried > 0 and not queue_worker_running:
        asyncio.create_task(_queue_worker())
        add_export_log("info", f"Перезапуск: {retried} чатов повторно в очереди")

    return {"retried": retried}


# Keep old /export endpoint for compatibility but redirect to queue
@app.post("/export")
async def export_chats(req: ExportRequest):
    """Legacy: adds chats to queue and starts processing."""
    queue_req = QueueAddRequest(chat_ids=req.chat_ids, incremental=req.incremental)
    return await add_to_queue(queue_req)


@app.get("/export/status")
async def export_status_endpoint():
    """Get current export progress with per-chat details + queue."""
    return {
        **export_state,
        "tracker": tracker.get_summary(),
        "queue": [item.to_dict() for item in export_queue],
        "queue_processing": queue_worker_running,
    }


@app.post("/export/cancel")
async def export_cancel():
    """Cancel running exports — stops the worker after current batch."""
    global queue_worker_running
    # Mark all queued items as cancelled
    for item in export_queue:
        if item.status == "queued":
            item.status = "error"
            item.error = "Отменено"
    _save_queue(export_queue)
    queue_worker_running = False
    export_state["status"] = "stopped"
    export_state["stop_reason"] = "user"
    add_export_log("warn", "Экспорт отменён пользователем")
    return {"status": "cancelled"}


@app.get("/export/logs")
async def get_export_logs(limit: int = 50):
    """Get export log history."""
    return {"logs": export_logs[-limit:]}


class DeleteChatRequest(BaseModel):
    chat_id: int
    chat_name: str
    chat_type: str = "private"


@app.post("/export/delete-chat")
async def delete_chat_from_obsidian(req: DeleteChatRequest):
    """Delete a chat's exported files from Obsidian and remove from tracker."""
    import shutil
    from obsidian_writer import TELEGRAM_ROOT, CHAT_TYPE_DIRS, _sanitize

    type_dir = CHAT_TYPE_DIRS.get(req.chat_type, "Другое")
    safe_name = _sanitize(req.chat_name)
    chat_dir = os.path.join(VAULT_PATH, TELEGRAM_ROOT, type_dir, safe_name)

    deleted_files = 0
    if os.path.isdir(chat_dir):
        try:
            file_count = len([f for f in os.listdir(chat_dir) if f.endswith(".md")])
            shutil.rmtree(chat_dir)
            deleted_files = file_count
            logger.info(f"Deleted chat dir: {chat_dir} ({deleted_files} files)")
        except Exception as e:
            logger.error(f"Failed to delete chat dir: {e}")
            raise HTTPException(500, f"Failed to delete: {e}")

    # Remove from tracker
    tracker.remove_chat(req.chat_id)

    # Try to remove from vector index
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{INDEXER_URL}/delete/prefix",
                json={"prefix": f"Telegram/{type_dir}/{safe_name}"},
            )
    except Exception:
        pass  # Vector cleanup is best-effort

    return {
        "status": "deleted",
        "chat_id": req.chat_id,
        "deleted_files": deleted_files,
    }


# ── Live Sync Endpoints ───────────────────────────────────────

@app.post("/sync/start")
async def sync_start(req: SyncStartRequest = SyncStartRequest()):
    """Start real-time message sync to Obsidian. Optionally filter by chat IDs."""
    global live_sync

    if not exporter._client:
        raise HTTPException(400, "Not connected to Telegram")

    w = _get_writer()

    if live_sync and live_sync.is_active:
        # Update filter if already running
        live_sync.update_chat_filter(req.chat_ids)
        return {"status": "filter_updated", **live_sync.stats}

    # Determine which chats to monitor
    chat_ids = req.chat_ids
    if req.monitor_all:
        # User explicitly chose "all chats"
        logger.info("Sync: мониторинг ВСЕХ чатов (по запросу пользователя)")
        chat_ids = None
    elif chat_ids is None:
        # Default: only exported chats
        exported = tracker.get_exported_chat_ids()
        if exported:
            logger.info(f"Sync: мониторинг {len(exported)} экспортированных чатов (по умолчанию)")
            chat_ids = exported
        else:
            logger.info("Sync: нет экспортированных чатов — мониторинг всех")

    live_sync = LiveSync(exporter._client, w, chat_ids=chat_ids)
    await live_sync.start()
    return {"status": "started", **live_sync.stats}


@app.post("/sync/filter")
async def sync_update_filter(req: SyncFilterRequest):
    """Update the chat filter for live sync without restarting."""
    global live_sync
    if not live_sync or not live_sync.is_active:
        raise HTTPException(400, "Live sync is not running")
    live_sync.update_chat_filter(req.chat_ids)
    return {"status": "filter_updated", **live_sync.stats}


@app.post("/sync/stop")
async def sync_stop():
    """Stop real-time sync."""
    global live_sync
    if live_sync:
        await live_sync.stop()
        return {"status": "stopped", **live_sync.stats}
    return {"status": "not_running"}


@app.get("/sync/status")
async def sync_status():
    """Get live sync status."""
    if live_sync:
        return live_sync.stats
    return {
        "active": False,
        "messages_received": 0,
        "messages_written": 0,
        "messages_skipped": 0,
        "messages_excluded": 0,
        "messages_vectorized": 0,
        "messages_transcribed": 0,
        "monitored_chats": "none",
        "excluded_chats": [],
        "recent_messages": [],
    }


class ExcludeChatRequest(BaseModel):
    chat_id: int
    chat_name: str = ""


class RemoveMessageRequest(BaseModel):
    index: int


@app.post("/sync/exclude")
async def sync_exclude_chat(req: ExcludeChatRequest):
    """Exclude a chat from live sync (blacklist)."""
    if not live_sync:
        raise HTTPException(400, "Live sync is not running")
    live_sync.exclude_chat(req.chat_id, req.chat_name)
    return {"status": "excluded", "chat_id": req.chat_id, "excluded_chats": live_sync.stats["excluded_chats"]}


@app.post("/sync/unexclude")
async def sync_unexclude_chat(req: ExcludeChatRequest):
    """Remove a chat from the exclusion list."""
    if not live_sync:
        raise HTTPException(400, "Live sync is not running")
    live_sync.unexclude_chat(req.chat_id)
    return {"status": "unexcluded", "chat_id": req.chat_id, "excluded_chats": live_sync.stats["excluded_chats"]}


@app.post("/sync/clear-excluded")
async def sync_clear_excluded():
    """Clear all excluded chats."""
    if not live_sync:
        raise HTTPException(400, "Live sync is not running")
    live_sync.clear_excluded()
    return {"status": "cleared"}


@app.post("/sync/remove-message")
async def sync_remove_message(req: RemoveMessageRequest):
    """Remove a message from the live feed by index."""
    if not live_sync:
        raise HTTPException(400, "Live sync is not running")
    live_sync.remove_recent_message(req.index)
    return {"status": "removed"}


@app.post("/sync/clear-messages")
async def sync_clear_messages():
    """Clear all messages from the live feed."""
    if not live_sync:
        raise HTTPException(400, "Live sync is not running")
    live_sync.clear_recent_messages()
    return {"status": "cleared"}


# ── Health ─────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check."""
    auth = await exporter.get_auth_status()
    return {
        "service": "telegram-exporter",
        "status": "ok",
        "vault_path": VAULT_PATH,
        "obsidian_rest_url": OBSIDIAN_REST_URL,
        "auth": auth,
        "sync_active": live_sync.is_active if live_sync else False,
        "export_running": export_state.get("running", False),
        "export_status": export_state.get("status", "idle"),
        "voice_transcription": exporter._transcriber.stats if exporter._transcriber else {"enabled": False},
        "export_tracker": tracker.get_summary(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8020)
