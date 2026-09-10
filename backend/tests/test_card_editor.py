import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardRepository
from app.services.yomitan import (
    DictionaryEntry,
    EnrichedTerm,
    Example,
    IdentifiedTerm,
    Sense,
)


class CardEditorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_editor.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.client = TestClient(app)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    def _mock_yomitan(self, expression="映画", reading="えいが", glosses=None, examples=None):
        if glosses is None:
            glosses = ["movie", "film"]
        if examples is None:
            examples = [Example("映画を見る", "to watch a movie")]

        service = MagicMock()
        service.identify.return_value = IdentifiedTerm(expression, reading, expression, expression)
        service.enrich.return_value = EnrichedTerm(
            expression=expression,
            reading=reading,
            source_text=expression,
            deinflected_text=expression,
            entries=[
                DictionaryEntry(
                    dictionary="Jitendex",
                    is_primary=True,
                    term=expression,
                    reading=reading,
                    parts_of_speech=["noun"],
                    tags=["common"],
                    senses=[Sense(glosses=glosses, examples=examples)],
                )
            ],
            dictionary_error=None,
        )
        return service

    # 1. New card draft creation
    @patch("app.main.YomitanService")
    def test_1_new_card_draft_creation(self, mock_yomitan_cls):
        mock_yomitan_cls.return_value = self._mock_yomitan("映画", "えいが")

        # Capture without auto_save creates a card draft
        res = self.client.post("/api/capture", json={"text": "映画"})
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["status"], "draft")
        self.assertFalse(data["is_duplicate"])
        self.assertIsNone(data["id"])
        self.assertEqual(data["expression"], "映画")
        self.assertEqual(data["reading"], "えいが")
        self.assertEqual(data["meaning"], "movie, film")
        self.assertEqual(data["example_sentence"], "映画を見る")
        self.assertEqual(data["example_translation"], "to watch a movie")

        # Must not write to SQLite
        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 0)

    # 2. Editing expression
    def test_2_editing_expression(self):
        payload = {
            "expression": "邦画",
            "reading": "ほうが",
            "meaning": "Japanese cinema",
            "deck_name": "Default",
        }
        res = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["expression"], "邦画")
        self.assertEqual(data["status"], "saved")
        self.assertTrue(data["is_new"])

        repo = CardRepository(self.db_path)
        saved = repo.get_by_id(data["id"])
        self.assertIsNotNone(saved)
        self.assertEqual(saved.expression, "邦画")

    # 3. Editing reading
    def test_3_editing_reading(self):
        payload = {
            "expression": "映画",
            "reading": "えいが（名詞）",
            "meaning": "movie",
            "deck_name": "Default",
        }
        res = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["reading"], "えいが（名詞）")

        repo = CardRepository(self.db_path)
        saved = repo.get_by_id(data["id"])
        self.assertIsNotNone(saved)
        self.assertEqual(saved.reading, "えいが（名詞）")

    # 4. Editing meaning
    def test_4_editing_meaning(self):
        payload = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie / cinema / film",
            "deck_name": "Default",
        }
        res = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["meaning"], "movie / cinema / film")

        repo = CardRepository(self.db_path)
        saved = repo.get_by_id(data["id"])
        self.assertIsNotNone(saved)
        self.assertEqual(saved.meaning, "movie / cinema / film")

    # 5. Saving optional fields
    def test_5_saving_optional_fields(self):
        payload = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "deck_name": "Default",
            "hint": "watch on big screen",
            "example_sentence": "映画を見る",
            "example_translation": "to watch a movie",
            "image": "https://example.com/movie.jpg",
            "audio": "https://example.com/eiga.mp3",
            "tags": "n5, entertainment",
            "notes": "Learned from dynamic subtitles",
            "model_name": "My Japanese Note",
        }
        res = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["hint"], "watch on big screen")
        self.assertEqual(data["example_sentence"], "映画を見る")
        self.assertEqual(data["example_translation"], "to watch a movie")
        self.assertEqual(data["image"], "https://example.com/movie.jpg")
        self.assertEqual(data["audio"], "https://example.com/eiga.mp3")
        self.assertEqual(data["tags"], "n5, entertainment")
        self.assertEqual(data["notes"], "Learned from dynamic subtitles")
        self.assertEqual(data["model_name"], "My Japanese Note")

        repo = CardRepository(self.db_path)
        saved = repo.get_by_id(data["id"])
        self.assertEqual(saved.hint, "watch on big screen")
        self.assertEqual(saved.tags, "n5, entertainment")
        self.assertEqual(saved.model_name, "My Japanese Note")

    # 6. Save creates exactly one SQLite row
    def test_6_save_creates_exactly_one_sqlite_row(self):
        payload = {
            "expression": "日本",
            "reading": "にほん",
            "meaning": "Japan",
            "deck_name": "Default",
        }
        res = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["is_new"])

        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 1)

    # 7. Duplicate save does not create another row
    def test_7_duplicate_save_does_not_create_another_row(self):
        payload = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "deck_name": "Default",
        }
        # First save
        res1 = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res1.status_code, 200)
        self.assertTrue(res1.json()["is_new"])
        self.assertFalse(res1.json()["is_duplicate"])

        # Second save with exact same identity
        res2 = self.client.post("/api/cards/save", json=payload)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertFalse(data2["is_new"])
        self.assertTrue(data2["is_duplicate"])
        self.assertEqual(data2["status"], "already_saved")
        self.assertEqual(data2["id"], res1.json()["id"])

        # DB row count remains 1
        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 1)

    # 8. Existing card loads into editor
    @patch("app.main.YomitanService")
    def test_8_existing_card_loads_into_editor(self, mock_yomitan_cls):
        mock_yomitan_cls.return_value = self._mock_yomitan("映画", "えいが")

        # Save card first
        payload = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "custom movie translation",
            "deck_name": "Default",
            "hint": "custom hint",
        }
        saved_res = self.client.post("/api/cards/save", json=payload)
        card_id = saved_res.json()["id"]

        # User selects 映画 again on page
        capture_res = self.client.post("/api/capture", json={"text": "映画"})
        self.assertEqual(capture_res.status_code, 200)
        data = capture_res.json()

        self.assertEqual(data["id"], card_id)
        self.assertEqual(data["expression"], "映画")
        self.assertEqual(data["reading"], "えいが")
        self.assertEqual(data["meaning"], "custom movie translation")
        self.assertEqual(data["hint"], "custom hint")
        self.assertEqual(data["status"], "already_saved")
        self.assertTrue(data["is_duplicate"])

        # No new row created in DB
        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 1)

    # 9. Editing existing card updates the row
    def test_9_editing_existing_card_updates_the_row(self):
        # Initial save
        res1 = self.client.post("/api/cards/save", json={"expression": "食べる", "reading": "たべる", "meaning": "to eat"})
        card_id = res1.json()["id"]

        # Edit existing card
        edit_payload = {
            "id": card_id,
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat; to consume",
            "notes": "Updated note",
        }
        res2 = self.client.post("/api/cards/save", json=edit_payload)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()

        self.assertEqual(data2["id"], card_id)
        self.assertEqual(data2["meaning"], "to eat; to consume")
        self.assertEqual(data2["notes"], "Updated note")
        self.assertTrue(data2["is_updated"])
        self.assertFalse(data2["is_new"])

        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 1)
        updated = repo.get_by_id(card_id)
        self.assertEqual(updated.meaning, "to eat; to consume")
        self.assertEqual(updated.notes, "Updated note")

    # 10. Editing existing card does not increment session count (is_new is False)
    def test_10_editing_existing_card_does_not_increment_session_count(self):
        res1 = self.client.post("/api/cards/save", json={"expression": "見る", "reading": "みる", "meaning": "to see"})
        card_id = res1.json()["id"]

        res2 = self.client.post("/api/cards/save", json={"id": card_id, "expression": "見る", "reading": "みる", "meaning": "to watch"})
        data2 = res2.json()
        self.assertFalse(data2["is_new"])
        self.assertTrue(data2["is_updated"])

    # 11. New card increments session count (is_new is True)
    def test_11_new_card_increments_session_count(self):
        res = self.client.post("/api/cards/save", json={"expression": "カメラ", "reading": "カメラ", "meaning": "camera"})
        data = res.json()
        self.assertTrue(data["is_new"])
        self.assertFalse(data["is_duplicate"])

    # 12. Duplicate capture does not increment session count (is_new is False)
    def test_12_duplicate_capture_does_not_increment_session_count(self):
        payload = {"expression": "こんにちは", "reading": "こんにちは", "meaning": "hello"}
        self.client.post("/api/cards/save", json=payload)

        # Duplicate save attempt
        res_dup = self.client.post("/api/cards/save", json=payload)
        data_dup = res_dup.json()
        self.assertFalse(data_dup["is_new"])
        self.assertTrue(data_dup["is_duplicate"])

    # 13. Validation errors do not create a database row
    def test_13_validation_errors_do_not_create_a_database_row(self):
        # Empty expression
        res1 = self.client.post("/api/cards/save", json={"expression": "", "reading": "えいが"})
        self.assertEqual(res1.status_code, 422)

        # Whitespace-only expression
        res2 = self.client.post("/api/cards/save", json={"expression": "   ", "reading": "えいが"})
        self.assertEqual(res2.status_code, 422)

        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 0)


if __name__ == "__main__":
    unittest.main()
