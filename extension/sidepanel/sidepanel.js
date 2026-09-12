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

let currentSubtitleOffset = 0.0;
let loadedSubtitlesFilename = "";
let availableCaptionTracks = [];

let selectedHistoryCardId = null;
let searchDebounceTimeout = null;

let miningMode = false;
let currentCaptureId = 0;
let sessionCardCount = 0;
let ankiConnected = false;

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

function renderDetails(body) {
  meanings.replaceChildren();
  examples.replaceChildren();
  for (const entry of body.entries || []) {
    const block = document.createElement("article");
    block.className = "dictionary-entry";

    const titleH2 = add(block, "h2", entry.dictionary);
    if (entry.is_primary) {
      const primaryBadge = document.createElement("span");
      primaryBadge.className = "badge";
      primaryBadge.textContent = "Primary";
      primaryBadge.style.fontSize = "10px";
      titleH2.append(primaryBadge);
    }

    if (entry.parts_of_speech?.length) {
      const metaContainer = document.createElement("div");
      metaContainer.className = "meta";
      entry.parts_of_speech.forEach(pos => {
        add(metaContainer, "span", pos, "pos-tag");
      });
      block.append(metaContainer);
    }

    entry.senses.forEach((sense, index) => {
      const section = document.createElement("section");
      section.className = "sense";
      if (entry.senses.length > 1) {
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
    meanings.append(block);
  }
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
  meanings.replaceChildren();
  examples.replaceChildren();

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
      if (fieldTags) fieldTags.value = body.tags || "";
      if (fieldNotes) fieldNotes.value = body.notes || "";

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

// -------------------------------------------------------------
// Video Mining Logic & Messaging
// -------------------------------------------------------------
function updateOffsetDisplay(offset) {
  currentSubtitleOffset = offset;
  if (offsetDisplay) {
    const sign = offset > 0 ? "+" : "";
    offsetDisplay.textContent = `${sign}${offset.toFixed(1)}s`;
  }
}

async function broadcastToActiveVideo(message) {
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
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
  const newOffset = +(currentSubtitleOffset + delta).toFixed(1);
  updateOffsetDisplay(newOffset);
  broadcastToActiveVideo({
    type: "SET_SUBTITLE_OFFSET",
    offset: newOffset
  });
}

function resetOffset() {
  updateOffsetDisplay(0.0);
  broadcastToActiveVideo({
    type: "SET_SUBTITLE_OFFSET",
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
  offsetMinusBtn.addEventListener("click", () => adjustOffset(-0.5));
}
if (offsetPlusBtn) {
  offsetPlusBtn.addEventListener("click", () => adjustOffset(0.5));
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

if (toggleAutoPauseHover) {
  toggleAutoPauseHover.addEventListener("change", (e) => {
    setAutoPausePreference(Boolean(e.target.checked));
  });
}

// Default Yomitan indicator to ready state
setIndicatorStatus(indicatorYomitan, "connected", "Yomitan: Ready");

toggle.addEventListener("click", () => {
  setMiningMode(!miningMode).catch(error => {
    setStatus(`Capture setup failed: ${error.message}`, true);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "JAPANESE_TEXT_CAPTURED") {
    identify(message.text);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "CAPTURE_DIAGNOSTIC") {
    setStatus(`${message.stage}: ${message.error}`, true);
    sendResponse?.({ok: true});
    return true;
  }
  if (message?.type === "SUBTITLE_CUE_CHANGED") {
    if (videoCurrentCuePreview) {
      videoCurrentCuePreview.textContent = message.cue?.text || "—";
    }
    if (typeof message.offset === "number" && message.offset !== currentSubtitleOffset) {
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

chrome.runtime.sendMessage({type: "GET_MINING_MODE"}).then(res => {
  if (res?.enabled) updateMiningUI(true);
}).catch(() => {});
