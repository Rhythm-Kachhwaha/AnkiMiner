"""Unit tests for AnkiConnectService."""
import json
from unittest.mock import MagicMock, patch
import urllib.error

import pytest

from app.services.anki_connect import (
    AnkiActionError,
    AnkiConnectionError,
    AnkiConnectService,
    AnkiError,
    AnkiResponseError,
    AnkiTimeoutError,
)


def _make_mock_response(status=200, json_data=None, raw_bytes=None):
    mock = MagicMock()
    mock.status = status
    if raw_bytes is not None:
        mock.read.return_value = raw_bytes
    elif json_data is not None:
        mock.read.return_value = json.dumps(json_data).encode("utf-8")
    else:
        mock.read.return_value = b'{"result": null, "error": null}'
    return mock


class TestAnkiConnectService:
    def test_version_request_success(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": 6, "error": None})
            version = service.get_version()
            assert version == 6

    def test_list_decks_success(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": ["Default", "Japanese::Mining"], "error": None})
            decks = service.list_decks()
            assert decks == ["Default", "Japanese::Mining"]

    def test_create_deck_success(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": 123456789, "error": None})
            service.create_deck("Japanese")
            assert mock_open.called

    def test_connection_refused_raises_anki_connection_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("[WinError 10061] No connection could be made")):
            with pytest.raises(AnkiConnectionError) as exc_info:
                service.get_version()
            assert "Cannot connect to AnkiConnect" in str(exc_info.value)

    def test_timeout_raises_anki_timeout_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen", side_effect=TimeoutError("The read operation timed out")):
            with pytest.raises(AnkiTimeoutError) as exc_info:
                service.get_version()
            assert "timed out" in str(exc_info.value)

    def test_malformed_json_raises_anki_response_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(raw_bytes=b"invalid json")
            with pytest.raises(AnkiResponseError) as exc_info:
                service.get_version()
            assert "Malformed JSON" in str(exc_info.value)

    def test_anki_error_response_raises_anki_action_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": None, "error": "deck was not found"})
            with pytest.raises(AnkiActionError) as exc_info:
                service.list_decks()
            assert "deck was not found" in str(exc_info.value)

    def test_find_existing_note_match(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [101, 102]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 101,
                        "fields": {
                            "Front": {"value": "食べる"},
                            "Back": {"value": "to eat"},
                        },
                    },
                    {
                        "noteId": 102,
                        "fields": {
                            "Expression": {"value": "飲む"},
                            "Reading": {"value": "のむ"},
                        },
                    },
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "飲む", "のむ")
            assert found_id == 102

            # Different expression
            not_found = service.find_existing_note("Default", "走る", "はしる")
            assert not_found is None

    def test_find_existing_note_safe_escaping(self):
        service = AnkiConnectService()
        captured_query = []
        def mock_invoke(action, **params):
            if action == "findNotes":
                captured_query.append(params.get("query"))
                return []
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            service.find_existing_note('My "Deck"', '日本"語*')
            assert len(captured_query) == 1
            # Verify quotes are escaped and asterisks stripped
            assert r'deck:"My \"Deck\""' in captured_query[0]
            assert r'"日本\"語"' in captured_query[0]

    def test_find_existing_note_empty_expression_returns_none_without_query(self):
        """Empty expression must return None immediately; must NOT issue a bare deck query
        that would match every note in the deck and create false positives."""
        service = AnkiConnectService()
        invoke_calls = []
        def mock_invoke(action, **params):
            invoke_calls.append(action)
            return []

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            result = service.find_existing_note("Default", "")
            assert result is None
            assert "findNotes" not in invoke_calls, "Must not call findNotes with empty expression"

            # "*'" -> all special chars stripped -> empty safe_term
            result2 = service.find_existing_note("Default", "'*'")
            assert result2 is None
            assert "findNotes" not in invoke_calls, "Must not call findNotes when expression reduces to empty after sanitization"

    def test_deterministic_basic_model_mapping(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "hint": "cinema",
            "example_sentence": "映画を見る",
            "example_translation": "watch a movie",
            "notes": "common word",
        }
        fields = service.map_card_to_fields(card_data, ["Front", "Back"])
        assert "Front" in fields
        assert fields["Front"] == "映画 [えいが]"
        assert "Back" in fields
        assert "movie" in fields["Back"]
        assert "Hint: cinema" in fields["Back"]
        assert "映画を見る" in fields["Back"]
        assert "watch a movie" in fields["Back"]

    def test_deterministic_japanese_model_mapping(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "hint": "cinema",
            "example_sentence": "映画を見る",
            "example_translation": "watch a movie",
        }
        fields = service.map_card_to_fields(
            card_data,
            ["Expression", "Reading", "Meaning", "Hint", "Example Sentence", "Example Translation"],
        )
        assert fields["Expression"] == "映画"
        assert fields["Reading"] == "えいが"
        assert fields["Meaning"] == "movie"
        assert fields["Hint"] == "cinema"
        assert fields["Example Sentence"] == "映画を見る"
        assert fields["Example Translation"] == "watch a movie"

    def test_add_note_success(self):
        service = AnkiConnectService()
        with patch.object(service, "create_deck"), \
             patch.object(service, "resolve_note_model", return_value=("Basic", ["Front", "Back"])), \
             patch.object(service, "_invoke", return_value=1234567):
            note_id = service.add_note("Default", {"expression": "犬", "meaning": "dog"})
            assert note_id == 1234567

    def test_find_existing_note_basic_model_with_bracketed_reading(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [201]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 201,
                        "fields": {
                            "Front": {"value": "映画 [えいが]"},
                            "Back": {"value": "movie"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "映画", "えいが")
            assert found_id == 201

    def test_find_existing_note_html_formatted_fields(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [301]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 301,
                        "fields": {
                            "Front": {"value": "<div>映画&nbsp;[えいが]</div>"},
                            "Back": {"value": "<b>movie</b>"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "映画", "えいが")
            assert found_id == 301

    def test_find_existing_note_homonym_different_reading_rejected(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [401]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 401,
                        "fields": {
                            "Front": {"value": "角 [かど]"},
                            "Back": {"value": "corner"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            # Target is 角 with reading つの (horn)
            found_id = service.find_existing_note("Default", "角", "つの")
            assert found_id is None

    def test_find_existing_note_different_deck_skipped(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [501]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 501,
                        "deckName": "OtherDeck",
                        "fields": {
                            "Expression": {"value": "本"},
                            "Reading": {"value": "ほん"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "本", "ほん")
            assert found_id is None
