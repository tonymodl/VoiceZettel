import os
import logging
from typing import Optional
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("embedder")

EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIMS = 384

class Embedder:
    """Generate embeddings via local sentence-transformers model."""

    def __init__(self, api_key: Optional[str] = None):
        self._enabled = True
        self._stats = {"embedded": 0, "errors": 0, "api_calls": 0}
        
        try:
            self._model = SentenceTransformer(EMBEDDING_MODEL)
            logger.info(f"Embedder ready: model={EMBEDDING_MODEL}, dims={EMBEDDING_DIMS}")
        except Exception as e:
            logger.error(f"Failed to load sentence-transformers model {EMBEDDING_MODEL}: {e}")
            self._enabled = False

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
        Embed a list of texts locally. Returns list of embedding vectors.
        """
        if not self._enabled:
            return [[0.0] * EMBEDDING_DIMS for _ in texts]

        if not texts:
            return []

        try:
            # Model encode provides numpy arrays, convert to lists of floats
            # Batching is handled by SentenceTransformer natively
            embeddings = self._model.encode(texts, show_progress_bar=False)
            results = [vec.tolist() for vec in embeddings]
            self._stats["embedded"] += len(texts)
            self._stats["api_calls"] += 1
            return results
        except Exception as e:
            logger.error(f"Local Embedding error: {e}")
            self._stats["errors"] += 1
            return [[0.0] * EMBEDDING_DIMS for _ in texts]

    async def embed_single(self, text: str) -> list[float]:
        """Embed a single text string."""
        results = await self.embed_texts([text])
        return results[0] if results else [0.0] * EMBEDDING_DIMS
