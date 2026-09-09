import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import db_session, init_db
from app.main import app
from app.repositories.card_repository import CardRepository
from app.services.yomitan import (
    DictionaryEntry,
    EnrichedTerm,
    Example,
    IdentifiedTerm,
    Sense,
)


class CaptureIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_integration.db"
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

    @patch("app.main.YomitanService")
    def test_1_new_capture_saved(self, mock_yomitan_cls):
        mock_yomitan_cls.return_value = self._mock_yomitan("映画", "えいが")

        response = self.client.post("/api/capture", json={"text": "映画", "deck_name": "Default"})
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data["expression"], "映画")
        self.assertEqual(data["reading"], "えいが")
        self.assertEqual(data["deck_name"], "Default")
        self.assertEqual(data["status"], "saved")
        self.assertFalse(data["is_duplicate"])
        self.assertIsNotNone(data["id"])

        # Verify in SQLite database
        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 1)
        db_card = repo.get_by_id(data["id"])
        self.assertIsNotNone(db_card)
        self.assertEqual(db_card.expression, "映画")

    @patch("app.main.YomitanService")
    def test_2_same_capture_again_returns_existing_card(self, mock_yomitan_cls):
        mock_yomitan_cls.return_value = self._mock_yomitan("映画", "えいが")

        # First capture
        res1 = self.client.post("/api/capture", json={"text": "映画", "deck_name": "Default"})
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertFalse(data1["is_duplicate"])
        self.assertEqual(data1["status"], "saved")

        # Second capture of same term
        res2 = self.client.post("/api/capture", json={"text": "映画", "deck_name": "Default"})
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()

        self.assertTrue(data2["is_duplicate"])
        self.assertEqual(data2["status"], "already_saved")
        self.assertEqual(data2["id"], data1["id"])

        # Verify no second database row created
        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 1)

    @patch("app.main.YomitanService")
    def test_3_different_deck_identity_creates_separate_card(self, mock_yomitan_cls):
        mock_yomitan_cls.return_value = self._mock_yomitan("映画", "えいが")

        # Capture in Default deck
        res1 = self.client.post("/api/capture", json={"text": "映画", "deck_name": "Default"})
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertFalse(data1["is_duplicate"])

        # Capture in Anime deck
        res2 = self.client.post("/api/capture", json={"text": "映画", "deck_name": "Anime"})
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertFalse(data2["is_duplicate"])
        self.assertEqual(data2["status"], "saved")
        self.assertNotEqual(data1["id"], data2["id"])

        # Verify 2 rows in database
        repo = CardRepository(self.db_path)
        self.assertEqual(repo.count(), 2)

    @patch("app.main.YomitanService")
    def test_4_existing_yomitan_enrichment_still_works(self, mock_yomitan_cls):
        mock_yomitan_cls.return_value = self._mock_yomitan(
            expression="日にち",
            reading="ひにち",
            glosses=["date (of a planned event, act, etc.)", "days"],
            examples=[Example("日にちを決める", "to decide on a date")],
        )

        response = self.client.post("/api/capture", json={"text": "日にち"})
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(data["expression"], "日にち")
        self.assertEqual(data["reading"], "ひにち")
        self.assertEqual(len(data["entries"]), 1)
        self.assertEqual(data["entries"][0]["dictionary"], "Jitendex")
        self.assertEqual(
            data["entries"][0]["senses"][0]["glosses"],
            ["date (of a planned event, act, etc.)", "days"],
        )
        self.assertEqual(
            data["entries"][0]["senses"][0]["examples"][0]["japanese"],
            "日にちを決める",
        )
        self.assertEqual(
            data["entries"][0]["senses"][0]["examples"][0]["translation"],
            "to decide on a date",
        )


if __name__ == "__main__":
    unittest.main()
