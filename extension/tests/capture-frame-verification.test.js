const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 1. Verify manifest.json configuration
const manifestPath = path.resolve(__dirname, "../manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.ok(manifest.content_scripts && manifest.content_scripts.length > 0, "content_scripts must be defined");
const contentScript = manifest.content_scripts[0];

assert.equal(contentScript.all_frames, true, "content_scripts must have all_frames: true");
assert.equal(contentScript.match_about_blank, true, "content_scripts must have match_about_blank: true");
assert.ok(contentScript.matches.includes("<all_urls>"), "content_scripts must match <all_urls>");
console.log("PASS: Manifest configuration for all_frames and match_about_blank verified.");

// Load scripts
const captureUtilsSrc = fs.readFileSync(path.resolve(__dirname, "../content/capture-utils.js"), "utf8");
const contentScriptSrc = fs.readFileSync(path.resolve(__dirname, "../content/content.js"), "utf8");

// Helper to create a mock window/document environment
function createMockEnvironment({ isIframe = false, iframeId = null } = {}) {
  const sentMessages = [];
  const messageListeners = [];
  const eventListeners = {};

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
        addListener: (fn) => messageListeners.push(fn),
      },
    },
  };

  let currentSelection = "";

  const mockDocument = {
    addEventListener: (event, handler) => {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(handler);
    },
    dispatchEvent: (event) => {
      const handlers = eventListeners[event.type] || [];
      handlers.forEach((h) => h(event));
    },
  };

  const mockWindow = {
    getSelection: () => ({
      rangeCount: currentSelection ? 1 : 0,
      toString: () => currentSelection,
    }),
    isIframe,
    iframeId,
  };

  const context = {
    chrome: mockChrome,
    window: mockWindow,
    document: mockDocument,
    globalThis: {},
    Boolean,
    Promise,
    setTimeout,
  };
  context.globalThis = context;
  context.window.globalThis = context;

  // Run capture-utils
  vm.runInNewContext(captureUtilsSrc, context);
  // Run content.js
  vm.runInNewContext(contentScriptSrc, context);

  return {
    context,
    sentMessages,
    setSelection: (text) => {
      currentSelection = text;
    },
    triggerMouseUp: () => {
      mockDocument.dispatchEvent({ type: "mouseup" });
    },
  };
}

// 2. Verify normal top-level site capture (e.g. YouTube, Netflix, Web pages)
async function testNormalSiteCapture() {
  const topPage = createMockEnvironment({ isIframe: false });
  topPage.setSelection("映画を見よう");
  topPage.triggerMouseUp();

  // Allow microtasks to resolve
  await new Promise((r) => setTimeout(r, 20));

  const captureMsg = topPage.sentMessages.find((m) => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "Top-level page (YouTube/Netflix) must capture Japanese text");
  assert.equal(captureMsg.text, "映画を見よう");
  console.log("PASS: Top-level page selection capture verified.");
}

// 3. Verify HiAnime + ASBPlayer iframe capture (.asbplayer-subtitles in asbplayer-ui-frame)
async function testAsbplayerIframeCapture() {
  const asbIframe = createMockEnvironment({
    isIframe: true,
    iframeId: "asbplayer-ui-frame",
  });

  // Locally loaded subtitle selected inside .asbplayer-subtitles in asbplayer-ui-frame
  const subtitleText = "逃げるな！生きる方が戦いだ！";
  asbIframe.setSelection(subtitleText);
  asbIframe.triggerMouseUp();

  await new Promise((r) => setTimeout(r, 20));

  const captureMsg = asbIframe.sentMessages.find((m) => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "ASBPlayer iframe inside HiAnime must capture subtitle text");
  assert.equal(captureMsg.text, subtitleText);
  console.log("PASS: HiAnime + ASBPlayer iframe (.asbplayer-subtitles) capture verified.");
}

(async () => {
  await testNormalSiteCapture();
  await testAsbplayerIframeCapture();
  console.log("ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
})();
