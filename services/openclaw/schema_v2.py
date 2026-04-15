"""
schema_v2.py — SQLite v2 Schema for Knowledge Graph.
VoiceZettel 3.0 Phase 3: Semantic CRM

Isolated database (sqlite_v2.db) — does NOT touch the existing DB.
Tables: Entity_Person, Entity_Task, InteractionEvent, HealthScore
"""

import os
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timezone

logger = logging.getLogger("schema_v2")

DB_PATH = os.environ.get(
    "SQLITE_V2_PATH",
    str(Path(__file__).parent.parent.parent / "data" / "sqlite_v2.db"),
)


def get_connection() -> sqlite3.Connection:
    """Get a connection to sqlite_v2.db with WAL mode."""
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def migrate() -> None:
    """Run all migrations to create/update the v2 schema."""
    conn = get_connection()
    cursor = conn.cursor()

    # ── Entity_Person ─────────────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Entity_Person (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            canonical_name TEXT NOT NULL UNIQUE,
            aliases TEXT DEFAULT '[]',
            telegram_handle TEXT,
            phone TEXT,
            email TEXT,
            birthday TEXT,
            relationship_type TEXT DEFAULT 'unknown',
            dunbar_layer INTEGER DEFAULT 4,
            health_score REAL DEFAULT 100.0,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)

    # ── Entity_Task ───────────────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Entity_Task (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft','active','delegated','completed','cancelled')),
            assignee_id INTEGER REFERENCES Entity_Person(id),
            assignee_name TEXT,
            delegator_name TEXT,
            deadline TEXT,
            priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
            source TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        )
    """)

    # ── InteractionEvent ──────────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS InteractionEvent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL REFERENCES Entity_Person(id) ON DELETE CASCADE,
            event_date TEXT NOT NULL,
            channel TEXT DEFAULT 'telegram',
            direction TEXT DEFAULT 'incoming' CHECK(direction IN ('incoming','outgoing','bidirectional')),
            summary TEXT,
            sentiment REAL DEFAULT 0.0,
            message_count INTEGER DEFAULT 1,
            source_file TEXT,
            created_at TEXT NOT NULL
        )
    """)

    # ── HealthScore History ───────────────────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS HealthScoreHistory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL REFERENCES Entity_Person(id) ON DELETE CASCADE,
            score REAL NOT NULL,
            components TEXT,
            computed_at TEXT NOT NULL
        )
    """)

    # ── DraftAction (for Daily Offload) ───────────────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS DraftAction (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL CHECK(type IN ('reminder','message_draft','task_followup','birthday','health_alert')),
            person_id INTEGER REFERENCES Entity_Person(id),
            title TEXT NOT NULL,
            body TEXT,
            priority TEXT DEFAULT 'medium',
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','dismissed','executed')),
            trigger_reason TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT
        )
    """)

    # ── Indexes ───────────────────────────────────────────
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_person_canonical ON Entity_Person(canonical_name)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_person_telegram ON Entity_Person(telegram_handle)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_status ON Entity_Task(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_assignee ON Entity_Task(assignee_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_interaction_person ON InteractionEvent(person_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_interaction_date ON InteractionEvent(event_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_health_person ON HealthScoreHistory(person_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_draft_status ON DraftAction(status)")

    conn.commit()
    conn.close()
    logger.info(f"SQLite v2 schema migrated: {DB_PATH}")


# ── Repository functions ──────────────────────────────────

def upsert_person(name: str, **kwargs) -> int:
    """Insert or update a person entity. Returns person ID."""
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    canonical = name.strip().lower()

    existing = conn.execute(
        "SELECT id FROM Entity_Person WHERE canonical_name = ?", (canonical,)
    ).fetchone()

    if existing:
        pid = existing["id"]
        updates = {k: v for k, v in kwargs.items() if v is not None}
        updates["last_seen"] = now
        updates["updated_at"] = now
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
            conn.execute(
                f"UPDATE Entity_Person SET {set_clause} WHERE id = ?",
                (*updates.values(), pid),
            )
            conn.commit()
        conn.close()
        return pid
    else:
        conn.execute(
            """INSERT INTO Entity_Person 
               (name, canonical_name, telegram_handle, relationship_type, 
                dunbar_layer, first_seen, last_seen, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                name, canonical,
                kwargs.get("telegram_handle"),
                kwargs.get("relationship_type", "unknown"),
                kwargs.get("dunbar_layer", 4),
                now, now, now, now,
            ),
        )
        conn.commit()
        pid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.close()
        return pid


def add_interaction(person_id: int, event_date: str, channel: str,
                    summary: str, sentiment: float = 0.0, source_file: str = "") -> int:
    """Record an interaction event."""
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO InteractionEvent
           (person_id, event_date, channel, summary, sentiment, source_file, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (person_id, event_date, channel, summary, sentiment, source_file, now),
    )
    conn.commit()
    eid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    # Update person's last_seen
    conn.execute(
        "UPDATE Entity_Person SET last_seen = ?, updated_at = ? WHERE id = ?",
        (now, now, person_id),
    )
    conn.commit()
    conn.close()
    return eid


def create_draft_action(type_: str, title: str, body: str = "",
                        person_id: int = None, priority: str = "medium",
                        trigger_reason: str = "") -> int:
    """Create a draft action for the Daily Offload Dashboard."""
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO DraftAction 
           (type, person_id, title, body, priority, trigger_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (type_, person_id, title, body, priority, trigger_reason, now),
    )
    conn.commit()
    did = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return did


def get_pending_actions() -> list[dict]:
    """Get all pending draft actions for the Offload Dashboard."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT da.*, ep.name as person_name 
           FROM DraftAction da 
           LEFT JOIN Entity_Person ep ON da.person_id = ep.id
           WHERE da.status = 'pending'
           ORDER BY 
             CASE da.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 
                              WHEN 'medium' THEN 2 ELSE 3 END,
             da.created_at DESC""",
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def resolve_action(action_id: int, status: str = "approved") -> None:
    """Mark a draft action as approved or dismissed."""
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE DraftAction SET status = ?, resolved_at = ? WHERE id = ?",
        (status, now, action_id),
    )
    conn.commit()
    conn.close()


# ── Auto-migrate on import ────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    migrate()
    print(f"✅ Database ready: {DB_PATH}")
