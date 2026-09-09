const API_URL = "http://127.0.0.1:8000/api/capture";
const toggle = document.querySelector("#mining-toggle");
const mode = document.querySelector("#mode");
const status = document.querySelector("#capture-status");
const expression = document.querySelector("#expression");
const reading = document.querySelector("#reading");
const meanings = document.querySelector("#meanings");
const examples = document.querySelector("#examples");

let miningMode = false;
let currentCaptureId = 0;

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
  expression.textContent = "—";
  reading.textContent = "";
  meanings.replaceChildren();
  examples.replaceChildren();
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: capturedText}),
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
    expression.textContent = body.expression;
    reading.textContent = body.reading || "Reading unavailable from Yomitan.";
    renderDetails(body);
    setStatus(body.dictionary_error || "Capture identified.", Boolean(body.dictionary_error));
  } catch (error) {
    if (requestId !== currentCaptureId) return;
    setStatus(error.message || "Backend unavailable.", true);
  }
}

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
