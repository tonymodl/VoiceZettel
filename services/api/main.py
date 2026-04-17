import os
import asyncio
from typing import Dict, Any, Optional
from fastapi import FastAPI, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.memory.sqlite_service import add_note, get_notes
from services.memory.memory_orchestrator import MemoryOrchestrator
from services.api.semantic_router import SemanticRouter

app = FastAPI(title="VoiceZettel Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    session_id: str
    user_id: str
    message: str

@app.get("/health")
async def health_check():
    return {"status": "ok", "architecture": "async-memory-tier"}

async def generate_llm_response(prompt: str, context: str, history: list) -> str:
    """Mock generator for LLM response representing SSE/Streaming token yield."""
    # In a real implementation this would stream tokens from OpenAI/DeepSeek via asyncio
    # e.g., using litellm.acompletion
    await asyncio.sleep(0.5) # Simulate low-latency LLM TTFT
    return f"Ответ на основе памяти: {context[:50]}... и истории."

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, background_tasks: BackgroundTasks):
    """
    Main entry point for handling STT transcriptions asynchronously.
    """
    # 1. Semantic Routing (Fast path)
    intent = SemanticRouter.classify_intent(req.message)
    
    if intent == SemanticRouter.INTENT_COMMAND:
        res = SemanticRouter.process_command(req.message)
        return {"response": res["reply"], "intent": intent}
        
    elif intent == SemanticRouter.INTENT_SAVE_MEMORY:
        # Asynchronously save to long-term memory to avoid blocking TTS reply
        background_tasks.add_task(
            MemoryOrchestrator.add_to_long_term_memory, 
            req.user_id, 
            req.message
        )
        # Also add to sqlite if needed
        background_tasks.add_task(add_note, req.message, {"user": req.user_id})
        
        reply = "Записал. Что-то еще?"
        background_tasks.add_task(
            MemoryOrchestrator.add_to_working_memory,
            req.session_id, "user", req.message
        )
        background_tasks.add_task(
            MemoryOrchestrator.add_to_working_memory,
            req.session_id, "assistant", reply
        )
        return {"response": reply, "intent": intent}

    # 2. Complex RAG PATH (Question or Conversation)
    # Orchestrate Working Memory & Long Term Memory in Parallel
    working_memory_task = asyncio.create_task(
        MemoryOrchestrator.get_working_memory(req.session_id)
    )
    long_term_memory_task = asyncio.create_task(
        asyncio.to_thread(MemoryOrchestrator.search_long_term_memory, req.user_id, req.message)
    )
    
    working_memory, long_term_memory = await asyncio.gather(
        working_memory_task, long_term_memory_task
    )
    
    # Format rag context
    rag_context = "\n".join(long_term_memory) if long_term_memory else "Нет данных."
    
    # Await LLM Response (Mocked async)
    response_text = await generate_llm_response(req.message, rag_context, working_memory)
    
    # Save exchange to Working Memory
    background_tasks.add_task(
        MemoryOrchestrator.add_to_working_memory, req.session_id, "user", req.message
    )
    background_tasks.add_task(
        MemoryOrchestrator.add_to_working_memory, req.session_id, "assistant", response_text
    )
    
    return {
        "response": response_text,
        "intent": intent,
        "rag_context_used": bool(long_term_memory),
        "history_length": len(working_memory)
    }

@app.websocket("/ws/chat")
async def websocket_chat_endpoint(websocket: WebSocket):
    """
    Streaming endpoint. Could be extended for Server-Sent Events (SSE) or WebSockets
    to pipe audio/text tokens back to Next.js immediately.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            # Process similarly to /api/chat
            message = data.get("message")
            session_id = data.get("session_id", "default")
            user_id = data.get("user_id", "local_user")
            
            # Semantic routing logic inline here...
            await websocket.send_json({"status": "received", "data": message})
    except WebSocketDisconnect:
        pass
