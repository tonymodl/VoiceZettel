import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import memory services
from services.memory.chroma_service import get_collection
from services.memory.sqlite_service import add_note, get_notes

app = FastAPI(title="VoiceZettel Backend", version="0.1.0")

# CORS configuration for frontend (allow all for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production restrict to specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Example health endpoint
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# Vector memory endpoint using ChromaDB
@app.get("/api/memory/vector")
async def get_vector_memory(query: str):
    collection = get_collection("default")
    # Simple similarity search (placeholder)
    results = collection.query(query_texts=[query], n_results=5)
    return {"results": results}

# Structured memory endpoint using SQLite
@app.post("/api/memory/structured")
async def add_structured_memory(item: dict):
    # Expect item to have a 'content' field
    content = item.get("content", "")
    metadata = item.get("metadata")
    note_id = add_note(content, metadata)
    return {"status": "inserted", "id": note_id}

# Additional routes for lapel, telegram, obsidian sync can be added later.
