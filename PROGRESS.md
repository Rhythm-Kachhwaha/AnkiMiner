# AnkiMiner Progress

## Current status

Phase 1 source is implemented. Full end-to-end verification remains blocked until FastAPI is installed in a project Python environment.

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

## In progress

- Phase 1 endpoint and browser smoke-test verification once declared backend dependencies are available.

## Blocked

- Yomitan dictionary lookup (`/termEntries`) needs request-contract investigation before dictionary enrichment can be considered working.
- FastAPI is not installed in an available Python environment. `python`/`py` do not resolve to a project Python, and the bundled runtime lacks FastAPI. No dependency installation was performed.

## Known issues

- Yomitan `/serverVersion` works with POST.
- Yomitan `/tokenize` works.
- Yomitan `/termEntries` previously returned HTTP 500 with a test request. Investigate the proper request contract before treating dictionary lookup as solved.
- Do not work around the Yomitan issue by scattering direct Yomitan calls throughout the application.
- A prior live `scanLength: 0` probe for `映画` returned an empty reading. The implemented documented `scanLength: 16` path returns both expression and a three-character reading; the Side Panel still handles an empty provider reading without fabricating one.

## Next task

Install the declared backend dependencies in a project Python environment, run endpoint validation tests, then manually smoke-test Side Panel capture through Yomitan. If live tokenization still lacks a reading for dictionary terms, investigate only the documented tokenization response/headword behavior before considering a dictionary lookup contract.

## Recent decisions

- The Chromium/Brave Side Panel is the application shell; its UI is vanilla HTML/CSS/JavaScript.
- SQLite is the local source of truth and persists cards before Anki synchronization.
- Duplicate identity is normalized expression + reading + deck.
- Yomitan access is isolated behind `YomitanService`.
- The Side Panel remains dark and utility-oriented while drawing typography, spacing, and restraint from `DESIGN.md` rather than adopting its cream marketing-page layout.
- Phase 1 uses generic mouse-selection capture while mining mode is active. It intentionally excludes site-specific subtitle parsing, card editing, persistence, and Anki sync.
- `YomitanService` sends `scanLength: 16` and normalizes only expression/reading from the first token.

## Agent handoff notes

- Start with the read order in `AGENTS.md` and inspect current code before edits.
- Update this file for every task handoff; architectural changes also update `ARCHITECTURE.md`.
- Keep the first vertical slice narrow. Its goal is identification and display, not card persistence or Anki sync.
- Do not expand the vertical slice into persistence, JLPT, duplicate prevention, or Anki sync until the capture -> identification -> display path is verified.
- Created: `backend/requirements.txt`, `backend/app/*`, `backend/tests/test_yomitan.py`, `extension/manifest.json`, `extension/background.js`, `extension/content/*`, `extension/sidepanel/*`, and `extension/tests/capture-utils.test.js`.
- Verification passed: `backend/tests/test_yomitan.py` (3 tests) and `extension/tests/capture-utils.test.js`. Live `YomitanService().identify("映画")` returned an expression of length 2 and a reading of length 3 using `scanLength: 16`. Full FastAPI API validation and browser smoke tests remain unverified because FastAPI is unavailable locally.
