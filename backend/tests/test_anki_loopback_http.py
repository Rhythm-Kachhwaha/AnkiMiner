"""Live loopback HTTP integration test for AnkiConnectService against a mock AnkiConnect server."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import threading

import pytest

from app.services.anki_connect import (
    AnkiActionError,
    AnkiConnectionError,
    AnkiConnectService,
)


class MockAnkiConnectHandler(BaseHTTPRequestHandler):
    decks = ["Default", "Japanese::Core"]
    notes = {
        1001: {
            "noteId": 1001,
            "fields": {
                "Expression": {"value": "桜"},
                "Reading": {"value": "さくら"},
                "Meaning": {"value": "cherry blossom"},
            },
        }
    }
    created_notes = []

    def log_message(self, format, *args):
        pass  # Quiet logs during test

    def do_POST(self):
        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len)
        try:
            req = json.loads(post_data.decode("utf-8"))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        action = req.get("action")
        params = req.get("params", {})

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

        if action == "version":
            res = {"result": 6, "error": None}
        elif action == "deckNames":
            res = {"result": self.decks, "error": None}
        elif action == "createDeck":
            deck = params.get("deck")
            if deck not in self.decks:
                self.decks.append(deck)
            res = {"result": 12345, "error": None}
        elif action == "modelNames":
            res = {"result": ["Basic", "Japanese (mining)"], "error": None}
        elif action == "modelFieldNames":
            model = params.get("modelName")
            if model == "Basic":
                res = {"result": ["Front", "Back"], "error": None}
            else:
                res = {"result": ["Expression", "Reading", "Meaning"], "error": None}
        elif action == "findNotes":
            query = params.get("query", "")
            if "桜" in query:
                res = {"result": [1001], "error": None}
            else:
                res = {"result": [], "error": None}
        elif action == "notesInfo":
            ids = params.get("notes", [])
            info = [self.notes[i] for i in ids if i in self.notes]
            res = {"result": info, "error": None}
        elif action == "addNote":
            note = params.get("note", {})
            new_id = 2000 + len(self.created_notes) + 1
            self.created_notes.append(note)
            res = {"result": new_id, "error": None}
        elif action == "trigger_error":
            res = {"result": None, "error": "simulated anki error"}
        else:
            res = {"result": None, "error": f"unknown action {action}"}

        self.wfile.write(json.dumps(res).encode("utf-8"))


@pytest.fixture(scope="module")
def mock_anki_server():
    server = HTTPServer(("127.0.0.1", 0), MockAnkiConnectHandler)
    host, port = server.server_address
    url = f"http://{host}:{port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield url
    server.shutdown()


def test_real_http_version(mock_anki_server):
    service = AnkiConnectService(endpoint_url=mock_anki_server)
    version = service.get_version()
    assert version == 6


def test_real_http_decks(mock_anki_server):
    service = AnkiConnectService(endpoint_url=mock_anki_server)
    decks = service.list_decks()
    assert "Default" in decks
    assert "Japanese::Core" in decks


def test_real_http_duplicate_detection(mock_anki_server):
    service = AnkiConnectService(endpoint_url=mock_anki_server)
    # 桜 is in notes
    found_id = service.find_existing_note("Default", "桜", "さくら")
    assert found_id == 1001

    # 竹 is not in notes
    not_found = service.find_existing_note("Default", "竹", "たけ")
    assert not_found is None


def test_real_http_add_note(mock_anki_server):
    service = AnkiConnectService(endpoint_url=mock_anki_server)
    note_id = service.add_note(
        deck_name="Default",
        card_data={"expression": "松", "reading": "まつ", "meaning": "pine tree"},
    )
    assert note_id >= 2001


def test_real_http_connection_refused():
    # Connect to an unallocated port to test real connection refusal
    service = AnkiConnectService(endpoint_url="http://127.0.0.1:59999")
    with pytest.raises(AnkiConnectionError):
        service.get_version()


def test_real_http_action_error(mock_anki_server):
    service = AnkiConnectService(endpoint_url=mock_anki_server)
    with pytest.raises(AnkiActionError) as exc_info:
        service._invoke("trigger_error")
    assert "simulated anki error" in str(exc_info.value)
