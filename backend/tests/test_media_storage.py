"""Unit and integration tests for MediaStorageService and media endpoints."""
import base64
import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardRepository
from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiConnectService
from app.services.card_service import CardService
from app.services.media_storage import MediaStorageService, MediaStorageError


class MediaStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.media_dir = Path(self.temp_dir.name) / "media"
        self.db_path = Path(self.temp_dir.name) / "test_media.db"

        self.orig_media_env = os.environ.get("ANKIMINER_MEDIA_DIR")
        self.orig_db_env = os.environ.get("ANKIMINER_DB_PATH")

        os.environ["ANKIMINER_MEDIA_DIR"] = str(self.media_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)

        init_db(self.db_path)
        self.client = TestClient(app)
        self.storage = MediaStorageService(self.media_dir)

    def tearDown(self):
        if self.orig_media_env is not None:
            os.environ["ANKIMINER_MEDIA_DIR"] = self.orig_media_env
        else:
            os.environ.pop("ANKIMINER_MEDIA_DIR", None)

        if self.orig_db_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.orig_db_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)

        self.temp_dir.cleanup()

    def test_save_image_from_data_url(self):
        # 1x1 transparent PNG data URL
        sample_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        data_url = f"data:image/png;base64,{sample_png_b64}"

        filename = self.storage.save_media(data_url, media_type="image")
        self.assertTrue(filename.startswith("ankiminer_img_"))
        self.assertTrue(filename.endswith(".png"))

        file_path = self.storage.get_media_path(filename)
        self.assertIsNotNone(file_path)
        self.assertTrue(file_path.is_file())
        self.assertEqual(file_path.read_bytes(), base64.b64decode(sample_png_b64))

    def test_save_audio_from_data_url(self):
        sample_audio_bytes = b"RIFF....WAVEfmt ...."
        sample_audio_b64 = base64.b64encode(sample_audio_bytes).decode("ascii")
        data_url = f"data:audio/wav;base64,{sample_audio_b64}"

        filename = self.storage.save_media(data_url, media_type="audio")
        self.assertTrue(filename.startswith("ankiminer_audio_"))
        self.assertTrue(filename.endswith(".wav"))

        read_bytes = self.storage.get_media_bytes(filename)
        self.assertEqual(read_bytes, sample_audio_bytes)

    def test_path_traversal_protection(self):
        self.assertIsNone(self.storage.get_media_path("../secret.txt"))
        self.assertIsNone(self.storage.get_media_path("..\\secret.txt"))
        self.assertIsNone(self.storage.get_media_path("/etc/passwd"))
        self.assertIsNone(self.storage.get_media_path("sub/file.jpg"))

    def test_delete_media(self):
        data_url = "data:image/jpeg;base64," + base64.b64encode(b"test jpeg data").decode("ascii")
        filename = self.storage.save_media(data_url, media_type="image")
        self.assertIsNotNone(self.storage.get_media_path(filename))

        deleted = self.storage.delete_media(filename)
        self.assertTrue(deleted)
        self.assertIsNone(self.storage.get_media_path(filename))

    def test_get_media_endpoint_success_and_404(self):
        data_url = "data:image/jpeg;base64," + base64.b64encode(b"hello image bytes").decode("ascii")
        filename = self.storage.save_media(data_url, media_type="image")

        # GET /api/media/{filename}
        res = self.client.get(f"/api/media/{filename}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "image/jpeg")
        self.assertEqual(res.content, b"hello image bytes")

        # 404 for missing file
        res_404 = self.client.get("/api/media/non_existent.jpg")
        self.assertEqual(res_404.status_code, 404)

    def test_save_card_with_media_data(self):
        sample_img_b64 = "data:image/jpeg;base64," + base64.b64encode(b"screenshot").decode("ascii")
        sample_aud_b64 = "data:audio/webm;base64," + base64.b64encode(b"audio clip").decode("ascii")

        req = SaveCardRequest(
            expression="メディアテスト",
            reading="めでぃあてすと",
            meaning="media test",
            image_data=sample_img_b64,
            audio_data=sample_aud_b64,
        )

        service = CardService(card_repository=CardRepository(self.db_path))
        saved = service.save_card(req)

        self.assertTrue(saved.image.startswith("ankiminer_img_"))
        self.assertTrue(saved.audio.startswith("ankiminer_audio_"))

        # Verify files exist on disk
        self.assertIsNotNone(self.storage.get_media_path(saved.image))
        self.assertIsNotNone(self.storage.get_media_path(saved.audio))

    def test_anki_field_mapping_with_media_and_aliases(self):
        anki = AnkiConnectService()

        # Test Basic model mapping
        card_basic = {
            "expression": "約束",
            "reading": "やくそく",
            "meaning": "promise",
            "image": "ankiminer_img_123.jpg",
            "audio": "ankiminer_audio_456.wav",
        }
        fields_basic = ["Front", "Back"]
        mapped_basic = anki.map_card_to_fields(card_basic, fields_basic)
        self.assertIn("Front", mapped_basic)
        self.assertIn("Back", mapped_basic)

        # Test custom mining model with expanded aliases (targetword, sentenceaudio, vocabimage)
        custom_fields = ["TargetWord", "Reading", "VocabMeaning", "SentenceAudio", "VocabImage"]
        mapped_custom = anki.map_card_to_fields(card_basic, custom_fields)
        self.assertEqual(mapped_custom["TargetWord"], "約束")
        self.assertEqual(mapped_custom["Reading"], "やくそく")
        self.assertEqual(mapped_custom["VocabMeaning"], "promise")
        self.assertEqual(mapped_custom["SentenceAudio"], "ankiminer_audio_456.wav")
        self.assertEqual(mapped_custom["VocabImage"], "ankiminer_img_123.jpg")


if __name__ == "__main__":
    unittest.main()
