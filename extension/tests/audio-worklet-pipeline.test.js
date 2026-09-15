const assert = require("node:assert/strict");
const path = require("node:path");
const { PCMRecorderProcessor } = require("../offscreen/pcm-worklet-processor.js");
const { PersistentAudioCaptureEngine, CaptureState } = require("../offscreen/offscreen.js");

console.log("Starting AudioWorklet PCM Pipeline Tests...\n");

function testPCMRecorderProcessorMonoDownmixing() {
  const transferredBlocks = [];

  class MockPort {
    constructor() {
      this.onmessage = null;
    }
    postMessage(data, transferList) {
      assert.ok(Array.isArray(transferList) && transferList.includes(data), "MessagePort.postMessage must transfer ArrayBuffer");
      transferredBlocks.push(new Float32Array(data));
    }
  }

  // 1. Stereo input downmixing
  const processor = new PCMRecorderProcessor({ processorOptions: { blockSize: 256 } });
  processor.port = new MockPort();

  // Create 2 stereo 128-sample chunks (256 samples total -> exactly 1 block)
  const leftChunk1 = new Float32Array(128).fill(0.8);
  const rightChunk1 = new Float32Array(128).fill(0.4);
  const leftChunk2 = new Float32Array(128).fill(0.6);
  const rightChunk2 = new Float32Array(128).fill(0.2);

  processor.process([[leftChunk1, rightChunk1]], [], {});
  assert.equal(transferredBlocks.length, 0, "Should not transfer until blockSize (256) reached");

  processor.process([[leftChunk2, rightChunk2]], [], {});
  assert.equal(transferredBlocks.length, 1, "Should transfer 1 block of 256 samples");

  const block = transferredBlocks[0];
  assert.equal(block.length, 256);
  // (0.8 + 0.4) / 2 = 0.6 for first 128 samples
  for (let i = 0; i < 128; i++) {
    assert.equal(Math.round(block[i] * 100) / 100, 0.6);
  }
  // (0.6 + 0.2) / 2 = 0.4 for second 128 samples
  for (let i = 128; i < 256; i++) {
    assert.equal(Math.round(block[i] * 100) / 100, 0.4);
  }

  // 2. Mono input passthrough
  transferredBlocks.length = 0;
  const monoChunk1 = new Float32Array(128).fill(0.75);
  const monoChunk2 = new Float32Array(128).fill(0.25);
  processor.process([[monoChunk1]], [], {});
  processor.process([[monoChunk2]], [], {});

  assert.equal(transferredBlocks.length, 1);
  assert.equal(transferredBlocks[0][0], 0.75);
  assert.equal(transferredBlocks[0][128], 0.25);

  console.log("PASS: PCMRecorderProcessor mono downmixing and block transfer verified.");
}

async function testPersistentAudioCaptureEngineLifecycle() {
  let tracksStopped = false;
  let audioContextCreated = false;
  let audioContextClosed = false;
  let audioSourceDestinationConnected = false;
  let workletNodeConnected = false;
  let workletModuleAdded = false;

  const mockTrack = {
    kind: "audio",
    stop: () => { tracksStopped = true; }
  };

  const mockStream = {
    getTracks: () => [mockTrack],
    getAudioTracks: () => [mockTrack]
  };

  class MockAudioContext {
    constructor() {
      audioContextCreated = true;
      this.sampleRate = 48000;
      this.state = "running";
      this.destination = { id: "speakers-destination" };
      this.audioWorklet = {
        addModule: async (url) => {
          workletModuleAdded = true;
        }
      };
      this._listeners = {};
    }
    addEventListener(evt, fn) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
    }
    createMediaStreamSource(stream) {
      assert.equal(stream, mockStream);
      return {
        connect: (dest) => {
          if (dest === this.destination) {
            audioSourceDestinationConnected = true;
          } else {
            workletNodeConnected = true;
          }
        },
        disconnect: () => {}
      };
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      audioContextClosed = true;
      this.state = "closed";
    }
  }

  class MockAudioWorkletNode {
    constructor(context, name, options) {
      assert.equal(name, "pcm-recorder-processor");
      this.port = {
        onmessage: null,
        postMessage: () => {}
      };
    }
    disconnect() {}
  }

  const mockGetUserMedia = async (constraints) => {
    assert.deepEqual(constraints.audio.mandatory, {
      chromeMediaSource: "tab",
      chromeMediaSourceId: "active-stream-123"
    });
    return mockStream;
  };

  const engine = new PersistentAudioCaptureEngine({
    getUserMedia: mockGetUserMedia,
    AudioContextClass: MockAudioContext,
    AudioWorkletNodeClass: MockAudioWorkletNode
  });

  assert.equal(engine.getState(), CaptureState.IDLE);

  // 1. Start Capture
  const startRes = await engine.startCapture({ streamId: "active-stream-123" });
  assert.equal(startRes.ok, true);
  assert.equal(engine.getState(), CaptureState.CAPTURING);
  assert.ok(audioContextCreated, "AudioContext must be created");
  assert.ok(audioSourceDestinationConnected, "Audio mirroring to speakers must be established");
  assert.ok(workletModuleAdded, "AudioWorklet module must be loaded");
  assert.ok(workletNodeConnected, "Media stream must be connected to worklet");

  // 2. Simulate incoming PCM blocks from worklet
  const testBlock1 = new Float32Array(2048).fill(0.5);
  const testBlock2 = new Float32Array(2048).fill(0.8);
  engine.pcmWorkletNode.port.onmessage({ data: testBlock1.buffer });
  engine.pcmWorkletNode.port.onmessage({ data: testBlock2.buffer });

  const stats = engine.getStats();
  assert.equal(stats.state, CaptureState.CAPTURING);
  assert.equal(stats.activeStreamId, "active-stream-123");
  assert.equal(stats.isMirroring, true);
  assert.equal(stats.totalSamplesWritten, 4096);
  assert.equal(stats.availableSamples, 4096);

  // 3. Stop Capture
  const stopRes = await engine.stopCapture();
  assert.equal(stopRes.ok, true);
  assert.equal(engine.getState(), CaptureState.STOPPED);
  assert.ok(tracksStopped, "Tracks must be stopped on capture stop");
  assert.ok(audioContextClosed, "AudioContext must be closed on capture stop");
  assert.equal(engine.isMirroring, false);

  console.log("PASS: PersistentAudioCaptureEngine lifecycle and speaker mirroring verified.");
}

async function testPersistentAudioCaptureEngineDrmError() {
  const mockDrmGetUserMedia = async () => {
    const err = new Error("DRM restricted audio");
    err.name = "NotAllowedError";
    throw err;
  };

  const engine = new PersistentAudioCaptureEngine({
    getUserMedia: mockDrmGetUserMedia,
    AudioContextClass: class {},
    AudioWorkletNodeClass: class {}
  });

  const res = await engine.startCapture({ streamId: "drm-stream" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "DRM_AUDIO_RESTRICTED");
  assert.equal(engine.getState(), CaptureState.ERROR);

  console.log("PASS: PersistentAudioCaptureEngine DRM error handling verified.");
}

async function runAll() {
  testPCMRecorderProcessorMonoDownmixing();
  await testPersistentAudioCaptureEngineLifecycle();
  await testPersistentAudioCaptureEngineDrmError();
  console.log("\n>>> ALL AUDIOWORKLET PIPELINE TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAll();
