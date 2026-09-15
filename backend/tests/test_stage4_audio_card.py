"""Unit and integration tests for Stage 4: Extracted Audio Card Integration, Persistence, and Anki Field Mapping."""
import base64
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardRepository
from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiConnectService, AnkiConnectionError
from app.services.card_service import CardService
from app.services.media_storage import MediaStorageService


# 44-byte minimal canonical RIFF WAVE header + 4 empty PCM bytes
MINIMAL_WAV_BYTES = (
    b"RIFF\x2c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x80\xbb\x00\x00\x00\x77\x01\x00\x02\x00\x10\x00data\x08\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00"
)
MINIMAL_WAV_B64 = base64.b64encode(MINIMAL_WAV_BYTES).decode("ascii")
MINIMAL_WAV_DATA_URL = f"data:audio/wav;base64,{MINIMAL_WAV_B64}"


class TestStage4AudioStorageAndPersistence(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.media_dir = Path(self.temp_dir.name) / "media"
        self.db_path = Path(self.temp_dir.name) / "test_stage4.db"

        self.orig_media_env = os.environ.get("ANKIMINER_MEDIA_DIR")
        self.orig_db_env = os.environ.get("ANKIMINER_DB_PATH")

        os.environ["ANKIMINER_MEDIA_DIR"] = str(self.media_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)

        init_db(self.db_path)
        self.client = TestClient(app)
        self.repo = CardRepository(self.db_path)
        self.media_service = MediaStorageService(self.media_dir)
        self.card_service = CardService(
            card_repository=self.repo,
            anki_service=AnkiConnectService()
        )

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

    def test_save_card_with_extracted_wav_audio(self):
        req = SaveCardRequest(
            expression="食べる",
            reading="たべる",
            meaning="to eat",
            example_sentence="リンゴを食べる。",
            audio=MINIMAL_WAV_DATA_URL
        )

        card = self.card_service.save_card(req)
        self.assertIsNotNone(card.id)
        self.assertTrue(card.audio.startswith("ankiminer_audio_"))
        self.assertTrue(card.audio.endswith(".wav"))

        # Verify physical file existence and content
        audio_path = self.media_service.get_media_path(card.audio)
        self.assertIsNotNone(audio_path)
        self.assertTrue(audio_path.is_file())
        self.assertEqual(audio_path.read_bytes(), MINIMAL_WAV_BYTES)

        # Verify SQLite record
        stored_card = self.repo.get_by_id(card.id)
        self.assertIsNotNone(stored_card)
        self.assertEqual(stored_card.audio, card.audio)

    def test_reopen_and_resave_card_preserves_audio_without_duplication(self):
        # 1. Save card with audio
        req = SaveCardRequest(
            expression="読む",
            reading="よむ",
            meaning="to read",
            example_sentence="本を読む。",
            audio=MINIMAL_WAV_DATA_URL
        )
        card1 = self.card_service.save_card(req)
        original_filename = card1.audio
        initial_media_files = list(self.media_dir.glob("ankiminer_audio_*.wav"))
        self.assertEqual(len(initial_media_files), 1)

        # 2. Re-save the card (e.g. user updated meaning/expression) with same audio filename
        req_update = SaveCardRequest(
            id=card1.id,
            expression="読む",
            reading="よむ",
            meaning="to read (updated)",
            example_sentence="本を読む。",
            audio=original_filename
        )
        card2 = self.card_service.save_card(req_update)
        self.assertEqual(card2.id, card1.id)
        self.assertEqual(card2.audio, original_filename)
        self.assertEqual(card2.meaning, "to read (updated)")

        # Verify no orphan or duplicate file was created
        media_files_after_resave = list(self.media_dir.glob("ankiminer_audio_*.wav"))
        self.assertEqual(len(media_files_after_resave), 1)
        self.assertEqual(media_files_after_resave[0].name, original_filename)

    def test_save_card_without_audio_succeeds_normally(self):
        req = SaveCardRequest(
            expression="走る",
            reading="はしる",
            meaning="to run",
            example_sentence="速く走る。",
            audio=""
        )
        card = self.card_service.save_card(req)
        self.assertIsNotNone(card.id)
        self.assertEqual(card.audio, "")

        stored = self.repo.get_by_id(card.id)
        self.assertEqual(stored.audio, "")


class TestStage4AnkiAudioFieldMapping(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.media_dir = Path(self.temp_dir.name) / "media"
        self.db_path = Path(self.temp_dir.name) / "test_stage4_anki.db"

        self.orig_media_env = os.environ.get("ANKIMINER_MEDIA_DIR")
        self.orig_db_env = os.environ.get("ANKIMINER_DB_PATH")

        os.environ["ANKIMINER_MEDIA_DIR"] = str(self.media_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)

        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)
        self.media_service = MediaStorageService(self.media_dir)
        self.anki_service = AnkiConnectService()
        self.card_service = CardService(
            card_repository=self.repo,
            anki_service=self.anki_service
        )

        # Write sample audio file
        self.audio_filename = self.media_service.save_media(MINIMAL_WAV_DATA_URL, media_type="audio", preferred_ext="wav")

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

    def test_model_capabilities_detects_various_audio_field_names(self):
        test_models = [
            (["Expression", "Reading", "Meaning", "SentenceAudio", "Notes"], True, "SentenceAudio"),
            (["VocabKanji", "VocabFurigana", "Sentence", "Audio"], True, "Audio"),
            (["Word", "Meaning", "Sound"], True, "Sound"),
            (["Kanji", "Kana", "WordAudio"], True, "WordAudio"),
            (["Front", "Back"], False, None),
        ]

        for field_names, expected_supports, expected_audio_field in test_models:
            with patch.object(self.anki_service, "get_model_field_names", return_value=field_names):
                caps = self.anki_service.get_model_capabilities("TestModel")
                self.assertEqual(caps["supports_audio"], expected_supports, f"Model with fields {field_names} supports_audio mismatch")
                self.assertEqual(caps["audio_field"], expected_audio_field, f"Model with fields {field_names} audio_field mismatch")

    def test_map_card_to_fields_attaches_sound_tag(self):
        field_names = ["Expression", "Reading", "Meaning", "Sentence", "SentenceAudio", "Notes"]
        card = {
            "expression": "聞く",
            "reading": "きく",
            "meaning": "to listen",
            "sentence": "音楽を聞く。",
            "audio": self.audio_filename
        }

        fields = self.anki_service.map_card_to_fields(card, field_names)
        self.assertIn("SentenceAudio", fields)
        self.assertEqual(fields["SentenceAudio"], f"[sound:{self.audio_filename}]")
        self.assertEqual(fields["Expression"], "聞く")

    def test_custom_model_without_audio_field_creates_note_without_error_or_misplaced_audio(self):
        field_names = ["Expression", "Reading", "Meaning", "Notes"]
        card = {
            "expression": "見る",
            "reading": "みる",
            "meaning": "to see",
            "sentence": "映画を見る。",
            "audio": self.audio_filename
        }

        with patch.object(self.anki_service, "get_model_field_names", return_value=field_names):
            caps = self.anki_service.get_model_capabilities("TextOnlyModel")
            self.assertFalse(caps["supports_audio"])
            self.assertIsNone(caps["audio_field"])

            fields = self.anki_service.map_card_to_fields(card, field_names)
            self.assertEqual(fields["Expression"], "見る")
            self.assertEqual(fields["Meaning"], "to see")
            # Audio must NOT be silently stuffed into Notes
            self.assertNotIn(f"[sound:{self.audio_filename}]", fields.get("Notes", ""))

    def test_sync_card_uploads_media_and_adds_note(self):
        saved = self.card_service.save_card(SaveCardRequest(
            expression="食べる",
            reading="たべる",
            meaning="to eat",
            example_sentence="ご飯を食べる。",
            audio=self.audio_filename,
            deck_name="Default",
            model_name="MiningModel"
        ))

        with patch.object(self.anki_service, "find_existing_note", return_value=None), \
             patch.object(self.anki_service, "get_model_names", return_value=["MiningModel"]), \
             patch.object(self.anki_service, "get_model_field_names", return_value=["Expression", "Reading", "Meaning", "Audio"]), \
             patch.object(self.anki_service, "store_media_file", return_value=self.audio_filename) as mock_store, \
             patch.object(self.anki_service, "add_note", return_value=1234567890) as mock_add_note:

            sync_res = self.card_service.sync_card(saved.id)

            self.assertEqual(sync_res.sync_status, "synced")
            self.assertEqual(sync_res.anki_note_id, 1234567890)
            mock_store.assert_called_once()
            self.assertEqual(mock_store.call_args.kwargs.get("filename") or mock_store.call_args[1].get("filename") or mock_store.call_args[0][0], self.audio_filename)

            mock_add_note.assert_called_once()
            note_payload = mock_add_note.call_args.kwargs.get("card_data") or mock_add_note.call_args[1].get("card_data") or mock_add_note.call_args[0][1]
            self.assertEqual(note_payload["audio"], self.audio_filename)

    def test_anki_connection_failure_preserves_card_and_marks_failed(self):
        saved = self.card_service.save_card(SaveCardRequest(
            expression="書く",
            reading="かく",
            meaning="to write",
            example_sentence="手紙を書く。",
            audio=self.audio_filename,
            deck_name="Default"
        ))

        with patch.object(self.anki_service, "find_existing_note", side_effect=AnkiConnectionError("Cannot connect to AnkiConnect")):
            sync_res = self.card_service.sync_card(saved.id)

            self.assertEqual(sync_res.sync_status, "failed")
            self.assertIn("Cannot connect to AnkiConnect", sync_res.error)

            # Local card in SQLite remains intact
            stored = self.repo.get_by_id(saved.id)
            self.assertIsNotNone(stored)
            self.assertEqual(stored.sync_status, "failed")
            self.assertEqual(stored.audio, self.audio_filename)
