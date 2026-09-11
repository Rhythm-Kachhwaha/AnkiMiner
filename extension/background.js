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
  if (message?.type === "LOAD_SUBTITLE_CUES" || message?.type === "SET_SUBTITLE_OFFSET" || message?.type === "SELECT_YOUTUBE_TRACK") {
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
