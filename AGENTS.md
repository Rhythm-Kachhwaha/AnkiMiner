# AnkiMiner Agent Guide

## Purpose

AnkiMiner is a local-first personal Japanese vocabulary mining tool optimized for roughly ten seconds per card:

`see Japanese word -> capture -> identify/enrich -> edit -> save locally -> send/sync to Anki`

It is not an Anki replacement, Japanese-learning platform, cloud SaaS, or AI chatbot.

## Project memory and read order

Read these before changing the project:

1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. `PROGRESS.md`
4. `DESIGN.md` when touching UI
5. The relevant `skills/<area>/SKILL.md`
6. Existing implementation and tests

`DESIGN.md` is the visual/design-system foundation and must not be overwritten.

## Locked boundaries

- Application shell: Chromium/Brave Manifest V3 extension with all UI in a Side Panel.
- Extension: vanilla HTML, CSS, and JavaScript only; no React, Electron, or Node.js runtime.
- Backend: Python and FastAPI.
- Persistence: SQLite is the local source of truth.
- Dictionary access: use `YomitanService`; do not distribute Yomitan calls through the codebase.
- JLPT: use a local, replaceable service/dataset; never put its rules in the UI or assume Yomitan provides them.
- Anki: use AnkiConnect in normal operation. A failed sync must never discard a locally saved card.

## Agent workflow

1. Inspect the relevant existing code and tests before modifying anything.
2. Make the smallest scoped change that satisfies the task.
3. Keep responsibilities inside their component/service boundary.
4. Run verification proportionate to the change and record meaningful results in `PROGRESS.md`.
5. Update `PROGRESS.md` before handoff. Architectural changes also require updates to both `ARCHITECTURE.md` and `PROGRESS.md`.

## Multi-agent handoff

- State the files changed, behavior delivered, verification run, and remaining risk in `PROGRESS.md`.
- Do not overwrite or rewrite unrelated components, including work that may belong to another agent.
- If a task depends on an unsettled contract, document the blocker and hand off the narrow question rather than guessing a cross-cutting solution.
- Treat this documentation as persistent memory; do not rely on chat history for decisions or known limitations.

## Scope control

Avoid speculative framework additions, cloud services, setup wizards, and broad refactors. Do not add technologies absent from the locked architecture. Mark genuinely future work as future rather than presenting it as implemented.
- Do not modify `AGENTS.md`, `ARCHITECTURE.md`, `DESIGN.md`, or skill files unless the task requires a documentation/architecture/design change.

## Testing expectations

Test behavior at the closest practical layer: unit tests for normalization and services, integration tests for Yomitan/AnkiConnect boundaries, extension behavior tests where practical, and manual smoke tests for the cross-process mining flow. Never mark work complete without verification or an explicit documented reason it could not be verified.

## Definition of done

A change is done when it meets the requested behavior, respects the architecture and `DESIGN.md` where applicable, handles relevant failure states, has proportionate verification, and leaves `PROGRESS.md` accurate. Changes that alter architecture are done only after the architecture record is updated.
