from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CaptureRequest(BaseModel):
    """Untrusted text captured from the active webpage."""

    text: str = Field(max_length=500)

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Capture text must not be empty.")
        return normalized


class Example(BaseModel):
    japanese: str
    translation: Optional[str] = None


class Sense(BaseModel):
    glosses: list[str] = []
    tags: list[str] = []
    notes: list[str] = []
    examples: list[Example] = []


class DictionaryEntry(BaseModel):
    dictionary: str
    is_primary: bool = False
    term: str
    reading: str = ""
    parts_of_speech: list[str] = []
    tags: list[str] = []
    senses: list[Sense] = []


class CaptureResponse(BaseModel):
    expression: str
    reading: str
    source_text: str
    deinflected_text: str
    entries: list[DictionaryEntry] = []
    dictionary_error: Optional[str] = None
