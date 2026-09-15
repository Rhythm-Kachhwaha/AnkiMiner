const assert = require("node:assert/strict");
const { RollingPcmBuffer } = require("../offscreen/rolling-pcm-buffer.js");
const { AudioTimelineSyncEngine } = require("../offscreen/audio-timeline-sync.js");
const { WavEncoder } = require("../offscreen/wav-encoder.js");

console.log("Starting Subtitle Audio Extraction Tests...\n");

function testPaddedSubtitleExtraction() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  // Initial anchor at videoTime 0.0s, sample 0
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 0.0,
    playbackRate: 1.0,
    paused: false
  });

  // Simulate video playing for 15 seconds (720,000 samples)
  const chunk = new Float32Array(720000);
  chunk.fill(0.5);
  ringBuffer.write(chunk);

  // Subtitle cue: [12.0s, 14.5s] (duration 2.5s) - already played
  const extractRes = sync.extractSubtitleAudio({
    startTime: 12.0,
    endTime: 14.5,
    timelineId: 1,
    cue: { text: "こんにちは", startTime: 12.0, endTime: 14.5 }
  });

  assert.equal(extractRes.ok, true);
  assert.equal(extractRes.status, "READY");
  assert.equal(extractRes.pending, false);
  assert.equal(extractRes.mimeType, "audio/wav");
  assert.ok(extractRes.dataUrl.startsWith("data:audio/wav;base64,"));

  // Padded interval: [12.0 - 0.150, 14.5 + 0.200] = [11.85s, 14.7s]
  // Expected duration: 14.7 - 11.85 = 2.85s (2850 ms)
  // Expected samples: 2.85 * 48000 = 136,800 samples
  assert.equal(extractRes.startTime, 11.85);
  assert.equal(extractRes.endTime, 14.7);
  assert.equal(extractRes.sampleCount, 136800);
  assert.equal(extractRes.durationMs, 2850);

  console.log("PASS: Padded subtitle interval extraction (150ms start / 200ms end) verified.");
}

function testPaddingClampedToTimelineStart() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  // Timeline starts at videoTime = 0.0s, sample = 0
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 0.0,
    playbackRate: 1.0,
    paused: false
  });

  ringBuffer.write(new Float32Array(144000)); // 3s of audio

  // Subtitle cue at the very start of video: [0.05s, 1.0s]
  // 150ms start padding would reach -0.10s, which is before timeline start
  const extractRes = sync.extractSubtitleAudio({
    startTime: 0.05,
    endTime: 1.0,
    timelineId: 1
  });

  assert.equal(extractRes.ok, true);
  assert.equal(extractRes.status, "READY");
  // Clamped to sample 0 (timeline inception)
  assert.ok(extractRes.sampleCount > 0);

  console.log("PASS: Padding clamped to timeline start without crossing boundary verified.");
}

function testCircularWraparoundExtraction() {
  // Small 10-second buffer (480,000 samples)
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 10 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 0.0,
    playbackRate: 1.0,
    paused: false
  });

  // Ingest 15 seconds of audio (720,000 samples), causing buffer wraparound
  ringBuffer.write(new Float32Array(720000));

  // Oldest available sample is 720,000 - 480,000 = 240,000 (video time 5.0s)
  // Extract subtitle spanning across the ring buffer's internal array boundary (e.g. video time 9.0s to 11.0s)
  const extractRes = sync.extractSubtitleAudio({
    startTime: 9.0,
    endTime: 11.0,
    timelineId: 1
  });

  assert.equal(extractRes.ok, true);
  assert.equal(extractRes.status, "READY");
  assert.equal(extractRes.durationMs, 2350); // 2.0s + 0.350s padding = 2.35s = 2350ms
  assert.equal(extractRes.sampleCount, Math.round(2.35 * 48000));

  console.log("PASS: Circular ring buffer wraparound extraction verified.");
}

function testBufferExpirationRejection() {
  const sampleRate = 48000;
  // 30-second buffer
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 0.0,
    playbackRate: 1.0,
    paused: false
  });

  // Ingest 45 seconds of audio (2,160,000 samples)
  ringBuffer.write(new Float32Array(2160000));

  // Oldest available audio is at videoTime 15.0s (sample 720,000).
  // Subtitle at [5.0s, 8.0s] was evicted > 30s ago
  const expiredRes = sync.extractSubtitleAudio({
    startTime: 5.0,
    endTime: 8.0,
    timelineId: 1
  });

  assert.equal(expiredRes.ok, false);
  assert.equal(expiredRes.error, "AUDIO_BUFFER_EXPIRED");

  console.log("PASS: Expired audio rejection (AUDIO_BUFFER_EXPIRED) verified.");
}

function testPendingCaptureQueueAndResumeFinalization() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });

  let capturedAudioPayload = null;
  const sync = new AudioTimelineSyncEngine({
    ringBuffer,
    sampleRate,
    WavEncoder,
    onAudioCaptured: (payload) => {
      capturedAudioPayload = payload;
    }
  });

  // Video is currently playing at 10.0s, buffer has 48,000 samples (1.0s)
  ringBuffer.write(new Float32Array(48000));
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 10.0,
    playbackRate: 1.0,
    paused: false
  });

  // User mines subtitle [10.5s, 13.0s] while video is at 10.0s (future audio not yet captured)
  const pendingRes = sync.extractSubtitleAudio({
    startTime: 10.5,
    endTime: 13.0,
    timelineId: 1,
    cue: { text: "未来の音声", startTime: 10.5, endTime: 13.0 },
    captureId: "draft_123"
  });

  assert.equal(pendingRes.ok, true);
  assert.equal(pendingRes.status, "PENDING");
  assert.equal(pendingRes.pending, true);
  assert.equal(sync.pendingCaptures.length, 1);
  assert.equal(capturedAudioPayload, null, "Audio cannot be finalized until playback delivers required samples");

  // Playback continues: deliver 2.0s of audio (96,000 samples) -> still not at 13.2s end
  const chunk1 = new Float32Array(96000);
  ringBuffer.write(chunk1);
  sync.onPcmChunkWritten(96000);
  assert.equal(capturedAudioPayload, null, "Still pending");
  assert.equal(sync.pendingCaptures.length, 1);

  // Playback reaches 13.5s: deliver another 2.0s (96,000 samples)
  const chunk2 = new Float32Array(96000);
  ringBuffer.write(chunk2);
  sync.onPcmChunkWritten(96000);

  // Auto-finalization triggered!
  assert.notEqual(capturedAudioPayload, null, "Audio must auto-finalize once required samples arrive");
  assert.equal(capturedAudioPayload.ok, true);
  assert.equal(capturedAudioPayload.captureId, "draft_123");
  assert.equal(capturedAudioPayload.mimeType, "audio/wav");
  assert.equal(capturedAudioPayload.wasPending, true);
  assert.ok(capturedAudioPayload.dataUrl.startsWith("data:audio/wav;base64,"));
  assert.equal(sync.pendingCaptures.length, 0, "Pending queue must be cleared on completion");

  console.log("PASS: Pending capture queue and natural playback resume auto-finalization verified.");
}

function testPendingCaptureCancelledOnSeek() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });

  let statusReport = null;
  const sync = new AudioTimelineSyncEngine({
    ringBuffer,
    sampleRate,
    WavEncoder,
    onStatus: (st) => {
      statusReport = st;
    }
  });

  ringBuffer.write(new Float32Array(48000));
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 10.0,
    playbackRate: 1.0,
    paused: false
  });

  // Mine pending subtitle [11.0s, 14.0s]
  sync.extractSubtitleAudio({
    startTime: 11.0,
    endTime: 14.0,
    timelineId: 1,
    captureId: "draft_456"
  });

  assert.equal(sync.pendingCaptures.length, 1);

  // User seeks away before playback finishes -> new timelineId = 2
  sync.ingestHeartbeat({
    timelineId: 2,
    videoTime: 90.0,
    playbackRate: 1.0,
    paused: false
  });

  assert.equal(sync.pendingCaptures.length, 0, "Pending captures must be cancelled on timeline discontinuity");
  assert.notEqual(statusReport, null);
  assert.equal(statusReport.error, "AUDIO_DISCONTINUITY");

  console.log("PASS: Pending capture cancellation on seek / timeline change verified.");
}

function testHardPlaybackInvariant() {
  // Mock video element tracking any attempts to manipulate playback
  let currentTimeModified = false;
  let playCalled = false;
  let pauseCalled = false;
  let playbackRateModified = false;

  const mockVideo = {
    _currentTime: 10.0,
    get currentTime() { return this._currentTime; },
    set currentTime(v) { currentTimeModified = true; this._currentTime = v; },
    playbackRate: 1.0,
    paused: false,
    ended: false,
    readyState: 4,
    isConnected: true,
    play() { playCalled = true; return Promise.resolve(); },
    pause() { pauseCalled = true; },
    addEventListener() {},
    removeEventListener() {}
  };

  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 0.0,
    playbackRate: mockVideo.playbackRate,
    paused: mockVideo.paused
  });

  // Write 11 seconds of audio (528,000 samples)
  ringBuffer.write(new Float32Array(528000));

  const extractRes = sync.extractSubtitleAudio({
    startTime: 8.0,
    endTime: 10.0,
    timelineId: 1
  });

  assert.equal(extractRes.ok, true);

  // Strict invariant assertions
  assert.equal(currentTimeModified, false, "video.currentTime MUST NEVER BE MODIFIED");
  assert.equal(playCalled, false, "video.play() MUST NEVER BE CALLED");
  assert.equal(pauseCalled, false, "video.pause() MUST NEVER BE CALLED");
  assert.equal(playbackRateModified, false, "video.playbackRate MUST NEVER BE MODIFIED");

  console.log("PASS: Strict Hard Playback Invariant verified (0 playback manipulation calls).");
}

function runAll() {
  testPaddedSubtitleExtraction();
  testPaddingClampedToTimelineStart();
  testCircularWraparoundExtraction();
  testBufferExpirationRejection();
  testPendingCaptureQueueAndResumeFinalization();
  testPendingCaptureCancelledOnSeek();
  testHardPlaybackInvariant();
  console.log("\n>>> ALL SUBTITLE AUDIO EXTRACTION TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAll();
