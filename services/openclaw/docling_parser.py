"""
docling_parser.py — Docling-powered parser for complex documents.
Supports: PDF, PPTX, XLSX, DOCX, HTML, images (OCR).
Falls back gracefully on import/runtime errors.

Shadow Integration: called ONLY for binary formats.
Markdown/text files continue to use the existing parser.
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("openclaw.docling")

# Lazy import — docling may not be installed
_docling_available: Optional[bool] = None


def _check_docling() -> bool:
    global _docling_available
    if _docling_available is None:
        try:
            from docling.document_converter import DocumentConverter  # noqa: F401
            _docling_available = True
            logger.info("Docling available — PDF/PPTX/XLSX parsing enabled")
        except ImportError:
            _docling_available = False
            logger.warning("Docling not installed — pip install 'docling[ocr]' for full support")
    return _docling_available


def is_complex_document(file_path: str) -> bool:
    """Check if file requires Docling (binary/complex format)."""
    ext = Path(file_path).suffix.lower()
    return ext in {".pdf", ".pptx", ".xlsx", ".xls", ".docx", ".doc", ".html", ".htm",
                   ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}


def parse_document(file_path: str) -> Optional[str]:
    """
    Parse a complex document using Docling.
    Returns Markdown string or None on failure (caller should fallback).
    """
    if not _check_docling():
        logger.warning(f"Docling not available, skipping: {file_path}")
        return None

    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(file_path)
        markdown = result.document.export_to_markdown()

        if not markdown or len(markdown.strip()) < 10:
            logger.warning(f"Docling returned empty result for: {file_path}")
            return None

        logger.info(f"Docling parsed: {file_path} → {len(markdown)} chars")
        return markdown

    except Exception as e:
        logger.error(f"Docling parse failed for {file_path}: {e}")
        return None


def health_check() -> dict:
    """Return Docling health status."""
    available = _check_docling()
    info = {"available": available, "status": "ok" if available else "not_installed"}

    if available:
        try:
            from docling.document_converter import DocumentConverter
            info["version"] = getattr(DocumentConverter, "__version__", "unknown")
        except Exception:
            pass

    return info
