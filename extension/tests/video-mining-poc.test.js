const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// -------------------------------------------------------------
// 1. Verify manifest.json configuration
// -------------------------------------------------------------
const manifestPath = path.resolve(__dirname, "../manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.ok(manifest.content_scripts && manifest.content_scripts.length > 0, "content_scripts must be defined");
const cs = manifest.content_scripts[0];
assert.ok(cs.js.includes("content/video-mining-poc.js"), "video-mining-poc.js must be registered in content_scripts");
assert.equal(cs.all_frames, true, "all_frames must be true");
assert.equal(cs.match_about_blank, true, "match_about_blank must be true");
console.log("PASS: Manifest configuration verified for video-mining-poc.js.");

// Load scripts
const captureUtilsSrc = fs.readFileSync(path.resolve(__dirname, "../content/capture-utils.js"), "utf8");
const contentScriptSrc = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");
const videoPocSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

// Mock environment generator
function createMockDOMEnvironment({ isIframe = false, iframeId = null } = {}) {
  const sentMessages = [];
  const eventListeners = {};
  const docEventListeners = {};
  const winEventListeners = {};

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "GET_MINING_MODE") {
          return Promise.resolve({ enabled: true });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: () => {}
      }
    }
  };

  let currentSelection = "";

  class MockElement {
    constructor(tagName, id = "") {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.className = "";
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this.textContent = "";
      this._attrs = {};
      this._listeners = {};
      this.isConnected = true;
      this.rect = { top: 100, left: 50, width: 800, height: 450 };
    }

    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      this.children.push(child);
      child.parentElement = this;
      child.isConnected = true;
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
        child.isConnected = false;
      }
      return child;
    }

    querySelector(sel) {
      if (sel.startsWith("#")) {
        const id = sel.slice(1);
        for (const c of this.children) {
          if (c.id === id) return c;
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    }

    querySelectorAll(sel) {
      const results = [];
      if (sel.toLowerCase() === "video") {
        for (const c of this.children) {
          if (c.tagName === "VIDEO") results.push(c);
          results.push(...c.querySelectorAll(sel));
        }
      }
      return results;
    }

    setAttribute(name, val) { this._attrs[name] = val; }
    getAttribute(name) { return this._attrs[name] || null; }
    removeAttribute(name) { delete this._attrs[name]; }

    getBoundingClientRect() { return this.rect; }

    contains(node) {
      if (!node) return false;
      let curr = node;
      while (curr) {
        if (curr === this) return true;
        curr = curr.parentElement;
      }
      return false;
    }

    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    }

    removeEventListener(event, handler) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    }

    dispatchEvent(event) {
      const handlers = this._listeners[event.type] || [];
      handlers.forEach(h => h(event));
    }
  }

  class MockVideoElement extends MockElement {
    constructor(id = "video-test") {
      super("video", id);
      this.currentTime = 0;
      this.duration = 120;
      this.paused = true;
      this.ended = false;
      this.readyState = 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.textTracks = [];
    }

    play() {
      this.paused = false;
      this.dispatchEvent({ type: "play" });
    }

    pause() {
      this.paused = true;
      this.dispatchEvent({ type: "pause" });
    }

    seek(time) {
      this.currentTime = time;
      this.dispatchEvent({ type: "timeupdate" });
      this.dispatchEvent({ type: "seeked" });
    }
  }

  const rootBody = new MockElement("body", "document-body");

  const mockDocument = {
    body: rootBody,
    fullscreenElement: null,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      if (rootBody.id === id) return rootBody;
      return rootBody.querySelector(`#${id}`);
    },
    querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
    addEventListener: (event, handler) => {
      if (!docEventListeners[event]) docEventListeners[event] = [];
      docEventListeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!docEventListeners[event]) return;
      docEventListeners[event] = docEventListeners[event].filter(h => h !== handler);
    },
    dispatchEvent: (event) => {
      const handlers = docEventListeners[event.type] || [];
      handlers.forEach(h => h(event));
    }
  };

  const mockWindow = {
    isIframe,
    iframeId,
    location: { href: isIframe ? "https://megacloud.tv/embed/test" : "https://hianime.to/watch/test-ep-1" },
    document: mockDocument,
    getSelection: () => ({
      rangeCount: currentSelection ? 1 : 0,
      toString: () => currentSelection
    }),
    addEventListener: (event, handler) => {
      if (!winEventListeners[event]) winEventListeners[event] = [];
      winEventListeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!winEventListeners[event]) return;
      winEventListeners[event] = winEventListeners[event].filter(h => h !== handler);
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }

  class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }

  const context = {
    chrome: mockChrome,
    window: mockWindow,
    document: mockDocument,
    MutationObserver: MockMutationObserver,
    ResizeObserver: MockResizeObserver,
    globalThis: {},
    console,
    Array,
    Math,
    Boolean,
    Promise,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  context.window.globalThis = context;

  // Run scripts
  vm.runInNewContext(captureUtilsSrc, context);
  vm.runInNewContext(contentScriptSrc, context);
  vm.runInNewContext(videoPocSrc, context);

  return {
    context,
    sentMessages,
    mockDocument,
    mockWindow,
    MockElement,
    MockVideoElement,
    rootBody,
    setSelection: (txt) => { currentSelection = txt; },
    triggerMouseUp: () => {
      mockDocument.dispatchEvent({ type: "mouseup" });
    }
  };
}

// -------------------------------------------------------------
// Test 2: Video Detection and MutationObserver
// -------------------------------------------------------------
async function testVideoDetection() {
  const env = createMockDOMEnvironment();
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;
  assert.ok(poc, "__ANKIMINER_VIDEO_POC__ should be exposed");

  // Initial state: no video
  assert.equal(poc.instance.detector.findPrimaryVideo(), null);

  // Add small 0-sized video (should be ignored)
  const invisibleVideo = new env.MockVideoElement("tracking-vid");
  invisibleVideo.rect = { top: 0, left: 0, width: 0, height: 0 };
  env.rootBody.appendChild(invisibleVideo);
  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.detector.findPrimaryVideo(), null, "Invisible video must be ignored");

  // Add primary video
  const primaryVideo = new env.MockVideoElement("main-video");
  primaryVideo.rect = { top: 50, left: 100, width: 960, height: 540 };
  env.rootBody.appendChild(primaryVideo);
  poc.instance.detector.checkVideos();

  const detected = poc.instance.detector.findPrimaryVideo();
  assert.ok(detected, "Primary video should be detected");
  assert.equal(detected.id, "main-video");

  // Check state reading
  primaryVideo.seek(12.5);
  const state = poc.instance.detector.getVideoState();
  assert.equal(state.currentTime, 12.5);
  assert.equal(state.paused, true);
  assert.equal(state.duration, 120);

  console.log("PASS: Video detection, filtering, and state observation verified.");
}

// -------------------------------------------------------------
// Test 3: Subtitle Synchronization Logic
// -------------------------------------------------------------
async function testSubtitleSync() {
  const env = createMockDOMEnvironment();
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

  const cues = [
    { startTime: 0, endTime: 5, text: "これはテストです" },
    { startTime: 5, endTime: 10, text: "字幕が同期されています" },
    { startTime: 10, endTime: 15, text: "見間違えた" }
  ];

  let currentCue = null;
  const syncEngine = new poc.SubtitleSynchronizer(cues, (cue) => {
    currentCue = cue;
  });

  const video = new env.MockVideoElement("sync-video");
  env.rootBody.appendChild(video);
  syncEngine.attach(video);

  // Initial at 0s -> should match cue 0
  assert.equal(currentCue?.text, "これはテストです");

  // Advance to 3s -> same cue, no duplicate event
  video.seek(3);
  assert.equal(currentCue?.text, "これはテストです");

  // Advance to 5s -> should match cue 1
  video.seek(5.0);
  assert.equal(currentCue?.text, "字幕が同期されています");

  // Advance to 12s -> should match cue 2 ("見間違えた")
  video.seek(12.0);
  assert.equal(currentCue?.text, "見間違えた");

  // Seek backward to 2s
  video.seek(2.0);
  assert.equal(currentCue?.text, "これはテストです");

  // Advance past end (25s) -> should be null
  video.seek(25.0);
  assert.equal(currentCue, null);

  syncEngine.detach();
  console.log("PASS: Subtitle sync engine (timeupdate, forward/backward seek, boundary times) verified.");
}

// -------------------------------------------------------------
// Test 4: Subtitle Overlay DOM Rendering and Selectability
// -------------------------------------------------------------
async function testOverlayRendering() {
  const env = createMockDOMEnvironment();
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

  const video = new env.MockVideoElement("overlay-video");
  env.rootBody.appendChild(video);

  const renderer = new poc.SubtitleOverlayRenderer();
  renderer.mount(video);

  const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
  assert.ok(container, "Overlay container element must exist in DOM");
  assert.ok(container.style.cssText.includes("z-index: 2147483647"), "Must have high z-index");

  const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");
  assert.ok(subtitle, "Subtitle span must exist in DOM");
  assert.ok(subtitle.style.cssText.includes("user-select: text"), "user-select must be text");
  assert.ok(subtitle.style.cssText.includes("pointer-events: auto"), "pointer-events must be auto");

  // Render cue
  renderer.renderCue({ startTime: 10, endTime: 15, text: "見間違えた" });
  assert.equal(subtitle.textContent, "見間違えた");
  assert.equal(container.getAttribute("data-active-cue"), "見間違えた");

  // Clear cue
  renderer.renderCue(null);
  assert.equal(subtitle.textContent, "");
  assert.equal(container.getAttribute("data-active-cue"), null);

  renderer.unmount();
  assert.equal(env.mockDocument.getElementById("ankiminer-video-overlay-container"), null, "Must clean up container on unmount");
  console.log("PASS: Subtitle overlay rendering, styling, text selectability, and lifecycle verified.");
}

// -------------------------------------------------------------
// Test 5: End-to-End Integration (Subtitle Overlay -> Yomitan/Selection -> AnkiMiner Capture)
// -------------------------------------------------------------
async function testCapturePipelineIntegration() {
  // Test both in top page and inside cross-origin iframe context (HiAnime pattern)
  for (const isIframe of [false, true]) {
    const env = createMockDOMEnvironment({ isIframe, iframeId: isIframe ? "vidplay-iframe" : null });
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("active-player-video");
    env.rootBody.appendChild(video);

    // Let detector find video and mount overlay
    poc.instance.detector.checkVideos();
    assert.equal(poc.instance.activeVideo, video);

    // Load explicit test fixture cue
    poc.instance.syncEngine.setCues([
      { startTime: 10, endTime: 15, text: "見間違えた" }
    ]);

    // Seek to 12s -> cue "見間違えた"
    video.seek(12.0);

    const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");
    assert.equal(subtitle.textContent, "見間違えた");

    // Simulate user selecting the Japanese text on the subtitle overlay
    env.setSelection("見間違えた");
    env.triggerMouseUp();

    // Allow async microtask promise to resolve
    await new Promise((r) => setTimeout(r, 25));

    const captureMsg = env.sentMessages.find((m) => m.type === "JAPANESE_TEXT_CAPTURED");
    assert.ok(captureMsg, `Must trigger JAPANESE_TEXT_CAPTURED (isIframe=${isIframe})`);
    assert.equal(captureMsg.text, "見間違えた");
  }

  console.log("PASS: End-to-end integration verified: Subtitle selection triggers JAPANESE_TEXT_CAPTURED in top frame and cross-origin iframes with 0 changes to existing capture pipeline.");
}

// -------------------------------------------------------------
// Test 6: Native TextTrack Inspection Experiment
// -------------------------------------------------------------
async function testNativeTextTrackInspection() {
  const env = createMockDOMEnvironment();
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

  const video = new env.MockVideoElement("yt-video");
  video.textTracks = [
    {
      kind: "subtitles",
      label: "Japanese",
      language: "ja",
      mode: "showing",
      cues: [
        { startTime: 1.0, endTime: 4.0, text: "こんにちは世界" }
      ]
    },
    {
      kind: "captions",
      label: "English [Auto-generated]",
      language: "en",
      mode: "hidden",
      cues: []
    }
  ];

  const report = poc.inspectNativeTextTracks(video);
  assert.equal(report.supported, true);
  assert.equal(report.trackCount, 2);
  assert.equal(report.tracks[0].language, "ja");
  assert.equal(report.tracks[0].accessible, true);
  assert.equal(report.tracks[0].cueCount, 1);
  assert.equal(report.tracks[0].sampleText, "こんにちは世界");

  console.log("PASS: Native TextTrack inspection experiment verified.");
}

// -------------------------------------------------------------
// Test 7: Zero Demo/Fallback Subtitles When No Cues Loaded
// -------------------------------------------------------------
async function testNoDemoSubtitlesWhenEmpty() {
  const env = createMockDOMEnvironment();
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

  const video = new env.MockVideoElement("test-empty-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();

  // Initially syncEngine must have 0 cues
  assert.equal(poc.instance.syncEngine.cues.length, 0, "Default cues must be empty (no POC dummy cues)");

  const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
  const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");
  assert.ok(container, "Container exists");

  // Seek to arbitrary times (0s, 5s, 12s, 30s)
  for (const t of [0, 2, 5, 12, 30, 50]) {
    video.seek(t);
    assert.equal(poc.instance.syncEngine.currentCue, null, `At ${t}s cue must be null`);
    assert.equal(subtitle.textContent, "", `At ${t}s subtitle text must be empty`);
    assert.equal(container.style.display, "none", `At ${t}s container must be hidden`);
    assert.equal(container.getAttribute("data-active-cue"), null);
  }

  console.log("PASS: Zero demo/fallback subtitles when no cues loaded verified.");
}

// -------------------------------------------------------------
// Test 8: HiAnime Fullscreen Overlay Adaptation
// -------------------------------------------------------------
async function testHiAnimeFullscreenBehavior() {
  const env = createMockDOMEnvironment({ isIframe: false });
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

  // HiAnime player DOM structure: player wrapper div containing video
  const playerWrapper = new env.MockElement("div", "player-container");
  playerWrapper.rect = { top: 100, left: 50, width: 800, height: 450 };
  const video = new env.MockVideoElement("hianime-video");
  video.rect = { top: 100, left: 50, width: 800, height: 450 };

  playerWrapper.appendChild(video);
  env.rootBody.appendChild(playerWrapper);

  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.activeVideo, video);

  // Load external subtitle cues
  poc.instance.syncEngine.setCues([
    { startTime: 5.0, endTime: 10.0, text: "フルスクリーンテスト" }
  ]);

  const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
  const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");

  // Normal playback at 7.0s
  video.seek(7.0);
  assert.equal(subtitle.textContent, "フルスクリーンテスト");
  assert.equal(container.parentElement, env.rootBody, "Normal playback mounts to body");
  assert.equal(container.style.position, "fixed");

  // Enter Fullscreen on playerWrapper
  env.mockDocument.fullscreenElement = playerWrapper;
  env.mockDocument.dispatchEvent({ type: "fullscreenchange" });

  // Assert container followed video into fullscreen element
  assert.equal(container.parentElement, playerWrapper, "Must attach inside fullscreen container");
  assert.equal(container.style.position, "absolute", "Must use absolute positioning inside fullscreen container");
  assert.equal(subtitle.textContent, "フルスクリーンテスト", "Cue remains rendered in fullscreen");

  // Advance time while in fullscreen
  video.seek(8.0);
  assert.equal(subtitle.textContent, "フルスクリーンテスト");

  // Simulate player replacement during fullscreen
  container.parentElement.removeChild(container);
  assert.equal(container.isConnected, false);
  poc.instance.renderer.updatePosition();
  assert.equal(container.parentElement, playerWrapper, "ensureMounted re-attaches container after player DOM replacement");
  assert.equal(container.isConnected, true);

  // Exit Fullscreen
  env.mockDocument.fullscreenElement = null;
  env.mockDocument.dispatchEvent({ type: "fullscreenchange" });

  assert.equal(container.parentElement, env.rootBody, "Exiting fullscreen moves container back to document.body");
  assert.equal(container.style.position, "fixed", "Exiting fullscreen restores fixed positioning");

  console.log("PASS: HiAnime fullscreen overlay attachment, repositioning, and exit handling verified.");
}

// -------------------------------------------------------------
// Test 9: Inactive Subtitle Cue Hiding & Offset Synchronization
// -------------------------------------------------------------
async function testInactiveCueHiding() {
  const env = createMockDOMEnvironment();
  const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

  const video = new env.MockVideoElement("test-hiding-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();

  poc.instance.syncEngine.setCues([
    { startTime: 10.0, endTime: 12.0, text: "セリフ１" },
    { startTime: 16.0, endTime: 18.0, text: "セリフ２" }
  ]);

  const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
  const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");

  // Before cue 1 (5.0s) -> HIDDEN
  video.seek(5.0);
  assert.equal(poc.instance.syncEngine.currentCue, null);
  assert.equal(subtitle.textContent, "");
  assert.equal(container.style.display, "none");

  // During cue 1 (10.5s) -> VISIBLE
  video.seek(10.5);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "セリフ１");
  assert.equal(subtitle.textContent, "セリフ１");
  assert.equal(container.style.display, "flex");

  // After cue 1 / gap (13.0s) -> HIDDEN
  video.seek(13.0);
  assert.equal(poc.instance.syncEngine.currentCue, null);
  assert.equal(subtitle.textContent, "");
  assert.equal(container.style.display, "none");

  // During cue 2 (17.0s) -> VISIBLE
  video.seek(17.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "セリフ２");
  assert.equal(subtitle.textContent, "セリフ２");
  assert.equal(container.style.display, "flex");

  // After cue 2 (20.0s) -> HIDDEN
  video.seek(20.0);
  assert.equal(poc.instance.syncEngine.currentCue, null);
  assert.equal(subtitle.textContent, "");
  assert.equal(container.style.display, "none");

  // Test offset (+500ms -> effective interval for cue 1 is [10.5, 12.5])
  poc.instance.syncEngine.setOffset(0.5);

  // At 10.2s: before 10.5s -> HIDDEN
  video.seek(10.2);
  assert.equal(poc.instance.syncEngine.currentCue, null);
  assert.equal(container.style.display, "none");

  // At 11.0s: within [10.5, 12.5] -> VISIBLE
  video.seek(11.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "セリフ１");
  assert.equal(container.style.display, "flex");

  // At 12.6s: after 12.5s -> HIDDEN
  video.seek(12.6);
  assert.equal(poc.instance.syncEngine.currentCue, null);
  assert.equal(container.style.display, "none");

  console.log("PASS: Inactive cue hiding (before, gap, after, with offset) verified.");
}

(async () => {
  await testVideoDetection();
  await testSubtitleSync();
  await testOverlayRendering();
  await testCapturePipelineIntegration();
  await testNativeTextTrackInspection();
  await testNoDemoSubtitlesWhenEmpty();
  await testHiAnimeFullscreenBehavior();
  await testInactiveCueHiding();
  console.log("\n>>> ALL VIDEO MINING POC AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY! <<<\n");
  process.exit(0);
})();
