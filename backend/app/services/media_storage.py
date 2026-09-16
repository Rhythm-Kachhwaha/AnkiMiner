"""Local binary media storage service for Kiroku Note."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import uuid

DEFAULT_MEDIA_REL_PATH = Path("data") / "media"


def get_media_dir() -> Path:
    """Resolve media directory from environment (KIROKU_MEDIA_DIR / ANKIMINER_MEDIA_DIR) or default (backend/data/media)."""
    custom_dir = os.getenv("KIROKU_MEDIA_DIR") or os.getenv("ANKIMINER_MEDIA_DIR")
    if custom_dir:
        target = Path(custom_dir)
    else:
        base_dir = Path(__file__).resolve().parent.parent.parent
        target = base_dir / DEFAULT_MEDIA_REL_PATH

    target.mkdir(parents=True, exist_ok=True)
    return target


class MediaStorageError(Exception):
    """Base error for media storage operations."""
    pass


class MediaStorageService:
    """Handles saving, retrieving, and managing captured image and audio files."""

    def __init__(self, media_dir: Path | str | None = None):
        if media_dir:
            self.media_dir = Path(media_dir)
            self.media_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.media_dir = get_media_dir()

    def _extract_base64_and_ext(self, raw_data: str, default_ext: str = "jpg") -> tuple[bytes, str]:
        """Extract raw bytes and extension from base64 string or data URL."""
        if not raw_data:
            raise MediaStorageError("Empty media data.")

        clean_str = raw_data.strip()
        detected_ext = default_ext

        # Check for data URL scheme: data:<mime>;base64,<payload>
        # Use lazy (.*?) to handle MIME types with parameters like audio/webm;codecs=opus
        if clean_str.startswith("data:"):
            match = re.match(r"^data:(.*?);base64,(.*)$", clean_str, re.DOTALL)
            if match:
                full_mime = match.group(1).lower()
                clean_str = match.group(2)
                # Extract base MIME type (before any params like ;codecs=opus)
                base_mime = full_mime.split(";")[0].strip()
                if "jpeg" in base_mime or "jpg" in base_mime:
                    detected_ext = "jpg"
                elif "png" in base_mime:
                    detected_ext = "png"
                elif "webp" in base_mime:
                    detected_ext = "webp"
                elif "webm" in base_mime:
                    detected_ext = "webm"
                elif "wav" in base_mime:
                    detected_ext = "wav"
                elif "mpeg" in base_mime or "mp3" in base_mime:
                    detected_ext = "mp3"
                elif "ogg" in base_mime:
                    detected_ext = "ogg"
            else:
                raise MediaStorageError("Malformed data URL scheme.")

        try:
            decoded_bytes = base64.b64decode(clean_str, validate=True)
        except Exception as err:
            raise MediaStorageError(f"Invalid base64 payload: {err}") from err

        return decoded_bytes, detected_ext

    def save_media(
        self,
        raw_data: str,
        media_type: str = "image",
        preferred_ext: str | None = None,
    ) -> str:
        """
        Save raw base64 or data URL payload to disk.
        media_type: 'image' or 'audio'
        Returns the sanitized filename (e.g. 'ankiminer_img_20260914_abcd1234.jpg').
        """
        default_ext = preferred_ext or ("jpg" if media_type == "image" else "webm")
        data_bytes, ext = self._extract_base64_and_ext(raw_data, default_ext=default_ext)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        token = uuid.uuid4().hex[:8]
        prefix = "img" if media_type == "image" else "audio"
        filename = f"ankiminer_{prefix}_{timestamp}_{token}.{ext}"

        file_path = self.media_dir / filename
        file_path.write_bytes(data_bytes)
        return filename

    def get_media_path(self, filename: str) -> Path | None:
        """Retrieve path to a stored media file with strict path-traversal prevention."""
        if not filename:
            return None
        safe_name = os.path.basename(filename)
        if safe_name != filename or ".." in filename:
            return None

        file_path = self.media_dir / safe_name
        if file_path.is_file():
            return file_path
        return None

    def get_media_bytes(self, filename: str) -> bytes | None:
        """Read bytes of stored media file."""
        path = self.get_media_path(filename)
        if path and path.is_file():
            return path.read_bytes()
        return None

    def delete_media(self, filename: str) -> bool:
        """Delete stored media file."""
        path = self.get_media_path(filename)
        if path and path.is_file():
            try:
                path.unlink()
                return True
            except OSError:
                return False
        return False
