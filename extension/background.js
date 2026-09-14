let isMiningModeEnabled = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {type: "PING_ANKI_MINER"});
  } catch {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: ["content/capture-utils.js", "content/content.js"]
    });
  }
}

const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
let creatingOffscreenPromise = null;

async function hasOffscreenDocument() {
  if (typeof chrome !== "undefined" && chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
    return await chrome.offscreen.hasDocument();
  }
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getContexts === "function") {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }
  if (typeof chrome !== "undefined" && chrome.offscreen?.createDocument) {
    creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["USER_MEDIA"],
      justification: "Recording tab audio for vocabulary mining"
    });
    try {
      await creatingOffscreenPromise;
    } finally {
      creatingOffscreenPromise = null;
    }
  }

  // Verify offscreen document listener is ready
  for (let i = 0; i < 10; i++) {
    try {
      const pong = await chrome.runtime.sendMessage({ type: "PING_OFFSCREEN" });
      if (pong?.ok) break;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 50));
  }
}

let isRecordingAudio = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SET_MINING_MODE") {
    isMiningModeEnabled = Boolean(message.enabled);
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab?.id && tab?.url && !tab.url.startsWith("chrome://")) {
          chrome.tabs.sendMessage(tab.id, {type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled}).catch(() => {});
        }
      }
    }).catch(() => {});
    activeTab().then(async tab => {
      if (tab?.id) {
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, {type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled}).catch(() => {});
      }
    }).catch(() => {});
    sendResponse({ok: true, stage: "content-script"});
    return true;
  }
  if (message?.type === "GET_MINING_MODE") {
    sendResponse({ok: true, enabled: isMiningModeEnabled});
    return true;
  }
  if (message?.type === "FETCH_YOUTUBE_TIMEDTEXT") {
    fetch(message.url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.text();
      })
      .then(text => sendResponse({ok: true, text}))
      .catch(err => sendResponse({ok: false, error: err.message}));
    return true;
  }
  if (message?.type === "CAPTURE_VIDEO_FRAME") {
    const windowId = sender?.tab?.windowId;
    const captureOptions = {
      format: message.format || "jpeg",
      quality: typeof message.quality === "number" ? message.quality : 95
    };
    const capturePromise = (typeof windowId === "number")
      ? chrome.tabs.captureVisibleTab(windowId, captureOptions)
      : chrome.tabs.captureVisibleTab(captureOptions);

    capturePromise
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(err => {
        console.error("[AnkiMiner Background] captureVisibleTab failed:", err);
        sendResponse({ ok: false, error: err?.message || "Failed to capture visible tab" });
      });
    return true;
  }
  if (message?.type === "START_AUDIO_RECORDING") {
    if (isRecordingAudio) {
      sendResponse({
        ok: false,
        error: "RECORDING_IN_PROGRESS",
        message: "An audio recording is already in progress"
      });
      return true;
    }
    isRecordingAudio = true;
    (async () => {
      try {
        let targetTabId = message.tabId || sender?.tab?.id;
        if (!targetTabId) {
          const tab = await activeTab();
          targetTabId = tab?.id;
        }
        if (!targetTabId) {
          sendResponse({ ok: false, error: "NO_TARGET_TAB", message: "Could not determine target tab for audio capture" });
          return;
        }

        // 1. Obtain stream ID for the tab
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });
        if (!streamId) {
          sendResponse({ ok: false, error: "NO_STREAM_ID", message: "chrome.tabCapture.getMediaStreamId returned empty stream ID" });
          return;
        }

        // 2. Ensure offscreen document is open
        await ensureOffscreenDocument();

        // 3. Delegate recording to offscreen document
        const offscreenResult = await chrome.runtime.sendMessage({
          type: "START_RECORDING_OFFSCREEN",
          streamId,
          durationMs: message.durationMs,
          mimeType: message.mimeType
        });

        sendResponse(offscreenResult);
      } catch (err) {
        console.error("[AnkiMiner Background] Audio recording failed:", err);
        const isDrm = err?.name === "AbortError" || err?.name === "NotAllowedError" || err?.name === "SecurityError" || err?.message?.toLowerCase().includes("drm");
        sendResponse({
          ok: false,
          error: isDrm ? "DRM_AUDIO_RESTRICTED" : "AUDIO_RECORDING_FAILED",
          message: isDrm ? "Audio capture is restricted on this source (DRM protected)." : (err?.message || "Failed to record audio from tab")
        });
      } finally {
        isRecordingAudio = false;
      }
    })();
    return true;
  }
  if (message?.type === "STOP_AUDIO_RECORDING") {
    (async () => {
      try {
        if (await hasOffscreenDocument()) {
          const res = await chrome.runtime.sendMessage({ type: "STOP_RECORDING_OFFSCREEN" });
          sendResponse(res || { ok: true });
        } else {
          sendResponse({ ok: true, message: "No active offscreen document" });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Failed to stop recording" });
      }
    })();
    return true;
  }
  if (message?.type === "LOAD_SUBTITLE_CUES" || message?.type === "CLEAR_SUBTITLES" || message?.type === "SET_SUBTITLE_OFFSET" || message?.type === "SELECT_YOUTUBE_TRACK") {
    if (message?.type === "LOAD_SUBTITLE_CUES" && Array.isArray(message.cues)) {
      try {
        chrome.storage.local.set({
          active_subtitle_cues: message.cues,
          active_subtitle_filename: message.filename || ""
        });
      } catch (_) {}
    } else if (message?.type === "CLEAR_SUBTITLES") {
      try {
        chrome.storage.local.remove(["active_subtitle_cues", "active_subtitle_filename"]);
      } catch (_) {}
    }
    activeTab().then(tab => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }).catch(() => {});
    sendResponse({ok: true});
    return true;
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  if (isMiningModeEnabled && activeInfo?.tabId) {
    ensureContentScript(activeInfo.tabId).then(() => {
      chrome.tabs.sendMessage(activeInfo.tabId, {type: "MINING_MODE_CHANGED", enabled: true}).catch(() => {});
    }).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isMiningModeEnabled && changeInfo.status === "complete" && tab?.url && !tab.url.startsWith("chrome://")) {
    ensureContentScript(tabId).then(() => {
      chrome.tabs.sendMessage(tabId, {type: "MINING_MODE_CHANGED", enabled: true}).catch(() => {});
    }).catch(() => {});
  }
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    hasOffscreenDocument,
    ensureOffscreenDocument,
    OFFSCREEN_DOCUMENT_PATH
  };
}

