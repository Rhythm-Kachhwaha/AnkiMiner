(function (global) {
  function selectedText(selection) { return !selection || selection.rangeCount === 0 ? "" : selection.toString().trim().replace(/\s+/g, " "); }
  function captureMessage(text) { return { type: "JAPANESE_TEXT_CAPTURED", text }; }
  global.AnkiMinerCapture = { selectedText, captureMessage };
})(typeof globalThis === "undefined" ? window : globalThis);
