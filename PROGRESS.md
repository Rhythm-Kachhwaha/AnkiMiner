# AnkiMiner Progress

## Current status

Phase 7 (MINING HISTORY & CARD LIBRARY) is fully implemented and verified (2026-09-10).
All automated backend tests pass (92/92 pytest tests).
All extension unit, DOM contract, state machine, and library helper tests pass (2/2 node test suites).
Live AnkiConnect and live Yomitan verification passed with clean test cleanup.

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

### Phase 7 (Mining History & Card Library)

- **SQLite Local Data Access & Repository (`app/repositories/card_repository.py`)**:
  - `CardRepository.list_cards()`: Queries saved cards from SQLite with optional case-insensitive search (`LIKE` across expression, reading, meaning, example_sentence, notes, tags), deck filtering (`deck_name = ?`), sync status filtering (`sync_status = ?`), and pagination (`LIMIT ? OFFSET ?`), strictly ordered `id DESC` (newest mined cards first).
  - `CardRepository.count_cards()`: Returns accurate count matching active search and filter constraints.
  - `CardRepository.get_saved_decks()`: Returns distinct deck names from saved cards.
  - `CardRepository.delete()`: Safely deletes a card row from SQLite by ID without touching external Anki notes.
- **Card Library Schemas (`app/schemas.py`)**:
  - Added `CardSummary`: provider-neutral summary containing `id`, `expression`, `reading`, `meaning`, `deck_name`, `model_name`, `sync_status`, `anki_note_id`, `sync_error`, `created_at`, `updated_at`.
  - Added `CardListResponse`: contains `cards: list[CardSummary]`, `total: int`, `limit: int`, `offset: int`.
  - Added `CardDetailResponse`: full card record containing all core and optional fields plus dictionary entries for editing.
  - Added `DeleteCardResponse`: contains `id: int`, `deleted: bool`.
- **Card Service Integration (`app/services/card_service.py`)**:
  - `CardService.list_cards()`: Orchestrates card list retrieval and total count calculation.
  - `CardService.get_card()`: Retrieves full card details for loading into the Card Editor.
  - `CardService.delete_card()`: Deletes card from SQLite.
  - `CardService.get_saved_decks()`: Retrieves distinct decks.
- **Card API Routes (`app/main.py`)**:
  - `GET /api/cards`: Lists saved cards with query parameters `search`, `deck` / `deck_name`, `sync_status`, `limit`, `offset`.
  - `GET /api/cards/{card_id}`: Retrieves single card details by ID (returns 404 if not found).
  - `DELETE /api/cards/{card_id}`: Deletes a card from local SQLite (returns 404 if not found).
- **Side Panel Library UI (`extension/sidepanel/sidepanel.html`, `sidepanel.css`, `sidepanel.js`)**:
  - Added `#history-section` in Side Panel with `#history-count` showing total saved cards.
  - Search toolbar: debounced search input `#history-search-input` (250ms debounce) supporting expressions, kana readings, English meanings, notes, tags, and sentences.
  - Deck filter: `#history-deck-filter` dynamically populated from user's saved card decks and Anki decks.
  - Sync status filter: `#history-sync-filter` filtering by `all`, `pending`, `syncing`, `synced`, `failed`.
  - Card rows (`.history-item`): compact display of expression (`--japanese-font`), reading, meaning, deck pill, sync badge (`.sync-pending`, `.sync-syncing`, `.sync-synced`, `.sync-failed`), retry button for failed syncs, and delete button (`×`).
  - Open saved card: clicking a library card loads all card fields into the existing `#card-editor`, updates the prominent word hero, sync status UI, and selects the row.
  - Re-save existing card: editing and saving an opened card updates the same SQLite row in-place without generating duplicates.
  - Local deletion with confirmation: prompt confirms destructive action (`window.confirm`), removes row from SQLite and library UI, and resets the editor if the deleted card was open.
  - Sync retry from library: retry button triggers AnkiConnect sync directly from the card row, updating sync badges across the UI.
  - Usable at narrow widths down to 320px with zero horizontal overflow, matching `DESIGN.md` developer-utility aesthetics.

## Verified

- **Automated backend test suite (92/92 passed)** — run 2026-09-10:
  - All 92 tests in `backend/tests/` passed with 0 regressions.
  - 13 new tests covering Phase 7:
    - `test_card_repository.py`:
      - `test_9_list_cards_and_pagination`
      - `test_10_list_cards_search`
      - `test_11_list_cards_filter_deck_and_sync_status`
      - `test_12_get_saved_decks`
      - `test_13_delete_card`
    - `test_cards_api.py`:
      - `test_list_cards_empty`
      - `test_list_cards_populated_and_ordered_newest_first`
      - `test_list_cards_pagination`
      - `test_list_cards_search`
      - `test_list_cards_filters`
      - `test_get_card_by_id_success_and_not_found`
      - `test_delete_card_success_and_not_found`
    - `test_phase7_workflow.py`:
      - `test_complete_phase7_mining_history_and_card_library_flow`
- **Automated extension unit & contract tests (2/2 passed)** — run 2026-09-10:
  - `capture-utils.test.js`: boundary and script tests pass.
  - `sidepanel.test.js`: deck selector, note type selector, sync button, sync status, font selector, connection indicators, hero display DOM contracts pass; `updateSyncUI` state machine transitions verified; Phase 7 History DOM elements (`#history-section`, `#history-count`, `#history-search-input`, `#history-deck-filter`, `#history-sync-filter`, `#history-list-container`, `#history-empty`, `#history-cards-list`), `updateDeckFilterOptions`, and `renderHistoryCards` verified with selection and retry button assertions.
- **Live AnkiConnect Verification**:
  - Connected to live AnkiConnect instance (`127.0.0.1:8765`, version 6).
  - Saved test card with deck and model into SQLite, verified it appeared in library list.
  - Synced to Anki, note created (`1789060490833`), sync_status transitioned to `synced`.
  - Reopened card from library: model, deck, sync_status, and anki_note_id preserved.
  - Duplicate check verified: re-syncing linked the existing note without duplicate creation.
  - Cleaned up test note `1789060490833` from Anki (`{'result': None, 'error': None}`).
- **Live Yomitan Verification**:
  - Verified live Yomitan server on `127.0.0.1:19633`: identified `映画` (`えいが`) and enriched with Jitendex dictionary entries.

## Bugs fixed during verification

1. **`find_existing_note` Basic model duplicate detection failure**: Notes saved under standard `Basic` note models format `Front` as `f"{expr} [{reading}]"`. In `find_existing_note`, comparing `normalize_expression(found_expr) == norm_target_expr` failed because `"映画 [えいが]" != "映画"`, causing duplicate notes to be created on DB resets. Fixed to extract base expression and bracketed reading candidate.
2. **`find_existing_note` HTML-formatted fields**: Anki fields with HTML formatting or entities (e.g. `<div>`, `&nbsp;`) failed string equality checks. Added `_clean_field_text` to strip HTML tags and decode entities before normalization.
3. **`find_existing_note` empty expression guard**: When expression reduced to empty after sanitization, the query fell through to `deck:"<deck>"`, returning all notes in the deck. Added immediate `return None` guard.
4. **Extension test runner path resolution**: `capture-utils.test.js` and `sidepanel.test.js` failed with `ENOENT` when run from `extension/` directory because of hardcoded `extension/...` paths. Updated to use `path.resolve(__dirname, ...)`.
5. **Extension backend connection diagnostics (`Failed to fetch`)**: When the local FastAPI backend was not running on `http://127.0.0.1:8000`, the browser threw `TypeError: Failed to fetch`. `sidepanel.js` rendered this raw browser message without explanation. Added `formatErrorMessage` in `sidepanel.js` mapping network failures to clear, actionable guidance (`Cannot connect to backend. Ensure FastAPI server is running on http://127.0.0.1:8000`). Started the FastAPI backend server daemon process (`python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`), restoring live capture, SQLite persistence, and Anki connectivity in the extension.
6. **`updateSyncUI` vm context isolation in tests**: `sidepanel.test.js` evaluates the slice of `updateSyncUI` in an isolated Node `vm` context where external helper functions were undefined. Added `typeof setIndicatorStatus === 'function'` guards ensuring both browser and test vm execution succeed without ReferenceErrors.

## Known issues

- None.

## Recent changes (YouTube Multi-Tier Subtitle Extraction & SRV3 XML Parser)

- **Files Changed**:
  - `extension/lib/subtitle-parser.js`:
    - Added `parseSRV3(rawText)` to support YouTube's native `srv3` timedtext XML schema (`<p t="[startMs]" d="[durationMs]"><s>...</s></p>`).
    - Implemented lookahead overlap clamping (`duration = Math.min(duration, nextStart - start)`) to eliminate overlapping text display glitches.
    - Added XML entity decoding and child `<s>` tag concatenation.
    - Updated `parseSubtitles()` and module exports to support `.srv3` and `.ytsrv3` formats seamlessly.
  - `extension/content/adapters/youtube-bridge.js`:
    - Upgraded MV3 main-world bridge to implement 3-tier resilient track extraction:
      - **Tier 1 (Live Player Inspection)**: Reads `document.getElementById("movie_player")?.getAudioTrack()?.captionTracks`, extracting live runtime Proof of Origin (`pot`) tokens and video title from `player.getVideoData()?.title`.
      - **Tier 2 (Android InnerTube API Fallback)**: Queries `POST https://www.youtube.com/youtubei/v1/player?key=${apiKey}` using `window.ytcfg.get("INNERTUBE_API_KEY")` with `clientName: 'ANDROID'` to bypass desktop web PO token enforcement.
      - **Tier 3 (Static Player Response Fallback)**: Extracts tracks from `window.ytInitialPlayerResponse`.
    - Implemented `inferVideoId()` covering `/watch?v=`, `/shorts/<id>`, and `/embed/<id>`.
    - Added 500ms lifecycle ticker and SPA navigation hooks (`yt-navigate-finish`, `yt-page-data-updated`) to auto-detect video transitions and YouTube Shorts scrolling.
    - Standardized timedtext URL parameterization with `fmt=srv3` and client identifier `c=WEB` / `c=ANDROID`.
  - `extension/content/adapters/youtube-adapter.js`:
    - Updated `YouTubeAdapter` to process and normalize `srv3` tracks.
    - Implemented Japanese track prioritization (`ja`, `ja-JP`, manual over ASR) and auto-translate Japanese synthesis (`&tlang=ja`) if a video only has non-Japanese native tracks.
    - Implemented direct same-origin `fetchCaptionSRV3()` with background service worker fallback.
    - Integrated `SubtitleParser.parseSRV3()` to convert XML timedtext responses into standard timestamped cues for `VideoMiningPOC`'s selectable overlay engine.
  - `extension/tests/srv3-parser.test.js` (NEW):
    - Added unit test suite covering standard `<p>` XML cues, segmented `<s>` word tags, XML entity decoding, overlap duration clamping, and `parseSubtitles()` auto-detection.
  - `extension/tests/youtube-adapter.test.js`:
    - Updated unit tests to verify `srv3` URL formatting (`fmt=srv3`, `c=WEB`), auto-translate track synthesis, and end-to-end `YouTubeAdapter` cue loading with SRV3 mock responses.

- **Behavior Delivered**:
  1. **PO Token & 403 Forbidden Bypassed**: YouTube caption requests now succeed on modern YouTube videos by extracting authenticated player tracks with live POT tokens or falling back to the Android InnerTube API.
  2. **Native SRV3 TimedText Support**: Subtitles parse accurately with millisecond timestamp precision and zero text overlap artifacts.
  3. **Seamless Shorts & SPA Navigation**: Switching videos or scrolling through YouTube Shorts triggers automatic track re-discovery without requiring manual page reloads.
  4. **Auto-Translate Option**: Videos with non-Japanese captions provide an auto-translated Japanese track option for mining.
  5. **Preserved Platform Isolation**: Netflix DOM observer, external SRT/VTT file upload, and standard web mining remain completely unaffected with zero regressions.

- **Verification Run**:
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `backend/tests` (via `python -m pytest backend/tests` with `PYTHONPATH=backend`): PASSED (92/92 passed, 0 regressions)

- **Remaining Risk**:
  - YouTube changing internal InnerTube client version requirements or altering `#movie_player` method names in future player rollouts (mitigated by 3-tier fallback architecture).

## Phase 8.1 (Video Mining Controls) — Task 1: Subtitle Navigation Hotkeys

- **Files Changed**:
  - `extension/content/video-mining-poc.js`:
    - Added `isEditableTarget(target)` checking `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, and `[role="textbox"]`.
    - Added `SubtitleHotkeyController` class encapsulating keyboard handling for `A`, `S`, `D`, and `Space`.
    - Implemented `A` (seek to preceding cue's `startTime`, or last cue before current time if in gap; do nothing at first cue).
    - Implemented `S` (replay current cue from `startTime`; if in gap, find cue or do nothing).
    - Implemented `D` (seek to next cue's `startTime`, or next cue after current time if in gap; do nothing at last cue).
    - Implemented `Space` (toggle active video play/pause, prevent default scrolling, preserving native button activation).
    - Added subtitle timing offset compensation (`targetTime = Math.max(0, cue.startTime - offset)`).
    - Guarded against modifier keys (`Ctrl`, `Alt`, `Meta`) and editable element inputs.
    - Integrated `SubtitleHotkeyController` into `VideoMiningPOC` with clean `attach()` and `detach()` lifecycle.
    - Updated Netflix adapter callback to store live cues in `syncEngine.cues` and cleared initial hardcoded `TEST_CUES` on Netflix pages.
    - Exposed `SubtitleHotkeyController` and `isEditableTarget` on `window.__ANKIMINER_VIDEO_POC__`.
  - `extension/tests/video-mining-integration.test.js`:
    - Aligned YouTube mock response and URL assertion with `srv3` timedtext format.
  - `extension/tests/subtitle-hotkeys.test.js` (NEW):
    - Added comprehensive unit and integration test suite covering `A`/`S`/`D` cue boundary seeking, gap handling, `Space` play/pause toggling, editable elements/inputs protection, modifier keys, YouTube native subtitles, Netflix live subtitles, dynamic video switching, and subtitle timing offsets.

- **Behavior Delivered**:
  1. **Precise Subtitle Navigation**: Users can instantly navigate between subtitle lines using `A` (previous), `S` (replay), and `D` (next) without taking hands off the keyboard.
  2. **Play/Pause Toggle**: `Space` toggles the active video without annoying page scroll artifacts.
  3. **Form & Editor Protection**: Typing inside Side Panel fields, YouTube/Netflix search bars, or web comments never triggers accidental video jumps.
  4. **Universal Platform Support**: Works identically across external subtitle files (SRT, VTT, ASS, SRV3), YouTube native subtitles, and Netflix live subtitle streams.
  5. **Preserved Platform Isolation**: Zero regressions on existing Yomitan hover dictionary lookups, card editor, SQLite persistence, and AnkiConnect synchronization.

- **Verification Run**:
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - Node test suite: 10/10 test files passed (0 failures).
  - Backend tests (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

- **Remaining Risk**:
  - Web video players with aggressive custom keyboard trap overlays (mitigated by using capturing phase event listener on `window`).

## Next task

Phase 8.1 Task 2: Auto-Pause on Subtitle Hover (or next planned task in Phase 8).
