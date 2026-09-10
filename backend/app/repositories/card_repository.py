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
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    deck_name: str = "Default"
    model_name: str = ""
    entries: list[Any] = field(default_factory=list)
    examples: list[Any] = field(default_factory=list)
    status: str = "saved"
    sync_status: str = "pending"
    anki_note_id: int | None = None
    sync_error: str = ""
    synced_at: str | None = None
    id: int | None = None


@dataclass
class CardRecord:
    id: int
    expression: str
    reading: str
    meaning: str
    hint: str
    example_sentence: str
    example_translation: str
    image: str
    audio: str
    tags: str
    notes: str
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
    model_name: str = ""
    sync_status: str = "pending"
    anki_note_id: int | None = None
    sync_error: str = ""
    synced_at: str | None = None
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
    meanings_raw = row["meanings_json"] if "meanings_json" in row.keys() else "[]"
    examples_raw = row["examples_json"] if "examples_json" in row.keys() else "[]"
    try:
        entries = json.loads(meanings_raw) if meanings_raw else []
    except Exception:
        entries = []
    try:
        examples = json.loads(examples_raw) if examples_raw else []
    except Exception:
        examples = []

    def _get(key: str, default: str = "") -> str:
        return row[key] if key in row.keys() and row[key] is not None else default

    anki_note_id = row["anki_note_id"] if "anki_note_id" in row.keys() and row["anki_note_id"] is not None else None
    synced_at = row["synced_at"] if "synced_at" in row.keys() and row["synced_at"] is not None else None

    return CardRecord(
        id=row["id"],
        expression=row["expression"],
        reading=row["reading"],
        meaning=_get("meaning"),
        hint=_get("hint"),
        example_sentence=_get("example_sentence"),
        example_translation=_get("example_translation"),
        image=_get("image"),
        audio=_get("audio"),
        tags=_get("tags"),
        notes=_get("notes"),
        source_text=row["source_text"],
        deinflected_text=row["deinflected_text"],
        deck_name=row["deck_name"],
        normalized_expression=row["normalized_expression"],
        normalized_reading=row["normalized_reading"],
        normalized_deck_name=row["normalized_deck_name"],
        meanings_json=meanings_raw or "[]",
        examples_json=examples_raw or "[]",
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        model_name=_get("model_name", ""),
        sync_status=_get("sync_status", "pending"),
        anki_note_id=anki_note_id,
        sync_error=_get("sync_error", ""),
        synced_at=synced_at,
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
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at
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
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at
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

    def save_or_update(self, draft: CardDraft) -> tuple[CardRecord, bool, bool, bool]:
        """
        Save a new card draft, update an existing card, or return duplicate collision.
        Returns:
            tuple[CardRecord, bool, bool, bool]: (record, is_new, is_duplicate, is_updated)
        """
        norm_expr, norm_read, norm_deck = get_duplicate_identity(draft.expression, draft.reading, draft.deck_name)
        now_utc = datetime.now(timezone.utc).isoformat()
        meanings_json = _serialize_to_json(draft.entries)
        examples_json = _serialize_to_json(draft.examples)

        with db_session(self._db_path) as conn:
            if draft.id is not None:
                # Editing existing card: verify card exists
                existing = conn.execute("SELECT id FROM cards WHERE id = ?", (draft.id,)).fetchone()
                if existing:
                    # Check for identity collision with another card
                    collision = conn.execute(
                        """
                        SELECT id FROM cards
                        WHERE normalized_expression = ? AND normalized_reading = ? AND normalized_deck_name = ? AND id != ?
                        """,
                        (norm_expr, norm_read, norm_deck, draft.id),
                    ).fetchone()
                    if collision:
                        collision_card = self.get_by_id(collision["id"])
                        if collision_card:
                            return collision_card, False, True, False

                    # Update existing card
                    conn.execute(
                        """
                        UPDATE cards SET
                            expression = ?,
                            reading = ?,
                            meaning = ?,
                            hint = ?,
                            example_sentence = ?,
                            example_translation = ?,
                            image = ?,
                            audio = ?,
                            tags = ?,
                            notes = ?,
                            deck_name = ?,
                            model_name = ?,
                            normalized_expression = ?,
                            normalized_reading = ?,
                            normalized_deck_name = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            draft.expression,
                            draft.reading,
                            draft.meaning,
                            draft.hint,
                            draft.example_sentence,
                            draft.example_translation,
                            draft.image,
                            draft.audio,
                            draft.tags,
                            draft.notes,
                            normalize_deck(draft.deck_name),
                            draft.model_name or "",
                            norm_expr,
                            norm_read,
                            norm_deck,
                            now_utc,
                            draft.id,
                        ),
                    )
                    conn.commit()
                    updated = self.get_by_id(draft.id)
                    if updated:
                        return updated, False, False, True

            # Saving new card draft: first check duplicate
            existing_record = self.find_by_identity(draft.expression, draft.reading, draft.deck_name)
            if existing_record:
                return existing_record, False, True, False

            try:
                cursor = conn.execute(
                    """
                    INSERT INTO cards (
                        expression, reading, meaning, hint, example_sentence, example_translation,
                        image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                        normalized_expression, normalized_reading, normalized_deck_name,
                        meanings_json, examples_json, status, sync_status, anki_note_id,
                        sync_error, synced_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        draft.expression,
                        draft.reading,
                        draft.meaning,
                        draft.hint,
                        draft.example_sentence,
                        draft.example_translation,
                        draft.image,
                        draft.audio,
                        draft.tags,
                        draft.notes,
                        draft.source_text,
                        draft.deinflected_text,
                        normalize_deck(draft.deck_name),
                        draft.model_name or "",
                        norm_expr,
                        norm_read,
                        norm_deck,
                        meanings_json,
                        examples_json,
                        draft.status,
                        draft.sync_status,
                        draft.anki_note_id,
                        draft.sync_error,
                        draft.synced_at,
                        now_utc,
                        now_utc,
                    ),
                )
                conn.commit()
                inserted_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                # Concurrent insertion race condition - return existing
                existing_record = self.find_by_identity(draft.expression, draft.reading, draft.deck_name)
                if existing_record:
                    return existing_record, False, True, False
                raise

        new_card = self.get_by_id(inserted_id)
        if not new_card:
            raise RuntimeError(f"Card row {inserted_id} could not be retrieved after insert.")
        return new_card, True, False, False

    def save(self, draft: CardDraft) -> tuple[CardRecord, bool]:
        """Backward-compatible save method returning (record, is_new)."""
        record, is_new, _, _ = self.save_or_update(draft)
        return record, is_new

    def mark_syncing(self, card_id: int) -> CardRecord | None:
        """Mark a card's sync_status as syncing."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                "UPDATE cards SET sync_status = 'syncing', updated_at = ? WHERE id = ?",
                (now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def mark_synced(self, card_id: int, anki_note_id: int) -> CardRecord | None:
        """Mark a card as successfully synced to Anki."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                """
                UPDATE cards SET
                    sync_status = 'synced',
                    anki_note_id = ?,
                    sync_error = '',
                    synced_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (anki_note_id, now_utc, now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def mark_failed(self, card_id: int, error_message: str) -> CardRecord | None:
        """Mark a card as failed to sync to Anki."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                """
                UPDATE cards SET
                    sync_status = 'failed',
                    sync_error = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (error_message, now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def set_anki_note_id(self, card_id: int, anki_note_id: int) -> CardRecord | None:
        """Associate an Anki note ID with a card."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                "UPDATE cards SET anki_note_id = ?, updated_at = ? WHERE id = ?",
                (anki_note_id, now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def get_pending_or_failed_cards(self) -> list[CardRecord]:
        """Retrieve all cards with sync_status in ('pending', 'failed')."""
        with db_session(self._db_path) as conn:
            rows = conn.execute(
                """
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at
                FROM cards
                WHERE sync_status IN ('pending', 'failed')
                ORDER BY id ASC
                """
            ).fetchall()
            return [_row_to_record(row) for row in rows]

    def get_sync_state(self, card_id: int) -> dict[str, Any] | None:
        """Retrieve the sync state of a card."""
        card = self.get_by_id(card_id)
        if not card:
            return None
        return {
            "id": card.id,
            "sync_status": card.sync_status,
            "anki_note_id": card.anki_note_id,
            "sync_error": card.sync_error,
            "synced_at": card.synced_at,
            "deck_name": card.deck_name,
            "model_name": card.model_name,
        }

    def list_cards(
        self,
        search: str | None = None,
        deck_name: str | None = None,
        sync_status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CardRecord]:
        """
        List cards with optional search query and filters.
        Results are ordered by id DESC (newest cards first).
        """
        query = """
            SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                   image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                   normalized_expression, normalized_reading, normalized_deck_name,
                   meanings_json, examples_json, status, created_at, updated_at,
                   sync_status, anki_note_id, sync_error, synced_at
            FROM cards
        """
        conditions = []
        params: list[Any] = []

        if search and search.strip():
            term = f"%{search.strip()}%"
            conditions.append(
                "(expression LIKE ? OR reading LIKE ? OR meaning LIKE ? OR example_sentence LIKE ? OR notes LIKE ? OR tags LIKE ?)"
            )
            params.extend([term, term, term, term, term, term])

        if deck_name and deck_name.strip() and deck_name.strip().lower() != "all":
            conditions.append("deck_name = ?")
            params.append(deck_name.strip())

        if sync_status and sync_status.strip() and sync_status.strip().lower() != "all":
            conditions.append("sync_status = ?")
            params.append(sync_status.strip().lower())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([max(1, limit), max(0, offset)])

        with db_session(self._db_path) as conn:
            rows = conn.execute(query, params).fetchall()
            return [_row_to_record(row) for row in rows]

    def count_cards(
        self,
        search: str | None = None,
        deck_name: str | None = None,
        sync_status: str | None = None,
    ) -> int:
        """Count cards matching optional search query and filters."""
        query = "SELECT COUNT(*) AS total FROM cards"
        conditions = []
        params: list[Any] = []

        if search and search.strip():
            term = f"%{search.strip()}%"
            conditions.append(
                "(expression LIKE ? OR reading LIKE ? OR meaning LIKE ? OR example_sentence LIKE ? OR notes LIKE ? OR tags LIKE ?)"
            )
            params.extend([term, term, term, term, term, term])

        if deck_name and deck_name.strip() and deck_name.strip().lower() != "all":
            conditions.append("deck_name = ?")
            params.append(deck_name.strip())

        if sync_status and sync_status.strip() and sync_status.strip().lower() != "all":
            conditions.append("sync_status = ?")
            params.append(sync_status.strip().lower())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        with db_session(self._db_path) as conn:
            row = conn.execute(query, params).fetchone()
            return int(row["total"]) if row else 0

    def get_saved_decks(self) -> list[str]:
        """Retrieve unique deck names from saved cards."""
        with db_session(self._db_path) as conn:
            rows = conn.execute("SELECT DISTINCT deck_name FROM cards ORDER BY deck_name ASC").fetchall()
            return [row["deck_name"] for row in rows if row["deck_name"]]

    def delete(self, card_id: int) -> bool:
        """Delete a card row from SQLite by id. Returns True if deleted, False if not found."""
        with db_session(self._db_path) as conn:
            cursor = conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
            conn.commit()
            return cursor.rowcount > 0

