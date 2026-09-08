(() => {
  let miningMode = false;
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === "MINING_MODE_CHANGED") miningMode = message.enabled; });
  document.addEventListener("mouseup", () => {
    if (!miningMode) return;
    const text = AnkiMinerCapture.selectedText(window.getSelection());
    if (text) chrome.runtime.sendMessage(AnkiMinerCapture.captureMessage(text)).catch(() => {});
  });
})();
