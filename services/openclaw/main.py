"""
OpenClaw Heartbeat Daemon — FastAPI HTTP service.
VoiceZettel 3.0 Phase 3

Provides health, trigger, and status endpoints for the OpenClaw
LLM-Wiki agent. Runs a background Heartbeat every 30 minutes.

Port: 8040
"""

import os
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the worker
from openclaw_worker import OpenClawWorker

logger = logging.getLogger("openclaw.server")

# ── Configuration ─────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
HEARTBEAT_INTERVAL = int(os.environ.get("OPENCLAW_HEARTBEAT_MINUTES", "30"))
PORT = int(os.environ.get("OPENCLAW_PORT", "8040"))

# ── Worker singleton ──────────────────────────────────────
worker = OpenClawWorker()
heartbeat_task: asyncio.Task | None = None
server_start_time: datetime | None = None


async def heartbeat_loop():
    """Background heartbeat: runs ingest cycle every N minutes."""
    while True:
        try:
            logger.info(f"Heartbeat triggered — starting ingest cycle")
            result = await worker.run_once()
            logger.info(f"Heartbeat cycle complete: {result}")
        except Exception as e:
            logger.error(f"Heartbeat cycle error: {e}")

        await asyncio.sleep(HEARTBEAT_INTERVAL * 60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start heartbeat on server boot, stop on shutdown."""
    global heartbeat_task, server_start_time
    server_start_time = datetime.now(timezone.utc)
    
    # Auto-create shadow dirs
    raw_dir = PROJECT_ROOT / "VoiceZettel" / "Raw_v2"
    wiki_dir = PROJECT_ROOT / "VoiceZettel" / "Wiki_v2"
    raw_dir.mkdir(parents=True, exist_ok=True)
    wiki_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Shadow dirs ensured: {raw_dir}, {wiki_dir}")

    heartbeat_task = asyncio.create_task(heartbeat_loop())
    logger.info(f"Heartbeat daemon started (interval: {HEARTBEAT_INTERVAL}min)")
    
    yield
    
    if heartbeat_task:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
    logger.info("Heartbeat daemon stopped")


app = FastAPI(
    title="OpenClaw Heartbeat Daemon",
    description="Background LLM-Wiki agent with heartbeat cycle",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Endpoints ─────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint."""
    stats = worker.stats
    return {
        "service": "openclaw-heartbeat",
        "status": "ok",
        "heartbeat_interval_min": HEARTBEAT_INTERVAL,
        "heartbeat_active": heartbeat_task is not None and not heartbeat_task.done(),
        "uptime_seconds": int((datetime.now(timezone.utc) - server_start_time).total_seconds()) if server_start_time else 0,
        "worker_status": stats.get("status", "unknown"),
        "last_run": stats.get("last_run"),
        "files_processed": stats.get("files_processed", 0),
        "entities_extracted": stats.get("entities_extracted", 0),
        "errors": stats.get("errors", 0),
        "processed_count": stats.get("processed_count", 0),
    }


@app.get("/status")
async def status():
    """Detailed status including shadow mode directories."""
    raw_dir = PROJECT_ROOT / "VoiceZettel" / "Raw_v2"
    wiki_dir = PROJECT_ROOT / "VoiceZettel" / "Wiki_v2"
    
    raw_files = list(raw_dir.rglob("*.md")) if raw_dir.exists() else []
    wiki_files = list(wiki_dir.rglob("*.md")) if wiki_dir.exists() else []
    
    # Count entities in Wiki
    people_dir = wiki_dir / "People"
    tasks_dir = wiki_dir / "Tasks"
    people_count = len(list(people_dir.glob("*.md"))) if people_dir.exists() else 0
    tasks_count = len(list(tasks_dir.glob("*.md"))) if tasks_dir.exists() else 0
    
    stats = worker.stats
    new_files = worker.scan_new_files()
    
    return {
        "status": "ok",
        "configured": True,
        "heartbeat": {
            "active": heartbeat_task is not None and not heartbeat_task.done(),
            "interval_min": HEARTBEAT_INTERVAL,
            "last_run": stats.get("last_run"),
        },
        "raw_files": len(raw_files),
        "wiki_pages": len(wiki_files),
        "processed_files": stats.get("processed_count", 0),
        "pending_files": len(new_files),
        "entities": {
            "people": people_count,
            "tasks": tasks_count,
        },
        "directories": {
            "raw_v2": raw_dir.exists(),
            "wiki_v2": wiki_dir.exists(),
        },
        "worker": stats,
    }


@app.post("/trigger")
async def trigger():
    """Manually trigger an ingest cycle."""
    result = await worker.run_once()
    return {
        "status": "ok",
        "triggered": True,
        "result": result,
    }


@app.get("/entities")
async def entities():
    """List extracted entities from Wiki_v2."""
    wiki_dir = PROJECT_ROOT / "VoiceZettel" / "Wiki_v2"
    
    people = []
    people_dir = wiki_dir / "People"
    if people_dir.exists():
        for f in people_dir.glob("*.md"):
            people.append({
                "name": f.stem,
                "file": str(f.relative_to(wiki_dir)),
                "size": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
    
    tasks = []
    tasks_dir = wiki_dir / "Tasks"
    if tasks_dir.exists():
        for f in tasks_dir.glob("*.md"):
            tasks.append({
                "title": f.stem,
                "file": str(f.relative_to(wiki_dir)),
                "size": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
    
    return {
        "status": "ok",
        "people": people,
        "tasks": tasks,
        "total_entities": len(people) + len(tasks),
    }


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
