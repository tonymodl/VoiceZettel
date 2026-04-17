import asyncio
import json
from services.api.semantic_router import SemanticRouter
from services.memory.memory_orchestrator import MemoryOrchestrator
from services.api.main import generate_llm_response

async def run_test():
    session_id = "test_user_session"
    user_id = "anton_test"
    
    print("=== STARTING VOICEZETTEL ASSISTANT TEST ===")
    
    # 1. User says a command
    msg1 = "Останови музыку"
    print(f"\nUser: {msg1}")
    intent1 = SemanticRouter.classify_intent(msg1)
    print(f"Intent classified as: {intent1}")
    if intent1 == SemanticRouter.INTENT_COMMAND:
        res = SemanticRouter.process_command(msg1)
        print(f"Assistant (Instant): {res['reply']}")

    # 2. User saves a memory
    msg2 = "Сохрани в дневник, что мой любимый цвет синий"
    print(f"\nUser: {msg2}")
    intent2 = SemanticRouter.classify_intent(msg2)
    print(f"Intent classified as: {intent2}")
    if intent2 == SemanticRouter.INTENT_SAVE_MEMORY:
        # Simulate background task
        MemoryOrchestrator.add_to_long_term_memory(user_id, msg2)
        await MemoryOrchestrator.add_to_working_memory(session_id, "user", msg2)
        await MemoryOrchestrator.add_to_working_memory(session_id, "assistant", "Записал. Что-то еще?")
        print("Assistant (Instant): Записал. Что-то еще?")

    # 3. User asks a question relying on Long-Term Memory
    msg3 = "Какой мой любимый цвет?"
    print(f"\nUser: {msg3}")
    intent3 = SemanticRouter.classify_intent(msg3)
    print(f"Intent classified as: {intent3}")
    
    long_term_mem = MemoryOrchestrator.search_long_term_memory(user_id, msg3, top_k=2)
    print("Extracted from Long-Term ChromaDB:", long_term_mem)
    
    working_memory = await MemoryOrchestrator.get_working_memory(session_id)
    print("Extracted from Short-Term Redis/Dict:", working_memory)
    
    rag_context = "\n".join(long_term_mem) if long_term_mem else "Нет данных."
    
    response = await generate_llm_response(msg3, rag_context, working_memory)
    print(f"Assistant (LLM): {response}")
    
    print("\n=== TEST COMPLETED SUCCESSFULLY ===")

if __name__ == "__main__":
    asyncio.run(run_test())
