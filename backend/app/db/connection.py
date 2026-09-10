"""SQLite database connection and schema initialization."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
from typing import Iterator

DEFAULT_DB_REL_PATH = Path("data") / "ankiminer.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expression TEXT NOT NULL,
    reading TEXT NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',
    hint TEXT NOT NULL DEFAULT '',
    example_sentence TEXT NOT NULL DEFAULT '',
    example_translation TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    audio TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    deinflected_text TEXT NOT NULL DEFAULT '',
    deck_name TEXT NOT NULL DEFAULT 'Default',
    normalized_expression TEXT NOT NULL,
    normalized_reading TEXT NOT NULL,
    normalized_deck_name TEXT NOT NULL,
    meanings_json TEXT NOT NULL DEFAULT '[]',
    examples_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'saved',
    sync_status TEXT NOT NULL DEFAULT 'pending',
    anki_note_id INTEGER DEFAULT NULL,
    sync_error TEXT NOT NULL DEFAULT '',
    synced_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(normalized_expression, normalized_reading, normalized_deck_name)
);

CREATE INDEX IF NOT EXISTS idx_cards_duplicate_identity 
ON cards (normalized_expression, normalized_reading, normalized_deck_name);
"""


def get_db_path() -> Path:
    """Resolve the SQLite database file path from environment or default."""
    custom_path = os.getenv("ANKIMINER_DB_PATH")
    if custom_path:
        return Path(custom_path)
    # Default is backend/data/ankiminer.db
    base_dir = Path(__file__).resolve().parent.parent.parent
    return base_dir / DEFAULT_DB_REL_PATH


def get_db_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Create and configure a SQLite connection."""
    target_path = Path(db_path) if db_path is not None else get_db_path()
    if target_path != Path(":memory:"):
        target_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(target_path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


@contextmanager
def db_session(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    """Context manager that ensures the SQLite connection is closed on exit."""
    conn = get_db_connection(db_path)
    try:
        yield conn
    finally:
        conn.close()


def init_db(db_path: Path | str | None = None) -> None:
    """Initialize the SQLite database schema and run column migrations if needed."""
    with db_session(db_path) as conn:
        conn.executescript(SCHEMA_SQL)
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(cards)").fetchall()]
        new_cols = [
            ("meaning", "TEXT NOT NULL DEFAULT ''"),
            ("hint", "TEXT NOT NULL DEFAULT ''"),
            ("example_sentence", "TEXT NOT NULL DEFAULT ''"),
            ("example_translation", "TEXT NOT NULL DEFAULT ''"),
            ("image", "TEXT NOT NULL DEFAULT ''"),
            ("audio", "TEXT NOT NULL DEFAULT ''"),
            ("tags", "TEXT NOT NULL DEFAULT ''"),
            ("notes", "TEXT NOT NULL DEFAULT ''"),
            ("sync_status", "TEXT NOT NULL DEFAULT 'pending'"),
            ("anki_note_id", "INTEGER DEFAULT NULL"),
            ("sync_error", "TEXT NOT NULL DEFAULT ''"),
            ("synced_at", "TEXT DEFAULT NULL"),
        ]
        for col_name, col_def in new_cols:
            if col_name not in columns:
                conn.execute(f"ALTER TABLE cards ADD COLUMN {col_name} {col_def}")
        conn.commit()
