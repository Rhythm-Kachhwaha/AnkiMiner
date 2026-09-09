# AnkiMiner Progress

## Current status

Phase 2 stabilization is complete. All automated tests pass, FastAPI `/api/capture` is verified with all Japanese script variants and deinflected words, and end-to-end capture in Brave (including dynamic subtitles without page reload) is fully verified and reliable across multiple test cycles.

## Implemented

- **Yomitan tokenization & enrichment**: `YomitanService` tokenizes captured text, extracts headwords across segment tokens while ignoring leading punctuation/brackets, normalizes deinflected expressions and readings, and parses primary Jitendex structured content into dictionary senses, parts of speech, and examples.
- **FastAPI Capture Route**: `POST /api/capture` accepts untrusted Japanese selection text, validates payloads with Pydantic, queries `YomitanService`, and returns structured expressions, readings, definitions, and examples with full CORS preflight support for extension and local origins.
- **Extension Capture Pipeline**:
  - `content.js` captures text selections upon user mouseup/keyup, validates Japanese unicode content, queries initial mining mode, and delivers `JAPANESE_TEXT_CAPTURED` directly to the Side Panel.
  - `background.js` manages extension panel behavior, tracks `isMiningModeEnabled` globally, broadcasts mining mode changes across all tabs, and synchronizes active/updated tabs (`onActivated`, `onUpdated`).
  - `sidepanel.js` manages mining toggle UI, requests `/api/capture` asynchronously with a request ID guard against stale out-of-order responses, renders dictionary entries and examples, and displays accurate diagnostics.
  - `capture-utils.js` normalizes selected text and validates Japanese script boundaries including kanji, hiragana, katakana, and iteration marks (`々`).

## Verified

- **Automated backend tests**: 8/8 pytest tests passed in `backend/tests/` (`test_capture_route.py`, `test_dictionary.py`, `test_yomitan.py` including punctuation-enclosed tokens, deinflection, and malformed payload handling).
- **Automated extension unit tests**: Node test passed in `extension/tests/capture-utils.test.js`.
- **FastAPI live API tests**: Tested `POST http://127.0.0.1:8000/api/capture` directly against live Yomitan for:
  - 映画 (kanji): identified `映画`, reading `えいが`, 1 entry, 1 example, gloss: "movie"
  - 日にち (mixed): identified `日にち`, reading `ひにち`, 6 entries, 9 examples, gloss: "date (of a planned event, act, etc.)"
  - 日 (kanji): identified `日`, reading `にち`, 5 entries, 8 examples, gloss: "Sunday"
  - 日本 (kanji): identified `日本`, reading `にほん`, 7 entries, 10 examples, gloss: "Japan"
  - こんにちは (hiragana): identified `今日は`, reading `こんにちは`, 8 entries, 16 examples, gloss: "hello"
  - カメラ (katakana): identified `カメラ`, reading `カメラ`, 34 entries, 33 examples, gloss: "camera"
  - 食べる (verb/mixed): identified `食べる`, reading `たべる`, 5 entries, 5 examples, gloss: "to eat"
  - 見た (deinflection): identified `見る`, reading `みる`, 3 entries, 5 examples, gloss: "to see"
  - 「映画」 (bracketed): identified `映画`, reading `えいが`, 1 entry, 1 example
  - 食べた。 (inflected with punctuation): identified `食べる`, reading `たべる`, 5 entries, 5 examples
- **Brave end-to-end automated tests (CDP)**:
  - Extension loaded into real Brave browser instance with Side Panel.
  - Mining mode toggle activated in Side Panel.
  - Text selections in live web page correctly propagated through content script to Side Panel, FastAPI, and Yomitan, returning rendered expressions, readings, and entries for 映画, 日にち, 日本, こんにちは, カメラ, 食べる, and 見た.
  - Repeated 3 consecutive times with 100% success rate.
- **Dynamic subtitle / no-reload test**:
  - Tested on dynamic subtitle page where subtitles changed from `映画を見る` to `日にちを決める` to `日本へ行く`.
  - Words selected and captured sequentially across all 3 steps without reloading the page.
  - All captures resolved and rendered correctly in the Side Panel.

## Known issues

- None blocking Phase 2. Local mining flow (select Japanese text -> capture -> Yomitan -> parse -> display result) is stable and verified.

## Next task

Phase 3 planning and implementation (local SQLite persistence and duplicate prevention).
