const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting subtitle-hotkeys tests...");

// Load source files
const subtitleParserSrc = fs.readFileSync(path.resolve(__dirname, "../lib/subtitle-parser.js"), "utf8");
const captureUtilsSrc = fs.readFileSync(path.resolve(__dirname, "../content/capture-utils.js"), "utf8");
const contentScriptSrc = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");
const youtubeAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/youtube-adapter.js"), "utf8");
const netflixAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/netflix-adapter.js"), "utf8");
const videoMiningSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

function createMockEnvironment({ isYouTube = false, isNetflix = false, isHiAnime = false } = {}) {
  const sentMessages = [];
  const messageListeners = [];
  const winEventListeners = {};
  const docEventListeners = {};

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "GET_MINING_MODE") return Promise.resolve({ enabled: true });
        if (msg.type === "FETCH_YOUTUBE_TIMEDTEXT") {
          const srv3 = `<timedtext format="3"><body><p t="1000" d="4000"><s>テスト１</s></p><p t="6000" d="3000"><s>テスト２</s></p></body></timedtext>`;
          return Promise.resolve({ ok: true, text: srv3 });
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
      this.isContentEditable = false;
    }

    get textContent() {
      if (this.children.length > 0) return this.children.map(c => c.textContent).join("");
      return this._textContent || "";
    }

    set textContent(val) {
      this._textContent = val;
    }

    appendChild(child) {
      if (!child) return child;
      if (child.parentElement) child.parentElement.removeChild(child);
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
        if (selector.startsWith("#")) return el.id === selector.slice(1);
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

    closest(selector) {
      let cur = this;
      const match = (el) => {
        if (!el) return false;
        const tags = selector.toUpperCase().split(/,\s*/);
        if (tags.includes(el.tagName)) return true;
        if (selector.includes("[contenteditable") && el.getAttribute("contenteditable")) return true;
        if (selector.includes("[role=") && el.getAttribute("role")) return true;
        return false;
      };
      while (cur) {
        if (match(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    getBoundingClientRect() { return this.rect; }

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
        for (const fn of this._listeners[event.type]) fn(event);
      }
    }

    setAttribute(key, val) { this._attrs[key] = String(val); }
    getAttribute(key) { return this._attrs[key] || null; }
    removeAttribute(key) { delete this._attrs[key]; }
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

    play() {
      this.paused = false;
      this.dispatchEvent({ type: "play" });
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
      this.dispatchEvent({ type: "pause" });
    }
  }

  const rootBody = new MockElement("BODY", "document-body");
  const rootHead = new MockElement("HEAD", "document-head");

  function getPageUrl() {
    if (isYouTube) return "https://www.youtube.com/watch?v=mock123";
    if (isNetflix) return "https://www.netflix.com/watch/mock456";
    if (isHiAnime) return "https://hianime.to/watch/one-piece-100?ep=1";
    return "https://example.com/anime/ep1";
  }

  function getHostname() {
    if (isYouTube) return "www.youtube.com";
    if (isNetflix) return "www.netflix.com";
    if (isHiAnime) return "hianime.to";
    return "example.com";
  }

  const mockDoc = {
    body: rootBody,
    head: rootHead,
    documentElement: rootBody,
    activeElement: rootBody,
    fullscreenElement: null,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      if (id === "document-body") return rootBody;
      return rootBody.querySelector(`#${id}`);
    },
    querySelector: (sel) => rootBody.querySelector(sel),
    querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
    addEventListener: (type, fn) => {
      if (!docEventListeners[type]) docEventListeners[type] = [];
      docEventListeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!docEventListeners[type]) return;
      docEventListeners[type] = docEventListeners[type].filter(l => l !== fn);
    }
  };

  const mockContext = {
    console,
    location: { href: getPageUrl(), hostname: getHostname() },
    window: {
      location: { href: getPageUrl(), hostname: getHostname() },
      document: mockDoc,
      addEventListener: (type, fn) => {
        if (!winEventListeners[type]) winEventListeners[type] = [];
        winEventListeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (!winEventListeners[type]) return;
        winEventListeners[type] = winEventListeners[type].filter(l => l !== fn);
      },
      getComputedStyle: () => ({ position: "relative" }),
      getSelection: () => ({ rangeCount: 0, toString: () => "" }),
      requestAnimationFrame: () => null,
      cancelAnimationFrame: () => null
    },
    document: mockDoc,
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
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
  const vmContext = vm.createContext(mockContext);

  vm.runInContext(subtitleParserSrc, vmContext);
  vm.runInContext(captureUtilsSrc, vmContext);
  vm.runInContext(contentScriptSrc, vmContext);
  vm.runInContext(youtubeAdapterSrc, vmContext);
  vm.runInContext(netflixAdapterSrc, vmContext);
  vm.runInContext(videoMiningSrc, vmContext);

  function dispatchKeyEvent({ key, code, target = rootBody, ctrlKey = false, metaKey = false, altKey = false, shiftKey = false }) {
    let defaultPrevented = false;
    let propagationStopped = false;
    const evt = {
      type: "keydown",
      key,
      code: code || key,
      target,
      ctrlKey,
      metaKey,
      altKey,
      shiftKey,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => { propagationStopped = true; }
    };
    if (winEventListeners["keydown"]) {
      for (const fn of winEventListeners["keydown"]) {
        fn(evt);
        if (propagationStopped) break;
      }
    }
    return { defaultPrevented, propagationStopped };
  }

  return {
    vmContext,
    rootBody,
    mockDoc,
    MockElement,
    MockVideoElement,
    dispatchKeyEvent
  };
}

// -------------------------------------------------------------
// Test 1: Hotkey Navigation with External Subtitle Cues (HiAnime / generic)
// -------------------------------------------------------------
async function testSubtitleNavigationHotkeys() {
  // Explicitly test HiAnime environment
  const env = createMockEnvironment({ isHiAnime: true });
  const video = new env.MockVideoElement("test-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.activeVideo, video);

  // Set explicit cues: Cue 0 (10-15s), Cue 1 (20-25s), Cue 2 (30-35s)
  const testCues = [
    { startTime: 10.0, endTime: 15.0, text: "字幕１" },
    { startTime: 20.0, endTime: 25.0, text: "字幕２" },
    { startTime: 30.0, endTime: 35.0, text: "字幕３" }
  ];
  poc.instance.syncEngine.setCues(testCues);

  // --- Initial state: seek to inside Cue 1 (22s) ---
  video.seek(22.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "字幕２");

  // --- Test 'S': Replay current subtitle ---
  const resS = env.dispatchKeyEvent({ key: "s" });
  assert.equal(resS.defaultPrevented, true, "S must prevent default");
  assert.equal(video.currentTime, 20.0, "S must seek to current cue startTime");
  assert.equal(poc.instance.syncEngine.currentCue?.text, "字幕２");

  // --- Test 'D': Next subtitle ---
  const resD = env.dispatchKeyEvent({ key: "d" });
  assert.equal(resD.defaultPrevented, true, "D must prevent default");
  assert.equal(video.currentTime, 30.0, "D must seek to next cue (Cue 2) startTime");
  assert.equal(poc.instance.syncEngine.currentCue?.text, "字幕３");

  // --- Test 'D' at last cue: should do nothing ---
  const resDLast = env.dispatchKeyEvent({ key: "d" });
  assert.equal(video.currentTime, 30.0, "D at last cue must do nothing");

  // --- Test 'A': Previous subtitle ---
  const resA = env.dispatchKeyEvent({ key: "a" });
  assert.equal(resA.defaultPrevented, true, "A must prevent default");
  assert.equal(video.currentTime, 20.0, "A must seek to previous cue (Cue 1) startTime");
  assert.equal(poc.instance.syncEngine.currentCue?.text, "字幕２");

  // --- Test 'A' again: Seek to Cue 0 ---
  env.dispatchKeyEvent({ key: "a" });
  assert.equal(video.currentTime, 10.0, "A must seek to Cue 0 startTime");
  assert.equal(poc.instance.syncEngine.currentCue?.text, "字幕１");

  // --- Test 'A' at first cue: should do nothing ---
  env.dispatchKeyEvent({ key: "a" });
  assert.equal(video.currentTime, 10.0, "A at first cue must do nothing");

  // --- Test Navigation from a Gap between cues (e.g. 17s between Cue 0 and Cue 1) ---
  video.seek(17.0);
  assert.equal(poc.instance.syncEngine.currentCue, null, "No cue active in gap");

  // Pressing 'S' in gap: no active cue, should do nothing
  env.dispatchKeyEvent({ key: "s" });
  assert.equal(video.currentTime, 17.0, "S in gap without cue must do nothing");

  // Pressing 'A' in gap: should seek to preceding cue (Cue 0 at 10s)
  env.dispatchKeyEvent({ key: "a" });
  assert.equal(video.currentTime, 10.0, "A in gap must seek to preceding cue startTime");

  // Seek back to gap (17s)
  video.seek(17.0);
  // Pressing 'D' in gap: should seek to next cue (Cue 1 at 20s)
  env.dispatchKeyEvent({ key: "d" });
  assert.equal(video.currentTime, 20.0, "D in gap must seek to next cue startTime");

  console.log("PASS: A/S/D subtitle navigation hotkeys verified.");
}

// -------------------------------------------------------------
// Test 2: Space Hotkey Play/Pause Toggle
// -------------------------------------------------------------
async function testPlayPauseHotkey() {
  const env = createMockEnvironment();
  const video = new env.MockVideoElement("test-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // Video starts paused
  assert.equal(video.paused, true);

  // Press Space -> should play
  const res1 = env.dispatchKeyEvent({ key: " ", code: "Space" });
  assert.equal(res1.defaultPrevented, true, "Space must prevent default page scroll");
  assert.equal(video.paused, false, "Space on paused video must trigger play()");

  // Press Space again -> should pause
  const res2 = env.dispatchKeyEvent({ key: " ", code: "Space" });
  assert.equal(res2.defaultPrevented, true);
  assert.equal(video.paused, true, "Space on playing video must trigger pause()");

  // Press Space when target is a native button -> should NOT intercept
  const button = new env.MockElement("BUTTON");
  env.rootBody.appendChild(button);
  const resBtn = env.dispatchKeyEvent({ key: " ", code: "Space", target: button });
  assert.equal(resBtn.defaultPrevented, false, "Space on native button must not be intercepted");
  assert.equal(video.paused, true, "Video state must not toggle when button was target");

  console.log("PASS: Space play/pause hotkey verified.");
}

// -------------------------------------------------------------
// Test 3: Editable Elements & Modifier Keys Protection
// -------------------------------------------------------------
async function testEditableAndModifierProtection() {
  const env = createMockEnvironment();
  const video = new env.MockVideoElement("test-vid");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();
  poc.instance.syncEngine.setCues([
    { startTime: 5.0, endTime: 10.0, text: "テスト１" },
    { startTime: 15.0, endTime: 20.0, text: "テスト２" }
  ]);
  video.seek(7.0);

  // 1. Input element
  const input = new env.MockElement("INPUT");
  env.rootBody.appendChild(input);
  let res = env.dispatchKeyEvent({ key: "s", target: input });
  assert.equal(res.defaultPrevented, false, "Typing 's' in input must not be intercepted");
  assert.equal(video.currentTime, 7.0, "Video must not seek when typing in input");

  // 2. Textarea element
  const textarea = new env.MockElement("TEXTAREA");
  env.rootBody.appendChild(textarea);
  res = env.dispatchKeyEvent({ key: "a", target: textarea });
  assert.equal(res.defaultPrevented, false, "Typing 'a' in textarea must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  // 3. Select element
  const select = new env.MockElement("SELECT");
  env.rootBody.appendChild(select);
  res = env.dispatchKeyEvent({ key: "d", target: select });
  assert.equal(res.defaultPrevented, false, "Key 'd' in select must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  // 4. Contenteditable element
  const editableDiv = new env.MockElement("DIV");
  editableDiv.isContentEditable = true;
  editableDiv.setAttribute("contenteditable", "true");
  env.rootBody.appendChild(editableDiv);
  res = env.dispatchKeyEvent({ key: " ", code: "Space", target: editableDiv });
  assert.equal(res.defaultPrevented, false, "Space in contenteditable must not be intercepted");
  assert.equal(video.paused, true);

  // 5. ActiveElement check
  env.mockDoc.activeElement = input;
  res = env.dispatchKeyEvent({ key: "s", target: env.rootBody });
  assert.equal(res.defaultPrevented, false, "Key when document.activeElement is input must not be intercepted");
  assert.equal(video.currentTime, 7.0);
  env.mockDoc.activeElement = env.rootBody;

  // 6. Modifier keys (Ctrl+A, Ctrl+S, Cmd+D, Alt+A)
  res = env.dispatchKeyEvent({ key: "a", ctrlKey: true });
  assert.equal(res.defaultPrevented, false, "Ctrl+A (Select All) must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  res = env.dispatchKeyEvent({ key: "s", ctrlKey: true });
  assert.equal(res.defaultPrevented, false, "Ctrl+S (Save) must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  res = env.dispatchKeyEvent({ key: "d", metaKey: true });
  assert.equal(res.defaultPrevented, false, "Cmd+D must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  res = env.dispatchKeyEvent({ key: "a", altKey: true });
  assert.equal(res.defaultPrevented, false, "Alt+A must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  console.log("PASS: Editable element and modifier key protection verified.");
}

// -------------------------------------------------------------
// Test 4: YouTube Subtitles & Hotkey Integration
// -------------------------------------------------------------
async function testYouTubeHotkeyIntegration() {
  const env = createMockEnvironment({ isYouTube: true });
  const video = new env.MockVideoElement("movie_player_video");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // Load YouTube cues via adapter
  poc.instance.syncEngine.setCues([
    { startTime: 1.0, endTime: 5.0, text: "YouTube字幕１" },
    { startTime: 6.0, endTime: 9.0, text: "YouTube字幕２" }
  ]);

  video.seek(2.5);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "YouTube字幕１");

  // Test S (replay)
  env.dispatchKeyEvent({ key: "s" });
  assert.equal(video.currentTime, 1.0);

  // Test D (next)
  env.dispatchKeyEvent({ key: "d" });
  assert.equal(video.currentTime, 6.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "YouTube字幕２");

  // Test Space (play/pause)
  assert.equal(video.paused, true);
  env.dispatchKeyEvent({ key: " ", code: "Space" });
  assert.equal(video.paused, false);

  console.log("PASS: YouTube native subtitle hotkey workflow verified.");
}

// -------------------------------------------------------------
// Test 5: Netflix Subtitles & Hotkey Suppression (Disabled for Netflix)
// -------------------------------------------------------------
async function testNetflixHotkeyIntegration() {
  const env = createMockEnvironment({ isNetflix: true });
  const video = new env.MockVideoElement("netflix-video");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // Verify platform detection identifies Netflix
  assert.equal(poc.isNetflixPlatform(), true, "Must detect Netflix platform");

  // Load a subtitle cue in syncEngine
  poc.instance.syncEngine.setCues([
    { startTime: 10.0, endTime: 15.0, text: "テスト字幕" }
  ]);
  video.currentTime = 12.0;

  // 1. Verify hotkeys A, S, D, Space are NOT intercepted by AnkiMiner on Netflix
  const resA = env.dispatchKeyEvent({ key: "a" });
  assert.equal(resA.defaultPrevented, false, "A must NOT be prevented on Netflix");
  assert.equal(video.currentTime, 12.0, "A must NOT seek video on Netflix");

  const resS = env.dispatchKeyEvent({ key: "s" });
  assert.equal(resS.defaultPrevented, false, "S must NOT be prevented on Netflix");
  assert.equal(video.currentTime, 12.0, "S must NOT seek video on Netflix");

  const resD = env.dispatchKeyEvent({ key: "d" });
  assert.equal(resD.defaultPrevented, false, "D must NOT be prevented on Netflix");
  assert.equal(video.currentTime, 12.0, "D must NOT seek video on Netflix");

  const resSpace = env.dispatchKeyEvent({ key: " ", code: "Space" });
  assert.equal(resSpace.defaultPrevented, false, "Space must NOT be prevented on Netflix");
  assert.equal(video.paused, true, "Space must NOT toggle video play/pause on Netflix");

  // 2. Verify Netflix subtitle detection, live observation, and rendering remain intact
  poc.instance.netflixAdapter.onCue({
    startTime: 12.0,
    endTime: 16.0,
    text: "Netflixセリフ１"
  });
  const overlayContainer = env.rootBody.querySelector("#ankiminer-video-overlay-container");
  assert.ok(overlayContainer, "Overlay container must exist on Netflix");
  assert.equal(overlayContainer.getAttribute("data-active-cue"), "Netflixセリフ１", "Netflix subtitle rendering must work");

  console.log("PASS: Netflix hotkey suppression verified (A/S/D/Space left to player; subtitle mining intact).");
}

// -------------------------------------------------------------
// Test 6: Dynamic Video Changes & Disconnection
// -------------------------------------------------------------
async function testDynamicVideoChanges() {
  const env = createMockEnvironment();
  const video1 = new env.MockVideoElement("video-1");
  env.rootBody.appendChild(video1);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.activeVideo, video1);

  poc.instance.syncEngine.setCues([
    { startTime: 10.0, endTime: 15.0, text: "ビデオ１字幕" }
  ]);
  video1.seek(12.0);

  // S operates on video1
  env.dispatchKeyEvent({ key: "s" });
  assert.equal(video1.currentTime, 10.0);

  // Dynamically replace video1 with video2
  env.rootBody.removeChild(video1);
  const video2 = new env.MockVideoElement("video-2");
  env.rootBody.appendChild(video2);
  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.activeVideo, video2);

  video2.seek(14.0);
  env.dispatchKeyEvent({ key: "s" });
  assert.equal(video2.currentTime, 10.0, "S must operate on the new active video");

  // Disconnect all videos
  env.rootBody.removeChild(video2);
  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.activeVideo, null);

  // Pressing hotkeys with no video must not throw errors
  env.dispatchKeyEvent({ key: "a" });
  env.dispatchKeyEvent({ key: "s" });
  env.dispatchKeyEvent({ key: "d" });
  env.dispatchKeyEvent({ key: " ", code: "Space" });

  console.log("PASS: Dynamic video transitions and safety verified.");
}

// -------------------------------------------------------------
// Test 7: Subtitle Timing Offset with Hotkeys
// -------------------------------------------------------------
async function testOffsetWithHotkeys() {
  const env = createMockEnvironment();
  const video = new env.MockVideoElement("video-offset");
  env.rootBody.appendChild(video);

  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
  poc.instance.detector.checkVideos();

  // Cue is at 10.0s, with offset +2.0s (Phase 8.3: positive offset means cue appears later):
  // Effective cue range: [10.0 + 2.0, 15.0 + 2.0] = [12.0s, 17.0s]
  poc.instance.syncEngine.setCues([
    { startTime: 10.0, endTime: 15.0, text: "オフセット字幕" }
  ]);
  poc.instance.syncEngine.setOffset(2.0);

  // Current video time at 13.0s -> inside effective cue range [12.0s, 17.0s]
  video.seek(13.0);
  assert.equal(poc.instance.syncEngine.currentCue?.text, "オフセット字幕");

  // Press S -> should seek to Math.max(0, startTime + offset) = 10.0 + 2.0 = 12.0s
  env.dispatchKeyEvent({ key: "s" });
  assert.equal(video.currentTime, 12.0, "Seeking with offset must account for offset");
  assert.equal(poc.instance.syncEngine.currentCue?.text, "オフセット字幕");

  console.log("PASS: Subtitle timing offset with hotkeys verified.");
}

async function runAllTests() {
  await testSubtitleNavigationHotkeys();
  await testPlayPauseHotkey();
  await testEditableAndModifierProtection();
  await testYouTubeHotkeyIntegration();
  await testNetflixHotkeyIntegration();
  await testDynamicVideoChanges();
  await testOffsetWithHotkeys();

  console.log("\n>>> ALL SUBTITLE HOTKEY TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAllTests().catch(err => {
  console.error("FAILED:", err);
  process.exit(1);
});
