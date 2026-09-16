# Kiroku (formerly AnkiMiner) — V1.0 Foundation Audit Report
**Document Path:** `V1/Stage1.md`  
**Execution Type:** Research & Audit Only (Zero Source Code Changes)  
**Date:** 2026-09-16  
**Status:** Complete  

---

## 1. Executive Summary

### 1.1 Context and Repository State
The repository represents a working, local-first Japanese vocabulary mining pipeline optimized for high-speed card creation (~10 seconds per card) from browser-based media (YouTube, HiAnime, generic web pages) into Anki via AnkiConnect.

- **Git Status:** Clean working tree on branch `main` (`origin/main`).
- **Test Baseline:**
  - **Backend:** 135/135 tests passing (`100%`) via `python -m pytest` across 16 test files.
  - **Extension:** 26/26 test suites passing (`100%`) via Node.js test runners across 26 test files.
- **Core Working Capabilities:**
  1. Passive video frame screenshot capture via HTML5 canvas & `chrome.tabs.captureVisibleTab` with coordinate clamping, aspect ratio preservation, and black-frame DRM detection.
  2. Text selection & video subtitle mining (supporting YouTube SRV3/VTT, local WebVTT/SRT uploads, and HiAnime custom players).
  3. Yomitan tokenization and dictionary lookups over local HTTP (`http://127.0.0.1:19633`).
  4. Local SQLite card persistence with strict duplicate identity normalization: `(normalized_expression, normalized_reading, normalized_deck_name)`.
  5. AnkiConnect integration with deterministic note model resolution (Basic and Japanese mining models), duplicate note detection across local resets, and local media file synchronization.
  6. DRM fail-soft handling on protected streams (Widevine on Netflix).

### 1.2 Identified Architectural & Codebase Strengths
- **Hard Playback Invariant Maintained:** Zero video playback disruption (no forced pausing, seeking, element replacement, or timeline corruption).
- **SQLite-First Authoritative Storage:** External failures (AnkiConnect offline, Yomitan restart) never drop or corrupt a mined card. Cards persist in SQLite with explicit state machines (`pending`, `syncing`, `synced`, `failed`).
- **Clean Service Boundaries in Backend:** The repository pattern (`CardRepository`) isolates SQLite operations, `YomitanService` encapsulates dictionary HTTP access, and `AnkiConnectService` isolates JSON-RPC calls.

### 1.3 Critical Weaknesses Identified for V1.0
1. **Dictionary Parsing & Presentation (High Priority):** Raw Yomitan AST nodes are aggressively flattened. The backend flattens parts-of-speech to the top level, drops frequency/pitch data, and extracts only the *first* sense of the first entry for the card draft's meaning field. The frontend then attempts haphazard client-side string deduplication.
2. **Frontend DOM Tight Coupling:** The Side Panel (`sidepanel.js`) contains over 45 hardcoded `document.querySelector("#...")` element lookups at the root scope. Any minor HTML class/ID tweak during visual redesign risks breaking script initialization.
3. **Anki Card HTML Formatting:** Basic cards are generated with primitive `<br><br>` concatenation devoid of semantic HTML tags or CSS classes, resulting in unstyled, raw text dumps in Anki.
4. **Documentation Inconsistencies:** 
   - No `README.md` exists in the repository root.
   - `DESIGN.md` is an Anthropic Claude.com marketing website design token dump, not a product spec for a dark developer utility Side Panel.
   - Root directory contains leftover scratch and test JSON artifacts (`termentries_result.json`, `tokenize_result.json`, `capture_result.json`, `structure.txt`, `extract_examples.py`).

### 1.4 Documentation Audit

| Document | Status | Action for V1.0 | Rationale |
| :--- | :--- | :--- | :--- |
| `AGENTS.md` | **Active & Authoritative** | **KEEP** | Core project boundaries and multi-agent rules. Must remain untouched. |
| `ARCHITECTURE.md` | **Active & Authoritative** | **KEEP (Update in Stage 2)** | Accurately describes components, but needs update when project is renamed to Kiroku and dictionary contract is refined. |
| `PROGRESS.md` | **Active & Authoritative** | **KEEP** | Complete historical ledger of features and verification steps. |
| `DESIGN.md` | **Obsolete / Misplaced** | **MIGRATE & ARCHIVE** | Contains Claude.com marketing website specs. Dark UI tokens should be extracted into a dedicated `UI_SPEC.md` or `ARCHITECTURE.md`, then archived. |
| `DECISIONS.md` | **Useful Historical Record** | **KEEP** | Documents Phases 1–4 architectural decisions clearly. |
| `IGNORE.md` | **Active & Accurate** | **KEEP** | Guides agents on build artifacts and temporary files. |
| `MEDIA_MINING_RESEARCH_AND_STEPS.md` | **Reference / Research** | **ARCHIVE to docs/** | Comprehensive video mining investigation; useful background, but should not clutter root. |
| `AudioFeatureReport.md` | **Reference (Postponed v3)** | **ARCHIVE to docs/** | Invaluable technical audit of the audio pipeline; keep for v3 reference. |
| `Frame/Stage1.md` - `Stage4.md` | **Milestone Reports** | **KEEP in Frame/** | Documents frame capture pipeline hardening and regressions. |
| `Audio/Stage1.md` - `stage5.md` | **Milestone Reports** | **KEEP in Audio/** | Documents audio pipeline architecture and fixes. |
| `README.md` | **Missing** | **CREATE (Stage 8)** | Currently absent. Essential for public release. |
| Root `.json` & `.py` scratch files | **Obsolete / Test Scaffolds** | **DELETE / CLEANUP (Stage 1/2)** | `termentries_result.json`, `tokenize_result.json`, `capture_result.json`, `structure.txt`, `extract_examples.py`, `inspect_structure.py`, `test_capture.py`, `test_yomitan.py`. |

---

## 2. Current Architecture & V1 Inventory

```
+-----------------------------------------------------------------------------------------+
|                                    CHROMIUM / BRAVE BROWSER                             |
|                                                                                         |
|  [ Web Page Context ]                                                                   |
|   - Generic Text Selection (content.js, capture-utils.js)                               |
|   - Video Mining Subtitle Overlay (video-mining-poc.js, image-cropper.js)               |
|   - Site Adapters: youtube-adapter.js, youtube-bridge.js, netflix-adapter.js            |
|                              |                                                          |
|                              | chrome.runtime messaging                                 |
|                              v                                                          |
|  [ Extension Service Worker ] (background.js)                                           |
|   - Tab mining state management & tab activation sync                                   |
|   - captureVisibleTab execution for cross-origin canvases                               |
|   - Offscreen document lifecycle management (offscreen.html, offscreen.js)              |
|                              |                                                          |
|                              | direct / runtime messaging                               |
|                              v                                                          |
|  [ Extension Side Panel ] (sidepanel.html, sidepanel.js, sidepanel.css)                 |
|   - Word Display Hero (expression, reading)                                             |
|   - Card Editor Form (expression, reading, meaning, deck, model, font, optional)       |
|   - Media Previews (Screenshot image preview, sentence audio player [v3])               |
|   - Dictionary View (Study view with POS, badges, numbered senses, examples)            |
|   - Mining History & Library (Search, deck/sync filters, card edit/sync)                |
|                              |                                                          |
+------------------------------|----------------------------------------------------------+
                               | REST API (HTTP localhost:8000)
                               v
+-----------------------------------------------------------------------------------------+
|                               FASTAPI BACKEND (Python 3.11)                             |
|                                                                                         |
|  [ API Layer: app/main.py ]                                                             |
|   - POST /api/capture               POST /api/cards/save         GET /api/cards         |
|   - GET  /api/cards/{id}            DELETE /api/cards/{id}       POST /api/cards/{id}/sync |
|   - GET  /api/anki/status           GET  /api/anki/decks         GET /api/anki/models   |
|   - GET  /api/anki/model-capabilities                            GET /api/media/{file}  |
|                              |                                                          |
|  [ Business Logic: app/services/ ]                                                      |
|   - CardService: Orchestrates capture, draft extraction, save, sync                     |
|   - MediaStorageService: Manages local images & audio in backend/data/media/             |
|   - CardNormalizer: NFC Unicode normalization, whitespace collapsing                    |
|                              |                               |                          |
|         +--------------------+                               +------------------+       |
|         |                                                                       |       |
|         v                                                                       v       |
|  [ app/repositories/card_repository.py ]                      [ app/services/yomitan.py ]|
|   - SQLite WAL mode (backend/data/ankiminer.db)                - Yomitan HTTP client    |
|   - Centralized duplicate identity constraint                   - POST /tokenize        |
|   - Atomic lifecycle transitions                                - POST /termEntries     |
|                              |                                                          |
|                              v                                                          |
|                  [ app/services/anki_connect.py ]                                       |
|                   - AnkiConnect JSON-RPC (localhost:8765)                               |
|                   - Model introspection & field mapping                                 |
|                   - findNotes & notesInfo duplicate guard                               |
|                   - storeMediaFile binary upload                                        |
+-----------------------------------------------------------------------------------------+
```

### 2.1 Frontend Inventory
| Component | Primary File(s) | Key Responsibilities |
| :--- | :--- | :--- |
| **Side Panel Shell** | `extension/sidepanel/sidepanel.html` | Base HTML markup, semantic layout containers, font linkages. |
| **Side Panel Controller** | `extension/sidepanel/sidepanel.js` | Event wiring, state tracking, backend HTTP calls, DOM mutation. |
| **Side Panel Theme** | `extension/sidepanel/sidepanel.css` | Dark developer-tool UI styling, responsive spacing, animations. |
| **Card Editor** | `sidepanel.html` (`#card-editor`), `sidepanel.js` | Form binding, draft population, optional fields toggle, validation. |
| **Dictionary Display** | `sidepanel.html` (`#dictionary-section`), `sidepanel.js` | Renders study view (POS badges, senses, examples) and raw JSON view. |
| **Media Previews** | `sidepanel.html` (`#media-preview-container`), `sidepanel.js` | Displays screenshot thumbnail and audio player; handles clear/retake. |
| **Mining History** | `sidepanel.html` (`#history-section`), `sidepanel.js` | Searchable, filterable list of saved SQLite cards with sync triggers. |
| **Settings / Controls** | `sidepanel.html` (`.mining-bar`, `.video-toolbar`) | Mining mode toggle, session count, subtitle offset controls. |
| **Anki Controls** | `sidepanel.html` (`.sync-actions`), `sidepanel.js` | "Send to Anki" button, sync status indicator, connection badges. |

### 2.2 Extension Core Inventory
| Component | Primary File(s) | Key Responsibilities |
| :--- | :--- | :--- |
| **Manifest** | `extension/manifest.json` | Manifest V3 configuration, permissions, host rules, content scripts. |
| **Service Worker** | `extension/background.js` | Tab tracking, offscreen management, `captureVisibleTab`, messaging. |
| **Content Script** | `extension/content/content.js` | Page selection listener, mouseup/keyup triggers, mining mode sync. |
| **Capture Utils** | `extension/content/capture-utils.js` | Japanese regex verification, text sanitization, capture messaging. |
| **Video Mining Engine** | `extension/content/video-mining-poc.js` | Primary video detection, subtitle overlay, hover lookups, canvas frame capture. |
| **Subtitle Parser** | `extension/lib/subtitle-parser.js` | SRT, WebVTT, and YouTube SRV3 XML parser with offset adjustments. |
| **Image Cropper** | `extension/lib/image-cropper.js` | Canvas-based video frame cropping, aspect-ratio scaling (640x360), DRM detection. |
| **YouTube Adapter** | `extension/content/adapters/youtube-adapter.js` | Timedtext caption track scraping, auto-translation synthesis, cue styling. |
| **YouTube Bridge** | `extension/content/adapters/youtube-bridge.js` | Injected into MAIN world to extract player API caption configurations. |
| **Netflix Adapter** | `extension/content/adapters/netflix-adapter.js` | Netflix subtitle DOM observation, native caption hiding, fail-soft status. |
| **Offscreen Engine** | `extension/offscreen/` (6 files) | Persistent tab audio recording, circular PCM ring buffer, WAV encoding (v3). |

### 2.3 Backend Inventory
| Component | Primary File(s) | Key Responsibilities |
| :--- | :--- | :--- |
| **FastAPI App** | `backend/app/main.py` | Route declarations, CORS middleware, lifespan database initialization. |
| **Data Schemas** | `backend/app/schemas.py` | Pydantic request/response validation models for cards, media, Anki. |
| **Database Conn** | `backend/app/db/connection.py` | SQLite connection pooling, WAL mode, foreign keys, table migrations. |
| **Card Repository** | `backend/app/repositories/card_repository.py` | CRUD operations for cards, atomic save-or-update, duplicate queries. |
| **Card Service** | `backend/app/services/card_service.py` | Business orchestration: capture -> enrich -> save -> sync. |
| **Yomitan Service** | `backend/app/services/yomitan.py` | HTTP boundary to Yomitan (`/tokenize`, `/termEntries`), payload normalization. |
| **AnkiConnect Service** | `backend/app/services/anki_connect.py` | JSON-RPC boundary to AnkiConnect (`addNote`, `findNotes`, `storeMediaFile`). |
| **Media Storage** | `backend/app/services/media_storage.py` | Saves and serves local binary images and audio in `backend/data/media/`. |
| **Card Normalizer** | `backend/app/services/card_normalizer.py` | Standardizes Unicode NFC, collapses whitespace for duplicate hashing. |

### 2.4 Test Suite Inventory
- **Backend Tests (`backend/tests/`):** 16 test files, 135 unit/integration tests verifying AnkiConnect RPC, database concurrency, duplicate identity collision, media deduplication, route contracts, and capture workflows.
- **Extension Tests (`extension/tests/`):** 26 test files verifying subtitle parsing, coordinate math, DRM fail-soft detection, side panel state updates, hotkeys, and mock video playback.

---

## 3. Project Renaming Audit (`AnkiMiner` → `Kiroku`)

A thorough search across all repository files revealed hundreds of instances of `AnkiMiner`, `ankiminer`, and `ankiMiner`. To ensure zero breakage, the migration must be categorized into safe, internal, and ambiguous candidates.

### 3.1 Classification Matrix

#### Category A: Product-Facing Names (Safe Candidates for Rename)
*These can be safely updated to "Kiroku" without breaking internal storage or external APIs.*
- `extension/manifest.json`: `"name": "AnkiMiner"` → `"name": "Kiroku"`
- `extension/manifest.json`: `"description": "Local-first Japanese vocabulary mining."`
- `extension/sidepanel/sidepanel.html`: `<title>AnkiMiner</title>` → `<title>Kiroku</title>`
- `extension/sidepanel/sidepanel.html`: `<span class="eyebrow">ANKIMINER</span>` → `<span class="eyebrow">KIROKU</span>`
- `backend/app/main.py`: `title="AnkiMiner Local API"` → `title="Kiroku Local API"`
- `start_backend.bat`: Window title and echo statements (`Starting Kiroku Backend...`)
- `run_backend.py`: Console header and banner text
- User documentation, comments, and README titles

#### Category B: Internal Identifiers (Require Compatibility Layers / Aliases)
*Changing these naively will cause immediate runtime data loss, broken message passing, or failed queries.*
1. **SQLite Database Path:**
   - Location: `backend/app/db/connection.py` line 10 (`DEFAULT_DB_REL_PATH = Path("data") / "ankiminer.db"`)
   - Risk: Renaming to `kiroku.db` will orphan existing user cards.
   - Strategy: Add a migration check: If `data/ankiminer.db` exists and `data/kiroku.db` does not, rename or symlink it; check both `KIROKU_DB_PATH` and fallback `ANKIMINER_DB_PATH` environment variables.
2. **Media Storage Directory & Filename Prefixes:**
   - Location: `backend/app/services/media_storage.py` line 100 (`filename = f"ankiminer_{prefix}_{timestamp}_{token}.{ext}"`)
   - Location: `backend/app/services/card_service.py` lines 152, 162 (`startswith("ankiminer_img_")`, `startswith("ankiminer_audio_")`)
   - Risk: Existing cards stored in SQLite reference `ankiminer_img_*.jpg`. If filename parsing only checks `kiroku_img_`, existing cards cannot be re-saved or synced.
   - Strategy: Update prefix to `kiroku_`, but maintain backward-compatible regex matching both `(ankiminer|kiroku)_(img|audio)_`. Check `KIROKU_MEDIA_DIR` with fallback to `ANKIMINER_MEDIA_DIR`.
3. **Extension Ping Message Type:**
   - Location: `extension/background.js` line 14 & `extension/content/content.js` line 9 (`PING_ANKI_MINER`)
   - Risk: If content script is older or background script updates first, content script injection detection fails.
   - Strategy: Accept both `PING_KIROKU` and `PING_ANKI_MINER` in `content.js`.
4. **DOM IDs Injected on Third-Party Pages:**
   - Location: `extension/content/video-mining-poc.js`, `youtube-adapter.js`, `netflix-adapter.js`:
     - `#ankiminer-video-overlay-container`
     - `#ankiminer-video-subtitle`
     - `#ankiminer-hide-yt-captions`
     - `#ankiminer-hide-netflix-captions`
   - Risk: Changing these requires synchronized updates across content scripts, CSS stylesheets, and 12+ extension test mocks.
   - Strategy: Rename consistently in Stage 2 while updating corresponding mock tests.
5. **Global Objects on Window:**
   - `window.__ANKIMINER_VIDEO_POC__` in `video-mining-poc.js`
   - `window.AnkiMinerCapture` in `capture-utils.js`
   - Strategy: Assign `window.__KIROKU_VIDEO_POC__ = ...` and provide `window.__ANKIMINER_VIDEO_POC__` as a deprecated alias.

#### Category C: Ambiguous Cases (Requiring Design Decisions)
1. **Default Anki Deck Name:**
   - Currently: `"Default"`
   - Question: Should Kiroku continue using `"Default"`, or create/suggest a deck named `"Kiroku"` or `"Japanese Mining"`?
   - Recommendation: Keep `"Default"` as fallback, but allow user configuration in Side Panel.
2. **Default Anki Card Tags:**
   - Currently: User-specified or empty.
   - Question: Should synced cards receive an automatic `kiroku` tag in Anki?
   - Recommendation: Yes, add a configurable `kiroku` tag to facilitate easy searching in Anki Browser.
3. **Repository and Directory Names:**
   - Local directory: `D:\Python\AnkiMiner`
   - GitHub remote: `https://github.com/Rhythm-Kachhwaha/AnkiMiner`
   - Recommendation: Rename GitHub repo to `Kiroku` (GitHub automatically redirects old URLs). Local directory can be renamed by user when convenient.

---

## 4. Dictionary System Audit (High Priority V1 Problem)

The dictionary lookup pipeline currently works end-to-end, but its data extraction and presentation are crude and lose vital linguistic context.

### 4.1 Trace of a Dictionary Result
1. **Capture:** User selects text `映画` in the browser. `content.js` transmits `JAPANESE_TEXT_CAPTURED` with `text: "映画"` to Side Panel.
2. **Backend Request:** `sidepanel.js` issues `POST http://127.0.0.1:8000/api/capture` with payload `{"text": "映画", "deck_name": "Default", "auto_save": false}`.
3. **Tokenization:** `CardService.capture_term` calls `YomitanService.identify("映画")`, which sends `POST /tokenize` with `{"text": "映画", "scanLength": 16, "parser": "scanning-parser"}` to Yomitan (`127.0.0.1:19633`).
4. **Token Parsing:** Yomitan returns a structured token list. `YomitanService.normalize_tokenize_response` scans tokens for headwords and extracts `IdentifiedTerm(expression="映画", reading="えいが", source_text="映画", deinflected_text="映画")`.
5. **Dictionary Lookup:** `YomitanService.enrich` invokes `POST /termEntries` with `{"term": "映画"}`.
6. **Raw Yomitan AST Response:** Yomitan returns a deeply nested JSON structure containing `dictionaryEntries` with definitions, sense groups, parts of speech, tags, and structured HTML-like nodes (`ruby`, `rt`, `ul`, `li`).
7. **Backend Normalization (`normalize_term_entries_response`):**
   - Headword terms and readings are resolved from index maps.
   - Senses are recursively extracted via ad-hoc string searching (`_find_marked`, `_plain_text`).
   - Parts-of-speech are pulled out and placed in a flat `DictionaryEntry.parts_of_speech` array, completely detaching them from individual senses.
   - Tags (popular `★`, JLPT ratings, common word markers) are largely ignored or partially stringified.
   - Example sentences are parsed by searching for `example-sentence-a` (Japanese) and `example-sentence-b` (translation), stripping ruby text.
8. **Draft Construction in `CardService`:**
   - **Critical Data Loss:** `CardService` executes:
     ```python
     default_meaning = ""
     for entry in enriched.entries:
         for sense in entry.senses:
             if sense.glosses:
                 default_meaning = ", ".join(sense.glosses)
                 break
         if default_meaning:
             break
     ```
     This takes **only the first sense of the first dictionary**, discarding all additional senses (e.g. senses 2, 3, 4 of polysemous words) from the pre-populated card editor!
9. **Side Panel Presentation (`sidepanel.js` `renderDetails`):**
   - The Side Panel receives `CaptureResponse.entries`.
   - Client-side code iterates over entries, builds custom `Set` filters to deduplicate POS tags, and creates an artificial compound key (`senseKey = distinctGlosses.map(...).sort().join("|")`) to deduplicate senses across dictionaries.
   - Renders a rudimentary DOM structure into `#meanings` and full raw text into `#dict-raw-view`.

### 4.2 Exact Breakdown of Where the Mess is Introduced
| Layer | Root Problem | Impact |
| :--- | :--- | :--- |
| **1. Raw Yomitan Data** | Yomitan returns arbitrary structured content (nested `div`, `span`, `ruby`, `rt` tags, and custom dictionary schemas). | High variability between dictionaries (JMdict vs Jitendex vs Daijirin vs Kenkyusha). |
| **2. Backend Normalization** | Uses basic recursive helper functions (`_find_marked`) that discard semantic hierarchy; POS tags are flattened to the entry level instead of attached to individual senses; inflection explanations are ignored. | Senses lose grammatical context (e.g. which sense is transitive vs intransitive). |
| **3. CardService API** | Over-aggregates: sets `meaning` to solely the first sense's glosses joined by commas. | Card editor has incomplete definitions by default; user must manually copy missing senses. |
| **4. Side Panel Logic** | The frontend attempts heavy data munging (cross-dictionary deduplication, POS sorting) inside `renderDetails()` in vanilla JS. | Fragile rendering code prone to layout glitches, awkward badges, and missing formatting. |
| **5. UI / Formatting** | Badges and lists in `#meanings` lack visual hierarchy; examples are hidden behind an unstyled `<details>` tag; pitch accents and frequency markers are missing. | Looks like an unstyled debug dump rather than a polished study tool. |

### 4.3 Recommended V1 Dictionary Architecture
1. **Backend Structured Representation:**
   - Formalize Pydantic models:
     - `DictionarySense`: `index: int`, `glosses: list[str]`, `parts_of_speech: list[str]`, `tags: list[str]`, `notes: list[str]`, `examples: list[DictionaryExample]`.
     - `DictionaryEntry`: `dictionary_name: str`, `is_primary: bool`, `term: str`, `reading: str`, `pitch_accents: list[str]`, `senses: list[DictionarySense]`.
2. **Intelligent Draft Synthesis:**
   - When generating the default `meaning` for the Card Editor, combine top senses cleanly:
     `1. movie; film\n2. motion picture`
3. **Pitch Accent & Frequency Support:**
   - Retain Yomitan pitch numbers/patterns and frequency stars (`★`) in normalized responses.
4. **Dedicated Frontend Component:**
   - Build a clean, styled dictionary card with primary dictionary prominence, collapsible secondary dictionaries, distinct grammatical badges, and interactive example sentences.

---

## 5. Frontend Audit

The Side Panel UI is functional but heavily coupled to low-level DOM queries and global state. A visual redesign must be executed with extreme surgical care.

### 5.1 Redesign Safety Analysis
- **What Can Be Visually Redesigned Freely:**
  - CSS variables, color palettes, card surface backgrounds, borders, shadows, spacing, typography.
  - Layout arrangements (e.g. moving Card Editor and Dictionary side-by-side or into stacked modular cards).
  - Component styling: buttons, input fields, badges, pill indicators, collapsible panels.
  - Micro-animations and transition states.
- **What Must Remain Functionally Identical:**
  - Form submission mechanics (`cardEditor.addEventListener("submit")`).
  - Capture ID sequence checks (`currentCaptureId`) to prevent stale capture overwrite.
  - User gesture retention on the mining mode button (required for Chromium MV3 `tabCapture` stream ID).
  - Messaging protocols with content scripts and background service worker.
  - Progress counters and session state tracking.

### 5.2 Dangerous Coupling Points & Fragile Dependencies
1. **DOM ID Hardcoding:**
   `sidepanel.js` directly selects elements by ID at script evaluation:
   `#mining-toggle`, `#mode`, `#session-count`, `#capture-status`, `#save-badge`, `#expression`, `#reading`, `#meanings`, `#dict-actions-bar`, `#card-editor`, `#field-expression`, `#field-reading`, `#field-meaning`, `#field-deck-select`, `#field-model-select`, `#field-font-select`, `#image-preview`, `#audio-preview`, `#history-cards-list`, `#history-search-input`, `#history-deck-filter`, `#history-sync-filter`.
   *Danger:* If an element ID is renamed or removed in `sidepanel.html`, `sidepanel.js` will crash with `TypeError: Cannot read properties of null` during startup.
2. **Form Data Serialization:**
   `sidepanel.js` constructs `SaveCardRequest` using form element `name` attributes:
   `expression`, `reading`, `meaning`, `deck_name`, `model_name`, `hint`, `example_sentence`, `example_translation`, `tags`, `notes`, `source_text`, `deinflected_text`.
   *Danger:* Modifying or removing form input `name` attributes breaks card saving.
3. **Class References in Dynamic Builders:**
   Functions like `renderDetails` and `renderHistoryList` dynamically create elements with specific class names:
   `.study-dict-header`, `.dict-source-pill`, `.primary-badge`, `.study-pos-badge`, `.study-sense-item`, `.history-card-item`, `.history-card-selected`.
   *Danger:* CSS redesign must preserve or intentionally map these dynamic class names.
4. **Asynchronous Race Protection:**
   The `currentCaptureId` counter in `sidepanel.js` ensures that if a user rapidly selects two Japanese words, the slower network response from the first word does not overwrite the second.
   *Danger:* Any redesign that refactors async handlers must strictly preserve `captureId` checks.

---

## 6. Typography & Branding Audit

### 6.1 Current Typography Implementation
- **Declared in `sidepanel.css`:**
  ```css
  :root {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-noto-sans: "Noto Sans JP", "Noto Sans Japanese", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
    --font-noto-serif: "Noto Serif JP", "Noto Serif Japanese", "Hiragino Mincho ProN", "Yu Mincho", serif;
    --font-system: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
    --japanese-font: var(--font-noto-sans);
  }
  ```
- **Declared in `sidepanel.html`:**
  `<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@400;600&display=swap" rel="stylesheet">`

### 6.2 Deficiencies & Risks
1. **Online Google Fonts Dependency in an Offline-First Tool:**
   Loading `Noto Sans JP` via CDN means that if the user mines offline, the font fails to load, reverting to Windows default `Yu Gothic` or `Meiryo`. On Windows, `Yu Gothic` can render thin and illegible at small font sizes.
2. **Missing Latin Font Bundle:**
   `Inter` is specified in CSS, but neither linked via Google Fonts nor bundled locally. Unless the user has `Inter` installed as an OS font, it falls back to `Segoe UI`.
3. **Contrast and Kanji Radical Legibility:**
   At 12–14px, complex kanji radicals (e.g. 鬱, 躊躇, 警鐘) blur if font weights are too light or antialiasing is blurry. `Noto Sans JP` at weight 500 is optimal.

### 6.3 V1.0 Typography Recommendations
- **Bundle Fonts Locally:** Package WOFF2 files for `Noto Sans JP` (weights 400, 500, 700) and `Inter` (weights 400, 500, 600) inside `extension/fonts/` with `@font-face` rules. Ensures 100% offline consistency.
- **Hierarchy Standard:**
  - **Hero Japanese Expression:** `Noto Sans JP`, 26–28px, weight 700.
  - **Furigana / Reading:** `Noto Sans JP`, 14–15px, weight 500.
  - **Body / Definitions / UI Labels:** `Inter`, 13–14px, weight 400/500.
  - **Monospace (Timestamps, Offsets):** `ui-monospace`, `SFMono-Regular`, `Consolas`, 12px.

---

## 7. Anki Card Audit

### 7.1 Current Anki Note Generation
When a user saves a card and clicks "Send to Anki":
1. `sidepanel.js` calls `POST /api/cards/{id}/sync`.
2. `CardService.sync_card()`:
   - Queries `AnkiConnectService.find_existing_note()` using sanitized expression and reading to prevent duplicates across database resets.
   - If missing, retrieves media bytes from `MediaStorageService` and uploads them via `store_media_file()`.
   - Calls `AnkiConnectService.add_note()`.
3. `AnkiConnectService.map_card_to_fields()` maps fields:
   - **For Standard Basic (Front / Back):**
     - `Front`: `f"{expression} [{reading}]"`
     - `Back`: `"<br><br>".join([meaning, f"Hint: {hint}", f"{example}<br>{example_trans}", f"Notes: {notes}", f'<img src="{img}">', f"[sound:{aud}]"])`
   - **For Custom / Japanese Mining Models (e.g. Yomitan, Core 2k/6k, Kaishi):**
     - Maps to dedicated fields (`Expression`, `Reading`, `Meaning`, `Sentence`, `Picture`, `Audio`).

### 7.2 Visual Problems with Current Generated Cards
- **Unstructured Basic Cards:** Joining fields with raw `<br><br>` creates an unstyled wall of text.
- **No Class Attributes or Semantic Wrappers:** Users cannot easily style the resulting cards in Anki without editing individual card notes.
- **Raw Media Insertion:** Images have no CSS max-width constraints and can overflow Anki's card viewport on desktop or mobile.

### 7.3 Constraints and Recommendations for V1.0
- **Do Not Break Note Models:** Many users already have established Anki note types (e.g. Yomitan Japanese model). Kiroku must continue mapping seamlessly to existing fields without forcing template resets.
- **Semantic HTML for Basic Model:** Format the `Back` field with semantic, styled divs:
  ```html
  <div class="kiroku-meaning">{{meaning}}</div>
  <div class="kiroku-example">
    <div class="kiroku-example-ja">{{example}}</div>
    <div class="kiroku-example-en">{{example_translation}}</div>
  </div>
  <div class="kiroku-media"><img src="{{image}}"></div>
  ```
- **Kiroku Default Note Model:** Provide an optional, beautifully styled "Kiroku Japanese" note model in Anki with modern dark/light styling, clean furigana support, and responsive image scaling.

---

## 8. DESIGN.md Audit

`DESIGN.md` in the repository root is an artifact describing Anthropic's Claude marketing site. It contains marketing bands, pricing tiers, and cream canvas specs that contradict the dark developer-utility requirement of the extension.

### 8.1 Section-by-Section Migration Plan

| Section in `DESIGN.md` | Content Summary | Classification | Migration Target |
| :--- | :--- | :--- | :--- |
| **Frontmatter & Overview (lines 1–5, 301–323)** | Claude brand overview, cream canvas, Copernicus serif display. | **DELETE AFTER MIGRATION** | Completely irrelevant to Kiroku. |
| **Colors: Brand & Accent (lines 6–9, 326–332)** | Coral primary (`#cc785c`), active (`#a9583e`), teal (`#5db8a6`), amber (`#e8a55a`). | **KEEP / ADAPT** | Move color tokens to a new `UI_SPEC.md` or `ARCHITECTURE.md`. Coral accent is actively used in the Side Panel. |
| **Colors: Surface Dark (lines 21–23, 338–340)** | `#181715`, `#252320`, `#1f1e1b`. | **KEEP** | Core dark surfaces of the Side Panel; document in `UI_SPEC.md`. |
| **Colors: Canvas & Cream (lines 17–20, 334–337)** | `#faf9f5`, `#efe9de`. | **ARCHIVE** | Keep only if light mode is planned for v2; delete from v1 docs. |
| **Colors: Semantic (lines 29–31, 355–358)** | Success (`#5db872`), Warning (`#d4a017`), Error (`#c64545`). | **KEEP** | Actively used in connection indicators and sync status; move to `UI_SPEC.md`. |
| **Typography (lines 33–118, 360–395)** | Copernicus, Tiempos Headline, StyreneB, negative tracking rules. | **ARCHIVE** | Commercial fonts not bundled; replace with `Noto Sans JP` + `Inter` spec in `UI_SPEC.md`. |
| **Shapes & Border Radii (lines 119–126, 434–445)** | 4px, 6px, 8px, 12px, 16px, pill 9999px. | **KEEP** | Move to `UI_SPEC.md` design tokens. |
| **Spacing System (lines 128–136, 398–404)** | 4px base scale (4, 8, 12, 16, 24, 32px). | **KEEP** | Move to `UI_SPEC.md` design tokens. |
| **Components: Marketing (lines 185–241, 477–496)** | `hero-band`, `pricing-tier-card`, `model-comparison-card`, `cookie-consent-card`. | **DELETE AFTER MIGRATION** | SaaS marketing components; zero relevance to Chromium Side Panel. |
| **Components: Utility (lines 139–175, 461–475)** | `button-primary`, `button-secondary-on-dark`, `badge-pill`, `text-input`. | **KEEP / ADAPT** | Adapt into Side Panel UI design tokens. |

*Recommendation:* In Stage 2, extract useful color, radius, and spacing tokens into a new `docs/UI_SPEC.md`, update `AGENTS.md` and `ARCHITECTURE.md` references, and archive or delete `DESIGN.md`.

---

## 9. GitHub Agent Skills Audit

To accelerate V1 polishing and ensure rigorous engineering standards, relevant agent skills were investigated.

### 9.1 Skills Evaluation Matrix

| Skill Name | Source | What It Does | Project Relevance | Potential Risks | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`chrome-extensions`** | Built-in / Modern Web Plugin | Validates Chrome MV3 best practices, manifest configuration, CSP rules, and extension store packaging. | **Essential.** Governs permissions, service worker lifecycle, and side panel behavior. | Low. Official web standards guidance. | **RECOMMENDED.** Use during Stage 6 & 9. |
| **`modern-web-guidance`** | Built-in / Modern Web Plugin | Provides modern CSS, HTML5 semantic layout, container queries, and performance guidance. | **High.** Essential for modernizing the Side Panel CSS without framework bloat. | Low. Pure frontend standards. | **RECOMMENDED.** Use during Stage 4. |
| **`a11y-debugging`** | Built-in / DevTools Plugin | Audits semantic HTML, ARIA landmarks, focus rings, contrast ratios, and keyboard traps. | **High.** Ensures Side Panel keyboard-first navigation (`Ctrl+Enter`, `Ctrl+K`) adheres to WCAG. | None. Read-only auditing. | **RECOMMENDED.** Use during Stage 6. |
| **`code-review-and-quality`** | GitHub Community / Curated | Automated multi-axis code review enforcing correctness, boundary isolation, and error handling. | **High.** Prevents accidental cross-contamination between extension, backend, and AnkiConnect layers. | None if non-modifying. | **RECOMMENDED.** Use at end of each stage. |
| **`security-sast`** | Security Community | Static analysis scanning for path traversal, injection vulnerabilities, open CORS, and unsanitized HTML. | **High.** Vital for auditing local FastAPI endpoints (`/api/media/{file}`, `/api/capture`) and Anki field escaping. | False positives on simple scripts. | **RECOMMENDED.** Use during Stage 7. |
| **`release-engineering`** | DevOps Community | Automates changelog generation, semantic versioning, Git tagging, and GitHub Release asset packaging. | **Medium.** Streamlines creating the v1.0.0 GitHub release. | Could create unwanted git tags if unverified. | **DEFER.** Execute manually or with supervision in Stage 12. |

*Rule:* No third-party skills will be installed or executed without explicit user approval.

---

## 10. V1.0 Feature Boundary

### 10.1 IN v1.0 (Shipping Surface)
- [x] Chromium / Brave Manifest V3 Extension with Side Panel UI.
- [x] Japanese text selection capture from web pages.
- [x] Subtitle mining from YouTube (SRV3/VTT) and local subtitle file upload (.srt, .vtt).
- [x] HiAnime and HTML5 video subtitle overlay with auto-pause on hover.
- [x] Passive video frame screenshot capture (Canvas + `captureVisibleTab`).
- [x] Netflix DRM fail-soft status display.
- [x] Local Yomitan dictionary lookup with structured study view and raw view.
- [x] Full-featured Card Editor (Expression, Reading, Meaning, Deck, Model, Font, optional fields).
- [x] Local SQLite card persistence with duplicate identity `(expression, reading, deck)`.
- [x] Mining History & Card Library (search, filter by deck/status, re-save, re-sync).
- [x] AnkiConnect integration (manual "Send to Anki" trigger, Basic and custom note models, media file sync).
- [x] Local FastAPI backend with automated SQLite migrations.
- [x] Clean single-click Windows launcher (`start_backend.bat` / desktop shortcut).

### 10.2 NOT in v1.0 (Explicitly Postponed)
- [ ] **OCR (Optical Character Recognition):** Postponed to **v2.0**.
- [ ] **Audio Capture / Recording:** Postponed to **v3.0**.
- [ ] **Video Clips / Animated GIFs:** Postponed to future releases.
- [ ] **Cloud Sync / User Accounts / Remote Servers:** Out of scope (Kiroku is strictly local-first).

### 10.3 Internal Code Retention & UI Suppression (Audio Policy)
- **Zero-Touch Audio Code Invariant:** All existing audio code in `backend/app/services/media_storage.py`, `card_service.py`, `anki_connect.py`, `extension/offscreen/`, and `extension/background.js` **must remain untouched**. No code removal, no refactoring.
- **UI Surface Hiding:** For V1, simply hide or disable the audio UI elements:
  - Hide the audio preview slot (`#audio-preview-container`) in `sidepanel.html`.
  - Hide or uncheck the "Auto-capture audio" checkbox (`#toggle-auto-capture-audio`).
  - Do not trigger background audio recording on mining mode startup for V1.

---

## 11. Release Risks

| Priority | Risk Description | Root Cause / Attack Vector | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **CRITICAL** | **Breaking Passive Playback Invariant** | Video playback stuttering, seeking, or pausing caused by invasive capture code. | Strict passive observation only; zero `.currentTime`, `.play()`, or `.pause()` calls in capture scripts. Verified by automated playback tests. |
| **CRITICAL** | **Accidental Deletion of Fragile Functionality** | Overzealous refactoring or renaming breaking existing audio, frame capture, or Anki sync code. | Zero code changes outside staged boundaries; 100% test pass rate required before merging any stage. |
| **HIGH** | **Database & Media Path Corruption during Rename** | Naive rename of `ankiminer.db` or `ankiminer_img_*` prefixes orphaning existing user cards or media files. | Implement alias fallbacks for DB paths, media directories, and regex filename matchers accepting both `ankiminer_` and `kiroku_`. |
| **HIGH** | **Localhost API Security / Hostile Webpage Exploitation** | A malicious website calling `http://127.0.0.1:8000/api/...` to delete cards or write arbitrary files. | Restrict FastAPI CORS origins strictly to the extension's internal ID (`chrome-extension://<id>`) and validate filenames against strict path-traversal regex. |
| **HIGH** | **Clean-Machine Python / Windows Dependency Failures** | End user lacks Python 3.11, pip packages, or virtualenv activation. | Provide a self-contained virtual environment script, automated batch installer, or standalone PyInstaller executable in Stage 10. |
| **MEDIUM** | **Side Panel DOM Desynchronization** | Visual CSS/HTML changes breaking hardcoded JS selectors in `sidepanel.js`. | Keep DOM IDs stable; wrap element queries in safe null guards; run full extension test suite on every UI change. |
| **MEDIUM** | **Yomitan Unavailability / Outdated Dictionaries** | Yomitan not running or dictionary missing frequency tags causing empty definitions. | Robust fallback message in UI guiding user to launch Yomitan; gracefully handle empty definition lists. |
| **MEDIUM** | **Anki Field Mapping Variance** | User has a complex custom note model with non-standard field names causing note creation errors. | Maintain fallback chain: custom Japanese mining model → Basic Front/Back → append unmapped fields to Notes. |
| **LOW** | **Font Rendering Variance on Windows** | User lacks `Noto Sans JP` or `Inter` resulting in jagged kanji rendering. | Bundle WOFF2 font files locally within the extension directory. |

---

## 12. Recommended V1.0 Roadmap

```
+-------------------------------------------------------------------------------+
| STAGE 1: Foundation / Repository Audit (Current - COMPLETE)                   |
| - Full code & test inspection, rename mapping, dictionary audit report        |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 2: Project Renaming & Repository Hygiene                                |
| - Safe migration from AnkiMiner to Kiroku with full backwards-compat aliases  |
| - Root directory cleanup (remove throwaway JSON/test scripts)                 |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 3: Dictionary Normalization & Multi-Sense Engine                        |
| - Structured AST parser in YomitanService; full multi-sense extraction        |
| - Intelligent card draft meaning synthesis (no more 1-sense truncation)       |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 4: Side Panel Frontend Redesign                                         |
| - Modern dark developer-utility interface; modular card containers            |
| - Hide audio controls from UI; preserve all DOM IDs and event handlers        |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 5: Card Preview & Anki Card Template Redesign                           |
| - Semantic HTML card structure; responsive media CSS                          |
| - Optional "Kiroku Modern" note type generator in Anki                        |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 6: UX Polish, Accessibility & Keyboard-First Navigation                 |
| - WCAG contrast verification; keyboard shortcuts (Ctrl+Enter, Ctrl+K)         |
| - Focus trapping and clean status toast notifications                         |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 7: Security & Reliability Hardening                                     |
| - Strict CORS origin locking on FastAPI; path traversal guards                |
| - Connection retry exponential backoff for Yomitan and Anki                   |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 8: Documentation, Specification & README                                |
| - High-grade public README.md with screenshots, architecture, quickstart      |
| - Migrate useful DESIGN.md tokens to UI_SPEC.md; archive marketing clutter    |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 9: Release Preparation & Automated Test Harness                         |
| - Consolidated single-command test runner (Backend + Extension)               |
| - Manifest V3 store packaging verification                                    |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 10: Windows Distribution & One-Click Launcher                           |
| - Windows batch launcher / PyInstaller standalone backend packaging           |
| - Clean-machine installation test                                             |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 11: End-to-End Regression Testing                                       |
| - Full pipeline verification on YouTube, HiAnime, Netflix, generic web        |
| - SQLite persistence and AnkiConnect sync smoke tests                         |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STAGE 12: GitHub v1.0.0 Public Release                                        |
| - Git tag v1.0.0; GitHub Release with packaged extension zip & backend bundle |
+-------------------------------------------------------------------------------+
```

---

## 13. Recommended Next Stage (Stage 2 Action Items)

**Next Action:** Proceed to **Stage 2 — Project Renaming & Repository Hygiene**.

### Stage 2 Immediate Scope:
1. **Clean Root Directory:** Remove obsolete throwaway test scripts (`extract_examples.py`, `inspect_structure.py`, `test_capture.py`, `test_yomitan.py`, `capture_result.json`, `termentries_result.json`, `tokenize_result.json`, `structure.txt`).
2. **Execute Backward-Compatible Rename:**
   - Update extension manifest, Side Panel title, and UI branding to **Kiroku**.
   - Update backend title to **Kiroku Local API**.
   - Implement database and media backward-compatible alias loaders (`ankiminer.db` ↔ `kiroku.db`, `ankiminer_` ↔ `kiroku_` prefixes).
   - Update message listener aliases (`PING_KIROKU` and `PING_ANKI_MINER`).
3. **Verify Zero Regressions:** Execute all 135 backend tests and 26 extension tests to confirm complete green status before proceeding to Stage 3.
