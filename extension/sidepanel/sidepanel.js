const API_CAPTURE_URL = "http://127.0.0.1:8000/api/capture";
const API_SAVE_URL = "http://127.0.0.1:8000/api/cards/save";
const API_ANKI_STATUS_URL = "http://127.0.0.1:8000/api/anki/status";
const API_ANKI_DECKS_URL = "http://127.0.0.1:8000/api/anki/decks";
const API_ANKI_MODELS_URL = "http://127.0.0.1:8000/api/anki/models";
const API_CARD_SYNC_URL = (id) => `http://127.0.0.1:8000/api/cards/${id}/sync`;
const API_CARDS_URL = "http://127.0.0.1:8000/api/cards";
const API_CARD_DETAIL_URL = (id) => `http://127.0.0.1:8000/api/cards/${id}`;

const toggle = document.querySelector("#mining-toggle");
const mode = document.querySelector("#mode");
const sessionCountEl = document.querySelector("#session-count");
const status = document.querySelector("#capture-status");
const saveBadge = document.querySelector("#save-badge");
const expression = document.querySelector("#expression");
const reading = document.querySelector("#reading");
const meanings = document.querySelector("#meanings");
const examples = document.querySelector("#examples");
const dictActionsBar = document.querySelector("#dict-actions-bar");
const btnCopyRawDict = document.querySelector("#btn-copy-raw-dict");
const btnToggleFullDict = document.querySelector("#btn-toggle-full-dict");
const dictRawView = document.querySelector("#dict-raw-view");
let currentDictionaryEntries = [];

// Indicators
const indicatorYomitan = document.querySelector("#indicator-yomitan");
const indicatorAnki = document.querySelector("#indicator-anki");

// Card Editor elements
const cardEditor = document.querySelector("#card-editor");
const fieldCardId = document.querySelector("#field-card-id");
const fieldDeckName = document.querySelector("#field-deck-name");
const fieldDeckSelect = document.querySelector("#field-deck-select");
const fieldModelName = document.querySelector("#field-model-name");
const fieldModelSelect = document.querySelector("#field-model-select");
const fieldFontSelect = document.querySelector("#field-font-select");
const fieldSourceText = document.querySelector("#field-source-text");
const fieldDeinflectedText = document.querySelector("#field-deinflected-text");
const fieldExpression = document.querySelector("#field-expression");
const fieldReading = document.querySelector("#field-reading");
const fieldMeaning = document.querySelector("#field-meaning");
const toggleOptionalBtn = document.querySelector("#toggle-optional");
const optionalFields = document.querySelector("#optional-fields");
const fieldHint = document.querySelector("#field-hint");
const fieldExampleSentence = document.querySelector("#field-example-sentence");
const fieldExampleTranslation = document.querySelector("#field-example-translation");
const fieldImage = document.querySelector("#field-image");
const fieldAudio = document.querySelector("#field-audio");
const fieldTags = document.querySelector("#field-tags");
const fieldNotes = document.querySelector("#field-notes");
const saveCardBtn = document.querySelector("#save-card-btn");
const syncAnkiBtn = document.querySelector("#sync-anki-btn");
const ankiSyncStatus = document.querySelector("#anki-sync-status");

// Media preview elements
const mediaPreviewContainer = document.querySelector("#media-preview-container");
const imagePreviewContainer = document.querySelector("#image-preview-container");
const imagePreview = document.querySelector("#image-preview");
const imageEmptyPlaceholder = document.querySelector("#image-empty-placeholder");
const btnClearImage = document.querySelector("#btn-clear-image");
const audioPreviewContainer = document.querySelector("#audio-preview-container");
const audioPreview = document.querySelector("#audio-preview");
const audioEmptyPlaceholder = document.querySelector("#audio-empty-placeholder");
const audioPlaceholderText = document.querySelector("#audio-placeholder-text");
const audioStatusBadge = document.querySelector("#audio-status-badge");
const btnReplayAudio = document.querySelector("#btn-replay-audio");
const btnClearAudio = document.querySelector("#btn-clear-audio");

// History & Card Library elements
const historySection = document.querySelector("#history-section");
const historyCount = document.querySelector("#history-count");
const historySearchInput = document.querySelector("#history-search-input");
const historyDeckFilter = document.querySelector("#history-deck-filter");
const historySyncFilter = document.querySelector("#history-sync-filter");
const historyListContainer = document.querySelector("#history-list-container");
const historyEmpty = document.querySelector("#history-empty");
const historyCardsList = document.querySelector("#history-cards-list");

// Navigation tab elements
const tabBtnText = document.querySelector("#tab-btn-text");
const tabBtnVideo = document.querySelector("#tab-btn-video");
const textMiningView = document.querySelector("#text-mining-view");
const videoMiningView = document.querySelector("#video-mining-view");

// Video Mining elements
const videoMiningSection = document.querySelector("#video-mining-section");
const subtitlesFileStatus = document.querySelector("#subtitles-file-status");
const loadSubtitlesBtn = document.querySelector("#load-subtitles-btn");
const clearSubtitlesBtn = document.querySelector("#clear-subtitles-btn");
const subtitlesFileInput = document.querySelector("#subtitles-file-input");
const videoTrackSelect = document.querySelector("#video-track-select");
const offsetMinusBtn = document.querySelector("#offset-minus-btn");
const offsetResetBtn = document.querySelector("#offset-reset-btn");
const offsetPlusBtn = document.querySelector("#offset-plus-btn");
const offsetDisplay = document.querySelector("#offset-display");
const videoCurrentCuePreview = document.querySelector("#video-current-cue-preview");
const toggleAutoPauseHover = document.querySelector("#toggle-auto-pause-hover");
const toggleAutoCaptureFrame = document.querySelector("#toggle-auto-capture-frame");
const toggleAutoCaptureAudio = document.querySelector("#toggle-auto-capture-audio");

let currentSubtitleOffsetMs = 0;
let currentSubtitleOffset = 0.0;
let loadedSubtitlesFilename = "";
let availableCaptionTracks = [];
let lastCaptureSource = { tabId: null, frameId: null };
let currentActiveCue = null;

let selectedHistoryCardId = null;
let searchDebounceTimeout = null;

let miningMode = false;
let currentCaptureId = 0;
let sessionCardCount = 0;
let ankiConnected = false;
let currentDraftMedia = {
  imageBase64: null,
  audioBase64: null,
  audioStatus: "idle", // "available" | "pending" | "unavailable" | "expired" | "discontinuity" | "idle"
  audioError: null,
  mimeType: null,
  captureId: null
};

function setIndicatorStatus(indicatorEl, state, titleText) {
  if (!indicatorEl) return;
  indicatorEl.className = `indicator-pill ${state}`;
  if (titleText) indicatorEl.title = titleText;
}

function updateSyncUI(state, error = "") {
  if (!ankiSyncStatus || !syncAnkiBtn) return;
  ankiSyncStatus.title = error || "";

  switch (state) {
    case "ready":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Ready";
      ankiSyncStatus.className = "sync-status-label";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      break;
    case "not_connected":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Not connected";
      ankiSyncStatus.className = "sync-status-label";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
      break;
    case "pending":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Pending";
      ankiSyncStatus.className = "sync-status-label pending";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, ankiConnected ? "connected" : "unavailable", ankiConnected ? "Anki: Connected" : "Anki: Not connected");
      break;
    case "syncing":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Sending…";
      ankiSyncStatus.textContent = "Anki: Syncing…";
      ankiSyncStatus.className = "sync-status-label syncing";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "checking", "Anki: Syncing…");
      break;
    case "synced":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Sent to Anki";
      ankiSyncStatus.textContent = "Anki: Synced";
      ankiSyncStatus.className = "sync-status-label synced";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      break;
    case "failed":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Retry Send to Anki";
      ankiSyncStatus.textContent = "Anki: Failed — retry";
      ankiSyncStatus.className = "sync-status-label failed";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, "unavailable", error ? `Anki error: ${error}` : "Anki: Failed");
      break;
    default:
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = ankiConnected ? "Anki: Ready" : "Anki: Not connected";
      ankiSyncStatus.className = "sync-status-label";
      if (typeof setIndicatorStatus === "function") setIndicatorStatus(indicatorAnki, ankiConnected ? "connected" : "unavailable", ankiConnected ? "Anki: Connected" : "Anki: Not connected");
  }
}

async function loadDecks() {
  try {
    setIndicatorStatus(indicatorAnki, "checking", "Anki: Checking connection…");
    const res = await fetch(API_ANKI_DECKS_URL);
    const data = await res.json().catch(() => ({}));
    ankiConnected = Boolean(data.connected);
    const decks = Array.isArray(data.decks) && data.decks.length ? data.decks : ["Default"];

    if (ankiConnected) {
      setIndicatorStatus(indicatorAnki, "connected", "Anki: Connected");
      if (ankiSyncStatus && ankiSyncStatus.textContent === "Anki: Not connected") {
        ankiSyncStatus.textContent = "Anki: Ready";
      }
    } else {
      setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
    }

    if (fieldDeckSelect) {
      const currentSelected = fieldDeckSelect.value;
      fieldDeckSelect.replaceChildren();
      decks.forEach(deck => {
        const opt = document.createElement("option");
        opt.value = deck;
        opt.textContent = deck;
        fieldDeckSelect.append(opt);
      });

      // Restore last used deck if available
      let lastDeck = "";
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("last_used_deck");
          lastDeck = stored?.last_used_deck;
        } else if (typeof localStorage !== "undefined") {
          lastDeck = localStorage.getItem("last_used_deck");
        }
      } catch (_) {}

      const targetDeck = currentSelected || lastDeck || "Default";
      if (decks.includes(targetDeck)) {
        fieldDeckSelect.value = targetDeck;
      }
      if (fieldDeckName) fieldDeckName.value = fieldDeckSelect.value;
    }
  } catch (_) {
    ankiConnected = false;
    setIndicatorStatus(indicatorAnki, "unavailable", "Anki: Not connected");
  }
}

async function loadModels() {
  try {
    const res = await fetch(API_ANKI_MODELS_URL);
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data.models) && data.models.length ? data.models : ["Basic"];

    if (fieldModelSelect) {
      const currentSelected = fieldModelSelect.value;
      fieldModelSelect.replaceChildren();
      models.forEach(model => {
        const opt = document.createElement("option");
        opt.value = model;
        opt.textContent = model;
        fieldModelSelect.append(opt);
      });

      // Restore last used / preferred note type if available
      let preferredModel = "";
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("preferred_anki_model");
          preferredModel = stored?.preferred_anki_model;
        } else if (typeof localStorage !== "undefined") {
          preferredModel = localStorage.getItem("preferred_anki_model");
        }
      } catch (_) {}

      const targetModel = currentSelected || preferredModel || models[0] || "Basic";
      if (models.includes(targetModel)) {
        fieldModelSelect.value = targetModel;
      }
      if (fieldModelName) fieldModelName.value = fieldModelSelect.value;
      loadModelCapabilities(fieldModelSelect.value).catch(() => {});
    }
  } catch (_) {
    if (fieldModelSelect && !fieldModelSelect.options.length) {
      const opt = document.createElement("option");
      opt.value = "Basic";
      opt.textContent = "Basic";
      fieldModelSelect.append(opt);
    }
  }
}

let currentModelCapabilities = {
  supports_image: true,
  supports_audio: true,
  supports_sentence: true
};

async function loadModelCapabilities(modelName) {
  try {
    const url = modelName
      ? `http://127.0.0.1:8000/api/anki/model-capabilities?model_name=${encodeURIComponent(modelName)}`
      : `http://127.0.0.1:8000/api/anki/model-capabilities`;
    const res = await fetch(url);
    if (res.ok) {
      const caps = await res.json();
      currentModelCapabilities = {
        supports_image: Boolean(caps.supports_image),
        supports_audio: Boolean(caps.supports_audio),
        supports_sentence: Boolean(caps.supports_sentence)
      };
      updateModelCapabilityWarnings();
    }
  } catch (_) {}
}

function updateModelCapabilityWarnings() {
  if (btnRetakeImage) {
    if (!currentModelCapabilities.supports_image && ankiConnected) {
      btnRetakeImage.title = "Selected Anki model lacks image field (saved locally only)";
    }
  }
  if (btnRetakeAudio) {
    if (!currentModelCapabilities.supports_audio && ankiConnected) {
      btnRetakeAudio.title = "Selected Anki model lacks audio field (saved locally only)";
    }
  }
}

// Japanese Font Selection handling
function applyJapaneseFont(fontFamily) {
  let fontStack = "var(--font-noto-sans)";
  if (fontFamily === "Noto Serif JP") {
    fontStack = "var(--font-noto-serif)";
  } else if (fontFamily === "system-ui") {
    fontStack = "var(--font-system)";
  }
  document.documentElement.style.setProperty("--japanese-font", fontStack);
}

async function loadFontPreference() {
  let savedFont = "Noto Sans JP";
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("preferred_japanese_font");
      if (stored?.preferred_japanese_font) savedFont = stored.preferred_japanese_font;
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("preferred_japanese_font");
      if (stored) savedFont = stored;
    }
  } catch (_) {}

  if (fieldFontSelect) {
    fieldFontSelect.value = savedFont;
  }
  applyJapaneseFont(savedFont);
}

if (fieldFontSelect) {
  fieldFontSelect.addEventListener("change", () => {
    const val = fieldFontSelect.value;
    applyJapaneseFont(val);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({preferred_japanese_font: val});
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("preferred_japanese_font", val);
      }
    } catch (_) {}
  });
}

if (fieldDeckSelect) {
  fieldDeckSelect.addEventListener("change", () => {
    const val = fieldDeckSelect.value;
    if (fieldDeckName) fieldDeckName.value = val;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({last_used_deck: val});
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("last_used_deck", val);
      }
    } catch (_) {}
  });
}

if (fieldModelSelect) {
  fieldModelSelect.addEventListener("change", () => {
    const val = fieldModelSelect.value;
    if (fieldModelName) fieldModelName.value = val;
    loadModelCapabilities(val).catch(() => {});
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({preferred_anki_model: val});
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("preferred_anki_model", val);
      }
    } catch (_) {}
  });
}

// Keep live hero display synced as user edits expression or reading
if (fieldExpression) {
  fieldExpression.addEventListener("input", () => {
    if (expression) expression.textContent = fieldExpression.value || "—";
  });
}

if (fieldReading) {
  fieldReading.addEventListener("input", () => {
    if (reading) reading.textContent = fieldReading.value || "";
  });
}

function updateSessionCounter() {
  if (sessionCountEl) {
    sessionCountEl.textContent = `Cards this session: ${sessionCardCount}`;
  }
}

function formatErrorMessage(error, defaultMsg = "Backend unavailable.") {
  if (!error) return defaultMsg;
  if (error.message === "Failed to fetch" || error.name === "TypeError") {
    return "Cannot connect to backend. Ensure FastAPI server is running on http://127.0.0.1:8000";
  }
  return error.message || defaultMsg;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function updateMiningUI(enabled) {
  miningMode = enabled;
  toggle.setAttribute("aria-pressed", String(enabled));
  toggle.textContent = enabled ? "Stop mining" : "Start mining";
  mode.textContent = enabled
    ? "Mining mode is on. Select Japanese text on the page."
    : "Mining mode is off.";
}

async function setMiningMode(enabled) {
  updateMiningUI(enabled);
  const result = await chrome.runtime.sendMessage({type: "SET_MINING_MODE", enabled});
  if (!result?.ok) {
    setStatus(result?.error || "Capture setup failed.", true);
  }
}

function add(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function formatRawDictionaryText(entries) {
  if (!Array.isArray(entries) || !entries.length) return "";
  const lines = [];
  entries.forEach((entry, eIdx) => {
    lines.push(`=== ${entry.dictionary || "Dictionary"}${entry.is_primary ? " (Primary)" : ""} ===`);
    if (entry.term || entry.reading) {
      lines.push(`Term: ${entry.term || ""}${entry.reading ? ` [${entry.reading}]` : ""}`);
    }
    if (entry.parts_of_speech && entry.parts_of_speech.length) {
      lines.push(`POS: ${entry.parts_of_speech.join(", ")}`);
    }
    if (entry.tags && entry.tags.length) {
      lines.push(`Tags: ${entry.tags.join(", ")}`);
    }
    if (entry.senses && entry.senses.length) {
      lines.push("Senses:");
      entry.senses.forEach((sense, sIdx) => {
        const glosses = (sense.glosses || []).join("; ");
        lines.push(`  ${sIdx + 1}. ${glosses}`);
        if (sense.notes && sense.notes.length) {
          lines.push(`     Notes: ${sense.notes.join("; ")}`);
        }
        if (sense.examples && sense.examples.length) {
          lines.push("     Examples:");
          sense.examples.forEach(eg => {
            lines.push(`       - ${eg.japanese}${eg.translation ? ` : ${eg.translation}` : ""}`);
          });
        }
      });
    }
    if (eIdx < entries.length - 1) lines.push("");
  });
  return lines.join("\n");
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const success = document.execCommand("copy");
    document.body.removeChild(ta);
    return success;
  } catch (e) {
    return false;
  }
}

function clearDictionaryView() {
  if (meanings) {
    meanings.replaceChildren();
    meanings.hidden = false;
  }
  if (examples) examples.replaceChildren();
  if (dictRawView) {
    dictRawView.replaceChildren();
    dictRawView.hidden = true;
  }
  if (dictActionsBar) dictActionsBar.style.display = "none";
  if (btnToggleFullDict) {
    btnToggleFullDict.textContent = "Full Dict";
    btnToggleFullDict.title = "Show full unabridged dictionary";
  }
  currentDictionaryEntries = [];
}

function renderDetails(body) {
  clearDictionaryView();
  const entries = Array.isArray(body?.entries) ? body.entries : [];
  currentDictionaryEntries = entries;
  if (!entries.length) return;

  if (dictActionsBar) dictActionsBar.style.display = "flex";

  // 1. Clean Study View rendered into #meanings
  if (meanings) {
    const primaryEntry = entries.find(e => e.is_primary) || entries[0];

    // Primary Attribution Header
    const header = document.createElement("div");
    header.className = "study-dict-header";

    const dictPill = document.createElement("span");
    dictPill.className = "dict-source-pill";
    dictPill.textContent = primaryEntry.dictionary || "Dictionary";
    header.append(dictPill);

    if (primaryEntry.is_primary) {
      const primaryBadge = document.createElement("span");
      primaryBadge.className = "badge primary-badge";
      primaryBadge.textContent = "Primary";
      header.append(primaryBadge);
    }

    if (entries.length > 1) {
      const moreCount = entries.length - 1;
      const countPill = document.createElement("span");
      countPill.className = "dict-count-pill";
      countPill.textContent = `+${moreCount} more dict${moreCount > 1 ? "s" : ""}`;
      header.append(countPill);
    }
    meanings.append(header);

    // Compact Deduplicated POS Badges
    const allPos = [];
    const seenPos = new Set();
    entries.forEach(e => {
      (e.parts_of_speech || []).forEach(pos => {
        const trimmed = (pos || "").trim();
        if (trimmed && !seenPos.has(trimmed.toLowerCase())) {
          seenPos.add(trimmed.toLowerCase());
          allPos.push(trimmed);
        }
      });
    });

    if (allPos.length) {
      const posRow = document.createElement("div");
      posRow.className = "study-pos-row";
      allPos.forEach(pos => {
        add(posRow, "span", pos, "study-pos-badge");
      });
      meanings.append(posRow);
    }

    // Numbered, Deduplicated Senses & Collected Examples
    const seenSenseKeys = new Set();
    const uniqueSenses = [];
    const allExamples = [];

    for (const entry of entries) {
      for (const sense of (entry.senses || [])) {
        const distinctGlosses = [];
        const seenInSense = new Set();
        for (const g of (sense.glosses || [])) {
          const norm = (g || "").trim().toLowerCase();
          if (norm && !seenInSense.has(norm)) {
            seenInSense.add(norm);
            distinctGlosses.push(g.trim());
          }
        }
        if (!distinctGlosses.length) continue;

        const senseKey = distinctGlosses.map(g => g.toLowerCase()).sort().join("|");
        if (!seenSenseKeys.has(senseKey)) {
          seenSenseKeys.add(senseKey);
          uniqueSenses.push({
            glosses: distinctGlosses,
            tags: sense.tags || [],
            notes: sense.notes || []
          });
        }

        if (sense.examples && sense.examples.length) {
          for (const eg of sense.examples) {
            if (eg.japanese && !allExamples.some(x => x.japanese === eg.japanese)) {
              allExamples.push(eg);
            }
          }
        }
      }
    }

    if (uniqueSenses.length) {
      const ol = document.createElement("ol");
      ol.className = "study-senses-list";
      uniqueSenses.forEach((sense, index) => {
        const li = document.createElement("li");
        li.className = "study-sense-item";

        if (uniqueSenses.length > 1) {
          add(li, "span", `${index + 1}.`, "study-sense-num");
        }

        const bodyDiv = document.createElement("div");
        bodyDiv.className = "study-sense-body";
        add(bodyDiv, "span", sense.glosses.join("; "), "study-glosses");

        if (sense.notes?.length) {
          sense.notes.forEach(note => add(bodyDiv, "p", note, "study-sense-note"));
        }
        li.append(bodyDiv);
        ol.append(li);
      });
      meanings.append(ol);
    }

    // Collapsible Examples Accordion (collapsed by default)
    if (allExamples.length) {
      const details = document.createElement("details");
      details.className = "study-examples-accordion";

      const summary = document.createElement("summary");
      summary.className = "study-examples-summary";
      summary.textContent = `Examples (${allExamples.length})`;
      details.append(summary);

      const listDiv = document.createElement("div");
      listDiv.className = "study-examples-list";
      allExamples.forEach(eg => {
        const card = document.createElement("div");
        card.className = "study-example-card";
        add(card, "p", eg.japanese, "study-example-ja");
        if (eg.translation) {
          add(card, "p", eg.translation, "study-example-en");
        }
        listDiv.append(card);
      });
      details.append(listDiv);
      meanings.append(details);
    }
  }

  // 2. Full Raw Unabridged Output rendered into #dict-raw-view
  if (dictRawView) {
    for (const entry of entries) {
      const block = document.createElement("article");
      block.className = "raw-dictionary-entry";

      const headerDiv = document.createElement("div");
      headerDiv.className = "raw-entry-header";
      add(headerDiv, "h3", entry.dictionary || "Dictionary");
      if (entry.is_primary) {
        const primaryBadge = document.createElement("span");
        primaryBadge.className = "badge primary-badge";
        primaryBadge.textContent = "Primary";
        primaryBadge.style.fontSize = "10px";
        headerDiv.append(primaryBadge);
      }
      block.append(headerDiv);

      if (entry.parts_of_speech?.length) {
        const metaContainer = document.createElement("div");
        metaContainer.className = "meta";
        entry.parts_of_speech.forEach(pos => {
          add(metaContainer, "span", pos, "pos-tag");
        });
        block.append(metaContainer);
      }

      (entry.senses || []).forEach((sense, index) => {
        const section = document.createElement("section");
        section.className = "sense";
        if ((entry.senses || []).length > 1) {
          add(section, "p", `SENSE ${index + 1}`, "sense-label");
        }
        if (sense.glosses?.length) {
          const list = document.createElement("ul");
          sense.glosses.forEach(gloss => add(list, "li", gloss));
          section.append(list);
        }
        sense.notes?.forEach(note => add(section, "p", note, "note"));
        sense.examples?.forEach(example => {
          const egCard = document.createElement("div");
          egCard.className = "example-card";
          add(egCard, "p", example.japanese, "example");
          if (example.translation) add(egCard, "p", example.translation, "translation");
          section.append(egCard);
        });
        block.append(section);
      });
      dictRawView.append(block);
    }
  }
}

if (btnCopyRawDict) {
  btnCopyRawDict.addEventListener("click", async () => {
    const rawText = formatRawDictionaryText(currentDictionaryEntries);
    if (!rawText) return;
    const ok = await copyTextToClipboard(rawText);
    if (ok) {
      const origText = btnCopyRawDict.textContent;
      btnCopyRawDict.textContent = "Copied! ✓";
      btnCopyRawDict.classList.add("copied");
      setTimeout(() => {
        btnCopyRawDict.textContent = origText;
        btnCopyRawDict.classList.remove("copied");
      }, 1500);
    }
  });
}

if (btnToggleFullDict) {
  btnToggleFullDict.addEventListener("click", () => {
    if (!dictRawView || !meanings) return;
    const isShowingRaw = !dictRawView.hidden;
    if (isShowingRaw) {
      dictRawView.hidden = true;
      meanings.hidden = false;
      btnToggleFullDict.textContent = "Full Dict";
      btnToggleFullDict.title = "Show full unabridged dictionary";
    } else {
      dictRawView.hidden = false;
      meanings.hidden = true;
      btnToggleFullDict.textContent = "Study View";
      btnToggleFullDict.title = "Show compact study view";
    }
  });
}

async function identify(text) {
  const capturedText = typeof text === "string" ? text.trim() : "";
  if (!capturedText) return;
  const requestId = ++currentCaptureId;
  setStatus("Identifying selection…");
  setIndicatorStatus(indicatorYomitan, "checking", "Yomitan: Identifying…");
  if (saveBadge) {
    saveBadge.hidden = true;
    saveBadge.className = "badge";
    saveBadge.textContent = "";
  }
  expression.textContent = "—";
  reading.textContent = "";
  clearDictionaryView();
  clearAllMedia();

  try {
    const response = await fetch(API_CAPTURE_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: capturedText, auto_save: false}),
    });
    const body = await response.json().catch(() => ({}));
    if (requestId !== currentCaptureId) return;
    if (!response.ok) {
      const cause = response.status === 503
        ? "Backend/Yomitan unavailable"
        : response.status === 422
          ? "Invalid capture request"
          : "Backend request failed";
      setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Unavailable");
      throw new Error(`${cause}: ${body.detail || response.statusText}`);
    }

    setIndicatorStatus(indicatorYomitan, "connected", "Yomitan: Connected");

    // Populate prominent hero elements
    expression.textContent = body.expression || "—";
    reading.textContent = body.reading || "";
    renderDetails(body);

    // Populate Card Editor form
    if (cardEditor) {
      cardEditor.hidden = false;
      if (fieldCardId) fieldCardId.value = body.id || "";
      if (fieldDeckSelect && body.deck_name) {
        fieldDeckSelect.value = body.deck_name;
      }
      if (fieldDeckName) fieldDeckName.value = (fieldDeckSelect && fieldDeckSelect.value) || body.deck_name || "Default";
      if (fieldModelSelect && body.model_name) {
        let hasOption = Array.from(fieldModelSelect.options).some(o => o.value === body.model_name);
        if (!hasOption) {
          const opt = document.createElement("option");
          opt.value = body.model_name;
          opt.textContent = body.model_name;
          fieldModelSelect.append(opt);
        }
        fieldModelSelect.value = body.model_name;
      }
      if (fieldModelName) fieldModelName.value = (fieldModelSelect && fieldModelSelect.value) || body.model_name || "";
      if (fieldSourceText) fieldSourceText.value = body.source_text || "";
      if (fieldDeinflectedText) fieldDeinflectedText.value = body.deinflected_text || "";
      if (fieldExpression) fieldExpression.value = body.expression || "";
      if (fieldReading) fieldReading.value = body.reading || "";
      if (fieldMeaning) fieldMeaning.value = body.meaning || "";
      if (fieldHint) fieldHint.value = body.hint || "";
      if (fieldExampleSentence) fieldExampleSentence.value = body.example_sentence || "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = body.example_translation || "";
      if (fieldImage) fieldImage.value = body.image || "";
      if (fieldAudio) fieldAudio.value = body.audio || "";

      if (body.image) {
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `http://127.0.0.1:8000/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      if (body.audio) {
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `http://127.0.0.1:8000/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      }
      updateMediaPreviews();
      if (fieldTags) fieldTags.value = body.tags || "";
      if (fieldNotes) fieldNotes.value = body.notes || "";

      // Automatically trigger frame screenshot and sentence audio if enabled and media is not already saved.
      const shouldAutoCaptureFrame = toggleAutoCaptureFrame ? toggleAutoCaptureFrame.checked : true;
      const shouldAutoCaptureAudio = toggleAutoCaptureAudio ? toggleAutoCaptureAudio.checked : true;

      if (!body.image && shouldAutoCaptureFrame && isVideoMiningActive()) {
        retakeScreenshot(requestId);
      }

      if (!body.audio && shouldAutoCaptureAudio && isVideoMiningActive()) {
        currentDraftMedia.audioStatus = "pending";
        currentDraftMedia.captureId = requestId;
        updateMediaPreviews();
        retakeAudio(requestId);
      }

      // Sync state update
      if (body.id) {
        if (body.sync_status === "synced") {
          updateSyncUI("synced");
        } else if (body.sync_status === "failed") {
          updateSyncUI("failed", body.sync_error);
        } else {
          updateSyncUI("pending");
        }
      } else {
        updateSyncUI(ankiConnected ? "ready" : "not_connected");
      }
    }

    if (saveBadge) {
      if (body.is_duplicate) {
        saveBadge.textContent = "ALREADY SAVED";
        saveBadge.className = "badge already-saved";
        saveBadge.hidden = false;
        setStatus(body.dictionary_error || "Card already saved.");
      } else {
        saveBadge.hidden = true;
        saveBadge.textContent = "";
        setStatus(body.dictionary_error || "Card draft ready. Edit and save.");
      }
    } else {
      setStatus(body.dictionary_error || "Capture identified.", Boolean(body.dictionary_error));
    }
  } catch (error) {
    if (requestId !== currentCaptureId) return;
    if (saveBadge) saveBadge.hidden = true;
    setIndicatorStatus(indicatorYomitan, "unavailable", "Yomitan: Unavailable");
    setStatus(formatErrorMessage(error), true);
  }
}

// Media preview management
function isVideoMiningActive() {
  if (videoMiningView && !videoMiningView.hidden) return true;
  if (tabBtnVideo && tabBtnVideo.classList.contains("active")) return true;
  return false;
}

function updateMediaPreviews() {
  const hasImage = Boolean(currentDraftMedia.imageBase64);
  const hasAudio = Boolean(currentDraftMedia.audioBase64);
  const audioStatus = currentDraftMedia.audioStatus || (hasAudio ? "available" : "idle");

  if (imagePreview) {
    if (hasImage) {
      imagePreview.src = currentDraftMedia.imageBase64;
      imagePreview.hidden = false;
    } else {
      imagePreview.removeAttribute("src");
      imagePreview.hidden = true;
    }
  }

  if (imageEmptyPlaceholder) {
    imageEmptyPlaceholder.hidden = hasImage;
  }

  if (btnClearImage) {
    btnClearImage.hidden = !hasImage;
  }

  // Audio preview & status handling
  if (audioPreview) {
    if (hasAudio) {
      if (audioPreview.src !== currentDraftMedia.audioBase64) {
        audioPreview.src = currentDraftMedia.audioBase64;
      }
      audioPreview.hidden = false;
    } else {
      if (typeof audioPreview.pause === "function") {
        try { audioPreview.pause(); } catch (_) {}
      }
      audioPreview.removeAttribute("src");
      audioPreview.hidden = true;
    }
  }

  if (audioEmptyPlaceholder) {
    audioEmptyPlaceholder.hidden = hasAudio;
  }

  if (btnClearAudio) {
    btnClearAudio.hidden = !hasAudio;
  }

  if (btnReplayAudio) {
    btnReplayAudio.hidden = !hasAudio;
  }

  if (audioStatusBadge) {
    audioStatusBadge.className = "media-status-pill";
    switch (audioStatus) {
      case "available":
        audioStatusBadge.textContent = "Ready";
        audioStatusBadge.classList.add("badge-ready");
        audioStatusBadge.title = "Audio clip extracted and ready";
        audioStatusBadge.hidden = false;
        break;
      case "pending":
        audioStatusBadge.textContent = "Pending…";
        audioStatusBadge.classList.add("badge-pending");
        audioStatusBadge.title = "Waiting for natural playback to finish sentence";
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "Waiting for playback…";
        break;
      case "expired":
        audioStatusBadge.textContent = "Expired (>30s)";
        audioStatusBadge.classList.add("badge-expired");
        audioStatusBadge.title = "Audio fell outside the 30-second rolling buffer";
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "Audio expired (>30s in past)";
        break;
      case "discontinuity":
        audioStatusBadge.textContent = "Discontinuity";
        audioStatusBadge.classList.add("badge-discontinuity");
        audioStatusBadge.title = "Video was seeked or timeline changed";
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "Audio segment changed (seeked)";
        break;
      case "unavailable":
        const isDrm = String(currentDraftMedia.audioError || "").toUpperCase().includes("DRM");
        audioStatusBadge.textContent = isDrm ? "DRM Restricted" : "Unavailable";
        audioStatusBadge.classList.add("badge-unavailable");
        audioStatusBadge.title = isDrm
          ? "Audio capture restricted on this source (DRM protected)"
          : (currentDraftMedia.audioError || "Audio capture unavailable");
        audioStatusBadge.hidden = false;
        if (audioPlaceholderText) {
          audioPlaceholderText.textContent = isDrm
            ? "Audio unavailable (DRM protected)"
            : "Audio unavailable for this source";
        }
        break;
      default:
        audioStatusBadge.hidden = true;
        if (audioPlaceholderText) audioPlaceholderText.textContent = "No audio clip";
    }
  }

  if (mediaPreviewContainer) {
    mediaPreviewContainer.hidden = false;
  }
}

function clearImageMedia() {
  currentDraftMedia.imageBase64 = null;
  if (fieldImage) fieldImage.value = "";
  updateMediaPreviews();
  setStatus("Image cleared.");
}

function clearAudioMedia() {
  if (currentDraftMedia.captureId) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "CANCEL_PENDING_AUDIO_CAPTURE",
          captureId: currentDraftMedia.captureId
        }).catch(() => {});
      }
    } catch (_) {}
  }
  currentDraftMedia.audioBase64 = null;
  currentDraftMedia.audioStatus = "idle";
  currentDraftMedia.audioError = null;
  currentDraftMedia.mimeType = null;
  if (fieldAudio) fieldAudio.value = "";
  updateMediaPreviews();
  setStatus("Audio cleared.");
}

function clearAllMedia() {
  if (currentDraftMedia.captureId) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "CANCEL_PENDING_AUDIO_CAPTURE",
          captureId: currentDraftMedia.captureId
        }).catch(() => {});
      }
    } catch (_) {}
  }
  currentDraftMedia.imageBase64 = null;
  currentDraftMedia.audioBase64 = null;
  currentDraftMedia.audioStatus = "idle";
  currentDraftMedia.audioError = null;
  currentDraftMedia.mimeType = null;
  currentDraftMedia.captureId = null;
  updateMediaPreviews();
}

function captureOrRetakeScreenshot() {
  if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
  retakeScreenshot(currentCaptureId);
}

function recordOrRetakeAudio() {
  if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
  retakeAudio(currentCaptureId);
}

function retakeScreenshot(captureId = null) {
  setStatus("Capturing video frame screenshot…");
  const capId = captureId || currentCaptureId;
  broadcastToActiveVideo({
    type: "TRIGGER_VIDEO_SCREENSHOT",
    options: {
      captureId: capId,
      maxWidth: 640,
      maxHeight: 360,
      quality: 0.92
    }
  });
}

function retakeAudio(captureId = null) {
  setStatus("Recording sentence audio…");
  const capId = captureId || currentCaptureId;
  broadcastToActiveVideo({
    type: "TRIGGER_AUDIO_RECORDING",
    cue: typeof currentActiveCue !== "undefined" ? currentActiveCue : null,
    options: {
      captureId: capId,
      mimeType: "audio/webm;codecs=opus",
      allowPausedPlayback: true
    }
  });
}

if (btnClearImage) {
  btnClearImage.addEventListener("click", clearImageMedia);
}
if (btnClearAudio) {
  btnClearAudio.addEventListener("click", clearAudioMedia);
}
if (btnReplayAudio) {
  btnReplayAudio.addEventListener("click", () => {
    if (audioPreview && audioPreview.src) {
      audioPreview.currentTime = 0;
      audioPreview.play().catch(() => {});
    }
  });
}

if (fieldImage) {
  fieldImage.addEventListener("input", () => {
    const val = fieldImage.value.trim();
    if (val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("data:image/"))) {
      currentDraftMedia.imageBase64 = val;
      updateMediaPreviews();
    } else if (!val && currentDraftMedia.imageBase64 && !currentDraftMedia.imageBase64.startsWith("data:image/")) {
      currentDraftMedia.imageBase64 = null;
      updateMediaPreviews();
    }
  });
}

if (fieldAudio) {
  fieldAudio.addEventListener("input", () => {
    const val = fieldAudio.value.trim();
    if (val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("data:audio/"))) {
      currentDraftMedia.audioBase64 = val;
      currentDraftMedia.audioStatus = "available";
      currentDraftMedia.audioError = null;
      updateMediaPreviews();
    } else if (!val && currentDraftMedia.audioBase64 && !currentDraftMedia.audioBase64.startsWith("data:audio/")) {
      currentDraftMedia.audioBase64 = null;
      currentDraftMedia.audioStatus = "idle";
      updateMediaPreviews();
    }
  });
}

// Progressive disclosure toggle for optional fields
if (toggleOptionalBtn && optionalFields) {
  toggleOptionalBtn.addEventListener("click", () => {
    const isExpanded = !optionalFields.hidden;
    optionalFields.hidden = isExpanded;
    toggleOptionalBtn.setAttribute("aria-expanded", String(!isExpanded));
    toggleOptionalBtn.textContent = isExpanded ? "+ Optional fields" : "- Optional fields";
  });
}

// Card save form submission
if (cardEditor) {
  cardEditor.addEventListener("submit", async event => {
    event.preventDefault();
    const expr = fieldExpression ? fieldExpression.value.trim() : "";
    if (!expr) {
      setStatus("Expression must not be empty.", true);
      return;
    }

    saveCardBtn.disabled = true;
    saveCardBtn.textContent = "Saving…";

    const targetDeck = (fieldDeckSelect && fieldDeckSelect.value.trim()) || (fieldDeckName && fieldDeckName.value.trim()) || "Default";
    const targetModel = (fieldModelSelect && fieldModelSelect.value.trim()) || (fieldModelName && fieldModelName.value.trim()) || "";
    const payload = {
      id: fieldCardId && fieldCardId.value ? parseInt(fieldCardId.value, 10) : null,
      expression: expr,
      reading: fieldReading ? fieldReading.value.trim() : "",
      meaning: fieldMeaning ? fieldMeaning.value.trim() : "",
      deck_name: targetDeck,
      model_name: targetModel,
      hint: fieldHint ? fieldHint.value.trim() : "",
      example_sentence: fieldExampleSentence ? fieldExampleSentence.value.trim() : "",
      example_translation: fieldExampleTranslation ? fieldExampleTranslation.value.trim() : "",
      image: fieldImage ? fieldImage.value.trim() : "",
      audio: fieldAudio ? fieldAudio.value.trim() : "",
      image_data: currentDraftMedia.imageBase64 || null,
      audio_data: currentDraftMedia.audioBase64 || null,
      media_mime_type: currentDraftMedia.mimeType || null,
      tags: fieldTags ? fieldTags.value.trim() : "",
      notes: fieldNotes ? fieldNotes.value.trim() : "",
      source_text: fieldSourceText ? fieldSourceText.value.trim() : "",
      deinflected_text: fieldDeinflectedText ? fieldDeinflectedText.value.trim() : "",
    };

    try {
      const response = await fetch(API_SAVE_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || "Failed to save card.");
      }

      if (fieldCardId) fieldCardId.value = body.id || "";
      if (body.model_name && fieldModelSelect) {
        fieldModelSelect.value = body.model_name;
        if (fieldModelName) fieldModelName.value = body.model_name;
      }
      if (body.audio) {
        if (fieldAudio) fieldAudio.value = body.audio;
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `http://127.0.0.1:8000/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      }
      if (body.image) {
        if (fieldImage) fieldImage.value = body.image;
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `http://127.0.0.1:8000/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      updateMediaPreviews();
      if (expression) expression.textContent = body.expression || expr;
      if (reading) reading.textContent = body.reading || "";

      if (body.sync_status === "synced") {
        updateSyncUI("synced");
      } else {
        updateSyncUI("pending");
      }

      if (saveBadge) {
        if (body.is_duplicate) {
          saveBadge.textContent = "ALREADY SAVED";
          saveBadge.className = "badge already-saved";
          saveBadge.hidden = false;
          setStatus("Card already saved.");
        } else {
          saveBadge.textContent = "SAVED";
          saveBadge.className = "badge saved";
          saveBadge.hidden = false;
          setStatus(body.is_updated ? "Card updated." : "Card saved.");
          if (body.is_new) {
            sessionCardCount++;
            updateSessionCounter();
          }
        }
      }
      selectedHistoryCardId = body.id || null;
      loadHistory().catch(() => {});
    } catch (error) {
      setStatus(`Save failed: ${formatErrorMessage(error)}`, true);
    } finally {
      saveCardBtn.disabled = false;
      saveCardBtn.textContent = "Save Card";
    }
  });
}

async function triggerAnkiSync() {
  const cardId = fieldCardId && fieldCardId.value ? parseInt(fieldCardId.value, 10) : null;
  if (!cardId) {
    setStatus("Save card before sending to Anki.", true);
    return;
  }

  updateSyncUI("syncing");
  try {
    const response = await fetch(API_CARD_SYNC_URL(cardId), {
      method: "POST",
      headers: {"Content-Type": "application/json"},
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.sync_status === "failed") {
      const errMsg = body.error || body.detail || "Sync failed";
      updateSyncUI("failed", errMsg);
      setStatus(`Anki sync failed: ${errMsg}`, true);
      loadHistory().catch(() => {});
      return;
    }

    updateSyncUI("synced");
    setStatus("Card sent to Anki.");
    loadHistory().catch(() => {});
  } catch (error) {
    const msg = formatErrorMessage(error);
    updateSyncUI("failed", msg);
    setStatus(`Anki sync failed: ${msg}`, true);
    loadHistory().catch(() => {});
  }
}

if (syncAnkiBtn) {
  syncAnkiBtn.addEventListener("click", triggerAnkiSync);
}

if (ankiSyncStatus) {
  ankiSyncStatus.addEventListener("click", () => {
    if (ankiSyncStatus.classList.contains("failed")) {
      triggerAnkiSync();
    }
  });
}

// Keyboard shortcuts
document.addEventListener("keydown", event => {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modKey = isMac ? event.metaKey : event.ctrlKey;

  if (modKey && event.key === "Enter") {
    event.preventDefault();
    if (cardEditor && !cardEditor.hidden) {
      cardEditor.requestSubmit();
    }
    return;
  }

  if (modKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (fieldExpression) {
      fieldExpression.focus();
      fieldExpression.select();
    }
    return;
  }

  if (modKey && event.shiftKey && event.key.toLowerCase() === "m") {
    event.preventDefault();
    if (fieldMeaning) {
      fieldMeaning.focus();
      fieldMeaning.select();
    }
    return;
  }

  if (event.key === "Escape") {
    if (optionalFields && !optionalFields.hidden) {
      optionalFields.hidden = true;
      if (toggleOptionalBtn) {
        toggleOptionalBtn.setAttribute("aria-expanded", "false");
        toggleOptionalBtn.textContent = "+ Optional fields";
        toggleOptionalBtn.focus();
      }
    }
    return;
  }

  // Phase 8.3: Video Mining Mode offset shortcuts in Side Panel
  if (videoMiningView && !videoMiningView.hidden) {
    const activeEl = document.activeElement;
    const isEditable = activeEl && (
      activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.tagName === "SELECT" ||
      activeEl.isContentEditable
    );
    if (!isEditable && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (event.key === "[" || event.code === "BracketLeft") {
        event.preventDefault();
        adjustOffset(-100);
      } else if (event.key === "]" || event.code === "BracketRight") {
        event.preventDefault();
        adjustOffset(100);
      } else if (event.key === "\\" || event.code === "Backslash") {
        event.preventDefault();
        resetOffset();
      }
    }
  }
});

// Mining History & Card Library logic
async function loadHistory() {
  if (!historyCardsList) return;
  try {
    const search = historySearchInput ? historySearchInput.value.trim() : "";
    const deck = historyDeckFilter ? historyDeckFilter.value : "all";
    const syncStatus = historySyncFilter ? historySyncFilter.value : "all";

    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (search) params.set("search", search);
    if (deck && deck !== "all") params.set("deck", deck);
    if (syncStatus && syncStatus !== "all") params.set("sync_status", syncStatus);

    const res = await fetch(`${API_CARDS_URL}?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load history");
    const data = await res.json();
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const total = typeof data.total === "number" ? data.total : cards.length;

    if (historyCount) {
      historyCount.textContent = `${total} card${total === 1 ? "" : "s"}`;
    }

    if (cards.length === 0) {
      historyCardsList.replaceChildren();
      if (historyEmpty) {
        historyEmpty.hidden = false;
        historyEmpty.textContent = search || deck !== "all" || syncStatus !== "all" ? "No matching cards found." : "No saved cards yet.";
      }
    } else {
      if (historyEmpty) historyEmpty.hidden = true;
      renderHistoryCards(cards);
    }

    updateDeckFilterOptions(cards);
  } catch (err) {
    if (historyEmpty) {
      historyEmpty.hidden = false;
      historyEmpty.textContent = "Failed to load history.";
    }
  }
}

function updateDeckFilterOptions(cards) {
  if (!historyDeckFilter) return;
  const currentVal = historyDeckFilter.value;
  const existingOptions = new Set(Array.from(historyDeckFilter.options).map(o => o.value));

  cards.forEach(c => {
    if (c.deck_name && !existingOptions.has(c.deck_name)) {
      const opt = document.createElement("option");
      opt.value = c.deck_name;
      opt.textContent = c.deck_name;
      historyDeckFilter.append(opt);
      existingOptions.add(c.deck_name);
    }
  });

  if (fieldDeckSelect) {
    Array.from(fieldDeckSelect.options).forEach(opt => {
      if (opt.value && !existingOptions.has(opt.value)) {
        const newOpt = document.createElement("option");
        newOpt.value = opt.value;
        newOpt.textContent = opt.value;
        historyDeckFilter.append(newOpt);
        existingOptions.add(opt.value);
      }
    });
  }

  if (existingOptions.has(currentVal)) {
    historyDeckFilter.value = currentVal;
  }
}

function renderHistoryCards(cards) {
  if (!historyCardsList) return;
  historyCardsList.replaceChildren();

  cards.forEach(card => {
    const item = document.createElement("article");
    item.className = "history-item" + (selectedHistoryCardId === card.id ? " selected" : "");
    item.dataset.cardId = String(card.id);
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Card ${card.expression}: ${card.reading || ""}`);

    const main = document.createElement("div");
    main.className = "history-item-main";

    const head = document.createElement("div");
    head.className = "history-item-head";

    const expr = document.createElement("span");
    expr.className = "history-item-expression";
    expr.textContent = card.expression;
    head.append(expr);

    if (card.reading) {
      const read = document.createElement("span");
      read.className = "history-item-reading";
      read.textContent = card.reading;
      head.append(read);
    }
    main.append(head);

    if (card.meaning) {
      const mean = document.createElement("p");
      mean.className = "history-item-meaning";
      mean.textContent = card.meaning;
      main.append(mean);
    }

    const meta = document.createElement("div");
    meta.className = "history-item-meta";

    const deckBadge = document.createElement("span");
    deckBadge.className = "history-item-deck";
    deckBadge.textContent = card.deck_name || "Default";
    deckBadge.title = `Deck: ${card.deck_name || "Default"}`;
    meta.append(deckBadge);

    const syncBadge = document.createElement("span");
    const statusKey = card.sync_status || "pending";
    syncBadge.className = `history-badge sync-${statusKey}`;
    syncBadge.textContent = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
    meta.append(syncBadge);

    main.append(meta);
    item.append(main);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    if (card.sync_status === "failed") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn-history-retry";
      retryBtn.textContent = "Retry";
      retryBtn.title = `Retry Anki sync: ${card.sync_error || "Error"}`;
      retryBtn.setAttribute("aria-label", `Retry syncing ${card.expression} to Anki`);
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id);
      });
      actions.append(retryBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-history-delete";
    delBtn.innerHTML = "&times;";
    delBtn.title = "Delete local card";
    delBtn.setAttribute("aria-label", `Delete ${card.expression} from local database`);
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLocalCard(card.id, card.expression);
    });
    actions.append(delBtn);

    item.append(actions);

    const openCard = () => openSavedCard(card.id);
    item.addEventListener("click", (e) => {
      if (e.target.closest(".history-item-actions")) return;
      openCard();
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCard();
      }
    });

    historyCardsList.append(item);
  });
}

async function openSavedCard(cardId) {
  try {
    selectedHistoryCardId = cardId;
    if (historyCardsList) {
      historyCardsList.querySelectorAll(".history-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.cardId === String(cardId));
      });
    }

    const res = await fetch(API_CARD_DETAIL_URL(cardId));
    if (!res.ok) throw new Error("Could not retrieve card details.");
    const body = await res.json();

    if (cardEditor) {
      cardEditor.hidden = false;
      if (fieldCardId) fieldCardId.value = body.id || "";
      if (fieldExpression) fieldExpression.value = body.expression || "";
      if (fieldReading) fieldReading.value = body.reading || "";
      if (fieldMeaning) fieldMeaning.value = body.meaning || "";
      if (fieldHint) fieldHint.value = body.hint || "";
      if (fieldExampleSentence) fieldExampleSentence.value = body.example_sentence || "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = body.example_translation || "";
      if (fieldImage) fieldImage.value = body.image || "";
      if (fieldAudio) fieldAudio.value = body.audio || "";

      clearAllMedia();
      if (body.image) {
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `http://127.0.0.1:8000/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      if (body.audio) {
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `http://127.0.0.1:8000/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      } else {
        currentDraftMedia.audioBase64 = null;
        currentDraftMedia.audioStatus = "idle";
      }
      updateMediaPreviews();
      if (fieldTags) fieldTags.value = body.tags || "";
      if (fieldNotes) fieldNotes.value = body.notes || "";
      if (fieldSourceText) fieldSourceText.value = body.source_text || "";
      if (fieldDeinflectedText) fieldDeinflectedText.value = body.deinflected_text || "";

      if (fieldDeckSelect && body.deck_name) {
        let hasDeck = Array.from(fieldDeckSelect.options).some(o => o.value === body.deck_name);
        if (!hasDeck) {
          const opt = document.createElement("option");
          opt.value = body.deck_name;
          opt.textContent = body.deck_name;
          fieldDeckSelect.append(opt);
        }
        fieldDeckSelect.value = body.deck_name;
      }
      if (fieldDeckName) fieldDeckName.value = (fieldDeckSelect && fieldDeckSelect.value) || body.deck_name || "Default";

      if (fieldModelSelect && body.model_name) {
        let hasModel = Array.from(fieldModelSelect.options).some(o => o.value === body.model_name);
        if (!hasModel) {
          const opt = document.createElement("option");
          opt.value = body.model_name;
          opt.textContent = body.model_name;
          fieldModelSelect.append(opt);
        }
        fieldModelSelect.value = body.model_name;
      }
      if (fieldModelName) fieldModelName.value = (fieldModelSelect && fieldModelSelect.value) || body.model_name || "";

      if (expression) expression.textContent = body.expression || "—";
      if (reading) reading.textContent = body.reading || "";

      if (body.sync_status === "synced") {
        updateSyncUI("synced");
      } else if (body.sync_status === "failed") {
        updateSyncUI("failed", body.sync_error);
      } else {
        updateSyncUI("pending");
      }

      if (Array.isArray(body.entries) && body.entries.length) {
        renderDetails({ entries: body.entries });
      }

      if (saveBadge) {
        saveBadge.textContent = "SAVED";
        saveBadge.className = "badge saved";
        saveBadge.hidden = false;
      }
      setStatus("Opened saved card from library.");
    }
  } catch (err) {
    setStatus(`Failed to open card: ${err.message}`, true);
  }
}

async function deleteLocalCard(cardId, cardExpr) {
  const confirmed = window.confirm(`Delete local card "${cardExpr}"? This will not delete the note in Anki.`);
  if (!confirmed) return;

  try {
    const res = await fetch(API_CARD_DETAIL_URL(cardId), { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete card.");

    if (fieldCardId && fieldCardId.value === String(cardId)) {
      fieldCardId.value = "";
      if (fieldExpression) fieldExpression.value = "";
      if (fieldReading) fieldReading.value = "";
      if (fieldMeaning) fieldMeaning.value = "";
      if (fieldHint) fieldHint.value = "";
      if (fieldExampleSentence) fieldExampleSentence.value = "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = "";
      if (fieldImage) fieldImage.value = "";
      if (fieldAudio) fieldAudio.value = "";
      if (fieldTags) fieldTags.value = "";
      if (fieldNotes) fieldNotes.value = "";
      if (expression) expression.textContent = "—";
      if (reading) reading.textContent = "";
      clearDictionaryView();
      if (saveBadge) {
        saveBadge.hidden = true;
        saveBadge.textContent = "";
      }
      if (cardEditor) cardEditor.hidden = true;
      updateSyncUI(ankiConnected ? "ready" : "not_connected");
      selectedHistoryCardId = null;
    }

    setStatus(`Deleted "${cardExpr}" from local database.`);
    await loadHistory();
  } catch (err) {
    setStatus(`Delete failed: ${err.message}`, true);
  }
}

async function retrySyncFromHistory(cardId) {
  try {
    setStatus("Retrying Anki sync…");
    const res = await fetch(API_CARD_SYNC_URL(cardId), { method: "POST", headers: { "Content-Type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.sync_status === "failed") {
      const errMsg = data.error || data.detail || "Sync failed";
      setStatus(`Anki sync retry failed: ${errMsg}`, true);
    } else {
      setStatus("Card synchronized to Anki.");
    }
    await loadHistory();
    if (fieldCardId && fieldCardId.value === String(cardId)) {
      if (data.sync_status === "synced") {
        updateSyncUI("synced");
      } else {
        updateSyncUI("failed", data.error || data.detail);
      }
    }
  } catch (err) {
    setStatus(`Retry failed: ${formatErrorMessage(err)}`, true);
  }
}

if (historySearchInput) {
  historySearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      loadHistory();
    }, 250);
  });
}

if (historyDeckFilter) {
  historyDeckFilter.addEventListener("change", () => {
    loadHistory();
  });
}

if (historySyncFilter) {
  historySyncFilter.addEventListener("change", () => {
    loadHistory();
  });
}

// Initialization
loadFontPreference().catch(() => {});
loadDecks().catch(() => {});
loadModels().catch(() => {});
loadHistory().catch(() => {});
loadTabPreference().catch(() => {});
loadAutoPausePreference().catch(() => {});
loadSubtitleOffsetPreference().catch(() => {});

// -------------------------------------------------------------
// Video Mining Logic & Messaging
// -------------------------------------------------------------
function formatOffset(offsetMs) {
  const ms = Math.round(offsetMs || 0);
  if (ms === 0) return "0 ms";
  const sign = ms > 0 ? "+" : "";
  return `${sign}${ms} ms`;
}

function updateOffsetDisplay(offset) {
  let ms = 0;
  if (typeof offset === "number" && !isNaN(offset)) {
    if (Math.abs(offset) > 0 && Math.abs(offset) < 20 && !Number.isInteger(offset)) {
      ms = Math.round(offset * 1000);
    } else {
      ms = Math.round(offset);
    }
  }
  currentSubtitleOffsetMs = ms;
  currentSubtitleOffset = ms / 1000;
  if (offsetDisplay) {
    offsetDisplay.textContent = formatOffset(currentSubtitleOffsetMs);
  }
}

function persistSubtitleOffset(offsetMs) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ subtitle_timing_offset: offsetMs });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("subtitle_timing_offset", String(offsetMs));
    }
  } catch (_) {}
}

async function loadSubtitleOffsetPreference() {
  try {
    let offsetMs = 0;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("subtitle_timing_offset");
      if (typeof stored?.subtitle_timing_offset === "number" && !isNaN(stored.subtitle_timing_offset)) {
        offsetMs = stored.subtitle_timing_offset;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("subtitle_timing_offset");
      if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) offsetMs = parsed;
      }
    }
    updateOffsetDisplay(offsetMs);
  } catch (_) {}
}

async function broadcastToActiveVideo(message, targetFrame = null) {
  const frameInfo = targetFrame || lastCaptureSource;
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const targetTabId = frameInfo?.tabId || tab?.id;
      if (targetTabId) {
        const sendOptions = typeof frameInfo?.frameId === "number" ? { frameId: frameInfo.frameId } : undefined;
        if (sendOptions) {
          chrome.tabs.sendMessage(targetTabId, message, sendOptions).catch(() => {});
        } else {
          chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
        }
      }
    }
  } catch (_) {}
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  } catch (_) {}
}

async function handleSubtitleFileSelect(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parser = typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null);
    if (!parser) {
      setStatus("Subtitle parser unavailable.", true);
      return;
    }
    const cues = parser.parseSubtitles(text, file.name);
    if (!cues || cues.length === 0) {
      setStatus(`No valid subtitle cues found in "${file.name}".`, true);
      return;
    }
    loadedSubtitlesFilename = file.name;
    if (subtitlesFileStatus) {
      subtitlesFileStatus.textContent = file.name;
      subtitlesFileStatus.classList.add("active");
      subtitlesFileStatus.title = `${file.name} (${cues.length} cues)`;
    }
    setStatus(`Loaded ${cues.length} subtitle cues from "${file.name}".`);
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({
          active_subtitle_cues: cues,
          active_subtitle_filename: file.name
        });
      }
    } catch (_) {}
    await broadcastToActiveVideo({
      type: "LOAD_SUBTITLE_CUES",
      cues,
      filename: file.name
    });
  } catch (err) {
    setStatus(`Failed to read subtitle file: ${err.message}`, true);
  }
}

function adjustOffset(delta) {
  const deltaMs = Math.abs(delta) < 5 && delta !== 0 && !Number.isInteger(delta)
    ? Math.round(delta * 1000)
    : Math.round(delta);
  const newOffsetMs = currentSubtitleOffsetMs + deltaMs;
  updateOffsetDisplay(newOffsetMs);
  persistSubtitleOffset(newOffsetMs);
  broadcastToActiveVideo({
    type: "SET_SUBTITLE_OFFSET",
    offsetMs: newOffsetMs,
    offset: newOffsetMs / 1000
  });
}

function resetOffset() {
  updateOffsetDisplay(0);
  persistSubtitleOffset(0);
  broadcastToActiveVideo({
    type: "SET_SUBTITLE_OFFSET",
    offsetMs: 0,
    offset: 0.0
  });
}

async function clearSubtitles() {
  if (subtitlesFileInput) subtitlesFileInput.value = "";
  loadedSubtitlesFilename = "";
  if (subtitlesFileStatus) {
    subtitlesFileStatus.textContent = "No subtitles";
    subtitlesFileStatus.classList.remove("active");
    subtitlesFileStatus.title = "";
  }
  if (videoCurrentCuePreview) {
    videoCurrentCuePreview.textContent = "—";
  }
  if (videoTrackSelect) {
    videoTrackSelect.hidden = true;
    videoTrackSelect.replaceChildren();
  }
  resetOffset();
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.remove(["active_subtitle_cues", "active_subtitle_filename"]);
    }
  } catch (_) {}
  setStatus("Cleared loaded subtitles.");
  await broadcastToActiveVideo({ type: "CLEAR_SUBTITLES" });
}

function switchMiningTab(targetTab) {
  const isVideo = targetTab === "video";
  if (tabBtnText && tabBtnVideo && textMiningView && videoMiningView) {
    tabBtnText.classList.toggle("active", !isVideo);
    tabBtnText.setAttribute("aria-selected", String(!isVideo));
    tabBtnVideo.classList.toggle("active", isVideo);
    tabBtnVideo.setAttribute("aria-selected", String(isVideo));

    textMiningView.hidden = isVideo;
    videoMiningView.hidden = !isVideo;

    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ active_mining_tab: targetTab });
      } else if (typeof localStorage !== "undefined") {
        localStorage.setItem("active_mining_tab", targetTab);
      }
    } catch (_) {}
  }
}

async function loadTabPreference() {
  try {
    let savedTab = "text";
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("active_mining_tab");
      if (stored?.active_mining_tab) savedTab = stored.active_mining_tab;
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("active_mining_tab");
      if (stored) savedTab = stored;
    }
    switchMiningTab(savedTab);
  } catch (_) {}
}

if (tabBtnText) {
  tabBtnText.addEventListener("click", () => switchMiningTab("text"));
}
if (tabBtnVideo) {
  tabBtnVideo.addEventListener("click", () => switchMiningTab("video"));
}

if (clearSubtitlesBtn) {
  clearSubtitlesBtn.addEventListener("click", clearSubtitles);
}

if (loadSubtitlesBtn && subtitlesFileInput) {
  loadSubtitlesBtn.addEventListener("click", () => subtitlesFileInput.click());
  subtitlesFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleSubtitleFileSelect(file);
  });
}

if (offsetMinusBtn) {
  offsetMinusBtn.addEventListener("click", () => adjustOffset(-100));
}
if (offsetPlusBtn) {
  offsetPlusBtn.addEventListener("click", () => adjustOffset(100));
}
if (offsetResetBtn) {
  offsetResetBtn.addEventListener("click", () => resetOffset());
}

if (videoTrackSelect) {
  videoTrackSelect.addEventListener("change", () => {
    const trackIndex = parseInt(videoTrackSelect.value, 10);
    broadcastToActiveVideo({
      type: "SELECT_YOUTUBE_TRACK",
      trackIndex
    });
  });
}

async function loadAutoPausePreference() {
  try {
    let autoPause = false;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get("auto_pause_on_hover");
      if (typeof stored?.auto_pause_on_hover === "boolean") {
        autoPause = stored.auto_pause_on_hover;
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("auto_pause_on_hover");
      if (stored !== null) {
        autoPause = stored === "true";
      }
    }
    if (toggleAutoPauseHover) {
      toggleAutoPauseHover.checked = autoPause;
    }
  } catch (_) {}
}

function setAutoPausePreference(enabled) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ auto_pause_on_hover: enabled });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("auto_pause_on_hover", String(enabled));
    }
  } catch (_) {}
  broadcastToActiveVideo({
    type: "SET_AUTO_PAUSE_ON_HOVER",
    enabled
  });
}

async function loadAutoCapturePreferences() {
  try {
    let autoFrame = true;
    let autoAudio = true;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(["auto_capture_frame", "auto_capture_audio"]);
      if (typeof stored?.auto_capture_frame === "boolean") autoFrame = stored.auto_capture_frame;
      if (typeof stored?.auto_capture_audio === "boolean") autoAudio = stored.auto_capture_audio;
    } else if (typeof localStorage !== "undefined") {
      const sf = localStorage.getItem("auto_capture_frame");
      if (sf !== null) autoFrame = sf === "true";
      const sa = localStorage.getItem("auto_capture_audio");
      if (sa !== null) autoAudio = sa === "true";
    }
    if (toggleAutoCaptureFrame) toggleAutoCaptureFrame.checked = autoFrame;
    if (toggleAutoCaptureAudio) toggleAutoCaptureAudio.checked = autoAudio;
  } catch (_) {}
}

function setAutoCapturePreference(key, enabled) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: enabled });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, String(enabled));
    }
  } catch (_) {}
}

if (toggleAutoPauseHover) {
  toggleAutoPauseHover.addEventListener("change", (e) => {
    setAutoPausePreference(Boolean(e.target.checked));
  });
}

if (toggleAutoCaptureFrame) {
  toggleAutoCaptureFrame.addEventListener("change", (e) => {
    setAutoCapturePreference("auto_capture_frame", Boolean(e.target.checked));
  });
}

if (toggleAutoCaptureAudio) {
  toggleAutoCaptureAudio.addEventListener("change", (e) => {
    setAutoCapturePreference("auto_capture_audio", Boolean(e.target.checked));
  });
}

// Default Yomitan indicator to ready state
setIndicatorStatus(indicatorYomitan, "connected", "Yomitan: Ready");

toggle.addEventListener("click", () => {
  setMiningMode(!miningMode).catch(error => {
    setStatus(`Capture setup failed: ${error.message}`, true);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCREENSHOT_CAPTURED") {
    if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
      sendResponse?.({ok: false, error: "STALE_CAPTURE"});
      return true;
    }
    if (message.dataUrl) {
      currentDraftMedia.imageBase64 = message.dataUrl;
      currentDraftMedia.captureId = currentCaptureId;
      if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
      if (fieldImage && !fieldImage.value) {
        fieldImage.value = "captured_frame.jpg";
      }
      updateMediaPreviews();
      setStatus("Screenshot captured.");
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SCREENSHOT_CAPTURE_STATUS") {
    if (!message.ok) {
      const isDrm = message.error === "DRM_PROTECTED" || message.error === "DRM_IMAGE_RESTRICTED";
      const statusText = isDrm
        ? "Image unavailable for this source (DRM protected)."
        : (message.message || "Image unavailable for this source.");
      setStatus(statusText);
    }
    sendResponse?.({ ok: true });
    return true;
  }
  if (message?.type === "AUDIO_CAPTURED") {
    if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
      sendResponse?.({ok: false, error: "STALE_CAPTURE"});
      return true;
    }
    if (message.dataUrl) {
      currentDraftMedia.audioBase64 = message.dataUrl;
      currentDraftMedia.audioStatus = "available";
      currentDraftMedia.audioError = null;
      currentDraftMedia.mimeType = message.mimeType || "audio/wav";
      currentDraftMedia.captureId = currentCaptureId;
      if (cardEditor && cardEditor.hidden) cardEditor.hidden = false;
      if (fieldAudio && !fieldAudio.value) {
        fieldAudio.value = (message.mimeType && message.mimeType.includes("wav"))
          ? "captured_audio.wav"
          : "captured_audio.webm";
      }
      updateMediaPreviews();
      setStatus(message.wasPending ? "Audio snippet finalized on resume." : "Audio snippet extracted.");
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "AUDIO_CAPTURE_STATUS") {
    if (message.pending || message.status === "PENDING") {
      currentDraftMedia.audioStatus = "pending";
      currentDraftMedia.audioBase64 = null;
      updateMediaPreviews();
      setStatus("Audio queued (capturing on playback resume)...");
    } else if (!message.ok) {
      const isDrm = message.error === "DRM_AUDIO_RESTRICTED" || message.error === "DRM_AUDIO";
      const isExpired = message.error === "AUDIO_BUFFER_EXPIRED";
      const isDiscontinuity = message.error === "AUDIO_DISCONTINUITY" || message.error === "TIMELINE_DISCONTINUITY";

      if (isExpired) {
        currentDraftMedia.audioStatus = "expired";
      } else if (isDiscontinuity) {
        currentDraftMedia.audioStatus = "discontinuity";
      } else if (isDrm) {
        currentDraftMedia.audioStatus = "unavailable";
        currentDraftMedia.audioError = "DRM_AUDIO_RESTRICTED";
      } else {
        currentDraftMedia.audioStatus = "unavailable";
        currentDraftMedia.audioError = message.error || "AUDIO_UNAVAILABLE";
      }
      currentDraftMedia.audioBase64 = null;
      updateMediaPreviews();

      const statusText = isDrm
        ? "Audio unavailable for this source (DRM protected)."
        : isExpired
          ? "Audio expired from 30s rolling buffer."
          : isDiscontinuity
            ? "Audio segment changed due to seek."
            : (message.message || "Audio unavailable for this source.");
      setStatus(statusText);
    }
    sendResponse?.({ ok: true });
    return true;
  }
  if (message?.type === "JAPANESE_TEXT_CAPTURED") {
    if (sender?.tab?.id) {
      lastCaptureSource.tabId = sender.tab.id;
      lastCaptureSource.frameId = typeof sender.frameId === "number" ? sender.frameId : null;
    }
    identify(message.text);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "CAPTURE_DIAGNOSTIC") {
    setStatus(`${message.stage}: ${message.error}`, true);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_OFFSET_CHANGED") {
    const offsetVal = typeof message.offsetMs === "number"
      ? message.offsetMs
      : (typeof message.offset === "number" ? message.offset * 1000 : 0);
    updateOffsetDisplay(offsetVal);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_CUE_CHANGED") {
    if (message.cue) {
      currentActiveCue = message.cue;
    }
    if (videoCurrentCuePreview) {
      videoCurrentCuePreview.textContent = message.cue?.text || "—";
    }
    if (typeof message.offsetMs === "number") {
      if (message.offsetMs !== currentSubtitleOffsetMs) {
        updateOffsetDisplay(message.offsetMs);
      }
    } else if (typeof message.offset === "number" && message.offset !== currentSubtitleOffset) {
      updateOffsetDisplay(message.offset);
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_FILE_LOADED") {
    if (subtitlesFileStatus && message.filename) {
      subtitlesFileStatus.textContent = message.filename;
      subtitlesFileStatus.classList.add("active");
    }
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "YOUTUBE_TRACKS_FOUND") {
    if (videoTrackSelect && Array.isArray(message.tracks) && message.tracks.length > 0) {
      availableCaptionTracks = message.tracks;
      videoTrackSelect.replaceChildren();
      message.tracks.forEach((t, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = `${t.name || t.languageCode || `Track ${idx + 1}`}${t.isAuto ? " (auto)" : ""}`;
        if (t.selected) opt.selected = true;
        videoTrackSelect.appendChild(opt);
      });
      videoTrackSelect.hidden = false;
      if (subtitlesFileStatus) {
        subtitlesFileStatus.textContent = "YouTube CC";
        subtitlesFileStatus.classList.add("active");
      }
    }
    sendResponse?.({ok: true});
    return true;
  }
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes?.subtitle_timing_offset && typeof changes.subtitle_timing_offset.newValue === "number") {
      updateOffsetDisplay(changes.subtitle_timing_offset.newValue);
    }
  });
}

loadAutoCapturePreferences();

chrome.runtime.sendMessage({type: "GET_MINING_MODE"}).then(res => {
  if (res?.enabled) updateMiningUI(true);
}).catch(() => {});
