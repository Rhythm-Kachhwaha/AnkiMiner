const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// -------------------------------------------------------------
// 1. Verify Manifest Configuration
// -------------------------------------------------------------
function testManifestConfiguration() {
  const manifestPath = path.resolve(__dirname, "../manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.ok(Array.isArray(manifest.permissions), "manifest.permissions must be an array");
  assert.ok(manifest.permissions.includes("tabs"), "manifest.permissions must include 'tabs'");
  assert.ok(manifest.permissions.includes("activeTab"), "manifest.permissions must include 'activeTab'");

  assert.ok(Array.isArray(manifest.host_permissions), "manifest.host_permissions must be an array");
  assert.ok(manifest.host_permissions.includes("<all_urls>"), "manifest.host_permissions must include '<all_urls>'");

  const cs = manifest.content_scripts?.[0];
  assert.ok(cs && Array.isArray(cs.js), "content_scripts must have js array");
  assert.ok(cs.js.includes("lib/image-cropper.js"), "content_scripts must include 'lib/image-cropper.js'");

  const cropperIdx = cs.js.indexOf("lib/image-cropper.js");
  const pocIdx = cs.js.indexOf("content/video-mining-poc.js");
  assert.ok(cropperIdx < pocIdx, "image-cropper.js must be loaded before video-mining-poc.js");

  console.log("PASS: Manifest permissions, host_permissions, and content_scripts order verified.");
}

// -------------------------------------------------------------
// 2. Unit Tests for ImageCropper
// -------------------------------------------------------------
const ImageCropper = require("../lib/image-cropper.js");

function testCalculateCropBounds() {
  // Test 1: Standard 1.0 devicePixelRatio
  const rect1 = { left: 100, top: 50, width: 800, height: 450 };
  const bounds1 = ImageCropper.calculateCropBounds(rect1, 1.0, 1920, 1080);
  assert.deepEqual(bounds1, { x: 100, y: 50, width: 800, height: 450 });

  // Test 2: HiDPI 2.0 devicePixelRatio
  const bounds2 = ImageCropper.calculateCropBounds(rect1, 2.0, 3840, 2160);
  assert.deepEqual(bounds2, { x: 200, y: 100, width: 1600, height: 900 });

  // Test 3: Fractional 1.25 devicePixelRatio
  const bounds3 = ImageCropper.calculateCropBounds(rect1, 1.25, 1920, 1080);
  assert.deepEqual(bounds3, { x: 125, y: 63, width: 1000, height: 563 });

  // Test 4: Partially scrolled off-screen (negative left/top)
  const rectNeg = { left: -50, top: -20, width: 600, height: 400 };
  const boundsNeg = ImageCropper.calculateCropBounds(rectNeg, 1.0, 1920, 1080);
  assert.equal(boundsNeg.x, 0, "Negative left clamped to 0");
  assert.equal(boundsNeg.y, 0, "Negative top clamped to 0");
  assert.equal(boundsNeg.width, 550, "Width adjusted for negative left offset");
  assert.equal(boundsNeg.height, 380, "Height adjusted for negative top offset");

  // Test 5: Clamping to image boundaries
  const rectLarge = { left: 1800, top: 1000, width: 500, height: 500 };
  const boundsClamped = ImageCropper.calculateCropBounds(rectLarge, 1.0, 1920, 1080);
  assert.equal(boundsClamped.x, 1800);
  assert.equal(boundsClamped.y, 1000);
  assert.equal(boundsClamped.width, 120, "Width clamped to imageWidth (1920 - 1800)");
  assert.equal(boundsClamped.height, 80, "Height clamped to imageHeight (1080 - 1000)");

  // Test 6: Invalid/null rect
  const boundsNull = ImageCropper.calculateCropBounds(null, 1.0);
  assert.deepEqual(boundsNull, { x: 0, y: 0, width: 0, height: 0 });

  console.log("PASS: ImageCropper.calculateCropBounds coordinate scaling and clamping verified.");
}

function testCalculateTargetDimensions() {
  // Test 1: Standard 1080p 16:9 downscaling to max 640x360
  const target1 = ImageCropper.calculateTargetDimensions(1920, 1080, 640, 360);
  assert.deepEqual(target1, { width: 640, height: 360 });

  // Test 2: 720p 16:9 downscaling to max 640x360
  const target2 = ImageCropper.calculateTargetDimensions(1280, 720, 640, 360);
  assert.deepEqual(target2, { width: 640, height: 360 });

  // Test 3: Already small (480x270) stays untouched
  const target3 = ImageCropper.calculateTargetDimensions(480, 270, 640, 360);
  assert.deepEqual(target3, { width: 480, height: 270 });

  // Test 4: Vertical video (1080x1920, YouTube Shorts / TikTok)
  const targetVertical = ImageCropper.calculateTargetDimensions(1080, 1920, 640, 360);
  assert.equal(targetVertical.height, 360);
  assert.equal(targetVertical.width, Math.round(1080 * (360 / 1920)));

  // Test 5: Zero or invalid dimensions
  assert.deepEqual(ImageCropper.calculateTargetDimensions(0, 0), { width: 0, height: 0 });

  console.log("PASS: ImageCropper.calculateTargetDimensions aspect-ratio downscaling verified.");
}

function testCheckBlackFrame() {
  // 1. Pure black solid frame (Netflix DRM blanking)
  const blackPixels = new Uint8ClampedArray(100 * 100 * 4); // all 0s
  assert.equal(ImageCropper.checkBlackFrame(blackPixels, 100, 100), true, "Solid black frame detected as DRM");

  // 2. Black with noise (e.g. sensor/compression noise r=1..3)
  for (let i = 0; i < blackPixels.length; i += 4) {
    blackPixels[i] = 2;     // R
    blackPixels[i + 1] = 2; // G
    blackPixels[i + 2] = 2; // B
    blackPixels[i + 3] = 255; // A
  }
  assert.equal(ImageCropper.checkBlackFrame(blackPixels, 100, 100), true, "Noise floor black frame detected as DRM");

  // 3. Normal video frame with visible content
  const normalPixels = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < normalPixels.length; i += 4) {
    normalPixels[i] = 120;
    normalPixels[i + 1] = 80;
    normalPixels[i + 2] = 200;
    normalPixels[i + 3] = 255;
  }
  assert.equal(ImageCropper.checkBlackFrame(normalPixels, 100, 100), false, "Normal video frame not flagged as DRM");

  // 4. Transparent frame (alpha = 0)
  const transparentPixels = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < transparentPixels.length; i += 4) {
    transparentPixels[i] = 255;
    transparentPixels[i + 3] = 0; // alpha = 0
  }
  assert.equal(ImageCropper.checkBlackFrame(transparentPixels, 100, 100), true, "Transparent frame detected as DRM/empty");

  console.log("PASS: ImageCropper.checkBlackFrame DRM and black frame detection verified.");
}

async function testCropVideoFrameEndToEnd() {
  // Create mock image and mock canvas
  const mockImage = {
    naturalWidth: 1920,
    naturalHeight: 1080,
    width: 1920,
    height: 1080
  };

  const drawCalls = [];
  function createMockCanvas(width, height) {
    const pixelBuffer = new Uint8ClampedArray(width * height * 4);
    // Fill with non-black sample data
    for (let i = 0; i < pixelBuffer.length; i += 4) {
      pixelBuffer[i] = 100;
      pixelBuffer[i + 1] = 150;
      pixelBuffer[i + 2] = 200;
      pixelBuffer[i + 3] = 255;
    }

    return {
      width,
      height,
      getContext: () => ({
        drawImage: (...args) => drawCalls.push(args),
        getImageData: (x, y, w, h) => ({ data: pixelBuffer, width: w, height: h })
      }),
      toDataURL: (format, quality) => `data:${format};base64,mockCroppedData_q${quality}`
    };
  }

  const rect = { left: 100, top: 50, width: 1280, height: 720 };
  const res = await ImageCropper.cropVideoFrame("data:image/jpeg;base64,mockViewport", rect, {
    devicePixelRatio: 1.0,
    maxWidth: 640,
    maxHeight: 360,
    quality: 0.95,
    loadImage: async () => mockImage,
    createCanvas: createMockCanvas
  });

  assert.ok(res.ok, "cropVideoFrame should succeed");
  assert.equal(res.width, 640);
  assert.equal(res.height, 360);
  assert.ok(res.dataUrl.startsWith("data:image/jpeg;base64,mockCroppedData_q0.95"));
  assert.equal(drawCalls.length, 1);
  assert.deepEqual(drawCalls[0].slice(1), [100, 50, 1280, 720, 0, 0, 640, 360]);

  // Test DRM detection path
  function createDrmBlackCanvas(width, height) {
    const blackBuffer = new Uint8ClampedArray(width * height * 4); // all 0
    return {
      width,
      height,
      getContext: () => ({
        drawImage: () => {},
        getImageData: (x, y, w, h) => ({ data: blackBuffer, width: w, height: h })
      }),
      toDataURL: () => "data:image/jpeg;base64,black"
    };
  }

  const drmRes = await ImageCropper.cropVideoFrame("data:image/jpeg;base64,mockViewport", rect, {
    loadImage: async () => mockImage,
    createCanvas: createDrmBlackCanvas
  });

  assert.equal(drmRes.ok, false);
  assert.equal(drmRes.error, "DRM_PROTECTED");
  assert.ok(drmRes.message.includes("Protected stream"));

  console.log("PASS: ImageCropper.cropVideoFrame end-to-end execution and DRM error handling verified.");
}

// -------------------------------------------------------------
// 3. Contract Tests for background.js CAPTURE_VIDEO_FRAME
// -------------------------------------------------------------
function testBackgroundCaptureMessage() {
  const bgSrc = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");

  let capturedWindowId = null;
  let capturedOptions = null;
  const messageListeners = [];

  const mockChrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    tabs: {
      query: () => Promise.resolve([{ id: 1, windowId: 42 }]),
      sendMessage: () => Promise.resolve(),
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      captureVisibleTab: (winId, opts) => {
        capturedWindowId = winId;
        capturedOptions = opts;
        return Promise.resolve("data:image/jpeg;base64,tabCapturedOk");
      }
    }
  };

  const context = {
    chrome: mockChrome,
    console,
    fetch: () => Promise.resolve(),
    Boolean
  };

  vm.runInNewContext(bgSrc, context);
  assert.equal(messageListeners.length, 1, "background.js must register message listener");

  const listener = messageListeners[0];
  let responseData = null;
  const handled = listener(
    { type: "CAPTURE_VIDEO_FRAME", format: "jpeg", quality: 90 },
    { tab: { windowId: 99 } },
    (res) => { responseData = res; }
  );

  assert.equal(handled, true, "Listener must return true for async sendResponse");

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(capturedWindowId, 99, "captureVisibleTab received sender windowId");
      assert.equal(capturedOptions?.format, "jpeg");
      assert.equal(capturedOptions?.quality, 90);
      assert.ok(responseData?.ok, "Background returned ok: true");
      assert.equal(responseData.dataUrl, "data:image/jpeg;base64,tabCapturedOk");
      console.log("PASS: background.js CAPTURE_VIDEO_FRAME message handling contract verified.");
      resolve();
    }, 20);
  });
}

// -------------------------------------------------------------
// 4. Contract Tests for VideoMiningPOC.captureCurrentFrame
// -------------------------------------------------------------
async function testVideoMiningPocCaptureFrame() {
  const pocSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");
  const cropperSrc = fs.readFileSync(path.resolve(__dirname, "../lib/image-cropper.js"), "utf8");

  const sentMessages = [];
  const messageListeners = [];

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "CAPTURE_VIDEO_FRAME") {
          return Promise.resolve({ ok: true, dataUrl: "data:image/jpeg;base64,mockViewport" });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    },
    storage: {
      local: {
        get: (_k, cb) => cb?.({}),
        set: () => {}
      }
    }
  };

  const mockVideo = {
    isConnected: true,
    currentTime: 42.5,
    getBoundingClientRect: () => ({ left: 50, top: 100, width: 800, height: 450 })
  };

  class MockMutationObserver {
    observe() {}
    disconnect() {}
  }

  const context = {
    chrome: mockChrome,
    window: {
      devicePixelRatio: 1.0,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    document: {
      body: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelectorAll: () => [],
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        appendChild: () => {},
        setAttribute: () => {},
        addEventListener: () => {},
        removeEventListener: () => {}
      })
    },
    MutationObserver: MockMutationObserver,
    console,
    Boolean,
    Math,
    Promise,
    setTimeout,
    Uint8ClampedArray
  };
  context.globalThis = context;
  context.window.globalThis = context;

  // Load ImageCropper and VideoMiningPOC
  vm.runInNewContext(cropperSrc, context);
  vm.runInNewContext(pocSrc, context);

  const pocInstance = context.window.__ANKIMINER_VIDEO_POC__.instance;
  assert.ok(pocInstance, "VideoMiningPOC instance must exist");
  assert.equal(typeof pocInstance.captureCurrentFrame, "function", "captureCurrentFrame method must exist");

  // Case 1: No active video
  pocInstance.activeVideo = null;
  const noVidRes = await pocInstance.captureCurrentFrame();
  assert.equal(noVidRes.ok, false);
  assert.equal(noVidRes.error, "NO_ACTIVE_VIDEO");

  // Case 2: Active video attached, successful capture
  pocInstance.activeVideo = mockVideo;

  const mockImage = { naturalWidth: 1920, naturalHeight: 1080, width: 1920, height: 1080 };
  const mockCanvas = {
    width: 640,
    height: 360,
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => {
        const buf = new Uint8ClampedArray(640 * 360 * 4);
        for (let i = 0; i < buf.length; i += 4) {
          buf[i] = 128;
          buf[i + 3] = 255;
        }
        return { data: buf, width: 640, height: 360 };
      }
    }),
    toDataURL: () => "data:image/jpeg;base64,successfulCroppedFrame"
  };

  const cropRes = await pocInstance.captureCurrentFrame({
    loadImage: async () => mockImage,
    createCanvas: () => mockCanvas
  });

  assert.ok(cropRes.ok, "captureCurrentFrame should succeed");
  assert.equal(cropRes.dataUrl, "data:image/jpeg;base64,successfulCroppedFrame");

  // Verify SCREENSHOT_CAPTURED broadcast
  const broadcastMsg = sentMessages.find(m => m.type === "SCREENSHOT_CAPTURED");
  assert.ok(broadcastMsg, "SCREENSHOT_CAPTURED broadcast message sent");
  assert.equal(broadcastMsg.dataUrl, "data:image/jpeg;base64,successfulCroppedFrame");
  assert.equal(broadcastMsg.timestamp, 42.5);

  // Case 3: TRIGGER_VIDEO_SCREENSHOT message handler
  let triggerResponse = null;
  const handled = pocInstance.handleMessage(
    {
      type: "TRIGGER_VIDEO_SCREENSHOT",
      options: { loadImage: async () => mockImage, createCanvas: () => mockCanvas }
    },
    null,
    (res) => { triggerResponse = res; }
  );
  assert.equal(handled, true, "TRIGGER_VIDEO_SCREENSHOT handled asynchronously");

  await new Promise(r => setTimeout(r, 20));
  assert.ok(triggerResponse?.ok, "TRIGGER_VIDEO_SCREENSHOT responded with ok: true");
  assert.equal(triggerResponse.dataUrl, "data:image/jpeg;base64,successfulCroppedFrame");

  console.log("PASS: VideoMiningPOC.captureCurrentFrame and TRIGGER_VIDEO_SCREENSHOT verified.");
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
(async () => {
  console.log("Starting Screenshot Capture & ImageCropper Tests...");
  testManifestConfiguration();
  testCalculateCropBounds();
  testCalculateTargetDimensions();
  testCheckBlackFrame();
  await testCropVideoFrameEndToEnd();
  await testBackgroundCaptureMessage();
  await testVideoMiningPocCaptureFrame();
  console.log("\n>>> ALL SCREENSHOT CAPTURE VERIFICATION TESTS PASSED SUCCESSFULLY! <<<\n");
})();
