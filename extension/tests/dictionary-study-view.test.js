const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 1. Verify HTML DOM elements
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="dict-actions-bar"'), "dict-actions-bar element must exist in sidepanel.html");
assert.ok(html.includes('id="btn-copy-raw-dict"'), "btn-copy-raw-dict button must exist in sidepanel.html");
assert.ok(html.includes('id="btn-toggle-full-dict"'), "btn-toggle-full-dict button must exist in sidepanel.html");
assert.ok(html.includes('id="dict-raw-view"'), "dict-raw-view container must exist in sidepanel.html");
assert.ok(html.includes('id="meanings"'), "meanings container must exist in sidepanel.html");

console.log("PASS: Dictionary HTML DOM structure verified.");

// 2. Test formatRawDictionaryText and renderDetails logic in sidepanel.js
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

// Mock DOM elements
function createMockElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    tag,
    className: "",
    textContent: "",
    title: "",
    hidden: false,
    style: {},
    children: [],
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    append(...els) {
      this.children.push(...els);
    },
    replaceChildren(...els) {
      this.children = [...els];
    },
    addEventListener(event, fn) {
      this["on" + event] = fn;
    },
  };
}

const mockMeanings = createMockElement("div");
const mockDictRawView = createMockElement("div");
const mockDictActionsBar = createMockElement("div");
const mockBtnCopy = createMockElement("button");
const mockBtnToggle = createMockElement("button");
const mockExamples = createMockElement("div");

const mockDocument = {
  createElement(tag) {
    return createMockElement(tag);
  },
  querySelector(selector) {
    if (selector === "#meanings") return mockMeanings;
    if (selector === "#dict-raw-view") return mockDictRawView;
    if (selector === "#dict-actions-bar") return mockDictActionsBar;
    if (selector === "#btn-copy-raw-dict") return mockBtnCopy;
    if (selector === "#btn-toggle-full-dict") return mockBtnToggle;
    if (selector === "#examples") return mockExamples;
    return createMockElement("div");
  },
};

// Clipboard mock
let copiedClipboardText = "";
const mockNavigator = {
  clipboard: {
    writeText: async (text) => {
      copiedClipboardText = text;
      return true;
    },
  },
};

const sandbox = {
  document: mockDocument,
  navigator: mockNavigator,
  meanings: mockMeanings,
  dictRawView: mockDictRawView,
  dictActionsBar: mockDictActionsBar,
  btnCopyRawDict: mockBtnCopy,
  btnToggleFullDict: mockBtnToggle,
  examples: mockExamples,
  currentDictionaryEntries: [],
  setTimeout: (fn) => fn(),
  console,
};

// Extract the dictionary logic functions
const dictCodeSlice = jsContent.slice(
  jsContent.indexOf("function add(parent"),
  jsContent.indexOf("async function identify(text)")
);

vm.runInNewContext(dictCodeSlice, sandbox);

const { formatRawDictionaryText, renderDetails, clearDictionaryView } = sandbox;

// Test formatRawDictionaryText
const sampleEntries = [
  {
    dictionary: "Jitendex",
    is_primary: true,
    term: "映画",
    reading: "えいが",
    parts_of_speech: ["noun"],
    tags: ["common"],
    senses: [
      {
        glosses: ["movie", "film"],
        tags: [],
        notes: ["standard term"],
        examples: [
          { japanese: "映画を見る", translation: "to watch a movie" },
        ],
      },
    ],
  },
  {
    dictionary: "JMdict",
    is_primary: false,
    term: "映画",
    reading: "えいが",
    parts_of_speech: ["noun"],
    tags: [],
    senses: [
      {
        glosses: ["motion picture", "picture"],
        tags: [],
        notes: [],
        examples: [],
      },
    ],
  },
];

const formatted = formatRawDictionaryText(sampleEntries);
assert.ok(formatted.includes("=== Jitendex (Primary) ==="), "Formatted text must include primary dictionary header");
assert.ok(formatted.includes("Term: 映画 [えいが]"), "Formatted text must include term and reading");
assert.ok(formatted.includes("POS: noun"), "Formatted text must include POS");
assert.ok(formatted.includes("1. movie; film"), "Formatted text must include glosses");
assert.ok(formatted.includes("映画を見る : to watch a movie"), "Formatted text must include example sentence");
assert.ok(formatted.includes("=== JMdict ==="), "Formatted text must include second dictionary");
console.log("PASS: formatRawDictionaryText verified.");

// Test renderDetails: Clean Study View
renderDetails({ entries: sampleEntries });

// Check dict-actions-bar is displayed
assert.equal(mockDictActionsBar.style.display, "flex", "dict-actions-bar should be displayed when entries exist");

// Check clean study view in #meanings
assert.ok(mockMeanings.children.length > 0, "meanings should contain clean study view elements");
const studyHeader = mockMeanings.children.find(c => c.className === "study-dict-header");
assert.ok(studyHeader, "study header should exist");
const dictPill = studyHeader.children.find(c => c.className === "dict-source-pill");
assert.equal(dictPill.textContent, "Jitendex", "Primary dict pill should show Jitendex");
const primaryBadge = studyHeader.children.find(c => c.className.includes("primary-badge"));
assert.ok(primaryBadge, "Primary badge should exist");
const countPill = studyHeader.children.find(c => c.className === "dict-count-pill");
assert.ok(countPill, "More dicts count pill should exist");
assert.equal(countPill.textContent, "+1 more dict", "Should report +1 more dict");

// Check POS badges
const posRow = mockMeanings.children.find(c => c.className === "study-pos-row");
assert.ok(posRow, "POS row should exist");
assert.equal(posRow.children.length, 1, "POS should be deduplicated (both were 'noun')");
assert.equal(posRow.children[0].textContent, "noun");

// Check senses list
const sensesList = mockMeanings.children.find(c => c.className === "study-senses-list");
assert.ok(sensesList, "Senses list should exist");
assert.equal(sensesList.children.length, 2, "Should have 2 senses");

// Check collapsible examples accordion
const examplesAccordion = mockMeanings.children.find(c => c.className === "study-examples-accordion");
assert.ok(examplesAccordion, "Examples accordion should exist");
const summary = examplesAccordion.children.find(c => c.className === "study-examples-summary");
assert.equal(summary.textContent, "Examples (1)", "Accordion summary should show count");
const examplesList = examplesAccordion.children.find(c => c.className === "study-examples-list");
assert.equal(examplesList.children.length, 1, "Should contain 1 example card");
const egCard = examplesList.children[0];
const jaP = egCard.children.find(c => c.className === "study-example-ja");
assert.equal(jaP.textContent, "映画を見る");

console.log("PASS: Clean Study View rendering, deduplication, and examples accordion verified.");

// Test raw view rendering into #dict-raw-view
assert.ok(mockDictRawView.children.length === 2, "Raw view should contain 2 articles (one per dictionary)");
assert.equal(mockDictRawView.hidden, true, "Raw view should start hidden");

// Test toggle button
assert.equal(mockBtnToggle.textContent, "Full Dict");
mockBtnToggle.onclick();
assert.equal(mockDictRawView.hidden, false, "Clicking toggle should unhide raw view");
assert.equal(mockMeanings.hidden, true, "Clicking toggle should hide study view");
assert.equal(mockBtnToggle.textContent, "Study View", "Button text should change to Study View");

mockBtnToggle.onclick();
assert.equal(mockDictRawView.hidden, true, "Clicking toggle again should hide raw view");
assert.equal(mockMeanings.hidden, false, "Clicking toggle again should show study view");
assert.equal(mockBtnToggle.textContent, "Full Dict", "Button text should revert to Full Dict");

console.log("PASS: Full Dictionary toggle behavior verified.");

// Test copy button
mockBtnCopy.onclick();
assert.ok(copiedClipboardText.includes("=== Jitendex (Primary) ==="), "Copy button should write raw text to clipboard");

console.log("PASS: Copy raw dictionary button verified.");

// Test clearDictionaryView
clearDictionaryView();
assert.equal(mockMeanings.children.length, 0, "meanings should be empty after clear");
assert.equal(mockDictRawView.children.length, 0, "dictRawView should be empty after clear");
assert.equal(mockDictActionsBar.style.display, "none", "dictActionsBar should be hidden after clear");

console.log("PASS: clearDictionaryView verified.");

console.log(">>> ALL DICTIONARY STUDY VIEW TESTS PASSED! <<<");
