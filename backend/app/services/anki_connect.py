"""AnkiConnect service encapsulating all HTTP/JSON-RPC operations."""
from __future__ import annotations

import html
import json
import os
import re
import socket
from typing import Any
import urllib.error
import urllib.request

from app.services.card_normalizer import normalize_deck, normalize_expression, normalize_reading


def _clean_field_text(raw: str) -> str:
    """Strip HTML tags and unescape HTML entities from Anki field values."""
    if not raw:
        return ""
    cleaned = re.sub(r"<[^>]+>", "", raw)
    return html.unescape(cleaned).strip()


class AnkiError(Exception):
    """Base exception for AnkiConnect operations."""
    pass


class AnkiConnectionError(AnkiError):
    """Raised when AnkiConnect cannot be reached (e.g. connection refused)."""
    pass


class AnkiTimeoutError(AnkiError):
    """Raised when an AnkiConnect request times out."""
    pass


class AnkiResponseError(AnkiError):
    """Raised when AnkiConnect returns invalid or unparseable JSON/shape."""
    pass


class AnkiActionError(AnkiError):
    """Raised when AnkiConnect returns an error field in the JSON-RPC response."""
    pass


DEFAULT_ANKICONNECT_URL = "http://127.0.0.1:8765"


class AnkiConnectService:
    """Encapsulates all AnkiConnect HTTP communication and note mapping."""

    def __init__(self, endpoint_url: str | None = None, timeout_seconds: float = 5.0):
        self.endpoint_url = endpoint_url or os.getenv("ANKICONNECT_URL", DEFAULT_ANKICONNECT_URL)
        self.timeout_seconds = timeout_seconds

    def _invoke(self, action: str, **params: Any) -> Any:
        """Send a JSON-RPC request to AnkiConnect."""
        payload = {
            "action": action,
            "version": 6,
            "params": params,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint_url,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw_bytes = response.read()
        except urllib.error.HTTPError as error:
            try:
                body = error.read().decode("utf-8")
                parsed = json.loads(body)
                if isinstance(parsed, dict) and parsed.get("error"):
                    raise AnkiActionError(f"AnkiConnect error on '{action}': {parsed['error']}") from error
            except (ValueError, UnicodeDecodeError):
                pass
            raise AnkiResponseError(f"HTTP {error.code} error from AnkiConnect: {error.reason}") from error
        except (urllib.error.URLError, socket.error) as error:
            reason = getattr(error, "reason", error)
            if isinstance(reason, socket.timeout) or "timed out" in str(reason).lower():
                raise AnkiTimeoutError(f"AnkiConnect timed out on '{action}': {reason}") from error
            raise AnkiConnectionError(f"Cannot connect to AnkiConnect at {self.endpoint_url}: {reason}") from error
        except TimeoutError as error:
            raise AnkiTimeoutError(f"AnkiConnect timed out on '{action}': {error}") from error
        except Exception as error:
            raise AnkiError(f"Unexpected error communicating with AnkiConnect: {error}") from error

        try:
            body_text = raw_bytes.decode("utf-8")
            parsed = json.loads(body_text)
        except (ValueError, UnicodeDecodeError) as error:
            raise AnkiResponseError(f"Malformed JSON response from AnkiConnect: {error}") from error

        if not isinstance(parsed, dict):
            raise AnkiResponseError(f"Unexpected response shape from AnkiConnect: expected dict, got {type(parsed).__name__}")

        if "error" not in parsed:
            raise AnkiResponseError("AnkiConnect response missing 'error' field.")

        if parsed["error"] is not None:
            raise AnkiActionError(f"AnkiConnect error on '{action}': {parsed['error']}")

        return parsed.get("result")

    def get_version(self) -> int | str:
        """Return the AnkiConnect API version."""
        result = self._invoke("version")
        if result is None:
            raise AnkiResponseError("AnkiConnect returned empty version.")
        return result

    def is_connected(self) -> tuple[bool, str | None]:
        """Check if AnkiConnect is reachable. Returns (connected, error_message)."""
        try:
            self.get_version()
            return True, None
        except Exception as error:
            return False, str(error)

    def list_decks(self) -> list[str]:
        """Retrieve the list of existing deck names."""
        result = self._invoke("deckNames")
        if not isinstance(result, list):
            raise AnkiResponseError(f"Expected list of deck names, got {type(result).__name__}")
        return [str(d) for d in result]

    def create_deck(self, deck_name: str) -> None:
        """Create a deck if it does not already exist."""
        clean_deck = deck_name.strip() or "Default"
        self._invoke("createDeck", deck=clean_deck)

    def get_model_names(self) -> list[str]:
        """Retrieve all note model names in Anki."""
        result = self._invoke("modelNames")
        if not isinstance(result, list):
            raise AnkiResponseError(f"Expected list of model names, got {type(result).__name__}")
        return [str(m) for m in result]

    def get_model_field_names(self, model_name: str) -> list[str]:
        """Retrieve field names for a specific note model."""
        result = self._invoke("modelFieldNames", modelName=model_name)
        if not isinstance(result, list):
            raise AnkiResponseError(f"Expected list of field names for model '{model_name}', got {type(result).__name__}")
        return [str(f) for f in result]

    def find_existing_note(self, deck_name: str, expression: str, reading: str = "") -> int | None:
        """
        Query AnkiConnect for notes in the deck matching normalized expression and reading.
        Uses findNotes to retrieve candidates, then notesInfo to inspect actual fields.
        Safely escapes user input to avoid query injection.
        """
        norm_target_expr = normalize_expression(expression)
        norm_target_read = normalize_reading(reading)

        # Sanitize deck and expression for query: strip quotes and backslashes
        safe_deck = deck_name.replace('"', '\\"').replace("'", "")
        # Search candidates in deck with expression token
        safe_term = expression.strip().replace('"', '\\"').replace("'", "").replace("*", "")

        # Guard: if expression is empty after sanitization, we cannot identify any
        # specific note. Issuing a bare deck query would match every note in the deck
        # and could produce false positives. Return None immediately.
        if not safe_term:
            return None

        query = f'deck:"{safe_deck}" "{safe_term}"'

        candidate_ids = self._invoke("findNotes", query=query)
        if not isinstance(candidate_ids, list) or not candidate_ids:
            return None

        # Inspect candidates in chunks (max 50)
        note_infos = self._invoke("notesInfo", notes=candidate_ids[:50])
        if not isinstance(note_infos, list):
            return None

        for note in note_infos:
            if not isinstance(note, dict):
                continue

            # Optional deck validation if note includes deckName
            if "deckName" in note and note["deckName"]:
                if normalize_deck(note["deckName"]) != normalize_deck(deck_name):
                    continue

            fields = note.get("fields", {})
            # Look for expression and reading in field values
            found_expr = ""
            found_read = ""
            for field_name, field_dict in fields.items():
                raw_val = field_dict.get("value", "") if isinstance(field_dict, dict) else str(field_dict)
                val = _clean_field_text(raw_val)
                lower_name = field_name.lower().replace(" ", "").replace("_", "")
                if lower_name in ("expression", "japanese", "word", "front", "kanji"):
                    if not found_expr or lower_name in ("expression", "japanese", "word"):
                        found_expr = val
                elif lower_name in ("reading", "furigana", "kana"):
                    found_read = val

            if not found_expr:
                continue

            # Check matching expression: direct match or bracketed reading (e.g. Basic model "映画 [えいが]")
            expr_matched = False
            extracted_reading = ""

            if normalize_expression(found_expr) == norm_target_expr:
                expr_matched = True
            else:
                base_expr = re.sub(r"\[[^\]]+\]", "", found_expr).strip()
                if normalize_expression(base_expr) == norm_target_expr:
                    expr_matched = True
                    brackets = re.findall(r"\[([^\]]+)\]", found_expr)
                    extracted_reading = "".join(brackets).strip()

            if not expr_matched:
                continue

            effective_read = found_read or extracted_reading
            # If reading is present in both, compare reading
            if norm_target_read and effective_read:
                if normalize_reading(effective_read) == norm_target_read:
                    return int(note["noteId"])
            else:
                return int(note["noteId"])

        return None

    def _model_supports_card(self, field_names: list[str]) -> bool:
        """Check if model fields contain at least one prompt field and one answer field."""
        fields_clean = {f.lower().replace(" ", "").replace("_", "") for f in field_names}
        has_prompt = bool(fields_clean.intersection({"front", "expression", "word", "japanese", "kanji"}))
        has_answer = bool(fields_clean.intersection({"back", "meaning", "definition", "glossary", "english"}))
        return has_prompt and has_answer

    def resolve_note_model(self) -> tuple[str, list[str]]:
        """
        Determine the note model to use.
        1. Check ANKI_NOTE_MODEL environment override if configured.
        2. Prefer models containing 'mining' or 'vocab' that support card fields.
        3. Check 'Basic' if available.
        4. Check any available model with 'japanese' that supports card fields.
        5. Fallback to any model supporting card fields, or 'Basic', or first available.
        """
        available = self.get_model_names()
        if not available:
            raise AnkiActionError("No note models available in Anki.")

        # 1. Environment override
        env_model = os.getenv("ANKI_NOTE_MODEL")
        if env_model and env_model in available:
            return env_model, self.get_model_field_names(env_model)

        # 2. Prefer mining/vocab models that support cards
        for name in available:
            lower = name.lower()
            if any(k in lower for k in ("mining", "vocab")):
                fields = self.get_model_field_names(name)
                if self._model_supports_card(fields):
                    return name, fields

        # 3. Check Basic
        if "Basic" in available:
            fields = self.get_model_field_names("Basic")
            if self._model_supports_card(fields):
                return "Basic", fields

        # 4. Check other Japanese models supporting cards
        for name in available:
            if "japanese" in name.lower():
                fields = self.get_model_field_names(name)
                if self._model_supports_card(fields):
                    return name, fields

        # 5. Check any model supporting cards
        for name in available:
            fields = self.get_model_field_names(name)
            if self._model_supports_card(fields):
                return name, fields

        if "Basic" in available:
            return "Basic", self.get_model_field_names("Basic")

        first = available[0]
        fields = self.get_model_field_names(first)
        return first, fields

    def map_card_to_fields(self, card: dict[str, Any], model_fields: list[str]) -> dict[str, str]:
        """
        Deterministically map card fields to the model's fields.
        Supports standard Japanese fields as well as Basic (Front/Back).
        """
        field_map: dict[str, str] = {}
        fields_lower = {f.lower().replace(" ", "").replace("_", ""): f for f in model_fields}

        expr = card.get("expression", "")
        reading = card.get("reading", "")
        meaning = card.get("meaning", "")
        hint = card.get("hint", "")
        example = card.get("example_sentence", "")
        example_trans = card.get("example_translation", "")
        notes = card.get("notes", "")

        # Check if model is standard Front/Back (Basic)
        if "front" in fields_lower and "back" in fields_lower:
            front_field = fields_lower["front"]
            back_field = fields_lower["back"]
            # Front
            if reading and reading != expr:
                field_map[front_field] = f"{expr} [{reading}]"
            else:
                field_map[front_field] = expr
            # Back
            back_parts = []
            if meaning:
                back_parts.append(meaning)
            if hint:
                back_parts.append(f"Hint: {hint}")
            if example:
                if example_trans:
                    back_parts.append(f"{example}<br>{example_trans}")
                else:
                    back_parts.append(example)
            if notes:
                back_parts.append(f"Notes: {notes}")
            field_map[back_field] = "<br><br>".join(back_parts)

            # Populate additional fields if present in model
            if "word" in fields_lower and expr:
                field_map[fields_lower["word"]] = expr
            if "reading" in fields_lower and reading:
                field_map[fields_lower["reading"]] = reading
            if "audio" in fields_lower and card.get("audio"):
                field_map[fields_lower["audio"]] = card["audio"]
            if "image" in fields_lower and card.get("image"):
                field_map[fields_lower["image"]] = card["image"]

            return field_map

        # Specialized or multi-field model: match fields deterministically
        def assign(keys: tuple[str, ...], value: str) -> None:
            if not value:
                return
            for k in keys:
                if k in fields_lower:
                    real_name = fields_lower[k]
                    if real_name not in field_map:
                        field_map[real_name] = value
                        return

        assign(("expression", "japanese", "word", "front", "kanji"), expr)
        assign(("reading", "furigana", "kana"), reading)
        assign(("meaning", "glossary", "english", "definition", "back"), meaning)
        assign(("hint",), hint)
        assign(("examplesentence", "example", "sentence"), example)
        assign(("exampletranslation", "translation"), example_trans)
        assign(("notes", "note"), notes)
        assign(("image", "picture"), card.get("image", ""))
        assign(("audio", "sound"), card.get("audio", ""))

        # Ensure at least the first model field is populated
        if model_fields and model_fields[0] not in field_map:
            field_map[model_fields[0]] = expr

        return field_map

    def add_note(
        self,
        deck_name: str,
        card_data: dict[str, Any],
        tags: list[str] | None = None,
    ) -> int:
        """
        Add a note to AnkiConnect in the specified deck.
        Creates deck if missing, resolves note model, maps fields, and creates note.
        Returns the new note ID.
        """
        clean_deck = deck_name.strip() or "Default"
        self.create_deck(clean_deck)

        model_name, model_fields = self.resolve_note_model()
        mapped_fields = self.map_card_to_fields(card_data, model_fields)

        note_payload = {
            "deckName": clean_deck,
            "modelName": model_name,
            "fields": mapped_fields,
            "options": {
                "allowDuplicate": False,
                "duplicateScope": "deck",
            },
            "tags": tags or [],
        }

        note_id = self._invoke("addNote", note=note_payload)
        if not note_id or not isinstance(note_id, int):
            raise AnkiActionError(f"AnkiConnect returned invalid note id: {note_id}")
        return int(note_id)
