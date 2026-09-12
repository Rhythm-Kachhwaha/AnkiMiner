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

// Phase 6 elements: Note Type selector
assert.ok(html.includes('id="field-model-select"'), "Note Type selector select must exist");
assert.ok(html.includes('id="field-model-name"'), "Hidden model name input must exist");
assert.ok(html.includes('<option value="Basic">Basic</option>'), "Default Basic model option must exist");
assert.ok(html.includes('class="form-group model-selector-group"'), "Model selector container group must exist");

// Phase 7 elements: History and Card Library
assert.ok(html.includes('id="history-section"'), "History section must exist");
assert.ok(html.includes('id="history-count"'), "History card counter element must exist");
assert.ok(html.includes('id="history-search-input"'), "History search input must exist");
assert.ok(html.includes('id="history-deck-filter"'), "History deck filter select must exist");
assert.ok(html.includes('id="history-sync-filter"'), "History sync filter select must exist");
assert.ok(html.includes('id="history-list-container"'), "History list container must exist");
assert.ok(html.includes('id="history-empty"'), "History empty state message element must exist");
// Mode Navigation tabs & Decluttered Views
assert.ok(html.includes('id="tab-btn-text"'), "Text mining tab button must exist");
assert.ok(html.includes('id="tab-btn-video"'), "Video mining tab button must exist");
assert.ok(html.includes('id="text-mining-view"'), "Text mining view container must exist");
assert.ok(html.includes('id="video-mining-view"'), "Video mining view container must exist");
assert.ok(html.includes('id="clear-subtitles-btn"'), "Clear subtitles button must exist");

// Video Mining elements
assert.ok(html.includes('id="video-mining-section"'), "Video mining section must exist");
assert.ok(html.includes('id="load-subtitles-btn"'), "Load subtitles button must exist");
assert.ok(html.includes('id="subtitles-file-input"'), "Subtitles file input must exist");
assert.ok(html.includes('id="subtitles-file-status"'), "Subtitles file status badge must exist");
assert.ok(html.includes('id="video-track-select"'), "Video track selector must exist");
assert.ok(html.includes('id="offset-minus-btn"'), "Offset minus button must exist");
assert.ok(html.includes('id="offset-reset-btn"'), "Offset reset button must exist");
assert.ok(html.includes('id="offset-plus-btn"'), "Offset plus button must exist");
assert.ok(html.includes('id="offset-display"'), "Offset display element must exist");
assert.ok(html.includes('id="video-current-cue-preview"'), "Video current cue preview element must exist");
assert.ok(html.includes('id="toggle-auto-pause-hover"'), "Auto-pause on subtitle hover toggle must exist");
assert.ok(html.includes('<script src="../lib/subtitle-parser.js"></script>'), "Subtitle parser script must be loaded in sidepanel");

// Verify default state
assert.ok(html.includes('<option value="Default">Default</option>'), "Default deck option must exist");
assert.ok(html.includes('id="sync-anki-btn" class="btn-sync" disabled'), "Sync button should start disabled");

console.log("sidepanel HTML tests passed (Phase 4, 5, 6, 7 & Video Mining DOM verified)");

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

// Phase 7 Library helper tests
const mockDeckSelect = {
  options: [{ value: "Default", textContent: "Default" }],
  value: "all",
  append(opt) { this.options.push(opt); },
};
const mockFieldDeckSelect = {
  options: [{ value: "Default" }, { value: "Anime Mining" }],
};

const libContext = {
  document: {
    createElement(tag) {
      return {
        tag,
        className: "",
        dataset: {},
        textContent: "",
        title: "",
        children: [],
        setAttribute(k, v) { this[k] = v; },
        append(...els) { this.children.push(...els); },
        addEventListener(event, fn) { this["on" + event] = fn; },
        closest() { return null; },
      };
    },
  },
  historyDeckFilter: mockDeckSelect,
  fieldDeckSelect: mockFieldDeckSelect,
  historyCardsList: {
    children: [],
    replaceChildren() { this.children = []; },
    append(item) { this.children.push(item); },
  },
  selectedHistoryCardId: 42,
  API_CARD_SYNC_URL: (id) => `http://127.0.0.1:8000/api/cards/${id}/sync`,
  API_CARD_DETAIL_URL: (id) => `http://127.0.0.1:8000/api/cards/${id}`,
  openSavedCard: () => {},
  deleteLocalCard: () => {},
  retrySyncFromHistory: () => {},
};

const updateDeckFilterSrc = jsContent.slice(
  jsContent.indexOf("function updateDeckFilterOptions"),
  jsContent.indexOf("function renderHistoryCards")
);
vm.runInNewContext(updateDeckFilterSrc, libContext);
libContext.updateDeckFilterOptions([
  { deck_name: "Default" },
  { deck_name: "Japanese Vocab" },
]);

const deckValues = mockDeckSelect.options.map(o => o.value);
assert.ok(deckValues.includes("Default"), "Deck options should include Default");
assert.ok(deckValues.includes("Anime Mining"), "Deck options should include Anime Mining");
assert.ok(deckValues.includes("Japanese Vocab"), "Deck options should include Japanese Vocab");

// Test renderHistoryCards
const renderCardsSrc = jsContent.slice(
  jsContent.indexOf("function renderHistoryCards"),
  jsContent.indexOf("async function openSavedCard")
);
vm.runInNewContext(renderCardsSrc, libContext);
libContext.renderHistoryCards([
  { id: 42, expression: "映画", reading: "えいが", meaning: "movie", deck_name: "Default", sync_status: "synced" },
  { id: 43, expression: "本", reading: "ほん", meaning: "book", deck_name: "Default", sync_status: "failed", sync_error: "Connection refused" },
]);

assert.equal(libContext.historyCardsList.children.length, 2, "Should render 2 history card items");
const item1 = libContext.historyCardsList.children[0];
assert.ok(item1.className.includes("selected"), "Card 42 should be marked selected");
assert.equal(item1.dataset.cardId, "42");

const item2 = libContext.historyCardsList.children[1];
assert.ok(!item2.className.includes("selected"), "Card 43 should not be marked selected");
assert.equal(item2.dataset.cardId, "43");

// Verify failed card has retry button in actions
const actionsDiv = item2.children.find(c => c.className === "history-item-actions");
assert.ok(actionsDiv, "Item should contain actions div");
const retryBtn = actionsDiv.children.find(c => c.className === "btn-history-retry");
assert.ok(retryBtn, "Failed card should have a retry button");

console.log("sidepanel Phase 7 history & card library tests passed");
