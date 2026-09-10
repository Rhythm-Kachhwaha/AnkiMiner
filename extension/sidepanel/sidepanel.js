const API_CAPTURE_URL = "http://127.0.0.1:8000/api/capture";
const API_SAVE_URL = "http://127.0.0.1:8000/api/cards/save";
const API_ANKI_STATUS_URL = "http://127.0.0.1:8000/api/anki/status";
const API_ANKI_DECKS_URL = "http://127.0.0.1:8000/api/anki/decks";
const API_CARD_SYNC_URL = (id) => `http://127.0.0.1:8000/api/cards/${id}/sync`;

const toggle = document.querySelector("#mining-toggle");
const mode = document.querySelector("#mode");
const sessionCountEl = document.querySelector("#session-count");
const status = document.querySelector("#capture-status");
const saveBadge = document.querySelector("#save-badge");
const expression = document.querySelector("#expression");
const reading = document.querySelector("#reading");
const meanings = document.querySelector("#meanings");
const examples = document.querySelector("#examples");

// Card Editor elements
const cardEditor = document.querySelector("#card-editor");
const fieldCardId = document.querySelector("#field-card-id");
const fieldDeckName = document.querySelector("#field-deck-name");
const fieldDeckSelect = document.querySelector("#field-deck-select");
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

let miningMode = false;
let currentCaptureId = 0;
let sessionCardCount = 0;
let ankiConnected = false;

function updateSyncUI(state, error = "") {
  if (!ankiSyncStatus || !syncAnkiBtn) return;
  ankiSyncStatus.title = error || "";

  switch (state) {
    case "ready":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Ready";
      ankiSyncStatus.className = "sync-status-label";
      break;
    case "not_connected":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Not connected";
      ankiSyncStatus.className = "sync-status-label";
      break;
    case "pending":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = "Anki: Pending";
      ankiSyncStatus.className = "sync-status-label pending";
      break;
    case "syncing":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Sending…";
      ankiSyncStatus.textContent = "Anki: Syncing…";
      ankiSyncStatus.className = "sync-status-label syncing";
      break;
    case "synced":
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Sent to Anki";
      ankiSyncStatus.textContent = "Anki: Synced";
      ankiSyncStatus.className = "sync-status-label synced";
      break;
    case "failed":
      syncAnkiBtn.disabled = false;
      syncAnkiBtn.textContent = "Retry Send to Anki";
      ankiSyncStatus.textContent = "Anki: Failed — retry";
      ankiSyncStatus.className = "sync-status-label failed";
      break;
    default:
      syncAnkiBtn.disabled = true;
      syncAnkiBtn.textContent = "Send to Anki";
      ankiSyncStatus.textContent = ankiConnected ? "Anki: Ready" : "Anki: Not connected";
      ankiSyncStatus.className = "sync-status-label";
  }
}

async function loadDecks() {
  try {
    const res = await fetch(API_ANKI_DECKS_URL);
    const data = await res.json().catch(() => ({}));
    ankiConnected = Boolean(data.connected);
    const decks = Array.isArray(data.decks) && data.decks.length ? data.decks : ["Default"];

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
  }
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
}

function renderDetails(body) {
  meanings.replaceChildren();
  examples.replaceChildren();
  for (const entry of body.entries || []) {
    const block = document.createElement("article");
    block.className = "dictionary-entry";
    add(block, "h2", entry.dictionary);
    if (entry.parts_of_speech?.length) {
      add(block, "p", entry.parts_of_speech.join(" · "), "meta");
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
        add(section, "p", example.japanese, "example");
        if (example.translation) add(section, "p", example.translation, "translation");
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
      throw new Error(`${cause}: ${body.detail || response.statusText}`);
    }

    // Populate reference elements
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
    const payload = {
      id: fieldCardId && fieldCardId.value ? parseInt(fieldCardId.value, 10) : null,
      expression: expr,
      reading: fieldReading ? fieldReading.value.trim() : "",
      meaning: fieldMeaning ? fieldMeaning.value.trim() : "",
      deck_name: targetDeck,
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
      return;
    }

    updateSyncUI("synced");
    setStatus("Card sent to Anki.");
  } catch (error) {
    const msg = formatErrorMessage(error);
    updateSyncUI("failed", msg);
    setStatus(`Anki sync failed: ${msg}`, true);
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

loadDecks().catch(() => {});

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
});

chrome.runtime.sendMessage({type: "GET_MINING_MODE"}).then(res => {
  if (res?.enabled) updateMiningUI(true);
}).catch(() => {});
