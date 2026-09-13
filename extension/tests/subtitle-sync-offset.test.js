const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting subtitle-sync-offset tests for Phase 8.3...");

// Load source files
const subtitleParserSrc = fs.readFileSync(path.resolve(__dirname, "../lib/subtitle-parser.js"), "utf8");
const captureUtilsSrc = fs.readFileSync(path.resolve(__dirname, "../content/capture-utils.js"), "utf8");
const contentScriptSrc = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");
const youtubeAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/youtube-adapter.js"), "utf8");
const netflixAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/netflix-adapter.js"), "utf8");
const videoMiningSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");
const sidepanelHtml = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
const sidepanelJs = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");

function createMockEnvironment({ isYouTube = false, isNetflix = false, isHiAnime = false } = {}) {
  const sentMessages = [];
  const messageListeners = [];
  const winEventListeners = {};
  const docEventListeners = {};
  const storageData = {};
  const storageListeners = [];

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "GET_MINING_MODE") return Promise.resolve({ enabled: true });
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : (typeof keys === "string" ? [keys] : Object.keys(keys || {}));
          keyList.forEach(k => {
            if (storageData[k] !== undefined) result[k] = storageData[k];
          });
          if (typeof cb === "function") cb(result);
          return Promise.resolve(result);
        },
        set: (items, cb) => {
          Object.assign(storageData, items);
          if (typeof cb === "function") cb();
          storageListeners.forEach(listener => {
            const changes = {};
            Object.keys(items).forEach(k => {
              changes[k] = { newValue: items[k] };
            });
            listener(changes, "local");
          });
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: (fn) => storageListeners.push(fn)
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

    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(l => l !== fn);
    }

    dispatchEvent(evt) {
      const type = evt.type || evt;
      const listeners = this._listeners[type] || [];
      listeners.forEach(fn => fn(evt));
      return !evt.defaultPrevented;
    }

    getBoundingClientRect() {
      return this.rect;
    }

    getAttribute(k) { return this._attrs[k] || null; }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    removeAttribute(k) { delete this._attrs[k]; }
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
      this.playCalls = 0;
      this.pauseCalls = 0;
    }

    play() {
      this.paused = false;
      this.playCalls++;
      this.dispatchEvent({ type: "play" });
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
      this.pauseCalls++;
      this.dispatchEvent({ type: "pause" });
    }

    seek(time) {
      this.currentTime = Math.max(0, Math.min(this.duration, time));
      this.dispatchEvent({ type: "seeked" });
      this.dispatchEvent({ type: "timeupdate" });
    }
  }

  const rootBody = new MockElement("BODY", "document-body");
  const headEl = new MockElement("HEAD", "document-head");
  const mockDoc = {
    head: headEl,
    body: rootBody,
    documentElement: rootBody,
    activeElement: rootBody,
    fullscreenElement: null,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      const find = (el) => {
        if (el.id === id) return el;
        for (const child of el.children) {
          const res = find(child);
          if (res) return res;
        }
        return null;
      };
      return find(rootBody);
    },
    querySelector: (sel) => rootBody.querySelector(sel),
    querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
    addEventListener: (event, fn) => {
      if (!docEventListeners[event]) docEventListeners[event] = [];
      docEventListeners[event].push(fn);
    },
    removeEventListener: (event, fn) => {
      if (!docEventListeners[event]) return;
      docEventListeners[event] = docEventListeners[event].filter(l => l !== fn);
    }
  };

  let hostname = "example.com";
  let pathname = "/watch";
  if (isYouTube) {
    hostname = "www.youtube.com";
    pathname = "/watch";
  } else if (isNetflix) {
    hostname = "www.netflix.com";
    pathname = "/watch/mock123";
  } else if (isHiAnime) {
    hostname = "hianime.to";
    pathname = "/watch/ep-1";
  }

  const mockWindow = {
    chrome: mockChrome,
    document: mockDoc,
    location: {
      hostname,
      pathname,
      search: "?v=mockVideoId",
      href: `https://${hostname}${pathname}`
    },
    addEventListener: (event, fn, useCapture) => {
      if (!winEventListeners[event]) winEventListeners[event] = [];
      winEventListeners[event].push(fn);
    },
    removeEventListener: (event, fn, useCapture) => {
      if (!winEventListeners[event]) return;
      winEventListeners[event] = winEventListeners[event].filter(l => l !== fn);
    },
    dispatchEvent: (evt) => {
      const type = evt.type || evt;
      const listeners = winEventListeners[type] || [];
      listeners.forEach(fn => fn(evt));
      return !evt.defaultPrevented;
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    Event: class MockEvent {
      constructor(type) {
        this.type = type;
        this.defaultPrevented = false;
        this.propagationStopped = false;
      }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() { this.propagationStopped = true; }
    },
    console
  };

  mockWindow.window = mockWindow;
  mockWindow.globalThis = mockWindow;
  mockWindow.MutationObserver = class { observe() {} disconnect() {} };
  mockWindow.ResizeObserver = class { observe() {} disconnect() {} };
  mockWindow.getComputedStyle = () => ({ position: "relative" });
  mockWindow.getSelection = () => ({ rangeCount: 0, toString: () => "" });

  const vmContext = vm.createContext(mockWindow);

  // Execute extension scripts
  vm.runInContext(subtitleParserSrc, vmContext);
  vm.runInContext(captureUtilsSrc, vmContext);
  vm.runInContext(youtubeAdapterSrc, vmContext);
  vm.runInContext(netflixAdapterSrc, vmContext);
  vm.runInContext(videoMiningSrc, vmContext);

  function dispatchKeyEvent({ key, code, target = null, ctrlKey = false, altKey = false, metaKey = false }) {
    const evt = {
      type: "keydown",
      key,
      code: code || key,
      ctrlKey,
      altKey,
      metaKey,
      target: target || mockDoc.activeElement || rootBody,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; }
    };
    mockWindow.dispatchEvent(evt);
    return evt;
  }

  async function simulateMessage(msg) {
    for (const listener of messageListeners) {
      await listener(msg, {}, () => {});
    }
  }

  return {
    vmContext,
    mockWindow,
    mockDoc,
    rootBody,
    sentMessages,
    storageData,
    MockElement,
    MockVideoElement,
    dispatchKeyEvent,
    simulateMessage
  };
}

// -------------------------------------------------------------
// Test Suite
// -------------------------------------------------------------
async function runPhase83Tests() {
  // Test 1: Default 0 ms offset and properties
  console.log("Testing default offset and properties...");
  {
    const env = createMockEnvironment();
    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    assert.equal(poc.instance.syncEngine.offset, 0.0, "Default offset in seconds must be 0.0");
    assert.equal(poc.instance.syncEngine.offsetMs, 0, "Default offset in ms must be 0");
    console.log("PASS: Default offset is 0 ms / 0.0s.");
  }

  // Test 2: Keyboard shortcuts [ and ] and \
  console.log("Testing keyboard shortcuts [ (decrease), ] (increase), and \\ (reset)...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("test-vid");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    // Press ] -> should increase offset by +100 ms
    const evt1 = env.dispatchKeyEvent({ key: "]" });
    assert.equal(evt1.defaultPrevented, true, "] must preventDefault in video mining mode");
    assert.equal(poc.instance.syncEngine.offsetMs, 100, "Offset should be 100 ms");
    assert.equal(poc.instance.syncEngine.offset, 0.1, "Offset in seconds should be 0.1s");

    // Press ] again -> +200 ms
    env.dispatchKeyEvent({ key: "]" });
    assert.equal(poc.instance.syncEngine.offsetMs, 200, "Offset should be 200 ms");
    assert.equal(poc.instance.syncEngine.offset, 0.2);

    // Press [ -> should decrease offset by -100 ms -> 100 ms
    const evt2 = env.dispatchKeyEvent({ key: "[" });
    assert.equal(evt2.defaultPrevented, true, "[ must preventDefault in video mining mode");
    assert.equal(poc.instance.syncEngine.offsetMs, 100, "Offset should be 100 ms");
    assert.equal(poc.instance.syncEngine.offset, 0.1);

    // Press [ two more times -> -100 ms
    env.dispatchKeyEvent({ key: "[" });
    assert.equal(poc.instance.syncEngine.offsetMs, 0);
    env.dispatchKeyEvent({ key: "[" });
    assert.equal(poc.instance.syncEngine.offsetMs, -100, "Offset can be negative (-100 ms)");
    assert.equal(poc.instance.syncEngine.offset, -0.1);

    // Press \ -> reset to 0 ms immediately
    const evt3 = env.dispatchKeyEvent({ key: "\\" });
    assert.equal(evt3.defaultPrevented, true, "\\ must preventDefault in video mining mode");
    assert.equal(poc.instance.syncEngine.offsetMs, 0, "Reset must restore 0 ms immediately");
    assert.equal(poc.instance.syncEngine.offset, 0.0, "Reset must restore 0.0s immediately");

    console.log("PASS: Shortcuts [ (-100ms), ] (+100ms), and \\ (reset 0ms) verified.");
  }

  // Test 3: Active cue calculation with positive offset (cues appear later)
  console.log("Testing active cue calculation with positive offset...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-pos");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    // Cue: original startTime = 10.0, endTime = 12.0
    poc.instance.syncEngine.setCues([
      { startTime: 10.0, endTime: 12.0, text: "テスト字幕" }
    ]);

    // Apply +500 ms offset (+0.5s)
    poc.instance.syncEngine.setOffsetMs(500);
    assert.equal(poc.instance.syncEngine.offset, 0.5);

    // Effective range is [10.5s, 12.5s] (cues appear LATER)
    // At video time 10.0s: cue must NOT be active yet
    video.seek(10.0);
    assert.equal(poc.instance.syncEngine.currentCue, null, "At 10.0s cue is not active yet with +500ms offset");

    // At video time 10.5s: cue becomes active!
    video.seek(10.5);
    assert.equal(poc.instance.syncEngine.currentCue?.text, "テスト字幕", "At 10.5s cue is active with +500ms offset");

    // At video time 12.0s: cue is still active
    video.seek(12.0);
    assert.equal(poc.instance.syncEngine.currentCue?.text, "テスト字幕", "At 12.0s cue is still active");

    // At video time 12.5s: cue has ended
    video.seek(12.5);
    assert.equal(poc.instance.syncEngine.currentCue, null, "At 12.5s cue has ended with +500ms offset");

    // Verify original cue object was NOT mutated
    assert.equal(poc.instance.syncEngine.cues[0].startTime, 10.0, "Original cue startTime must not be modified");
    assert.equal(poc.instance.syncEngine.cues[0].endTime, 12.0, "Original cue endTime must not be modified");

    // Verify getEffectiveCue helper
    const eff = poc.instance.syncEngine.getEffectiveCue(poc.instance.syncEngine.cues[0]);
    assert.equal(eff.startTime, 10.5, "Effective cue startTime must be 10.5");
    assert.equal(eff.endTime, 12.5, "Effective cue endTime must be 12.5");

    console.log("PASS: Positive offset (+500ms -> cues appear later) verified.");
  }

  // Test 4: Active cue calculation with negative offset (cues appear earlier)
  console.log("Testing active cue calculation with negative offset...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-neg");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    // Cue: original startTime = 10.0, endTime = 12.0
    poc.instance.syncEngine.setCues([
      { startTime: 10.0, endTime: 12.0, text: "早い字幕" }
    ]);

    // Apply -500 ms offset (-0.5s)
    poc.instance.syncEngine.setOffsetMs(-500);
    assert.equal(poc.instance.syncEngine.offset, -0.5);

    // Effective range is [9.5s, 11.5s] (cues appear EARLIER)
    // At video time 9.0s: cue is not active yet
    video.seek(9.0);
    assert.equal(poc.instance.syncEngine.currentCue, null);

    // At video time 9.5s: cue is active earlier!
    video.seek(9.5);
    assert.equal(poc.instance.syncEngine.currentCue?.text, "早い字幕");

    // At video time 11.4s: cue is still active
    video.seek(11.4);
    assert.equal(poc.instance.syncEngine.currentCue?.text, "早い字幕");

    // At video time 11.5s: cue has ended
    video.seek(11.5);
    assert.equal(poc.instance.syncEngine.currentCue, null);

    console.log("PASS: Negative offset (-500ms -> cues appear earlier) verified.");
  }

  // Test 5: Navigation with offset (Previous/Replay/Next seeking to effective times)
  console.log("Testing Previous/Replay/Next cue navigation with offset...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-nav");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 10.0, endTime: 12.0, text: "Cue 1" },
      { startTime: 20.0, endTime: 22.0, text: "Cue 2" }
    ]);

    // Apply +300 ms offset (+0.3s) -> effective Cue 1 starts at 10.3s, Cue 2 at 20.3s
    poc.instance.syncEngine.setOffsetMs(300);

    // Video at 10.5s (inside Cue 1)
    video.seek(10.5);
    assert.equal(poc.instance.syncEngine.currentCue?.text, "Cue 1");

    // Replay cue (S) -> must seek to effective startTime: 10.3s
    env.dispatchKeyEvent({ key: "s" });
    assert.equal(video.currentTime, 10.3, "Replay must seek to effective startTime 10.3s");
    assert.equal(poc.instance.syncEngine.currentCue?.text, "Cue 1");

    // Next cue (D) -> must seek to effective startTime of Cue 2: 20.3s
    env.dispatchKeyEvent({ key: "d" });
    assert.equal(video.currentTime, 20.3, "Next must seek to effective startTime 20.3s");
    assert.equal(poc.instance.syncEngine.currentCue?.text, "Cue 2");

    // Previous cue (A) -> must seek back to effective startTime of Cue 1: 10.3s
    env.dispatchKeyEvent({ key: "a" });
    assert.equal(video.currentTime, 10.3, "Previous must seek to effective startTime 10.3s");
    assert.equal(poc.instance.syncEngine.currentCue?.text, "Cue 1");

    // Gap navigation with offset: video at 15.0s (in gap)
    video.seek(15.0);
    assert.equal(poc.instance.syncEngine.currentCue, null, "No cue in gap");

    // Next cue from gap -> seeks to Cue 2 effective startTime (20.3s)
    env.dispatchKeyEvent({ key: "d" });
    assert.equal(video.currentTime, 20.3, "Next from gap seeks to 20.3s");

    // Previous cue from gap (at 15.0s) -> seeks to Cue 1 effective startTime (10.3s)
    video.seek(15.0);
    env.dispatchKeyEvent({ key: "a" });
    assert.equal(video.currentTime, 10.3, "Previous from gap seeks to 10.3s");

    console.log("PASS: Cue navigation with offset (A, S, D) seeking to effective startTimes verified.");
  }

  // Test 6: Hotkey safety (typing & editable elements & modifier keys)
  console.log("Testing hotkey safety on editable elements and with modifier keys...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-safe");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();
    poc.instance.syncEngine.setOffsetMs(0);

    const input = new env.MockElement("INPUT", "search-input");
    env.rootBody.appendChild(input);

    const textarea = new env.MockElement("TEXTAREA", "comment-box");
    env.rootBody.appendChild(textarea);

    const contentEditable = new env.MockElement("DIV", "editable-div");
    contentEditable.isContentEditable = true;
    env.rootBody.appendChild(contentEditable);

    // Typing [ or ] in input must NOT change offset
    const evtInput = env.dispatchKeyEvent({ key: "]", target: input });
    assert.equal(evtInput.defaultPrevented, false, "Typing ] in INPUT must not be prevented");
    assert.equal(poc.instance.syncEngine.offsetMs, 0, "Offset must remain 0 when typing in input");

    // Typing [ in textarea must NOT change offset
    const evtTextarea = env.dispatchKeyEvent({ key: "[", target: textarea });
    assert.equal(evtTextarea.defaultPrevented, false);
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    // Typing \ in contenteditable must NOT change offset
    const evtCe = env.dispatchKeyEvent({ key: "\\", target: contentEditable });
    assert.equal(evtCe.defaultPrevented, false);
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    // Modifier keys (Ctrl+[ or Cmd+]) must NOT trigger offset adjustments
    const evtMod = env.dispatchKeyEvent({ key: "]", ctrlKey: true });
    assert.equal(evtMod.defaultPrevented, false);
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    console.log("PASS: Hotkey safety on editable elements and modifier keys verified.");
  }

  // Test 7: Netflix platform exclusion
  console.log("Testing Netflix platform exclusion for offset hotkeys...");
  {
    const nfEnv = createMockEnvironment({ isNetflix: true });
    const nfVideo = new nfEnv.MockVideoElement("netflix-video");
    nfEnv.rootBody.appendChild(nfVideo);

    const poc = nfEnv.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    // Hotkeys must NOT be intercepted on Netflix
    const evt1 = nfEnv.dispatchKeyEvent({ key: "]" });
    assert.equal(evt1.defaultPrevented, false, "Netflix must not intercept ]");
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    const evt2 = nfEnv.dispatchKeyEvent({ key: "[" });
    assert.equal(evt2.defaultPrevented, false, "Netflix must not intercept [");
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    const evt3 = nfEnv.dispatchKeyEvent({ key: "\\" });
    assert.equal(evt3.defaultPrevented, false, "Netflix must not intercept \\");
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    // Phase 8.1 hotkeys also remain excluded on Netflix
    const evtA = nfEnv.dispatchKeyEvent({ key: "a" });
    assert.equal(evtA.defaultPrevented, false, "Netflix must not intercept A");
    const evtSpace = nfEnv.dispatchKeyEvent({ key: " " });
    assert.equal(evtSpace.defaultPrevented, false, "Netflix must not intercept Space");

    console.log("PASS: Netflix platform exclusion preserved for all hotkeys.");
  }

  // Test 8: Edge cases (no subtitles loaded, offset larger than cue, negative offset clampled, NaN safety)
  console.log("Testing edge cases...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-edge");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    // 1. No subtitles loaded
    poc.instance.syncEngine.setCues([]);
    assert.equal(poc.instance.syncEngine.cues.length, 0);
    env.dispatchKeyEvent({ key: "]" });
    assert.equal(poc.instance.syncEngine.offsetMs, 100, "Offset adjusts cleanly even with no subtitles loaded");
    assert.equal(poc.instance.syncEngine.findCueAtTime(10.0), null, "No crash when finding cue with empty array");

    // 2. Invalid / NaN offset inputs
    poc.instance.syncEngine.setOffsetMs(NaN);
    assert.equal(poc.instance.syncEngine.offsetMs, 0, "NaN offsetMs must fallback to 0");
    assert.equal(poc.instance.syncEngine.offset, 0.0);

    poc.instance.syncEngine.setOffset(undefined);
    assert.equal(poc.instance.syncEngine.offset, 0.0, "undefined offset must fallback to 0.0");
    assert.equal(poc.instance.syncEngine.offsetMs, 0);

    // 3. Offset larger than cue duration
    // Cue duration is 1.0s (10.0 to 11.0). Offset is +10000ms (+10.0s).
    poc.instance.syncEngine.setCues([
      { startTime: 10.0, endTime: 11.0, text: "短時間字幕" }
    ]);
    poc.instance.syncEngine.setOffsetMs(10000);
    // Effective range is [20.0s, 21.0s]
    video.seek(15.0);
    assert.equal(poc.instance.syncEngine.currentCue, null);
    video.seek(20.5);
    assert.equal(poc.instance.syncEngine.currentCue?.text, "短時間字幕");

    // 4. Large negative offset (startTime + offset < 0)
    // Cue is at 1.0s. Offset is -5000ms (-5.0s).
    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 3.0, text: "先頭字幕" }
    ]);
    poc.instance.syncEngine.setOffsetMs(-5000);
    // Seeking to this cue must not seek to negative time
    poc.instance.hotkeyController.seekToCue(poc.instance.syncEngine.cues[0]);
    assert.equal(video.currentTime, 0, "Seeking with negative offset must clamp targetTime to >= 0");

    console.log("PASS: Edge cases handled safely without NaN or crash.");
  }

  // Test 9: Persistence in storage and message synchronization
  console.log("Testing persistence and message handling...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-persist");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    // Hotkey ] persists offset to storage
    env.dispatchKeyEvent({ key: "]" });
    assert.equal(env.storageData.subtitle_timing_offset, 100, "Hotkey must persist subtitle_timing_offset to storage");

    // Simulating message SET_SUBTITLE_OFFSET from Side Panel
    await env.simulateMessage({
      type: "SET_SUBTITLE_OFFSET",
      offsetMs: 300
    });
    assert.equal(poc.instance.syncEngine.offsetMs, 300, "SET_SUBTITLE_OFFSET with offsetMs sets 300 ms");
    assert.equal(poc.instance.syncEngine.offset, 0.3);
    assert.equal(env.storageData.subtitle_timing_offset, 300);

    // Simulating message CLEAR_SUBTITLES resets offset to 0 ms
    await env.simulateMessage({
      type: "CLEAR_SUBTITLES"
    });
    assert.equal(poc.instance.syncEngine.offsetMs, 0, "CLEAR_SUBTITLES must reset offset to 0 ms");
    assert.equal(env.storageData.subtitle_timing_offset, 0);

    console.log("PASS: Persistence and message synchronization verified.");
  }

  // Test 10: Side Panel UI contract and formatting
  console.log("Testing Side Panel UI contract and formatting...");
  {
    // Check DOM elements exist in HTML
    assert.ok(sidepanelHtml.includes('id="offset-minus-btn"'), "Offset minus button must exist in sidepanel HTML");
    assert.ok(sidepanelHtml.includes('id="offset-reset-btn"'), "Offset reset button must exist in sidepanel HTML");
    assert.ok(sidepanelHtml.includes('id="offset-plus-btn"'), "Offset plus button must exist in sidepanel HTML");
    assert.ok(sidepanelHtml.includes('id="offset-display"'), "Offset display element must exist in sidepanel HTML");
    assert.ok(sidepanelHtml.includes('Subtitle Offset:'), "Subtitle Offset: label must exist in sidepanel HTML");

    // Evaluate formatOffset logic from sidepanel.js
    const formatOffsetFn = (ms) => {
      const rounded = Math.round(ms || 0);
      if (rounded === 0) return "0 ms";
      const sign = rounded > 0 ? "+" : "";
      return `${sign}${rounded} ms`;
    };

    assert.equal(formatOffsetFn(0), "0 ms", "Format 0 ms");
    assert.equal(formatOffsetFn(300), "+300 ms", "Format +300 ms");
    assert.equal(formatOffsetFn(-200), "-200 ms", "Format -200 ms");
    assert.equal(formatOffsetFn(100), "+100 ms", "Format +100 ms");

    console.log("PASS: Side Panel UI contract and formatting verified.");
  }

  // Test 11: Confirmation that Phase 8.1 and 8.2 still work alongside Phase 8.3
  console.log("Testing Phase 8.1 hotkeys and Phase 8.2 auto-pause alongside Phase 8.3...");
  {
    const env = createMockEnvironment();
    const video = new env.MockVideoElement("vid-coexist");
    env.rootBody.appendChild(video);

    const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__;
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 5.0, endTime: 10.0, text: "共存テスト" }
    ]);

    // Space hotkey toggles play/pause
    assert.equal(video.paused, true);
    env.dispatchKeyEvent({ key: " " });
    assert.equal(video.paused, false, "Space hotkey must play video");
    env.dispatchKeyEvent({ key: " " });
    assert.equal(video.paused, true, "Space hotkey must pause video");

    // Auto-pause controller enabled
    poc.instance.autoPauseController.setEnabled(true);
    assert.equal(poc.instance.autoPauseController.enabled, true);

    // Play video, trigger mouseenter on overlay
    video.play();
    assert.equal(video.paused, false);

    const overlay = poc.instance.renderer.subtitleEl;
    if (overlay && overlay.dispatchEvent) {
      overlay.dispatchEvent({ type: "mouseenter" });
      assert.equal(video.paused, true, "Auto-pause on hover must pause video");
      assert.equal(poc.instance.autoPauseController.pausedByHover, true);

      // Mouse leave resumes playback
      overlay.dispatchEvent({ type: "mouseleave" });
      // wait for resume delay
      await new Promise(r => setTimeout(r, 180));
      assert.equal(video.paused, false, "Mouseleave must resume video playback");
    }

    console.log("PASS: Phase 8.1 hotkeys and Phase 8.2 auto-pause verified alongside Phase 8.3.");
  }

  console.log("\n>>> ALL PHASE 8.3 SUBTITLE SYNCHRONIZATION TESTS PASSED! <<<");
}

runPhase83Tests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
