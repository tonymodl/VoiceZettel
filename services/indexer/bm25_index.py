"""
bm25_index.py — BM25 full-text search index for VoiceZettel.
Maintained in parallel with ChromaDB vector index.

Shadow Integration: This index is ADDITIVE. ChromaDB search
continues to work unchanged. BM25 results are only used via
the /search/hybrid endpoint.
"""

import os
import json
import re
import logging
import pickle
from pathlib import Path
from typing import Optional

logger = logging.getLogger("indexer.bm25")

# Lazy import — rank_bm25 may not be installed
_bm25_available: Optional[bool] = None


def _check_bm25():
    global _bm25_available
    if _bm25_available is None:
        try:
            from rank_bm25 import BM25Okapi  # noqa: F401
            _bm25_available = True
            logger.info("rank_bm25 available — full-text search enabled")
        except ImportError:
            _bm25_available = False
            logger.warning("rank_bm25 not installed — pip install rank-bm25")
    return _bm25_available


def _tokenize(text: str) -> list[str]:
    """Simple whitespace + punctuation tokenizer for Russian/English text."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return [w for w in text.split() if len(w) > 1]


class BM25Index:
    """BM25 full-text index with disk persistence."""

    def __init__(self, persist_dir: str = ""):
        self._persist_path = os.path.join(persist_dir or os.path.dirname(__file__), "bm25_data")
        os.makedirs(self._persist_path, exist_ok=True)
        self._corpus_file = os.path.join(self._persist_path, "corpus.pkl")
        self._meta_file = os.path.join(self._persist_path, "meta.json")

        self._doc_ids: list[str] = []
        self._doc_texts: list[str] = []
        self._tokenized: list[list[str]] = []
        self._bm25 = None
        self._stats = {"total_docs": 0, "index_builds": 0}

        self._load()

    def add_documents(self, doc_ids: list[str], texts: list[str]) -> int:
        """Add documents to the BM25 index. Deduplicates by ID."""
        if not _check_bm25():
            return 0

        existing_ids = set(self._doc_ids)
        added = 0

        for doc_id, text in zip(doc_ids, texts):
            if doc_id in existing_ids:
                # Update existing
                idx = self._doc_ids.index(doc_id)
                self._doc_texts[idx] = text
                self._tokenized[idx] = _tokenize(text)
            else:
                self._doc_ids.append(doc_id)
                self._doc_texts.append(text)
                self._tokenized.append(_tokenize(text))
                existing_ids.add(doc_id)
            added += 1

        # Rebuild BM25 index
        self._rebuild()
        self._stats["total_docs"] = len(self._doc_ids)
        self._stats["index_builds"] += 1

        # Persist
        self._save()
        logger.info(f"BM25: added/updated {added} docs, total: {len(self._doc_ids)}")
        return added

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        """
        Search BM25 index. Returns list of {id, text, score, rank}.
        """
        if not _check_bm25() or self._bm25 is None or not self._tokenized:
            return []

        tokens = _tokenize(query)
        if not tokens:
            return []

        scores = self._bm25.get_scores(tokens)

        # Get top-k indices sorted by score descending
        indexed = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[:top_k]

        results = []
        for rank, (idx, score) in enumerate(indexed):
            if score <= 0:
                continue
            results.append({
                "id": self._doc_ids[idx],
                "text": self._doc_texts[idx][:500],  # Truncate for response
                "score": float(score),
                "rank": rank + 1,
            })

        return results

    def _rebuild(self):
        """Rebuild BM25 from tokenized corpus."""
        if not _check_bm25() or not self._tokenized:
            return
        from rank_bm25 import BM25Okapi
        self._bm25 = BM25Okapi(self._tokenized)

    def _save(self):
        """Persist to disk."""
        try:
            with open(self._corpus_file, "wb") as f:
                pickle.dump({
                    "doc_ids": self._doc_ids,
                    "doc_texts": self._doc_texts,
                    "tokenized": self._tokenized,
                }, f)
            with open(self._meta_file, "w") as f:
                json.dump(self._stats, f)
        except Exception as e:
            logger.error(f"BM25 save failed: {e}")

    def _load(self):
        """Load from disk if exists."""
        corpus_path = Path(self._corpus_file)
        if not corpus_path.exists():
            return

        try:
            with open(self._corpus_file, "rb") as f:
                data = pickle.load(f)
            self._doc_ids = data.get("doc_ids", [])
            self._doc_texts = data.get("doc_texts", [])
            self._tokenized = data.get("tokenized", [])
            self._rebuild()
            self._stats["total_docs"] = len(self._doc_ids)
            logger.info(f"BM25 loaded: {len(self._doc_ids)} docs from disk")
        except Exception as e:
            logger.error(f"BM25 load failed: {e}")

    @property
    def stats(self) -> dict:
        return {**self._stats, "available": _check_bm25() or False}

    @property
    def count(self) -> int:
        return len(self._doc_ids)
