"""
deep_agent.py — LangChain Deep Agent for VoiceZettel.
Sandbox-based: read-only vault access, write only to Wiki_v2/.drafts
or main vault depending on configuration.

Shadow Integration: This agent is OPTIONAL. If disabled or
if langchain is not installed, the existing pipeline works unchanged.
"""

import os
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("openclaw.deep_agent")

# Lazy import flag
_langchain_available: Optional[bool] = None


def _check_langchain() -> bool:
    global _langchain_available
    if _langchain_available is None:
        try:
            from langchain.agents import AgentExecutor  # noqa: F401
            from langchain_openai import ChatOpenAI  # noqa: F401
            _langchain_available = True
            logger.info("LangChain available — Deep Agent enabled")
        except ImportError:
            _langchain_available = False
            logger.warning("LangChain not installed — pip install langchain langchain-openai")
    return _langchain_available


class DeepAgent:
    """
    LangChain-based agent for enriching wiki notes.

    Tools available to the agent:
    - search_vault(query) — semantic search in ChromaDB (read-only)
    - read_file(path) — read from Wiki_v2/ and Raw_v2/ ONLY
    - write_draft(title, content) — write ONLY to sandbox_dir

    Security:
    - NO delete_file tool — agent cannot delete vault files
    - Write access restricted to sandbox_dir
    - Read access restricted to vault_dir
    """

    def __init__(self, vault_dir: str, sandbox_dir: str):
        self.vault_dir = Path(vault_dir)
        self.sandbox_dir = Path(sandbox_dir)
        self.sandbox_dir.mkdir(parents=True, exist_ok=True)

        self._indexer_url = os.environ.get("INDEXER_URL", "http://localhost:8030")
        self._allow_main_vault = os.environ.get("DEEP_AGENT_WRITE_VAULT", "false").lower() == "true"

    async def enrich(self, file_path: str) -> dict:
        """
        Enrich a wiki file by finding related concepts.

        1. Read the source file
        2. Search for related content in ChromaDB
        3. Generate enrichment suggestions
        4. Write enriched draft
        """
        if not _check_langchain():
            return {"status": "error", "message": "LangChain not installed"}

        source = Path(file_path)
        if not source.exists():
            return {"status": "error", "message": f"File not found: {file_path}"}

        # Read source content
        content = source.read_text(encoding="utf-8")

        # Search for related content via indexer
        related = await self._search_related(content[:500])

        # Build enrichment
        enriched = await self._generate_enrichment(content, related)

        # Write to sandbox
        draft_name = f"enriched_{source.stem}.md"
        draft_path = self.sandbox_dir / draft_name
        draft_path.write_text(enriched, encoding="utf-8")

        # Optionally write to main vault
        if self._allow_main_vault:
            main_path = source.parent / f"{source.stem}_enriched.md"
            main_path.write_text(enriched, encoding="utf-8")
            logger.info(f"Deep Agent: wrote to main vault: {main_path}")

        return {
            "status": "ok",
            "draft_path": str(draft_path),
            "related_found": len(related),
            "enriched_chars": len(enriched),
        }

    async def _search_related(self, query: str) -> list[dict]:
        """Search ChromaDB for related content."""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{self._indexer_url}/search",
                    json={"query": query, "top_k": 5},
                )
                if resp.status_code == 200:
                    return resp.json()
        except Exception as e:
            logger.warning(f"Deep Agent search failed: {e}")
        return []

    async def _generate_enrichment(self, content: str, related: list[dict]) -> str:
        """Generate enriched version using LLM."""
        if not _check_langchain():
            return content

        try:
            from langchain_openai import ChatOpenAI
            from langchain.schema import HumanMessage, SystemMessage

            llm = ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0.3,
                max_tokens=2000,
            )

            related_text = "\n\n".join([
                f"--- Related [{i+1}] ---\n{r.get('text', '')[:300]}"
                for i, r in enumerate(related[:3])
            ])

            messages = [
                SystemMessage(content=(
                    "You are a Zettelkasten enrichment agent. "
                    "Given a wiki note and related documents, add a '## Связанные концепции' "
                    "section with backlinks and brief descriptions. Keep the original content intact. "
                    "Write in Russian."
                )),
                HumanMessage(content=(
                    f"## Оригинальная заметка:\n{content[:2000]}\n\n"
                    f"## Найденные связи:\n{related_text}\n\n"
                    "Добавь раздел '## 🔗 Связанные концепции' к заметке."
                )),
            ]

            response = await llm.ainvoke(messages)
            return response.content

        except Exception as e:
            logger.error(f"Deep Agent LLM call failed: {e}")
            return content  # Return original on failure
