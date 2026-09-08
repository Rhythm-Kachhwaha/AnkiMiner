"""The sole boundary for Yomitan's local HTTP API."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_YOMITAN_ENDPOINT = "http://127.0.0.1:19633"


class YomitanError(Exception):
    """A safe, application-level Yomitan failure."""


class YomitanUnavailableError(YomitanError):
    """Yomitan cannot be reached locally."""


class YomitanResponseError(YomitanError):
    """Yomitan returned an invalid or unusable response."""


@dataclass(frozen=True)
class IdentifiedTerm:
    expression: str
    reading: str


class YomitanService:
    """Normalizes Yomitan tokenization without exposing its payload upstream."""

    def __init__(self, endpoint: str | None = None, timeout_seconds: float = 3.0):
        self._endpoint = (endpoint or os.getenv("YOMITAN_ENDPOINT") or DEFAULT_YOMITAN_ENDPOINT).rstrip("/")
        self._timeout_seconds = timeout_seconds

    def identify(self, text: str) -> IdentifiedTerm:
        payload = {"text": text, "scanLength": 16, "parser": "scanning-parser"}
        return self.normalize_tokenize_response(self._post_json("/tokenize", payload))

    def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        request = Request(f"{self._endpoint}{path}", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise YomitanResponseError("Yomitan could not identify this selection.") from error
        except (URLError, TimeoutError) as error:
            raise YomitanUnavailableError("Yomitan is unavailable. Start Yomitan and try again.") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise YomitanResponseError("Yomitan returned an invalid response.") from error

    @staticmethod
    def normalize_tokenize_response(payload: Any) -> IdentifiedTerm:
        if not isinstance(payload, list):
            raise YomitanResponseError("Yomitan returned an invalid response.")
        for result in payload:
            if not isinstance(result, dict) or not isinstance(result.get("content"), list):
                continue
            for segment in result["content"]:
                if not isinstance(segment, list):
                    continue
                for token in segment:
                    if not isinstance(token, dict):
                        continue
                    expression, reading = token.get("text"), token.get("reading", "")
                    if isinstance(expression, str) and expression.strip() and isinstance(reading, str):
                        return IdentifiedTerm(expression=expression.strip(), reading=reading.strip())
        raise YomitanResponseError("Yomitan could not identify a Japanese term in this selection.")
