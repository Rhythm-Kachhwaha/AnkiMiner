# AnkiMiner Progress

## Current status

Phase 2 dictionary-enrichment implementation is verified. All 7 backend unit tests pass. Full FastAPI/browser manual verification remains pending.

## Completed

- Repository initialized.
- `DESIGN.md` generated using getdesign Claude foundation.
- Yomitan local API connectivity verified.
- Yomitan `/serverVersion` verified.
- Yomitan `/tokenize` verified.
- Brave/Chromium environment verified.
- Project architecture, agent workflow, and area skills documented.
- Phase 1 source created: Manifest V3 Side Panel, generic selected-text capture, explicit extension messages, FastAPI `/api/capture`, and isolated `YomitanService` tokenization.
- Confirmed the Yomitan `/tokenize` request contract uses POST with `text` and required numeric `scanLength`; `parser` may be `scanning-parser`.
- Phase 1 manually verified end-to-end: FastAPI started; `POST /api/capture` worked; `YomitanService` identified `映画` as `えいが`; Brave loaded the extension and its Side Panel; mining mode activated; selected Japanese text reached the Side Panel; and the Side Panel displayed expression plus reading.
- Phase 2 implemented: `YomitanService` looks up the normalized expression through `/termEntries`, normalizes primary/Jitendex definitions into meanings/examples, and preserves the Phase 1 identification if lookup fails.
- The Side Panel now renders meanings and an example sentence/translation when returned.

## In progress

- Manual Phase 2 FastAPI and Brave Side Panel enrichment smoke test.

## Blocked

- Yomitan dictionary lookup (`/termEntries`) needs request-contract investigation before dictionary enrichment can be considered working.
- Full browser/API verification of Phase 2 has not yet been performed in this task.

## Known issues

- Yomitan `/serverVersion` works with POST.
- Yomitan `/tokenize` works.
- Yomitan `/termEntries` previously returned HTTP 500 with a test request. Investigate the proper request contract before treating dictionary lookup as solved.
- Do not work around the Yomitan issue by scattering direct Yomitan calls throughout the application.
- A prior live `scanLength: 0` probe for `映画` returned an empty reading. The implemented documented `scanLength: 16` path returns both expression and a three-character reading; the Side Panel still handles an empty provider reading without fabricating one.
- Live `/termEntries` accepts `POST {"term":"映画"}`. It returns `dictionaryEntries`; the live response contains a primary `Jitendex.org [2026-08-11]` definition. Some glossary structures may be empty or presentation-template based, so empty meanings/examples remain a valid result.

## Next task

Start FastAPI and run the Phase 2 manual smoke test: select `映画` in Brave, confirm expression/reading, Jitendex meaning(s), and example content when supplied.

## Recent decisions

- The Chromium/Brave Side Panel is the application shell; its UI is vanilla HTML/CSS/JavaScript.
- SQLite is the local source of truth and persists cards before Anki synchronization.
- Duplicate identity is normalized expression + reading + deck.
- Yomitan access is isolated behind `YomitanService`.
- The Side Panel remains dark and utility-oriented while drawing typography, spacing, and restraint from `DESIGN.md` rather than adopting its cream marketing-page layout.
- Phase 1 uses generic mouse-selection capture while mining mode is active. It intentionally excludes site-specific subtitle parsing, card editing, persistence, and Anki sync.
- `YomitanService` sends `scanLength: 16` and normalizes only expression/reading from the first token.
- `/termEntries` is called only by `YomitanService` with `{ "term": normalized_expression }`. Entry selection prefers primary entries and Jitendex identity when exposed, without relying on a dictionary index.
- Structured content is recursively reduced to readable glossary strings and semantic example-sentence content; raw Yomitan objects are not exposed to the API or UI.

## Agent handoff notes

- Start with the read order in `AGENTS.md` and inspect current code before edits.
- Update this file for every task handoff; architectural changes also update `ARCHITECTURE.md`.
- Keep the first vertical slice narrow. Its goal is identification and display, not card persistence or Anki sync.
- Do not expand the vertical slice into persistence, JLPT, duplicate prevention, or Anki sync until the capture -> identification -> display path is verified.
- Created: `backend/requirements.txt`, `backend/app/*`, `backend/tests/test_yomitan.py`, `extension/manifest.json`, `extension/background.js`, `extension/content/*`, `extension/sidepanel/*`, and `extension/tests/capture-utils.test.js`.
- Verification passed: `backend/tests/test_yomitan.py` (3 tests), `extension/tests/capture-utils.test.js`, and manual end-to-end testing. Manual verification confirmed FastAPI startup, `POST /api/capture`, live Yomitan identification of `映画` -> `えいが`, Brave extension and Side Panel loading, mining-mode activation, webpage selection capture, and Side Panel expression/reading display.
- Phase 2 verification passed: `backend/tests` (6 tests total), including `/termEntries` request construction, primary/Jitendex selection, structured glossary parsing, example Japanese/translation extraction, missing definitions, malformed payloads, and existing tokenization behavior. `extension/tests/capture-utils.test.js` still passes. Live `YomitanService` enrichment for `映画` returned expression/reading, 7 meanings, 1 example, and no provider error. FastAPI route and Brave Side Panel Phase 2 verification are pending.
