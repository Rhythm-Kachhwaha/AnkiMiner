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


class Phase7WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_phase7_flow.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)
        self.client = TestClient(app)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    @patch("app.services.card_service.YomitanService")
    @patch("app.services.card_service.AnkiConnectService")
    def test_complete_phase7_mining_history_and_card_library_flow(self, mock_anki_cls, mock_yomitan_cls):
        # Setup Yomitan mock
        mock_yomitan = mock_yomitan_cls.return_value
        mock_yomitan.identify.side_effect = lambda text: IdentifiedTerm(text, "えいが" if text == "映画" else "にほん", text, text)
        mock_yomitan.enrich.side_effect = lambda term: EnrichedTerm(
            expression=term.expression,
            reading=term.reading,
            source_text=term.source_text,
            deinflected_text=term.deinflected_text,
            entries=[
                DictionaryEntry(
                    dictionary="Jitendex",
                    is_primary=True,
                    term=term.expression,
                    reading=term.reading,
                    senses=[Sense(glosses=["movie", "film"], examples=[Example("映画を見る", "watch a movie")])],
                )
            ],
        )

        # Setup Anki mock
        mock_anki = mock_anki_cls.return_value
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 10001

        # Step 1: Capture Japanese text
        cap_resp = self.client.post("/api/capture", json={"text": "映画", "auto_save": False})
        self.assertEqual(cap_resp.status_code, 200)
        draft = cap_resp.json()
        self.assertEqual(draft["expression"], "映画")
        self.assertEqual(draft["reading"], "えいが")
        self.assertIsNone(draft["id"])

        # Step 2: Save Card to SQLite
        save_resp = self.client.post("/api/cards/save", json={
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie, film",
            "deck_name": "Japanese Mining",
            "model_name": "Basic",
        })
        self.assertEqual(save_resp.status_code, 200)
        saved = save_resp.json()
        card_id = saved["id"]
        self.assertIsNotNone(card_id)
        self.assertTrue(saved["is_new"])
        self.assertFalse(saved["is_duplicate"])

        # Step 3: Card appears in history / library
        lib_resp = self.client.get("/api/cards")
        self.assertEqual(lib_resp.status_code, 200)
        lib_data = lib_resp.json()
        self.assertEqual(lib_data["total"], 1)
        self.assertEqual(len(lib_data["cards"]), 1)
        self.assertEqual(lib_data["cards"][0]["id"], card_id)
        self.assertEqual(lib_data["cards"][0]["expression"], "映画")
        self.assertEqual(lib_data["cards"][0]["deck_name"], "Japanese Mining")
        self.assertEqual(lib_data["cards"][0]["sync_status"], "pending")

        # Step 4: Open saved card from library by ID
        get_resp = self.client.get(f"/api/cards/{card_id}")
        self.assertEqual(get_resp.status_code, 200)
        card_detail = get_resp.json()
        self.assertEqual(card_detail["id"], card_id)
        self.assertEqual(card_detail["expression"], "映画")
        self.assertEqual(card_detail["meaning"], "movie, film")

        # Step 5: Edit the opened card and save again
        edit_resp = self.client.post("/api/cards/save", json={
            "id": card_id,
            "expression": "映画",
            "reading": "えいが",
            "meaning": "cinema, motion picture (edited)",
            "deck_name": "Japanese Mining",
            "model_name": "Kaishi 1.5k",
            "notes": "Watched recently",
        })
        self.assertEqual(edit_resp.status_code, 200)
        edited = edit_resp.json()
        self.assertEqual(edited["id"], card_id)
        self.assertTrue(edited["is_updated"])
        self.assertFalse(edited["is_new"])

        # Verify same SQLite row updated, not duplicate created
        lib_resp2 = self.client.get("/api/cards")
        self.assertEqual(lib_resp2.json()["total"], 1)
        self.assertEqual(lib_resp2.json()["cards"][0]["meaning"], "cinema, motion picture (edited)")
        self.assertEqual(lib_resp2.json()["cards"][0]["model_name"], "Kaishi 1.5k")

        # Step 6: Send to Anki via sync endpoint
        sync_resp = self.client.post(f"/api/cards/{card_id}/sync")
        self.assertEqual(sync_resp.status_code, 200)
        self.assertEqual(sync_resp.json()["sync_status"], "synced")
        self.assertEqual(sync_resp.json()["anki_note_id"], 10001)

        # Step 7: Verify library reflects synced status
        lib_resp3 = self.client.get("/api/cards?sync_status=synced")
        self.assertEqual(lib_resp3.json()["total"], 1)

        lib_resp_pend = self.client.get("/api/cards?sync_status=pending")
        self.assertEqual(lib_resp_pend.json()["total"], 0)

        # Step 8: Search in library
        search_match = self.client.get("/api/cards?search=cinema")
        self.assertEqual(search_match.json()["total"], 1)
        self.assertEqual(search_match.json()["cards"][0]["expression"], "映画")

        search_miss = self.client.get("/api/cards?search=nonexistent")
        self.assertEqual(search_miss.json()["total"], 0)

        # Step 9: Filter by deck
        deck_match = self.client.get("/api/cards?deck=Japanese Mining")
        self.assertEqual(deck_match.json()["total"], 1)

        deck_miss = self.client.get("/api/cards?deck=Other Deck")
        self.assertEqual(deck_miss.json()["total"], 0)

        # Step 10: Capture a second word without breaking capture
        cap_resp2 = self.client.post("/api/capture", json={"text": "日本", "auto_save": False})
        self.assertEqual(cap_resp2.status_code, 200)
        self.assertEqual(cap_resp2.json()["expression"], "日本")

        # Save second card
        save_resp2 = self.client.post("/api/cards/save", json={
            "expression": "日本",
            "reading": "にほん",
            "meaning": "Japan",
            "deck_name": "Japanese Mining",
        })
        self.assertEqual(save_resp2.status_code, 200)
        second_card_id = save_resp2.json()["id"]

        # Verify library now has 2 cards, newest ("日本") first
        lib_resp4 = self.client.get("/api/cards")
        self.assertEqual(lib_resp4.json()["total"], 2)
        self.assertEqual(lib_resp4.json()["cards"][0]["id"], second_card_id)
        self.assertEqual(lib_resp4.json()["cards"][0]["expression"], "日本")
        self.assertEqual(lib_resp4.json()["cards"][1]["id"], card_id)

        # Step 11: Delete local card (e.g. second card)
        del_resp = self.client.delete(f"/api/cards/{second_card_id}")
        self.assertEqual(del_resp.status_code, 200)
        self.assertTrue(del_resp.json()["deleted"])

        # Library now has 1 card left
        lib_resp5 = self.client.get("/api/cards")
        self.assertEqual(lib_resp5.json()["total"], 1)
        self.assertEqual(lib_resp5.json()["cards"][0]["id"], card_id)


if __name__ == "__main__":
    unittest.main()
