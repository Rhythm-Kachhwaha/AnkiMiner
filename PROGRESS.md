# AnkiMiner Progress

## Current status

Phase 3.3 (CARD EDITOR) is fully implemented and end-to-end verified across the complete live stack (Brave + Yomitan + FastAPI + SQLite).
All automated backend tests pass (33/33 pytest tests).
Extension unit tests pass (1/1 node test).
All live browser pipeline verification checks pass with 100% success.

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

## Verified

- **Automated backend test suite (33/33 passed)**:
  - `test_card_editor.py` (13 tests):
    1. New card draft creation without auto-save.
    2. Editing expression before save.
    3. Editing reading before save.
    4. Editing meaning before save.
    5. Saving optional fields (hint, example sentences, tags, notes).
    6. Save creates exactly one SQLite row.
    7. Duplicate save does not create another row.
    8. Existing card loads into editor with existing values.
    9. Editing existing card updates the existing row in place.
    10. Editing existing card does not increment session count.
    11. New card save increments session count (`is_new: True`).
    12. Duplicate capture does not increment session count (`is_duplicate: True`).
    13. Validation errors (blank expression) reject save and do not create DB rows.
  - `test_card_repository.py` (7 tests): all CRUD and duplicate prevention tests pass.
  - `test_capture_integration.py` (4 tests): end-to-end capture and save integration tests pass.
  - `test_capture_route.py` (1 test): route delegation passes.
  - `test_dictionary.py` (3 tests): dictionary parsing and error handling pass.
  - `test_yomitan.py` (5 tests): tokenization, deinflection, script variants, and network error handling pass.
- **Automated extension unit tests (1/1 passed)**:
  - `capture-utils.test.js`: text normalization and Japanese script boundary tests pass.
- **Live Brave + Yomitan + FastAPI + SQLite end-to-end browser test (100% passed)**:
  - Extension loaded into real Brave browser via CDP with Side Panel and mining toggle enabled.
  - Session counter starts at `Cards this session: 0`, editor initially hidden.
  - Selecting `映画` loads draft (Expression: `映画`, Reading: `えいが`, Meaning populated). SQLite card count before save remains `0` (no auto-persist verified).
  - Edited meaning to `movie / film` and clicked `[Save Card]`: badge updated to `[SAVED]`, session counter incremented to `Cards this session: 1`, SQLite row count = `1`.
  - Selecting `日にち` loaded draft, edited meaning to `date / schedule`, saved: badge `[SAVED]`, session counter incremented to `Cards this session: 2`, SQLite row count = `2`.
  - Selecting `映画` again: loaded existing card into editor, badge displayed `[ALREADY SAVED]`, session counter remained `2`, SQLite count remained `2`.
  - Edited existing card to `movie / film (updated)` and saved: badge displayed `[SAVED]`, session counter remained `Cards this session: 2` (did not increment), SQLite count remained `2`, and existing row was updated.
  - Tested optional fields with `日本`: clicked `[+ Optional fields]` toggle, revealed fields, filled Hint, Tags, Notes, and saved: badge `[SAVED]`, session counter incremented to `3`, optional fields verified in SQLite.
  - Phase 2 regression verified with script variants and deinflection:
    - `こんにちは` (hiragana) → saved (`Cards this session: 4`, DB count 4).
    - `カメラ` (katakana) → saved (`Cards this session: 5`, DB count 5).
    - `食べる` (verb/mixed) → saved (`Cards this session: 6`, DB count 6).
    - `見た` (deinflection → `見る`) → saved (`Cards this session: 7`, DB count 7).
  - Dynamic subtitles without page reload verified:
    - `映画を見る` → selected `映画` → loaded `[ALREADY SAVED]`.
    - Subtitle advanced to `日にちを決める` without reload → selected `日にち` → loaded `[ALREADY SAVED]`.
    - Subtitle advanced to `日本へ行く` without reload → selected `日本` → loaded `[ALREADY SAVED]`.
    - Selected new word `行く` from dynamic subtitle → loaded draft, saved → `Cards this session: 8`, SQLite final count = `8`.

## Known issues

- None. Phase 3.3 is fully operational and verified live.

## Next task

Phase 4 planning: AnkiConnect synchronization and deck configuration.
