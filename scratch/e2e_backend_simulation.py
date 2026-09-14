import json
import os
import sys
import tempfile
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
from fastapi.testclient import TestClient

# Ensure backend package is in python path
sys.path.insert(0, os.path.abspath("backend"))

from app.main import app
from app.db.connection import db_session, init_db
from app.services.anki_connect import AnkiConnectService

def run_e2e_user_journey():
    results = []
    issues = []
    
    print("=" * 60)
    print("STARTING COMPLETE END-TO-END IN-CODE APPLICATION AUDIT")
    print("=" * 60)
    
    # -------------------------------------------------------------
    # Step 1: Real External Services Connectivity
    # -------------------------------------------------------------
    print("\n[Step 1] Checking Live External Integrations...")
    anki_live = False
    yomitan_live = False
    
    # Check AnkiConnect
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:8765",
            data=json.dumps({"action": "version", "version": 6}).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=2) as res:
            anki_data = json.loads(res.read().decode())
            if anki_data.get("result"):
                anki_live = True
                print(f"  [OK] AnkiConnect is LIVE (version {anki_data['result']})")
    except Exception as e:
        issues.append(f"AnkiConnect not reachable: {e}")
        print(f"  [FAIL] AnkiConnect not reachable: {e}")

    # Check Yomitan
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:19633/termEntries",
            data=json.dumps({"term": "猫"}).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=2) as res:
            if res.getcode() == 200:
                yomitan_live = True
                print("  [OK] Yomitan Server is LIVE and accepting queries")
    except Exception as e:
        issues.append(f"Yomitan Server not reachable: {e}")
        print(f"  [FAIL] Yomitan Server not reachable: {e}")

    # -------------------------------------------------------------
    # Step 2: FastAPI Client & In-Memory / Isolated SQLite DB
    # -------------------------------------------------------------
    print("\n[Step 2] Testing Backend API Routes with Isolated Database...")
    temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_db_path = temp_db.name
    temp_db.close()
    
    os.environ["ANKIMINER_DB_PATH"] = temp_db_path
    init_db(temp_db_path)
    client = TestClient(app)

    # 2.1 Anki status endpoint
    res = client.get("/api/anki/status")
    print(f"  GET /api/anki/status -> HTTP {res.status_code}")
    if res.status_code == 200 and res.json().get("connected") == anki_live:
        print("  [OK] Anki status correctly reported")
    else:
        issues.append(f"Anki status route mismatch: expected connected={anki_live}, got {res.json()}")
        print(f"  [FAIL] Anki status route error: {res.text}")

    # 2.2 Anki decks & models
    if anki_live:
        res = client.get("/api/anki/decks")
        decks = res.json().get("decks", [])
        print(f"  [OK] Retrieved real decks: {decks}")

        res = client.get("/api/anki/models")
        models = res.json().get("models", [])
        print(f"  [OK] Retrieved real models: {models[:4]}... (total {len(models)})")

        # 2.3 Model capabilities for real note types
        target_model = "japanese mining" if "japanese mining" in models else models[0]
        res = client.get(f"/api/anki/model-capabilities?model_name={urllib.parse.quote(target_model)}")
        caps = res.json()
        print(f"  [OK] Model capabilities for '{target_model}': {caps}")
        if not caps.get("model_name"):
            issues.append(f"Model capabilities route failed for '{target_model}'")

    # -------------------------------------------------------------
    # Step 3: Text Mining Journey (Identify -> Enrich -> Save -> Duplicate)
    # -------------------------------------------------------------
    print("\n[Step 3] Simulating Text Mining Flow...")
    word_to_mine = "勉強"
    test_deck = "Default"
    
    # 3.1 Capture / Identify
    cap_res = client.post("/api/capture", json={"text": word_to_mine, "deck_name": test_deck, "auto_save": False})
    print(f"  POST /api/capture ('{word_to_mine}') -> HTTP {cap_res.status_code}")
    if cap_res.status_code != 200:
        issues.append(f"Capture endpoint failed for '{word_to_mine}': {cap_res.text}")
        print(f"  [FAIL] Capture failed: {cap_res.text}")
    else:
        cap_data = cap_res.json()
        print(f"  [OK] Word identified: expression='{cap_data.get('expression')}', reading='{cap_data.get('reading')}'")
        print(f"  [OK] Meaning: {cap_data.get('meaning')[:40]}...")
        print(f"  [OK] Entries count: {len(cap_data.get('entries', []))}")
        
        # 3.2 User edits card in Side Panel and clicks Save Card
        save_payload = {
            "expression": cap_data["expression"],
            "reading": cap_data["reading"],
            "meaning": "diligence; study; to learn", # user edited meaning
            "deck_name": test_deck,
            "model_name": target_model if anki_live else "Basic",
            "hint": "studying",
            "example_sentence": "毎日日本語を勉強します。",
            "example_translation": "I study Japanese every day.",
            "tags": "n5, study",
            "notes": "Mined during audit test",
        }
        save_res = client.post("/api/cards/save", json=save_payload)
        print(f"  POST /api/cards/save -> HTTP {save_res.status_code}")
        if save_res.status_code != 200:
            issues.append(f"Save card failed: {save_res.text}")
            print(f"  [FAIL] Save card failed: {save_res.text}")
        else:
            saved_card = save_res.json()
            card_id = saved_card.get("id")
            print(f"  [OK] Card saved to SQLite (ID: {card_id}, is_new: {saved_card.get('is_new')})")
            
            # 3.3 Test duplicate prevention
            dup_res = client.post("/api/cards/save", json=save_payload)
            dup_data = dup_res.json()
            if dup_data.get("is_duplicate"):
                print(f"  [OK] Duplicate card detected accurately (is_duplicate: True, status: {dup_data.get('status')})")
            else:
                issues.append("Duplicate card was NOT detected on second save!")
                print(f"  [FAIL] Duplicate detection failed: {dup_data}")

            # 3.4 Sync to Real Anki
            created_anki_note_id = None
            if anki_live:
                print("\n[Step 4] Testing Real Anki Synchronization...")
                sync_res = client.post(f"/api/cards/{card_id}/sync")
                print(f"  POST /api/cards/{card_id}/sync -> HTTP {sync_res.status_code}")
                if sync_res.status_code != 200:
                    issues.append(f"Sync card failed: {sync_res.text}")
                    print(f"  [FAIL] Sync card failed: {sync_res.text}")
                else:
                    sync_data = sync_res.json()
                    created_anki_note_id = sync_data.get("anki_note_id")
                    print(f"  [OK] Card synced to Anki (Note ID: {created_anki_note_id}, status: {sync_data.get('sync_status')})")
                    
                    # Verify note in real Anki
                    anki_service = AnkiConnectService()
                    note_info = anki_service._invoke("notesInfo", notes=[created_anki_note_id])
                    if note_info and len(note_info) > 0:
                        fields = note_info[0].get("fields", {})
                        print(f"  [OK] Verified note fields in Anki: {list(fields.keys())}")
                        # Cleanup the note from Anki so test doesn't pollute user database
                        del_res = anki_service._invoke("deleteNotes", notes=[created_anki_note_id])
                        print(f"  [OK] Cleaned up test note {created_anki_note_id} from Anki: {del_res}")
                    else:
                        issues.append(f"Could not retrieve note {created_anki_note_id} from Anki")

    # -------------------------------------------------------------
    # Step 5: History & Card Library Flow
    # -------------------------------------------------------------
    print("\n[Step 5] Testing History & Card Library Operations...")
    list_res = client.get("/api/cards")
    cards_data = list_res.json()
    cards = cards_data.get("cards", [])
    print(f"  GET /api/cards -> found {len(cards)} card(s), total: {cards_data.get('total')}")
    if not any(c["id"] == card_id for c in cards):
        issues.append("Saved card not listed in history")
    else:
        print("  [OK] Saved card appears in history list")

    # Search
    search_res = client.get(f"/api/cards?search={urllib.parse.quote('勉強')}")
    found = search_res.json().get("cards", [])
    if len(found) >= 1:
        print(f"  [OK] History search by query found {len(found)} match")
    else:
        issues.append("History search by query returned 0 results")

    # Filter by deck
    deck_filter_res = client.get(f"/api/cards?deck_name={test_deck}")
    deck_cards = deck_filter_res.json().get("cards", [])
    if len(deck_cards) >= 1:
        print(f"  [OK] History deck filter found {len(deck_cards)} match")
    else:
        issues.append("History deck filter returned 0 results")

    # Delete local card
    del_res = client.delete(f"/api/cards/{card_id}")
    if del_res.status_code == 200:
        print(f"  [OK] Card {card_id} deleted successfully from local database")
    else:
        issues.append(f"Delete card failed: {del_res.text}")

    # Clean up temp DB
    try:
        os.remove(temp_db_path)
    except Exception:
        pass

    # Summary
    print("\n" + "=" * 60)
    print("BACKEND & INTEGRATION SCAN COMPLETE")
    print("=" * 60)
    if issues:
        print(f"Found {len(issues)} issue(s):")
        for iss in issues:
            print(f"  - {iss}")
    else:
        print("All backend journeys passed with 0 errors!")
    return issues

if __name__ == "__main__":
    import urllib.parse
    issues = run_e2e_user_journey()
    sys.exit(len(issues))
