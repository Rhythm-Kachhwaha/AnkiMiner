const assert = require("node:assert/strict");
const { RollingPcmBuffer } = require("../offscreen/rolling-pcm-buffer.js");
const { AudioTimelineSyncEngine } = require("../offscreen/audio-timeline-sync.js");
const { WavEncoder } = require("../offscreen/wav-encoder.js");

console.log("Starting Audio Timeline Synchronization Tests...\n");

function testInitialAnchorEstablishment() {
  const ringBuffer = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate: 48000 });

  // Before any heartbeat, sync is uninitialized
  assert.equal(sync.currentTimelineId, null);
  const uninitMap = sync.videoTimeToSample(10.0);
  assert.equal(uninitMap.ok, false);
  assert.equal(uninitMap.error, "AUDIO_SYNC_UNAVAILABLE");

  // Ingest initial heartbeat at video.currentTime = 5.0, buffer has 48,000 samples (1.0s)
  ringBuffer.write(new Float32Array(48000));
  const res = sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 5.0,
    wallClock: 1000,
    playbackRate: 1.0,
    paused: false
  });

  assert.equal(res.ok, true);
  assert.equal(res.reanchored, true);
  assert.equal(res.reason, "TIMELINE_DISCONTINUITY");
  assert.equal(sync.currentTimelineId, 1);
  assert.equal(sync.anchorVideoTime, 5.0);
  assert.equal(sync.anchorSample, 48000);
  assert.equal(sync.timelineStartSample, 0, "timelineStartSample must account for prior video time in buffer");

  // Test mapping: Video time 5.0s maps to sample 48,000
  const map5 = sync.videoTimeToSample(5.0);
  assert.equal(map5.ok, true);
  assert.equal(map5.sample, 48000);

  // Video time 6.0s (+1.0s) maps to sample 48,000 + 48,000 = 96,000
  const map6 = sync.videoTimeToSample(6.0);
  assert.equal(map6.ok, true);
  assert.equal(map6.sample, 96000);

  // Inverse mapping: sample 96,000 maps to video time 6.0s
  const timeMap96k = sync.sampleToVideoTime(96000);
  assert.equal(timeMap96k.ok, true);
  assert.equal(timeMap96k.videoTime, 6.0);

  console.log("PASS: Initial anchor establishment and bi-directional time mapping verified.");
}

function testPlaybackRateScaling() {
  const ringBuffer = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate: 48000 });

  // 1.5x Playback Rate
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 10.0,
    playbackRate: 1.5,
    paused: false
  });

  // At 1.5x speed, 1.0s of video time corresponds to (1.0 / 1.5)s = 0.6667s of audio = 32,000 samples
  const map11 = sync.videoTimeToSample(11.0);
  assert.equal(map11.ok, true);
  assert.equal(map11.sample, 32000, "1.0s video advance @ 1.5x = 32,000 samples");

  const timeMap32k = sync.sampleToVideoTime(32000);
  assert.equal(timeMap32k.ok, true);
  assert.equal(timeMap32k.videoTime, 11.0);

  // 0.5x Playback Rate
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 10.0,
    playbackRate: 0.5,
    paused: false
  });

  // At 0.5x speed, 1.0s of video time corresponds to (1.0 / 0.5)s = 2.0s of audio = 96,000 samples
  const map11_slow = sync.videoTimeToSample(11.0);
  assert.equal(map11_slow.ok, true);
  assert.equal(map11_slow.sample, 96000, "1.0s video advance @ 0.5x = 96,000 samples");

  console.log("PASS: Playback rate scaling (1.5x, 0.5x) verified.");
}

function testNormalPlaybackAndDriftCompensation() {
  const ringBuffer = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate: 48000, maxDriftTolerance: 0.080 });

  // Start at video time 10.0s, sample 0
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 10.0,
    playbackRate: 1.0,
    paused: false
  });

  // Simulate 1.0s playback: write 48,000 samples, heartbeat at video time 11.0s (0ms drift)
  ringBuffer.write(new Float32Array(48000));
  const resNoDrift = sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 11.0,
    playbackRate: 1.0,
    paused: false
  });
  assert.equal(resNoDrift.ok, true);
  assert.equal(resNoDrift.reanchored, false, "Zero drift must not re-anchor");

  // Simulate minor 20ms drift (within 80ms tolerance): videoTime 11.98s instead of 12.0s
  ringBuffer.write(new Float32Array(48000)); // total 96,000 samples (2.0s)
  const resMinorDrift = sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 11.98,
    playbackRate: 1.0,
    paused: false
  });
  assert.equal(resMinorDrift.ok, true);
  assert.equal(resMinorDrift.reanchored, false, "20ms drift (< 80ms) must not re-anchor");

  // Simulate significant 150ms drift (e.g. video rendering stall): videoTime 12.85s instead of 13.0s
  ringBuffer.write(new Float32Array(48000)); // total 144,000 samples (3.0s)
  const resMajorDrift = sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 12.85,
    playbackRate: 1.0,
    paused: false
  });
  assert.equal(resMajorDrift.ok, true);
  assert.equal(resMajorDrift.reanchored, true, "150ms drift (> 80ms) must re-anchor");
  assert.equal(resMajorDrift.reason, "DRIFT_CORRECTION");
  assert.equal(sync.anchorVideoTime, 12.85);
  assert.equal(sync.anchorSample, 144000);

  console.log("PASS: Normal playback tracking and drift re-anchoring verified.");
}

function testPauseResumeModel() {
  const ringBuffer = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate: 48000 });

  // Play until video time 20.0s, 96,000 samples
  ringBuffer.write(new Float32Array(96000));
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 20.0,
    playbackRate: 1.0,
    paused: false
  });

  // User pauses at 20.0s (Normal pause is NOT a new timeline)
  const resPause = sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 20.0,
    playbackRate: 1.0,
    paused: true
  });
  assert.equal(resPause.ok, true);
  assert.equal(resPause.reanchored, false);
  assert.equal(sync.currentTimelineId, 1);
  assert.equal(sync.isPaused, true);

  // User resumes at 20.0s, playback continues
  ringBuffer.write(new Float32Array(24000)); // 0.5s more audio
  const resResume = sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 20.5,
    playbackRate: 1.0,
    paused: false
  });
  assert.equal(resResume.ok, true);
  assert.equal(sync.currentTimelineId, 1, "TimelineId must remain unchanged across pause/resume");
  assert.equal(sync.isPaused, false);

  console.log("PASS: Pause / resume model on same timeline verified.");
}

function testTimelineDiscontinuityDetection() {
  const ringBuffer = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate: 48000 });

  // Initial timeline 1 at video time 10.0s
  ringBuffer.write(new Float32Array(48000));
  sync.ingestHeartbeat({
    timelineId: 1,
    videoTime: 10.0,
    playbackRate: 1.0,
    paused: false
  });
  assert.equal(sync.currentTimelineId, 1);
  assert.equal(sync.timelineStartSample, 0);

  // User seeks to video time 85.0s -> Content script increments timelineId to 2
  ringBuffer.write(new Float32Array(48000)); // total 96,000 samples
  const resSeek = sync.ingestHeartbeat({
    timelineId: 2,
    videoTime: 85.0,
    playbackRate: 1.0,
    paused: false
  });

  assert.equal(resSeek.ok, true);
  assert.equal(resSeek.reanchored, true);
  assert.equal(resSeek.reason, "TIMELINE_DISCONTINUITY");
  assert.equal(sync.currentTimelineId, 2);
  assert.equal(sync.anchorVideoTime, 85.0);
  assert.equal(sync.anchorSample, 96000);
  assert.equal(sync.timelineStartSample, 96000);
  assert.equal(sync.timelineSegments.length, 1, "Completed timeline 1 must be recorded in history");
  assert.equal(sync.timelineSegments[0].timelineId, 1);
  assert.equal(sync.timelineSegments[0].startSample, 0);
  assert.equal(sync.timelineSegments[0].endSample, 96000);

  // Trying to extract audio from timeline 1 while active timeline is 2 must reject with AUDIO_DISCONTINUITY
  const extractOldTimeline = sync.extractSubtitleAudio({
    startTime: 10.0,
    endTime: 12.0,
    timelineId: 1
  });
  assert.equal(extractOldTimeline.ok, false);
  assert.equal(extractOldTimeline.error, "AUDIO_DISCONTINUITY");

  console.log("PASS: Timeline discontinuity creation, segment recording, and stale timeline rejection verified.");
}

function runAll() {
  testInitialAnchorEstablishment();
  testPlaybackRateScaling();
  testNormalPlaybackAndDriftCompensation();
  testPauseResumeModel();
  testTimelineDiscontinuityDetection();
  console.log("\n>>> ALL AUDIO TIMELINE SYNCHRONIZATION TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAll();
