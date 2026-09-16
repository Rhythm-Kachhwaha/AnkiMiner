# AnkiMiner Video Media Mining: Research & Step-by-Step Implementation Specification

> **Status:** Research & Engineering Specification  
> **Source Investigation:** ASBPlayer (MIT Licensed) vs. AnkiMiner Architecture  
> **Target Scope:** Screenshot Capture, Audio Capture, Local Persistence, and AnkiConnect Media Sync

---

## Table of Contents

1. [Part I: ASBPlayer Media Mining Reverse-Engineering & Research](#part-i-asbplayer-media-mining-reverse-engineering--research)
   - [1. Executive Summary](#1-executive-summary)
   - [2. Screenshot Capture Architecture](#2-screenshot-capture-architecture)
   - [3. Audio Capture & Offscreen Document Service](#3-audio-capture--offscreen-document-service)
   - [4. Video Clip vs. GIF vs. Animated Formats](#4-video-clip-vs-gif-vs-animated-formats)
   - [5. ASBPlayer Source Reference Index](#5-asbplayer-source-reference-index)
   - [6. Browser APIs, Permissions, and Manifest V3 Limitations](#6-browser-apis-permissions-and-manifest-v3-limitations)
   - [7. DRM, Cross-Origin, and Iframe Constraints](#7-drm-cross-origin-and-iframe-constraints)
   - [8. Anki Media Integration & AnkiConnect Mechanics](#8-anki-media-integration--ankiconnect-mechanics)
   - [9. Comparison with AnkiMiner Architecture](#9-comparison-with-ankiminer-architecture)
   - [10. Scope Control: What to Build vs. What to Avoid](#10-scope-control-what-to-build-vs-what-to-avoid)
   - [11. Legal & Licensing Notice (MIT Attribution)](#11-legal--licensing-notice-mit-attribution)
2. [Part II: Step-by-Step Implementation Prompts](#part-ii-step-by-step-implementation-prompts)
   - [Step 1: Extension Permissions, Background Screenshot Capture & Canvas Cropper](#step-1-prompt--extension-permissions-background-screenshot-capture--canvas-cropper)
   - [Step 2: Manifest V3 Offscreen Document Audio Recording Service](#step-2-prompt--manifest-v3-offscreen-document-audio-recording-service)
   - [Step 3: Side Panel UI Integration, Media Previews & Mining Triggers](#step-3-prompt--side-panel-ui-integration-media-previews--mining-triggers)
   - [Step 4: FastAPI Backend Binary Media Storage & SQLite Card Linking](#step-4-prompt--fastapi-backend-binary-media-storage--sqlite-card-linking)
   - [Step 5: AnkiConnect Media Synchronization & Graceful Error Recovery](#step-5-prompt--ankiconnect-media-synchronization--graceful-error-recovery)
   - [Step 6 (Future / V2): Local Video WebM Clip Looping](#step-6-prompt-future-v2--local-video-webm-clip-looping)

---

# Part I: ASBPlayer Media Mining Reverse-Engineering & Research

## 1. Executive Summary

ASBPlayer is an open-source (MIT licensed) browser extension and web application designed for sentence mining from video into Anki. A forensic inspection of the ASBPlayer source code (`packages/extension`, `packages/common`, `packages/client`) reveals how production-grade browser media mining actually works:

1. **Direct `<video>` Canvas Capture Is Avoided on Web Video:** Drawing an HTML5 `<video>` directly to a `<canvas>` via `ctx.drawImage(video, 0, 0)` fails on almost all modern streaming video (YouTube, anime players, Netflix) due to canvas tainting (`SecurityError: Tainted canvases may not be exported`) or DRM hardware overlay blanking. ASBPlayer captures a viewport screenshot via `chrome.tabs.captureVisibleTab`, passes the resulting image to an off-DOM canvas along with the video's bounding rect (`getBoundingClientRect()`), and crops the video frame.
2. **Audio Capture Requires Manifest V3 Offscreen Documents:** Service workers cannot access DOM, Web Audio API, or `navigator.mediaDevices`. ASBPlayer acquires a tab stream token using `chrome.tabCapture.getMediaStreamId({ targetTabId })`, instantiates a Chrome MV3 Offscreen Document, calls `navigator.mediaDevices.getUserMedia`, records the tab audio with `MediaRecorder` in real time for the duration of the subtitle cue, decodes PCM with `AudioContext`, and encodes MP3 in a Web Worker using `lamejs`.
3. **ASBPlayer Implements Zero GIF Support:** ASBPlayer contains zero GIF code. GIFs are 10x–30x larger than modern formats, 256-color dithered, CPU-expensive to encode in JavaScript, and rapidly exhaust AnkiWeb's 250MB collection limit. Instead, ASBPlayer implements **WebM video loops** (`video/webm`), but **strictly for local video files loaded directly into the player**. It does not support video clips for streaming video.
4. **Anki Integration Separation:** Audio and video are strictly decoupled:
   - Video clips/GIF alternatives are **silent loops** embedded as `<video autoplay loop muted playsinline src="filename.webm"></video>`.
   - Audio is stored independently in Anki's Audio field as `[sound:filename.mp3]`.
5. **Local-First Invariant for AnkiMiner:** Unlike ASBPlayer (which sends media directly to AnkiConnect or stores it ephemerally in browser IndexedDB), AnkiMiner requires that media files and card records persist to local SQLite and backend disk **before** any AnkiConnect push is attempted. If Anki is closed or unreachable, card text and captured media must remain 100% safe locally.

---

## 2. Screenshot Capture Architecture

### The Problem
When video is rendered from cross-origin CDNs (e.g., YouTube `*.googlevideo.com`, HiAnime HLS stream fragments):
```javascript
// FAILS on streaming video
const canvas = document.createElement('canvas');
canvas.getContext('2d').drawImage(video, 0, 0);
canvas.toDataURL('image/jpeg'); // Throws SecurityError: Tainted canvas
```
Even when CORS headers are present, canvas capture will fail if cross-origin cookies or credentials are not explicitly allowed.

### ASBPlayer's Solution
ASBPlayer separates viewport capture from image cropping:

```
[Content Script (Video Tab)]
  │  1. Compute video position relative to viewport:
  │     rect = video.getBoundingClientRect()
  │  2. Account for screen scaling:
  │     pixelRatio = window.devicePixelRatio
  │  3. Send TAKE_SCREENSHOT message to background with rect coordinates
  ▼
[Background Service Worker]
  │  4. Execute browser viewport capture:
  │     dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
  │       format: 'jpeg',
  │       quality: 100
  │     })
  │  5. Forward dataUrl + rect back to content script or offscreen cropper
  ▼
[Image Cropper / Transformer]
  │  6. Load dataUrl into Image() element
  │  7. Off-DOM canvas:
  │     canvas.width = rect.width * pixelRatio
  │     canvas.height = rect.height * pixelRatio
  │     ctx.drawImage(img,
  │       rect.left * pixelRatio, rect.top * pixelRatio,
  │       canvas.width, canvas.height,
  │       0, 0, canvas.width, canvas.height
  │     )
  │  8. Downscale via createImageBitmap() if maxWidth/maxHeight specified
  │  9. canvas.toDataURL('image/jpeg') -> returns clean, untainted JPEG
```

### Delay & Timestamp Synchronization
When sentence audio recording is triggered, mining spans several seconds of playback. ASBPlayer calculates an exact delay so the screenshot captures the visual frame at the word/subtitle moment:
```typescript
const screenshotDelay = Math.max(
  0,
  message.record
    ? message.mediaTimestamp - subtitle.start + message.audioPaddingStart
    : message.imageDelay
);
```

---

## 3. Audio Capture & Offscreen Document Service

### Manifest V3 Restriction
In Chrome Manifest V3:
- Service workers have no access to `window`, DOM, `AudioContext`, or `navigator.mediaDevices`.
- `chrome.tabCapture.capture()` cannot pipe a stream directly into a service worker.

### ASBPlayer Architecture

```
[Extension Service Worker]
  │ 1. chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
  │    -> returns streamId (single-use token)
  │ 2. chrome.offscreen.createDocument({
  │      url: 'offscreen.html',
  │      reasons: ['USER_MEDIA'],
  │      justification: 'Recording tab audio for vocabulary mining'
  │    })
  │ 3. Sends START_RECORDING command to offscreen document with streamId
  ▼
[Offscreen Document (offscreen.html / offscreen.ts)]
  │ 4. navigator.mediaDevices.getUserMedia({
  │      audio: {
  │        mandatory: {
  │          chromeMediaSource: 'tab',
  │          chromeMediaSourceId: streamId
  │        }
  │      }
  │    }) -> returns MediaStream
  │ 5. MediaRecorder(stream, { mimeType: 'audio/webm' })
  │ 6. Sets setTimeout for duration:
  │    duration = (cue.end - cue.start) / playbackRate + audioPaddingEnd
  │ 7. When timeout fires -> recorder.stop() -> produces audio/webm Blob
  │ 8. Conversion to MP3 (optional / default):
  │    - AudioContext.decodeAudioData(webmBuffer) -> Float32Array PCM channels
  │    - Worker.postMessage({ pcmChannels }) -> lamejs MP3 encoder
  │    - Yields clean audio/mp3 Blob
  │ 9. Returns base64 string back to background worker
```

### Audio Padding Mechanics
To ensure sentences don't cut off speech at the start or end:
- `audioPaddingStart`: Defaults to 150 ms.
- `audioPaddingEnd`: Defaults to 200 ms.
- Video element seeks to `Math.max(0, subtitle.start - audioPaddingStart)` and plays forward.
- Recorder captures for `(subtitle.end - subtitle.start) + audioPaddingEnd`.
- Once finished, previous playback state (play/pause) is restored.

---

## 4. Video Clip vs. GIF vs. Animated Formats

### Detailed Format Comparison

| Metric | Static JPEG / WebP | Audio (MP3) | WebM Clip (VP9/AV1) | MP4 Clip (H.264) | Animated GIF | Animated WebP |
|---|---|---|---|---|---|---|
| **Anki Desktop (QtWebEngine)** | ✅ Native | ✅ Native | ✅ Native | ✅ Native | ✅ Native | ✅ Native |
| **AnkiMobile (iOS WebKit)** | ✅ Native | ✅ Native | ✅ Native (iOS 16+) | ✅ Native | ✅ Native | ✅ Native |
| **AnkiDroid (Android WebView)**| ✅ Native | ✅ Native | ✅ Native | ✅ Native | ✅ Native | ✅ Native |
| **File Size (3s clip, 720p)** | ~50 KB – 120 KB | ~30 KB – 80 KB | **~600 KB – 1.8 MB** | **~800 KB – 2.5 MB** | **12 MB – 30 MB** | ~2 MB – 6 MB |
| **Browser Recording Complexity**| Low (`captureVisibleTab`) | Medium (Offscreen) | High (`captureStream`) | Extreme (requires WASM)| Very High (NeuQuant JS)| Extreme (WASM) |
| **Streaming Video Viability** | ✅ **100% Working** | ✅ **100% Working** | ❌ Stalls / Drift | ❌ Stalls / Drift | ❌ Impractical | ❌ Impractical |
| **Local File Viability** | ✅ **100% Working** | ✅ **100% Working** | ✅ **100% Working** | ✅ via transcoding| ❌ Bloated | ❌ Bloated |
| **Color Fidelity / Quality** | Full 24-bit color | N/A | Full 24-bit color | Full 24-bit color | **8-bit (256 colors, dithered)** | Full 24-bit |
| **Card Review Speed Impact** | Instant | Instant | Instant (<2MB) | Instant (<3MB) | Severe Lag (>15MB) | Slight Lag |

### Why ASBPlayer Strictly Rejects GIF
1. **AnkiWeb 250 MB Storage Cap:** AnkiWeb imposes a 250 MB total collection limit. Mining 15–20 cards with GIFs would permanently fill a user's entire AnkiWeb storage quota.
2. **JavaScript CPU Starvation:** GIF encoding requires color quantization (reducing 16 million colors to 256). In JavaScript, compressing 72 frames of 720p video freezes the tab or takes 20+ seconds of 100% CPU thread time.
3. **No Sound:** A GIF still requires a separate audio file for pronunciation.

### How ASBPlayer Handles Video Clips
- **Format:** WebM video container (`video/webm;codecs=vp9|vp8|av1`).
- **Limitation:** **Supported only for local video files (`card.file`)**. ASBPlayer does not support clip generation on streaming sites.
- **Audio:** WebM clips are **silent visual loops** (`<video autoplay loop muted playsinline src="..."></video>`). Pronunciation audio is stored separately in the Audio field.

---

## 5. ASBPlayer Source Reference Index

| Target Capability | Exact ASBPlayer Source Path | Classes / Functions / Symbols |
|---|---|---|
| Viewport Capture | `extension/src/services/image-capturer.ts` | `ImageCapturer.capture()`, `_cropAndResize()` |
| Native Tab Capture API | `extension/src/services/capture-visible-tab.ts` | `captureVisibleTab(tabId)` |
| Off-DOM Canvas Cropping | `common/src/image-transformer.ts` | `cropAndResize()`, `resizeCanvas()` |
| Screenshot Messaging | `extension/src/handlers/video/take-screenshot-handler.ts`| `TakeScreenshotHandler.handle()` |
| Tab Audio Stream Token | `extension/src/services/audio-recorder-delegate.ts` | `OffscreenAudioRecorder._mediaStreamId()`, `CaptureStreamAudioRecorder` |
| Offscreen Audio Entry | `extension/src/entrypoints/offscreen-audio-service/offscreen-audio-service.ts` | `_stream()`, `_sendAudioBase64()`, `audioRecorder.startWithTimeout()` |
| Audio Recorder Wrapper | `extension/src/services/audio-recorder.ts` | `AudioRecorder.startWithTimeout()`, `start()`, `stop()` |
| Audio Request Router | `extension/src/services/audio-recorder-service.ts` | `AudioRecorderService.startWithTimeout()`, `onAudioBase64()` |
| MP3 Web Worker & Lamejs | `common/audio-clip/mp3-encoder.ts` & `mp3-encoder-worker.ts` | `Mp3Encoder.encode()`, `AudioContext.decodeAudioData()` |
| Mining Flow Orchestrator| `extension/src/services/binding.ts` | `Binding._copySubtitle()`, `seek()`, `play()`, `audioPaddingStart` |
| WebM Video Clip Builder | `common/src/webm-file-media-fragment-data.ts` | `WebmFileMediaFragmentData._captureBlob()`, `_runFrameLoop()` |
| Media Fragment Strategy | `common/src/media-fragment.ts` | `MediaFragment.fromCard()`, `fromWebmFile()`, `fromBase64()` |
| AnkiConnect Media Storing| `common/anki/anki.ts` | `Anki._attachAudio()`, `_attachMediaFragment()`, `_storeMediaFile()` |

---

## 6. Browser APIs, Permissions, and Manifest V3 Limitations

### Permissions Required in `extension/manifest.json`
```json
{
  "permissions": [
    "sidePanel",
    "activeTab",
    "scripting",
    "storage",
    "tabCapture",
    "offscreen"
  ],
  "host_permissions": [
    "http://127.0.0.1:8000/*",
    "*://*.youtube.com/*",
    "*://*.netflix.com/*"
  ]
}
```

### Key API Characteristics
1. **`chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 })`**:
   - Requires `activeTab` or host permissions.
   - Bypasses CORS canvas tainting because it captures browser compositor output.
   - Requires tab to be in the active, focused window.
2. **`chrome.tabCapture.getMediaStreamId({ targetTabId })`**:
   - Generates a transient stream token valid for `navigator.mediaDevices.getUserMedia` inside an extension frame/offscreen document.
   - Does not pick up ambient microphone noise.
3. **`chrome.offscreen.createDocument`**:
   - Required in MV3 to execute DOM/audio APIs (`AudioContext`, `MediaRecorder`, `getUserMedia`).
   - Reason: `'USER_MEDIA'`.

---

## 7. DRM, Cross-Origin, and Iframe Constraints

| Target Platform | Screenshot | Audio Capture | Video Clip | Failure Behavior & Mitigation |
|---|---|---|---|---|
| **YouTube** | ✅ Working | ✅ Working | ❌ Unreliable | Public VP9/H.264 streams. Viewport crop works cleanly. |
| **HiAnime** | ✅ Working | ✅ Working | ❌ Unreliable | Video in cross-origin iframe. Coordinates must be calculated relative to the iframe's viewport. |
| **Netflix** | ❌ Blocked | ❌ Blocked | ❌ Blocked | **Widevine DRM / EME:** Hardware pipeline zeroes out screenshot pixels (solid black) and silences audio capture. Subtitle text mining works; extension must detect DRM and display a graceful badge (`[Protected Stream: Text Only]`) without throwing uncaught exceptions. |
| **Local Videos / Direct MP4** | ✅ Working | ✅ Working | ✅ Working (V2) | Full offline seek control; headless canvas rendering possible. |

---

## 8. Anki Media Integration & AnkiConnect Mechanics

### Storing Media Files via AnkiConnect
AnkiConnect provides an explicit action to write binary media directly into Anki's `collection.media` folder:
```json
{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "ankiminer_sentence_1726200000_a1b2.mp3",
    "data": "<base64 encoded binary>",
    "deleteExisting": false
  }
}
```

### Anki Field Markup Formats
- **Audio Field:** `[sound:ankiminer_sentence_1726200000_a1b2.mp3]`  
  *Triggers native audio play button and auto-playback on review.*
- **Static Image Field:** `<img src="ankiminer_snap_1726200000_a1b2.jpg">`  
  *Renders responsive screenshot.*
- **Looping Video Clip (V2):** `<video autoplay loop muted playsinline src="ankiminer_clip_1726200000_a1b2.webm"></video>`  
  *Renders smooth, silent, high-efficiency animation.*

### Filename Rules
- Never prefix filenames with an underscore (`_`), as Anki reserves underscores for theme assets and skips them during database unused-media cleanups.
- Filenames must be URL-safe (no spaces, hashes, or query strings).
- Pattern: `ankiminer_{type}_{timestamp}_{hash}.{ext}`.

---

## 9. Comparison with AnkiMiner Architecture

| Feature | ASBPlayer | AnkiMiner Current Architecture | AnkiMiner Target Design |
|---|---|---|---|
| **Persistence Source of Truth** | Ephemeral browser storage / Direct to Anki | **SQLite database** (`backend/app/db/connection.py`) | **SQLite remains authoritative.** All media paths and card fields save locally before Anki sync. |
| **Card Editor UI** | Custom floating React overlay | **Side Panel vanilla HTML/CSS/JS** | Media preview thumbnails & audio player embedded in Side Panel Card Editor. |
| **Backend** | No dedicated backend (pure extension/client) | **FastAPI Python Backend** | Backend stores media files on local disk (`backend/data/media/`), serves them to Side Panel, and pushes to AnkiConnect. |
| **Sync Strategy** | Immediate push | **Decoupled Explicit Sync (`[Send to Anki]` button)** | Local save never blocks on Anki reachability. Media is pushed to AnkiConnect only during sync. |
| **Audio Format** | Client-side MP3 via `lamejs` worker | N/A | Browser captures WebM audio via offscreen document; backend can store WebM/MP3 or convert via standard tooling. |

---

## 10. Scope Control: What to Build vs. What to Avoid

### MVP (Build First)
1. Viewport screenshot capture via `chrome.tabs.captureVisibleTab` with canvas crop.
2. Real-time sentence audio capture via MV3 Offscreen Document (`MediaRecorder`).
3. Side Panel image preview thumbnail and audio play button.
4. Backend binary media storage (`backend/data/media/`) linked to SQLite cards.
5. AnkiConnect `storeMediaFile` upload upon user clicking `[Send to Anki]`.

### V2 (Future Enhancements)
1. WebM video clip looping for local files and direct video URLs.
2. Waveform visual trimming handles in the Side Panel to adjust audio padding.
3. Subtitle text burn-in toggle (embed Japanese text directly into the screenshot image).

### Do Not Implement
1. **GIF Generation:** Discarded due to 20x file bloat, 256-color degradation, AnkiWeb 250MB limit, and CPU freezing.
2. **Real-Time Video Streaming Clips:** Discarded because capturing live video streams causes playback pauses, buffer stalls, and desync.
3. **Netflix DRM Bypasses:** Discarded because browser protected media pipelines enforce black frames by design.

---

## 11. Legal & Licensing Notice (MIT Attribution)

ASBPlayer is copyright (c) asbplayer contributors and licensed under the **MIT License**.

- **Permissible Usage:** The conceptual design, browser API flows (`captureVisibleTab` crop, `tabCapture` offscreen recording), and Anki markup structures (`[sound:]`, `<video autoplay loop muted>`) are standard browser engineering patterns and can be freely utilized.
- **Attribution Invariant:** If any specific helper algorithms (e.g. `cropAndResize` from `image-transformer.ts` or `mp3-encoder-worker.ts`) are ported directly, the MIT copyright header must be preserved in the source file, and an entry added to `THIRD_PARTY_LICENSES.md`.

---

# Part II: Step-by-Step Implementation Prompts

Use the following 5 implementation prompts sequentially. Each prompt is self-contained, specifies exact contracts, and preserves all architectural invariants.

---

## Step 1 Prompt — Extension Permissions, Background Screenshot Capture & Canvas Cropper

```markdown
### Task: Implement Background Viewport Screenshot Capture and Video Frame Cropping

#### Goal
Enable AnkiMiner to capture high-quality, untainted JPEG screenshots of the active video frame across YouTube, HiAnime, and generic HTML5 players without encountering CORS canvas tainting errors.

#### Context & Architecture
Directly drawing streaming `<video>` elements to an in-page `<canvas>` throws `SecurityError` due to cross-origin video chunk CDNs. Following the ASBPlayer proven pattern:
1. The content script calculates the video's bounding rectangle on screen (`getBoundingClientRect()`) multiplied by `window.devicePixelRatio`.
2. The content script sends a `CAPTURE_VIDEO_FRAME` runtime message to `background.js`.
3. `background.js` invokes `chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 95 })`.
4. The captured viewport data URL and the bounding rectangle are cropped using an off-DOM canvas (either in an offscreen helper, content script, or Side Panel).
5. The resulting cropped JPEG data URL is returned to the caller and populated in the Card Editor.

#### Files to Modify / Create
- `extension/manifest.json`: Add `"activeTab"` (and `"tabs"` if required for window ID resolution) to permissions. Ensure `<all_urls>` or matching host permissions cover target video domains.
- `extension/background.js`: Add runtime message listener for `CAPTURE_VIDEO_FRAME`. Implement `captureVisibleTab`.
- `extension/content/capture-utils.js` (or new helper `extension/lib/image-cropper.js`): Implement `cropVideoFrame(viewportDataUrl, rect, maxWidth, maxHeight)`.
- `extension/content/video-mining-poc.js`: Add a method `captureCurrentFrame()` to `VideoMiningPOC` that queries `this.activeVideo.getBoundingClientRect()`, triggers the background capture, and broadcasts `SCREENSHOT_CAPTURED`.
- `extension/tests/capture-screenshot.test.js`: Comprehensive unit and contract tests.

#### Technical Specifications & Edge Cases
1. **Device Pixel Ratio:** Mobile and HiDPI displays use `window.devicePixelRatio > 1`. Bounding rect values (`left`, `top`, `width`, `height`) must be multiplied by `devicePixelRatio` when slicing the viewport image.
2. **Iframe Offset Handling:** If the video is inside a cross-origin iframe (e.g., HiAnime player):
   - In `all_frames: true`, `getBoundingClientRect()` gives coordinates relative to the iframe viewport.
   - If the iframe occupies the entire player container, coordinates map directly. Document any offset constraints.
3. **DRM Protected Stream Detection:** On Netflix, `captureVisibleTab` produces a black box for the video surface. Catch any errors and detect solid black frames, returning `{ ok: false, error: "DRM_PROTECTED", message: "Protected stream: Screenshots unavailable" }`.
4. **Max Dimensions:** If the video is 1080p or 4K, optionally downscale to `maxWidth: 640`, `maxHeight: 360` to keep card sizes lightweight (~60–100 KB).

#### Verification Checklist
- [ ] Node.js unit tests verifying coordinate scaling and crop mathematics.
- [ ] Manual test on YouTube: Video frame captures accurately at current timestamp.
- [ ] Manual test on HiAnime: Video frame captures accurately in both windowed and fullscreen modes.
- [ ] No regression on existing text selection capture or Yomitan integration.
```

---

## Step 2 Prompt — Manifest V3 Offscreen Document Audio Recording Service

```markdown
### Task: Implement Manifest V3 Offscreen Document Audio Recording Service

#### Goal
Capture high-fidelity sentence audio clips from the active video tab, bounded precisely by subtitle cue start and end times plus user-configurable audio padding.

#### Context & Architecture
In Chrome Manifest V3, background service workers cannot access the Web Audio API or `navigator.mediaDevices`. To record tab audio:
1. `background.js` requests a stream ID using `chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })`.
2. `background.js` ensures an offscreen document (`extension/offscreen/offscreen.html`) is open with reason `'USER_MEDIA'`.
3. The offscreen document receives the stream ID, calls `navigator.mediaDevices.getUserMedia`, and records the audio stream with `MediaRecorder` (`audio/webm`).
4. `VideoMiningPOC` in the video tab seeks to `Math.max(0, cue.start - audioPaddingStart)` (default 150 ms) and plays the video forward.
5. The offscreen recorder records for duration: `(cue.end - cue.start) / playbackRate + audioPaddingEnd` (default 200 ms).
6. When the duration expires, the recorder stops, extracts the `audio/webm` Blob, converts it to base64, and returns it. Previous video playback state (paused or playing) is restored.

#### Files to Modify / Create
- `extension/manifest.json`: Add permissions `"tabCapture"` and `"offscreen"`.
- `extension/offscreen/offscreen.html`: Minimal HTML hosting the offscreen script.
- `extension/offscreen/offscreen.js`: Handles stream acquisition via `getUserMedia`, `MediaRecorder` lifecycle, and timeout duration.
- `extension/background.js`: Add helper `ensureOffscreenDocument()`, listen for `START_AUDIO_RECORDING` and `STOP_AUDIO_RECORDING`, coordinate `tabCapture.getMediaStreamId`.
- `extension/content/video-mining-poc.js`: Add audio recording coordination: seek to start minus padding, play, await recording duration, restore playback state, broadcast `AUDIO_CAPTURED`.
- `extension/tests/audio-recording.test.js`: Mocked contract tests for offscreen messaging, timestamp calculation, and padding logic.

#### Technical Specifications & Edge Cases
1. **Audio Mirroring (Speaker Output):** Capturing a tab stream can silence the tab's speaker output in some Chrome versions. In `offscreen.js`, pipe the `MediaStream` to an `AudioContext` connected to `audioContext.destination` so the user continues hearing the audio during mining.
2. **Audio Format:** The offscreen recorder captures `audio/webm;codecs=opus`. Provide base64 data and mimeType.
3. **Netflix / Protected Audio:** If the stream is encrypted, `getUserMedia` throws `AbortError` or records silence. Handle gracefully: return `{ ok: false, error: "DRM_AUDIO", message: "Protected audio cannot be captured" }`.
4. **Playback State Restoration:** If the video was paused before mining, pause it when recording finishes. If it was playing, keep playing.

#### Verification Checklist
- [ ] Offscreen document lifecycle: opens when needed, reuses existing document, does not crash on multiple captures.
- [ ] Accurate duration: Audio snippet corresponds to the spoken sentence with 150ms lead-in and 200ms tail padding.
- [ ] User continues hearing video audio during recording.
- [ ] No regression on video playback or subtitle hotkey navigation.
```

---

## Step 3 Prompt — Side Panel UI Integration, Media Previews & Mining Triggers

```markdown
### Task: Integrate Media Capture Triggers and Previews into Side Panel Card Editor

#### Goal
Provide visual and auditory feedback in the Side Panel Card Editor when media is captured from video subtitles, allowing the user to review the screenshot thumbnail and play the audio snippet before saving the card.

#### Context & Architecture
Currently, AnkiMiner's Side Panel (`extension/sidepanel/sidepanel.js` and `sidepanel.html`) has text inputs for `#field-image` and `#field-audio` hidden behind the `[+ Optional fields]` toggle. When video mining is active, media capture should automatically populate visual preview elements:
- An image preview thumbnail showing the captured video frame with a "Clear" and "Retake" button.
- An inline audio player / play button allowing immediate playback of the recorded sentence audio.
- Preserves manual URL/text input when optional fields are expanded.

#### Files to Modify / Create
- `extension/sidepanel/sidepanel.html`:
  - Add `.media-preview-container` inside the Card Editor.
  - Add `#image-preview` (`<img>`) container with remove/retake controls.
  - Add `#audio-preview` (`<audio controls>` or custom play button) container with remove control.
- `extension/sidepanel/sidepanel.css`:
  - Style media preview elements to fit within the compact 320px–400px Side Panel layout adhering strictly to `DESIGN.md` (warm dark theme, monospace labels, border radius 4px, subtle hover transitions).
- `extension/sidepanel/sidepanel.js`:
  - Maintain `currentDraftMedia = { imageBase64: null, audioBase64: null, mimeType: null }`.
  - Listen for `SCREENSHOT_CAPTURED` and `AUDIO_CAPTURED` runtime messages from the active tab.
  - Render preview states and wire clear/retake actions.
  - Include captured media in the draft payload sent to the backend upon `[Save Card]` click.
- `extension/tests/sidepanel-media-ui.test.js`: DOM and interaction tests for media previews.

#### Technical Specifications & Edge Cases
1. **Design System Adherence (`DESIGN.md`):**
   - Backgrounds: Dark neutral `#18181b` / `#27272a`.
   - Accent: Brand accent `#e4e4e7` / `#f43f5e` for active states.
   - Layout: Previews must be compact (thumbnail max height 90px; audio control minimal height 28px).
2. **Stale Capture Prevention:** If user rapidly selects multiple words, ensure media corresponds to the `currentCaptureId`.
3. **Empty / Cleared State:** Clicking "Clear" on the image or audio preview removes the media from the draft and clears `#field-image` / `#field-audio`.
4. **Offline Backend Indication:** If the backend server is unreachable, clear feedback is displayed without crashing the media player.

#### Verification Checklist
- [ ] Side Panel displays crisp image thumbnail when a video frame is captured.
- [ ] Audio snippet plays on demand inside the Side Panel preview.
- [ ] Clearing media resets draft state cleanly.
- [ ] Card Editor save button submits media data in the payload.
- [ ] Full compliance with `DESIGN.md` visual rules.
```

---

## Step 4 Prompt — FastAPI Backend Binary Media Storage & SQLite Card Linking

```markdown
### Task: Implement Local Media Storage and SQLite Association in FastAPI Backend

#### Goal
Persist captured screenshot images and sentence audio files to the local filesystem and store their references in SQLite, ensuring full offline availability and respecting the local-first source-of-truth invariant.

#### Context & Architecture
In AnkiMiner, SQLite is the authoritative source of truth. Media files must be saved locally **before** any attempt to communicate with AnkiConnect:
1. `POST /api/cards/save` receives optional `image_data` (base64) and `audio_data` (base64) alongside card fields.
2. The backend generates deterministic, sanitized filenames:
   - Image: `ankiminer_img_{timestamp}_{uuid[:8]}.jpg`
   - Audio: `ankiminer_audio_{timestamp}_{uuid[:8]}.webm` (or `.mp3`)
3. Binary data is decoded from base64 and written to local storage: `backend/data/media/`.
4. The relative filename or media path is written to the SQLite `cards` table (`image` and `audio` columns).
5. A dedicated static endpoint `GET /api/media/{filename}` serves stored media back to the extension Side Panel.

#### Files to Modify / Create
- `backend/app/config.py`: Define `MEDIA_DIR = Path("backend/data/media")`. Ensure directory is created on startup.
- `backend/app/schemas.py`: Add `image_data: str | None = None` and `audio_data: str | None = None` to `CardSaveRequest` schema.
- `backend/app/services/media_storage.py` (NEW):
  - `save_media_file(base64_data: str, prefix: str, extension: str) -> str`: Decodes base64, validates magic bytes, writes to disk, returns filename.
  - `delete_media_file(filename: str) -> bool`: Safe file deletion helper.
- `backend/app/api/cards.py`: Update `save_card` route to invoke `media_storage.save_media_file` when binary media is provided, updating `draft.image` and `draft.audio`.
- `backend/app/main.py`: Mount `StaticFiles` on `/api/media` pointing to `MEDIA_DIR`.
- `backend/tests/test_media_storage.py`: Unit and integration tests for file writing, sanitization, corrupt base64 rejection, and database linking.

#### Technical Specifications & Edge Cases
1. **Filename Sanitization:** Filenames must never contain path traversal elements (`../`, `..\\`), spaces, or special URL characters. Never prefix with an underscore (`_`).
2. **Corrupt Payload Safety:** If base64 decoding fails or magic bytes do not match expected image/audio signatures, return a clean 422 HTTP validation error without leaving orphaned files on disk.
3. **Database Idempotency:** If an existing card is updated with new media, optionally remove the superseded media file to prevent disk bloat.
4. **Anki Offline Resilience:** Saving to disk and SQLite **must succeed** regardless of whether Anki or AnkiConnect is running.

#### Verification Checklist
- [ ] Binary files saved to `backend/data/media/` with correct headers and extensions.
- [ ] SQLite rows in `cards` table store the saved media filenames.
- [ ] `GET /api/media/{filename}` serves the files with appropriate MIME types (`image/jpeg`, `audio/webm`, `audio/mpeg`).
- [ ] 100% test coverage in `backend/tests/test_media_storage.py`.
- [ ] Full backend regression test suite passes (`pytest backend/tests`).
```

---

## Step 5 Prompt — AnkiConnect Media Synchronization & Graceful Error Recovery

```markdown
### Task: Implement AnkiConnect Media Upload and Note Field Formatting

#### Goal
Transfer locally stored card media to Anki's `collection.media` via AnkiConnect when the user synchronizes a card, populating Anki note fields with correct `[sound:...]` and `<img src="...">` syntax.

#### Context & Architecture
When the user clicks `[Send to Anki]` in the Side Panel, the backend executes `POST /api/cards/{id}/sync`:
1. `AnkiConnectService` checks if the card references local media (`card["image"]` and `card["audio"]`).
2. If local media exists, the backend reads the binary file from `backend/data/media/`, base64 encodes it, and executes the AnkiConnect `storeMediaFile` action:
   - Action: `"storeMediaFile"`
   - Params: `{ "filename": filename, "data": base64_str, "deleteExisting": false }`
3. The note field mapping dynamically populates:
   - Audio field: `[sound:{filename}]`
   - Image field: `<img src="{filename}">`
4. AnkiConnect `addNote` is invoked with the mapped fields.
5. If `storeMediaFile` or `addNote` fails (e.g., Anki was closed, deck deleted), local SQLite state transitions to `sync_status = 'failed'` with diagnostic `sync_error`. **The card and media files on local disk are never deleted or corrupted.**

#### Files to Modify / Create
- `backend/app/services/anki_connect.py`:
  - Add `store_media_file(filename: str, file_path: Path) -> str`: Reads file, base64 encodes, calls AnkiConnect `storeMediaFile`.
  - Update `map_card_to_fields()`:
    - If `card["audio"]` is present and does not already contain `[sound:]`, wrap as `[sound:{filename}]`.
    - If `card["image"]` is present and does not already contain `<img>`, wrap as `<img src="{filename}">`.
  - Update `add_note()` to upload referenced media files before creating the note.
- `backend/app/api/cards.py`: Ensure sync endpoint catches media transfer errors and updates `sync_status` accordingly.
- `backend/tests/test_anki_connect.py`: Add mocked AnkiConnect tests for `storeMediaFile`, audio syntax formatting, image syntax formatting, and media upload failure recovery.

#### Technical Specifications & Edge Cases
1. **Existing Note Markup:** If user manually typed `<img src="foo.jpg">` or `[sound:bar.mp3]`, do not double-wrap.
2. **AnkiConnect Offline:** If Anki is unreachable (`ConnectionRefusedError`), raise `AnkiConnectionError`. SQLite records `sync_status = 'pending'` or `'failed'`. User can retry sync later.
3. **AnkiConnect Android / Desktop Compatibility:** Set `deleteExisting: false` because AnkiConnect Android does not support `deleteExisting: true`.
4. **Duplicate Prevention:** Using deterministic unique filenames (`ankiminer_{timestamp}_{hash}`) prevents collisions with existing Anki media assets.

#### Verification Checklist
- [ ] `storeMediaFile` action called for both image and audio files during card sync.
- [ ] Anki note fields contain valid `[sound:...]` and `<img src="...">` markup.
- [ ] When AnkiConnect is offline, local card and media files remain intact with `sync_status = 'failed'`.
- [ ] Retrying sync after opening Anki succeeds without duplicate media files.
- [ ] Backend test suite passes (`pytest backend/tests`).
```

---

## Step 6 Prompt (Future / V2) — Local Video WebM Clip Looping

```markdown
### Task: Implement Local Video WebM Clip Looping (V2)

#### Goal
Allow users playing local video files (`.mp4`, `.mkv`, `.webm`) or direct video streams to generate a 2–3 second silent looping WebM clip embedded in Anki as an animated card illustration.

#### Context & Architecture
Adapted from ASBPlayer's `WebmFileMediaFragmentData`:
1. Only active when `card.file` or a direct offline video `blob:` URL is available.
2. Creates an off-DOM `<video>` element, seeks to `cue.start`, and captures the canvas stream via `canvas.captureStream(24)`.
3. Encodes frames using `MediaRecorder` with `video/webm;codecs=vp9|av1`.
4. Clamps file size to ~1 MB using bitrate estimation (`width * height * fps * 0.06`).
5. Saves the resulting WebM clip to `backend/data/media/`.
6. Formats Anki note field as `<video autoplay loop muted playsinline src="{filename}.webm"></video>`.

#### Definition of Done
- Silent WebM clip loops smoothly inside Anki Desktop, AnkiMobile, and AnkiDroid.
- Explicitly disabled on streaming sites (YouTube/Netflix) to prevent buffer stalls.
```

---
*End of AnkiMiner Video Media Mining Research & Step-by-Step Specification.*
