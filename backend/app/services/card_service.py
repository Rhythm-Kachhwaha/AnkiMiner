"""Service orchestrating Japanese term capture, enrichment, and SQLite persistence."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.repositories.card_repository import CardDraft, CardRecord, CardRepository
from app.schemas import CaptureResponse, DictionaryEntry
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

    def capture_and_save(self, text: str, deck_name: str = "Default") -> CaptureResponse:
        """
        Execute the vertical slice:
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

        # Step 4: Construct card draft
        draft = CardDraft(
            expression=enriched.expression,
            reading=enriched.reading,
            source_text=enriched.source_text,
            deinflected_text=enriched.deinflected_text,
            deck_name=deck_name,
            entries=serialized_entries,
            examples=serialized_examples,
            status="saved",
        )

        # Step 5: Duplicate check & SQLite persistence
        card_record, is_new = self.repository.save(draft)

        # Step 6: Return normalized response distinguishing new saved from duplicate
        status = "saved" if is_new else "already_saved"
        entries_data = card_record.entries if card_record.entries else serialized_entries

        return CaptureResponse(
            id=card_record.id,
            expression=card_record.expression,
            reading=card_record.reading,
            source_text=card_record.source_text,
            deinflected_text=card_record.deinflected_text,
            entries=entries_data,
            dictionary_error=enriched.dictionary_error,
            deck_name=card_record.deck_name,
            status=status,
            is_duplicate=not is_new,
            created_at=card_record.created_at,
            updated_at=card_record.updated_at,
        )
