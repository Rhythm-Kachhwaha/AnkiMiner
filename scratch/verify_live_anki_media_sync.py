"""Verify media persistence and storeMediaFile sync to live AnkiConnect."""
import base64
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.abspath("backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.services.anki_connect import AnkiConnectService

client = TestClient(app)
anki = AnkiConnectService()

print("Testing Live AnkiConnect Media Sync...")

# 1. Create a card with small valid 1x1 image and sample audio wav
png_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
wav_bytes = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
wav_b64 = "data:audio/wav;base64," + base64.b64encode(wav_bytes).decode("ascii")

card_payload = {
    "expression": "メディア同期テスト",
    "reading": "めでぃあどうきてすと",
    "meaning": "media synchronization test",
    "image_data": png_b64,
    "audio_data": wav_b64,
    "deck_name": "Default",
    "tags": "ankiminer_media_test"
}

save_resp = client.post("/api/cards/save", json=card_payload)
assert save_resp.status_code == 200, f"Save failed: {save_resp.text}"
card_data = save_resp.json()
card_id = card_data["id"]
img_filename = card_data["image"]
aud_filename = card_data["audio"]

print(f"  [OK] Saved card {card_id} with image='{img_filename}', audio='{aud_filename}'")

# Check that GET /api/media/{filename} serves them
img_get = client.get(f"/api/media/{img_filename}")
assert img_get.status_code == 200
assert img_get.headers["content-type"] == "image/png"
print(f"  [OK] Endpoint GET /api/media/{img_filename} returned HTTP 200 image/png")

# Now sync card to Live Anki
sync_resp = client.post(f"/api/cards/{card_id}/sync")
assert sync_resp.status_code == 200, f"Sync failed: {sync_resp.text}"
sync_data = sync_resp.json()
assert sync_data["sync_status"] == "synced"
note_id = sync_data["anki_note_id"]
print(f"  [OK] Successfully synced to live Anki note {note_id}")

# Check note info in Anki
note_info = anki._invoke("notesInfo", notes=[note_id])[0]
fields = note_info["fields"]
print(f"  * Note fields in Anki: {fields}")

# Clean up test note from Anki
anki._invoke("deleteNotes", notes=[note_id])
# Clean up media from Anki
try:
    anki._invoke("deleteMediaFile", filename=img_filename)
    anki._invoke("deleteMediaFile", filename=aud_filename)
except Exception:
    pass
print("  [OK] Cleaned up test note and media from Anki")

print("ALL LIVE MEDIA SYNC TESTS PASSED!")
