"""Stage 5 Audio Reliability and Production Hardening tests."""
import base64
from pathlib import Path
import pytest

from app.db.connection import db_session, init_db
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiActionError, AnkiConnectService
from app.services.card_service import CardService
from app.services.media_storage import MediaStorageError, MediaStorageService
from app.services.yomitan import YomitanService


@pytest.fixture
def temp_db(tmp_path: Path):
    db_file = tmp_path / "test_stage5.db"
    init_db(str(db_file))
    return str(db_file)


@pytest.fixture
def temp_media_dir(tmp_path: Path):
    media_dir = tmp_path / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    return media_dir


class MockYomitanService(YomitanService):
    def identify(self, text: str):
        from app.schemas import NormalizedTerm
        return NormalizedTerm(
            headword="信頼性",
            reading="しんらいせい",
            expression="信頼性",
            source_text=text,
            deinflected_text="信頼性",
            parts_of_speech=["noun"],
            glossary=["reliability", "trustworthiness"],
            rules=[]
        )

    def enrich(self, term):
        from app.schemas import DictionaryEntry, EnrichedCard, ExampleSentence, Sense
        sense = Sense(glosses=["reliability", "trustworthiness"], examples=[])
        entry = DictionaryEntry(headword=term.headword, reading=term.reading, is_primary=True, senses=[sense])
        return EnrichedCard(
            expression=term.expression,
            reading=term.reading,
            source_text=term.source_text,
            deinflected_text=term.deinflected_text,
            entries=[entry]
        )


def _make_dummy_wav_data_url(duration_samples: int = 100) -> str:
    """Generate a minimal valid 44-byte WAV header + payload as base64 Data URL."""
    header = bytearray(44 + duration_samples * 2)
    header[0:4] = b"RIFF"
    total_size = 36 + duration_samples * 2
    header[4:8] = total_size.to_bytes(4, "little")
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    header[16:20] = (16).to_bytes(4, "little")
    header[20:22] = (1).to_bytes(2, "little")
    header[22:24] = (1).to_bytes(2, "little")
    header[24:28] = (48000).to_bytes(4, "little")
    header[28:32] = (96000).to_bytes(4, "little")
    header[32:34] = (2).to_bytes(2, "little")
    header[34:36] = (16).to_bytes(2, "little")
    header[36:40] = b"data"
    header[40:44] = (duration_samples * 2).to_bytes(4, "little")
    b64 = base64.b64encode(header).decode("ascii")
    return f"data:audio/wav;base64,{b64}"


def test_media_storage_wav_extraction_robustness(temp_media_dir: Path):
    storage = MediaStorageService(media_dir=temp_media_dir)
    wav_url = _make_dummy_wav_data_url(50)

    # 1. Standard data URL
    filename = storage.save_media(wav_url, media_type="audio", preferred_ext="wav")
    assert filename.startswith("ankiminer_audio_")
    assert filename.endswith(".wav")
    assert storage.get_media_path(filename) is not None

    # 2. Path traversal attack prevention
    assert storage.get_media_path("../../../etc/passwd") is None
    assert storage.get_media_path("subdir/test.wav") is None
    assert storage.get_media_bytes("../../secret.txt") is None

    # 3. Invalid base64 handling
    with pytest.raises(MediaStorageError):
        storage.save_media("data:audio/wav;base64,NOT_VALID_BASE64!@#$", media_type="audio")


def test_card_service_audio_persistence_and_resave_idempotency(temp_db: str, temp_media_dir: Path, monkeypatch):
    monkeypatch.setenv("ANKIMINER_MEDIA_DIR", str(temp_media_dir))
    yomitan = MockYomitanService()
    repo = CardRepository(db_path=temp_db)
    storage = MediaStorageService(media_dir=temp_media_dir)
    service = CardService(yomitan_service=yomitan, card_repository=repo)

    wav_url = _make_dummy_wav_data_url(80)

    # 1. Save new card with WAV audio Data URL
    req1 = SaveCardRequest(
        expression="信頼性",
        reading="しんらいせい",
        meaning="reliability",
        audio=wav_url,
        audio_data=wav_url,
        deck_name="Default",
    )
    res1 = service.save_card(req1)
    assert res1.id is not None
    assert res1.is_new is True
    assert res1.audio.startswith("ankiminer_audio_")
    assert res1.audio.endswith(".wav")

    saved_filename = res1.audio
    audio_file_path = storage.get_media_path(saved_filename)
    assert audio_file_path is not None
    assert audio_file_path.exists()
    initial_mtime = audio_file_path.stat().st_mtime

    # 2. Re-save the card with the existing audio filename (idempotency check)
    req2 = SaveCardRequest(
        id=res1.id,
        expression="信頼性",
        reading="しんらいせい",
        meaning="reliability, robustness",
        audio=saved_filename,
        audio_data=None,
        deck_name="Default",
    )
    res2 = service.save_card(req2)
    assert res2.id == res1.id
    assert res2.is_updated is True
    assert res2.audio == saved_filename

    # Verify no duplicate files created in media directory
    media_files = list(temp_media_dir.glob("*.wav"))
    assert len(media_files) == 1
    assert media_files[0].name == saved_filename


def test_anki_connect_audio_field_mapping_and_sound_tag():
    service = AnkiConnectService()

    # 1. Japanese Mining Model with dedicated SentenceAudio field
    model_fields_1 = ["Expression", "Reading", "Meaning", "SentenceAudio", "SentenceImage"]
    card_1 = {
        "expression": "信頼性",
        "reading": "しんらいせい",
        "meaning": "reliability",
        "audio": "ankiminer_audio_test123.wav"
    }
    mapped_1 = service.map_card_to_fields(card_1, model_fields_1)
    assert mapped_1["Expression"] == "信頼性"
    assert mapped_1["SentenceAudio"] == "[sound:ankiminer_audio_test123.wav]"

    # 2. Basic Front/Back Model attaches sound to Back
    model_fields_basic = ["Front", "Back"]
    card_basic = {
        "expression": "信頼性",
        "reading": "しんらいせい",
        "meaning": "reliability",
        "audio": "ankiminer_audio_test123.wav"
    }
    mapped_basic = service.map_card_to_fields(card_basic, model_fields_basic)
    assert mapped_basic["Front"] == "信頼性 [しんらいせい]"
    assert "[sound:ankiminer_audio_test123.wav]" in mapped_basic["Back"]

    # 3. Model without audio field gracefully omits sound tag without polluting arbitrary text fields
    model_fields_custom = ["Word", "Definition"]
    card_custom = {
        "expression": "信頼性",
        "reading": "しんらいせい",
        "meaning": "reliability",
        "audio": "ankiminer_audio_test123.wav"
    }
    mapped_custom = service.map_card_to_fields(card_custom, model_fields_custom)
    assert mapped_custom["Word"] == "信頼性"
    assert mapped_custom["Definition"] == "reliability"
    assert "audio" not in mapped_custom
    assert "[sound:" not in mapped_custom.get("Word", "")
    assert "[sound:" not in mapped_custom.get("Definition", "")
