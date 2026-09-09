"""Card repository handling SQLite persistence and duplicate checks."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any

from app.db.connection import db_session, init_db
from app.services.card_normalizer import get_duplicate_identity, normalize_deck, normalize_expression, normalize_reading


@dataclass
class CardDraft:
    expression: str
    reading: str
    source_text: str = ""
    deinflected_text: str = ""
    deck_name: str = "Default"
    entries: list[Any] = field(default_factory=list)
    examples: list[Any] = field(default_factory=list)
    status: str = "saved"


@dataclass
class CardRecord:
    id: int
    expression: str
    reading: str
    source_text: str
    deinflected_text: str
    deck_name: str
    normalized_expression: str
    normalized_reading: str
    normalized_deck_name: str
    meanings_json: str
    examples_json: str
    status: str
    created_at: str
    updated_at: str
    entries: list[dict] = field(default_factory=list)
    examples: list[dict] = field(default_factory=list)


def _serialize_to_json(items: list[Any]) -> str:
    serialized = []
    for item in items:
        if is_dataclass(item):
            serialized.append(asdict(item))
        elif hasattr(item, "model_dump"):
            serialized.append(item.model_dump())
        elif isinstance(item, dict):
            serialized.append(item)
        else:
            serialized.append(str(item))
    return json.dumps(serialized, ensure_ascii=False)


def _row_to_record(row: sqlite3.Row) -> CardRecord:
    meanings_raw = row["meanings_json"]
    examples_raw = row["examples_json"]
    try:
        entries = json.loads(meanings_raw) if meanings_raw else []
    except Exception:
        entries = []
    try:
        examples = json.loads(examples_raw) if examples_raw else []
    except Exception:
        examples = []

    return CardRecord(
        id=row["id"],
        expression=row["expression"],
        reading=row["reading"],
        source_text=row["source_text"],
        deinflected_text=row["deinflected_text"],
        deck_name=row["deck_name"],
        normalized_expression=row["normalized_expression"],
        normalized_reading=row["normalized_reading"],
        normalized_deck_name=row["normalized_deck_name"],
        meanings_json=meanings_raw,
        examples_json=examples_raw,
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        entries=entries,
        examples=examples,
    )


class CardRepository:
    """Repository boundary for Card persistence in SQLite."""

    def __init__(self, db_path: Path | str | None = None):
        self._db_path = db_path
        init_db(self._db_path)

    def find_by_identity(self, expression: str, reading: str, deck_name: str | None = None) -> CardRecord | None:
        """Find a card by its normalized duplicate identity."""
        norm_expr, norm_read, norm_deck = get_duplicate_identity(expression, reading, deck_name)
        with db_session(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT id, expression, reading, source_text, deinflected_text, deck_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at
                FROM cards
                WHERE normalized_expression = ? AND normalized_reading = ? AND normalized_deck_name = ?
                """,
                (norm_expr, norm_read, norm_deck),
            ).fetchone()
            if row:
                return _row_to_record(row)
        return None

    def get_by_id(self, card_id: int) -> CardRecord | None:
        """Retrieve a card by its database ID."""
        with db_session(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT id, expression, reading, source_text, deinflected_text, deck_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at
                FROM cards
                WHERE id = ?
                """,
                (card_id,),
            ).fetchone()
            if row:
                return _row_to_record(row)
        return None

    def count(self) -> int:
        """Count total stored cards."""
        with db_session(self._db_path) as conn:
            row = conn.execute("SELECT COUNT(*) AS total FROM cards").fetchone()
            return int(row["total"]) if row else 0

    def save(self, draft: CardDraft) -> tuple[CardRecord, bool]:
        """
        Save a card draft or return the existing card if duplicate.
        Returns:
            tuple[CardRecord, bool]: (card_record, is_new)
            is_new is True if inserted, False if existing card returned.
        """
        norm_expr, norm_read, norm_deck = get_duplicate_identity(draft.expression, draft.reading, draft.deck_name)

        # First check if duplicate already exists
        existing = self.find_by_identity(draft.expression, draft.reading, draft.deck_name)
        if existing:
            return existing, False

        meanings_json = _serialize_to_json(draft.entries)
        examples_json = _serialize_to_json(draft.examples)
        now_utc = datetime.now(timezone.utc).isoformat()

        with db_session(self._db_path) as conn:
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO cards (
                        expression, reading, source_text, deinflected_text, deck_name,
                        normalized_expression, normalized_reading, normalized_deck_name,
                        meanings_json, examples_json, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        draft.expression,
                        draft.reading,
                        draft.source_text,
                        draft.deinflected_text,
                        normalize_deck(draft.deck_name),
                        norm_expr,
                        norm_read,
                        norm_deck,
                        meanings_json,
                        examples_json,
                        draft.status,
                        now_utc,
                        now_utc,
                    ),
                )
                conn.commit()
                inserted_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                # Concurrent insertion race condition - return existing
                existing = self.find_by_identity(draft.expression, draft.reading, draft.deck_name)
                if existing:
                    return existing, False
                raise

        record = self.get_by_id(inserted_id)
        if not record:
            raise RuntimeError(f"Card row {inserted_id} could not be retrieved after insert.")
        return record, True
