chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SET_MINING_MODE" || typeof message.enabled !== "boolean") return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
    if (!tab?.id) return sendResponse({ ok: false, error: "No active tab is available." });
    chrome.tabs.sendMessage(tab.id, { type: "MINING_MODE_CHANGED", enabled: message.enabled }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false, error: "Reload the page before mining." }));
  });
  return true;
});
