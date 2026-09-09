# AnkiMiner Decisions

## Architecture & Communication

- **Direct Side Panel messaging for capture**: `content.js` sends `JAPANESE_TEXT_CAPTURED` runtime messages directly to the Side Panel listener. `background.js` does not re-broadcast capture messages, preventing duplicate backend calls, race conditions, and false-positive diagnostic errors.
- **Persistent extension mining state**: `background.js` maintains `isMiningModeEnabled` and synchronizes state across all tabs via `chrome.tabs.query`, `chrome.tabs.onActivated`, and `chrome.tabs.onUpdated`. `content.js` queries mining mode on startup and verifies on selection if uninitialized, ensuring mining mode persists across tab switches, dynamic subtitle changes, and page navigations without page reload.
- **Concurrent capture protection**: `sidepanel.js` tracks `currentCaptureId` for asynchronous `identify()` requests, ignoring stale in-flight responses when rapid selections occur.

## Tokenization & Dictionary Normalization

- **Headword scan over all segment tokens**: `YomitanService.normalize_tokenize_response` inspects all tokens in segment payloads to identify valid headwords before falling back to raw Japanese text tokens. This prevents leading punctuation (e.g. `「`, `（`, `『`, `“`) from discarding the actual Japanese term.
- **Broad CORS allowance for local API**: FastAPI's `CORSMiddleware` allows all headers and methods for extension origins to prevent browser preflight CORS rejections (`Failed to fetch`).
