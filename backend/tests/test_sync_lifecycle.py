"""Integration tests for Anki synchronization lifecycle, duplicate prevention, and deck configuration."""
import os
from pathlib import Path
import sqlite3
import tempfile
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from app.db.connection import db_session, init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiConnectionError, AnkiConnectService
from app.services.card_service import CardService


@pytest.fixture
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db_path = Path(path)
    init_db(db_path)
    yield db_path
    if db_path.exists():
        try:
            db_path.unlink()
        except PermissionError:
            pass


class TestSyncLifecycle:
    def test_migration_preserves_existing_cards_and_defaults_sync_status(self, temp_db):
        """Verify schema migration adds sync columns to existing tables and defaults to pending."""
        # Create a database with old Phase 3.3 schema
        fd, old_path_str = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        old_db_path = Path(old_path_str)

        old_schema = """
        CREATE TABLE cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expression TEXT NOT NULL,
            reading TEXT NOT NULL,
            meaning TEXT NOT NULL DEFAULT '',
            hint TEXT NOT NULL DEFAULT '',
            example_sentence TEXT NOT NULL DEFAULT '',
            example_translation TEXT NOT NULL DEFAULT '',
            image TEXT NOT NULL DEFAULT '',
            audio TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            source_text TEXT NOT NULL DEFAULT '',
            deinflected_text TEXT NOT NULL DEFAULT '',
            deck_name TEXT NOT NULL DEFAULT 'Default',
            normalized_expression TEXT NOT NULL,
            normalized_reading TEXT NOT NULL,
            normalized_deck_name TEXT NOT NULL,
            meanings_json TEXT NOT NULL DEFAULT '[]',
            examples_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'saved',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(normalized_expression, normalized_reading, normalized_deck_name)
        );
        """
        conn = sqlite3.connect(str(old_db_path))
        conn.executescript(old_schema)
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading, normalized_deck_name,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("猫", "ねこ", "猫", "ねこ", "default", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
        )
        conn.commit()
        conn.close()

        # Run init_db migration
        init_db(old_db_path)

        repo = CardRepository(old_db_path)
        card = repo.get_by_id(1)
        assert card is not None
        assert card.expression == "猫"
        assert card.sync_status == "pending"
        assert card.model_name == ""
        assert card.anki_note_id is None
        assert card.sync_error == ""
        assert card.synced_at is None

        if old_db_path.exists():
            try:
                old_db_path.unlink()
            except PermissionError:
                pass

    def test_repository_sync_transitions(self, temp_db):
        repo = CardRepository(temp_db)
        card, is_new, _, _ = repo.save_or_update(CardDraft(expression="本", reading="ほん"))
        assert is_new
        assert card.sync_status == "pending"

        # Mark syncing
        syncing = repo.mark_syncing(card.id)
        assert syncing.sync_status == "syncing"

        # Mark failed
        failed = repo.mark_failed(card.id, "Anki unreachable")
        assert failed.sync_status == "failed"
        assert failed.sync_error == "Anki unreachable"

        # Pending or failed query includes this card
        pending_or_failed = repo.get_pending_or_failed_cards()
        assert any(c.id == card.id for c in pending_or_failed)

        # Mark synced
        synced = repo.mark_synced(card.id, 999888)
        assert synced.sync_status == "synced"
        assert synced.anki_note_id == 999888
        assert synced.sync_error == ""
        assert synced.synced_at is not None

        # No longer in pending or failed
        pending_or_failed_after = repo.get_pending_or_failed_cards()
        assert not any(c.id == card.id for c in pending_or_failed_after)

    def test_local_save_succeeds_even_when_anki_is_offline(self, temp_db):
        """Invariant: SQLite persistence succeeds independently of Anki availability."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (False, "Connection refused")
        mock_anki.add_note.side_effect = AnkiConnectionError("Connection refused")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="川", reading="かわ", meaning="river"))

        assert saved.id is not None
        assert saved.expression == "川"
        assert saved.sync_status == "pending"
        # Confirm it exists in SQLite
        card_in_db = repo.get_by_id(saved.id)
        assert card_in_db is not None
        assert card_in_db.expression == "川"

    def test_sync_card_marks_synced_on_success(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 12345

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="山", reading="やま", meaning="mountain"))

        sync_result = service.sync_card(saved.id)
        assert sync_result.sync_status == "synced"
        assert sync_result.anki_note_id == 12345

        # Verify SQLite row was updated
        in_db = repo.get_by_id(saved.id)
        assert in_db.sync_status == "synced"
        assert in_db.anki_note_id == 12345
        assert in_db.synced_at is not None

    def test_sync_card_marks_failed_and_preserves_card_on_anki_error(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.find_existing_note.side_effect = AnkiConnectionError("Connection refused")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="海", reading="うみ", meaning="sea"))

        sync_result = service.sync_card(saved.id)
        assert sync_result.sync_status == "failed"
        assert "Connection refused" in sync_result.error

        # Verify SQLite row was NOT rolled back, and marked failed
        in_db = repo.get_by_id(saved.id)
        assert in_db is not None
        assert in_db.expression == "海"
        assert in_db.sync_status == "failed"
        assert "Connection refused" in in_db.sync_error

    def test_duplicate_anki_note_prevention(self, temp_db):
        """If note already exists in Anki, link its anki_note_id and do NOT call add_note."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.find_existing_note.return_value = 777666  # Already exists in Anki

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="空", reading="そら", meaning="sky"))

        sync_result = service.sync_card(saved.id)
        assert sync_result.sync_status == "synced"
        assert sync_result.anki_note_id == 777666
        # Must not have called add_note
        mock_anki.add_note.assert_not_called()

        in_db = repo.get_by_id(saved.id)
        assert in_db.anki_note_id == 777666
        assert in_db.sync_status == "synced"

    def test_already_synced_card_not_recreated(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="木", reading="き", meaning="tree"))
        repo.mark_synced(saved.id, 555444)

        sync_result = service.sync_card(saved.id)
        assert sync_result.sync_status == "synced"
        assert sync_result.anki_note_id == 555444
        # Neither search nor add should be called for already synced card
        mock_anki.find_existing_note.assert_not_called()
        mock_anki.add_note.assert_not_called()

    def test_retry_after_failure_succeeds(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.find_existing_note.side_effect = AnkiConnectionError("Timeout")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="花", reading="はな", meaning="flower"))

        # First attempt fails
        fail_result = service.sync_card(saved.id)
        assert fail_result.sync_status == "failed"

        # Second attempt recovers
        mock_anki.find_existing_note.side_effect = None
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 888111

        recover_result = service.sync_card(saved.id)
        assert recover_result.sync_status == "synced"
        assert recover_result.anki_note_id == 888111

        in_db = repo.get_by_id(saved.id)
        assert in_db.sync_status == "synced"
        assert in_db.anki_note_id == 888111
        assert in_db.sync_error == ""

    def test_api_endpoints_status_decks_and_sync(self, temp_db):
        client = TestClient(app)

        with patch("app.main.init_db"):
            # Set ANKIMINER_DB_PATH to temp_db
            with patch.dict(os.environ, {"ANKIMINER_DB_PATH": str(temp_db)}):
                # 1. Status endpoint with Anki unavailable
                with patch("app.services.card_service.AnkiConnectService.is_connected", return_value=(False, "Connection refused")):
                    resp = client.get("/api/anki/status")
                    assert resp.status_code == 200
                    data = resp.json()
                    assert data["connected"] is False
                    assert "Connection refused" in data["error"]

                # 2. Decks endpoint with Anki unavailable falls back to Default
                with patch("app.services.card_service.AnkiConnectService.list_decks", side_effect=AnkiConnectionError("Refused")):
                    resp = client.get("/api/anki/decks")
                    assert resp.status_code == 200
                    data = resp.json()
                    assert "Default" in data["decks"]
                    assert data["connected"] is False

                # 2b. Models endpoint with Anki unavailable falls back to Basic
                with patch("app.services.card_service.AnkiConnectService.get_model_names", side_effect=AnkiConnectionError("Refused")):
                    resp = client.get("/api/anki/models")
                    assert resp.status_code == 200
                    data = resp.json()
                    assert data["models"] == ["Basic"]
                    assert data["connected"] is False

                # 3. Decks endpoint with Anki available
                with patch("app.services.card_service.AnkiConnectService.list_decks", return_value=["Default", "MiningDeck"]):
                    resp = client.get("/api/anki/decks")
                    assert resp.status_code == 200
                    data = resp.json()
                    assert data["decks"] == ["Default", "MiningDeck"]
                    assert data["connected"] is True

                # 3b. Models endpoint with Anki available
                with patch("app.services.card_service.AnkiConnectService.get_model_names", return_value=["Basic", "Japanese (mining)"]):
                    resp = client.get("/api/anki/models")
                    assert resp.status_code == 200
                    data = resp.json()
                    assert data["models"] == ["Basic", "Japanese (mining)"]
                    assert data["connected"] is True

                # 4. Save card via API
                save_resp = client.post(
                    "/api/cards/save",
                    json={"expression": "雨", "reading": "あめ", "meaning": "rain", "deck_name": "MiningDeck"},
                )
                assert save_resp.status_code == 200
                card_id = save_resp.json()["id"]

                # 5. Sync card via API
                with patch("app.services.card_service.AnkiConnectService.find_existing_note", return_value=None), \
                     patch("app.services.card_service.AnkiConnectService.add_note", return_value=999111):
                    sync_resp = client.post(f"/api/cards/{card_id}/sync")
                    assert sync_resp.status_code == 200
                    sync_data = sync_resp.json()
                    assert sync_data["sync_status"] == "synced"
                    assert sync_data["anki_note_id"] == 999111
                    assert sync_data["deck_name"] == "MiningDeck"

                # 6. Non-existent card returns 404
                not_found_resp = client.post("/api/cards/999999/sync")
                assert not_found_resp.status_code == 404

    def test_sync_card_with_explicit_model_name_uses_that_model(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 554433

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(
            expression="約束",
            reading="やくそく",
            meaning="promise",
            model_name="Mining Japanese Vocab",
        ))
        assert saved.model_name == "Mining Japanese Vocab"

        sync_result = service.sync_card(saved.id)
        assert sync_result.sync_status == "synced"
        assert sync_result.anki_note_id == 554433
        assert sync_result.model_name == "Mining Japanese Vocab"

        # Assert add_note was called with explicit model_name
        mock_anki.add_note.assert_called_once()
        _, kwargs = mock_anki.add_note.call_args
        assert kwargs["model_name"] == "Mining Japanese Vocab"

    def test_sync_card_without_model_name_uses_none_for_automatic_resolution(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 112233

        service = CardService(card_repository=repo, anki_service=mock_anki)
        # Card with no model_name (default empty string)
        saved = service.save_card(SaveCardRequest(
            expression="月",
            reading="つき",
            meaning="moon",
        ))
        assert saved.model_name == ""

        sync_result = service.sync_card(saved.id)
        assert sync_result.sync_status == "synced"
        assert sync_result.anki_note_id == 112233

        # Assert add_note was called with model_name=None so automatic resolution triggers
        mock_anki.add_note.assert_called_once()
        _, kwargs = mock_anki.add_note.call_args
        assert kwargs["model_name"] is None

    def test_card_service_get_anki_models_connected(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.get_model_names.return_value = ["Basic", "Japanese Vocab"]

        service = CardService(card_repository=repo, anki_service=mock_anki)
        res = service.get_anki_models()
        assert res.connected is True
        assert res.models == ["Basic", "Japanese Vocab"]

    def test_card_service_get_anki_models_offline_fallback(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.get_model_names.side_effect = AnkiConnectionError("Connection refused")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        res = service.get_anki_models()
        assert res.connected is False
        assert res.models == ["Basic"]

    def test_phase6_end_to_end_note_model_workflow(self, temp_db):
        """End-to-end Phase 6 verification: discover note models -> save with model -> sync to Anki."""
        client = TestClient(app)

        with patch("app.main.init_db"):
            with patch.dict(os.environ, {"ANKIMINER_DB_PATH": str(temp_db)}):
                # 1. Discover models via API
                with patch("app.services.card_service.AnkiConnectService.get_model_names", return_value=["Basic", "Japanese Mining Note"]):
                    model_resp = client.get("/api/anki/models")
                    assert model_resp.status_code == 200
                    models = model_resp.json()["models"]
                    assert "Japanese Mining Note" in models

                # 2. Save card with selected model
                save_resp = client.post(
                    "/api/cards/save",
                    json={
                        "expression": "約束",
                        "reading": "やくそく",
                        "meaning": "promise",
                        "deck_name": "Japanese",
                        "model_name": "Japanese Mining Note",
                    },
                )
                assert save_resp.status_code == 200
                card_data = save_resp.json()
                assert card_data["model_name"] == "Japanese Mining Note"
                card_id = card_data["id"]

                # 3. Synchronize card to Anki
                with patch("app.services.card_service.AnkiConnectService.find_existing_note", return_value=None), \
                     patch("app.services.card_service.AnkiConnectService.add_note", return_value=777888) as mock_add_note:
                    sync_resp = client.post(f"/api/cards/{card_id}/sync")
                    assert sync_resp.status_code == 200
                    sync_data = sync_resp.json()
                    assert sync_data["sync_status"] == "synced"
                    assert sync_data["anki_note_id"] == 777888
                    assert sync_data["model_name"] == "Japanese Mining Note"

                    # Verify exact model_name was forwarded to add_note
                    mock_add_note.assert_called_once()
                    _, kwargs = mock_add_note.call_args
                    assert kwargs["model_name"] == "Japanese Mining Note"
