"""Service orchestrating Japanese term capture, enrichment, and SQLite persistence."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.repositories.card_repository import CardDraft, CardRecord, CardRepository
from app.schemas import (
    AnkiDecksResponse,
    AnkiModelsResponse,
    AnkiStatusResponse,
    CaptureResponse,
    DictionaryEntry,
    SaveCardRequest,
    SaveCardResponse,
    SyncCardResponse,
)
from app.services.anki_connect import AnkiConnectService, AnkiError
from app.services.yomitan import YomitanError, YomitanService


class CardService:
    """Orchestrates capture identification, enrichment, duplicate prevention, and persistence."""

    def __init__(
        self,
        yomitan_service: YomitanService | None = None,
        card_repository: CardRepository | None = None,
        anki_service: AnkiConnectService | None = None,
    ):
        self.yomitan = yomitan_service or YomitanService()
        self.repository = card_repository or CardRepository()
        self.anki = anki_service or AnkiConnectService()

    def capture_term(self, text: str, deck_name: str = "Default") -> CaptureResponse:
        """
        Create or load a Card Draft without persisting a new card:
        Capture text -> Yomitan identify -> Yomitan enrich -> Extract fields -> Check SQLite -> Card Draft
        """
        # Step 1: Identify via Yomitan
        term = self.yomitan.identify(text)

        # Step 2: Enrich via Yomitan
        enriched = self.yomitan.enrich(term)

        # Step 3: Extract structured entries and examples
        serialized_entries: list[dict[str, Any]] = [asdict(entry) for entry in enriched.entries]

        default_meaning = ""
        for entry in enriched.entries:
            for sense in entry.senses:
                if sense.glosses:
                    default_meaning = ", ".join(sense.glosses)
                    break
            if default_meaning:
                break

        default_example_sentence = ""
        default_example_translation = ""
        for entry in enriched.entries:
            for sense in entry.senses:
                if sense.examples:
                    default_example_sentence = sense.examples[0].japanese
                    default_example_translation = sense.examples[0].translation or ""
                    break
            if default_example_sentence:
                break

        # Step 4: Check if already exists in SQLite
        existing = self.repository.find_by_identity(enriched.expression, enriched.reading, deck_name)
        if existing:
            entries_data = existing.entries if existing.entries else serialized_entries
            return CaptureResponse(
                id=existing.id,
                expression=existing.expression,
                reading=existing.reading,
                meaning=existing.meaning or default_meaning,
                hint=existing.hint,
                example_sentence=existing.example_sentence or default_example_sentence,
                example_translation=existing.example_translation or default_example_translation,
                image=existing.image,
                audio=existing.audio,
                tags=existing.tags,
                notes=existing.notes,
                source_text=existing.source_text or enriched.source_text,
                deinflected_text=existing.deinflected_text or enriched.deinflected_text,
                entries=entries_data,
                dictionary_error=enriched.dictionary_error,
                deck_name=existing.deck_name,
                model_name=existing.model_name,
                status="already_saved",
                sync_status=existing.sync_status,
                anki_note_id=existing.anki_note_id,
                is_duplicate=True,
                is_new=False,
                is_updated=False,
                created_at=existing.created_at,
                updated_at=existing.updated_at,
            )

        # Return non-persisted card draft
        return CaptureResponse(
            id=None,
            expression=enriched.expression,
            reading=enriched.reading,
            meaning=default_meaning,
            hint="",
            example_sentence=default_example_sentence,
            example_translation=default_example_translation,
            image="",
            audio="",
            tags="",
            notes="",
            source_text=enriched.source_text,
            deinflected_text=enriched.deinflected_text,
            entries=serialized_entries,
            dictionary_error=enriched.dictionary_error,
            deck_name=deck_name,
            model_name="",
            status="draft",
            sync_status="pending",
            anki_note_id=None,
            is_duplicate=False,
            is_new=False,
            is_updated=False,
            created_at=None,
            updated_at=None,
        )

    def save_card(self, request: SaveCardRequest) -> SaveCardResponse:
        """
        Validate and save or update a card in SQLite:
        1. Validate the card.
        2. Check duplicate identity.
        3. Persist / update or return duplicate state.
        """
        draft = CardDraft(
            expression=request.expression,
            reading=request.reading,
            meaning=request.meaning,
            hint=request.hint,
            example_sentence=request.example_sentence,
            example_translation=request.example_translation,
            image=request.image,
            audio=request.audio,
            tags=request.tags,
            notes=request.notes,
            source_text=request.source_text,
            deinflected_text=request.deinflected_text,
            deck_name=request.deck_name,
            model_name=request.model_name,
            status="saved",
            id=request.id,
        )

        record, is_new, is_duplicate, is_updated = self.repository.save_or_update(draft)
        status = "already_saved" if is_duplicate else "saved"

        return SaveCardResponse(
            id=record.id,
            expression=record.expression,
            reading=record.reading,
            meaning=record.meaning,
            hint=record.hint,
            example_sentence=record.example_sentence,
            example_translation=record.example_translation,
            image=record.image,
            audio=record.audio,
            tags=record.tags,
            notes=record.notes,
            source_text=record.source_text,
            deinflected_text=record.deinflected_text,
            deck_name=record.deck_name,
            model_name=record.model_name,
            status=status,
            sync_status=record.sync_status,
            anki_note_id=record.anki_note_id,
            sync_error=record.sync_error,
            synced_at=record.synced_at,
            is_duplicate=is_duplicate,
            is_new=is_new,
            is_updated=is_updated,
            created_at=record.created_at,
            updated_at=record.updated_at,
            entries=record.entries,
        )

    def capture_and_save(self, text: str, deck_name: str = "Default") -> CaptureResponse:
        """
        Legacy vertical slice:
        Capture text -> Yomitan identify -> Yomitan enrich -> Card Draft -> Duplicate Check -> SQLite -> Response
        """
        # Step 1: Identify via Yomitan
        term = self.yomitan.identify(text)

        # Step 2: Enrich via Yomitan
        enriched = self.yomitan.enrich(term)

        # Step 3: Extract structured entries and examples
        serialized_entries: list[dict[str, Any]] = [asdict(entry) for entry in enriched.entries]
        serialized_examples: list[dict[str, Any]] = [
            asdict(example)
            for entry in enriched.entries
            for sense in entry.senses
            for example in sense.examples
        ]

        default_meaning = ""
        for entry in enriched.entries:
            for sense in entry.senses:
                if sense.glosses:
                    default_meaning = ", ".join(sense.glosses)
                    break
            if default_meaning:
                break

        # Step 4: Construct card draft
        draft = CardDraft(
            expression=enriched.expression,
            reading=enriched.reading,
            meaning=default_meaning,
            source_text=enriched.source_text,
            deinflected_text=enriched.deinflected_text,
            deck_name=deck_name,
            entries=serialized_entries,
            examples=serialized_examples,
            status="saved",
        )

        # Step 5: Duplicate check & SQLite persistence
        card_record, is_new, is_duplicate, is_updated = self.repository.save_or_update(draft)

        status = "saved" if is_new else "already_saved"
        entries_data = card_record.entries if card_record.entries else serialized_entries

        return CaptureResponse(
            id=card_record.id,
            expression=card_record.expression,
            reading=card_record.reading,
            meaning=card_record.meaning,
            hint=card_record.hint,
            example_sentence=card_record.example_sentence,
            example_translation=card_record.example_translation,
            image=card_record.image,
            audio=card_record.audio,
            tags=card_record.tags,
            notes=card_record.notes,
            source_text=card_record.source_text,
            deinflected_text=card_record.deinflected_text,
            entries=entries_data,
            dictionary_error=enriched.dictionary_error,
            deck_name=card_record.deck_name,
            model_name=card_record.model_name,
            status=status,
            sync_status=card_record.sync_status,
            anki_note_id=card_record.anki_note_id,
            is_duplicate=is_duplicate,
            is_new=is_new,
            is_updated=is_updated,
            created_at=card_record.created_at,
            updated_at=card_record.updated_at,
        )

    def sync_card(self, card_id: int) -> SyncCardResponse:
        """
        Synchronize one locally saved card to AnkiConnect.
        Invariants:
        - SQLite remains authoritative; local card is never deleted or rolled back on failure.
        - Check Anki duplicate identity before note creation.
        - Link existing Anki note ID if found.
        - Safe retry without creating duplicates.
        """
        card = self.repository.get_by_id(card_id)
        if not card:
            raise ValueError(f"Card with ID {card_id} does not exist.")

        # If already marked synced and has anki_note_id, return status immediately
        if card.sync_status == "synced" and card.anki_note_id:
            return SyncCardResponse(
                id=card.id,
                sync_status="synced",
                anki_note_id=card.anki_note_id,
                deck_name=card.deck_name,
                model_name=card.model_name or None,
                synced_at=card.synced_at,
            )

        # Transition to syncing in SQLite
        self.repository.mark_syncing(card_id)

        try:
            # 1. Duplicate check in Anki (by expression + reading in target deck)
            existing_note_id = self.anki.find_existing_note(
                deck_name=card.deck_name,
                expression=card.expression,
                reading=card.reading,
            )

            if existing_note_id is not None:
                updated = self.repository.mark_synced(card_id, existing_note_id)
                return SyncCardResponse(
                    id=card.id,
                    sync_status="synced",
                    anki_note_id=existing_note_id,
                    deck_name=card.deck_name,
                    model_name=card.model_name or None,
                    synced_at=updated.synced_at if updated else None,
                )

            # 2. Add note to Anki
            card_data = {
                "expression": card.expression,
                "reading": card.reading,
                "meaning": card.meaning,
                "hint": card.hint,
                "example_sentence": card.example_sentence,
                "example_translation": card.example_translation,
                "image": card.image,
                "audio": card.audio,
                "tags": card.tags,
                "notes": card.notes,
            }
            tags_list = [t.strip() for t in card.tags.split(",") if t.strip()] if card.tags else []

            explicit_model = card.model_name.strip() if card.model_name and card.model_name.strip() else None

            new_note_id = self.anki.add_note(
                deck_name=card.deck_name,
                card_data=card_data,
                tags=tags_list,
                model_name=explicit_model,
            )

            updated = self.repository.mark_synced(card_id, new_note_id)
            return SyncCardResponse(
                id=card.id,
                sync_status="synced",
                anki_note_id=new_note_id,
                deck_name=card.deck_name,
                model_name=explicit_model,
                synced_at=updated.synced_at if updated else None,
            )

        except Exception as error:
            error_message = str(error)
            self.repository.mark_failed(card_id, error_message)
            return SyncCardResponse(
                id=card.id,
                sync_status="failed",
                anki_note_id=card.anki_note_id,
                deck_name=card.deck_name,
                model_name=card.model_name or None,
                error=error_message,
                synced_at=card.synced_at,
            )

    def get_anki_status(self) -> AnkiStatusResponse:
        """Check AnkiConnect reachability and version."""
        connected, error_msg = self.anki.is_connected()
        if not connected:
            return AnkiStatusResponse(connected=False, error=error_msg)
        try:
            version = self.anki.get_version()
            return AnkiStatusResponse(connected=True, version=version)
        except Exception as error:
            return AnkiStatusResponse(connected=False, error=str(error))

    def get_anki_decks(self) -> AnkiDecksResponse:
        """Retrieve deck list from AnkiConnect or fallback to ['Default']."""
        try:
            decks = self.anki.list_decks()
            if "Default" not in decks:
                decks = ["Default"] + decks
            return AnkiDecksResponse(decks=decks, connected=True)
        except Exception:
            return AnkiDecksResponse(decks=["Default"], connected=False)

    def get_anki_models(self) -> AnkiModelsResponse:
        """Retrieve model/note-type list from AnkiConnect or fallback to ['Basic']."""
        try:
            models = self.anki.get_model_names()
            if not models:
                models = ["Basic"]
            return AnkiModelsResponse(models=models, connected=True)
        except Exception:
            return AnkiModelsResponse(models=["Basic"], connected=False)

