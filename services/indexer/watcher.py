"""
watcher.py — Watchdog file watcher for real-time vault indexing.

Watches for .md file changes and triggers re-indexing with debounce.
"""

import asyncio
import logging
import threading
from pathlib import Path
from typing import Callable, Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

logger = logging.getLogger("watcher")

DEBOUNCE_SECONDS = 2.0


class _VaultEventHandler(FileSystemEventHandler):
    """Debounced handler for .md file changes."""

    def __init__(self, callback: Callable[[str, str], None]):
        super().__init__()
        self._callback = callback
        self._pending: dict[str, asyncio.TimerHandle | threading.Timer] = {}
        self._lock = threading.Lock()

    def _is_md(self, path: str) -> bool:
        return path.endswith(".md") and "/.obsidian/" not in path.replace("\\", "/")

    def _schedule(self, event_type: str, path: str):
        if not self._is_md(path):
            return

        with self._lock:
            # Cancel previous timer for this path
            if path in self._pending:
                self._pending[path].cancel()

            # Schedule new debounced call
            timer = threading.Timer(
                DEBOUNCE_SECONDS,
                self._fire,
                args=(event_type, path),
            )
            timer.daemon = True
            self._pending[path] = timer
            timer.start()

    def _fire(self, event_type: str, path: str):
        with self._lock:
            self._pending.pop(path, None)

        logger.debug(f"Watcher event: {event_type} → {path}")
        try:
            self._callback(event_type, path)
        except Exception as e:
            logger.error(f"Watcher callback error: {e}")

    def on_created(self, event: FileSystemEvent):
        if not event.is_directory:
            self._schedule("created", event.src_path)

    def on_modified(self, event: FileSystemEvent):
        if not event.is_directory:
            self._schedule("modified", event.src_path)

    def on_deleted(self, event: FileSystemEvent):
        if not event.is_directory:
            self._schedule("deleted", event.src_path)


class VaultWatcher:
    """Watch Obsidian vault for file changes and trigger indexing."""

    def __init__(self, vault_path: str, on_change: Callable[[str, str], None]):
        self._vault_path = vault_path
        self._on_change = on_change
        self._observer: Optional[Observer] = None
        self._active = False

    @property
    def is_active(self) -> bool:
        return self._active

    def start(self):
        """Start watching the vault directory."""
        if self._active:
            logger.warning("Watcher already active")
            return

        handler = _VaultEventHandler(self._on_change)
        self._observer = Observer()
        self._observer.schedule(handler, self._vault_path, recursive=True)
        self._observer.daemon = True
        self._observer.start()
        self._active = True
        logger.info(f"Watching vault: {self._vault_path}")

    def stop(self):
        """Stop watching."""
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
        self._active = False
        logger.info("Watcher stopped")
