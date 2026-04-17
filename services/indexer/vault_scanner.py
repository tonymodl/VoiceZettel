"""
vault_scanner.py — Scan Obsidian vault, chunk .md files, extract metadata.

Detects source_type by path:
  📬 Telegram/  → telegram
  📝 Сессии/    → session
  🗃 Zettelkasten/ → zettelkasten
  other .md      → note
"""

import os
import re
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger("vault_scanner")

CHUNK_SIZE = 500       # target tokens per chunk (~2000 chars)
CHUNK_OVERLAP = 50     # overlap tokens (~200 chars)
CHARS_PER_TOKEN = 4    # rough estimate


def _detect_source_type(rel_path: str) -> str:
    """Determine source type from vault-relative path."""
    p = rel_path.replace("\\", "/").lower()
    if "telegram" in p:
        return "telegram"
    if "сессии" in p or "sessions" in p or "archive" in p:
        return "session"
    if "zettelkasten" in p:
        return "zettelkasten"
    return "note"


def _extract_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and return (metadata_dict, body)."""
    if not content.startswith("---"):
        return {}, content

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", content, re.DOTALL)
    if not match:
        return {}, content

    try:
        meta = yaml.safe_load(match.group(1)) or {}
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError:
        meta = {}

    return meta, match.group(2)


def _extract_title(content: str, filename: str) -> str:
    """Extract title from first H1 heading or filename."""
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    return filename.replace(".md", "")


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into chunks by paragraph boundaries, respecting chunk_size.
    Each chunk is roughly chunk_size tokens.
    """
    if not text.strip():
        return []

    max_chars = chunk_size * CHARS_PER_TOKEN
    overlap_chars = overlap * CHARS_PER_TOKEN

    # Split by double newlines (paragraphs) or single newlines
    paragraphs = re.split(r"\n{2,}", text)

    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current) + len(para) + 2 <= max_chars:
            current = f"{current}\n\n{para}" if current else para
        else:
            if current:
                chunks.append(current.strip())
            # If single paragraph > max_chars, split by sentences
            if len(para) > max_chars:
                sentences = re.split(r"(?<=[.!?])\s+", para)
                current = ""
                for sent in sentences:
                    if len(current) + len(sent) + 1 <= max_chars:
                        current = f"{current} {sent}" if current else sent
                    else:
                        if current:
                            chunks.append(current.strip())
                        current = sent
            else:
                current = para

    if current.strip():
        chunks.append(current.strip())

    # Add overlap: prepend last N chars of previous chunk
    if overlap_chars > 0 and len(chunks) > 1:
        overlapped = [chunks[0]]
        for i in range(1, len(chunks)):
            prev_tail = chunks[i - 1][-overlap_chars:]
            overlapped.append(f"{prev_tail}... {chunks[i]}")
        chunks = overlapped

    return chunks


class VaultDocument:
    """A single indexed document chunk."""

    def __init__(
        self,
        doc_id: str,
        text: str,
        source_type: str,
        file_path: str,
        title: str,
        chunk_index: int = 0,
        total_chunks: int = 1,
        metadata: Optional[dict] = None,
    ):
        self.doc_id = doc_id
        self.text = text
        self.source_type = source_type
        self.file_path = file_path
        self.title = title
        self.chunk_index = chunk_index
        self.total_chunks = total_chunks
        self.metadata = metadata or {}

    def to_chroma_metadata(self) -> dict:
        """Flatten metadata for ChromaDB (only str/int/float/bool)."""
        return {
            "source_type": self.source_type,
            "file_path": self.file_path,
            "title": self.title,
            "chunk_index": self.chunk_index,
            "total_chunks": self.total_chunks,
            **{k: str(v) for k, v in self.metadata.items() if v is not None},
        }


class VaultScanner:
    """Scan an Obsidian vault and produce chunked documents."""

    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self._stats = {"files_scanned": 0, "chunks_created": 0, "errors": 0}

    @property
    def stats(self) -> dict:
        return {**self._stats}

    def scan_all(self) -> list[VaultDocument]:
        """Scan entire vault and return all document chunks."""
        docs: list[VaultDocument] = []
        self._stats = {"files_scanned": 0, "chunks_created": 0, "errors": 0}

        for md_path in self._iter_md_files():
            try:
                file_docs = self.scan_file(str(md_path))
                docs.extend(file_docs)
            except Exception as e:
                logger.error(f"Error scanning {md_path}: {e}")
                self._stats["errors"] += 1

        logger.info(
            f"Vault scan complete: {self._stats['files_scanned']} files, "
            f"{self._stats['chunks_created']} chunks, {self._stats['errors']} errors"
        )
        return docs

    def scan_file(self, file_path: str) -> list[VaultDocument]:
        """Scan a single .md file and return document chunks."""
        path = Path(file_path)
        if not path.exists() or path.suffix != ".md":
            return []

        try:
            content = path.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"Cannot read {file_path}: {e}")
            return []

        # Allow very short content (e.g., single Telegram messages like "[08:57] Привет")
        # Previous threshold of 20 silently rejected valid real-time messages
        if len(content.strip()) < 5:
            return []

        # Relative path from vault root
        try:
            rel_path = str(path.relative_to(self.vault_path))
        except ValueError:
            rel_path = path.name

        source_type = _detect_source_type(rel_path)
        frontmatter, body = _extract_frontmatter(content)
        title = frontmatter.get("title") or frontmatter.get("chat") or _extract_title(body, path.name)

        # For Telegram files: extract chat_type from path and use parent dir as title
        chat_type = frontmatter.get("type")
        if source_type == "telegram":
            rel_lower = rel_path.replace("\\", "/").lower()
            if "личные" in rel_lower or "private" in rel_lower:
                chat_type = "private"
            elif "группы" in rel_lower or "group" in rel_lower:
                chat_type = "group"
            # Use parent directory name as title (= chat name in Telegram)
            parent_name = path.parent.name
            if parent_name and parent_name not in ("Личные", "Группы", "Telegram", "Raw_v2"):
                title = parent_name

        # Extract date from frontmatter or filename
        date_str = frontmatter.get("date", "")
        if not date_str:
            date_match = re.search(r"(\d{4}-\d{2}-\d{2})", path.stem)
            if date_match:
                date_str = date_match.group(1)

        # Chunk the body
        chunks = _chunk_text(body)
        if not chunks:
            # File too short for chunking — use as single chunk
            chunks = [body.strip()]

        docs: list[VaultDocument] = []
        for i, chunk_text in enumerate(chunks):
            doc_id = f"{rel_path}::chunk_{i}"
            doc = VaultDocument(
                doc_id=doc_id,
                text=chunk_text,
                source_type=source_type,
                file_path=rel_path,
                title=str(title),
                chunk_index=i,
                total_chunks=len(chunks),
                metadata={
                    "date": str(date_str) if date_str else None,
                    "chat_type": chat_type,
                },
            )
            docs.append(doc)

        self._stats["files_scanned"] += 1
        self._stats["chunks_created"] += len(docs)
        return docs

    def _iter_md_files(self):
        """Iterate over all .md files in the vault, skipping .obsidian."""
        for root, dirs, files in os.walk(self.vault_path):
            # Skip hidden directories
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in files:
                if f.endswith(".md"):
                    yield Path(root) / f
