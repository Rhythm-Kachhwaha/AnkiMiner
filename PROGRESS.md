# AnkiMiner Progress

## Current status

Phase 4 (ANKICONNECT SYNCHRONIZATION + DECK CONFIGURATION) is fully implemented and independently verified by the Phase 4 verification agent (2026-09-10).
All automated backend tests pass (65/65 pytest tests — 5 new regression tests added during verification).
Extension unit, DOM contract, and state machine tests pass (2/2 node tests).
All live AnkiConnect integration checks pass against real Anki at `http://127.0.0.1:8765` across both Japanese mining and standard Basic note models.

## Implemented

### Phase 2 (committed at 008d3c3, unchanged)

- **Extension capture pipeline**: content script captures Japanese text selections, validates Japanese boundaries (`capture-utils.js`), sends via message passing to background service worker, which routes to Side Panel.
- **Side Panel UI**: mining toggle, request-ID-guarded async fetch to `/api/capture`, renders expression, reading, dictionary entries, senses, examples, and diagnostics.
- **FastAPI backend**: `POST /api/capture` validates `CaptureRequest`, delegates to `YomitanService`, returns structured `CaptureResponse`.
- **YomitanService**: tokenizes via `/tokenize` (scanning-parser), enriches via `/termEntries`, normalizes headword/reading/deinflection, handles kanji, hiragana, katakana, mixed text, deinflection, punctuation bracketing.
- **CORS**: allows chrome-extension and localhost origins.

### Phase 3 (committed at 1438213)

- **SQLite Local Persistence**:
  - `app/db/connection.py`: `db_session` context manager, WAL journal mode, foreign keys. `init_db()` creates `cards` table with UNIQUE constraint on `(normalized_expression, normalized_reading, normalized_deck_name)`.
  - `app/repositories/card_repository.py`: `CardRepository` encapsulates all SQL. `save(draft)` → duplicate check → insert or return existing. Race-safe via `IntegrityError` re-query. `find_by_identity()`, `get_by_id()`, `count()`.
- **Duplicate Prevention & Identity Normalization**:
  - `app/services/card_normalizer.py`: NFC Unicode normalization, full-width and ASCII whitespace collapse. Identity tuple: `(normalized_expression, normalized_reading, normalized_deck_name)`.
  - Same expression + reading + same deck → existing card returned, no new row.
  - Same expression + reading + different deck → separate card.
- **Card Service & FastAPI Route Integration**:
  - `app/services/card_service.py`: orchestrates identify → enrich → CardDraft → CardRepository.save → CaptureResponse.
  - `POST /api/capture` accepts optional `deck_name` (defaults to `"Default"`). Response includes `id`, `status` (`"saved"` / `"already_saved"`), `is_duplicate`.
- **Side Panel Persistence Display**:
  - `sidepanel.html`: added `#save-badge` element.
  - `sidepanel.css`: `.badge.saved` (green) and `.badge.already-saved` (amber) styled per `DESIGN.md` tokens.
  - `sidepanel.js`: shows `[SAVED]` on new card, `[ALREADY SAVED]` on duplicate.

### Phase 3.3 (Card Editor & Explicit Save Workflow)

- **Database schema enhancements & migrations**:
  - Added fields to SQLite `cards` table: `meaning`, `hint`, `example_sentence`, `example_translation`, `image`, `audio`, `tags`, `notes`.
  - Schema migration utility in `init_db()` safely alters existing databases without dropping tables or losing rows.
- **Backend lifecycle & routing**:
  - `schemas.py`: Added `SaveCardRequest` with whitespace validation, `SaveCardResponse` with `is_new`, `is_updated`, `is_duplicate` status flags; updated `CaptureRequest` with `auto_save: bool = False` and `CaptureResponse` with editable fields.
  - `CardRepository.save_or_update()`: Inserts new cards, detects identity duplicates, or updates existing card fields in place without generating duplicate rows.
  - `CardService.capture_term()`: Decouples selection from persistence. Text selection returns an editable `CardDraft` without saving, or loads existing saved card data if a duplicate already exists.
  - `CardService.save_card()`: Enforces explicit user saving, validates card constraints, and executes database persistence/updates.
  - `main.py`: Added `POST /api/cards/save` and `POST /api/card/save` endpoints.
- **Side Panel UI & Card Editor**:
  - Added Session counter (`#session-count`) displaying `Cards this session: N`.
  - Built compact Card Editor form (`#card-editor`) styled according to `DESIGN.md` developer-utility tokens.
  - Core fields (`Expression`, `Reading`, `Meaning`) populated from normalized Yomitan draft and editable.
  - Progressive disclosure for optional fields: `[+ Optional fields]` toggle expands/collapses `Hint`, `Example sentence`, `Example translation`, `Image`, `Audio`, `Tags`, `Notes`.
  - Explicit `[Save Card]` button handles submission, disables during in-flight network request, updates `#save-badge` to `[SAVED]` / `[ALREADY SAVED]`, and updates session count only for newly saved cards.

### Phase 4 (AnkiConnect Synchronization + Deck Configuration)

- **Isolated AnkiConnect Service (`app/services/anki_connect.py`)**:
  - Encapsulates all JSON-RPC HTTP transport using standard library `urllib` (zero external dependencies).
  - Handles connection refused (`AnkiConnectionError`), timeouts (`AnkiTimeoutError`), malformed responses (`AnkiResponseError`), and AnkiConnect errors (`AnkiActionError`).
  - Supports `version`, `deckNames`, `createDeck`, `modelNames`, `modelFieldNames`, `findNotes`, `notesInfo`, `addNote`.
  - Safe query sanitization and application-level candidate verification preventing injection.
  - Deterministic note model resolution checking for prompt/answer field coverage (prioritizing Japanese mining models or standard `Basic`).
  - HTML tag stripping and entity decoding for Anki candidate fields.
  - Composite bracketed reading extraction (`Front: "映画 [えいが]"`) ensuring standard `Basic` model notes are accurately detected across local database resets.
- **Database Schema Sync State & Safe Migrations (`app/db/connection.py`)**:
  - Added sync columns to SQLite `cards` table: `sync_status` (defaults to `'pending'`), `anki_note_id` (INTEGER NULL), `sync_error` (TEXT DEFAULT ''), `synced_at` (TEXT NULL).
  - Migration in `init_db()` safely alters tables without data loss.
- **CardRepository Sync Methods (`app/repositories/card_repository.py`)**:
  - Added `mark_syncing`, `mark_synced`, `mark_failed`, `set_anki_note_id`, `get_pending_or_failed_cards`, `get_sync_state`.
  - Preserves local card integrity across all operations.
- **CardService Sync Orchestration (`app/services/card_service.py`)**:
  - SQLite persistence succeeds independently of Anki availability. Saving never fails due to Anki being offline.
  - `sync_card(card_id)` orchestrates duplicate checks in Anki, note creation, and sync state transitions.
  - Duplicate detection in Anki associates existing `anki_note_id` without creating duplicates across local DB resets.
  - Failed syncs transition to `sync_status = 'failed'` with diagnostics, allowing safe retries.
- **Backend API Routes (`app/main.py`)**:
  - `GET /api/anki/status` returns reachability and Anki version.
  - `GET /api/anki/decks` returns available decks (fallback to `['Default']`).
  - `POST /api/cards/{id}/sync` synchronizes a card to Anki.
- **Side Panel UI (`sidepanel.html`, `sidepanel.css`, `sidepanel.js`)**:
  - Compact native Deck `<select id="field-deck-select">` with local storage persistence of last-used deck.
  - Explicit `[Send to Anki]` button (`#sync-anki-btn`) with states: `Ready`, `Sending…`, `Sent to Anki`, `Retry Send to Anki`.
  - Anki sync status feedback (`#anki-sync-status`) displaying `Anki: Ready`, `Anki: Not connected`, `Anki: Pending`, `Anki: Syncing…`, `Anki: Synced`, `Anki: Failed — retry`.
  - Retry on failed status label click.

## Verified

- **Automated backend test suite (65/65 passed)** — run 2026-09-10 by Phase 4 verification agent:
  - `test_anki_connect.py` (17 tests — 5 regression tests added during verification):
    - version request, list decks, create deck.
    - connection refused, timeout, malformed JSON, action error.
    - candidate search, safe query escaping.
    - empty expression guard: `find_existing_note` with empty expression returns `None` without issuing a broad deck query.
    - deterministic Basic and Japanese model field mappings, note creation.
    - **new**: Basic model bracketed reading duplicate detection (`Front: "映画 [えいが]"` accurately matched).
    - **new**: HTML-formatted field values stripping and matching.
    - **new**: Homonym differentiation: same expression with different reading is rejected as duplicate candidate.
    - **new**: Deck filtering: note with matching expression in a different deck is skipped.
  - `test_anki_loopback_http.py` (6 tests):
    - live HTTP loopback server testing real socket requests, JSON-RPC, error handling, connection refused.
  - `test_sync_lifecycle.py` (9 tests):
    - schema migration on existing DBs preserving rows and defaulting `sync_status = 'pending'`.
    - repository state transitions (`mark_syncing`, `mark_synced`, `mark_failed`).
    - local save succeeding independently with Anki offline.
    - sync success marking card synced and populating `anki_note_id` and `synced_at`.
    - sync failure preserving local SQLite card and marking failed.
    - duplicate Anki note detection linking existing note ID without calling `add_note`.
    - already-synced cards not duplicated.
    - safe retry after failure.
    - API endpoints (`status`, `decks`, `sync`, 404 validation).
  - All 33 previous tests (`test_card_editor.py`, `test_card_repository.py`, `test_capture_integration.py`, `test_capture_route.py`, `test_dictionary.py`, `test_yomitan.py`) pass without regressions.
- **Automated extension unit & contract tests (2/2 passed)**:
  - `capture-utils.test.js`: boundary and script tests pass (supports execution from both project root and extension dir).
  - `sidepanel.test.js`: deck selector, sync button, and sync status DOM contract tests pass; `updateSyncUI` state machine transitions verified (`ready`, `pending`, `syncing`, `synced`, `failed`).
- **Live AnkiConnect integration verification against real Anki (`http://127.0.0.1:8765`)** — run 2026-09-10 by Phase 4 verification agent:
  - Connection verified: `connected=True, version=6`.
  - Deck retrieval: `['Default', 'Kaishi 1.5k', 'n3 mining']`.
  - Note model resolved: `japanese mining`, fields `['Front', 'Back', 'word', 'Audio', 'Image', 'Source', 'URL']`.
  - Local save: test card `AnkiMiner検証Live` saved to SQLite with `sync_status='pending'`.
  - Explicit sync: note created with Anki Note ID `1789045826061`, SQLite updated to `sync_status='synced'`.
  - Second sync: no duplicate created; existing `anki_note_id` returned.
  - DB reset duplicate prevention: card deleted from SQLite, re-saved locally, synced — `find_existing_note` located the existing Anki note and linked it without creating a duplicate.
  - Cleanup verified: temporary note deleted from Anki, temporary SQLite database removed.
  - Standard `Basic` model live verification: card created with `ANKI_NOTE_MODEL="Basic"`, note created with `Front: "AnkiMinerBasicTest [ankiminerbasictest]"`, SQLite reset, re-mined card synced — duplicate detection successfully discovered and linked existing note ID `1789045861040` without duplicate creation; test note deleted from Anki afterward.

## Bugs fixed during verification

1. **`find_existing_note` Basic model duplicate detection failure**: Notes saved under standard `Basic` note models format `Front` as `f"{expr} [{reading}]"`. In `find_existing_note`, comparing `normalize_expression(found_expr) == norm_target_expr` failed because `"映画 [えいが]" != "映画"`, causing duplicate notes to be created on DB resets. Fixed to extract base expression and bracketed reading candidate.
2. **`find_existing_note` HTML-formatted fields**: Anki fields with HTML formatting or entities (e.g. `<div>`, `&nbsp;`) failed string equality checks. Added `_clean_field_text` to strip HTML tags and decode entities before normalization.
3. **`find_existing_note` empty expression guard**: When expression reduced to empty after sanitization, the query fell through to `deck:"<deck>"`, returning all notes in the deck. Added immediate `return None` guard.
4. **Extension test runner path resolution**: `capture-utils.test.js` and `sidepanel.test.js` failed with `ENOENT` when run from `extension/` directory because of hardcoded `extension/...` paths. Updated to use `path.resolve(__dirname, ...)`.
5. **Extension backend connection diagnostics (`Failed to fetch`)**: When the local FastAPI backend was not running on `http://127.0.0.1:8000`, the browser threw `TypeError: Failed to fetch`. `sidepanel.js` rendered this raw browser message without explanation. Added `formatErrorMessage` in `sidepanel.js` mapping network failures to clear, actionable guidance (`Cannot connect to backend. Ensure FastAPI server is running on http://127.0.0.1:8000`). Started the FastAPI backend server daemon process (`python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`), restoring live capture, SQLite persistence, and Anki connectivity in the extension.

## Known issues

- None. Phase 4 is complete and fully verified.

## Next task

Phase 4 complete and independently verified. Await user instructions for future phases.


