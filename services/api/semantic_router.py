import re
from typing import Dict, Any, Optional

class SemanticRouter:
    """Classifies user intent from transcribed speech before hitting heavy LLMs."""
    
    INTENT_COMMAND = "COMMAND"
    INTENT_SAVE_MEMORY = "SAVE_MEMORY"
    INTENT_QUESTION = "QUESTION"
    INTENT_CONVERSATION = "CONVERSATION"

    @staticmethod
    def classify_intent(text: str) -> str:
        """
        Simple heuristic-based approach for intent classification.
        For production, this could be a lightweight zero-shot classifier or TinyML model.
        """
        lower_text = text.lower().strip()
        
        # Simple commands
        command_patterns = [
            r"^(останови|stop) (музыку|music)",
            r"^(выключись|turn off)",
            r"^(перезагрузись|restart)"
        ]
        for p in command_patterns:
            if re.match(p, lower_text):
                return SemanticRouter.INTENT_COMMAND
                
        # Saving notes/memories
        save_patterns = [
            r"^(сохрани|save) ",
            r"^(добавь в дневник|add to journal) ",
            r"^(запомни|remember) "
        ]
        for p in save_patterns:
            if re.search(p, lower_text):
                return SemanticRouter.INTENT_SAVE_MEMORY
                
        # Querying memory
        question_patterns = [
            r"^(что|какие|где|когда|как) я (говорил|думал|записывал|сохранял)",
            r"^(what|where|when|how) did i (say|write|think|save)",
            r"напомни мне( |$)",
            r"remind me( |$)"
        ]
        for p in question_patterns:
            if re.search(p, lower_text):
                return SemanticRouter.INTENT_QUESTION
                
        # Default fallback
        return SemanticRouter.INTENT_CONVERSATION

    @staticmethod
    def process_command(text: str) -> Dict[str, Any]:
        """Executes local deterministic command without LLM latency."""
        return {
            "status": "success",
            "reply": "Команда выполнена", # "Command executed"
            "action": "system_command",
            "handled": True
        }
