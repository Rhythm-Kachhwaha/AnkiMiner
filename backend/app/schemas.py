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


class CaptureResponse(BaseModel):
    expression: str
    reading: str
