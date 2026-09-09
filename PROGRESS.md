# AnkiMiner Progress

## Current status

Phase 3 is fully implemented and end-to-end verified across the complete live stack (Brave + Yomitan + FastAPI + SQLite).
All automated tests pass (20/20 backend, 1/1 extension).
All live browser pipeline verification checks pass with 100% success.

**Fixed regression**: `http.client.RemoteDisconnected` (an `OSError` subclass, not a `URLError`) was not caught by `YomitanService._post_json`, causing a bare 500 Internal Server Error instead of a proper 503 when Yomitan dropped a connection mid-response. Now fixed — server returns 503 when Yomitan is unavailable (confirmed by live test). Mock patch target in `test_yomitan.py` updated to `app.services.yomitan.urlopen` to properly isolate unit test from live Yomitan service.

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
  - `POST /api/capture` now accepts optional `deck_name` (defaults to `"Default"`). Response includes `id`, `status` (`"saved"` / `"already_saved"`), `is_duplicate`.
- **Side Panel Persistence Display**:
  - `sidepanel.html`: added `#save-badge` element.
  - `sidepanel.css`: `.badge.saved` (green) and `.badge.already-saved` (amber) styled per `DESIGN.md` tokens.
  - `sidepanel.js`: shows `[SAVED]` on new card, `[ALREADY SAVED]` on duplicate.
- **Bug fix**: `YomitanService._post_json` now catches `OSError` (covers `RemoteDisconnected`) in addition to `URLError`/`TimeoutError`, ensuring all Yomitan unavailability raises `YomitanUnavailableError` → 503, never a bare 500.

## Verified

- **All backend tests (20/20 passed)**:
  - `test_yomitan.py` (5 tests): normalization, deinflection, hiragana/katakana/kanji, malformed payloads, `RemoteDisconnected` raises `YomitanUnavailableError` regression test.
  - `test_dictionary.py` (3 tests): entry parsing, sense/POS/ruby/example, malformed payloads.
  - `test_capture_route.py` (1 test): route delegates correctly to CardService with mocked Yomitan.
  - `test_card_repository.py` (7 tests): insert, retrieve by ID/identity, duplicate detection, deck-scoped identity, normalization, repeated capture idempotency.
  - `test_capture_integration.py` (4 tests): new capture saved, duplicate returns existing card with same ID, different deck creates separate card, Yomitan enrichment preserved end-to-end.
- **Extension unit test (1/1 passed)**: `capture-utils.test.js` — text normalization and Japanese boundary validation.
- **Live server 503 test**: with Yomitan not running, `/api/capture` returns 503 (confirmed).
- **Live Brave + Yomitan + FastAPI + SQLite end-to-end browser test (100% passed)**:
  - Extension loaded into real Brave browser via CDP with Side Panel and mining toggle enabled.
  - Verified pipeline for all 7 primary words:
    - 映画 (kanji) → expression `映画`, reading `えいが`, badge `[SAVED]`, 1 entry, SQLite row 1 saved
    - 日にち (mixed Japanese) → expression `日にち`, reading `ひにち`, badge `[SAVED]`, 6 entries, SQLite row 2 saved
    - 日本 (kanji) → expression `日本`, reading `にほん`, badge `[SAVED]`, 7 entries, SQLite row 3 saved
    - こんにちは (hiragana) → expression `今日は`, reading `こんにちは`, badge `[SAVED]`, 8 entries, SQLite row 4 saved
    - カメラ (katakana) → expression `カメラ`, reading `カメラ`, badge `[SAVED]`, 34 entries, SQLite row 5 saved
    - 食べる (verb/mixed) → expression `食べる`, reading `たべる`, badge `[SAVED]`, 5 entries, SQLite row 6 saved
    - 見た (deinflection) → expression `見る`, reading `みる`, badge `[SAVED]`, 3 entries, SQLite row 7 saved
  - Repeated duplicate test (映画 x 3):
    - First capture: `[SAVED]`, status `saved`, 1 SQLite row for 映画
    - Second capture: `[ALREADY SAVED]`, status `already_saved`, SQLite row count unchanged (still 1 row for 映画)
    - Third capture: `[ALREADY SAVED]`, status `already_saved`, SQLite row count unchanged (still 1 row for 映画)
  - Dynamic subtitles without page reload:
    - `映画を見る` → selected `映画` → Side Panel rendered `[ALREADY SAVED]`
    - Advanced subtitle to `日にちを決める` without reload → selected `日にち` → Side Panel rendered `[ALREADY SAVED]`
    - Advanced subtitle to `日本へ行く` without reload → selected `日本` → Side Panel rendered `[ALREADY SAVED]`
    - Selected new word `行く` from dynamic subtitle → Side Panel rendered `[SAVED]`, reading `いく`, 8 total cards in SQLite
  - Phase 2 behaviors verified intact: kanji, hiragana, katakana, mixed Japanese, deinflection, and no reload.

## Known issues

- None. Phase 3 is fully operational and verified live.

## Next task

Phase 4 planning: Card Editing workflow and AnkiConnect synchronization.
