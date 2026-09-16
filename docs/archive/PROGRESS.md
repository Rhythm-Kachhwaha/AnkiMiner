# AnkiMiner Progress

## Current status

Audio Capture Architecture Fix & Production Hardening (2026-09-16):
- **HARD PLAYBACK INVARIANT 100% PRESERVED**:
  - Maintained strictly passive audio capture across all code paths. Zero seeking, zero `video.currentTime` assignment, zero `video.play()`, zero `video.pause()`, zero `video.playbackRate` mutation, zero `video.src` manipulation, zero element replacement.
- **Root Cause Resolutions Delivered**:
  - **Paused-Video Capture Deadlock Fixed**: In `extension/offscreen/audio-timeline-sync.js`, implemented auto-clamping of `targetEndSample` to `currentNewestSample` when video is paused and core speech `[effectiveStart, effectiveEnd]` has arrived in the buffer, eliminating the indefinite `AUDIO_FUTURE_PENDING` deadlock on hover/manual pause.
  - **Timeline Inception Discontinuity Fixed**: In `AudioTimelineSyncEngine.ingestHeartbeat()`, calculated initial anchor timeline start as `timelineStartSample = Math.max(0, currentSample - pastSamples)` to account for prior video time already recorded in the buffer, eliminating false `AUDIO_DISCONTINUITY` rejections on mined subtitle speech. Seek discontinuities appropriately initialize to `currentSample`.
  - **User Gesture Token Loss in MV3 Fixed**: In `extension/sidepanel/sidepanel.js`, acquired `chrome.tabCapture.getMediaStreamId({ targetTabId })` synchronously within the `setMiningMode` user click handler to preserve Chromium MV3 user activation tokens, propagating `streamId` directly to `extension/background.js`.
  - **Past-Oriented Fallback Audio Slice**: In `extension/content/video-mining-poc.js`, updated fallback audio slice generation (when no external subtitle cues are loaded) to capture preceding 3.0 seconds `[ct - 3.0, ct]` instead of future audio, ensuring instant availability in the circular buffer.
  - **Immediate Heartbeat & Offscreen Recovery**: Content script emits immediate heartbeats on `pause` and `seeked` events; background service worker auto-recovers offscreen documents on extraction messages.
  - **Netflix DRM Fail-Soft Handling**: Maintained clean `DRM Restricted` fail-soft status display when Widevine DRM blocks `tabCapture` audio samples at the browser compositor level, preserving frame capture, dictionary lookups, and card drafts.
- **Full Test Suite Verification**:
  - Extension: 26/26 test suites passed (100% success, including `audio-capture-fix-regression.test.js`, `audio-timeline-sync.test.js`, and `audio-reliability-stage5.test.js`).
  - Backend: 135/135 pytest tests passed (100% success, 0 regressions).
  - Diagnostic Audit: Verified instant WAV extraction for paused and fallback audio mining.
- **Final Status: AUDIO CAPTURE ARCHITECTURE FIXED & HARDENED**.

Frame / Screenshot Capture Architecture — Stage 4 (Final Hardening & Regression) (2026-09-15):
- **HARD PLAYBACK INVARIANT 100% PRESERVED**:
  - Maintained strictly passive dual media capture across all code paths. Zero seeking, zero `video.currentTime` assignment, zero `video.play()`, zero `video.pause()`, zero `video.playbackRate` mutation, zero `video.src` manipulation, zero element replacement.
- **Production-Readiness Architecture Audit**:
  - Validated complete pipeline: Subtitle -> Word Mining -> Yomitan -> Screenshot -> Audio -> Side Panel Draft -> Save Card -> SQLite -> Local Media -> History -> AnkiConnect.
  - Verified component boundaries across content script, background worker, offscreen document, Side Panel, FastAPI backend, SQLite, and AnkiConnect.
  - Confirmed independent media state slots (`currentDraftMedia.imageBase64` and `currentDraftMedia.audioBase64`) with clean failure and retake isolation.
- **Deduplication & Local Persistence Verification**:
  - Verified local media file creation (`backend/data/media/ankiminer_img_*.jpg` and `backend/data/media/ankiminer_audio_*.wav`) and SQLite relative filename storage.
  - Confirmed idempotent re-saving and editing from Mining History with 0 file duplication.
- **AnkiConnect Synchronization Verification**:
  - Basic model (`[sound:*.wav]<br><br><img src="*.jpg">` on Back) and Custom models (dedicated Picture/SentenceAudio fields) verified.
  - Fail-soft handling for note models missing image or audio fields without polluting text fields.
  - Duplicate note protection across sync retries.
- **Full Test Suite & Browser Regression**:
  - Extension: 25/25 test suites passed (100% success).
  - Backend: 135/135 pytest tests passed (100% success, 0 regressions).
  - Created final report in [`Frame/Stage4.md`](file:///d:/Python/AnkiMiner/Frame/Stage4.md).
- **Final Status: FRAME CAPTURE COMPLETE**.

Frame / Screenshot Capture Architecture — Stage 3 (Combined Media Card Lifecycle Verification) (2026-09-15):
- **HARD PLAYBACK INVARIANT 100% PRESERVED**:
  - Maintained strictly passive dual media capture across all code paths. Zero seeking, zero `video.currentTime` assignment, zero `video.play()`, zero `video.pause()`, zero `video.playbackRate` mutation, zero `video.src` manipulation, zero element replacement.
- **Independent Media Slots & Isolation**:
  - Verified and confirmed that screenshot image and sentence audio operate in independent slots in `sidepanel.js` (`currentDraftMedia.imageBase64` and `currentDraftMedia.audioBase64`).
  - Capturing, retaking, or clearing image never alters or clears audio; capturing, retaking, or clearing audio never alters or clears image.
  - Tested capture ID isolation scenarios A through G (stale message rejection, cancelled pending captures, fast word switches).
- **Disk & Database Persistence Deduplication**:
  - Saving a dual-media card generates exactly 1 `ankiminer_img_*.jpg` and 1 `ankiminer_audio_*.wav` file.
  - Hardened `CardService.save_card()` in `backend/app/services/card_service.py` with URL-to-filename normalization (`/api/media/` prefix stripping) ensuring editing/re-saving cards from Mining History does not duplicate media files on disk or corrupt SQLite references.
- **AnkiConnect Dual-Media Mapping Integrity**:
  - Basic model: formatted sound tag and image tag (`[sound:*.wav]<br><br><img src="*.jpg">`) attached to `Back` field without collisions.
  - Custom models: mapped cleanly to designated `Picture`/`Image` and `SentenceAudio`/`Audio` fields; unsupported media fields omit cleanly without throwing errors or polluting text fields.
  - Handled sync retries with idempotency and duplicate note protection.
- **Comprehensive Verification**:
  - Created `extension/tests/frame-combined-media-stage3.test.js` (25/25 extension test suites passing, 100%).
  - Created `backend/tests/test_stage3_combined_media.py` (135/135 backend pytest tests passing, 100%, 0 regressions).
  - Created comprehensive Stage 3 report in [`Frame/Stage3.md`](file:///d:/Python/AnkiMiner/Frame/Stage3.md).

Frame / Screenshot Capture Architecture — Stage 2 (Reliability, Timing & Coordinate Hardening) (2026-09-15):
- **HARD PLAYBACK INVARIANT 100% PRESERVED**:
  - Maintained strictly passive frame capture across all code paths. Zero seeking, zero `video.currentTime` assignment, zero `video.play()`, zero `video.pause()`, zero `video.playbackRate` mutation, zero `video.src` manipulation, zero element replacement.
- **Coordinate & Crop Robustness (`extension/lib/image-cropper.js`)**:
  - Added strict `Number.isFinite()` guards on `videoRect` dimensions/positions (`left`, `top`, `width`, `height`) preventing `NaN`/`Infinity` propagation into canvas operations.
  - Implemented boundary clamping for out-of-bounds videos: negative offsets (scrolled partially offscreen), coordinates exceeding viewport dimensions (`imageWidth`, `imageHeight`), and oversized video elements.
  - Hardened `calculateTargetDimensions` across arbitrary aspect ratios (16:9, 21:9 ultrawide, 4:3, 9:16 vertical Shorts/TikTok, 1:1 square, tiny videos), strictly preserving aspect ratio and preventing dimension stretching/distortion while bounding within 640x360 maximum envelope.
  - Hardened `checkBlackFrame` with typed array validation, width/height bounds, and luminance noise-floor thresholding.
- **Side Panel Stale Capture & DRM Isolation (`extension/sidepanel/sidepanel.js`)**:
  - Enforced `captureId` match check on `SCREENSHOT_CAPTURE_STATUS` (and `AUDIO_CAPTURE_STATUS`) message listeners, preventing delayed DRM error broadcasts from earlier word selections from overwriting active card draft status.
- **Multiple Video & Container Resilience (`extension/content/video-mining-poc.js`)**:
  - Hardened `findPrimaryVideo` with safe `isFinite` area checks and visibility filtering (`opacity > 0`, `visibility !== 'hidden'`).
  - Added safe rect validation in `captureCurrentFrame`.
- **Comprehensive Verification**:
  - Created `extension/tests/frame-capture-stage2.test.js` (24/24 extension test suites passing, 100%).
  - Created `backend/tests/test_stage2_frame_capture.py` (127/127 backend pytest tests passing, 100%, 0 regressions).
  - Created comprehensive Stage 2 report in [`Frame/Stage2.md`](file:///d:/Python/AnkiMiner/Frame/Stage2.md).

Frame / Screenshot Capture Architecture — Stage 1 (Architecture Audit & Feasibility Report) (2026-09-15):
- **Full Architecture Audit & Pipeline Inspection**:
  - Inspected the end-to-end frame capture pipeline across `extension/content/video-mining-poc.js`, `extension/lib/image-cropper.js`, `extension/background.js`, `extension/sidepanel/sidepanel.js`, and backend services (`media_storage.py`, `card_service.py`, `anki_connect.py`).
  - **HARD PLAYBACK INVARIANT 100% PRESERVED**: Explicitly verified that frame capture causes **zero** playback manipulation (zero seeking, zero `.play()`, zero `.pause()`, zero `currentTime` manipulation).
  - Confirmed two-tier capture strategy: Tier 1 direct canvas `drawImage` for local/blob streams + Tier 2 `chrome.tabs.captureVisibleTab` fallback with `ImageCropper` for cross-origin/tainted canvases.
  - Confirmed DRM black-frame detection via `ImageCropper.checkBlackFrame()` providing fail-soft `DRM_PROTECTED` user notifications on Widevine/Netflix streams.
  - Confirmed `captureId` stale-capture isolation, 640x360 aspect-ratio downscaling (~30 KB JPEG), SQLite references, and AnkiConnect media synchronization.
  - Created [`Frame/Stage1.md`](file:///d:/Python/AnkiMiner/Frame/Stage1.md) and [`framecapture/Stage1_Report.md`](file:///d:/Python/AnkiMiner/framecapture/Stage1_Report.md).
- **Baseline Verification**:
  - All 23 extension Node test suites pass with 100% success (`23/23 passed`).
  - All 121 backend pytest tests pass with 100% success (`121/121 passed`, 0 regressions).
  - Zero production code was modified during this stage.

Automatic Audio Capture Architecture — Stage 5 (Audio Reliability & Production Hardening) (2026-09-15):
- **Full Audio Lifecycle Hardening**:
  - Resolved pending capture race conditions: propagated `captureId` across `identify()`, `retakeAudio()`, `retakeScreenshot()`, and `video-mining-poc.js`, ensuring stale audio from earlier selections never attaches to newer card drafts.
  - Added pending capture cancellation (`CANCEL_PENDING_AUDIO_CAPTURE`) when audio preview is cleared or when a new Japanese term is identified.
  - Resolved rapid Mining Mode toggling race conditions in `background.js` by checking `isMiningModeEnabled` during asynchronous stream and offscreen initialization.
- **Pending Capture Queue Bounding & Proactive Eviction**:
  - Enforced `maxPendingCaptures = 20` in `AudioTimelineSyncEngine` (`extension/offscreen/audio-timeline-sync.js`) to prevent memory leaks during indefinite pauses.
  - Added proactive eviction of expired pending captures during `onPcmChunkWritten`: any pending item whose start sample has been evicted from the rolling buffer (`targetStartSample < ringBuffer.getOldestSampleIndex()`) is immediately pruned with `AUDIO_BUFFER_EXPIRED`.
- **Playback Rate Transition Re-Anchoring**:
  - Fixed sync drift spike on playback rate changes (0.5x, 1.0x, 1.25x, 1.5x, 2.0x): `ingestHeartbeat` now immediately re-anchors at the rate transition point rather than calculating an artificial drift spike on past samples.
- **Resource Teardown & Leak Prevention**:
  - Enhanced `PersistentAudioCaptureEngine.cleanup()`: nullifies `pcmWorkletNode.port.onmessage` and `track.onended` handlers, immediately closes `AudioContext`, disconnects audio nodes, and clears ring buffer storage.
  - Updated `track.onended` to immediately trigger `this.cleanup()` when Chromium terminates tab capture streams on navigation.
- **AudioWorklet & WAV Encoder Finite Sample Clamping**:
  - Added non-finite sample checks (`NaN`, `Infinity`) in `pcm-worklet-processor.js` and `wav-encoder.js`, clamping to `0.0` to eliminate audio pops and encoder corruption.
  - Hardened `WavEncoder.arrayBufferToDataUrl` with safe chunked byte iteration to eliminate call-stack limits.
- **Comprehensive Verification**:
  - Created `extension/tests/audio-reliability-stage5.test.js` (5+ min streaming stress test, boundary extractions, multi-rate scaling, queue bounding, track ending cleanup, NaN/Infinity clamping).
  - Created `backend/tests/test_stage5_audio_reliability.py` (WAV Data URL storage, path traversal protection, re-save idempotency, AnkiConnect model mapping).
  - All 23 extension node test suites pass with 100% success.
  - All 121 backend pytest tests pass with 100% success (0 regressions).

Automatic Audio Capture Architecture — Stage 4 (Card Draft, Preview, Local Persistence & Anki Integration) (2026-09-15):
- **Card Draft Audio Integration**: Wired Stage 3 `AUDIO_CAPTURED` and `AUDIO_CAPTURE_STATUS` messages to `currentDraftMedia` in `extension/sidepanel/sidepanel.js` supporting structured states: `available`, `pending`, `unavailable`, `expired`, and `discontinuity`.
- **Side Panel Audio Preview**:
  - Implemented compact audio preview container (`#audio-preview-container`) in Card Editor with play, pause, replay (`#btn-replay-audio`), and clear (`#btn-clear-audio`) controls.
  - Added status badge (`#audio-status-badge`) rendering dynamic color-coded pills (`.badge-ready`, `.badge-pending`, `.badge-unavailable`, `.badge-expired`, `.badge-discontinuity`).
  - Audio preview is fully isolated from video playback: zero video seeking, zero forced playback toggles.
- **Local Persistence & Idempotency**:
  - Updated `CardService.save_card()` in `backend/app/services/card_service.py` to persist WAV Data URLs as deterministic `.wav` files via `MediaStorageService` while preserving existing saved filenames on card updates/re-saves without duplicate file creation or orphaned media.
  - Mining History restoration: Opening a saved card restores the audio preview and URL, enabling re-listening and preserving media on re-save.
  - Text mining fail-safe: Card saving and Anki syncing continue smoothly if audio capture is unavailable or restricted.
- **AnkiConnect Field Mapping**:
  - Expanded `AnkiConnectService` model capabilities in `backend/app/services/anki_connect.py` with comprehensive audio keyword detection (`Audio`, `SentenceAudio`, `Sound`, `Word Audio`, `VocabAudio`, `KanaAudio`, etc.).
  - Deterministic mapping attaches `[sound:filename.wav]` to designated audio fields or `Back` (for Basic). If a custom note model lacks an audio field, `supports_audio` is `False`, note creation proceeds with text fields, and audio is never dumped into arbitrary text fields.
  - Re-sync / retry safety: Media upload via `storeMediaFile` and duplicate note detection prevent broken or duplicated media attachments.
- **Verification**:
  - Created `extension/tests/card-draft-audio.test.js` (DOM contracts, draft states, message handling, preview).
  - Created `backend/tests/test_stage4_audio_card.py` (WAV persistence, re-save idempotency, Anki field mapping, failure recovery).
  - All 22/22 extension node test suites pass. All 118/118 backend pytest tests pass with 0 regressions. Full report documented in `stage4.md`.

Automatic Audio Capture Architecture — Stage 3 (Audio Timeline Synchronization & Subtitle Extraction) (2026-09-15):
- **Deterministic 16-Bit Mono WAV Encoder**: Implemented `extension/offscreen/wav-encoder.js` producing standard 44-byte RIFF/WAVE headers, Float32-to-Int16 sample clamping/scaling, and base64 Data URL generation.
- **Ring Buffer Range Extraction**: Added `extractRange(startSample, endSample)` to `RollingPcmBuffer` in `extension/offscreen/rolling-pcm-buffer.js` with boundary wraparound reconstruction and 30-second expiration protection (`AUDIO_BUFFER_EXPIRED`).
- **Audio Timeline Synchronization Engine**: Implemented `AudioTimelineSyncEngine` in `extension/offscreen/audio-timeline-sync.js` featuring:
  - Linear video-time to PCM sample mapping: $n(V) = n_{\text{anchor}} + (V - V_{\text{anchor}}) \times \frac{f_s}{r}$.
  - Real-time heartbeat drift compensation ($|\Delta t| > 80\text{ ms}$).
  - Timeline discontinuity tracking via `timelineId` on seeks, video element replacements, and stream reloads.
  - Audio padding (150 ms pre-padding / 200 ms post-padding) with boundary clamping to timeline inception.
  - Pause and live playhead pending capture queue that automatically finalizes WAV extraction when natural playback delivers the remaining samples.
- **Passive Subtitle Extraction**: Wired `recordSentenceAudio` in `extension/content/video-mining-poc.js` to dispatch passive extraction requests via the background worker to the offscreen sync engine, maintaining 100% adherence to the Hard Playback Invariant.
- **Verification**: Created 3 new test suites (`wav-encoder.test.js`, `audio-timeline-sync.test.js`, `subtitle-audio-extraction.test.js`). All 21 extension node test suites pass and all 110 backend pytest tests pass with 0 regressions. Full report in `Audio/Stage3.md`.

Automatic Audio Capture Architecture — Stage 2 (Persistent Passive Audio Capture & Rolling PCM Buffer) (2026-09-15):
- **Persistent Audio Engine**: Implemented `PersistentAudioCaptureEngine` in `extension/offscreen/offscreen.js` with structured capture states (`IDLE`, `STARTING`, `CAPTURING`, `PAUSED`, `ERROR`, `STOPPED`), maintaining the `tabCapture` stream and `AudioContext` across the entire mining session instead of per-sentence instantiations.
- **AudioWorklet Processing**: Created `extension/offscreen/pcm-worklet-processor.js` to run on the Web Audio thread, downmixing stereo channels to mono `(L + R) / 2` and transferring 2048-sample Float32 blocks (~42.6 ms @ 48 kHz) via zero-copy `MessagePort.postMessage` (avoiding `SharedArrayBuffer` / COOP/COEP constraints).
- **30-Second Circular PCM Ring Buffer**: Implemented `RollingPcmBuffer` in `extension/offscreen/rolling-pcm-buffer.js` with pre-allocated Float32 storage (~5.76 MB @ 48 kHz / ~5.29 MB @ 44.1 kHz), continuous wraparound overwrite, monotonic sample count tracking, and 0 bytes/sec garbage collection churn.
- **Speaker Mirroring**: Connected `audioSource` to `audioContext.destination` with unity gain, ensuring normal speaker playback is completely preserved without echo or latency issues.
- **Hard Playback Invariant Enforced**: Stripped out all legacy seek-and-replay routines in `extension/content/video-mining-poc.js`. Capture is 100% passive and never manipulates `currentTime`, `play()`, `pause()`, or playback rate.
- **Mining Mode Lifecycle**: Wired persistent capture start (`START_PERSISTENT_CAPTURE`) to `SET_MINING_MODE` with single user-gesture stream acquisition in `extension/background.js`, with automatic teardown on mining toggle off or tab removal.
- **Verification**: Added `rolling-pcm-buffer.test.js` and `audio-worklet-pipeline.test.js`. All 18/18 extension node test suites pass and all 110/110 backend pytest tests pass without regressions. Full report documented in `Audio/Stage2.md`.

Automatic Audio Capture Architecture — Stage 1 (Inspection & Architecture Verification) (2026-09-15):
- Completed comprehensive inspection of existing audio capture pipeline across `extension/offscreen/`, `extension/background.js`, `extension/content/`, `extension/sidepanel/`, and test suites against `AudioFeatureReport.md`.
- Evaluated MV3 constraints, user activation lifetime, `tabCapture` stream mirroring, PCM ring buffer sizing (30s Float32 Mono @ 48kHz, ~5.76 MB), `AudioWorklet` transport via 2048-sample blocks, anchor-based synchronization, and DRM fail-soft behavior.
- Verified all existing backend (110/110 pytest) and extension (16/16 node test suites) tests pass without regressions.

Audio Recording & Anki Audio Field Sync Fix (2026-09-15):
- **Backend regex fix**: Fixed `_extract_base64_and_ext` in `backend/app/services/media_storage.py` — regex changed from `r"^data:([^;]+);base64,(.*)$"` to `r"^data:(.*?);base64,(.*)$"` to handle MIME types with parameters like `audio/webm;codecs=opus`. Extension extraction now splits on `;` to get the base MIME for file extension mapping.
- **Backend error logging**: Replaced silent `except Exception: pass` in `backend/app/services/card_service.py` `save_card` with `logger.warning()` calls for both image and audio media save failures, making future issues diagnosable in server logs.
- **Extension audio capture enhancements** in `extension/content/video-mining-poc.js`:
  - Added 3-second fallback slice around `currentTime` when no subtitle cue is available, so audio capture works even without loaded subtitles.
  - Added Tier-2 `captureStream` fallback in `_captureStreamFallback()`: when background `START_AUDIO_RECORDING` via tabCapture fails (gesture restriction, offscreen error), records directly from `video.captureStream()` using MediaRecorder in the content script. Video frame capture (Tier-1 canvas / Tier-2 captureVisibleTab) is strictly untouched.
- **Verification**: 110/110 backend pytest tests pass (including 4 new tests for codecs=opus parsing, card save, and Anki field mapping). All 16/16 extension node test suites pass, verifying playback invariants, DOM contracts, and offscreen recording.

Codebase Audit & Stabilization Pass:
- Stage 1 (Video Playback Stability & Invariant Enforcement) is complete and verified (2026-09-14).
  - Enforced playback invariant in `extension/content/video-mining-poc.js` (`recordSentenceAudio`): video is NEVER seeked, forced to play, or paused during audio capture. If video is paused, fails gracefully (`AUDIO_CAPTURE_UNAVAILABLE`) without touching playback.
  - Removed automated `retakeAudio()` call during `identify()` in `extension/sidepanel/sidepanel.js` so that subtitle hover/selection never triggers background recording or playback disruption.
  - Updated DOM contract and lifecycle assertions in `extension/tests/audio-recording.test.js` to ensure playback invariants are strictly preserved.
- Stage 2 (Pause-on-Hover Stabilization) is complete and verified (2026-09-14).
  - Resolved `SubtitleAutoPauseController` state machine race conditions in `extension/content/video-mining-poc.js`:
    - Synchronously protected pause invocation with `_isPausing` so internal pause calls never trigger accidental state wipes in `handleVideoPlay()`.
    - Added `_doPlatformPause(video)` and `_doPlatformPlay(video)` supporting native HTML5 video and Netflix player control selectors (`.button-nfplayerPause`, `.button-nfplayerPlay`) with safe try-catch fail-soft error handling.
    - Preserved rapid mouse in/out flapping debounce (150ms) to ensure moving between words or quickly glancing at subtitles does not freeze or jitter video playback.
- Stage 3 (Audio Capture Reliability & Invariant Preservation) is complete and verified (2026-09-14).
  - Added recording mutex `isRecordingAudio` in `extension/background.js` rejecting concurrent requests with `RECORDING_IN_PROGRESS`.
  - Enforced guaranteed resource release in `extension/offscreen/offscreen.js`: `cleanup()` closes `audioContext`, stops MediaStream tracks, and cleans timers on all error and completion paths.
  - Handled DRM-restricted streams gracefully: returns structured `DRM_AUDIO_RESTRICTED` without throwing unhandled exceptions.
  - Added non-blocking status broadcast `AUDIO_CAPTURE_STATUS` in `extension/content/video-mining-poc.js` and non-blocking notification in `extension/sidepanel/sidepanel.js` ("Audio unavailable for this source (DRM protected)").
- Stage 4 (Frame / Image Capture Robustness) is complete and verified (2026-09-14).
  - Preserved Tier-1 (direct canvas `drawImage`) and Tier-2 (`captureVisibleTab` + `ImageCropper`) capture architecture in `extension/content/video-mining-poc.js`.
  - Added black-frame DRM detection in Tier 1 via `cropper.checkBlackFrame()` to seamlessly fall back to Tier 2 on black/tainted frames.
  - Added non-blocking failure broadcast `SCREENSHOT_CAPTURE_STATUS` and Side Panel notification ("Image unavailable for this source (DRM protected)") without blocking card creation or corrupting card drafts.
  - All automated backend tests pass (92/92 pytest tests).
  - All extension unit, DOM contract, and offscreen audio recording tests pass (15/15 node test suites).

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

## Phase 8.1 (Video Mining Controls) — Hotkey Compatibility Fix (Netflix Hotkey Suppression)

- **Files Changed**:
  - `extension/content/video-mining-poc.js`:
    - Added `isNetflixPlatform()` helper utilizing `NetflixAdapter.isNetflixPage()` with fallback to `location.hostname.includes("netflix.com")`.
    - Added clean platform guard in `SubtitleHotkeyController.attach()` and `SubtitleHotkeyController.handleKeyDown()` disabling hotkeys entirely on Netflix (`if (isNetflixPlatform()) return;`).
    - Restored original `netflixAdapter` `onCue` callback so live Netflix subtitle observation/rendering runs without unnecessary state modifications.
    - Exported `isNetflixPlatform` on `window.__ANKIMINER_VIDEO_POC__`.
  - `extension/tests/subtitle-hotkeys.test.js`:
    - Updated environment mock to support explicit HiAnime domain (`hianime.to`).
    - Explicitly verified HiAnime video player hotkey operations (`A`/`S`/`D`/`Space`).
    - Updated Netflix test suite to verify AnkiMiner does NOT intercept `A`, `S`, `D`, or `Space` on Netflix (`defaultPrevented === false`, no video state changes), while confirming Netflix subtitle detection and overlay rendering remain 100% operational.

- **Behavior Delivered**:
  1. **Netflix Compatibility Restored**: Hotkeys `A`, `S`, `D`, and `Space` are never intercepted on Netflix, allowing native Netflix and browser player controls to function completely unimpeded.
  2. **HiAnime & YouTube Hotkeys Intact**: `A` (previous), `S` (replay), `D` (next), and `Space` (play/pause) continue to work seamlessly on HiAnime and YouTube.
  3. **Zero Regression on Netflix Subtitle Mining**: Netflix native subtitle detection (`.player-timedtext`), overlay rendering, selectable text, Yomitan lookups, and card saving remain fully active.

- **Verification Run**:
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - All 10 node extension test suites: PASSED (0 failures)
  - Backend pytest suite: PASSED (92/92 passed, 0 regressions)

## Phase 8.2 (Auto-Pause on Subtitle Hover)

- **Files Changed**:
  - `extension/content/video-mining-poc.js`:
    - Added `SubtitleAutoPauseController` managing hover lifecycle and video pause/resume orchestration.
    - Implemented hover pause logic: mouseenter pauses active video ONLY if video is currently playing (`!video.paused`), marking `pausedByHover = true`.
    - Implemented leave resume logic: mouseleave resumes video ONLY if AnkiMiner paused it because of the hover (`pausedByHover === true`). If the video was already paused before hovering or paused externally, it is NOT resumed.
    - Implemented 150ms debounce on resume, canceling pending playback if mouse rapidly re-enters, eliminating pause/play flapping and edge jitter during Yomitan dictionary scanning.
    - Implemented external play tracking: video `play` events reset `pausedByHover = false` so manual player interactions are not overridden.
    - Enhanced `SubtitleOverlayRenderer`: added `setHoverLocked(locked)` and `pendingCue` management to keep the currently displayed subtitle text stable under cursor if the video timestamp crosses cue boundaries while hovering.
    - Integrated `autoPauseController` into `VideoMiningPOC`: attaches to active video and overlay element on video detection; reads `"auto_pause_on_hover"` from `chrome.storage.local` (with `localStorage` fallback) on init; listens to storage changes (`chrome.storage.onChanged`) and runtime message `SET_AUTO_PAUSE_ON_HOVER`.
    - Exported `SubtitleAutoPauseController` on `window.__ANKIMINER_VIDEO_POC__`.
  - `extension/sidepanel/sidepanel.html`:
    - Added compact `#toggle-auto-pause-hover` checkbox and label inside `#video-mining-section`.
  - `extension/sidepanel/sidepanel.css`:
    - Added styling for `.video-options-row`, `.toggle-control`, `.toggle-checkbox`, and `.toggle-label` consistent with `DESIGN.md` developer-utility dark theme tokens.
  - `extension/sidepanel/sidepanel.js`:
    - Added `toggleAutoPauseHover` element reference.
    - Added `loadAutoPausePreference()` and `setAutoPausePreference(enabled)` using `chrome.storage.local` with fallback to `localStorage` under key `"auto_pause_on_hover"`. Defaults to `false` (OFF).
    - Integrated preference loading in sidepanel initialization and bound `change` listener.
  - `extension/tests/sidepanel.test.js`:
    - Added DOM contract assertion verifying `#toggle-auto-pause-hover` exists in `sidepanel.html`.
  - `extension/tests/subtitle-auto-pause.test.js` (NEW):
    - Comprehensive 11-test suite covering: default disabled state (no-op), enabled hover pause / leave resume, video already paused before hover (no auto-resume), external pause/play during hover, rapid in/out flapping debounce, subtitle stability / disappearing cue protection, cue navigation while hovered, dynamic active video switching, multi-platform compatibility (HiAnime, YouTube, Netflix, external SRT/VTT), Phase 8.1 hotkey isolation, Yomitan text selectability / DOM compatibility, and storage/messaging synchronization.

- **Behavior Delivered**:
  1. **Optional Auto-Pause on Hover**: Video Mining Mode optionally pauses active video when hovering AnkiMiner's Japanese subtitle overlay, allowing comfortable Yomitan dictionary lookups.
  2. **Safe Resume Rules**: Resume playback ONLY if AnkiMiner paused the video because of the hover. If the video was already paused, or paused externally, playback never auto-resumes.
  3. **Anti-Flap Debounce**: Rapid mouse in/out movements are debounced by 150ms, preventing browser audio/video play-interruption exceptions.
  4. **Stable Yomitan Scanning Surface**: The active cue remains visible even if video timestamp reaches cue boundary during pause; DOM remains standard `<span>` without Shadow DOM or Canvas.
  5. **Phase 8.1 Hotkey Compatibility**: `A`, `S`, `D`, `Space` hotkeys remain fully functional on HiAnime and YouTube, and remain strictly disabled on Netflix.
  6. **Zero Regression on Existing Features**: Text mining, Yomitan integration, Card Editor, SQLite, and AnkiConnect remain 100% functional.

- **Verification Run**:
  - `extension/tests/subtitle-auto-pause.test.js`: PASSED
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - Extension test suite: 11/11 test files passed (0 failures).
  - Backend pytest suite (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

## Phase 8.3 (Subtitle Synchronization Controls)

- **Files Changed**:
  - `extension/content/video-mining-poc.js`:
    - Updated `SubtitleSynchronizer`:
      - Added `offsetMs = 0` and `offset = 0` (in seconds).
      - Added `setOffsetMs(ms)` and `setOffset(sec)` keeping milliseconds and seconds in sync.
      - Added `getEffectiveCue(cue)` computing `{ ...cue, startTime: Math.max(0, cue.startTime + offset), endTime: Math.max(0, cue.endTime + offset) }` without mutating the original cue object.
      - Implemented `findCueAtTime(currentTime)` using `unshiftedTime = currentTime - offset` such that positive offset causes cues to render *later* in playback, and negative offset causes cues to render *earlier*.
    - Updated `SubtitleHotkeyController`:
      - Added `[` (decrease offset by 100 ms).
      - Added `]` (increase offset by 100 ms).
      - Added `\` (reset offset immediately to 0 ms).
      - Guarded against editable elements (`isEditableTarget(e.target)`), modifier keys (`Ctrl`, `Alt`, `Meta`), and disabled entirely on Netflix (`isNetflixPlatform()`).
      - Updated `seekToCue(cue)` to seek to `Math.max(0, cue.startTime + offset)` (the effective start time).
      - Updated `getActiveCue()`, `previousSubtitle()`, `replaySubtitle()`, and `nextSubtitle()` to use effective offset timing when navigating between cues.
    - Updated `VideoMiningPOC`:
      - Added `broadcastOffset(offsetMs)` notifying Side Panel via `SUBTITLE_OFFSET_CHANGED`.
      - Added `persistOffset(offsetMs)` saving to `chrome.storage.local` with fallback to `localStorage` under key `"subtitle_timing_offset"`.
      - Loaded stored `"subtitle_timing_offset"` preference on startup.
      - Updated message handler to process `SET_SUBTITLE_OFFSET` and `CLEAR_SUBTITLES` without resetting user timing preference.
  - `extension/sidepanel/sidepanel.html`:
    - Updated `.video-offset-controls` container:
      - Formatted label: `<span class="offset-label">Subtitle Offset:</span>`.
      - Decrement button: `<button type="button" id="offset-minus-btn" class="btn-offset">-100ms</button>`.
      - Value display / reset button: `<button type="button" id="offset-reset-btn" class="btn-offset-reset" title="Click or press \ to reset offset to 0 ms"><span id="offset-display">0 ms</span></button>`.
      - Increment button: `<button type="button" id="offset-plus-btn" class="btn-offset">+100ms</button>`.
  - `extension/sidepanel/sidepanel.css`:
    - Refined `.btn-offset-reset` with `min-width: 58px` and monospace tabular numbers so formatted offsets (`+300 ms`, `-200 ms`) display stably without layout shifting or text clipping.
  - `extension/sidepanel/sidepanel.js`:
    - Added `currentSubtitleOffsetMs = 0`.
    - Added `formatOffset(offsetMs)` returning `"0 ms"`, `"+X ms"`, or `"-X ms"`.
    - Added `updateOffsetDisplay(offsetMs)` updating `#offset-display`.
    - Added `adjustOffset(deltaMs)` sending `SET_SUBTITLE_OFFSET` to active tab and persisting preference.
    - Added `resetOffset()` resetting offset to 0 ms.
    - Added Side Panel `keydown` listener handling `[`, `]`, and `\` shortcuts when Video Mining view is active and focus is not on editable elements.
    - Added runtime listeners for `SUBTITLE_OFFSET_CHANGED` and `SUBTITLE_CUE_CHANGED`.
    - Added storage listener for `chrome.storage.onChanged` on `"subtitle_timing_offset"`.
  - `extension/tests/video-mining-integration.test.js`:
    - Updated `testTimingOffset` to align with the Phase 8.3 specification (positive offset renders cues later).
  - `extension/tests/subtitle-hotkeys.test.js`:
    - Updated `testOffsetWithHotkeys` to align with the Phase 8.3 specification.
  - `extension/tests/subtitle-sync-offset.test.js` (NEW):
    - Comprehensive 11-test suite covering:
      1. Default offset (0 ms) rendering and state.
      2. Keyboard shortcuts `[` (-100ms), `]` (+100ms), `\` (0ms reset).
      3. Positive offset (+500ms) making cues appear later in playback.
      4. Negative offset (-500ms) making cues appear earlier in playback.
      5. Previous/Replay/Next cue navigation with offset seeking to effective start times.
      6. Hotkey safety on editable elements and modifier keys.
      7. Netflix platform exclusion for offset hotkeys.
      8. Edge cases (no cues, NaN safety, negative seek clamping, large offset beyond duration).
      9. Storage persistence (`subtitle_timing_offset`) and runtime messaging synchronization.
      10. Side Panel UI contract, button interactions, and format string contracts (`0 ms`, `+300 ms`, `-200 ms`).
      11. Coexistence with Phase 8.1 hotkeys (`A`/`S`/`D`/`Space`) and Phase 8.2 auto-pause on hover.

- **Behavior Delivered**:
  1. **Precise Subtitle Synchronization**: Users can adjust subtitle timing in 100 ms increments using `[` and `]` or the Side Panel buttons, and immediately reset to 0 ms with `\`.
  2. **Consistent Effective Timing**: Positive offset delays cues (`cue.startTime + offset`), negative offset advances cues; active cue detection, subtitle rendering, and cue navigation (`A`/`S`/`D`) all use the effective time consistently.
  3. **Immutability of Source Cues**: Original subtitle cue timestamps are never mutated; effective times are computed dynamically.
  4. **Compact Side Panel UI**: Minimalist developer-utility UI with clear feedback (`0 ms`, `+100 ms`, `-200 ms`), accessible tooltips, and click-to-reset.
  5. **Platform Safety & Netflix Exclusion**: `[`, `]`, and `\` hotkeys are strictly disabled on Netflix, preserving native streaming player keybindings.
  6. **Zero Regressions**: Text mining, Yomitan hover lookups, Card Editor, SQLite persistence, and AnkiConnect sync remain 100% operational.

- **Verification Run**:
  - `extension/tests/subtitle-sync-offset.test.js`: PASSED
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/subtitle-auto-pause.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - Extension test suite: 12/12 test files passed (0 failures).
  - Backend pytest suite (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

- **Remaining Risk**:
  - Videos with non-linear drift (variable frame rate desync) where timing drifts progressively across an entire movie; static offset corrects fixed/uniform desync (as intended for Phase 8.3).

## Phase 8 Cleanup (Remove POC Artifacts + Subtitle Display Fixes)

- **Files Changed**:
  - `extension/content/video-mining-poc.js`:
    - **Task 1 (Remove all POC/test subtitles)**:
      - Removed runtime `TEST_CUES` array (`"これはテストです"`, `"字幕が同期されています"`, etc.).
      - Defaulted `SubtitleSynchronizer` constructor to empty cues array (`cues = []`).
      - Defaulted `VideoMiningPOC` constructor to instantiate `syncEngine` with empty array `[]`.
      - Removed `TEST_CUES` export from `window.__ANKIMINER_VIDEO_POC__`.
      - Ensured application never displays fake/test subtitles when real subtitles are unavailable.
    - **Task 2 (HiAnime fullscreen external subtitle bug)**:
      - Added `getFullscreenElement()` supporting vendor prefixes (`document.fullscreenElement`, `webkitFullscreenElement`, `mozFullScreenElement`, `msFullscreenElement`).
      - Added `getTargetContainer()`: when fullscreen is active, resolves the player container element enclosing the active video (e.g., HiAnime/JWPlayer `.player-container` / `#player`, YouTube `#movie_player`, Netflix `.nf-player-container`) or falls back to `document.body` for normal playback.
      - Added `ensureMounted()`: checks if `this.container.isConnected` is false (e.g. if the player replaces the DOM container upon entering fullscreen) or if `container.parentElement !== targetContainer`, re-attaching the subtitle overlay to the active target immediately.
      - Enhanced `updatePosition()`:
        - In fullscreen: calculates relative video coordinates (`vRect.left - fsRect.left`, `vRect.top - fsRect.top`) to position overlay at 78% video height and centered over the video width using `position: absolute !important`. Correctly handles pillarboxing (4:3) and letterboxing (16:10 / 21:9) across screen resize and aspect-ratio changes.
        - When exiting fullscreen: safely restores container to `document.body` with `position: fixed !important` positioned over `vRect`.
        - Dynamically scales font size between 16px and 38px proportional to video width in both fullscreen and windowed modes.
      - Added layout settling timers (requestAnimationFrame, 100ms, 300ms) and listened to vendor-prefixed `fullscreenchange`, `video.resize`, and `loadedmetadata` events.
      - Updated `VideoDetector` to listen to `fullscreenchange` so swapped or re-parented video elements are immediately tracked.
    - **Task 3 (Hide subtitle when nothing is being said)**:
      - Added `setStyleProperty(el, prop, val, priority)` helper to safely set CSS properties with `!important` priority while remaining compatible with test mock environments.
      - Updated `renderCue(cue)`:
        - When `!cue || !cue.text`: immediately empties subtitle text (`this.subtitleEl.textContent = ""`), hides subtitle span (`display: none !important`), and hides overlay container (`display: none !important; visibility: hidden !important; opacity: 0 !important;`).
        - When `cue && cue.text`: sets text, displays span (`display: inline-block !important`), displays container (`display: flex !important; visibility: visible !important; opacity: 1 !important;`), and updates position.
      - Updated `SubtitleSynchronizer`:
        - `setCues(newCues)` and `detach()` call `this.sync(true)` / `this._updateCue(null, true)` with forced dispatch so loading/clearing subtitles or detaching immediately hides any rendered subtitle.
        - Synchronizer strictly validates timestamps: video currentTime outside active cues returns `null`, hiding the subtitle immediately before, between, and after cue intervals, while respecting Phase 8.3 timing offsets.
  - `extension/tests/video-mining-poc.test.js`:
    - Exposed `MockElement` and added `MockElement.prototype.contains(node)` and `mockDocument.fullscreenElement` to DOM mock.
    - Updated `testCapturePipelineIntegration` to provide its test cue explicitly via `setCues()` instead of relying on deleted dummy POC cues.
    - Added `testNoDemoSubtitlesWhenEmpty`: verified that with no cues loaded, `syncEngine.cues` is empty, seek to any time has `currentCue === null`, and overlay is empty and hidden.
    - Added `testHiAnimeFullscreenBehavior`: verified overlay moves to player wrapper in fullscreen with `position: absolute`, updates with currentTime, survives player DOM replacement via `ensureMounted`, and moves back to `document.body` with `position: fixed` upon exit.
    - Added `testInactiveCueHiding`: verified overlay is hidden before cue start, visible during cue, hidden immediately after cue, hidden in gaps between cues, and respects subtitle offset.

- **Behavior Delivered**:
  1. **POC Test Subtitles Completely Removed**: Zero fake/dummy cues ("これはテストです", etc.) remain at runtime. With no subtitles loaded, no overlay text is displayed.
  2. **HiAnime Fullscreen Resolved**: External subtitles remain visible, positioned over the video, interactive for Yomitan, and synchronized when entering/exiting fullscreen on HiAnime.
  3. **Clean Gap Hiding**: Subtitles disappear completely when nobody is speaking; stale cues and ghost badges are eliminated.
  4. **Phase 8.1, 8.2, 8.3 Preserved**: YouTube native CC, Netflix live subtitles, A/S/D/Space hotkeys (with Netflix exclusion), hover auto-pause, and subtitle offset synchronization remain 100% functional.
  5. **Core Text Mining & Persistence Intact**: Yomitan text capture, Card Editor, SQLite persistence, and AnkiConnect sync remain 100% operational.

- **Verification Run**:
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/subtitle-sync-offset.test.js`: PASSED
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/subtitle-auto-pause.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - Node test suite: 12/12 test files passed (0 failures).
  - Backend pytest suite (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

- **Remaining Risk**:
  - Custom web players that render video inside a closed Shadow DOM or canvas-based software decoders (mitigated by standard HTML5 video detection and iframe coverage).

## Video Media Mining — Step 1: Background Screenshot Capture & Canvas Cropper

- **Files Changed / Created**:
  - `extension/manifest.json`:
    - Added `"tabs"` to `"permissions"` for window resolution and `chrome.tabs.captureVisibleTab`.
    - Added `"<all_urls>"` to `"host_permissions"` to enable tab capture across streaming platforms.
    - Registered `"lib/image-cropper.js"` in `content_scripts[0].js` ahead of `video-mining-poc.js`.
  - `extension/background.js`:
    - Added runtime message listener for `CAPTURE_VIDEO_FRAME`.
    - Resolves `sender.tab.windowId` and executes `chrome.tabs.captureVisibleTab` with requested format (default `jpeg`) and quality (default 95).
    - Returns `{ ok: true, dataUrl }` or `{ ok: false, error }` asynchronously via `sendResponse`.
  - `extension/lib/image-cropper.js` (NEW):
    - Standalone image cropper and coordinate transformation utility with universal UMD/CJS export.
    - `calculateCropBounds(rect, pixelRatio, imageWidth, imageHeight)`: Scales bounding rect coordinates (`left`, `top`, `width`, `height`) by `devicePixelRatio`, clamps to viewport image boundaries, and prevents negative offsets.
    - `calculateTargetDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight)`: Computes aspect-ratio-preserving downscaled dimensions (default `maxWidth: 640`, `maxHeight: 360`) to keep card file sizes lightweight (~60–100 KB).
    - `checkBlackFrame(pixelData, width, height)`: Multi-point pixel sampling detecting solid black frames (Widevine DRM blanking on Netflix) or transparent compositor layers.
    - `cropVideoFrame(viewportDataUrl, rect, options)`: Off-DOM canvas pipeline loading viewport image, cropping video sub-rect, validating DRM status, and exporting clean JPEG data URL.
  - `extension/content/video-mining-poc.js`:
    - Added `captureCurrentFrame(options)` method to `VideoMiningPOC`:
      - Checks `this.activeVideo` presence and connection.
      - Calculates video bounding rectangle via `getBoundingClientRect()`.
      - Dispatches `CAPTURE_VIDEO_FRAME` message to background worker.
      - Crops the resulting frame via `ImageCropper.cropVideoFrame(...)`.
      - Broadcasts `SCREENSHOT_CAPTURED` with data URL, current timestamp, width, and height via `chrome.runtime.sendMessage`.
    - Added `TRIGGER_VIDEO_SCREENSHOT` message listener in `handleMessage` allowing external callers (Side Panel) to invoke frame capture on demand.
    - Exposed `ImageCropper` in `window.__ANKIMINER_VIDEO_POC__`.
  - `extension/tests/capture-screenshot.test.js` (NEW):
    - Added comprehensive unit and contract test suite:
      - Manifest verification for permissions, host_permissions, and content script load order.
      - `calculateCropBounds` scaling with standard (1.0), HiDPI (2.0), fractional (1.25) pixel ratios, negative coordinate clamping, and boundary containment.
      - `calculateTargetDimensions` aspect-ratio downscaling for 1080p, 720p, vertical video, and small frames.
      - `checkBlackFrame` DRM detection for solid black, noise floor black, normal video frames, and transparent frames.
      - `cropVideoFrame` end-to-end execution with mock image/canvas and DRM error handling.
      - `background.js` message listener contract for `CAPTURE_VIDEO_FRAME`.
      - `VideoMiningPOC.captureCurrentFrame` and `TRIGGER_VIDEO_SCREENSHOT` message handler.

- **Behavior Delivered**:
  1. **CORS Canvas Tainting Eliminated**: Direct canvas video capture errors (`SecurityError`) on streaming sites are completely bypassed using background viewport capture + off-DOM cropping.
  2. **Device Pixel Ratio & Aspect Ratio Fidelity**: Coordinates scale accurately for HiDPI/Retina screens; frames downscale to compact 640x360 maintaining original aspect ratio.
  3. **DRM Protected Stream Detection**: Protected streams that render black boxes are detected and report `{ ok: false, error: "DRM_PROTECTED" }` rather than generating corrupted cards.
  4. **Zero Regressions**: All existing text capture, dictionary lookup, subtitle overlay, navigation hotkeys, auto-pause, and backend persistence/sync features remain 100% operational.

- **Verification Run**:
  - `extension/tests/capture-screenshot.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/subtitle-sync-offset.test.js`: PASSED
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/subtitle-auto-pause.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - Node test suite: 13/13 test files passed (0 failures).
  - Backend pytest suite (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

- **Remaining Risk**:
  - Browser windows that are fully minimized or occluded when `captureVisibleTab` is called may produce blank captures (mitigated by calling during active mining gestures).

## Video Media Mining — Step 2: Manifest V3 Offscreen Document Audio Recording Service

- **Files Changed / Created**:
  - `extension/manifest.json`:
    - Added `"tabCapture"` and `"offscreen"` to `"permissions"` for tab audio stream acquisition and offscreen DOM/WebAudio execution.
  - `extension/offscreen/offscreen.html` (NEW):
    - Minimal HTML hosting `offscreen.js` inside an extension offscreen document (`reasons: ['USER_MEDIA']`).
  - `extension/offscreen/offscreen.js` (NEW):
    - Implemented `OffscreenAudioRecorder`:
      - `startRecording({ streamId, durationMs, mimeType })`: Calls `navigator.mediaDevices.getUserMedia` with tab capture stream ID.
      - Audio Mirroring: Pipes stream into an `AudioContext` and connects `audioSource.connect(audioContext.destination)` so user speaker playback continues uninterrupted during recording.
      - Encodes `audio/webm;codecs=opus` (fallback `audio/webm`) via `MediaRecorder`.
      - Converts recorded chunks to base64 data URL via `FileReader`.
      - Automatic timeout duration stop and resource cleanup (stops stream tracks, closes `AudioContext`).
      - DRM / protected stream error handling (`DRM_AUDIO`).
      - Universal UMD / CommonJS export for browser offscreen and Node.js testing.
  - `extension/background.js`:
    - Added `ensureOffscreenDocument()` and `hasOffscreenDocument()` lifecycle helpers with concurrency locking.
    - Added runtime message listener for `START_AUDIO_RECORDING`:
      - Resolves target tab ID.
      - Obtains stream token via `chrome.tabCapture.getMediaStreamId({ targetTabId })`.
      - Ensures offscreen document is open.
      - Sends `START_RECORDING_OFFSCREEN` with `streamId` and `durationMs` to offscreen document and responds.
    - Added runtime message listener for `STOP_AUDIO_RECORDING`:
      - Forwards `STOP_RECORDING_OFFSCREEN` to offscreen document.
  - `extension/content/video-mining-poc.js`:
    - Added `recordSentenceAudio(cue, options)` to `VideoMiningPOC`:
      - Calculates lead-in padding (default 150ms: `audioPaddingStart = 0.15`) and tail padding (default 200ms: `audioPaddingEnd = 0.20`).
      - Factors in subtitle timing offset (`this.syncEngine.offset`) and video playback rate.
      - Stores current playback state (`wasPaused`).
      - Seeks video to `Math.max(0, (cue.start + offset) - audioPaddingStart)` and awaits `seeked`.
      - Dispatches `START_AUDIO_RECORDING` with exact `durationMs` to background worker.
      - Plays video forward during recording.
      - Restores video playback state upon completion (`wasPaused ? pause() : keep playing`).
      - Broadcasts `AUDIO_CAPTURED` with `dataUrl`, `mimeType`, `startTime`, `endTime`, `durationMs`, and `cue`.
    - Added `TRIGGER_AUDIO_RECORDING` message handler in `handleMessage`.
  - `extension/tests/audio-recording.test.js` (NEW):
    - Added comprehensive unit and contract test suite:
      - Manifest permissions and offscreen document file checks.
      - `OffscreenAudioRecorder` lifecycle, audio mirroring destination connection, track closing, and timeout.
      - DRM / AbortError handling (`DRM_AUDIO`).
      - `background.js` offscreen document lifecycle and audio coordination contract.
      - `VideoMiningPOC.recordSentenceAudio` seeking, padding, playback restoration, timing offsets, and `AUDIO_CAPTURED` broadcast.

- **Behavior Delivered**:
  1. **Tab Audio Recording in MV3**: Audio streams captured without native audio binaries using Chrome MV3 Offscreen Documents.
  2. **Audio Mirroring**: Tab audio continues playing through the user's speakers during recording.
  3. **Precision Timing & Padding**: Sentence audio includes 150ms lead-in padding and 200ms tail padding, scaled by playback rate and adjusted by user subtitle offset.
  4. **Playback State Fidelity**: Paused videos stay paused after recording; playing videos keep playing.
  5. **DRM Resilience**: Encrypted/protected streams report structured `{ ok: false, error: "DRM_AUDIO" }`.
  6. **Zero Regressions**: All 14 extension test suites and 92 backend tests pass with 0 errors.

- **Verification Run**:
  - `extension/tests/audio-recording.test.js`: PASSED
  - `extension/tests/capture-screenshot.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/subtitle-sync-offset.test.js`: PASSED
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/subtitle-auto-pause.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - Node test suite: 14/14 test files passed (0 failures).
  - Backend pytest suite (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

## Video Media Mining — Step 3: Side Panel UI Integration, Media Previews & Mining Triggers

- **Files Changed / Created**:
  - `extension/sidepanel/sidepanel.html`:
    - Added `#media-preview-container` (`.media-preview-container`) inside `#card-editor`.
    - Added `#image-preview-container` (`.media-preview-card`) with badge, `#btn-retake-image`, `#btn-clear-image`, and `#image-preview` (`<img>`).
    - Added `#audio-preview-container` (`.media-preview-card`) with badge, `#btn-retake-audio`, `#btn-clear-audio`, and `#audio-preview` (`<audio controls>`).
  - `extension/sidepanel/sidepanel.css`:
    - Added responsive dark theme styles adhering to `DESIGN.md`: `#252320` background, `#3d3a35` border, `#cc785c` accent badges.
    - Constrained image thumbnail (`max-height: 90px; width: 100%; object-fit: contain`).
    - Constrained compact audio player (`height: 28px; width: 100%`).
    - Micro action buttons with hover states, zero horizontal overflow down to 320px width.
  - `extension/sidepanel/sidepanel.js`:
    - Added `currentDraftMedia = { imageBase64, audioBase64, mimeType, captureId }` draft state.
    - Added DOM references for media preview elements and controls.
    - Implemented `updateMediaPreviews()` showing/hiding containers based on presence of draft media.
    - Implemented `clearImageMedia()` and `clearAudioMedia()` resetting draft state and clearing form inputs.
    - Implemented `clearAllMedia()` resetting both channels on new identification or card load.
    - Implemented `retakeScreenshot()` and `retakeAudio()` broadcasting `TRIGGER_VIDEO_SCREENSHOT` and `TRIGGER_AUDIO_RECORDING` to the active video tab.
    - Added runtime message listener handlers for `SCREENSHOT_CAPTURED` and `AUDIO_CAPTURED` with `currentCaptureId` stale capture protection.
    - Added input listeners on `#field-image` and `#field-audio` syncing manual URLs to previews.
    - Updated card save form submission payload to include `image_data`, `audio_data`, and `media_mime_type`.
    - Updated `openSavedCard()` to load existing media references into previews when inspecting cards from history.
  - `extension/tests/sidepanel-media-ui.test.js` (NEW):
    - Comprehensive unit and contract test suite verifying HTML DOM elements, CSS styles, media state transitions, clear actions, retake triggers, runtime message handlers, stale capture rejection, and card save payload formulation.
  - `extension/tests/sidepanel.test.js`:
    - Added DOM contract assertions for all media preview elements.

- **Behavior Delivered**:
  1. **Visual & Auditory Feedback**: Users immediately see the captured video frame thumbnail and can play the sentence audio clip directly in the Side Panel Card Editor.
  2. **Retake & Clear Controls**: Dedicated buttons allow retaking screenshots or re-recording audio on demand, or clearing them to reset state and form fields.
  3. **Stale Capture Protection**: Media updates check `captureId` so that rapid text selection does not assign media to outdated card drafts.
  4. **Manual & Automated Synergy**: Preserves manual URL/text inputs in optional fields while syncing automatically when media is captured or cleared.
  5. **Payload Contract Readiness**: Form submission sends `image_data` and `audio_data` ready for Step 4 backend persistence.
  6. **Zero Regressions**: All 15 node extension test suites and 92 backend tests pass with 0 errors.

- **Verification Run**:
  - `extension/tests/sidepanel-media-ui.test.js`: PASSED
  - `extension/tests/audio-recording.test.js`: PASSED
  - `extension/tests/capture-screenshot.test.js`: PASSED
  - `extension/tests/video-mining-poc.test.js`: PASSED
  - `extension/tests/video-mining-integration.test.js`: PASSED
  - `extension/tests/subtitle-sync-offset.test.js`: PASSED
  - `extension/tests/subtitle-hotkeys.test.js`: PASSED
  - `extension/tests/subtitle-auto-pause.test.js`: PASSED
  - `extension/tests/youtube-adapter.test.js`: PASSED
  - `extension/tests/netflix-adapter.test.js`: PASSED
  - `extension/tests/srv3-parser.test.js`: PASSED
  - `extension/tests/subtitle-parser.test.js`: PASSED
  - `extension/tests/capture-frame-verification.test.js`: PASSED
  - `extension/tests/capture-utils.test.js`: PASSED
  - `extension/tests/sidepanel.test.js`: PASSED
  - Node test suite: 15/15 test files passed (0 failures).
  - Backend pytest suite (`python -m pytest -o pythonpath=backend backend/tests`): PASSED (92/92 passed, 0 regressions).

- **Remaining Risk**:
  - Very large audio clips or 4K uncompressed screenshots exceeding browser message payload memory limits (mitigated by default downscaling to 640x360 and Opus audio encoding).

### Subtitle Hover Mining & Automated Media Capture Fixes (2026-09-14)

- **Files Changed**:
  - `extension/content/video-mining-poc.js`:
    - Re-parented windowed subtitle overlay to `document.body` (`position: fixed !important; z-index: 2147483647 !important`), completely bypassing HiAnime MegaCloud/RapidCloud transparent click shields and YouTube player overlay clipping.
    - Added `extractJapaneseWordAtPosition(element, clientX, clientY)` with DOM `caretRangeFromPoint` / `caretPositionFromPoint` support, character offset calculation, and continuous Japanese boundary expansion.
    - Attached debounced (180ms) `mousemove` event listeners to subtitle overlay, dispatching `JAPANESE_TEXT_CAPTURED` (`source: "subtitle_hover"`) upon hover while respecting active manual text selections.
    - Target cue resolution in `recordSentenceAudio` now falls back to `findCueAtTime(currentTime)` and `lastActiveCue`, avoiding false `NO_ACTIVE_CUE` errors when video pauses slightly past cue boundaries.
    - Enhanced `captureCurrentFrame` with Tier 1 direct canvas draw for HTML5/same-origin video before falling back to `captureVisibleTab`.
  - `extension/content/adapters/youtube-adapter.js`:
    - Enhanced `fetchCaptionSRV3` with format fallbacks (`&fmt=vtt` and raw base URL) in case SRV3 timedtext format fails or returns empty.
    - Native YouTube caption suppression (`hideNativeYouTubeCaptions`) is now only triggered after subtitle cues are successfully parsed and loaded.
  - `extension/background.js`:
    - Added readiness handshake (`PING_OFFSCREEN`) inside `ensureOffscreenDocument` to ensure offscreen audio recorder is responsive before starting stream recording.
  - `extension/sidepanel/sidepanel.html` & `extension/sidepanel/sidepanel.css`:
    - Added `toggle-auto-capture-frame` and `toggle-auto-capture-audio` checkboxes to `#video-mining-section`.
    - Styled `.video-auto-capture-options` and `.auto-capture-checkbox-label` following `DESIGN.md` dark mode tokens.
  - `extension/sidepanel/sidepanel.js`:
    - Added DOM bindings and persistence (`auto_capture_frame`, `auto_capture_audio`) in `chrome.storage.local`.
    - In `identify(text)`, automatically triggers `retakeScreenshot()` and `retakeAudio()` if auto-capture checkboxes are checked.
    - In `JAPANESE_TEXT_CAPTURED`, captures `sender.tab.id` and `sender.frameId` into `lastCaptureSource`.
    - `broadcastToActiveVideo(message, targetFrame)` now routes specifically to child iframe `frameId` when available (critical for cross-origin video players on HiAnime).
  - `extension/tests/video-mining-poc.test.js`:
    - Added `testSubtitleHoverMining` unit test suite covering word extraction and auto-lookup dispatch.
  - `extension/tests/sidepanel-media-ui.test.js`:
    - Added test coverage for auto-capture checkboxes, local storage persistence, and automated retake trigger execution during `identify()`.

- **Behavior Delivered**:
  1. **Fixed Core Subtitle Hover**: Hovering over Japanese subtitles on YouTube and HiAnime instantly triggers Side Panel dictionary lookup without needing mouse clicks or manual drag-selection.
  2. **Automated Media Capture (asbplayer pattern)**: Users can enable `Auto-capture frame` and `Auto-capture audio` checkboxes in the Side Panel so screenshots and sentence audio clips are automatically captured upon mining a word.
  3. **Preserved Manual Controls**: Retake and clear buttons remain available for fine-tuning or discarding captured media.
  4. **Cross-Origin Iframe Frame Targeting**: Video capture commands are routed directly to the iframe hosting the video element (such as MegaCloud on HiAnime).
  5. **YouTube Subtitle Reliability**: Timedtext fallback chain prevents missing subtitle tracks on YouTube.

- **Verification Run**:
  - `node --test extension/tests/*.test.js`: 15/15 test suites passed (0 failures).
  - `python -m pytest tests` (backend): 92/92 passed (0 regressions).

- **Remaining Risk**:
  - Full-page capture on high-DPI displays may take up to 200ms for heavy sites; mitigated by Tier 1 direct canvas draw when permitted by CORS.

### Stage 6: Dictionary Clean Study View & Raw View (2026-09-14)

- **Files Changed**:
  - `extension/sidepanel/sidepanel.html`:
    - Updated `#dictionary-section` header to `.dict-section-header` with `#dict-actions-bar`.
    - Added `#btn-copy-raw-dict` (📋 Copy) and `#btn-toggle-full-dict` (Full Dict / Study View).
    - Preserved `#meanings` as `.dict-study-view` container and added `#dict-raw-view` (hidden by default) for unabridged dictionary entries.
  - `extension/sidepanel/sidepanel.js`:
    - Added `formatRawDictionaryText(entries)` formatting all entries, POS, tags, senses, notes, and examples into structured plain text for clipboard copying.
    - Added `copyTextToClipboard(text)` using `navigator.clipboard` with fallback and visual feedback (`Copied! ✓` for 1500ms).
    - Added `clearDictionaryView()` cleanly resetting study view, raw view, and action controls.
    - Upgraded `renderDetails(body)` to render Clean Study View:
      - Primary dictionary attribution pill (`dict-source-pill`) + `Primary` badge + secondary count pill (`+N more dicts`).
      - Compact, deduplicated POS badge row (`.study-pos-badge`).
      - Numbered, deduplicated senses (collapsing duplicate definitions across multiple dictionaries like Jitendex and JMdict).
      - Semantic collapsible examples accordion (`<details class="study-examples-accordion">`) containing example cards, collapsed by default to eliminate vertical scroll overflow in narrow 320px panels.
    - Preserved 100% of unabridged raw Yomitan data in `#dict-raw-view` with instant toggling via `[Full Dict]` / `[Study View]`.
    - Wired `btnCopyRawDict` and `btnToggleFullDict` listeners.
    - Updated `identify()` and `deleteLocalCard()` to call `clearDictionaryView()`.
  - `extension/sidepanel/sidepanel.css`:
    - Added styling for `.dict-section-header`, `.dict-actions-bar`, `.btn-dict-action`, `.study-dict-header`, `.dict-source-pill`, `.dict-count-pill`, `.study-pos-row`, `.study-pos-badge`, `.study-senses-list`, `.study-sense-item`, `.study-examples-accordion`, `.study-example-card`, and raw view entries matching `DESIGN.md` dark mode tokens and responsive down to 320px width.
  - `extension/tests/dictionary-study-view.test.js` (NEW):
    - Added comprehensive unit test suite verifying DOM structure, `formatRawDictionaryText`, Clean Study View rendering, POS and sense deduplication, collapsible examples accordion, toggle behavior, clipboard copy, and reset.

- **Behavior Delivered**:
  1. **Clean Study View by Default**: Side Panel renders clean, compact definitions with primary attribution, deduplicated POS badges, and numbered senses instead of overflowing 320px panels with redundant raw dictionary text.
  2. **Collapsible Examples Accordion**: Example sentences are collapsed by default under `Examples (N)` with accessible HTML5 `<details>`, preventing clutter while remaining instantly expandable.
  3. **Zero Data Loss & Raw Toggle**: Users can toggle `[Full Dict]` at any time to inspect the complete unabridged Yomitan dictionary output.
  4. **One-Click Raw Copy**: Users can copy the formatted raw dictionary text directly to their clipboard with `[📋 Copy]`.
  5. **Complete System Stability**: Full backward compatibility maintained; zero breakage to card editing or Anki sync.

- **Verification Run**:
  - `node extension/tests/dictionary-study-view.test.js`: PASSED
  - `node --test extension/tests/*.test.js`: PASSED (16/16 test files passed, 0 failures)
  - `python -m pytest -o pythonpath=backend backend/tests`: PASSED (96/96 passed, 0 regressions)

- **Remaining Risk**:
  - None identified.

### Stage 7: Restrained UI Cleanup & Layout Reorder (2026-09-14)

- **Files Changed**:
  - `extension/sidepanel/sidepanel.html`:
    - **Reordered Visual Hierarchy**: Moved Card Editor (`#card-editor-section`) directly above the Dictionary Section (`#dictionary-section`). When a user mines or looks up a word, the Card Editor form and primary `[Save Card]` / `[Send to Anki]` buttons appear immediately below the Captured Word hero display without scrolling past dictionary definitions.
    - **Removed Manual Media Capture Controls**: Removed user-facing manual capture buttons (`#btn-retake-image`, `#btn-retake-audio`, `#btn-quick-capture-frame`, `#btn-quick-record-audio`) and `.video-media-quick-actions` toolbar.
    - **Clean Media Status & Result Displays**: Converted media empty placeholders into clean status indicators ("No frame captured", "No audio clip"). Retained visual thumbnail preview (`#image-preview`) and audio player (`#audio-preview`) for displaying capture results.
    - **Retained Media Discard Actions**: Maintained `#btn-clear-image` and `#btn-clear-audio` (`hidden` until media is attached) allowing users to easily discard unwanted automatic captures.
  - `extension/sidepanel/sidepanel.js`:
    - Removed selectors and click listeners for `#btn-retake-image`, `#btn-retake-audio`, `#btn-quick-capture-frame`, `#btn-quick-record-audio`, and placeholder click bindings.
    - Preserved internal capture helper methods (`retakeScreenshot()`, `retakeAudio()`, `captureOrRetakeScreenshot()`, `recordOrRetakeAudio()`) for automated capture on mining/hover.
    - Retained clear media handlers (`clearImageMedia()`, `clearAudioMedia()`, `clearAllMedia()`).
  - `extension/sidepanel/sidepanel.css`:
    - Removed hover and pointer cursor from `.media-empty-placeholder` to present it purely as an informative status card.
    - Removed obsolete `.video-media-quick-actions` styles.
  - `extension/tests/sidepanel.test.js`:
    - Verified `#card-editor-section` is positioned before `#dictionary-section`.
    - Verified manual capture buttons (`#btn-retake-image`, `#btn-retake-audio`) are removed.
  - `extension/tests/sidepanel-media-ui.test.js`:
    - Updated assertions to verify removal of manual capture buttons, preservation of media clear actions, and layout reordering.

- **Behavior Delivered**:
  1. **Add Card Above Meanings**: Users can create and save cards immediately at the top of the Side Panel without scrolling through long dictionary definitions.
  2. **Automated-Only Media Workflow**: Media capture operates automatically upon word lookup/mining (when auto-capture checkboxes are enabled); cluttering manual capture buttons are eliminated.
  3. **Media Status Transparency**: The UI displays the status/result of capture (rendered preview thumbnail, playable audio element, or informative placeholder text) while preserving discard buttons (`&times;`).
  4. **Full Regression Stability**: Zero breaking changes to local SQLite card persistence, AnkiConnect sync, or Yomitan lookups.

- **Verification Run**:
  - `node extension/tests/sidepanel.test.js`: PASSED
  - `node extension/tests/sidepanel-media-ui.test.js`: PASSED
  - `node extension/tests/dictionary-study-view.test.js`: PASSED
  - `node --test extension/tests/*.test.js`: PASSED (16/16 test files passed, 0 failures)
  - `python -m pytest -o pythonpath=backend backend/tests`: PASSED (96/96 passed, 0 regressions)

- **Remaining Risk**:
  - None identified. All stages (1 through 7) are complete and fully verified.

### Comprehensive In-Code Feature Scan & Breakage Audit (2026-09-14)

- **Verification Scope**:
  - Full simulated user journey across all features in automated test code (Python + Node.js) without launching manual browser windows:
    1. **Live Services**: Live AnkiConnect (`127.0.0.1:8765`, v6) and live Yomitan server (`127.0.0.1:19633`).
    2. **Dictionary Identification & Enrichment**: Common verbs, de-inflections (causative/passive, past tense), kanji compounds, katakana loanwords, bracketed expressions, parentheticals, internet slang, particles, unknown terms, blank text validation, 500+ char limit.
    3. **Card Editor & Local SQLite Persistence**: Blank expression rejection (422), HTML/ruby tag preservation, quotes, newlines, emojis, per-deck duplicate prevention, cross-deck card creation, card editing by ID, SQL injection safety (parameterized queries), deck filtering, pagination.
    4. **Live AnkiConnect Synchronization**: Real deck retrieval (`Default`, `Kaishi 1.5k`, `n3 mining`), real model inspection (`japanese mining`), model capability detection (audio/image), live card sync into Anki note, note field validation, safe note cleanup, failure resilience on invalid models (preserving local card in SQLite as `failed` with diagnostic error), auto-deck creation.
    5. **Subtitle Parser & Video Invariants**: WebVTT parsing with STYLE/NOTE metadata filtering, non-standard SRT timestamps (1-digit hours, period separators), UTF-8 BOM tolerance, auto-format dispatching (VTT, SRT, SRV3), cue sync boundary lookups, background audio recording mutex.
    6. **Side Panel DOM Contracts**: Reordered visual hierarchy (Card Editor above meanings), removal of manual capture buttons, Clean Study View, raw dictionary toggle, raw plain text clipboard copy.

- **Automated Verification Results**:
  - `python scratch/stress_test_audit.py`: PASSED (tested against live AnkiConnect & live Yomitan)
  - `node scratch/stress_test_frontend.js`: PASSED
  - `python -m pytest -o pythonpath=backend backend/tests`: PASSED (96 / 96 passed)
  - `node --test extension/tests/*.test.js`: PASSED (16 / 16 passed)

- **Audit Findings & Prioritized To-Do List**:
  1. **[Completed] SaveCardRequest Data URL Boundary**:
     - Expanded `image` and `audio` length limits and added `image_data`, `audio_data`, and `media_mime_type` to `SaveCardRequest` in `schemas.py`.
  2. **[Completed] Backend Binary Media Storage & AnkiConnect `storeMediaFile`**:
     - Implemented `MediaStorageService` (`media_storage.py`) decoding base64 data URLs to disk in `backend/data/media/`.
     - Mounted `GET /api/media/{filename}` route in `main.py` serving images and audio.
     - Added `store_media_file` in `AnkiConnectService` uploading media to Anki's collection during card sync.
  3. **[Completed] Enhanced Note Model Field Keyword Aliases**:
     - Expanded aliases in `AnkiConnectService` for prompt, answer, sentence, audio, and image fields (`targetword`, `sentenceaudio`, `vocabimage`, etc.).

### Phase 8: Media Storage, Data URL Support & Anki Media Sync Implementation (2026-09-14)

- **Files Changed**:
  - `backend/app/schemas.py`:
    - Updated `SaveCardRequest` to support data URLs (`max_length=5_000_000` for image, `10_000_000` for audio).
    - Added optional `image_data`, `audio_data`, and `media_mime_type` fields matching frontend payload.
  - `backend/app/services/media_storage.py` (NEW):
    - Implemented `MediaStorageService` for saving and retrieving binary media files with path-traversal protection and magic byte / MIME-type detection.
  - `backend/app/main.py`:
    - Mounted `GET /api/media/{filename}` route using `FileResponse` to serve media back to the Side Panel with appropriate MIME types.
  - `backend/app/services/card_service.py`:
    - Updated `save_card` to automatically decode and persist raw media payloads to `backend/data/media/` and record clean filenames in SQLite.
    - Updated `sync_card` to read local media files and invoke `anki.store_media_file` prior to creating notes.
  - `backend/app/services/anki_connect.py`:
    - Added `store_media_file` action invoking AnkiConnect's `storeMediaFile`.
    - Expanded note model field aliases in `_model_supports_card`, `get_model_capabilities`, and `map_card_to_fields`.
  - `backend/tests/test_card_editor.py`:
    - Added unit test `test_14_media_payload_and_data_url_support` verifying media persistence on save.
  - `backend/tests/test_media_storage.py` (NEW):
    - Added 7 unit tests covering base64 saving, path traversal protection, media deletion, static media endpoint, and field alias mapping.

- **Verification Run**:
  - `python -m pytest -o pythonpath=backend backend/tests`: PASSED (104/104 passed, 0 regressions)
  - `node --test extension/tests/*.test.js`: PASSED (16/16 passed)
  - `python scratch/stress_test_audit.py`: PASSED (0 issues identified)
  - `python scratch/verify_live_anki_media_sync.py`: PASSED (successfully synced card with image and audio to live AnkiConnect note 1789381014702 and cleaned up)

### Phase 8.4: Bugfix — Anki Media Field HTML Formatting & Paused Video Audio Recording (2026-09-14)

- **Files Changed**:
  - `backend/app/services/anki_connect.py`:
    - Fixed image rendering in Anki notes: `map_card_to_fields` now formats image values as HTML `<img>` tags (`<img src="{filename}">`). Bare filenames previously caused Anki card templates to either render raw text or nothing.
    - Fixed audio playback in Anki notes: `map_card_to_fields` now formats audio values as standard Anki sound tags (`[sound:{filename}]`).
    - Fixed Basic model (Front/Back): appends formatted image (`<img src="...">`) and audio (`[sound:...]`) tags to `Back` if the model lacks dedicated media fields, ensuring media is never discarded.
    - Expanded note model field aliases: added `sentencepicture`, `vocabpicture`, `snapshot`, `illustration`, `images`, `pictures`, `sentencesound`, `vocabsound`, `audios`, `sounds` supporting community templates such as Japanese Mining.
    - Added graceful fallback: if media fields are not matched, media is safely appended to `notes` or `back` without polluting `meaning`.
  - `backend/app/services/card_service.py`:
    - Updated `sync_card_to_anki`: extracts clean media filenames (stripping HTML/sound wrapper syntax if present) and ensures stored or base64 data URL images/audio are reliably saved to disk and uploaded to Anki's media collection via `store_media_file`.
  - `extension/sidepanel/sidepanel.js`:
    - Fixed audio auto-capture on word identification: `identify()` now inspects `toggleAutoCaptureAudio.checked` and triggers `retakeAudio()` when enabled and video mining is active. Previously, only `retakeScreenshot()` was triggered and audio was omitted.
    - Added `currentActiveCue` tracking from `SUBTITLE_CUE_CHANGED` messages and forwarded it to `TRIGGER_AUDIO_RECORDING`.
    - Added `allowPausedPlayback: true` in `retakeAudio()` options to enable seamless sentence slice audio recording for paused videos.
  - `extension/content/video-mining-poc.js`:
    - Implemented paused video sentence audio capture: when `this.activeVideo.paused` and `allowPausedPlayback` is true (the standard state when mining from paused/auto-paused subtitles), AnkiMiner captures the sentence slice by seeking to the cue's `startTime`, initiating `START_AUDIO_RECORDING` via `tabCapture`, briefly playing the slice to feed audio into the tab capture stream, and restoring the video's original paused state and seek position once recording completes.
  - `backend/tests/test_anki_connect.py`:
    - Updated assertions to verify `<img src="...">` and `[sound:...]` tag formatting.
    - Added `test_mapping_japanese_mining_model_variations` and `test_mapping_basic_model_with_media_included_in_back`.
  - `backend/tests/test_media_storage.py`:
    - Updated `test_anki_field_mapping_with_media_and_aliases` to assert formatted image and sound tags.
  - `extension/tests/audio-recording.test.js`:
    - Added Case 8 verifying `recordSentenceAudio` slice capture on paused videos with `allowPausedPlayback: true` and seek/pause state restoration.

- **Behavior Delivered**:
  1. Cards sent to Anki now display the captured video frame image and play recorded audio across all note models, including `japanese mining` and standard `Basic`.
  2. Automatic sentence audio capture triggers reliably alongside video frames when mining on both YouTube and HiAnime.
  3. Video playback smoothly restores to its exact paused position after sentence audio recording completes without audio disruption.

- **Verification Run**:
  - `python -m pytest -o pythonpath=backend backend/tests`: PASSED (106/106 passed, 0 regressions)
  - `node --test extension/tests/*.test.js`: PASSED (16/16 test suites passed, 0 regressions)

- **Remaining Risk**:
  - Users on Chromium/Brave must keep the tab unmuted so `chrome.tabCapture` can capture tab audio samples during slice recording.



