"""Service orchestrating Japanese term capture, enrichment, and SQLite persistence."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.repositories.card_repository import CardDraft, CardRecord, CardRepository
from app.schemas import CaptureResponse, DictionaryEntry, SaveCardRequest, SaveCardResponse
from app.services.yomitan import YomitanError, YomitanService


class CardService:
    """Orchestrates capture identification, enrichment, duplicate prevention, and persistence."""

    def __init__(
        self,
        yomitan_service: YomitanService | None = None,
        card_repository: CardRepository | None = None,
    ):
        self.yomitan = yomitan_service or YomitanService()
        self.repository = card_repository or CardRepository()

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
                status="already_saved",
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
            status="draft",
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
            status=status,
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
            status=status,
            is_duplicate=is_duplicate,
            is_new=is_new,
            is_updated=is_updated,
            created_at=card_record.created_at,
            updated_at=card_record.updated_at,
        )
