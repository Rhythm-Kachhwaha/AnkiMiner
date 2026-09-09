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
