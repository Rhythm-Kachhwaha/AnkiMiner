# AnkiMiner Decisions

## Architecture & Communication

- **Direct Side Panel messaging for capture**: `content.js` sends `JAPANESE_TEXT_CAPTURED` runtime messages directly to the Side Panel listener. `background.js` does not re-broadcast capture messages, preventing duplicate backend calls, race conditions, and false-positive diagnostic errors.
- **Persistent extension mining state**: `background.js` maintains `isMiningModeEnabled` and synchronizes state across all tabs via `chrome.tabs.query`, `chrome.tabs.onActivated`, and `chrome.tabs.onUpdated`. `content.js` queries mining mode on startup and verifies on selection if uninitialized, ensuring mining mode persists across tab switches, dynamic subtitle changes, and page navigations without page reload.
- **Concurrent capture protection**: `sidepanel.js` tracks `currentCaptureId` for asynchronous `identify()` requests, ignoring stale in-flight responses when rapid selections occur.

## Tokenization & Dictionary Normalization

- **Headword scan over all segment tokens**: `YomitanService.normalize_tokenize_response` inspects all tokens in segment payloads to identify valid headwords before falling back to raw Japanese text tokens. This prevents leading punctuation (e.g. `「`, `（`, `『`, `“`) from discarding the actual Japanese term.
- **Broad CORS allowance for local API**: FastAPI's `CORSMiddleware` allows all headers and methods for extension origins to prevent browser preflight CORS rejections (`Failed to fetch`).

## Persistence & Duplicate Prevention (Phase 3.1 & 3.2)

- **SQLite local persistence behind repository boundary**: Implemented `CardRepository` managing SQLite cards persistence with WAL mode and foreign key pragmas enabled. Database operations are strictly isolated from FastAPI routes and extension code.
- **Locked duplicate identity & centralized normalization**: Duplicate identity is strictly `(normalized_expression, normalized_reading, normalized_deck_name)`. Normalization standardizes Unicode NFC, collapses and strips ASCII/full-width (`\u3000`) whitespace, and defaults missing deck names to `"Default"`. A SQLite `UNIQUE(normalized_expression, normalized_reading, normalized_deck_name)` constraint and index guarantee duplicate prevention and race safety.
- **Backend-owned lifecycle and minimal Side Panel state**: The backend decides card lifecycle transitions: inserting new rows only when not duplicate, and returning existing records with `is_duplicate: true` and `status: "already_saved"` when duplicate. The Side Panel reflects this with `[SAVED]` vs `[ALREADY SAVED]` pills styled according to `DESIGN.md`.

## Card Editor & Explicit Save Workflow (Phase 3.3)

- **Selection-to-Draft decoupling**: Selection capture creates an ephemeral `CardDraft` rather than immediately persisting to SQLite. Text selection invokes `/api/capture` with `auto_save: false` to enrich via Yomitan and populate the editor. If the term already exists in SQLite, the existing card is loaded instead.
- **Backend-governed explicit persistence**: The user must explicitly submit the card via `POST /api/cards/save`. The backend validates the card, checks duplicate identity, inserts new records or updates existing rows in place without altering duplicate identity, returning `is_new` and `is_updated` lifecycle flags.
- **Compact developer-utility UI with progressive disclosure**: Side Panel card editor keeps core fields (`Expression`, `Reading`, `Meaning`) immediately editable while stowing optional fields (`Hint`, `Example sentence`, `Example translation`, `Image`, `Audio`, `Tags`, `Notes`) behind a collapsible toggle.
- **Frontend session counter**: Tracked in Side Panel session state, starting at 0, incrementing strictly on `is_new: true` card saves, and remaining unaffected by existing-card loads, edits, or duplicate captures.

## AnkiConnect Synchronization & Lifecycle (Phase 4)

- **Isolated transport boundary**: `AnkiConnectService` encapsulates all JSON-RPC communication using Python standard library `urllib` only (zero extra runtime dependencies). Connection refused, network timeouts, malformed JSON, and AnkiConnect `{"error": ...}` responses are mapped to dedicated domain exceptions (`AnkiConnectionError`, `AnkiTimeoutError`, `AnkiResponseError`, `AnkiActionError`).
- **SQLite-first persistence & independent save**: Local persistence is completely decoupled from Anki reachability. Cards are saved locally in SQLite before any AnkiConnect call is attempted. If Anki is offline or unreachable, local save succeeds with `sync_status = 'pending'`, ensuring user card data is never blocked or lost.
- **Explicit user-triggered synchronization**: Card saving never automatically pushes to Anki. Synchronization is initiated explicitly by the user clicking `[Send to Anki]` (or retry on failure). State machine: `pending` -> `syncing` -> `synced` (with populated `anki_note_id` and `synced_at`), or `failed` (with diagnostic `sync_error`), recoverable via retry.
- **Deterministic model resolution & mapping**: Detects available note models and inspects field definitions. Prioritizes models containing `mining` or `vocab` that support prompt/answer pairs, or standard `Basic` (`Front`/`Back`), mapping core fields and optional extras without fuzzy heuristics or speculative guessing.
- **Composite reading extraction & HTML cleanup for duplicate prevention**: Standard `Basic` models format `Front` as `f"{expression} [{reading}]"` and Anki fields may store HTML formatting/entities (`<div>`, `&nbsp;`). `find_existing_note` extracts base expressions, parses composite bracketed readings, and strips HTML markup before normalization, guaranteeing that existing notes created under `Basic` models are recognized across local database resets.
- **Safe query escaping & empty expression guard**: Queries sanitize user expressions to strip quotes and wildcards. If sanitization reduces an expression to empty, `find_existing_note` returns `None` immediately, preventing unconstrained deck-wide searches that could cause false-positive duplicate matches.
- **Actionable backend connection diagnostics in UI**: `sidepanel.js` maps raw `Failed to fetch` browser errors to explicit, human-readable instructions informing the user that the FastAPI server must be running on `http://127.0.0.1:8000`.
- **Environment-agnostic extension test runner**: Extension unit and contract test files resolve paths using `path.resolve(__dirname, ...)` with fallback, ensuring test suites execute reliably both from the workspace root and the `extension/` directory.

