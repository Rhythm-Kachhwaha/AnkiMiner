const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting video-mining-integration tests...");

// Load source files
const subtitleParserSrc = fs.readFileSync(path.resolve(__dirname, "../lib/subtitle-parser.js"), "utf8");
const captureUtilsSrc = fs.readFileSync(path.resolve(__dirname, "../content/capture-utils.js"), "utf8");
const contentScriptSrc = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");
const youtubeAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/youtube-adapter.js"), "utf8");
const netflixAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/netflix-adapter.js"), "utf8");
const videoMiningSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

// Mock environment
function createMockEnvironment({ isYouTube = false, isNetflix = false } = {}) {
  const sentMessages = [];
  const messageListeners = [];
  const docEventListeners = {};
  const winEventListeners = {};

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "GET_MINING_MODE") {
          return Promise.resolve({ enabled: true });
        }
        if (msg.type === "FETCH_YOUTUBE_TIMEDTEXT") {
          const sampleSRV3 = `<timedtext format="3"><body><p t="1000" d="4000"><s>約束の場所へ行こう</s></p></body></timedtext>`;
          return Promise.resolve({ ok: true, text: sampleSRV3 });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    }
  };

  class MockElement {
    constructor(tagName, id = "") {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.className = "";
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this._textContent = "";
      this._attrs = {};
      this._listeners = {};
      this.isConnected = true;
      this.rect = { top: 100, left: 50, width: 800, height: 450 };
    }

    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join("");
      }
      return this._textContent || "";
    }

    set textContent(val) {
      this._textContent = val;
    }

    appendChild(child) {
      if (!child) return child;
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    }

    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    }

    querySelectorAll(selector) {
      const results = [];
      const match = (el) => {
        if (!el) return false;
        if (selector.startsWith("#")) {
          return el.id === selector.slice(1);
        }
        if (selector.startsWith(".")) {
          const cls = selector.slice(1);
          return (el.className || "").split(/\s+/).includes(cls);
        }
        return el.tagName === selector.toUpperCase();
      };

      for (const child of this.children) {
        if (match(child)) results.push(child);
        results.push(...child.querySelectorAll(selector));
      }
      return results;
    }

    getBoundingClientRect() {
      return this.rect;
    }

    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(l => l !== fn);
    }

    dispatchEvent(event) {
      if (this._listeners[event.type]) {
        for (const fn of this._listeners[event.type]) {
          fn(event);
        }
      }
    }

    setAttribute(key, val) {
      this._attrs[key] = String(val);
    }

    getAttribute(key) {
      return this._attrs[key] || null;
    }

    removeAttribute(key) {
      delete this._attrs[key];
    }
  }

  class MockVideoElement extends MockElement {
    constructor(id = "test-video") {
      super("VIDEO", id);
      this.currentTime = 0;
      this.duration = 100;
      this.paused = true;
      this.ended = false;
      this.readyState = 4;
      this.videoWidth = 1280;
      this.videoHeight = 720;
    }

    seek(time) {
      this.currentTime = time;
      this.dispatchEvent({ type: "seeked" });
      this.dispatchEvent({ type: "timeupdate" });
    }
  }

  const rootBody = new MockElement("BODY", "document-body");
  const rootHead = new MockElement("HEAD", "document-head");

  let selectionText = "";

  function getPageUrl() {
    if (isYouTube) return "https://www.youtube.com/watch?v=mock123";
    if (isNetflix) return "https://www.netflix.com/watch/mock456";
    return "https://hianime.to/watch/ep-1";
  }

  function getHostname() {
    if (isYouTube) return "www.youtube.com";
    if (isNetflix) return "www.netflix.com";
    return "hianime.to";
  }

  const mockContext = {
    console,
    location: {
      href: getPageUrl(),
      hostname: getHostname()
    },
    window: {
      location: {
        href: getPageUrl(),
        hostname: getHostname()
      },
      addEventListener: (type, fn) => {
        if (!winEventListeners[type]) winEventListeners[type] = [];
        winEventListeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (!winEventListeners[type]) return;
        winEventListeners[type] = winEventListeners[type].filter(l => l !== fn);
      },
      getComputedStyle: () => ({ position: "relative" }),
      getSelection: () => ({
        rangeCount: selectionText ? 1 : 0,
        toString: () => selectionText
      }),
      requestAnimationFrame: () => null,
      cancelAnimationFrame: () => null
    },
    document: {
      body: rootBody,
      head: rootHead,
      documentElement: rootBody,
      fullscreenElement: null,
      createElement: (tag) => new MockElement(tag),
      getElementById: (id) => {
        if (id === "document-body") return rootBody;
        return rootBody.querySelector(`#${id}`);
      },
      querySelector: (sel) => {
        if (sel === ".player-timedtext, [data-uia=\"player-timedtext\"]") {
          return rootBody.querySelector(".player-timedtext");
        }
        return rootBody.querySelector(sel);
      },
      querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
      addEventListener: (type, fn) => {
        if (!docEventListeners[type]) docEventListeners[type] = [];
        docEventListeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (!docEventListeners[type]) return;
        docEventListeners[type] = docEventListeners[type].filter(l => l !== fn);
      },
      dispatchEvent: (evt) => {
        if (docEventListeners[evt.type]) {
          for (const fn of docEventListeners[evt.type]) fn(evt);
        }
      }
    },
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {}
      disconnect() {}
      trigger() {
        if (this.cb) this.cb();
      }
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    chrome: mockChrome,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };

  mockContext.globalThis = mockContext;
  mockContext.window.document = mockContext.document;

  const vmContext = vm.createContext(mockContext);

  // Run scripts in VM
  vm.runInContext(subtitleParserSrc, vmContext);
  vm.runInContext(captureUtilsSrc, vmContext);
  vm.runInContext(contentScriptSrc, vmContext);
  vm.runInContext(youtubeAdapterSrc, vmContext);
  vm.runInContext(netflixAdapterSrc, vmContext);
  vm.runInContext(videoMiningSrc, vmContext);

  return {
    vmContext,
    mockContext,
    rootBody,
    rootHead,
    MockElement,
    MockVideoElement,
    sentMessages,
    messageListeners,
    setSelectionText: (txt) => { selectionText = txt; },
    simulateMessage: async (msg) => {
      let lastRes = null;
      for (const fn of messageListeners) {
        await fn(msg, {}, (res) => { lastRes = res; });
      }
      return lastRes;
    }
  };
}

// -------------------------------------------------------------
// Test 1: Dynamic Cue Loading via LOAD_SUBTITLE_CUES
// -------------------------------------------------------------
async function testDynamicCueLoading() {
  const env = createMockEnvironment({ isYouTube: false });
  const video = new env.MockVideoElement("player-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  assert.ok(poc, "POC must be initialized");
  poc.instance.detector.checkVideos();

  const customCues = [
    { startTime: 10.0, endTime: 15.0, text: "カスタム字幕１" },
    { startTime: 20.0, endTime: 25.0, text: "逃げるな！生きる方が戦いだ！" }
  ];

  // Send message to load cues
  await env.simulateMessage({
    type: "LOAD_SUBTITLE_CUES",
    cues: customCues,
    filename: "frieren_01.srt"
  });

  assert.equal(poc.instance.syncEngine.cues.length, 2, "Synchronizer should have loaded 2 custom cues");

  // Seek video to 12.0s
  video.seek(12.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "カスタム字幕１");

  // Seek video to 22.0s
  video.seek(22.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "逃げるな！生きる方が戦いだ！");

  // Verify overlay DOM updated
  const overlaySpan = env.rootBody.querySelector("#ankiminer-video-subtitle");
  assert.ok(overlaySpan, "Subtitle span should exist");
  assert.equal(overlaySpan.textContent, "逃げるな！生きる方が戦いだ！");

  console.log("PASS: Dynamic cue loading and sync verified.");
}

// -------------------------------------------------------------
// Test 2: Timing Offset Adjustments via SET_SUBTITLE_OFFSET
// -------------------------------------------------------------
async function testTimingOffset() {
  const env = createMockEnvironment({ isYouTube: false });
  const video = new env.MockVideoElement("player-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  const cues = [
    { startTime: 10.0, endTime: 15.0, text: "オフセットテスト" }
  ];

  await env.simulateMessage({
    type: "LOAD_SUBTITLE_CUES",
    cues,
    filename: "test.srt"
  });

  // Video at 9.0s (offset 0.0s -> no cue active)
  video.seek(9.0);
  assert.equal(poc.instance.syncEngine.currentCue, null);

  // Apply +1.5s offset (video 9.0s + 1.5s offset = 10.5s -> cue matches!)
  await env.simulateMessage({
    type: "SET_SUBTITLE_OFFSET",
    offset: 1.5
  });

  assert.equal(poc.instance.syncEngine.offset, 1.5);
  video.seek(9.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "オフセットテスト");

  // Apply -5.0s offset (video 12.0s - 5.0s = 7.0s -> cue does NOT match)
  await env.simulateMessage({
    type: "SET_SUBTITLE_OFFSET",
    offset: -5.0
  });

  video.seek(12.0);
  assert.equal(poc.instance.syncEngine.currentCue, null);

  console.log("PASS: Timing offset formula and real-time adjustment verified.");
}

// -------------------------------------------------------------
// Test 3: Drag and Drop Subtitle File onto Video Player
// -------------------------------------------------------------
async function testDragAndDrop() {
  const env = createMockEnvironment({ isYouTube: false });
  const video = new env.MockVideoElement("player-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  const sampleSRT = `
1
00:00:05,000 --> 00:00:10,000
ドラッグ＆ドロップ字幕成功
`;

  const mockDroppedFile = {
    name: "dropped_subs.srt",
    text: () => Promise.resolve(sampleSRT)
  };

  // Trigger drop event on video overlay container
  const overlayContainer = env.rootBody.querySelector("#ankiminer-video-overlay-container");
  assert.ok(overlayContainer, "Overlay container must exist");

  await overlayContainer.dispatchEvent({
    type: "drop",
    preventDefault: () => {},
    dataTransfer: {
      files: [mockDroppedFile]
    }
  });

  // Wait tick for async file read
  await new Promise(r => setTimeout(r, 20));

  assert.equal(poc.instance.syncEngine.cues.length, 1);
  video.seek(6.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "ドラッグ＆ドロップ字幕成功");

  // Verify SUBTITLE_FILE_LOADED message dispatched
  const loadedMsg = env.sentMessages.find(m => m.type === "SUBTITLE_FILE_LOADED");
  assert.ok(loadedMsg, "SUBTITLE_FILE_LOADED message must be dispatched");
  assert.equal(loadedMsg.filename, "dropped_subs.srt");

  console.log("PASS: Drag-and-drop subtitle file loading verified.");
}

// -------------------------------------------------------------
// Test 4: YouTube Native Captions Suppression & TimedText Extraction
// -------------------------------------------------------------
async function testYouTubeIntegration() {
  const env = createMockEnvironment({ isYouTube: true });
  const video = new env.MockVideoElement("movie_player_video");
  env.rootBody.appendChild(video);

  // Embed YouTube player response script
  const ytScript = new env.MockElement("SCRIPT");
  ytScript.textContent = `
    var ytInitialPlayerResponse = {
      "captions": {
        "playerCaptionsTracklistRenderer": {
          "captionTracks": [
            {
              "baseUrl": "https://www.youtube.com/api/timedtext?v=test&lang=ja",
              "name": {"simpleText": "Japanese"},
              "languageCode": "ja"
            }
          ]
        }
      }
    };
  `;
  env.rootBody.appendChild(ytScript);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // Trigger YouTube caption check
  assert.ok(poc.instance.ytAdapter, "ytAdapter must be initialized on YouTube");
  await poc.instance.ytAdapter.checkAndLoad();

  // Verify timedtext was requested
  const timedtextMsg = env.sentMessages.find(m => m.type === "FETCH_YOUTUBE_TIMEDTEXT");
  assert.ok(timedtextMsg, "FETCH_YOUTUBE_TIMEDTEXT message must be sent to background");
  assert.ok(timedtextMsg.url.includes("fmt=srv3"), "URL must request SRV3 format");

  // Verify cues loaded from YouTube timedtext
  assert.ok(poc.instance.syncEngine.cues.length > 0, "Cues must be populated from YouTube response");
  video.seek(2.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "約束の場所へ行こう");

  // Verify YouTube native captions hiding style tag injected
  const styleTag = env.rootHead.querySelector("#ankiminer-hide-yt-captions") || env.rootBody.querySelector("#ankiminer-hide-yt-captions");
  assert.ok(styleTag, "Native caption suppression style must be injected on YouTube");
  assert.ok(styleTag.textContent.includes(".ytp-caption-window-container"));

  console.log("PASS: YouTube native caption extraction and suppression verified.");
}

// -------------------------------------------------------------
// Test 5: End-to-End Selection Capture on Subtitle Text
// -------------------------------------------------------------
async function testSelectionCapture() {
  const env = createMockEnvironment({ isYouTube: false });
  const video = new env.MockVideoElement("player-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // Load cue
  await env.simulateMessage({
    type: "LOAD_SUBTITLE_CUES",
    cues: [{ startTime: 0, endTime: 10, text: "逃げるな！生きる方が戦いだ！" }],
    filename: "anime.srt"
  });

  video.seek(5.0);

  // User selects "戦い" on the overlay
  env.setSelectionText("戦い");

  // User releases mouse on document / overlay span
  env.mockContext.document.dispatchEvent({ type: "mouseup" });

  await new Promise(r => setTimeout(r, 20));

  // Verify JAPANESE_TEXT_CAPTURED message dispatched to Side Panel
  const captureMsg = env.sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "JAPANESE_TEXT_CAPTURED message must be triggered");
  assert.equal(captureMsg.text, "戦い");

  console.log("PASS: End-to-end subtitle selection capture verified.");
}

// -------------------------------------------------------------
// Test 6: Clear Subtitles via CLEAR_SUBTITLES Message
// -------------------------------------------------------------
async function testClearSubtitles() {
  const env = createMockEnvironment({ isYouTube: false });
  const video = new env.MockVideoElement("player-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // 1. Load cue
  await env.simulateMessage({
    type: "LOAD_SUBTITLE_CUES",
    cues: [{ startTime: 0, endTime: 10, text: "消去される字幕" }],
    filename: "temp.srt"
  });

  video.seek(3.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "消去される字幕");
  assert.equal(poc.instance.activeFilename, "temp.srt");

  // 2. Clear subtitles
  const resp = await env.simulateMessage({
    type: "CLEAR_SUBTITLES"
  });

  assert.equal(resp?.ok, true);
  assert.equal(poc.instance.syncEngine.cues.length, 0);
  assert.equal(poc.instance.syncEngine.offset, 0.0);
  assert.equal(poc.instance.activeFilename, "");
  assert.equal(poc.instance.syncEngine.currentCue, null);

  const lastCueMsg = env.sentMessages.filter(m => m.type === "SUBTITLE_CUE_CHANGED").pop();
  assert.ok(lastCueMsg);
  assert.equal(lastCueMsg.cue, null);

  console.log("PASS: Subtitle clearing via CLEAR_SUBTITLES verified.");
}

// -------------------------------------------------------------
// Test 7: Netflix Native Subtitle Mutation Observation
// -------------------------------------------------------------
async function testNetflixIntegration() {
  const env = createMockEnvironment({ isNetflix: true });
  const video = new env.MockVideoElement("netflix-video");
  env.rootBody.appendChild(video);

  // Add Netflix timedtext container
  const timedtextContainer = new env.MockElement("DIV");
  timedtextContainer.className = "player-timedtext";
  const textLine = new env.MockElement("DIV");
  textLine.className = "player-timedtext-text-container";
  textLine.textContent = "ネトフリの字幕です";
  timedtextContainer.appendChild(textLine);
  env.rootBody.appendChild(timedtextContainer);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  assert.ok(poc.instance.netflixAdapter, "netflixAdapter must be initialized on Netflix");
  poc.instance.netflixAdapter._observeElement(timedtextContainer);

  // Verify suppression stylesheet was added
  const styleTag = env.rootHead.querySelector("#ankiminer-hide-netflix-captions") || env.rootBody.querySelector("#ankiminer-hide-netflix-captions");
  assert.ok(styleTag, "Netflix suppression stylesheet must exist");
  assert.ok(styleTag.textContent.includes(".player-timedtext"));

  // Trigger mutation
  poc.instance.netflixAdapter._handleMutation();

  // Verify broadcast
  const lastCueMsg = env.sentMessages.filter(m => m.type === "SUBTITLE_CUE_CHANGED").pop();
  assert.ok(lastCueMsg, "Cue message must be broadcast on Netflix mutation");
  assert.equal(lastCueMsg.cue?.text, "ネトフリの字幕です");
  assert.equal(poc.instance.activeFilename, "Netflix Subtitles (Live)");

  console.log("PASS: Netflix native subtitle extraction and suppression verified.");
}

// Execute all test suites
(async () => {
  try {
    await testDynamicCueLoading();
    await testTimingOffset();
    await testDragAndDrop();
    await testYouTubeIntegration();
    await testSelectionCapture();
    await testClearSubtitles();
    await testNetflixIntegration();

    console.log("\n>>> ALL VIDEO MINING INTEGRATION TESTS PASSED SUCCESSFULLY! <<<");
  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  }
})();
