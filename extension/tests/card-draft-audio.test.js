const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Stage 4 Card Draft Audio & Side Panel Integration Tests...\n");

// Read sidepanel files
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf8");
const cssContent = fs.readFileSync(cssPath, "utf8");
const jsContent = fs.readFileSync(jsPath, "utf8");

// -------------------------------------------------------------
// 1. DOM and Styling Contract Verification
// -------------------------------------------------------------
function testSidepanelAudioDOMContracts() {
  assert.ok(htmlContent.includes('id="audio-preview-container"'), "audio-preview-container must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="audio-preview"'), "audio-preview audio element must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="audio-status-badge"'), "audio-status-badge must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="btn-replay-audio"'), "btn-replay-audio button must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="btn-clear-audio"'), "btn-clear-audio button must exist in sidepanel.html");
  assert.ok(htmlContent.includes('id="audio-placeholder-text"'), "audio-placeholder-text span must exist in sidepanel.html");

  // CSS classes for states
  assert.ok(cssContent.includes('.media-status-pill'), "CSS must define .media-status-pill");
  assert.ok(cssContent.includes('.media-status-pill.badge-ready'), "CSS must define .badge-ready");
  assert.ok(cssContent.includes('.media-status-pill.badge-pending'), "CSS must define .badge-pending");
  assert.ok(cssContent.includes('.media-status-pill.badge-unavailable'), "CSS must define .badge-unavailable");
  assert.ok(cssContent.includes('.media-status-pill.badge-expired'), "CSS must define .badge-expired");
  assert.ok(cssContent.includes('.media-status-pill.badge-discontinuity'), "CSS must define .badge-discontinuity");
  assert.ok(cssContent.includes('.btn-media-replay'), "CSS must define .btn-media-replay styling");

  console.log("PASS: Side Panel Stage 4 Audio DOM and CSS contracts verified.");
}

// -------------------------------------------------------------
// 2. Draft Audio State Transitions & Preview Tests
// -------------------------------------------------------------
function createMockElement(tag, id = "") {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    id,
    className: "",
    hidden: false,
    src: "",
    value: "",
    textContent: "",
    title: "",
    paused: false,
    _attributes: {},
    classList: {
      add: (...cls) => { cls.forEach(c => classes.add(c)); },
      remove: (...cls) => { cls.forEach(c => classes.delete(c)); },
      contains: (cls) => classes.has(cls),
      toggle: (cls) => {
        if (classes.has(cls)) { classes.delete(cls); return false; }
        classes.add(cls); return true;
      }
    },
    setAttribute(k, v) { this._attributes[k] = v; },
    getAttribute(k) { return this._attributes[k]; },
    removeAttribute(k) {
      delete this._attributes[k];
      if (k === "src") this.src = "";
    },
    pause() { this.paused = true; },
    play() { this.paused = false; },
    addEventListener() {},
  };
}

function testDraftAudioStateTransitions() {
  const mockMediaPreviewContainer = createMockElement("div", "media-preview-container");
  const mockImagePreviewContainer = createMockElement("div", "image-preview-container");
  const mockImagePreview = createMockElement("img", "image-preview");
  const mockImageEmptyPlaceholder = createMockElement("div", "image-empty-placeholder");
  const mockBtnRetakeImage = createMockElement("button", "btn-retake-image");
  const mockBtnClearImage = createMockElement("button", "btn-clear-image");

  const mockAudioPreviewContainer = createMockElement("div", "audio-preview-container");
  const mockAudioPreview = createMockElement("audio", "audio-preview");
  const mockAudioEmptyPlaceholder = createMockElement("div", "audio-empty-placeholder");
  const mockBtnRetakeAudio = createMockElement("button", "btn-retake-audio");
  const mockBtnClearAudio = createMockElement("button", "btn-clear-audio");
  const mockBtnReplayAudio = createMockElement("button", "btn-replay-audio");
  const mockAudioStatusBadge = createMockElement("span", "audio-status-badge");
  const mockAudioPlaceholderText = createMockElement("span", "audio-placeholder-text");

  const mockBtnQuickCaptureFrame = createMockElement("button", "btn-quick-capture-frame");
  const mockBtnQuickRecordAudio = createMockElement("button", "btn-quick-record-audio");

  const mockFieldImage = createMockElement("input", "field-image");
  const mockFieldAudio = createMockElement("input", "field-audio");
  const mockCardEditor = createMockElement("form", "card-editor");

  const mockContext = {
    mediaPreviewContainer: mockMediaPreviewContainer,
    imagePreviewContainer: mockImagePreviewContainer,
    imagePreview: mockImagePreview,
    imageEmptyPlaceholder: mockImageEmptyPlaceholder,
    btnRetakeImage: mockBtnRetakeImage,
    btnClearImage: mockBtnClearImage,
    audioPreviewContainer: mockAudioPreviewContainer,
    audioPreview: mockAudioPreview,
    audioEmptyPlaceholder: mockAudioEmptyPlaceholder,
    btnRetakeAudio: mockBtnRetakeAudio,
    btnClearAudio: mockBtnClearAudio,
    btnReplayAudio: mockBtnReplayAudio,
    audioStatusBadge: mockAudioStatusBadge,
    audioPlaceholderText: mockAudioPlaceholderText,
    btnQuickCaptureFrame: mockBtnQuickCaptureFrame,
    btnQuickRecordAudio: mockBtnQuickRecordAudio,
    fieldImage: mockFieldImage,
    fieldAudio: mockFieldAudio,
    cardEditor: mockCardEditor,
    videoMiningView: { hidden: false },
    tabBtnVideo: { classList: { contains: () => true } },
    currentCaptureId: 10,
    currentDraftMedia: {
      imageBase64: null,
      audioBase64: null,
      mimeType: null,
      captureId: null,
      audioStatus: "idle"
    },
    setStatus: () => {},
    broadcastToActiveVideo: async () => {},
  };

  const mediaBlockStart = jsContent.indexOf("// Media preview management");
  const mediaBlockEnd = jsContent.indexOf("// Progressive disclosure toggle for optional fields");
  const mediaCodeSlice = jsContent.slice(mediaBlockStart, mediaBlockEnd);
  vm.runInNewContext(mediaCodeSlice, mockContext);

  const { updateMediaPreviews, clearAudioMedia } = mockContext;

  // 1. Initial / Idle state
  mockContext.currentDraftMedia.audioStatus = "idle";
  mockContext.currentDraftMedia.audioBase64 = null;
  updateMediaPreviews();
  assert.equal(mockAudioPreview.hidden, true, "Audio player hidden when idle");
  assert.equal(mockAudioEmptyPlaceholder.hidden, false, "Placeholder visible when idle");
  assert.equal(mockBtnReplayAudio.hidden, true, "Replay button hidden when idle");
  assert.equal(mockBtnClearAudio.hidden, true, "Clear button hidden when idle");

  // 2. Audio Pending State (Video paused or playhead ahead of buffer)
  mockContext.currentDraftMedia.audioStatus = "pending";
  mockContext.currentDraftMedia.audioBase64 = null;
  updateMediaPreviews();
  assert.equal(mockAudioPreview.hidden, true, "Audio player hidden while pending");
  assert.equal(mockAudioEmptyPlaceholder.hidden, false, "Placeholder visible while pending");
  assert.equal(mockAudioStatusBadge.hidden, false, "Status badge visible while pending");
  assert.ok(mockAudioStatusBadge.classList.contains("badge-pending"), "Status badge has badge-pending class");
  assert.equal(mockAudioStatusBadge.textContent, "Pending…", "Status badge text is Pending…");
  assert.ok(mockAudioPlaceholderText.textContent.includes("Waiting for playback"), "Placeholder explains pending state");

  // 3. Audio Ready / Available State (WAV extracted)
  mockContext.currentDraftMedia.audioStatus = "available";
  mockContext.currentDraftMedia.audioBase64 = "data:audio/wav;base64,UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  mockContext.currentDraftMedia.mimeType = "audio/wav";
  updateMediaPreviews();
  assert.equal(mockAudioPreview.hidden, false, "Audio player visible when available");
  assert.equal(mockAudioPreview.src, "data:audio/wav;base64,UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
  assert.equal(mockAudioEmptyPlaceholder.hidden, true, "Placeholder hidden when available");
  assert.equal(mockBtnReplayAudio.hidden, false, "Replay button visible when available");
  assert.equal(mockBtnClearAudio.hidden, false, "Clear button visible when available");
  assert.ok(mockAudioStatusBadge.classList.contains("badge-ready"), "Status badge has badge-ready class");
  assert.equal(mockAudioStatusBadge.textContent, "Ready", "Status badge text is Ready");

  // 4. Audio Unavailable State (DRM or hardware restriction)
  mockContext.currentDraftMedia.audioStatus = "unavailable";
  mockContext.currentDraftMedia.audioBase64 = null;
  mockContext.currentDraftMedia.audioError = "DRM_RESTRICTED";
  updateMediaPreviews();
  assert.equal(mockAudioPreview.hidden, true, "Audio player hidden when unavailable");
  assert.equal(mockAudioEmptyPlaceholder.hidden, false, "Placeholder visible when unavailable");
  assert.ok(mockAudioStatusBadge.classList.contains("badge-unavailable"), "Status badge has badge-unavailable class");
  assert.equal(mockAudioStatusBadge.textContent, "DRM Restricted", "Status badge displays DRM Restricted");

  // 5. Audio Expired State (>30s buffer expiration)
  mockContext.currentDraftMedia.audioStatus = "expired";
  mockContext.currentDraftMedia.audioBase64 = null;
  updateMediaPreviews();
  assert.ok(mockAudioStatusBadge.classList.contains("badge-expired"), "Status badge has badge-expired class");
  assert.equal(mockAudioStatusBadge.textContent, "Expired (>30s)", "Status badge displays Expired (>30s)");

  // 6. Audio Discontinuity State (Seek before pending capture finished)
  mockContext.currentDraftMedia.audioStatus = "discontinuity";
  mockContext.currentDraftMedia.audioBase64 = null;
  updateMediaPreviews();
  assert.ok(mockAudioStatusBadge.classList.contains("badge-discontinuity"), "Status badge has badge-discontinuity class");
  assert.equal(mockAudioStatusBadge.textContent, "Discontinuity", "Status badge displays Discontinuity");

  // 7. Clear Audio Action
  mockContext.currentDraftMedia.audioStatus = "available";
  mockContext.currentDraftMedia.audioBase64 = "data:audio/wav;base64,SOMEDATA";
  mockFieldAudio.value = "test_audio.wav";
  updateMediaPreviews();

  clearAudioMedia();
  assert.equal(mockContext.currentDraftMedia.audioBase64, null, "Audio base64 cleared");
  assert.equal(mockContext.currentDraftMedia.audioStatus, "idle", "Audio status reset to idle");
  assert.equal(mockFieldAudio.value, "", "Field audio input cleared");
  assert.equal(mockAudioPreview.hidden, true, "Audio player hidden after clear");

  console.log("PASS: Draft Audio state transitions (available, pending, unavailable, expired, discontinuity, clear) verified.");
}

// -------------------------------------------------------------
// 3. Message Handling & Card Draft Updates
// -------------------------------------------------------------
function testMessageHandlingAndDraftUpdates() {
  const mockCardEditor = createMockElement("form", "card-editor");
  const mockFieldAudio = createMockElement("input", "field-audio");
  const mockFieldImage = createMockElement("input", "field-image");
  const mockAudioPreview = createMockElement("audio", "audio-preview");
  const mockAudioEmptyPlaceholder = createMockElement("div", "audio-empty-placeholder");
  const mockBtnReplayAudio = createMockElement("button", "btn-replay-audio");
  const mockBtnClearAudio = createMockElement("button", "btn-clear-audio");
  const mockAudioStatusBadge = createMockElement("span", "audio-status-badge");
  const mockAudioPlaceholderText = createMockElement("span", "audio-placeholder-text");
  const mockMediaPreviewContainer = createMockElement("div", "media-preview-container");
  const mockImagePreviewContainer = createMockElement("div", "image-preview-container");
  const mockImagePreview = createMockElement("img", "image-preview");
  const mockImageEmptyPlaceholder = createMockElement("div", "image-empty-placeholder");
  const mockBtnRetakeImage = createMockElement("button", "btn-retake-image");
  const mockBtnClearImage = createMockElement("button", "btn-clear-image");
  const mockAudioPreviewContainer = createMockElement("div", "audio-preview-container");
  const mockBtnRetakeAudio = createMockElement("button", "btn-retake-audio");

  let registeredListener = null;
  const mockChrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => { registeredListener = fn; }
      }
    }
  };

  const context = {
    chrome: mockChrome,
    currentCaptureId: 100,
    currentDraftMedia: {
      imageBase64: null,
      audioBase64: null,
      mimeType: null,
      captureId: null,
      audioStatus: "idle"
    },
    cardEditor: mockCardEditor,
    fieldImage: mockFieldImage,
    fieldAudio: mockFieldAudio,
    imagePreviewContainer: mockImagePreviewContainer,
    imagePreview: mockImagePreview,
    imageEmptyPlaceholder: mockImageEmptyPlaceholder,
    btnRetakeImage: mockBtnRetakeImage,
    btnClearImage: mockBtnClearImage,
    audioPreviewContainer: mockAudioPreviewContainer,
    audioPreview: mockAudioPreview,
    audioEmptyPlaceholder: mockAudioEmptyPlaceholder,
    btnRetakeAudio: mockBtnRetakeAudio,
    btnClearAudio: mockBtnClearAudio,
    btnReplayAudio: mockBtnReplayAudio,
    audioStatusBadge: mockAudioStatusBadge,
    audioPlaceholderText: mockAudioPlaceholderText,
    mediaPreviewContainer: mockMediaPreviewContainer,
    updateMediaPreviews: () => {},
    setStatus: () => {},
    identify: () => {},
    updateOffsetDisplay: () => {},
  };

  const listenerStart = jsContent.indexOf("chrome.runtime.onMessage.addListener");
  const listenerEnd = jsContent.indexOf("if (typeof chrome !== \"undefined\" && chrome.storage?.onChanged)");
  const listenerSrc = jsContent.slice(listenerStart, listenerEnd);
  vm.runInNewContext(listenerSrc, context);

  assert.ok(typeof registeredListener === "function", "Message listener registered");

  // Receive AUDIO_CAPTURE_STATUS PENDING for current captureId
  let resStatus = null;
  registeredListener({
    type: "AUDIO_CAPTURE_STATUS",
    status: "PENDING",
    captureId: 100
  }, null, (res) => { resStatus = res; });

  assert.equal(resStatus?.ok, true);
  assert.equal(context.currentDraftMedia.audioStatus, "pending");

  // Receive AUDIO_CAPTURED with matching captureId
  let resCaptured = null;
  registeredListener({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,WAV_PAYLOAD_100",
    mimeType: "audio/wav",
    captureId: 100
  }, null, (res) => { resCaptured = res; });

  assert.equal(resCaptured?.ok, true);
  assert.equal(context.currentDraftMedia.audioStatus, "available");
  assert.equal(context.currentDraftMedia.audioBase64, "data:audio/wav;base64,WAV_PAYLOAD_100");
  assert.equal(context.currentDraftMedia.mimeType, "audio/wav");
  assert.equal(mockFieldAudio.value, "captured_audio.wav");

  // Receive Stale captureId (must not overwrite current draft)
  let resStale = null;
  registeredListener({
    type: "AUDIO_CAPTURED",
    dataUrl: "data:audio/wav;base64,STALE_WAV",
    mimeType: "audio/wav",
    captureId: 99
  }, null, (res) => { resStale = res; });

  assert.equal(resStale?.ok, false);
  assert.equal(resStale?.error, "STALE_CAPTURE");
  assert.equal(context.currentDraftMedia.audioBase64, "data:audio/wav;base64,WAV_PAYLOAD_100", "Stale capture did not overwrite draft");

  console.log("PASS: Side Panel AUDIO_CAPTURE_STATUS and AUDIO_CAPTURED message handling verified.");
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
function runAllTests() {
  testSidepanelAudioDOMContracts();
  testDraftAudioStateTransitions();
  testMessageHandlingAndDraftUpdates();

  console.log("\n>>> ALL STAGE 4 CARD DRAFT AUDIO TESTS PASSED! <<<\n");
}

runAllTests();
