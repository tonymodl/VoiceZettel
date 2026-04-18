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
from bm25_index import BM25Index
from hybrid_search import reciprocal_rank_fusion

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
bm25: Optional[BM25Index] = None
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
        from chromadb.config import Settings
        
        chroma_dir = os.path.join(os.path.expanduser("~"), ".voicezettel", "chroma_data")
        os.makedirs(chroma_dir, exist_ok=True)
        # Add robust threading / lock timeout settings if using standard sqlite3
        client = chromadb.PersistentClient(
            path=chroma_dir,
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True,
            )
        )
        logger.info(f"Using local ChromaDB at {chroma_dir}")

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={
            "hnsw:space": "cosine",
            "hnsw:M": 16,
            "hnsw:construction_ef": 100,
            "hnsw:batch_size": 50,
        },
    )
    logger.info(f"Collection '{COLLECTION_NAME}': {collection.count()} documents")
    return collection


async def _index_batch(docs_batch, col, source_label: str = ""):
    """Embed and upsert a single batch of documents to ChromaDB. Returns count upserted."""
    if not docs_batch:
        return 0

    texts = [d.text for d in docs_batch]
    ids = [d.doc_id for d in docs_batch]
    metadatas = [d.to_chroma_metadata() for d in docs_batch]

    # Embed this batch
    embeddings = await embedder.embed_texts(texts)

    # Upsert to ChromaDB in sub-batches of 50 (HNSW crashes with large upserts)
    SUB_BATCH = 50
    for j in range(0, len(ids), SUB_BATCH):
        for attempt in range(5):  # retry up to 5 times for SQLite locks
            try:
                col.upsert(
                    ids=ids[j:j+SUB_BATCH],
                    embeddings=embeddings[j:j+SUB_BATCH],
                    metadatas=metadatas[j:j+SUB_BATCH],
                    documents=texts[j:j+SUB_BATCH],
                )
                break
            except Exception as e:
                import traceback
                if attempt < 4:
                    logger.warning(f"ChromaDB upsert retry {attempt+1}: {e}")
                    await asyncio.sleep(1.5 * (attempt + 1))
                else:
                    logger.error(f"Batch upsert failed completely after 5 retries. Skipping batch. Error: {e}")
                    logger.debug(f"Traceback: {traceback.format_exc()}")

    # BM25 sync (fire-and-forget)
    try:
        if bm25 is not None:
            bm25.add_documents(ids, texts)
    except Exception as e:
        logger.warning(f"BM25 sync failed (non-critical): {e}")

    return len(ids)


async def _index_documents_streaming(docs, source_label: str = ""):
    """
    Embed and upsert documents in streaming batches of STREAM_BATCH_SIZE.
    Each batch is fully processed (embed + upsert) before moving to next.
    Updates index_state with live progress.
    """
    if not docs:
        return 0

    col = _get_chroma_collection()
    total = len(docs)
    upserted = 0
    STREAM_BATCH_SIZE = 100  # Process 100 chunks at a time (smaller = safer for HNSW)

    for i in range(0, total, STREAM_BATCH_SIZE):
        batch = docs[i : i + STREAM_BATCH_SIZE]
        try:
            count = await _index_batch(batch, col, source_label)
            upserted += count
            # Live progress update
            index_state["total_chunks"] = upserted
            index_state["progress_pct"] = round(upserted / total * 100, 1)
            logger.info(f"Progress: {upserted}/{total} chunks ({index_state['progress_pct']}%)")
            # Brief pause to let HNSW compaction settle
            await asyncio.sleep(0.1)
        except Exception as e:
            index_state["errors"] += 1
            logger.error(f"Batch {i}-{i+STREAM_BATCH_SIZE} failed: {e}")
            # Continue with next batch — don't abort entire index
            continue

    logger.info(f"Indexing complete: {upserted}/{total} chunks ({source_label})")
    return upserted


_main_loop = None  # Set during lifespan startup

def _on_file_change(event_type: str, file_path: str):
    """Callback from watcher — runs in a thread, schedules async work."""
    try:
        if _main_loop is None or _main_loop.is_closed():
            return
        if event_type == "deleted":
            try:
                col = _get_chroma_collection()
                rel_path = str(file_path).replace(VAULT_PATH, "").lstrip("/\\")
                col.delete(where={"file_path": rel_path})
                logger.info(f"Removed from index: {rel_path}")
            except Exception as e:
                logger.error(f"Delete from index failed: {e}")
        else:
            try:
                docs = scanner.scan_file(file_path)
                if docs:
                    col = _get_chroma_collection()
                    asyncio.run_coroutine_threadsafe(_index_batch(docs, col, "watcher"), _main_loop)
            except Exception as e:
                logger.error(f"Watcher index failed: {e}")
    except Exception as e:
        logger.error(f"Watcher callback error (caught): {e}")


# ── Lifespan ───────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global scanner, embedder, watcher, bm25, _main_loop
    _main_loop = asyncio.get_running_loop()

    if not VAULT_PATH:
        logger.error("VAULT_PATH not configured!")
    else:
        scanner = VaultScanner(VAULT_PATH)
        embedder = Embedder()
        bm25 = BM25Index(persist_dir=os.path.join(os.path.dirname(__file__), "bm25_data"))

        # Init ChromaDB connection
        _get_chroma_collection()

        # Start file watcher
        watcher = VaultWatcher(VAULT_PATH, _on_file_change)
        watcher.start()

        logger.info(f"Indexer ready — vault: {VAULT_PATH}, BM25: {bm25.count} docs")

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
    chat_type: Optional[str] = None  # private | group | supergroup | channel | None=all
    where: Optional[dict] = None  # raw ChromaDB where filter (overrides source_type/chat_type)


class IndexFileRequest(BaseModel):
    file_path: str  # absolute or vault-relative path


# ── Background indexing task ───────────────────────────────────

async def _background_full_index():
    """Run full indexing in background — called via asyncio.create_task."""
    global index_state
    try:
        docs = scanner.scan_all()
        if not docs:
            index_state["running"] = False
            index_state["message"] = "No .md files found in vault"
            return

        # Count by source
        by_source: dict[str, int] = {}
        for d in docs:
            by_source[d.source_type] = by_source.get(d.source_type, 0) + 1

        index_state["total_documents"] = scanner.stats["files_scanned"]
        index_state["total_expected"] = len(docs)
        index_state["by_source"] = by_source

        # Stream embed + upsert in batches
        upserted = await _index_documents_streaming(docs, "full")

        from datetime import datetime, timezone
        index_state.update({
            "running": False,
            "last_indexed": datetime.now(timezone.utc).isoformat(),
            "total_documents": scanner.stats["files_scanned"],
            "total_chunks": upserted,
            "by_source": by_source,
            "progress_pct": 100.0,
            "message": f"Done: {upserted} chunks from {scanner.stats['files_scanned']} files",
        })
        logger.info(f"Full index complete: {upserted} chunks, {scanner.stats['files_scanned']} files")

    except Exception as e:
        index_state["running"] = False
        index_state["errors"] += 1
        index_state["message"] = f"Failed: {e}"
        logger.error(f"Full index failed: {e}")


# ── Endpoints ──────────────────────────────────────────────────

@app.post("/index/full")
async def full_index():
    """Full vault reindex — launches background task, returns immediately."""
    global index_state

    if index_state["running"]:
        return {
            "status": "already_running",
            "progress_pct": index_state.get("progress_pct", 0),
            "total_chunks": index_state.get("total_chunks", 0),
            "message": "Indexing already in progress",
        }
    if not scanner:
        raise HTTPException(500, "VAULT_PATH not configured")

    index_state = {
        "running": True,
        "last_indexed": index_state.get("last_indexed"),
        "total_documents": 0,
        "total_chunks": 0,
        "total_expected": 0,
        "by_source": {},
        "errors": 0,
        "progress_pct": 0,
        "message": "Scanning vault...",
    }

    # Launch as background task — return immediately
    asyncio.create_task(_background_full_index())

    return {
        "status": "started",
        "message": "Full indexing started in background. Check /stats for progress.",
    }


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

    upserted = await _index_documents_streaming(docs, "single")
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
    if req.where:
        # Raw where filter from client (highest priority)
        where = req.where
    elif req.source_type and req.chat_type:
        where = {"$and": [{"source_type": req.source_type}, {"chat_type": req.chat_type}]}
    elif req.source_type:
        where = {"source_type": req.source_type}
    elif req.chat_type:
        where = {"chat_type": req.chat_type}

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


# ── Phase 2: Hybrid Search (Shadow Integration) ───────────────

@app.post("/search/hybrid")
async def search_hybrid(req: SearchRequest):
    """
    Hybrid search: ChromaDB (vector) + BM25 (keyword) merged via RRF.
    Returns the SAME JSON format as /search for UI compatibility.
    Falls back to pure vector search if BM25 is unavailable.
    """
    if not embedder:
        raise HTTPException(500, "Indexer not initialized")

    col = _get_chroma_collection()
    if col.count() == 0:
        return []

    # 1. ChromaDB vector search (existing logic, unchanged)
    query_embedding = await embedder.embed_single(req.query)
    where = {"source_type": req.source_type} if req.source_type else None
    chroma_results = col.query(
        query_embeddings=[query_embedding],
        n_results=min(req.top_k * 2, 40),  # Fetch more for RRF
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    vector_items = []
    if chroma_results and chroma_results.get("ids") and chroma_results["ids"][0]:
        for i, doc_id in enumerate(chroma_results["ids"][0]):
            distance = chroma_results["distances"][0][i] if chroma_results.get("distances") else 0
            relevance = max(0, round((1 - distance) * 100, 1))
            vector_items.append({
                "id": doc_id,
                "text": chroma_results["documents"][0][i] if chroma_results.get("documents") else "",
                "metadata": chroma_results["metadatas"][0][i] if chroma_results.get("metadatas") else {},
                "distance": round(distance, 4),
                "relevance_pct": relevance,
            })

    # 2. BM25 keyword search (new, shadow)
    bm25_items = []
    try:
        if bm25 is not None:
            bm25_items = bm25.search(req.query, top_k=req.top_k * 2)
    except Exception as e:
        logger.warning(f"BM25 search failed (falling back to pure vector): {e}")

    # 3. Merge via RRF
    if bm25_items:
        merged = reciprocal_rank_fusion(vector_items, bm25_items, top_k=req.top_k)
        return merged
    else:
        # Fallback: pure vector results
        return vector_items[:req.top_k]


@app.get("/bm25-stats")
async def bm25_stats():
    """BM25 index statistics for dashboard monitoring."""
    if bm25 is None:
        return {"available": False, "total_docs": 0, "status": "not_initialized"}
    return {
        "available": True,
        "status": "ok",
        **bm25.stats,
    }


# ── Entrypoint ─────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
