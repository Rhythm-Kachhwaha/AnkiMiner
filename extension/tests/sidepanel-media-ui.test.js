const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Side Panel Media UI & Mining Triggers tests (Step 3)...");

// 1. Verify DOM elements exist in sidepanel.html
const htmlPath = fs.existsSync("extension/sidepanel/sidepanel.html")
  ? "extension/sidepanel/sidepanel.html"
  : path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="media-preview-container"'), "Media preview container must exist in HTML");
assert.ok(html.includes('id="image-preview-container"'), "Image preview container must exist in HTML");
assert.ok(html.includes('id="image-preview"'), "Image preview <img> element must exist in HTML");
assert.ok(html.includes('id="image-empty-placeholder"'), "Image empty placeholder must exist in HTML");
assert.ok(html.includes('id="btn-clear-image"'), "Clear image button must exist in HTML");

assert.ok(html.includes('id="audio-preview-container"'), "Audio preview container must exist in HTML");
assert.ok(html.includes('id="audio-preview"'), "Audio preview <audio> element must exist in HTML");
assert.ok(html.includes('id="audio-empty-placeholder"'), "Audio empty placeholder must exist in HTML");
assert.ok(html.includes('id="btn-clear-audio"'), "Clear audio button must exist in HTML");

// Stage 7: Verify manual capture buttons are removed
assert.ok(!html.includes('id="btn-retake-image"'), "Manual retake screenshot button must be removed in Stage 7");
assert.ok(!html.includes('id="btn-retake-audio"'), "Manual re-record audio button must be removed in Stage 7");
assert.ok(!html.includes('id="btn-quick-capture-frame"'), "Quick capture frame button must be removed in Stage 7");
assert.ok(!html.includes('id="btn-quick-record-audio"'), "Quick record audio button must be removed in Stage 7");

// Auto capture checkboxes in video mining view
assert.ok(html.includes('id="toggle-auto-capture-frame"'), "Auto-capture frame checkbox must exist in HTML");
assert.ok(html.includes('id="toggle-auto-capture-audio"'), "Auto-capture audio checkbox must exist in HTML");

// Verify accessible labels and attributes
assert.ok(html.includes('aria-label="Remove image"'), "Remove image button has accessible label");
assert.ok(html.includes('aria-label="Remove audio"'), "Remove audio button has accessible label");
assert.ok(html.includes('alt="Captured video frame"'), "Image preview has descriptive alt text");

// Stage 7: Verify layout reordering (Card editor positioned ABOVE dictionary section)
const cardEditorIdx = html.indexOf('id="card-editor-section"');
const dictSectionIdx = html.indexOf('id="dictionary-section"');
assert.ok(cardEditorIdx !== -1 && dictSectionIdx !== -1, "Both card editor and dictionary sections must exist");
assert.ok(cardEditorIdx < dictSectionIdx, "Card editor must be positioned above dictionary section");

console.log("PASS: Side Panel HTML media preview DOM contracts verified.");

// 2. Verify CSS styles exist in sidepanel.css
const cssPath = fs.existsSync("extension/sidepanel/sidepanel.css")
  ? "extension/sidepanel/sidepanel.css"
  : path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".media-preview-container"), "CSS includes .media-preview-container");
assert.ok(css.includes(".media-preview-card"), "CSS includes .media-preview-card");
assert.ok(css.includes(".media-thumbnail"), "CSS includes .media-thumbnail");
assert.ok(css.includes(".media-audio-player"), "CSS includes .media-audio-player");
assert.ok(css.includes(".media-empty-placeholder"), "CSS includes .media-empty-placeholder");
assert.ok(css.includes(".video-auto-capture-options"), "CSS includes .video-auto-capture-options");
assert.ok(css.includes(".auto-capture-checkbox-label"), "CSS includes .auto-capture-checkbox-label");
assert.ok(css.includes("max-height: 90px;"), "Thumbnail max-height is constrained to 90px");
assert.ok(css.includes("height: 28px;"), "Audio player height is constrained to 28px");

console.log("PASS: Side Panel CSS media preview styles verified.");

// 3. Test media preview state machine and helper functions in isolated vm context
const jsPath = fs.existsSync("extension/sidepanel/sidepanel.js")
  ? "extension/sidepanel/sidepanel.js"
  : path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

// Mock DOM elements
function createMockElement(tag, id = "") {
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

const mockBtnQuickCaptureFrame = createMockElement("button", "btn-quick-capture-frame");
const mockBtnQuickRecordAudio = createMockElement("button", "btn-quick-record-audio");

const mockFieldImage = createMockElement("input", "field-image");
const mockFieldAudio = createMockElement("input", "field-audio");
const mockCardEditor = createMockElement("form", "card-editor");

let broadcastMessages = [];
let statusLogs = [];

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
    captureId: null
  },
  setStatus: (msg) => { statusLogs.push(msg); },
  broadcastToActiveVideo: async (msg) => {
    broadcastMessages.push(msg);
  },
};

// Extract the media preview management block
const mediaBlockStart = jsContent.indexOf("// Media preview management");
const mediaBlockEnd = jsContent.indexOf("// Progressive disclosure toggle for optional fields");
assert.ok(mediaBlockStart !== -1, "Media preview management section must exist in sidepanel.js");
assert.ok(mediaBlockEnd !== -1, "Progressive disclosure section must exist in sidepanel.js");

const mediaCodeSlice = jsContent.slice(mediaBlockStart, mediaBlockEnd);
vm.runInNewContext(mediaCodeSlice, mockContext);

const {
  updateMediaPreviews,
  clearImageMedia,
  clearAudioMedia,
  clearAllMedia,
  retakeScreenshot,
  retakeAudio,
  captureOrRetakeScreenshot,
  recordOrRetakeAudio
} = mockContext;

// Initial state: placeholders visible, image/audio elements hidden, clear buttons hidden
updateMediaPreviews();
assert.equal(mockImagePreview.hidden, true, "Image element hidden initially");
assert.equal(mockImageEmptyPlaceholder.hidden, false, "Image placeholder visible initially");
assert.equal(mockBtnClearImage.hidden, true, "Clear image button hidden initially");

assert.equal(mockAudioPreview.hidden, true, "Audio element hidden initially");
assert.equal(mockAudioEmptyPlaceholder.hidden, false, "Audio placeholder visible initially");
assert.equal(mockBtnClearAudio.hidden, true, "Clear audio button hidden initially");
assert.equal(mockMediaPreviewContainer.hidden, false, "Media preview container remains visible for user actions");

// Add image to draft
mockContext.currentDraftMedia.imageBase64 = "data:image/jpeg;base64,mockimagedata";
updateMediaPreviews();
assert.equal(mockImagePreview.hidden, false, "Image element visible when image present");
assert.equal(mockImagePreview.src, "data:image/jpeg;base64,mockimagedata");
assert.equal(mockImageEmptyPlaceholder.hidden, true, "Image placeholder hidden when image present");
assert.equal(mockBtnClearImage.hidden, false, "Clear image button visible");

// Add audio to draft
mockContext.currentDraftMedia.audioBase64 = "data:audio/webm;base64,mockaudiodata";
mockContext.currentDraftMedia.mimeType = "audio/webm";
updateMediaPreviews();
assert.equal(mockAudioPreview.hidden, false, "Audio element visible when audio present");
assert.equal(mockAudioPreview.src, "data:audio/webm;base64,mockaudiodata");
assert.equal(mockAudioEmptyPlaceholder.hidden, true, "Audio placeholder hidden when audio present");
assert.equal(mockBtnClearAudio.hidden, false, "Clear audio button visible");

// Clear image
mockFieldImage.value = "test_image.jpg";
clearImageMedia();
assert.equal(mockContext.currentDraftMedia.imageBase64, null, "currentDraftMedia.imageBase64 is null after clear");
assert.equal(mockFieldImage.value, "", "fieldImage input cleared after clear");
assert.equal(mockImagePreview.hidden, true, "Image element hidden after clear");
assert.equal(mockImageEmptyPlaceholder.hidden, false, "Image placeholder restored after clear");
assert.equal(mockBtnClearImage.hidden, true);

// Clear audio
mockFieldAudio.value = "test_audio.webm";
clearAudioMedia();
assert.equal(mockContext.currentDraftMedia.audioBase64, null, "currentDraftMedia.audioBase64 is null after clear");
assert.equal(mockFieldAudio.value, "", "fieldAudio input cleared after clear");
assert.equal(mockAudioPreview.hidden, true, "Audio element hidden after clear");
assert.equal(mockAudioEmptyPlaceholder.hidden, false, "Audio placeholder restored after clear");
assert.equal(mockBtnClearAudio.hidden, true);

// Test clearAllMedia
mockContext.currentDraftMedia.imageBase64 = "data:image/jpeg;base64,xyz";
mockContext.currentDraftMedia.audioBase64 = "data:audio/webm;base64,abc";
updateMediaPreviews();
assert.equal(mockImagePreview.hidden, false);
assert.equal(mockAudioPreview.hidden, false);
clearAllMedia();
assert.equal(mockContext.currentDraftMedia.imageBase64, null);
assert.equal(mockContext.currentDraftMedia.audioBase64, null);
assert.equal(mockImagePreview.hidden, true);
assert.equal(mockAudioPreview.hidden, true);

console.log("PASS: Media preview state transitions and clear actions verified.");

// 4. Test Retake Triggers and Card Editor unhiding
mockCardEditor.hidden = true;
broadcastMessages = [];
captureOrRetakeScreenshot();
assert.equal(mockCardEditor.hidden, false, "Card editor unhidden on capture trigger");
assert.equal(broadcastMessages.length, 1);
assert.equal(broadcastMessages[0].type, "TRIGGER_VIDEO_SCREENSHOT");
assert.equal(broadcastMessages[0].options?.maxWidth, 640);
assert.equal(broadcastMessages[0].options?.maxHeight, 360);

recordOrRetakeAudio();
assert.equal(broadcastMessages.length, 2);
assert.equal(broadcastMessages[1].type, "TRIGGER_AUDIO_RECORDING");

console.log("PASS: Retake triggers dispatch expected background actions.");

// 5. Test Runtime Message Listener Integration
let messageListener = null;
const mockChrome = {
  runtime: {
    onMessage: {
      addListener(fn) { messageListener = fn; }
    },
    sendMessage: async () => ({ ok: true })
  }
};

const listenerContext = {
  chrome: mockChrome,
  currentCaptureId: 42,
  currentDraftMedia: {
    imageBase64: null,
    audioBase64: null,
    mimeType: null,
    captureId: null
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
  mediaPreviewContainer: mockMediaPreviewContainer,
  updateMediaPreviews: () => {
    mockContext.currentDraftMedia = listenerContext.currentDraftMedia;
    updateMediaPreviews();
  },
  setStatus: (msg) => { statusLogs.push(msg); },
  identify: () => {},
  updateOffsetDisplay: () => {},
};

const listenerStart = jsContent.indexOf("chrome.runtime.onMessage.addListener");
const listenerEnd = jsContent.indexOf("if (typeof chrome !== \"undefined\" && chrome.storage?.onChanged)");
assert.ok(listenerStart !== -1 && listenerEnd !== -1);
const listenerSrc = jsContent.slice(listenerStart, listenerEnd);
vm.runInNewContext(listenerSrc, listenerContext);

assert.ok(typeof messageListener === "function", "Message listener was registered");

// Test SCREENSHOT_CAPTURED with matching captureId
mockCardEditor.hidden = true;
mockFieldImage.value = "";
let responded = null;
messageListener({
  type: "SCREENSHOT_CAPTURED",
  dataUrl: "data:image/jpeg;base64,capturedframe123",
  captureId: 42
}, null, (res) => { responded = res; });

assert.equal(responded?.ok, true);
assert.equal(listenerContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,capturedframe123");
assert.equal(mockCardEditor.hidden, false, "Card editor unhidden when screenshot arrives");
assert.equal(mockFieldImage.value, "captured_frame.jpg", "fieldImage populated with fallback filename");

// Test SCREENSHOT_CAPTURED with STALE captureId
responded = null;
messageListener({
  type: "SCREENSHOT_CAPTURED",
  dataUrl: "data:image/jpeg;base64,staleframe",
  captureId: 999 // Mismatched ID
}, null, (res) => { responded = res; });

assert.equal(responded?.ok, false);
assert.equal(responded?.error, "STALE_CAPTURE");
assert.equal(listenerContext.currentDraftMedia.imageBase64, "data:image/jpeg;base64,capturedframe123", "Stale frame did not overwrite current draft");

// Test AUDIO_CAPTURED with matching captureId
mockFieldAudio.value = "";
responded = null;
messageListener({
  type: "AUDIO_CAPTURED",
  dataUrl: "data:audio/webm;base64,capturedaudio456",
  mimeType: "audio/webm;codecs=opus",
  captureId: 42
}, null, (res) => { responded = res; });

assert.equal(responded?.ok, true);
assert.equal(listenerContext.currentDraftMedia.audioBase64, "data:audio/webm;base64,capturedaudio456");
assert.equal(listenerContext.currentDraftMedia.mimeType, "audio/webm;codecs=opus");
assert.equal(mockFieldAudio.value, "captured_audio.webm", "fieldAudio populated with fallback filename");

// Test AUDIO_CAPTURED with STALE captureId
responded = null;
messageListener({
  type: "AUDIO_CAPTURED",
  dataUrl: "data:audio/webm;base64,staleaudio",
  captureId: 999
}, null, (res) => { responded = res; });

assert.equal(responded?.ok, false);
assert.equal(responded?.error, "STALE_CAPTURE");
assert.equal(listenerContext.currentDraftMedia.audioBase64, "data:audio/webm;base64,capturedaudio456", "Stale audio did not overwrite current draft");

console.log("PASS: Message listener correctly handles SCREENSHOT_CAPTURED, AUDIO_CAPTURED, and stale capture prevention.");

// 6. Test Card Save Payload Formulation
assert.ok(jsContent.includes("image_data: currentDraftMedia.imageBase64 || null"), "Save payload includes image_data");
assert.ok(jsContent.includes("audio_data: currentDraftMedia.audioBase64 || null"), "Save payload includes audio_data");
assert.ok(jsContent.includes("media_mime_type: currentDraftMedia.mimeType || null"), "Save payload includes media_mime_type");

console.log("PASS: Card editor save payload correctly passes binary media fields.");

console.log("\n>>> ALL STEP 3 SIDE PANEL MEDIA UI TESTS PASSED SUCCESSFULLY! <<<\n");
