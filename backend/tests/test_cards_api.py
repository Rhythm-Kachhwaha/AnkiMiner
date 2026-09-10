import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository


class CardsApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_cards_api.db"
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

    def test_list_cards_empty(self):
        resp = self.client.get("/api/cards")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["cards"], [])
        self.assertEqual(data["total"], 0)
        self.assertEqual(data["limit"], 50)
        self.assertEqual(data["offset"], 0)

    def test_list_cards_populated_and_ordered_newest_first(self):
        self.repo.save(CardDraft(expression="映画", reading="えいが", meaning="movie", deck_name="Deck1", model_name="Basic"))
        self.repo.save(CardDraft(expression="本", reading="ほん", meaning="book", deck_name="Deck2", model_name="Japanese"))

        resp = self.client.get("/api/cards")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 2)
        cards = data["cards"]
        self.assertEqual(len(cards), 2)
        # Newest first
        self.assertEqual(cards[0]["expression"], "本")
        self.assertEqual(cards[0]["deck_name"], "Deck2")
        self.assertEqual(cards[0]["model_name"], "Japanese")
        self.assertEqual(cards[0]["sync_status"], "pending")
        self.assertEqual(cards[1]["expression"], "映画")
        self.assertEqual(cards[1]["deck_name"], "Deck1")

    def test_list_cards_pagination(self):
        for i in range(5):
            self.repo.save(CardDraft(expression=f"語{i}", reading=f"ご{i}", meaning=f"meaning {i}"))

        resp1 = self.client.get("/api/cards?limit=2&offset=0")
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertEqual(data1["total"], 5)
        self.assertEqual(len(data1["cards"]), 2)
        self.assertEqual(data1["cards"][0]["expression"], "語4")

        resp2 = self.client.get("/api/cards?limit=2&offset=2")
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(len(data2["cards"]), 2)
        self.assertEqual(data2["cards"][0]["expression"], "語2")

    def test_list_cards_search(self):
        self.repo.save(CardDraft(expression="映画", reading="えいが", meaning="cinema, movie"))
        self.repo.save(CardDraft(expression="日本", reading="にほん", meaning="Japan"))

        resp = self.client.get("/api/cards?search=cinema")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["cards"][0]["expression"], "映画")

        resp_none = self.client.get("/api/cards?search=xyz123")
        self.assertEqual(resp_none.status_code, 200)
        self.assertEqual(resp_none.json()["cards"], [])
        self.assertEqual(resp_none.json()["total"], 0)

    def test_list_cards_filters(self):
        c1, _ = self.repo.save(CardDraft(expression="猫", reading="ねこ", deck_name="Animals"))
        c2, _ = self.repo.save(CardDraft(expression="犬", reading="いぬ", deck_name="Default"))
        self.repo.mark_synced(c1.id, anki_note_id=999)

        # Filter by deck
        resp_deck = self.client.get("/api/cards?deck=Animals")
        self.assertEqual(resp_deck.status_code, 200)
        self.assertEqual(resp_deck.json()["total"], 1)
        self.assertEqual(resp_deck.json()["cards"][0]["expression"], "猫")

        # Filter by sync_status
        resp_synced = self.client.get("/api/cards?sync_status=synced")
        self.assertEqual(resp_synced.status_code, 200)
        self.assertEqual(resp_synced.json()["total"], 1)
        self.assertEqual(resp_synced.json()["cards"][0]["expression"], "猫")

        resp_pending = self.client.get("/api/cards?sync_status=pending")
        self.assertEqual(resp_pending.status_code, 200)
        self.assertEqual(resp_pending.json()["total"], 1)
        self.assertEqual(resp_pending.json()["cards"][0]["expression"], "犬")

    def test_get_card_by_id_success_and_not_found(self):
        c, _ = self.repo.save(CardDraft(
            expression="林檎",
            reading="りんご",
            meaning="apple",
            hint="fruit",
            example_sentence="林檎を食べる",
            example_translation="Eat an apple",
            deck_name="Food",
            model_name="Basic",
        ))

        resp = self.client.get(f"/api/cards/{c.id}")
        self.assertEqual(resp.status_code, 200)
        card = resp.json()
        self.assertEqual(card["id"], c.id)
        self.assertEqual(card["expression"], "林檎")
        self.assertEqual(card["reading"], "りんご")
        self.assertEqual(card["meaning"], "apple")
        self.assertEqual(card["hint"], "fruit")
        self.assertEqual(card["example_sentence"], "林檎を食べる")
        self.assertEqual(card["deck_name"], "Food")
        self.assertEqual(card["model_name"], "Basic")

        # 404 for non-existent card
        resp_404 = self.client.get("/api/cards/99999")
        self.assertEqual(resp_404.status_code, 404)

    def test_delete_card_success_and_not_found(self):
        c, _ = self.repo.save(CardDraft(expression="消去", reading="しょうきょ", meaning="deletion"))

        resp = self.client.delete(f"/api/cards/{c.id}")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["deleted"])
        self.assertEqual(resp.json()["id"], c.id)

        # Confirm gone from database
        self.assertIsNone(self.repo.get_by_id(c.id))

        # 404 when deleting already deleted / non-existent
        resp_404 = self.client.delete(f"/api/cards/{c.id}")
        self.assertEqual(resp_404.status_code, 404)


if __name__ == "__main__":
    unittest.main()
