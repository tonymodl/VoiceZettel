"""
embedder.py — OpenAI text-embedding-3-small with batching and retry.
"""

import os
import logging
import asyncio
from typing import Optional

import httpx

logger = logging.getLogger("embedder")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536
BATCH_SIZE = 50  # OpenAI allows up to 2048 inputs, but keep batches small
MAX_RETRIES = 3


class Embedder:
    """Generate embeddings via OpenAI API with batching."""

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key or OPENAI_API_KEY
        self._enabled = bool(self._api_key)
        self._stats = {"embedded": 0, "errors": 0, "api_calls": 0}

        if not self._enabled:
            logger.warning("OPENAI_API_KEY not set — embeddings disabled")
        else:
            logger.info(f"Embedder ready: model={EMBEDDING_MODEL}, dims={EMBEDDING_DIMS}")

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    @property
    def dims(self) -> int:
        return EMBEDDING_DIMS

    @property
    def stats(self) -> dict:
        return {**self._stats, "enabled": self._enabled}

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """
        Embed a list of texts. Returns list of embedding vectors.
        Handles batching internally.
        """
        if not self._enabled:
            return [[0.0] * EMBEDDING_DIMS for _ in texts]

        if not texts:
            return []

        all_embeddings: list[list[float]] = []

        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i : i + BATCH_SIZE]
            # Truncate each text to ~8000 chars (model limit ~8191 tokens)
            batch = [t[:8000] for t in batch]

            embeddings = await self._embed_batch(batch)
            all_embeddings.extend(embeddings)

        return all_embeddings

    async def embed_single(self, text: str) -> list[float]:
        """Embed a single text string."""
        results = await self.embed_texts([text])
        return results[0] if results else [0.0] * EMBEDDING_DIMS

    async def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a single batch with retry."""
        for attempt in range(MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        "https://api.openai.com/v1/embeddings",
                        headers={
                            "Authorization": f"Bearer {self._api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": EMBEDDING_MODEL,
                            "input": texts,
                        },
                    )

                    if response.status_code == 200:
                        data = response.json()
                        embeddings = [item["embedding"] for item in data["data"]]
                        self._stats["embedded"] += len(texts)
                        self._stats["api_calls"] += 1
                        return embeddings
                    elif response.status_code == 429:
                        # Rate limited — wait and retry
                        wait = 2 ** (attempt + 1)
                        logger.warning(f"Rate limited, retrying in {wait}s...")
                        await asyncio.sleep(wait)
                        continue
                    else:
                        logger.error(f"Embeddings API {response.status_code}: {response.text[:200]}")
                        self._stats["errors"] += 1
                        break

            except Exception as e:
                logger.error(f"Embedding error (attempt {attempt+1}): {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self._stats["errors"] += 1

        # Fallback: zero vectors
        return [[0.0] * EMBEDDING_DIMS for _ in texts]
