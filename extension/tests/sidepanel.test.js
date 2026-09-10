const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = fs.existsSync("extension/sidepanel/sidepanel.html")
  ? "extension/sidepanel/sidepanel.html"
  : path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

// Verify required Phase 4 & 5 elements exist in the DOM
assert.ok(html.includes('id="field-deck-select"'), "Deck selector select must exist");
assert.ok(html.includes('id="sync-anki-btn"'), "Send to Anki button must exist");
assert.ok(html.includes('id="anki-sync-status"'), "Anki sync status label must exist");
assert.ok(html.includes('id="save-card-btn"'), "Save Card button must exist");
assert.ok(html.includes('id="field-deck-name"'), "Hidden deck name fallback input must exist");

// Phase 5 elements: Connection indicators, Japanese typography selector, Hero word display
assert.ok(html.includes('id="indicator-yomitan"'), "Yomitan connection indicator must exist");
assert.ok(html.includes('id="indicator-anki"'), "Anki connection indicator must exist");
assert.ok(html.includes('id="expression"'), "Prominent expression display element must exist");
assert.ok(html.includes('id="reading"'), "Prominent reading display element must exist");
assert.ok(html.includes('id="field-font-select"'), "Japanese font selector must exist");
assert.ok(html.includes('value="Noto Sans JP"'), "Noto Sans JP font option must exist");
assert.ok(html.includes('Noto Sans Japanese'), "Noto Sans Japanese label must exist");

// Verify default state
assert.ok(html.includes('<option value="Default">Default</option>'), "Default deck option must exist");
assert.ok(html.includes('id="sync-anki-btn" class="btn-sync" disabled'), "Sync button should start disabled");

console.log("sidepanel HTML tests passed (Phase 4 + Phase 5 DOM verified)");

// Verify updateSyncUI state machine
const vm = require("node:vm");
const jsPath = fs.existsSync("extension/sidepanel/sidepanel.js")
  ? "extension/sidepanel/sidepanel.js"
  : path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

const mockBtn = { disabled: true, textContent: "" };
const mockStatus = { title: "", textContent: "", className: "" };
const context = {
  syncAnkiBtn: mockBtn,
  ankiSyncStatus: mockStatus,
  ankiConnected: true,
};
const updateSyncUISrc = jsContent.slice(
  jsContent.indexOf("function updateSyncUI"),
  jsContent.indexOf("async function loadDecks")
);
vm.runInNewContext(updateSyncUISrc, context);
const { updateSyncUI } = context;

updateSyncUI("ready");
assert.equal(mockBtn.disabled, true);
assert.equal(mockBtn.textContent, "Send to Anki");
assert.equal(mockStatus.textContent, "Anki: Ready");

updateSyncUI("pending");
assert.equal(mockBtn.disabled, false);
assert.equal(mockBtn.textContent, "Send to Anki");
assert.equal(mockStatus.className, "sync-status-label pending");

updateSyncUI("syncing");
assert.equal(mockBtn.disabled, true);
assert.equal(mockBtn.textContent, "Sending…");
assert.equal(mockStatus.className, "sync-status-label syncing");

updateSyncUI("synced");
assert.equal(mockBtn.disabled, true);
assert.equal(mockBtn.textContent, "Sent to Anki");
assert.equal(mockStatus.className, "sync-status-label synced");

updateSyncUI("failed", "Timeout");
assert.equal(mockBtn.disabled, false);
assert.equal(mockBtn.textContent, "Retry Send to Anki");
assert.equal(mockStatus.className, "sync-status-label failed");
assert.equal(mockStatus.title, "Timeout");

console.log("sidepanel state machine tests passed");
