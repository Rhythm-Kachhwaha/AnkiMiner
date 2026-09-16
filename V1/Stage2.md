# Kiroku Note — V1.0 Stage 2 Implementation Report: Repository Hygiene & Branding Rename

**Document Path:** `V1/Stage2.md`  
**Execution Type:** Controlled Product Rename & Repository Hygiene  
**Date:** 2026-09-16  
**Status:** Complete  

---

## 1. Executive Summary

Stage 2 successfully migrated the project from **AnkiMiner** to **Kiroku Note** (short brand: **Kiroku**, repository target: `kiroku-note`) through a controlled, surgical rename with zero regressions and full backward compatibility.

All obsolete root scratch/debug files identified in Stage 1 were safely verified and removed. All persisted data, database paths, media file prefixes, extension message protocols, and global properties maintain backward compatibility layers.

---

## 2. Classification of AnkiMiner Identifiers & Actions Taken

| Category | Identifiers / Occurrences | Action Taken | Rationale |
| :--- | :--- | :--- | :--- |
| **1. User-Facing Branding** | `manifest.json` name, `sidepanel.html` `<title>` and eyebrow, FastAPI app title, `start_backend.bat` titles, `run_backend.py` banners, `offscreen.html` title | **Renamed to "Kiroku Note" / "Kiroku"** | Primary user display surfaces now consistently present the product brand. |
| **2. Internal Identifiers (Env & Paths)** | `DEFAULT_DB_REL_PATH`, `DEFAULT_MEDIA_REL_PATH`, `KIROKU_DB_PATH` / `ANKIMINER_DB_PATH`, `KIROKU_MEDIA_DIR` / `ANKIMINER_MEDIA_DIR` | **Updated with backward-compatible fallbacks** | Resolves `KIROKU_*` first, falling back to `ANKIMINER_*`. Checks for existing `data/ankiminer.db` if `data/kiroku.db` does not exist to prevent data loss. |
| **3. Persisted Data & Media Prefixes** | `kiroku_img_`, `ankiminer_img_`, `kiroku_audio_`, `ankiminer_audio_` | **Dual-prefix matching in CardService** | Ensures existing SQLite cards referencing `ankiminer_img_*` or `ankiminer_audio_*` continue to load and sync seamlessly. |
| **4. Protocol / Messaging** | Extension ping message types (`PING_KIROKU`, `PING_ANKI_MINER`), content script globals | **Dual-response listeners and global aliases** | `content.js` handles both `PING_KIROKU` and `PING_ANKI_MINER`; `capture-utils.js` exports both `global.KirokuCapture` and alias `global.AnkiMinerCapture`. `video-mining-poc.js` exports `__KIROKU_VIDEO_POC__` and `__ANKIMINER_VIDEO_POC__`. |
| **5. DOM / Extension Hooks** | `#ankiminer-video-overlay-container`, `#ankiminer-video-subtitle`, `__ankiminer_fs_hooked__`, `#ankiminer-hide-yt-captions`, `#ankiminer-hide-netflix-captions` | **Retained internally** | Internal third-party DOM selectors and test hooks remain unchanged to avoid breaking subtitle overlay positioning and mock tests without user-facing benefit. |
| **6. Documentation & Meta** | `AGENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `PROGRESS.MD`, `IGNORE.md`, module docstrings | **Updated to Kiroku Note** | Core guides and developer documentation updated to reflect current branding and target repository name. |
| **7. Temporary / Debug Artifacts** | `capture_result.json`, `termentries_result.json`, `tokenize_result.json`, `structure.txt`, `extract_examples.py`, `inspect_structure.py`, `test_capture.py`, `test_yomitan.py` | **Deleted from root** | Confirmed unreferenced by production code and test suites. |

---

## 3. Files Changed

### Root / Repository
- `AGENTS.md` — Updated product name and purpose description.
- `ARCHITECTURE.md` — Updated system overview and branding.
- `DECISIONS.md` — Updated document header.
- `IGNORE.md` — Updated section headers.
- `PROGRESS.MD` — Marked Stage 2 checklist items completed.
- `run_backend.py` — Updated console banner and docstrings.
- `start_backend.bat` — Updated terminal window title and startup echo text.

### Backend (`backend/`)
- `backend/app/__init__.py` — Updated package docstring.
- `backend/app/main.py` — Updated FastAPI application title to `"Kiroku Note Local API"`.
- `backend/app/db/__init__.py` — Updated package docstring.
- `backend/app/db/connection.py` — Set default DB path to `data/kiroku.db` with automated fallback to `data/ankiminer.db`; added `KIROKU_DB_PATH` support.
- `backend/app/repositories/__init__.py` — Updated package docstring.
- `backend/app/services/media_storage.py` — Added `KIROKU_MEDIA_DIR` support with `ANKIMINER_MEDIA_DIR` fallback.
- `backend/app/services/card_service.py` — Added dual-prefix recognition for both `kiroku_` and `ankiminer_` media filenames.

### Extension (`extension/`)
- `extension/manifest.json` — Updated extension name to `"Kiroku Note"`.
- `extension/sidepanel/sidepanel.html` — Updated `<title>` to `"Kiroku Note"` and header brand text to `"KIROKU NOTE"`.
- `extension/offscreen/offscreen.html` — Updated title to `"Kiroku Note Audio Recording Service"`.
- `extension/content/capture-utils.js` — Exposed `global.KirokuCapture` with backward-compatible `global.AnkiMinerCapture` alias.
- `extension/content/content.js` — Added `PING_KIROKU` message listener alongside `PING_ANKI_MINER`; bound to `KirokuCapture` with fallback.
- `extension/background.js` — Updated `ensureContentScript` to ping with `PING_KIROKU` (fallback to `PING_ANKI_MINER`).
- `extension/content/video-mining-poc.js` — Exposed `window.__KIROKU_VIDEO_POC__` with `window.__ANKIMINER_VIDEO_POC__` alias; added `KirokuCapture` resolution.
- `extension/lib/subtitle-parser.js` — Updated header docstring.
- `extension/lib/image-cropper.js` — Updated header docstring.
- `extension/offscreen/wav-encoder.js` — Updated header docstring.
- `extension/offscreen/rolling-pcm-buffer.js` — Updated header docstring.
- `extension/offscreen/pcm-worklet-processor.js` — Updated header docstring.
- `extension/offscreen/offscreen.js` — Updated header docstring.
- `extension/offscreen/audio-timeline-sync.js` — Updated header docstring.

### Deleted Throwaway Root Files
- `capture_result.json`
- `termentries_result.json`
- `tokenize_result.json`
- `structure.txt`
- `extract_examples.py`
- `inspect_structure.py`
- `test_capture.py`
- `test_yomitan.py`

---

## 4. Test Verification Results

1. **Backend Test Suite:**
   - Command: `python -m pytest`
   - Result: **135 passed in 8.91s (100%)** across 16 test files.

2. **Extension Test Suite:**
   - Command: `node --test extension/tests/*.test.js`
   - Result: **26/26 test files passed (100%)**.

3. **Backend Startup Verification:**
   - Verified FastAPI app initializes and handles `/api/anki/status` with HTTP 200 via `fastapi.testclient.TestClient`.

---

## 5. Remaining AnkiMiner References and Rationale

| Reference | Location | Rationale for Retaining |
| :--- | :--- | :--- |
| `ANKIMINER_DB_PATH` / `ANKIMINER_MEDIA_DIR` | `backend/app/db/connection.py`, `backend/app/services/media_storage.py` | Retained as secondary fallback environment variables to prevent breaking existing user launch scripts or test harnesses. |
| `ankiminer_img_` / `ankiminer_audio_` | `backend/app/services/card_service.py` | Retained in prefix matchers so existing cards stored in user SQLite databases or Anki note collections remain valid without requiring data migrations. |
| `global.AnkiMinerCapture` | `extension/content/capture-utils.js` | Retained as backward-compatibility alias for `global.KirokuCapture`. |
| `window.__ANKIMINER_VIDEO_POC__` | `extension/content/video-mining-poc.js` | Retained as backward-compatibility alias for `window.__KIROKU_VIDEO_POC__` to ensure all existing extension test suites execute without modification. |
| `PING_ANKI_MINER` | `extension/content/content.js`, `extension/background.js` | Retained in message listeners to support seamless upgrades without reload desynchronization. |
| `#ankiminer-video-overlay-container`, `#ankiminer-video-subtitle`, `#ankiminer-hide-yt-captions`, `#ankiminer-hide-netflix-captions`, `__ankiminer_fs_hooked__` | `extension/content/video-mining-poc.js`, `adapters/` | Retained internal DOM IDs injected into third-party pages (YouTube, Netflix) to avoid breaking styles or mock test fixtures. |

---

## 6. GitHub Actions Required Manually

- When ready, rename the remote GitHub repository from `AnkiMiner` to `kiroku-note`.
- GitHub will automatically handle redirecting existing clone URLs and web links.
