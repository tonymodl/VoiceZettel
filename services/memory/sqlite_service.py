import sqlite3
from pathlib import Path
from typing import List, Tuple, Any

# Path to the SQLite database file (persistent storage)
DB_PATH = Path(__file__).resolve().parent / "voicezettel.db"


def get_connection() -> sqlite3.Connection:
    """Return a SQLite connection with foreign keys enabled.
    The connection uses ``detect_types=sqlite3.PARSE_DECLTYPES`` so that
    Python ``datetime`` objects are stored correctly.
    """
    conn = sqlite3.connect(str(DB_PATH), detect_types=sqlite3.PARSE_DECLTYPES)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    """Create the core tables if they do not already exist.
    The schema is deliberately minimal – it can be extended later without
    breaking existing data. All tables use ``IF NOT EXISTS`` guards so the
    function is safe to call on every startup (idempotent).
    """
    with get_connection() as conn:
        cur = conn.cursor()
        # Simple notes table – stores raw text and optional metadata.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                content TEXT NOT NULL,
                metadata TEXT
            );
            """
        )
        # Example vector store table for RAG – stores embedding as BLOB.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS vectors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id INTEGER NOT NULL,
                embedding BLOB NOT NULL,
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            );
            """
        )
        conn.commit()


def add_note(content: str, metadata: str | None = None) -> int:
    """Insert a new note and return its generated ``id``.
    ``metadata`` can be a JSON string or any other serialised representation.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO notes (content, metadata) VALUES (?, ?)",
            (content, metadata),
        )
        conn.commit()
        return cur.lastrowid


def get_notes(limit: int = 100) -> List[Tuple[int, str, str | None, str]]:
    """Return a list of recent notes ordered by creation time descending.
    Each tuple contains ``(id, created_at, content, metadata)``.
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, created_at, content, metadata FROM notes ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        return cur.fetchall()

# Initialise the database on module import – safe because ``init_db`` is idempotent.
init_db()
