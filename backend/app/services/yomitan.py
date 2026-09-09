"""The sole boundary for Yomitan's local HTTP API."""
from __future__ import annotations

from dataclasses import dataclass, field
import json, os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_YOMITAN_ENDPOINT = "http://127.0.0.1:19633"
class YomitanError(Exception): pass
class YomitanUnavailableError(YomitanError): pass
class YomitanResponseError(YomitanError): pass

@dataclass(frozen=True)
class IdentifiedTerm:
    expression: str
    reading: str
    source_text: str
    deinflected_text: str
@dataclass(frozen=True)
class Example:
    japanese: str
    translation: str | None = None
@dataclass(frozen=True)
class Sense:
    glosses: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    examples: list[Example] = field(default_factory=list)
@dataclass(frozen=True)
class DictionaryEntry:
    dictionary: str
    is_primary: bool
    term: str
    reading: str
    parts_of_speech: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    senses: list[Sense] = field(default_factory=list)
@dataclass(frozen=True)
class EnrichedTerm:
    expression: str
    reading: str
    source_text: str
    deinflected_text: str
    entries: list[DictionaryEntry]
    dictionary_error: str | None = None

class YomitanService:
    def __init__(self, endpoint: str | None = None, timeout_seconds: float = 3.0):
        self._endpoint = (endpoint or os.getenv("YOMITAN_ENDPOINT") or DEFAULT_YOMITAN_ENDPOINT).rstrip("/")
        self._timeout_seconds = timeout_seconds

    def identify(self, text: str) -> IdentifiedTerm:
        return self.normalize_tokenize_response(self._post_json("/tokenize", {"text": text, "scanLength": 16, "parser": "scanning-parser"}), text)

    def enrich(self, term: IdentifiedTerm) -> EnrichedTerm:
        try:
            entries = self.normalize_term_entries_response(self._post_json("/termEntries", {"term": term.expression}))
            error = None if any(s.glosses for entry in entries for s in entry.senses) else "Dictionary returned no usable definitions."
            return EnrichedTerm(term.expression, term.reading, term.source_text, term.deinflected_text, entries, error)
        except YomitanError as error:
            return EnrichedTerm(term.expression, term.reading, term.source_text, term.deinflected_text, [], str(error))

    def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        request = Request(f"{self._endpoint}{path}", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response: return json.loads(response.read().decode())
        except HTTPError as error: raise YomitanResponseError("Yomitan returned an invalid dictionary response.") from error
        except (URLError, TimeoutError, OSError) as error: raise YomitanUnavailableError("Yomitan is unavailable. Start Yomitan and try again.") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error: raise YomitanResponseError("Yomitan returned an invalid response.") from error

    @staticmethod
    def normalize_tokenize_response(payload: Any, source_text: str = "") -> IdentifiedTerm:
        if not isinstance(payload, list): raise YomitanResponseError("Yomitan returned an invalid response.")
        first_text_fallback: IdentifiedTerm | None = None
        for result in payload:
            for segment in result.get("content", []) if isinstance(result, dict) else []:
                for token in segment if isinstance(segment, list) else []:
                    if not isinstance(token, dict): continue
                    headword = YomitanService._first_headword(token)
                    if headword:
                        term, reading, source, deinflected = headword
                        return IdentifiedTerm(term, reading, source or source_text.strip() or term, deinflected or term)
                    text, reading = token.get("text"), token.get("reading", "")
                    if first_text_fallback is None and isinstance(text, str) and text.strip() and isinstance(reading, str):
                        if any("\u3040" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff" or ch == "\u3005" for ch in text):
                            first_text_fallback = IdentifiedTerm(text.strip(), reading.strip(), source_text.strip() or text.strip(), text.strip())
        if first_text_fallback is not None:
            return first_text_fallback
        raise YomitanResponseError("Yomitan could not identify a Japanese term in this selection.")

    @staticmethod
    def _first_headword(token: dict[str, Any]) -> tuple[str, str, str, str] | None:
        for group in token.get("headwords", []) if isinstance(token.get("headwords"), list) else []:
            for headword in group if isinstance(group, list) else []:
                if not isinstance(headword, dict) or not isinstance(headword.get("term"), str): continue
                source = next((item for item in headword.get("sources", []) if isinstance(item, dict)), {})
                return (headword["term"].strip(), str(headword.get("reading", "")).strip(), str(source.get("originalText", "")).strip(), str(source.get("deinflectedText", "")).strip())
        return None

    @staticmethod
    def normalize_term_entries_response(payload: Any) -> list[DictionaryEntry]:
        raw_entries = payload.get("dictionaryEntries") if isinstance(payload, dict) else None
        if not isinstance(raw_entries, list): raise YomitanResponseError("Yomitan returned an invalid dictionary response.")
        normalized: list[DictionaryEntry] = []
        for raw in raw_entries:
            if not isinstance(raw, dict): continue
            headwords = raw.get("headwords") if isinstance(raw.get("headwords"), list) else []
            for definition in raw.get("definitions", []) if isinstance(raw.get("definitions"), list) else []:
                if not isinstance(definition, dict): continue
                term, reading = YomitanService._definition_headword(definition, headwords)
                senses, pos = YomitanService._definition_senses(definition)
                normalized.append(DictionaryEntry(str(definition.get("dictionaryAlias") or definition.get("dictionary") or "Unknown dictionary"), bool(raw.get("isPrimary") or definition.get("isPrimary")), term, reading, YomitanService._unique(pos), YomitanService._tag_names(definition.get("tags")), senses))
        return normalized

    @staticmethod
    def _definition_headword(definition: dict[str, Any], headwords: list[Any]) -> tuple[str, str]:
        indices = definition.get("headwordIndices") if isinstance(definition.get("headwordIndices"), list) else []
        for index in indices + list(range(len(headwords))):
            if isinstance(index, int) and 0 <= index < len(headwords) and isinstance(headwords[index], dict):
                item = headwords[index]; return str(item.get("term", "")), str(item.get("reading", ""))
        return "", ""

    @staticmethod
    def _definition_senses(definition: dict[str, Any]) -> tuple[list[Sense], list[str]]:
        senses, pos = [], []
        for item in definition.get("entries", []) if isinstance(definition.get("entries"), list) else []:
            content = item.get("content") if isinstance(item, dict) else item
            groups = YomitanService._find_marked(content, "sense-group")
            for group in groups:
                pos.extend(YomitanService._marked_texts(group, "part-of-speech-info"))
                for raw_sense in YomitanService._find_marked(group.get("content"), "sense"):
                    sense = YomitanService._normalize_sense(raw_sense)
                    if sense.glosses or sense.notes or sense.examples: senses.append(sense)
            if not groups:
                sense = YomitanService._normalize_sense({"content": content})
                if sense.glosses or sense.notes or sense.examples: senses.append(sense)
        return senses, pos

    @staticmethod
    def _normalize_sense(node: dict[str, Any]) -> Sense:
        content, glosses, notes, examples = node.get("content"), [], [], []
        for glossary in YomitanService._find_marked(content, "glossary"):
            values = glossary.get("content")
            for value in values if isinstance(values, list) else [values]:
                if text := YomitanService._plain_text(value): glosses.append(text)
        for marker in ("note", "see-also", "reference"):
            notes.extend(YomitanService._marked_texts(content, marker, contains=True))
        for raw in YomitanService._find_marked(content, "example-sentence", contains=True):
            japanese = YomitanService._first_marked_text(raw.get("content"), "example-sentence-a")
            translation = YomitanService._first_marked_text(raw.get("content"), "example-sentence-b")
            if japanese: examples.append(Example(japanese, translation or None))
        return Sense(YomitanService._unique(glosses), [], YomitanService._unique(notes), YomitanService._unique_examples(examples))

    @staticmethod
    def _find_marked(value: Any, marker: str, contains: bool = False) -> list[dict[str, Any]]:
        found = []
        if isinstance(value, list):
            for item in value: found.extend(YomitanService._find_marked(item, marker, contains))
        elif isinstance(value, dict):
            current = YomitanService._marker(value)
            if (marker in current) if contains else (current == marker): found.append(value)
            found.extend(YomitanService._find_marked(value.get("content"), marker, contains))
        return found
    @staticmethod
    def _marker(node: dict[str, Any]) -> str:
        data = node.get("data"); return str(data.get("content", "")).lower() if isinstance(data, dict) else ""
    @staticmethod
    def _marked_texts(value: Any, marker: str, contains: bool = False) -> list[str]:
        return [text for item in YomitanService._find_marked(value, marker, contains) if (text := YomitanService._plain_text(item.get("content")))]
    @staticmethod
    def _first_marked_text(value: Any, marker: str) -> str:
        texts = YomitanService._marked_texts(value, marker); return texts[0] if texts else ""
    @staticmethod
    def _plain_text(value: Any) -> str:
        if isinstance(value, str): return value.strip()
        if isinstance(value, list): return "".join(YomitanService._plain_text(item) for item in value).strip()
        if isinstance(value, dict): return "" if value.get("tag") == "rt" else YomitanService._plain_text(value.get("content"))
        return ""
    @staticmethod
    def _tag_names(value: Any) -> list[str]:
        return YomitanService._unique([str(item.get("name", "")) for item in value if isinstance(item, dict)]) if isinstance(value, list) else []
    @staticmethod
    def _unique(values: list[str]) -> list[str]: return list(dict.fromkeys(value for value in values if value.strip()))
    @staticmethod
    def _unique_examples(values: list[Example]) -> list[Example]: return list({(item.japanese, item.translation): item for item in values}.values())
