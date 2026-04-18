import os
import asyncio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import nest_asyncio

nest_asyncio.apply()

# Try importing LightRAG (might not be installed yet in env)
try:
    from lightrag import LightRAG, QueryParam
    from lightrag.llm import openai_complete_if_cache
    from lightrag.utils import EmbeddingFunc
except ImportError:
    LightRAG = None
    pass

app = FastAPI(title="VoiceZettel GraphRAG Service")

WORKING_DIR = os.environ.get("GRAPHRAG_WORKING_DIR", "./graph_cache")

# Initialize LightRAG globally
rag = None

def init_rag():
    global rag
    if LightRAG is None:
        print("[GraphRAG] LightRAG is not installed. Service running in stub mode.")
        return

    if not os.path.exists(WORKING_DIR):
        os.makedirs(WORKING_DIR)

    # In a real setup, we would inject sentence-transformers here for embedding
    # and deepseek/openai for completion.
    # For now, it's just a skeleton.
    try:
        pass
        # rag = LightRAG(
        #     working_dir=WORKING_DIR,
        #     llm_model_func=openai_complete_if_cache, # Will need configuration
        #     # embedding_func=EmbeddingFunc(...)
        # )
        # print("[GraphRAG] Initialized successfuly")
    except Exception as e:
        print(f"[GraphRAG] Failed to initialize: {e}")

@app.on_event("startup")
async def startup_event():
    init_rag()

class InsertTextRequest(BaseModel):
    text: str
    source_id: str

class QueryRequest(BaseModel):
    query: str
    mode: str = "hybrid" # local, global, hybrid, naive

@app.get("/health")
async def health_check():
    return {"status": "ok", "rag_initialized": rag is not None}

@app.post("/index")
async def insert_text(req: InsertTextRequest):
    if rag is None:
        raise HTTPException(status_code=503, detail="LightRAG not initialized")
    
    try:
        # rag.insert([req.text]) # LightRAG needs chunks/documents
        return {"status": "success", "message": f"Queued {req.source_id} for indexing (stub)"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search")
async def search(req: QueryRequest):
    if rag is None:
        # Return a fallback stub response so frontend UI tool doesn't crash while we are still building
        return {
            "result": f"GraphRAG is currently in stub mode. Searching for '{req.query}' using {req.mode} mode."
        }
    
    try:
        # result = rag.query(req.query, param=QueryParam(mode=req.mode))
        result = "Stub result"
        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8011)
