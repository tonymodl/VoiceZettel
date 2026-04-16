"""
hybrid_search.py — Reciprocal Rank Fusion (RRF) combiner.
Merges ChromaDB vector search + BM25 keyword search results.

Shadow Integration: The existing /search endpoint is UNCHANGED.
This module is only used by the NEW /search/hybrid endpoint.
"""

import logging
from typing import Any

logger = logging.getLogger("indexer.hybrid")


def reciprocal_rank_fusion(
    vector_results: list[dict[str, Any]],
    bm25_results: list[dict[str, Any]],
    k: int = 60,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """
    Combine results using RRF: score(d) = Σ 1/(k + rank(d))

    Args:
        vector_results: List of dicts with 'id', 'text', 'metadata', 'distance', 'relevance_pct'
        bm25_results: List of dicts with 'id', 'text', 'score', 'rank'
        k: RRF constant (default 60, standard in literature)
        top_k: Number of results to return

    Returns:
        Merged list in the SAME format as vector_results (for UI compatibility)
    """
    rrf_scores: dict[str, float] = {}
    doc_data: dict[str, dict[str, Any]] = {}

    # Score from vector search (ChromaDB)
    for rank, item in enumerate(vector_results, start=1):
        doc_id = item.get("id", "")
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + 1.0 / (k + rank)
        doc_data[doc_id] = {
            "id": doc_id,
            "text": item.get("text", ""),
            "metadata": item.get("metadata", {}),
            "distance": item.get("distance", 0),
            "relevance_pct": item.get("relevance_pct", 0),
            "sources": ["vector"],
        }

    # Score from BM25
    for rank, item in enumerate(bm25_results, start=1):
        doc_id = item.get("id", "")
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + 1.0 / (k + rank)
        if doc_id in doc_data:
            doc_data[doc_id]["sources"].append("bm25")
        else:
            doc_data[doc_id] = {
                "id": doc_id,
                "text": item.get("text", ""),
                "metadata": {},
                "distance": 0,
                "relevance_pct": 0,
                "sources": ["bm25"],
            }

    # Sort by RRF score descending
    sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)[:top_k]

    # Build final results in the SAME format as /search
    results = []
    for doc_id in sorted_ids:
        item = doc_data[doc_id]
        # Compute hybrid relevance from RRF score (normalize to 0-100)
        max_rrf = max(rrf_scores.values()) if rrf_scores else 1
        hybrid_pct = round((rrf_scores[doc_id] / max_rrf) * 100, 1)
        results.append({
            "id": item["id"],
            "text": item["text"],
            "metadata": {
                **item["metadata"],
                "search_sources": item["sources"],
                "rrf_score": round(rrf_scores[doc_id], 6),
            },
            "distance": item["distance"],
            "relevance_pct": hybrid_pct,
        })

    logger.info(f"RRF merged: {len(vector_results)} vector + {len(bm25_results)} BM25 → {len(results)} results")
    return results
