from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CaptureRequest(BaseModel):
    """Untrusted text captured from the active webpage."""

    text: str = Field(max_length=500)
    deck_name: str = Field(default="Default", max_length=100)
    auto_save: bool = False

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
    id: Optional[int] = None
    expression: str
    reading: str = ""
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    entries: list[DictionaryEntry] = []
    dictionary_error: Optional[str] = None
    deck_name: str = "Default"
    status: str = "draft"
    is_duplicate: bool = False
    is_new: bool = False
    is_updated: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SaveCardRequest(BaseModel):
    id: Optional[int] = None
    expression: str = Field(max_length=200)
    reading: str = Field(default="", max_length=200)
    meaning: str = Field(default="", max_length=2000)
    deck_name: str = Field(default="Default", max_length=100)
    hint: str = Field(default="", max_length=500)
    example_sentence: str = Field(default="", max_length=1000)
    example_translation: str = Field(default="", max_length=1000)
    image: str = Field(default="", max_length=500)
    audio: str = Field(default="", max_length=500)
    tags: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=2000)
    source_text: str = Field(default="", max_length=500)
    deinflected_text: str = Field(default="", max_length=500)

    @field_validator("expression")
    @classmethod
    def expression_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Expression must not be empty.")
        return normalized


class SaveCardResponse(BaseModel):
    id: int
    expression: str
    reading: str = ""
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    deck_name: str = "Default"
    status: str = "saved"
    is_duplicate: bool = False
    is_new: bool = True
    is_updated: bool = False
    created_at: str
    updated_at: str
