const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Manifest V3 Offscreen Audio Recording Tests...\n");

// -------------------------------------------------------------
// 1. Verify Manifest Permissions & Offscreen File Configuration
// -------------------------------------------------------------
function testManifestAndOffscreenFiles() {
  const manifestPath = path.resolve(__dirname, "../manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.ok(Array.isArray(manifest.permissions), "manifest.permissions must be an array");
  assert.ok(manifest.permissions.includes("tabCapture"), "manifest.permissions must include 'tabCapture'");
  assert.ok(manifest.permissions.includes("offscreen"), "manifest.permissions must include 'offscreen'");
  assert.ok(manifest.permissions.includes("tabs"), "manifest.permissions must include 'tabs'");
  assert.ok(manifest.permissions.includes("activeTab"), "manifest.permissions must include 'activeTab'");

  const htmlPath = path.resolve(__dirname, "../offscreen/offscreen.html");
  assert.ok(fs.existsSync(htmlPath), "extension/offscreen/offscreen.html must exist");
  const htmlContent = fs.readFileSync(htmlPath, "utf8");
  assert.ok(htmlContent.includes("offscreen.js"), "offscreen.html must load offscreen.js");

  const jsPath = path.resolve(__dirname, "../offscreen/offscreen.js");
  assert.ok(fs.existsSync(jsPath), "extension/offscreen/offscreen.js must exist");

  console.log("PASS: Manifest permissions and offscreen document files verified.");
}

// -------------------------------------------------------------
// 2. Unit Tests for OffscreenAudioRecorder
// -------------------------------------------------------------
const { OffscreenAudioRecorder } = require("../offscreen/offscreen.js");

async function testOffscreenAudioRecorderLifecycle() {
  let tracksStopped = false;
  let audioContextCreated = false;
  let audioContextDestinationConnected = false;
  let audioContextClosed = false;
  let recorderStarted = false;
  let recorderStopped = false;

  const mockTrack = {
    kind: "audio",
    stop: () => { tracksStopped = true; }
  };

  const mockStream = {
    getTracks: () => [mockTrack],
    getAudioTracks: () => [mockTrack]
  };

  class MockAudioContext {
    constructor() {
      audioContextCreated = true;
      this.state = "running";
      this.destination = { id: "speakers-destination" };
    }
    createMediaStreamSource(stream) {
      assert.equal(stream, mockStream);
      return {
        connect: (dest) => {
          assert.equal(dest, this.destination);
          audioContextDestinationConnected = true;
        },
        disconnect: () => {}
      };
    }
    async close() {
      audioContextClosed = true;
      this.state = "closed";
    }
  }

  class MockMediaRecorder {
    static isTypeSupported(type) {
      return type.includes("webm");
    }
    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || "audio/webm;codecs=opus";
      this.state = "inactive";
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
    }
    start() {
      recorderStarted = true;
      this.state = "recording";
    }
    stop() {
      recorderStopped = true;
      this.state = "inactive";
      if (this.ondataavailable) {
        this.ondataavailable({ data: { size: 1024, name: "audio-chunk" } });
      }
      if (this.onstop) {
        this.onstop();
      }
    }
  }

  const mockGetUserMedia = async (constraints) => {
    assert.deepEqual(constraints.audio.mandatory, {
      chromeMediaSource: "tab",
      chromeMediaSourceId: "test-stream-id-123"
    });
    return mockStream;
  };

  const recorder = new OffscreenAudioRecorder({
    getUserMedia: mockGetUserMedia,
    AudioContextClass: MockAudioContext,
    MediaRecorderClass: MockMediaRecorder,
    blobToDataUrl: async () => "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8="
  });

  // Test 1: Missing streamId validation
  const missingRes = await recorder.startRecording({ streamId: "" });
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.error, "MISSING_STREAM_ID");

  // Test 2: Full recording lifecycle with timeout
  const recordPromise = recorder.startRecording({
    streamId: "test-stream-id-123",
    durationMs: 50
  });

  const result = await recordPromise;

  assert.ok(audioContextCreated, "AudioContext must be instantiated");
  assert.ok(audioContextDestinationConnected, "Audio mirroring must connect to destination");
  assert.ok(recorderStarted, "MediaRecorder must start");
  assert.ok(recorderStopped, "MediaRecorder must stop");
  assert.ok(tracksStopped, "Stream tracks must be stopped on completion");
  assert.ok(audioContextClosed, "AudioContext must be closed on completion");
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, "audio/webm;codecs=opus");
  assert.equal(result.dataUrl, "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8=");
  assert.equal(result.durationMs, 50);

  console.log("PASS: OffscreenAudioRecorder lifecycle and audio mirroring verified.");
}

async function testOffscreenAudioRecorderDrmHandling() {
  // Test DRM / Encrypted stream error (AbortError / NotAllowedError on Netflix)
  const mockDrmGetUserMedia = async () => {
    const err = new Error("Could not start audio source");
    err.name = "AbortError";
    throw err;
  };

  const recorder = new OffscreenAudioRecorder({
    getUserMedia: mockDrmGetUserMedia,
    AudioContextClass: class {},
    MediaRecorderClass: class {}
  });

  const drmRes = await recorder.startRecording({
    streamId: "drm-stream-456",
    durationMs: 100
  });

  assert.equal(drmRes.ok, false);
  assert.equal(drmRes.error, "DRM_AUDIO_RESTRICTED");
  assert.ok(drmRes.message.includes("restricted") || drmRes.message.includes("Protected audio"), "Clean diagnostic message for DRM streams");

  console.log("PASS: OffscreenAudioRecorder DRM audio error handling verified.");
}

// -------------------------------------------------------------
// 3. Contract Tests for background.js Coordination
// -------------------------------------------------------------
async function testBackgroundAudioCoordination() {
  const bgSrc = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");

  let offscreenCreated = false;
  let tabStreamRequested = false;
  let offscreenMessageSent = null;
  const messageListeners = [];

  let delayOffscreen = false;

  const mockChrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      },
      sendMessage: async (msg) => {
        offscreenMessageSent = msg;
        if (msg.type === "START_RECORDING_OFFSCREEN") {
          if (delayOffscreen) {
            await new Promise((r) => setTimeout(r, 60));
          }
          return {
            ok: true,
            dataUrl: "data:audio/webm;base64,mockRecordingBase64",
            mimeType: "audio/webm;codecs=opus",
            durationMs: msg.durationMs
          };
        }
        if (msg.type === "STOP_RECORDING_OFFSCREEN") {
          return { ok: true };
        }
        return { ok: true };
      },
      getURL: (path) => `chrome-extension://mock-id/${path}`
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    offscreen: {
      hasDocument: async () => offscreenCreated,
      createDocument: async (params) => {
        assert.equal(params.url, "offscreen/offscreen.html");
        assert.ok(params.reasons && params.reasons.includes("USER_MEDIA"), "reasons must include USER_MEDIA");
        offscreenCreated = true;
      }
    },
    tabCapture: {
      getMediaStreamId: async ({ targetTabId }) => {
        assert.equal(targetTabId, 88);
        tabStreamRequested = true;
        return "stream-token-88";
      }
    },
    tabs: {
      query: () => Promise.resolve([{ id: 88, windowId: 10 }]),
      sendMessage: () => Promise.resolve(),
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} }
    }
  };

  const context = {
    chrome: mockChrome,
    console,
    fetch: () => Promise.resolve(),
    Boolean,
    Promise,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;

  vm.runInNewContext(bgSrc, context);

  assert.equal(messageListeners.length, 1, "background.js must register onMessage listener");
  const listener = messageListeners[0];

  // Case 1: START_AUDIO_RECORDING message handling
  let startResponse = null;
  const handledStart = listener(
    { type: "START_AUDIO_RECORDING", tabId: 88, durationMs: 1500 },
    { tab: { id: 88 } },
    (res) => { startResponse = res; }
  );

  assert.equal(handledStart, true, "Listener must return true for async sendResponse");

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(offscreenCreated, "ensureOffscreenDocument must create document");
  assert.ok(tabStreamRequested, "tabCapture.getMediaStreamId must be called");
  assert.ok(offscreenMessageSent, "START_RECORDING_OFFSCREEN message must be forwarded");
  assert.equal(offscreenMessageSent.streamId, "stream-token-88");
  assert.equal(offscreenMessageSent.durationMs, 1500);
  assert.ok(startResponse && startResponse.ok, "Background returned successful audio response");
  assert.equal(startResponse.dataUrl, "data:audio/webm;base64,mockRecordingBase64");

  // Case 2: STOP_AUDIO_RECORDING message handling
  let stopResponse = null;
  const handledStop = listener(
    { type: "STOP_AUDIO_RECORDING" },
    {},
    (res) => { stopResponse = res; }
  );

  assert.equal(handledStop, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(stopResponse && stopResponse.ok, "STOP_AUDIO_RECORDING returned ok: true");

  // Case 3: Audio Recording Mutex (RECORDING_IN_PROGRESS rejection)
  delayOffscreen = true;
  let concurrentResponse = null;
  listener(
    { type: "START_AUDIO_RECORDING", tabId: 88, durationMs: 1500 },
    { tab: { id: 88 } },
    () => {}
  );
  listener(
    { type: "START_AUDIO_RECORDING", tabId: 88, durationMs: 1500 },
    { tab: { id: 88 } },
    (res) => { concurrentResponse = res; }
  );
  assert.equal(concurrentResponse?.ok, false, "Concurrent recording request must be rejected");
  assert.equal(concurrentResponse?.error, "RECORDING_IN_PROGRESS");
  delayOffscreen = false;

  console.log("PASS: background.js offscreen document lifecycle, audio coordination, and recording mutex verified.");
}

// -------------------------------------------------------------
// 4. Contract Tests for VideoMiningPOC.recordSentenceAudio
// -------------------------------------------------------------
async function testVideoMiningPOCAudioRecording() {
  const pocSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

  const sentMessages = [];
  const messageListeners = [];

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "START_AUDIO_RECORDING") {
          return Promise.resolve({
            ok: true,
            dataUrl: "data:audio/webm;base64,RECORDED_AUDIO_WEBM",
            mimeType: "audio/webm;codecs=opus",
            durationMs: msg.durationMs
          });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    },
    storage: {
      local: {
        get: (_k, cb) => cb?.({}),
        set: () => {},
        remove: () => {}
      }
    }
  };

  let seekTarget = -1;
  let played = false;
  let paused = false;

  const mockVideo = {
    isConnected: true,
    currentTime: 10.0,
    duration: 100.0,
    paused: true,
    playbackRate: 1.0,
    getBoundingClientRect: () => ({ left: 50, top: 100, width: 800, height: 450 }),
    addEventListener: (evt, handler) => {
      if (evt === "seeked") {
        setTimeout(handler, 10);
      }
    },
    removeEventListener: () => {},
    play: async () => { played = true; mockVideo.paused = false; },
    pause: () => { paused = true; mockVideo.paused = true; }
  };

  Object.defineProperty(mockVideo, "currentTime", {
    get: () => seekTarget >= 0 ? seekTarget : 10.0,
    set: (val) => { seekTarget = val; }
  });

  class MockMutationObserver {
    observe() {}
    disconnect() {}
  }

  const context = {
    chrome: mockChrome,
    window: {
      devicePixelRatio: 1.0,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    document: {
      body: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        appendChild: () => {},
        setAttribute: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      })
    },
    MutationObserver: MockMutationObserver,
    console,
    Boolean,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    Uint8ClampedArray
  };
  context.globalThis = context;
  context.window.globalThis = context;

  vm.runInNewContext(pocSrc, context);

  const pocInstance = context.window.__ANKIMINER_VIDEO_POC__.instance;
  assert.ok(pocInstance, "VideoMiningPOC instance must exist");
  assert.equal(typeof pocInstance.recordSentenceAudio, "function", "recordSentenceAudio method must exist");

  // Case 1: No active video
  pocInstance.activeVideo = null;
  const noVidRes = await pocInstance.recordSentenceAudio();
  assert.equal(noVidRes.ok, false);
  assert.equal(noVidRes.error, "NO_ACTIVE_VIDEO");

  // Case 2: Active video, but no cue
  pocInstance.activeVideo = mockVideo;
  pocInstance.syncEngine.currentCue = null;
  const noCueRes = await pocInstance.recordSentenceAudio(null);
  assert.equal(noCueRes.ok, false);
  assert.equal(noCueRes.error, "NO_ACTIVE_CUE");

  // Case 3a: Valid cue when video is paused -> fail gracefully without seeking or playing
  const cue = { start: 10.0, end: 12.0, text: "テスト字幕" };
  pocInstance.syncEngine.offset = 0.0;
  mockVideo.paused = true;
  seekTarget = -1;
  played = false;
  paused = false;

  const pausedResult = await pocInstance.recordSentenceAudio(cue, {
    audioPaddingStart: 0.15,
    audioPaddingEnd: 0.20
  });

  assert.equal(pausedResult.ok, false, "recordSentenceAudio should fail gracefully when paused");
  assert.equal(pausedResult.error, "AUDIO_CAPTURE_UNAVAILABLE");
  assert.equal(seekTarget, -1, "Video must NEVER be seeked during audio recording");
  assert.equal(played, false, "Video must NEVER be forced to play by audio recording");

  // Case 3b: Valid cue when video is playing -> record without seeking or pausing
  mockVideo.paused = false;
  seekTarget = -1;
  played = false;
  paused = false;
  sentMessages.length = 0;

  const recResult = await pocInstance.recordSentenceAudio(cue, {
    audioPaddingStart: 0.15,
    audioPaddingEnd: 0.20
  });

  assert.ok(recResult.ok, "recordSentenceAudio should succeed when video is playing");
  assert.equal(seekTarget, -1, "Video must NEVER be seeked during audio recording");
  assert.equal(played, false, "Video playback must not be toggled");
  assert.equal(mockVideo.paused, false, "Video must remain playing without interruption");

  // Verify START_AUDIO_RECORDING message sent
  const startMsg = sentMessages.find(m => m.type === "START_AUDIO_RECORDING");
  assert.ok(startMsg, "START_AUDIO_RECORDING message sent to background");
  // Duration: (12.20 - 9.85) / 1.0 * 1000 = 2350 ms
  assert.equal(startMsg.durationMs, 2350, "durationMs must include 150ms lead-in and 200ms tail padding");

  // Verify AUDIO_CAPTURED broadcast
  const broadcastMsg = sentMessages.find(m => m.type === "AUDIO_CAPTURED");
  assert.ok(broadcastMsg, "AUDIO_CAPTURED broadcast message sent");
  assert.equal(broadcastMsg.dataUrl, "data:audio/webm;base64,RECORDED_AUDIO_WEBM");
  assert.equal(broadcastMsg.durationMs, 2350);
  assert.equal(broadcastMsg.cue, cue);

  // Case 4: Timing offset handling (+500ms offset) with playing video
  pocInstance.syncEngine.offset = 0.50;
  mockVideo.paused = false;
  seekTarget = -1;
  sentMessages.length = 0;

  await pocInstance.recordSentenceAudio(cue, {
    audioPaddingStart: 0.15,
    audioPaddingEnd: 0.20
  });

  assert.equal(seekTarget, -1, "Video must NEVER be seeked regardless of timing offset");
  const offsetStartMsg = sentMessages.find(m => m.type === "START_AUDIO_RECORDING");
  assert.equal(offsetStartMsg.durationMs, 2350);

  // Case 5: Playback state preservation when initially playing
  mockVideo.paused = false;
  seekTarget = -1;
  paused = false;

  await pocInstance.recordSentenceAudio(cue);
  assert.equal(seekTarget, -1, "Video must NEVER be seeked");
  assert.equal(paused, false, "Video should remain playing after recording if initially playing");

  // Case 6: TRIGGER_AUDIO_RECORDING message handler in handleMessage
  mockVideo.paused = false;
  let triggerResponse = null;
  const handled = pocInstance.handleMessage(
    {
      type: "TRIGGER_AUDIO_RECORDING",
      cue,
      options: { audioPaddingStart: 0.15, audioPaddingEnd: 0.20 }
    },
    null,
    (res) => { triggerResponse = res; }
  );

  assert.equal(handled, true, "TRIGGER_AUDIO_RECORDING must be handled");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(triggerResponse && triggerResponse.ok, "TRIGGER_AUDIO_RECORDING message handler succeeded");

  // Case 7: Subtitle cue with startTime/endTime property format (e.g. YouTube CC adapter)
  const ytCue = { id: 135, startTime: 1059.62, endTime: 1066.62, text: "YouTube日本語字幕" };
  pocInstance.syncEngine.offset = 0.0;
  mockVideo.paused = false;
  seekTarget = -1;
  sentMessages.length = 0;

  const ytRecResult = await pocInstance.recordSentenceAudio(ytCue, {
    audioPaddingStart: 0.15,
    audioPaddingEnd: 0.20
  });

  assert.ok(ytRecResult.ok, "recordSentenceAudio should succeed with startTime/endTime cue");
  assert.equal(seekTarget, -1, "Video must NEVER be seeked for startTime/endTime cue");
  const ytStartMsg = sentMessages.find(m => m.type === "START_AUDIO_RECORDING");
  // Duration: (1066.82 - 1059.47) * 1000 = 7350 ms
  assert.equal(ytStartMsg.durationMs, 7350, "durationMs must accurately calculate for startTime/endTime cue");

  // Case 8: Paused video sentence playback recording when allowPausedPlayback is true
  mockVideo.paused = true;
  seekTarget = 15.0;
  played = false;
  paused = false;
  sentMessages.length = 0;

  const pausedPlaybackResult = await pocInstance.recordSentenceAudio(cue, {
    audioPaddingStart: 0.15,
    audioPaddingEnd: 0.20,
    allowPausedPlayback: true
  });

  assert.ok(pausedPlaybackResult.ok, "recordSentenceAudio should succeed for paused video when allowPausedPlayback is true");
  assert.equal(mockVideo.paused, true, "Video must be restored to paused after slice playback");
  assert.equal(seekTarget, 15.0, "Video currentTime must be restored to original paused position");
  const pausedStartMsg = sentMessages.find(m => m.type === "START_AUDIO_RECORDING");
  assert.ok(pausedStartMsg, "START_AUDIO_RECORDING sent during paused playback capture");

  console.log("PASS: VideoMiningPOC.recordSentenceAudio and TRIGGER_AUDIO_RECORDING verified.");
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
async function runAllTests() {
  try {
    testManifestAndOffscreenFiles();
    await testOffscreenAudioRecorderLifecycle();
    await testOffscreenAudioRecorderDrmHandling();
    await testBackgroundAudioCoordination();
    await testVideoMiningPOCAudioRecording();

    console.log("\n>>> ALL AUDIO RECORDING VERIFICATION TESTS PASSED SUCCESSFULLY! <<<\n");
  } catch (err) {
    console.error("\nTEST SUITE FAILED:\n", err);
    process.exit(1);
  }
}

runAllTests();
