import tempfile
import unittest
from pathlib import Path

from app.repositories.card_repository import CardDraft, CardRepository
from app.services.card_normalizer import (
    get_duplicate_identity,
    normalize_deck,
    normalize_expression,
    normalize_reading,
)


class CardRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_cards.db"
        self.repo = CardRepository(db_path=self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_1_insert_new_card(self):
        draft = CardDraft(
            expression="映画",
            reading="えいが",
            source_text="映画",
            deinflected_text="映画",
            deck_name="Default",
            entries=[{"dictionary": "Jitendex", "senses": [{"glosses": ["movie"]}]}],
        )
        card, is_new = self.repo.save(draft)
        self.assertTrue(is_new)
        self.assertIsNotNone(card.id)
        self.assertEqual(card.expression, "映画")
        self.assertEqual(card.reading, "えいが")
        self.assertEqual(card.status, "saved")
        self.assertEqual(self.repo.count(), 1)

    def test_2_retrieve_card(self):
        draft = CardDraft(expression="日にち", reading="ひにち", source_text="日にち", deinflected_text="日にち")
        saved, is_new = self.repo.save(draft)
        self.assertTrue(is_new)

        by_id = self.repo.get_by_id(saved.id)
        self.assertIsNotNone(by_id)
        self.assertEqual(by_id.expression, "日にち")
        self.assertEqual(by_id.reading, "ひにち")

        by_identity = self.repo.find_by_identity("日にち", "ひにち", "Default")
        self.assertIsNotNone(by_identity)
        self.assertEqual(by_identity.id, saved.id)

    def test_3_duplicate_detection(self):
        draft = CardDraft(expression="映画", reading="えいが")
        saved1, is_new1 = self.repo.save(draft)
        self.assertTrue(is_new1)

        # Attempt to save exact duplicate
        saved2, is_new2 = self.repo.save(draft)
        self.assertFalse(is_new2)
        self.assertEqual(saved1.id, saved2.id)
        self.assertEqual(self.repo.count(), 1)

    def test_4_same_expression_and_reading_different_deck_is_not_duplicate(self):
        draft_default = CardDraft(expression="映画", reading="えいが", deck_name="Default")
        draft_mining = CardDraft(expression="映画", reading="えいが", deck_name="Anime Mining")

        card1, is_new1 = self.repo.save(draft_default)
        card2, is_new2 = self.repo.save(draft_mining)

        self.assertTrue(is_new1)
        self.assertTrue(is_new2)
        self.assertNotEqual(card1.id, card2.id)
        self.assertEqual(self.repo.count(), 2)

    def test_5_same_expression_and_reading_same_deck_is_duplicate(self):
        draft1 = CardDraft(expression="日本", reading="にほん", deck_name="Japanese Vocab")
        draft2 = CardDraft(expression="日本", reading="にほん", deck_name="Japanese Vocab")

        card1, is_new1 = self.repo.save(draft1)
        card2, is_new2 = self.repo.save(draft2)

        self.assertTrue(is_new1)
        self.assertFalse(is_new2)
        self.assertEqual(card1.id, card2.id)
        self.assertEqual(self.repo.count(), 1)

    def test_6_normalization_of_duplicate_identity(self):
        # Full-width whitespace and leading/trailing ASCII whitespace
        expr_with_spaces = "　映画 "
        reading_with_spaces = " えいが　"
        deck_with_spaces = " Default "

        self.assertEqual(normalize_expression(expr_with_spaces), "映画")
        self.assertEqual(normalize_reading(reading_with_spaces), "えいが")
        self.assertEqual(normalize_deck(deck_with_spaces), "Default")
        self.assertEqual(
            get_duplicate_identity(expr_with_spaces, reading_with_spaces, deck_with_spaces),
            ("映画", "えいが", "Default"),
        )

        # Save card with padded text
        draft1 = CardDraft(expression=expr_with_spaces, reading=reading_with_spaces, deck_name=deck_with_spaces)
        card1, is_new1 = self.repo.save(draft1)
        self.assertTrue(is_new1)

        # Query and save with clean text
        draft2 = CardDraft(expression="映画", reading="えいが", deck_name="Default")
        card2, is_new2 = self.repo.save(draft2)
        self.assertFalse(is_new2)
        self.assertEqual(card1.id, card2.id)
        self.assertEqual(self.repo.count(), 1)

    def test_7_repeated_capture_does_not_create_another_row(self):
        draft = CardDraft(expression="食べる", reading="たべる", deck_name="Default")
        card1, is_new1 = self.repo.save(draft)
        self.assertTrue(is_new1)

        # Repeat 5 times
        for _ in range(5):
            repeated, is_new = self.repo.save(draft)
            self.assertFalse(is_new)
            self.assertEqual(repeated.id, card1.id)

        self.assertEqual(self.repo.count(), 1)

    def test_8_model_name_persistence_and_update(self):
        # 1. New card with explicit model_name
        draft = CardDraft(
            expression="約束",
            reading="やくそく",
            deck_name="Japanese",
            model_name="Japanese Mining Model",
        )
        card, is_new, is_dup, is_upd = self.repo.save_or_update(draft)
        self.assertTrue(is_new)
        self.assertEqual(card.model_name, "Japanese Mining Model")

        # 2. Retrieve by ID
        fetched = self.repo.get_by_id(card.id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.model_name, "Japanese Mining Model")

        # 3. Retrieve by identity
        by_ident = self.repo.find_by_identity("約束", "やくそく", "Japanese")
        self.assertIsNotNone(by_ident)
        self.assertEqual(by_ident.model_name, "Japanese Mining Model")

        # 4. Update card with a different model_name
        update_draft = CardDraft(
            id=card.id,
            expression="約束",
            reading="やくそく",
            deck_name="Japanese",
            model_name="Basic (and reversed card)",
        )
        updated_card, is_new2, is_dup2, is_upd2 = self.repo.save_or_update(update_draft)
        self.assertTrue(is_upd2)
        self.assertEqual(updated_card.model_name, "Basic (and reversed card)")

        # Verify persisted in DB
        refetched = self.repo.get_by_id(card.id)
        self.assertEqual(refetched.model_name, "Basic (and reversed card)")


if __name__ == "__main__":
    unittest.main()
