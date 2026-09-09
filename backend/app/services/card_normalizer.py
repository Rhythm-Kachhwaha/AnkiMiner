"""Centralized normalization for Japanese card duplicate identity."""
from __future__ import annotations

import re
import unicodedata

DEFAULT_DECK_NAME = "Default"


def normalize_expression(expression: str) -> str:
    """Normalize Japanese expression for duplicate identity comparisons."""
    if not expression:
        return ""
    # Unicode NFC normalization unifies composite characters (e.g. kana with combining dakuten)
    normalized = unicodedata.normalize("NFC", expression)
    # Collapse full-width (\u3000) and standard ASCII whitespace
    normalized = re.sub(r"[\s\u3000]+", " ", normalized).strip()
    return normalized


def normalize_reading(reading: str) -> str:
    """Normalize Japanese reading (kana) for duplicate identity comparisons."""
    if not reading:
        return ""
    normalized = unicodedata.normalize("NFC", reading)
    normalized = re.sub(r"[\s\u3000]+", " ", normalized).strip()
    return normalized


def normalize_deck(deck_name: str | None) -> str:
    """Normalize deck name for duplicate identity comparisons."""
    if not deck_name:
        return DEFAULT_DECK_NAME
    cleaned = deck_name.strip()
    return cleaned if cleaned else DEFAULT_DECK_NAME


def get_duplicate_identity(expression: str, reading: str, deck_name: str | None = None) -> tuple[str, str, str]:
    """Return the locked duplicate identity tuple: (normalized_expression, normalized_reading, normalized_deck)."""
    return (
        normalize_expression(expression),
        normalize_reading(reading),
        normalize_deck(deck_name),
    )
