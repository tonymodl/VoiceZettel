"""
main.py — Vault Indexer service for ChromaDB vectorization.

Scans Obsidian vault → chunks → embeds → upserts to ChromaDB.
Watches for file changes via watchdog for real-time updates.

Endpoints:
  POST /index/full        — full vault reindex
  POST /index/file        — index a single file
  POST /search            — semantic search across all sources
  GET  /stats             — index statistics
  GET  /health            — health check
"""

import asyncio
import os
import sys
import logging
from typing import Optional
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# Load .env before imports that read env vars
env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)

import chromadb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from vault_scanner import VaultScanner
from embedder import Embedder
from watcher import VaultWatcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("indexer")

# ── Config ─────────────────────────────────────────────────────
VAULT_PATH = os.environ.get("VAULT_PATH", "")
CHROMA_HOST = os.environ.get("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.environ.get("CHROMA_PORT", "8001"))
COLLECTION_NAME = "voicezettel"
PORT = int(os.environ.get("INDEXER_PORT", "8030"))

# ── Global state ───────────────────────────────────────────────
scanner: Optional[VaultScanner] = None
embedder: Optional[Embedder] = None
watcher: Optional[VaultWatcher] = None
collection = None
index_state = {
    "running": False,
    "last_indexed": None,
    "total_documents": 0,
    "total_chunks": 0,
    "by_source": {},
    "errors": 0,
}


class UnicodeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        import json
        return json.dumps(
            content, ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")


def _get_chroma_collection():
    """Connect to ChromaDB and get/create the collection."""
    global collection
    if collection is not None:
        return collection

    try:
        # Try HTTP client first (Docker ChromaDB)
        client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        client.heartbeat()
        logger.info(f"Connected to ChromaDB at {CHROMA_HOST}:{CHROMA_PORT}")
    except Exception:
        # Fallback to persistent local client
        chroma_dir = os.path.join(os.path.dirname(__file__), "chroma_data")
        os.makedirs(chroma_dir, exist_ok=True)
        client = chromadb.PersistentClient(path=chroma_dir)
        logger.info(f"Using local ChromaDB at {chroma_dir}")

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    logger.info(f"Collection '{COLLECTION_NAME}': {collection.count()} documents")
    return collection


async def _index_documents(docs, source_label: str = ""):
    """Embed and upsert documents to ChromaDB."""
    if not docs:
        return 0

    col = _get_chroma_collection()
    texts = [d.text for d in docs]
    ids = [d.doc_id for d in docs]
    metadatas = [d.to_chroma_metadata() for d in docs]

    # Embed in batches
    embeddings = await embedder.embed_texts(texts)

    # Upsert to ChromaDB in batches of 100
    batch_size = 100
    upserted = 0
    for i in range(0, len(ids), batch_size):
        batch_ids = ids[i : i + batch_size]
        batch_embeddings = embeddings[i : i + batch_size]
        batch_metadatas = metadatas[i : i + batch_size]
        batch_documents = texts[i : i + batch_size]

        col.upsert(
            ids=batch_ids,
            embeddings=batch_embeddings,
            metadatas=batch_metadatas,
            documents=batch_documents,
        )
        upserted += len(batch_ids)

    label = f" ({source_label})" if source_label else ""
    logger.info(f"Indexed {upserted} chunks{label}")
    return upserted


def _on_file_change(event_type: str, file_path: str):
    """Callback from watcher — runs in a thread, schedules async work."""
    loop = asyncio.get_event_loop()
    if event_type == "deleted":
        # Remove all chunks for this file from ChromaDB
        try:
            col = _get_chroma_collection()
            rel_path = str(file_path).replace(VAULT_PATH, "").lstrip("/\\")
            # ChromaDB where filter on file_path
            col.delete(where={"file_path": rel_path})
            logger.info(f"Removed from index: {rel_path}")
        except Exception as e:
            logger.error(f"Delete from index failed: {e}")
    else:
        # Index/re-index the file
        try:
            docs = scanner.scan_file(file_path)
            if docs:
                asyncio.run_coroutine_threadsafe(_index_documents(docs, "watcher"), loop)
        except Exception as e:
            logger.error(f"Watcher index failed: {e}")


# ── Lifespan ───────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global scanner, embedder, watcher

    if not VAULT_PATH:
        logger.error("VAULT_PATH not configured!")
    else:
        scanner = VaultScanner(VAULT_PATH)
        embedder = Embedder()

        # Init ChromaDB connection
        _get_chroma_collection()

        # Start file watcher
        watcher = VaultWatcher(VAULT_PATH, _on_file_change)
        watcher.start()

        logger.info(f"Indexer ready — vault: {VAULT_PATH}")

    yield

    # Shutdown
    if watcher:
        watcher.stop()
    logger.info("Indexer shut down")


app = FastAPI(
    title="VoiceZettel Vault Indexer",
    version="1.0.0",
    default_response_class=UnicodeJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request models ─────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    source_type: Optional[str] = None  # telegram | session | zettelkasten | None=all


class IndexFileRequest(BaseModel):
    file_path: str  # absolute or vault-relative path


# ── Endpoints ──────────────────────────────────────────────────

@app.post("/index/full")
async def full_index():
    """Full vault reindex — scans all .md files."""
    global index_state

    if index_state["running"]:
        raise HTTPException(409, "Index already running")
    if not scanner:
        raise HTTPException(500, "VAULT_PATH not configured")

    index_state["running"] = True
    index_state["errors"] = 0

    try:
        # Scan vault
        docs = scanner.scan_all()
        if not docs:
            index_state["running"] = False
            return {"status": "empty", "message": "No .md files found in vault"}

        # Count by source
        by_source: dict[str, int] = {}
        for d in docs:
            by_source[d.source_type] = by_source.get(d.source_type, 0) + 1

        # Embed and upsert
        upserted = await _index_documents(docs, "full")

        from datetime import datetime, timezone
        index_state.update({
            "running": False,
            "last_indexed": datetime.now(timezone.utc).isoformat(),
            "total_documents": scanner.stats["files_scanned"],
            "total_chunks": upserted,
            "by_source": by_source,
        })

        return {
            "status": "ok",
            "files": scanner.stats["files_scanned"],
            "chunks": upserted,
            "by_source": by_source,
        }

    except Exception as e:
        index_state["running"] = False
        index_state["errors"] += 1
        logger.error(f"Full index failed: {e}")
        raise HTTPException(500, str(e))


@app.post("/index/file")
async def index_file(req: IndexFileRequest):
    """Index a single file."""
    if not scanner:
        raise HTTPException(500, "VAULT_PATH not configured")

    # Resolve path
    file_path = req.file_path
    if not os.path.isabs(file_path):
        file_path = os.path.join(VAULT_PATH, file_path)

    if not os.path.exists(file_path):
        raise HTTPException(404, f"File not found: {file_path}")

    docs = scanner.scan_file(file_path)
    if not docs:
        return {"status": "skipped", "reason": "File too short or not .md"}

    upserted = await _index_documents(docs, "single")
    return {"status": "ok", "chunks": upserted, "file": req.file_path}


@app.post("/search")
async def search(req: SearchRequest):
    """Semantic search across all indexed vault content."""
    if not embedder:
        raise HTTPException(500, "Indexer not initialized")

    col = _get_chroma_collection()
    if col.count() == 0:
        return []

    # Embed query
    query_embedding = await embedder.embed_single(req.query)

    # Build where filter
    where = None
    if req.source_type:
        where = {"source_type": req.source_type}

    # Query ChromaDB
    results = col.query(
        query_embeddings=[query_embedding],
        n_results=min(req.top_k, 20),
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    # Format response
    items = []
    if results and results.get("ids") and results["ids"][0]:
        for i, doc_id in enumerate(results["ids"][0]):
            distance = results["distances"][0][i] if results.get("distances") else 0
            relevance = max(0, round((1 - distance) * 100, 1))
            items.append({
                "id": doc_id,
                "text": results["documents"][0][i] if results.get("documents") else "",
                "metadata": results["metadatas"][0][i] if results.get("metadatas") else {},
                "distance": round(distance, 4),
                "relevance_pct": relevance,
            })

    return items


@app.get("/stats")
async def stats():
    """Get indexing statistics."""
    col = _get_chroma_collection()
    count = col.count()

    # Get source breakdown
    by_source = {}
    if count > 0:
        try:
            # Sample to get source distribution
            sample = col.get(limit=min(count, 1000), include=["metadatas"])
            for meta in (sample.get("metadatas") or []):
                src = (meta or {}).get("source_type", "unknown")
                by_source[src] = by_source.get(src, 0) + 1
        except Exception:
            pass

    return {
        "total_chunks": count,
        "by_source": by_source,
        "watcher_active": watcher.is_active if watcher else False,
        "embedder": embedder.stats if embedder else {},
        "scanner": scanner.stats if scanner else {},
        "index_state": index_state,
    }


@app.get("/health")
async def health():
    """Health check."""
    col_count = 0
    try:
        col = _get_chroma_collection()
        col_count = col.count()
    except Exception:
        pass

    return {
        "service": "vault-indexer",
        "status": "ok",
        "vault_path": VAULT_PATH,
        "chroma_documents": col_count,
        "watcher_active": watcher.is_active if watcher else False,
        "embedder_enabled": embedder.is_enabled if embedder else False,
    }


# ── Entrypoint ─────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
