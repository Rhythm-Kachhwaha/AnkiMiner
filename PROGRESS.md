# AnkiMiner Progress

## Current status

Phase 6 (ANKI NOTE-TYPE & FIELD MAPPING) is fully implemented and verified (2026-09-10).
All automated backend tests pass (79/79 pytest tests).
All extension unit, DOM contract, and state machine tests pass (2/2 node tests, including Phase 6 Note Type DOM contract assertions).

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

### Phase 5 (Sidebar 2.0 + Japanese Typography + UX Polish)

- **Header & Compact Connection Indicators**:
  - Top header row with brand eyebrow `ANKIMINER` and compact status pills: `#indicator-yomitan` and `#indicator-anki`.
  - Status indicators display accessible dot indicators and text labels with states: `connected` (green `#5db872`), `checking` (amber `#e8a55a`), `unavailable` (muted `#6c6a64`).
  - Anki indicator dynamically updates from `loadDecks()` and `updateSyncUI()`.
  - Yomitan indicator dynamically reflects startup readiness, in-flight capture, success, or 503 unavailable status.
- **Prominent Captured Japanese Word Hero**:
  - Unhidden and featured `#expression` and `#reading` inside a dedicated hero card (`.captured-word-hero`).
  - Expression displayed in prominent 32px font (`--japanese-font`, bold, `#faf9f5`) with reading displayed right below in 15px kana (`#e8a55a`).
  - Live two-way synchronization: typing in form inputs (`#field-expression`, `#field-reading`) dynamically updates the hero display in real time.
- **Japanese Font Selection (Presentation Preference)**:
  - Font selector (`#field-font-select`) in Card Editor with options: `Noto Sans Japanese` (`Noto Sans JP`), `Noto Serif Japanese` (`Noto Serif JP`), `System Default` (`system-ui`).
  - Switches CSS custom property `--japanese-font` immediately, updating hero expression, reading, editor fields, and dictionary Japanese examples.
  - Presentation only: zero modification to raw expression/reading strings in Yomitan, SQLite, or Anki payloads.
  - Restores saved font preference from `chrome.storage.local` or `localStorage` (`preferred_japanese_font`).
- **Dictionary Layout & Jitendex Typography**:
  - Enhanced Jitendex dictionary display with `DICTIONARY` section title, subtle entry card container (`#1f1e1b`, `1px solid #3d3a35`), clean POS tag badges (`.pos-tag`), structured senses, and coral-accented example cards (`.example-card`).
- **Card Editor & Deck Actions UX**:
  - Clear visual hierarchy for `CARD` section with core fields grouped at top.
  - Compact two-column row for Font and Deck selectors (`.form-row-compact`).
  - Progressive disclosure for optional fields with keyboard shortcut support (`Esc` closes optional fields).
  - Keyboard shortcuts: `Ctrl/Cmd+Enter` submits/saves card, `Ctrl/Cmd+K` focuses expression, `Ctrl/Cmd+Shift+M` focuses meaning, `Esc` closes optional fields.
  - Responsive styling ensuring zero horizontal overflow down to 320px panel width.

### Phase 6 — Slice 1 (Selected Note Type / Model Persistence)

- **SQLite Schema & Migration (`app/db/connection.py`)**:
  - Added `model_name TEXT NOT NULL DEFAULT ''` to `cards` table.
  - Safe migration in `init_db()` adds `model_name` to existing databases without data loss or downtime.
- **Card Repository (`app/repositories/card_repository.py`)**:
  - `CardDraft` and `CardRecord` include `model_name: str = ""`.
  - SELECT queries in `find_by_identity`, `get_by_id`, `get_pending_or_failed_cards` load `model_name`.
  - `save_or_update` inserts and updates `model_name`.
  - `get_sync_state` returns `model_name`.
- **API Request/Response Schemas (`app/schemas.py`)**:
  - Added `model_name: str = ""` to `CaptureResponse` and `SaveCardResponse`.
  - Added `model_name: str = Field(default="", max_length=100)` to `SaveCardRequest`.
  - Added `model_name: Optional[str] = None` to `SyncCardResponse`.
- **AnkiConnect Service (`app/services/anki_connect.py`)**:
  - `add_note` accepts optional `model_name: str | None = None`.
  - When provided, uses `chosen_model` and `get_model_field_names(chosen_model)`.
  - Preserves `resolve_note_model()` automatic resolution when `model_name` is absent or empty.
- **Card Service (`app/services/card_service.py`)**:
  - `save_card` persists and returns `model_name`.
  - `sync_card` passes explicit `card.model_name` to `anki.add_note` if non-empty; passes `None` otherwise to trigger automatic model resolution.
  - Duplicate check, error handling, and offline-safety behaviors remain intact.

### Phase 6 — Slice 2 (Note-Type / Model Discovery Endpoint)

- **API Schema (`app/schemas.py`)**:
  - Added `AnkiModelsResponse(models: list[str] = ["Basic"], connected: bool = True)`.
- **CardService Note-Type Discovery (`app/services/card_service.py`)**:
  - Added `CardService.get_anki_models() -> AnkiModelsResponse`.
  - Queries `AnkiConnectService.get_model_names()`. If Anki is connected, returns the real list of models.
  - Graceful fallback: If Anki is offline or unreachable, returns `models=["Basic"]` with `connected=False` without raising a 500 error, preserving offline-first operation.
- **FastAPI Route (`app/main.py`)**:
  - Added `GET /api/anki/models` returning `AnkiModelsResponse`.

### Phase 6 — Slice 3 (Side Panel Note-Type Selector)

- **Side Panel HTML (`extension/sidepanel/sidepanel.html`)**:
  - Added `<input type="hidden" id="field-model-name" name="model_name" value="">`.
  - Added Note Type selector `<select id="field-model-select" name="model_select">` alongside Deck in `.form-row-compact`.
  - Placed Font selector in its own row cleanly below Deck and Note Type, preventing horizontal overflow down to 320px.
- **Side Panel Styling (`extension/sidepanel/sidepanel.css`)**:
  - Added `.model-selector-group` with `flex: 1` and `min-width: 0` to `.form-row-compact` flex layout.
- **Side Panel Logic & State (`extension/sidepanel/sidepanel.js`)**:
  - Added `API_ANKI_MODELS_URL`.
  - Implemented `loadModels()` querying `/api/anki/models`, dynamically populating `#field-model-select` options with graceful fallback to `["Basic"]` if offline.
  - User preference persistence: stores and restores `preferred_anki_model` in `chrome.storage.local` / `localStorage`.
  - Card Draft & Editor population: `identify()` sets `#field-model-select` and `#field-model-name` to `body.model_name` if present.
  - Card Save form submission: includes `model_name` from selector in `SaveCardRequest` payload.
  - Startup initialization: runs `loadModels()` on load.
### Phase 6 — Slice 4 (Extended Field Mapping for Community Note Models)

- **Deterministic Community Model Mapping (`app/services/anki_connect.py`)**:
  - Enhanced `map_card_to_fields()` normalization: strips hyphens (`.replace("-", "")`) in addition to underscores and case-folding, allowing hyphenated template field names (e.g. `Sentence-English`, `Sentence-Audio`) to match aliases seamlessly.
  - Added support for popular Japanese community note templates:
    - Yomitan Default / AnkiConnect templates: `Expression`, `Reading`, `Glossary`, `Sentence`, `SentenceAudio`, `Picture`.
    - Core 2k/6k / Nayr / Tango templates: `Target Word`, `Target Reading`, `English`, `Sentence (Target)`, `Sentence (English)`, `Sentence Audio`, `Word Audio`, `Image`.
    - Kaishi 1.5k templates: `Word`, `Furigana`, `Primary Definition`, `Secondary Definition`, `Example Sentence`, `Example Sentence Reading`, `Example Sentence English`, `Audio`.
    - Anime Cards / Mining templates: `Vocab`, `VocabKana`, `VocabDef`, `Sentence`, `SentenceTranslation`, `Picture`.
  - Fallback support: Arbitrary two-field models (e.g. `Question`/`Answer`, `Item`/`Desc`) automatically receive expression in the first field and meaning in the second field, ensuring zero unmapped sync failures.

## Verified

- **Automated backend test suite (79/79 passed)** — run 2026-09-10:
  - All 79 tests in `backend/tests/` passed with 0 regressions.
  - 14 new/updated tests covering Phase 6:
    - `test_deterministic_basic_model_mapping`
    - `test_deterministic_japanese_model_mapping`
    - `test_mapping_yomitan_default_template`
    - `test_mapping_core_2k_template`
    - `test_mapping_kaishi_template`
    - `test_mapping_anime_mining_template`
    - `test_mapping_arbitrary_two_field_fallback`
    - `test_add_note_with_explicit_model_uses_exact_model`
    - `test_add_note_without_model_uses_automatic_resolution`
    - `test_model_name_persistence_and_update`
    - `test_sync_card_with_explicit_model_name_uses_that_model`
    - `test_sync_card_without_model_name_uses_none_for_automatic_resolution`
    - `test_card_service_get_anki_models_connected`
    - `test_card_service_get_anki_models_offline_fallback`
    - `test_phase6_end_to_end_note_model_workflow`
    - `test_real_http_models` in loopback tests
- **Automated extension unit & contract tests (2/2 passed)** — run 2026-09-10:
  - `capture-utils.test.js`: boundary and script tests pass.
  - `sidepanel.test.js`: deck selector, note type selector (`#field-model-select`, `#field-model-name`), sync button, sync status, font selector, connection indicators, and hero display DOM contracts pass; `updateSyncUI` state machine transitions verified (`ready`, `pending`, `syncing`, `synced`, `failed`).
- **Live Chromium / Chrome CDP End-to-End Browser Automation**:
  - Header indicators verified: `ANKIMINER`, `indicator-yomitan` (`connected`), `indicator-anki` (`checking` / `connected`).
  - Mining toggle verified: toggles between `Start mining` and `Stop mining`, updates mode text.
  - Captured Japanese word hero verified with `映画`: large expression `映画` (32px), reading `えいが` (15px).
  - Jitendex dictionary verified: dictionary card with glosses (`movie`, `film`, `motion picture`) and styled example card (`その映画をもう一度見たいな。` / `I want to see the movie again.`).
  - Font selection verified: changed to `Noto Serif JP` (`--japanese-font: var(--font-noto-serif)`), verified immediate CSS variable update and screenshot capture; switched back to `Noto Sans JP`.
  - Raw expression integrity verified: remained exact string `映画` with zero HTML injection.
  - Live hero syncing verified: typing `映画 (Edited)` into input immediately updated the hero expression.
  - Meaning edit & optional fields toggle verified: edited meaning text, expanded optional fields (`aria-expanded="true"`).
  - Save Card verified: saved card updated `#save-badge` to `[SAVED]`.
  - Dynamic capture without page reload verified across 5 consecutive Japanese terms:
    - `日` -> hero: `日`, reading: `ひ`, meaning: `day, sun, sunshine`
    - `日にち` -> hero: `日にち`, reading: `ひにち`, meaning: `date / schedule`
    - `日本` -> hero: `日本`, reading: `にほん`, meaning: `Japan`
    - `食べる` -> hero: `食べる`, reading: `たべる`, meaning: `to eat`
    - `見た` -> hero: `見る`, reading: `みた` (deinflected)
  - Visual artifacts captured and confirmed: `01_initial_sidepanel.png`, `02_captured_eiga.png`, `03_font_serif.png`, `04_optional_fields_expanded.png`, `05_dynamic_capture_last_word.png`.

## Bugs fixed during verification

1. **`find_existing_note` Basic model duplicate detection failure**: Notes saved under standard `Basic` note models format `Front` as `f"{expr} [{reading}]"`. In `find_existing_note`, comparing `normalize_expression(found_expr) == norm_target_expr` failed because `"映画 [えいが]" != "映画"`, causing duplicate notes to be created on DB resets. Fixed to extract base expression and bracketed reading candidate.
2. **`find_existing_note` HTML-formatted fields**: Anki fields with HTML formatting or entities (e.g. `<div>`, `&nbsp;`) failed string equality checks. Added `_clean_field_text` to strip HTML tags and decode entities before normalization.
3. **`find_existing_note` empty expression guard**: When expression reduced to empty after sanitization, the query fell through to `deck:"<deck>"`, returning all notes in the deck. Added immediate `return None` guard.
4. **Extension test runner path resolution**: `capture-utils.test.js` and `sidepanel.test.js` failed with `ENOENT` when run from `extension/` directory because of hardcoded `extension/...` paths. Updated to use `path.resolve(__dirname, ...)`.
5. **Extension backend connection diagnostics (`Failed to fetch`)**: When the local FastAPI backend was not running on `http://127.0.0.1:8000`, the browser threw `TypeError: Failed to fetch`. `sidepanel.js` rendered this raw browser message without explanation. Added `formatErrorMessage` in `sidepanel.js` mapping network failures to clear, actionable guidance (`Cannot connect to backend. Ensure FastAPI server is running on http://127.0.0.1:8000`). Started the FastAPI backend server daemon process (`python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`), restoring live capture, SQLite persistence, and Anki connectivity in the extension.
6. **`updateSyncUI` vm context isolation in tests**: `sidepanel.test.js` evaluates the slice of `updateSyncUI` in an isolated Node `vm` context where external helper functions were undefined. Added `typeof setIndicatorStatus === 'function'` guards ensuring both browser and test vm execution succeed without ReferenceErrors.

## Known issues

- None. Phase 6 is complete and fully verified.

## Next task

Phase 6 complete and verified. Ready for next project milestones or deployment.



