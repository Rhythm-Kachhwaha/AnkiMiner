# Kiroku Note — Progress

## Current Status

Kiroku Note is a local-first Japanese vocabulary and sentence mining tool.

Current development target: **V1.0**

The core mining pipeline is functional. Current work is focused on polishing, reliability, UX, and preparing the project for public release.

---

## Core Stack

- **Extension:** Chromium/Brave MV3
- **UI:** Vanilla HTML/CSS/JavaScript
- **Backend:** Python + FastAPI
- **Database:** SQLite
- **Dictionary:** Yomitan / Jitendex
- **Anki:** AnkiConnect
- **Architecture:** Local-first

---

## Completed

### Japanese Text Mining

- [x] Japanese text selection capture
- [x] Mining mode
- [x] Yomitan dictionary lookup
- [x] Dictionary result display
- [x] Card editing
- [x] SQLite card storage
- [x] Duplicate prevention
- [x] AnkiConnect integration
- [x] Explicit card sync to Anki

### Card Library

- [x] Mining history
- [x] Search
- [x] Deck filtering
- [x] Sync status filtering
- [x] Saved card viewing
- [x] Re-save cards
- [x] Local card deletion
- [x] Retry failed sync

### Subtitle Mining

- [x] External subtitle detection
- [x] Subtitle synchronization with video
- [x] YouTube subtitle mining
- [x] Netflix subtitle mining
- [x] HiAnime subtitle mining
- [x] Custom subtitle overlay
- [x] Subtitle navigation
- [x] Subtitle offset
- [x] Pause-on-hover

### Media

- [x] Frame capture
- [x] Frame persistence
- [x] Frame display in cards
- [x] Media persistence and deduplication
- [x] Frame + subtitle integration

### Reliability

- [x] Capture ID / stale-response protection
- [x] SQLite-first storage
- [x] Anki sync state tracking
- [x] DRM frame-capture fail-soft behavior
- [x] Regression testing across supported video sites

---

## Current V1 Work

### Stage 2 — Repository & Branding

- [x] Rename product from AnkiMiner to Kiroku Note
- [x] Audit remaining AnkiMiner references
- [x] Preserve backward compatibility for persisted/internal identifiers
- [x] Clean obsolete repository artifacts
- [x] Prepare repository for `kiroku-note`

### Stage 3 — Dictionary

- [ ] Replace ad-hoc dictionary parsing
- [ ] Introduce structured dictionary representation
- [ ] Preserve multiple senses
- [ ] Improve POS handling
- [ ] Improve examples
- [ ] Preserve useful Yomitan metadata
- [ ] Improve dictionary UI

### Stage 4 — Frontend

- [ ] Redesign Side Panel UI
- [ ] Improve typography
- [ ] Improve layout and spacing
- [ ] Improve card editor
- [ ] Improve responsive behavior
- [ ] Preserve existing extension behavior and DOM contracts

### Stage 5 — Anki Cards

- [ ] Improve card preview
- [ ] Improve generated Anki HTML
- [ ] Improve default card template
- [ ] Improve media presentation
- [ ] Verify compatibility with custom Anki note models

### Stage 6 — UX & Accessibility

- [ ] Keyboard workflow review
- [ ] Accessibility review
- [ ] Error/loading states
- [ ] Empty states
- [ ] First-run experience
- [ ] Settings and preferences review

### Stage 7 — Security & Reliability

- [ ] Local API security review
- [ ] Input validation review
- [ ] Extension permission review
- [ ] Error handling review
- [ ] Persistence/migration review

### Stage 8 — Documentation

- [ ] Finalize README
- [ ] Finalize architecture documentation
- [ ] Create current UI specification
- [ ] Clean remaining documentation
- [ ] Ensure archived reports remain outside active documentation

### Stage 9 — Release Harness

- [ ] Production configuration
- [ ] Extension packaging
- [ ] Backend launcher
- [ ] Clean-machine testing
- [ ] Versioning
- [ ] Release checks

### Stage 10 — Windows Distribution

- [ ] Build easy-to-use Windows package
- [ ] Package backend/launcher
- [ ] Document installation
- [ ] Test on clean Windows environment

### Stage 11 — Final Regression

- [ ] Backend test suite
- [ ] Extension test suite
- [ ] YouTube regression
- [ ] Netflix regression
- [ ] HiAnime regression
- [ ] AnkiConnect regression
- [ ] Yomitan regression
- [ ] Frame capture regression
- [ ] Playback invariant verification

### Stage 12 — V1.0 Release

- [ ] Final version bump
- [ ] Final changelog
- [ ] GitHub repository cleanup
- [ ] GitHub release
- [ ] Public documentation
- [ ] V1.0 package

---

## Deferred Features

These are intentionally outside V1.

### V2

- OCR

### V3

- Audio capture / audio mining

### Later

- Video clips
- GIF/video snippets
- Cloud functionality

Existing audio implementation remains in the repository but is not part of the V1 product scope.

---

## Important Invariants

These rules must not be broken during V1 development.

### Playback

Normal mining must not manipulate video playback.

Do not introduce:

- `currentTime` seeking
- automatic play
- automatic pause
- playback-rate changes
- video replacement

Pause-on-hover is the only intentional playback exception.

### Storage

SQLite is the source of truth.

Saving a card must not implicitly send it to Anki.

### Architecture

Preserve the existing capture and subtitle pipelines unless a specific bug requires changing them.

Avoid large rewrites of working systems.

### Compatibility

Existing cards, media, settings, and persisted data must not be casually invalidated during the rename or refactoring work.

### Development

Changes should be incremental and independently testable.

Do not modify unrelated functionality while working on a specific V1 stage.

---

## Current Baseline

The core application and media-mining functionality has already been implemented and tested.

Before beginning each major V1 stage:

1. Inspect the existing implementation.
2. Establish the current behavior.
3. Make the smallest appropriate change.
4. Run the existing test suites.
5. Perform relevant manual regression testing.
6. Verify critical invariants.
7. Review the final diff.

---

## Project Direction

The goal of V1 is not to add a large number of new features.

The goal is to turn the existing working mining tool into a **polished, reliable, understandable, and easy-to-install public product**.

New major features should generally be deferred unless they are necessary for the V1 experience.