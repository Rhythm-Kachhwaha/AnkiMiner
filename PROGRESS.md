# AnkiMiner Progress

## Current status

Phase 2 core pipeline is confirmed structurally intact and all automated tests pass (20/20 backend, 1/1 extension).
Phase 3 SQLite persistence and duplicate prevention is implemented and passes automated tests.

**Pending**: Live Brave + Yomitan end-to-end verification of the complete pipeline has not been run in this session (Yomitan was not available). The automated test suite fully covers the logic path. Manual verification with Yomitan running is the remaining step before declaring Phase 3 complete.

**Fixed regression**: `http.client.RemoteDisconnected` (an `OSError` subclass, not a `URLError`) was not caught by `YomitanService._post_json`, causing a bare 500 Internal Server Error instead of a proper 503 when Yomitan dropped a connection mid-response. Now fixed — server returns 503 when Yomitan is unavailable (confirmed by live test).

## Implemented

### Phase 2 (committed at 008d3c3, unchanged)

- **Extension capture pipeline**: content script captures Japanese text selections, validates Japanese boundaries (`capture-utils.js`), sends via message passing to background service worker, which routes to Side Panel.
- **Side Panel UI**: mining toggle, request-ID-guarded async fetch to `/api/capture`, renders expression, reading, dictionary entries, senses, examples, and diagnostics.
- **FastAPI backend**: `POST /api/capture` validates `CaptureRequest`, delegates to `YomitanService`, returns structured `CaptureResponse`.
- **YomitanService**: tokenizes via `/tokenize` (scanning-parser), enriches via `/termEntries`, normalizes headword/reading/deinflection, handles kanji, hiragana, katakana, mixed text, deinflection, punctuation bracketing.
- **CORS**: allows chrome-extension and localhost origins.

### Phase 3 (uncommitted working-tree changes)

- **SQLite Local Persistence**:
  - `app/db/connection.py`: `db_session` context manager, WAL journal mode, foreign keys. `init_db()` creates `cards` table with UNIQUE constraint on `(normalized_expression, normalized_reading, normalized_deck_name)`.
  - `app/repositories/card_repository.py`: `CardRepository` encapsulates all SQL. `save(draft)` → duplicate check → insert or return existing. Race-safe via `IntegrityError` re-query. `find_by_identity()`, `get_by_id()`, `count()`.
- **Duplicate Prevention & Identity Normalization**:
  - `app/services/card_normalizer.py`: NFC Unicode normalization, full-width and ASCII whitespace collapse. Identity tuple: `(normalized_expression, normalized_reading, normalized_deck_name)`.
  - Same expression + reading + same deck → existing card returned, no new row.
  - Same expression + reading + different deck → separate card.
- **Card Service & FastAPI Route Integration**:
  - `app/services/card_service.py`: orchestrates identify → enrich → CardDraft → CardRepository.save → CaptureResponse.
  - `POST /api/capture` now accepts optional `deck_name` (defaults to `"Default"`). Response includes `id`, `status` (`"saved"` / `"already_saved"`), `is_duplicate`.
- **Side Panel Persistence Display**:
  - `sidepanel.html`: added `#save-badge` element.
  - `sidepanel.css`: `.badge.saved` (green) and `.badge.already-saved` (amber) styled per `DESIGN.md` tokens.
  - `sidepanel.js`: shows `[SAVED]` on new card, `[ALREADY SAVED]` on duplicate.
- **Bug fix**: `YomitanService._post_json` now catches `OSError` (covers `RemoteDisconnected`) in addition to `URLError`/`TimeoutError`, ensuring all Yomitan unavailability raises `YomitanUnavailableError` → 503, never a bare 500.

## Verified

- **All backend tests (20/20 passed)**:
  - `test_yomitan.py` (5 tests): normalization, deinflection, hiragana/katakana/kanji, malformed payloads, **`RemoteDisconnected` now raises `YomitanUnavailableError`** (new regression test, passes).
  - `test_dictionary.py` (3 tests): entry parsing, sense/POS/ruby/example, malformed payloads.
  - `test_capture_route.py` (1 test): route delegates correctly to CardService with mocked Yomitan.
  - `test_card_repository.py` (7 tests): insert, retrieve by ID/identity, duplicate detection, deck-scoped identity, normalization, repeated capture idempotency.
  - `test_capture_integration.py` (4 tests): new capture saved, duplicate returns existing card with same ID, different deck creates separate card, Yomitan enrichment preserved end-to-end.
- **Extension unit test (1/1 passed)**: `capture-utils.test.js` — text normalization and Japanese boundary validation.
- **Live server 503 test**: with Yomitan not running, `/api/capture` now returns 503 (confirmed). Previously returned 500.

## Known issues

- **Live Yomitan verification pending**: Brave + Yomitan end-to-end test was not performed in this recovery session. The automated test suite covers all logic paths. Manual smoke test with Yomitan running is needed before the next handoff.

## Next task

Run live Yomitan verification: start uvicorn, enable extension in Brave, test 映画 / 日にち / 日本 / こんにちは / カメラ / 食べる / 見た. Verify `[SAVED]` on first capture, `[ALREADY SAVED]` on repeat. Verify SQLite row count. Commit Phase 3 changes. Then proceed to Phase 4 planning (Card Editing workflow and AnkiConnect synchronization).
