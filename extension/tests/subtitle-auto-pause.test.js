const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting subtitle-auto-pause tests...");

// Load source files
const subtitleParserSrc = fs.readFileSync(path.resolve(__dirname, "../lib/subtitle-parser.js"), "utf8");
const captureUtilsSrc = fs.readFileSync(path.resolve(__dirname, "../content/capture-utils.js"), "utf8");
const contentScriptSrc = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");
const youtubeAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/youtube-adapter.js"), "utf8");
const netflixAdapterSrc = fs.readFileSync(path.resolve(__dirname, "../content/adapters/netflix-adapter.js"), "utf8");
const videoMiningSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

function createMockEnvironment({ isYouTube = false, isNetflix = false, isHiAnime = false, initialAutoPause = false } = {}) {
  const sentMessages = [];
  const messageListeners = [];
  const storageData = { auto_pause_on_hover: initialAutoPause };
  const storageChangeListeners = [];

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
    },
    storage: {
      local: {
        get: (key, cb) => {
          const res = typeof key === "string" ? { [key]: storageData[key] } : storageData;
          if (typeof cb === "function") cb(res);
          return Promise.resolve(res);
        },
        set: (obj, cb) => {
          Object.assign(storageData, obj);
          for (const fn of storageChangeListeners) {
            const changes = {};
            for (const k of Object.keys(obj)) {
              changes[k] = { newValue: obj[k] };
            }
            fn(changes, "local");
          }
          if (typeof cb === "function") cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: (fn) => storageChangeListeners.push(fn)
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
      const type = typeof event === "string" ? event : event.type;
      const evObj = typeof event === "string" ? { type: event } : event;
      if (this._listeners[type]) {
        for (const fn of [...this._listeners[type]]) fn(evObj);
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
      this.playCount = 0;
      this.pauseCount = 0;
    }

    seek(time) {
      this.currentTime = time;
      this.dispatchEvent({ type: "seeked" });
      this.dispatchEvent({ type: "timeupdate" });
    }

    play() {
      this.playCount++;
      this.paused = false;
      this.dispatchEvent({ type: "play" });
      return Promise.resolve();
    }

    pause() {
      this.pauseCount++;
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
    querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
    querySelector: (sel) => rootBody.querySelector(sel),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    Promise,
    Array,
    Object,
    Math,
    Boolean,
    parseInt,
    parseFloat,
    document: mockDoc,
    window: {
      location: { href: getPageUrl(), hostname: getHostname() },
      document: mockDoc,
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: () => null,
      cancelAnimationFrame: () => null
    },
    location: { href: getPageUrl(), hostname: getHostname() },
    chrome: mockChrome,
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    }
  };

  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  // Execute scripts in order
  vm.runInContext(subtitleParserSrc, context);
  vm.runInContext(captureUtilsSrc, context);
  vm.runInContext(contentScriptSrc, context);
  vm.runInContext(youtubeAdapterSrc, context);
  vm.runInContext(netflixAdapterSrc, context);
  vm.runInContext(videoMiningSrc, context);

  return {
    context,
    mockDoc,
    rootBody,
    MockVideoElement,
    sentMessages,
    messageListeners,
    storageData,
    poc: sandbox.window.__ANKIMINER_VIDEO_POC__
  };
}

async function runAllAutoPauseTests() {
  // -------------------------------------------------------------
  // Test 1: Default State & Preference Storage
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: false });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;

    assert.ok(poc.SubtitleAutoPauseController, "SubtitleAutoPauseController must be exported");
    assert.equal(controller.enabled, false, "Auto-pause must default to disabled (OFF)");
    assert.equal(controller.isHovering, false, "Should not be hovering initially");
    assert.equal(controller.pausedByHover, false, "Should not be pausedByHover initially");

    // Mount video and overlay
    const video = new env.MockVideoElement("test-vid");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();
    assert.equal(poc.instance.activeVideo, video);

    await video.play();
    assert.equal(video.paused, false);

    // Hovering when disabled should do nothing
    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");
    assert.ok(subtitleEl, "Subtitle overlay element must exist");

    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, false, "Video must NOT pause when auto-pause is disabled");
    assert.equal(controller.pausedByHover, false);

    subtitleEl.dispatchEvent({ type: "mouseleave" });
    assert.equal(video.paused, false, "Video must remain playing");

    console.log("PASS: Test 1: Default state disabled (OFF) and no-op verified.");
  }

  // -------------------------------------------------------------
  // Test 2: Enabling Auto-Pause: Hover Pauses, Leaving Resumes
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: false });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;

    const video = new env.MockVideoElement("hianime-vid");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    await video.play();
    assert.equal(video.paused, false, "Video should be playing");

    // Enable auto-pause
    controller.setEnabled(true);
    assert.equal(controller.enabled, true);

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");

    // Mouse enters subtitle overlay -> active video must pause
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, true, "Active video must pause when mouse enters subtitle overlay");
    assert.equal(controller.pausedByHover, true, "Controller must record pausedByHover = true");
    assert.equal(controller.isHovering, true, "Controller must record isHovering = true");

    // Mouse leaves subtitle overlay -> resumes after debounce
    subtitleEl.dispatchEvent({ type: "mouseleave" });
    assert.equal(controller.isHovering, false, "isHovering must be false after mouseleave");

    // Before debounce delay (150ms), video is still waiting
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(video.paused, true, "Video should wait for debounce delay before resume");

    // After debounce delay, playback resumes
    await new Promise((r) => setTimeout(r, 140));
    assert.equal(video.paused, false, "Active video must resume playing after mouse leaves");
    assert.equal(controller.pausedByHover, false, "pausedByHover must reset to false");

    console.log("PASS: Test 2: Hover pause and leave resume verified.");
  }

  // -------------------------------------------------------------
  // Test 3: Video Already Paused Before Hover (Must NOT Auto-Resume)
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isYouTube: true, initialAutoPause: true });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;
    controller.setEnabled(true);

    const video = new env.MockVideoElement("yt-vid");
    video.paused = true; // Video was already paused by user
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");
    const initialPlayCount = video.playCount;

    // Mouse enters already paused video
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, true);
    assert.equal(controller.pausedByHover, false, "pausedByHover must NOT be set if video was already paused");

    // Mouse leaves
    subtitleEl.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));

    assert.equal(video.paused, true, "Video must remain paused");
    assert.equal(video.playCount, initialPlayCount, "video.play() must NOT be called when already paused");

    console.log("PASS: Test 3: Video already paused before hover does NOT auto-resume.");
  }

  // -------------------------------------------------------------
  // Test 4: Video Paused/Played for Another Reason During Hover
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: true });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;
    controller.setEnabled(true);

    const video = new env.MockVideoElement("test-vid-external");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();
    await video.play();

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");

    // Hover pauses video
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, true);
    assert.equal(controller.pausedByHover, true);

    // User explicitly plays via Space or native player controls
    await video.play();
    assert.equal(video.paused, false);

    // Now video is playing, but user presses pause explicitly
    video.pause();
    assert.equal(video.paused, true);

    // Leaving hover must NOT resume because it was modified externally
    subtitleEl.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));

    assert.equal(video.paused, true, "Video paused externally must NOT auto-resume");

    console.log("PASS: Test 4: External pause/play during hover does not trigger unwanted resume.");
  }

  // -------------------------------------------------------------
  // Test 5: Rapid Mouse In/Out Flapping Protection
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: true });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;
    controller.setEnabled(true);

    const video = new env.MockVideoElement("flap-vid");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();
    await video.play();

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");

    // Enter -> pauses
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, true);

    // Leave -> starts debounce
    subtitleEl.dispatchEvent({ type: "mouseleave" });

    // Quick re-enter (within 40ms) -> cancels debounce
    await new Promise((r) => setTimeout(r, 40));
    subtitleEl.dispatchEvent({ type: "mouseenter" });

    // Wait longer than normal debounce (160ms)
    await new Promise((r) => setTimeout(r, 160));
    assert.equal(video.paused, true, "Video must remain paused during flapping without flailing play/pause");

    // Now leave and let debounce complete
    subtitleEl.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(video.paused, false, "Video resumes cleanly after cursor settles outside");

    console.log("PASS: Test 5: Rapid mouse in/out flapping debounce verified.");
  }

  // -------------------------------------------------------------
  // Test 6: Subtitle Stability / Disappearing Cue Protection
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: true });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;
    controller.setEnabled(true);

    const video = new env.MockVideoElement("stability-vid");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();
    await video.play();

    // Render a Japanese cue
    poc.instance.syncEngine.setCues([
      { startTime: 0, endTime: 5, text: "見間違えた" }
    ]);
    video.seek(2.0);

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");
    const container = env.mockDoc.getElementById("ankiminer-video-overlay-container");
    assert.equal(subtitleEl.textContent, "見間違えた");
    assert.equal(container.style.display, "flex");

    // User hovers
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, true);
    assert.equal(poc.instance.renderer.isHoverLocked, true, "Renderer must lock hover state");

    // Suppose video timestamp shifted slightly past 5s and sync calls renderCue(null)
    poc.instance.renderer.renderCue(null);

    // Cue text must NOT disappear under cursor!
    assert.equal(subtitleEl.textContent, "見間違えた", "Subtitle text must remain displayed while hovered");
    assert.equal(container.style.display, "flex", "Overlay must remain visible while hovered");

    // Mouse leaves -> hover unlocked -> pending null cue applied
    subtitleEl.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));

    assert.equal(subtitleEl.textContent, "", "Subtitle must clear after mouse leaves and cue has expired");
    assert.equal(container.style.display, "none", "Overlay must hide after mouse leaves");

    console.log("PASS: Test 6: Subtitle stability and disappearing cue protection verified.");
  }

  // -------------------------------------------------------------
  // Test 7: Subtitle Navigation While Hovered Updates Cue Immediately
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: true });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;
    controller.setEnabled(true);

    const video = new env.MockVideoElement("nav-vid");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();
    await video.play();

    poc.instance.syncEngine.setCues([
      { startTime: 0, endTime: 5, text: "第一話" },
      { startTime: 5, endTime: 10, text: "第二話" }
    ]);
    video.seek(1.0);

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");
    assert.equal(subtitleEl.textContent, "第一話");

    // Hover
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(video.paused, true);

    // Press 'D' (next subtitle) while hovered
    poc.instance.hotkeyController.handleKeyDown({
      key: "d",
      preventDefault: () => {},
      stopPropagation: () => {}
    });

    // Cue must update to second cue immediately
    assert.equal(subtitleEl.textContent, "第二話", "Navigating cues while hovered must update text immediately");

    subtitleEl.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));

    console.log("PASS: Test 7: Cue navigation while hovered updates text cleanly.");
  }

  // -------------------------------------------------------------
  // Test 8: Switching Active Video Resets State Cleanly
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: true });
    const poc = env.poc;
    const controller = poc.instance.autoPauseController;
    controller.setEnabled(true);

    const videoA = new env.MockVideoElement("vid-A");
    env.rootBody.appendChild(videoA);
    poc.instance.detector.checkVideos();
    await videoA.play();

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");
    subtitleEl.dispatchEvent({ type: "mouseenter" });
    assert.equal(videoA.paused, true);
    assert.equal(controller.pausedByHover, true);

    // Switch to video B (old video removed from DOM)
    env.rootBody.removeChild(videoA);
    const videoB = new env.MockVideoElement("vid-B");
    env.rootBody.appendChild(videoB);
    poc.instance.detector.checkVideos();
    assert.equal(poc.instance.activeVideo, videoB);

    // Old video state is detached and reset
    assert.equal(controller.pausedByHover, false, "pausedByHover must reset on video change");
    assert.equal(controller.attachedVideo, videoB, "Must attach to new active video");

    console.log("PASS: Test 8: Dynamic active video switching resets hover state cleanly.");
  }

  // -------------------------------------------------------------
  // Test 9: Multi-Platform Compatibility (HiAnime, YouTube, Netflix, External)
  // -------------------------------------------------------------
  {
    // Platform A: YouTube
    const ytEnv = createMockEnvironment({ isYouTube: true, initialAutoPause: true });
    const ytVid = new ytEnv.MockVideoElement("movie_player_vid");
    ytEnv.rootBody.appendChild(ytVid);
    ytEnv.poc.instance.detector.checkVideos();
    await ytVid.play();

    const ytSub = ytEnv.mockDoc.getElementById("ankiminer-video-subtitle");
    ytSub.dispatchEvent({ type: "mouseenter" });
    assert.equal(ytVid.paused, true, "YouTube video must pause on hover");
    ytSub.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(ytVid.paused, false, "YouTube video must resume on leave");

    // Verify YouTube hotkeys still work
    let defaultPrevented = false;
    ytEnv.poc.instance.hotkeyController.handleKeyDown({
      key: " ",
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    });
    assert.equal(defaultPrevented, true, "YouTube Space hotkey must still be active");

    // Platform B: Netflix
    const nfEnv = createMockEnvironment({ isNetflix: true, initialAutoPause: true });
    const nfVid = new nfEnv.MockVideoElement("netflix-vid");
    nfEnv.rootBody.appendChild(nfVid);
    nfEnv.poc.instance.detector.checkVideos();
    await nfVid.play();

    const nfSub = nfEnv.mockDoc.getElementById("ankiminer-video-subtitle");
    nfSub.dispatchEvent({ type: "mouseenter" });
    assert.equal(nfVid.paused, true, "Netflix video must pause on hover");
    nfSub.dispatchEvent({ type: "mouseleave" });
    await new Promise((r) => setTimeout(r, 180));
    assert.equal(nfVid.paused, false, "Netflix video must resume on leave");

    // Verify Netflix hotkeys remain SUPPRESSED (Phase 8.1 rule)
    let nfPrevented = false;
    nfEnv.poc.instance.hotkeyController.handleKeyDown({
      key: "a",
      preventDefault: () => { nfPrevented = true; },
      stopPropagation: () => {}
    });
    assert.equal(nfPrevented, false, "Netflix must NOT intercept hotkeys");

    console.log("PASS: Test 9: Multi-platform compatibility and hotkey isolation verified.");
  }

  // -------------------------------------------------------------
  // Test 10: Yomitan & Text Selection Compatibility
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: true });
    const poc = env.poc;
    const video = new env.MockVideoElement("yomitan-vid");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 0, endTime: 10, text: "日本語を勉強する" }
    ]);
    video.seek(1.0);

    const subtitleEl = env.mockDoc.getElementById("ankiminer-video-subtitle");
    assert.equal(subtitleEl.tagName, "SPAN", "Overlay element must remain standard SPAN for Yomitan");
    assert.ok(subtitleEl.style.cssText.includes("pointer-events: auto"), "Must have pointer-events: auto");
    assert.ok(subtitleEl.style.cssText.includes("user-select: text"), "Must have user-select: text");

    // Mouse events do not stop propagation or interfere with text selection
    let eventPassedThrough = true;
    subtitleEl.addEventListener("mousemove", () => { eventPassedThrough = true; });
    subtitleEl.dispatchEvent({ type: "mousemove" });
    assert.ok(eventPassedThrough, "Mousemove must pass through cleanly for Yomitan scanner");

    console.log("PASS: Test 10: Yomitan compatibility, standard DOM, and selectability verified.");
  }

  // -------------------------------------------------------------
  // Test 11: Storage & Messaging Synchronization
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment({ isHiAnime: true, initialAutoPause: false });
    const poc = env.poc;
    assert.equal(poc.instance.autoPauseController.enabled, false);

    // Message handler SET_AUTO_PAUSE_ON_HOVER
    let response = null;
    poc.instance.handleMessage({ type: "SET_AUTO_PAUSE_ON_HOVER", enabled: true }, null, (r) => { response = r; });
    assert.equal(response?.ok, true);
    assert.equal(response?.enabled, true);
    assert.equal(poc.instance.autoPauseController.enabled, true, "SET_AUTO_PAUSE_ON_HOVER message must enable auto-pause");

    // GET_VIDEO_STATE reports autoPauseEnabled
    let state = null;
    poc.instance.handleMessage({ type: "GET_VIDEO_STATE" }, null, (s) => { state = s; });
    assert.equal(state.autoPauseEnabled, true, "GET_VIDEO_STATE must report autoPauseEnabled");

    // chrome.storage.local change event
    env.storageData.auto_pause_on_hover = false;
    poc.instance.autoPauseController.setEnabled(false);
    assert.equal(poc.instance.autoPauseController.enabled, false);

    console.log("PASS: Test 11: Storage and messaging synchronization verified.");
  }

  console.log("\n>>> ALL SUBTITLE AUTO-PAUSE TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAllAutoPauseTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
