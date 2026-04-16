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


# ── Phase 2: Shadow Integration — Docling Parser ──────────────

@app.post("/parse-document")
async def parse_document_endpoint():
    """
    Parse a complex document (PDF/PPTX/XLSX) via Docling.
    Shadow Integration: for binary formats only.
    Markdown/text files should use the existing parser.
    """
    from fastapi import UploadFile, File
    # NOTE: This endpoint will be called with multipart form data
    # For now, provide a placeholder that accepts file path
    from pydantic import BaseModel as BM

    class ParseReq(BM):
        file_path: str

    return {"status": "error", "message": "Use POST /parse-document-path instead"}


@app.post("/parse-document-path")
async def parse_document_path():
    """Parse a document by file path via Docling."""
    from pydantic import BaseModel as BM

    class ParseReq(BM):
        file_path: str

    from starlette.requests import Request
    from fastapi import Request as FRequest

    # We handle this via raw request parsing
    import json
    # Fallback: simple path-based parsing
    return {"status": "info", "message": "Docling parser endpoint ready — send {file_path: '...'} to parse"}


@app.post("/parse-file")
async def parse_file(file_path: str = ""):
    """Parse a document at the given path using Docling (with fallback)."""
    if not file_path:
        from fastapi import HTTPException
        raise HTTPException(400, "file_path required")

    try:
        from docling_parser import is_complex_document, parse_document

        if not is_complex_document(file_path):
            return {
                "status": "skipped",
                "reason": "Not a complex document — use standard text parser",
                "file_path": file_path,
            }

        result = parse_document(file_path)
        if result is None:
            return {
                "status": "fallback",
                "reason": "Docling failed — use standard text parser",
                "file_path": file_path,
            }

        # Optionally save to Raw_v2
        raw_dir = PROJECT_ROOT / "VoiceZettel" / "Raw_v2"
        raw_dir.mkdir(parents=True, exist_ok=True)
        out_name = Path(file_path).stem + ".md"
        out_path = raw_dir / out_name
        out_path.write_text(result, encoding="utf-8")

        return {
            "status": "ok",
            "file_path": file_path,
            "output_path": str(out_path),
            "chars": len(result),
        }

    except ImportError:
        return {"status": "error", "message": "docling not installed — pip install 'docling[ocr]'"}
    except Exception as e:
        logger.error(f"Parse document failed: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/docling/health")
async def docling_health():
    """Docling parser health check for dashboard."""
    try:
        from docling_parser import health_check
        info = health_check()
        return {
            "service": "docling-parser",
            "status": "ok" if info.get("available") else "not_installed",
            **info,
        }
    except ImportError:
        return {"service": "docling-parser", "status": "not_installed", "available": False}


# ── Phase 2: Shadow Integration — Deep Agent ──────────────────

@app.post("/agent/enrich")
async def agent_enrich(file_path: str = ""):
    """
    Enrich a wiki file using LangChain Deep Agent.
    Sandbox: writes ONLY to Wiki_v2/.drafts/ or main vault depending on config.
    """
    if not file_path:
        from fastapi import HTTPException
        raise HTTPException(400, "file_path required")

    deep_agent_enabled = os.environ.get("DEEP_AGENT_ENABLED", "false").lower() == "true"
    if not deep_agent_enabled:
        return {
            "status": "disabled",
            "message": "Deep Agent is disabled. Set DEEP_AGENT_ENABLED=true in .env",
        }

    try:
        from deep_agent import DeepAgent
        agent = DeepAgent(
            vault_dir=str(PROJECT_ROOT / "VoiceZettel"),
            sandbox_dir=str(PROJECT_ROOT / "VoiceZettel" / "Wiki_v2" / ".drafts"),
        )
        result = await agent.enrich(file_path)
        return {"status": "ok", "result": result}
    except ImportError:
        return {"status": "error", "message": "langchain not installed — pip install langchain langchain-openai"}
    except Exception as e:
        logger.error(f"Deep Agent enrich failed: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/agent/health")
async def agent_health():
    """Deep Agent health check for dashboard."""
    deep_agent_enabled = os.environ.get("DEEP_AGENT_ENABLED", "false").lower() == "true"

    info = {
        "service": "deep-agent",
        "enabled": deep_agent_enabled,
        "status": "disabled" if not deep_agent_enabled else "unknown",
    }

    if deep_agent_enabled:
        try:
            from deep_agent import DeepAgent
            info["status"] = "ok"
            info["langchain_available"] = True
        except ImportError:
            info["status"] = "not_installed"
            info["langchain_available"] = False

    return info


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)

