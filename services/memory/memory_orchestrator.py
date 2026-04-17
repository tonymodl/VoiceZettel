import json
import logging
import time
import asyncio
from typing import List, Dict, Any, Optional
import redis.asyncio as redis
from pydantic import BaseModel

from services.memory.chroma_service import get_collection

logger = logging.getLogger(__name__)

# Configure Redis connection
REDIS_URL = "redis://localhost:6379"

import asyncio

try:
    # Synchronous check to fail fast for configuration
    import redis
    _sync_client = redis.from_url(REDIS_URL)
    _sync_client.ping()
    _sync_client.close()
    
    import redis.asyncio as redis_async
    redis_client = redis_async.from_url(REDIS_URL, decode_responses=True)
except Exception as e:
    logger.warning(f"Redis not reachable, falling back to in-memory Dict. Error: {e}")
    redis_client = None

WORKING_MEMORY_LIMIT = 15

class MemoryMessage(BaseModel):
    role: str
    content: str
    timestamp: float

_fallback_memory: Dict[str, List[Dict[str, Any]]] = {}

class MemoryOrchestrator:
    """Manages both short-term (Working) memory via Redis (or dict fallback) and long-term memory via ChromaDB."""
    
    @staticmethod
    async def add_to_working_memory(session_id: str, role: str, content: str) -> None:
        """Adds a message to the session's working memory in Redis or local dict."""
        msg = MemoryMessage(role=role, content=content, timestamp=time.time())
        
        if redis_client:
            key = f"session:{session_id}:history"
            try:
                await redis_client.rpush(key, msg.model_dump_json())
                list_len = await redis_client.llen(key)
                if list_len > WORKING_MEMORY_LIMIT:
                    await redis_client.lpop(key, count=(list_len - WORKING_MEMORY_LIMIT))
                await redis_client.expire(key, 7200)
            except Exception as e:
                logger.error(f"Error writing to Redis working memory: {e}")
        else:
            if session_id not in _fallback_memory:
                _fallback_memory[session_id] = []
            _fallback_memory[session_id].append(json.loads(msg.model_dump_json()))
            if len(_fallback_memory[session_id]) > WORKING_MEMORY_LIMIT:
                _fallback_memory[session_id] = _fallback_memory[session_id][-WORKING_MEMORY_LIMIT:]

    @staticmethod
    async def get_working_memory(session_id: str) -> List[Dict[str, Any]]:
        """Retrieves the recent conversation history for a session."""
        if redis_client:
            key = f"session:{session_id}:history"
            try:
                items = await redis_client.lrange(key, 0, -1)
                return [json.loads(item) for item in items]
            except Exception as e:
                logger.error(f"Error reading from Redis working memory: {e}")
                return []
        else:
            return _fallback_memory.get(session_id, [])

    @staticmethod
    def add_to_long_term_memory(user_id: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        """Saves a fact or important note into long-term vector memory."""
        collection = get_collection(f"user_{user_id}_long_term")
        
        doc_id = f"mem_{int(time.time() * 1000)}"
        metas = metadata or {}
        metas["timestamp"] = time.time()
        
        # Adding document into chroma
        collection.add(
            ids=[doc_id],
            documents=[content],
            metadatas=[metas]
        )
        return doc_id

    @staticmethod
    def search_long_term_memory(user_id: str, query: str, top_k: int = 5) -> List[str]:
        """Searches long-term vector memory for contextual facts."""
        collection = get_collection(f"user_{user_id}_long_term")
        try:
            results = collection.query(
                query_texts=[query],
                n_results=top_k
            )
            if results and results.get("documents") and len(results["documents"]) > 0:
                # results["documents"] is a list of lists of strings
                return results["documents"][0]
            return []
        except Exception as e:
            logger.error(f"Error searching ChromaDB long term memory: {e}")
            return []
