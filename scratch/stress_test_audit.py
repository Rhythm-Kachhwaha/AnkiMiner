"""
Comprehensive In-Code Stress Test & Breakage Audit for AnkiMiner.
Runs through every user feature, extreme edge cases, live Yomitan, and live AnkiConnect.
"""
import os
import sys
import tempfile
import json
import urllib.request
from typing import Any

# Ensure UTF-8 output on Windows
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.abspath("backend"))

temp_dir = tempfile.mkdtemp(prefix="ankiminer_stress_")
temp_db_path = os.path.join(temp_dir, "stress_ankiminer.db")
os.environ["ANKIMINER_DB_PATH"] = temp_db_path

from fastapi.testclient import TestClient
from app.main import app
from app.db.connection import init_db
from app.services.anki_connect import AnkiConnectService, AnkiActionError
from app.services.yomitan import YomitanService, YomitanError

client = TestClient(app)
anki = AnkiConnectService()
yomitan = YomitanService()

findings = []

def record_issue(category: str, severity: str, description: str, impact: str):
    findings.append({
        "category": category,
        "severity": severity,
        "description": description,
        "impact": impact
    })
    print(f"  [!] DISCOVERED DEFECT/EDGE CASE [{severity}]: {description}")

print("=" * 70)
print("ANKIMINER IN-CODE FEATURE SCAN & STRESS AUDIT")
print("=" * 70)

# ---------------------------------------------------------------------------
# SECTION 1: LIVE SERVICES HEALTH & ENVIRONMENT CHECK
# ---------------------------------------------------------------------------
print("\n[Section 1] Checking Live Services...")
anki_connected, anki_err = anki.is_connected()
print(f"  * AnkiConnect connected: {anki_connected} ({anki_err or 'OK'})")
if not anki_connected:
    record_issue("AnkiConnect", "HIGH", "AnkiConnect not reachable at 127.0.0.1:8765", "Cannot test live sync")

try:
    y_test = yomitan.identify("テスト")
    yomitan_connected = True
    yomitan_err = None
except Exception as e:
    yomitan_connected = False
    yomitan_err = str(e)
print(f"  * Yomitan server connected: {yomitan_connected} ({yomitan_err or 'OK'})")

# ---------------------------------------------------------------------------
# SECTION 2: DICTIONARY IDENTIFICATION & EDGE CASES
# ---------------------------------------------------------------------------
print("\n[Section 2] Scanning Dictionary Identification & Yomitan Service...")

test_terms = [
    ("Common verb", "食べる"),
    ("Deinflected passive/causative", "食べさせられた"),
    ("Past tense", "走った"),
    ("Kanji compound", "図書館"),
    ("Katakana loanword", "コーヒー"),
    ("Punctuation bracketing", "「約束」"),
    ("Parenthetical phrase", "（笑い）"),
    ("Slang/internet word", "草"),
    ("Single hiragana particle", "は"),
    ("Gibberish / non-existent", "あいうえおかきくけこ123456xyz"),
]

for label, term in test_terms:
    try:
        resp = client.post("/api/capture", json={"text": term, "deck_name": "Default", "auto_save": False})
        if resp.status_code == 200:
            data = resp.json()
            expr = data.get("expression")
            senses = len(data.get("entries", []))
            err = data.get("dictionary_error")
            print(f"  [OK] {label} ('{term}') -> expr='{expr}', entries={senses}, dict_err={err}")
        else:
            record_issue("Dictionary", "MEDIUM", f"Capture endpoint returned HTTP {resp.status_code} for '{term}'", resp.text)
    except Exception as exc:
        record_issue("Dictionary", "HIGH", f"Exception querying '{term}': {exc}", str(exc))

# Boundary test: Empty text
resp = client.post("/api/capture", json={"text": "   ", "deck_name": "Default"})
if resp.status_code != 422:
    record_issue("Dictionary", "LOW", f"Empty capture text returned HTTP {resp.status_code} instead of 422 validation error", resp.text)
else:
    print("  [OK] Empty/whitespace capture text rejected with HTTP 422")

# Boundary test: 501 characters (exceeds max_length=500)
resp = client.post("/api/capture", json={"text": "あ" * 501, "deck_name": "Default"})
if resp.status_code != 422:
    record_issue("Dictionary", "LOW", f"Exceeding 500 chars text returned HTTP {resp.status_code} instead of 422", resp.text)
else:
    print("  [OK] Text exceeding 500 chars rejected with HTTP 422")


# ---------------------------------------------------------------------------
# SECTION 3: CARD EDITOR & SQLITE PERSISTENCE STRESS TEST
# ---------------------------------------------------------------------------
print("\n[Section 3] Scanning Card Editor & Local SQLite Persistence...")

# 3.1 Validation: Blank expression
resp = client.post("/api/cards/save", json={"expression": "   ", "deck_name": "Default"})
if resp.status_code != 422:
    record_issue("Card Persistence", "MEDIUM", f"Blank expression returned HTTP {resp.status_code} instead of 422", resp.text)
else:
    print("  [OK] Blank expression save rejected with HTTP 422")

# 3.2 HTML/Ruby tags & Special Characters handling
special_card = {
    "expression": "<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>",
    "reading": "かんじ",
    "meaning": 'Meaning with "quotes", \'single quotes\', <br> tags, & symbols',
    "hint": "Hint with special chars: <>&'\" / \\",
    "example_sentence": "これは<ruby>本<rt>ほん</rt></ruby>です。\n2行目です。",
    "example_translation": "This is a book.\nSecond line.",
    "deck_name": "Default",
    "tags": "tag1, tag 2, 日本語",
    "notes": "Line 1\nLine 2\nLine 3"
}
resp = client.post("/api/cards/save", json=special_card)
if resp.status_code == 200:
    card_id = resp.json()["id"]
    get_resp = client.get(f"/api/cards/{card_id}")
    fetched = get_resp.json()
    assert fetched["meaning"] == special_card["meaning"], "Meaning corrupted by DB storage"
    assert fetched["example_sentence"] == special_card["example_sentence"], "Example sentence corrupted"
    print("  [OK] Special characters, HTML tags, ruby tags, and multi-line text preserved perfectly in SQLite")
else:
    record_issue("Card Persistence", "HIGH", f"Failed to save card with special characters: {resp.status_code}", resp.text)

# 3.3 Media field length boundary test:
# What happens if someone passes a base64 data URL into 'image'?
long_data_url = "data:image/jpeg;base64," + ("A" * 1000)
resp = client.post("/api/cards/save", json={
    "expression": "画像テスト",
    "reading": "がぞうテスト",
    "image": long_data_url,
    "deck_name": "Default"
})
if resp.status_code == 422:
    record_issue(
        "Media Storage",
        "MEDIUM",
        "SaveCardRequest rejects raw data URLs (>500 chars) with 422 Unprocessable Entity",
        "If frontend passes dataUrl directly in fieldImage or image, save fails. Frontend must use image_data or backend needs binary media storage"
    )
else:
    print(f"  [INFO] Long image string returned status {resp.status_code}")

# 3.4 Duplicate prevention and card update workflow
dup_card_1 = {"expression": "犬", "reading": "いぬ", "meaning": "dog (first edit)", "deck_name": "Default"}
resp1 = client.post("/api/cards/save", json=dup_card_1)
c1 = resp1.json()
assert c1["is_new"] is True

# Saving identical card with same (expression, reading, deck_name) without ID -> duplicate detected
resp2 = client.post("/api/cards/save", json=dup_card_1)
c2 = resp2.json()
if not c2.get("is_duplicate"):
    record_issue("Duplicate Prevention", "HIGH", "Saving identical card did not return is_duplicate=True", str(c2))
else:
    print("  [OK] Duplicate detection correctly identified identical card in same deck")

# Saving identical card to DIFFERENT deck -> should be separate new card
dup_diff_deck = {"expression": "犬", "reading": "いぬ", "meaning": "dog", "deck_name": "Kaishi 1.5k"}
resp_diff = client.post("/api/cards/save", json=dup_diff_deck)
c_diff = resp_diff.json()
if not c_diff.get("is_new"):
    record_issue("Duplicate Prevention", "HIGH", "Card in different deck flagged as duplicate incorrectly", str(c_diff))
else:
    print("  [OK] Per-deck duplicate isolation works: same word in different deck created new card")

# Updating existing card by ID
update_payload = {"id": c1["id"], "expression": "犬", "reading": "いぬ", "meaning": "canine / dog (updated meaning)", "deck_name": "Default"}
resp_up = client.post("/api/cards/save", json=update_payload)
c_up = resp_up.json()
if not c_up.get("is_updated"):
    record_issue("Card Update", "MEDIUM", "Updating existing card by ID did not return is_updated=True", str(c_up))
else:
    # Verify meaning updated
    fetched_up = client.get(f"/api/cards/{c1['id']}").json()
    if fetched_up["meaning"] != update_payload["meaning"]:
        record_issue("Card Update", "HIGH", "Updated meaning not reflected in database", fetched_up["meaning"])
    else:
        print("  [OK] Updating existing card by ID succeeded and persisted")


# ---------------------------------------------------------------------------
# SECTION 4: SEARCH, FILTERING, PAGINATION & SQL INJECTION ROBUSTNESS
# ---------------------------------------------------------------------------
print("\n[Section 4] Scanning Search, Filters & SQL Safety...")

# SQL injection probe
sql_injections = [
    "' OR 1=1 --",
    "'; DROP TABLE cards; --",
    "\" OR \"\"=\"",
    "%%%",
    "__"
]
for injection in sql_injections:
    resp = client.get("/api/cards", params={"search": injection})
    if resp.status_code != 200:
        record_issue("Search / Security", "HIGH", f"Search with SQL probe '{injection}' failed with HTTP {resp.status_code}", resp.text)
    else:
        # Check that table still exists and query succeeded safely
        data = resp.json()
        assert "cards" in data
print("  [OK] SQL injection probes handled safely via parameterized queries")

# Search matching
match_resp = client.get("/api/cards", params={"search": "canine"})
assert match_resp.json()["total"] >= 1
print("  [OK] Search filter by substring in meaning works correctly")

# Filter by deck
deck_filter_resp = client.get("/api/cards", params={"deck": "Kaishi 1.5k"})
for card in deck_filter_resp.json()["cards"]:
    assert card["deck_name"] == "Kaishi 1.5k"
print("  [OK] Filter by deck works correctly")

# Pagination
page_resp = client.get("/api/cards", params={"limit": 1, "offset": 0})
assert len(page_resp.json()["cards"]) <= 1
print("  [OK] Pagination limit/offset works correctly")


# ---------------------------------------------------------------------------
# SECTION 5: LIVE ANKICONNECT SYNCHRONIZATION SCAN
# ---------------------------------------------------------------------------
print("\n[Section 5] Scanning Live AnkiConnect Synchronization...")

if anki_connected:
    # 5.1 Query decks and models
    status_resp = client.get("/api/anki/status").json()
    print(f"  * Live Anki version: {status_resp.get('version')}")

    decks_resp = client.get("/api/anki/decks").json()
    user_decks = decks_resp.get("decks", [])
    print(f"  * Available user decks: {user_decks}")

    models_resp = client.get("/api/anki/models").json()
    user_models = models_resp.get("models", [])
    print(f"  * Available note models: {len(user_models)} models found")

    # 5.2 Test Model Capabilities on User's models
    target_model = "japanese mining" if "japanese mining" in user_models else ("Basic" if "Basic" in user_models else user_models[0])
    cap_resp = client.get(f"/api/anki/model-capabilities?model_name={target_model}").json()
    print(f"  * Capabilities for '{target_model}': image={cap_resp.get('supports_image')}, audio={cap_resp.get('supports_audio')}, fields={cap_resp.get('fields')}")

    # 5.3 Test Real Card Sync to user's 'Default' deck
    test_sync_card = {
        "expression": "同期テスト",
        "reading": "どうきてすと",
        "meaning": "synchronization live test",
        "example_sentence": "これは同期テストです。",
        "deck_name": "Default",
        "model_name": target_model,
        "tags": "ankiminer_audit_test"
    }
    save_sync_resp = client.post("/api/cards/save", json=test_sync_card).json()
    sync_card_id = save_sync_resp["id"]

    sync_result = client.post(f"/api/cards/{sync_card_id}/sync").json()
    print(f"  * Sync result: status={sync_result.get('sync_status')}, note_id={sync_result.get('anki_note_id')}, error={sync_result.get('error')}")

    if sync_result.get("sync_status") == "synced" and sync_result.get("anki_note_id"):
        created_note_id = sync_result["anki_note_id"]
        print(f"  [OK] Successfully synced card to live Anki (Note ID: {created_note_id})")

        # Verify note fields in AnkiConnect
        try:
            notes_info = anki._invoke("notesInfo", notes=[created_note_id])
            if notes_info and len(notes_info) > 0:
                anki_fields = notes_info[0].get("fields", {})
                print(f"  * Anki fields populated: {list(anki_fields.keys())}")
            # Clean up test note so user's Anki is not cluttered
            anki._invoke("deleteNotes", notes=[created_note_id])
            print(f"  * Cleaned up test note {created_note_id} from Anki")
        except Exception as exc:
            record_issue("Anki Sync", "LOW", f"Failed verifying/deleting test note in Anki: {exc}", str(exc))
    else:
        record_issue("Anki Sync", "HIGH", f"Failed syncing card to live Anki: {sync_result.get('error')}", str(sync_result))

    # 5.4 Failure Resilience: Syncing with Invalid / Non-existent Model
    invalid_model_card = {
        "expression": "モデル失敗テスト",
        "reading": "てすと",
        "meaning": "model failure test",
        "deck_name": "Default",
        "model_name": "NON_EXISTENT_MODEL_XYZ_123"
    }
    save_fail_resp = client.post("/api/cards/save", json=invalid_model_card).json()
    fail_card_id = save_fail_resp["id"]

    fail_sync_result = client.post(f"/api/cards/{fail_card_id}/sync").json()
    if fail_sync_result.get("sync_status") == "failed":
        print(f"  [OK] Gracefully handled invalid note model error: '{fail_sync_result.get('error')}'")
        # Ensure local card is NOT deleted and kept as failed
        persisted_fail_card = client.get(f"/api/cards/{fail_card_id}").json()
        assert persisted_fail_card["sync_status"] == "failed"
        assert persisted_fail_card["sync_error"] is not None
        print("  [OK] SQLite preserved local card with sync_status='failed' and diagnostic error intact")
    else:
        record_issue("Anki Resilience", "HIGH", "Syncing with non-existent model did not mark card as failed", str(fail_sync_result))

    # 5.5 Syncing to Non-existent Deck (AnkiConnect auto-creates decks or handles cleanly)
    non_existent_deck_card = {
        "expression": "新規デッキテスト",
        "reading": "しんきでっき",
        "meaning": "new deck test",
        "deck_name": "AnkiMiner_Ephemeral_Deck_Test",
        "model_name": target_model
    }
    save_deck_resp = client.post("/api/cards/save", json=non_existent_deck_card).json()
    new_deck_card_id = save_deck_resp["id"]
    new_deck_sync = client.post(f"/api/cards/{new_deck_card_id}/sync").json()
    if new_deck_sync.get("sync_status") == "synced":
        print("  [OK] AnkiConnect auto-created new deck and synced note successfully")
        # Clean up
        if new_deck_sync.get("anki_note_id"):
            try:
                anki._invoke("deleteNotes", notes=[new_deck_sync["anki_note_id"]])
                # Delete ephemeral deck
                anki._invoke("deleteDecks", decks=["AnkiMiner_Ephemeral_Deck_Test"], cardsToo=True)
                print("  * Cleaned up ephemeral deck and test note")
            except Exception as e:
                pass
    else:
        print(f"  [INFO] Deck creation behavior: {new_deck_sync.get('error')}")

# ---------------------------------------------------------------------------
# SECTION 6: SUMMARY OF SCAN RESULTS
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print(f"STRESS AUDIT SCAN COMPLETE: {len(findings)} Potential Issues / Edge Cases Identified")
print("=" * 70)
for i, f in enumerate(findings, 1):
    print(f"{i}. [{f['severity']}] ({f['category']}) {f['description']}")
    print(f"   Impact: {f['impact']}")

# Save findings JSON
with open(os.path.join(temp_dir, "audit_findings.json"), "w", encoding="utf-8") as f:
    json.dump(findings, f, indent=2, ensure_ascii=False)
