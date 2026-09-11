const assert = require("node:assert/strict");
const path = require("node:path");

const NetflixModule = require(path.resolve(__dirname, "../content/adapters/netflix-adapter.js"));
const {
  isNetflixPage,
  containsJapanese,
  extractTextFromTimedtextElement,
  NetflixAdapter
} = NetflixModule;

console.log("Starting netflix-adapter tests...");

// 1. isNetflixPage
global.location = { hostname: "www.netflix.com" };
assert.equal(isNetflixPage(), true, "Should identify netflix.com");

global.location = { hostname: "youtube.com" };
assert.equal(isNetflixPage(), false, "Should reject non-netflix domain");

console.log("PASS: isNetflixPage verified.");

// 2. containsJapanese
assert.equal(containsJapanese("日本語の字幕"), true, "Kanji + Hiragana");
assert.equal(containsJapanese("カタカナ"), true, "Katakana");
assert.equal(containsJapanese("Hello World"), false, "English text");
assert.equal(containsJapanese("12345!"), false, "Digits/symbols");
assert.equal(containsJapanese("Episode 1: 運命の出会い"), true, "Mixed English and Japanese");

console.log("PASS: containsJapanese verified.");

// 3. extractTextFromTimedtextElement
const mockContainers = [
  { textContent: " 最初のセリフです。 " },
  { textContent: " 二行目のセリフです。 " }
];

const mockTimedtextEl = {
  querySelectorAll: (selector) => {
    if (selector === ".player-timedtext-text-container") {
      return mockContainers;
    }
    return [];
  },
  textContent: "fallback content"
};

const extracted = extractTextFromTimedtextElement(mockTimedtextEl);
assert.equal(extracted, "最初のセリフです。\n二行目のセリフです。");

const fallbackEl = {
  querySelectorAll: () => [],
  textContent: " 単一行のセリフ "
};
assert.equal(extractTextFromTimedtextElement(fallbackEl), "単一行のセリフ");

console.log("PASS: extractTextFromTimedtextElement verified.");

// 4. NetflixAdapter Integration with Mock DOM and MutationObserver
let observedCues = [];
let disconnected = false;

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe(_target, _options) {}
  disconnect() {
    disconnected = true;
  }
  trigger() {
    this.callback();
  }
}
global.MutationObserver = MockMutationObserver;

const mockStyleEl = { parentNode: { removeChild: () => {} } };
global.document = {
  getElementById: (id) => {
    if (id === "ankiminer-hide-netflix-captions") return mockStyleEl;
    return null;
  },
  querySelector: (sel) => {
    if (sel.includes("player-timedtext")) return mockTimedtextEl;
    return null;
  },
  head: { appendChild: () => {} },
  createElement: () => ({ id: "", textContent: "" }),
  body: {}
};

const mockVideo = { currentTime: 42.5 };
const adapter = new NetflixAdapter({
  video: mockVideo,
  onCue: (cue) => {
    observedCues.push(cue);
  }
});

global.location = { hostname: "www.netflix.com" };
adapter.init();

// Verify initial cue emission from existing DOM
assert.equal(observedCues.length, 1);
assert.equal(observedCues[0].text, "最初のセリフです。\n二行目のセリフです。");
assert.equal(observedCues[0].startTime, 42.5);
assert.equal(observedCues[0].isJapanese, true);

// Verify mutation trigger with new text
mockContainers[0].textContent = " 新しいセリフ ";
mockContainers.pop();
adapter.observer.trigger();

assert.equal(observedCues.length, 2);
assert.equal(observedCues[1].text, "新しいセリフ");

// Verify destroy
adapter.destroy();
assert.equal(disconnected, true, "Observer must be disconnected on destroy");

console.log("PASS: NetflixAdapter end-to-end integration verified.");
console.log("ALL NETFLIX ADAPTER TESTS PASSED!");
