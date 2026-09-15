/**
 * AnkiMiner - Audio Timeline Synchronization & Subtitle Extraction Engine
 *
 * Connects the video media time timeline (from content script heartbeats)
 * to the persistent Float32 circular PCM ring buffer, enabling passive,
 * zero-playback-disruption subtitle audio extraction.
 */

let WavEncoderClass = typeof WavEncoder !== "undefined"
  ? WavEncoder
  : (typeof require !== "undefined" ? require("./wav-encoder.js").WavEncoder : null);

class AudioTimelineSyncEngine {
  /**
   * @param {Object} options
   * @param {RollingPcmBuffer} options.ringBuffer Active circular PCM ring buffer
   * @param {number} [options.sampleRate=48000] Native audio sample rate
   * @param {number} [options.paddingStart=0.150] Pre-subtitle padding in seconds (150 ms)
   * @param {number} [options.paddingEnd=0.200] Post-subtitle padding in seconds (200 ms)
   * @param {number} [options.maxDriftTolerance=0.080] Drift threshold to trigger re-anchor in seconds (80 ms)
   * @param {Function} [options.onAudioCaptured] Callback when an extraction (or pending extraction) completes
   * @param {Function} [options.onStatus] Callback for non-blocking status/error notifications
   */
  constructor(options = {}) {
    this.ringBuffer = options.ringBuffer || null;
    this.sampleRate = typeof options.sampleRate === "number" && options.sampleRate > 0
      ? options.sampleRate
      : (this.ringBuffer?.sampleRate || 48000);
    this.paddingStart = typeof options.paddingStart === "number" ? options.paddingStart : 0.150;
    this.paddingEnd = typeof options.paddingEnd === "number" ? options.paddingEnd : 0.200;
    this.maxDriftTolerance = typeof options.maxDriftTolerance === "number" ? options.maxDriftTolerance : 0.080;
    this.maxPendingCaptures = typeof options.maxPendingCaptures === "number" ? options.maxPendingCaptures : 20;

    this.WavEncoder = options.WavEncoder || WavEncoderClass;
    this.onAudioCaptured = typeof options.onAudioCaptured === "function" ? options.onAudioCaptured : null;
    this.onStatus = typeof options.onStatus === "function" ? options.onStatus : null;

    // Timeline anchor model
    this.currentTimelineId = null;
    this.anchorVideoTime = 0.0;
    this.anchorSample = 0;
    this.anchorWallClock = 0;
    this.playbackRate = 1.0;
    this.isPaused = false;
    this.timelineStartSample = 0;
    this.lastHeartbeatTime = 0;

    // Discontinuity and segment history
    this.timelineSegments = [];

    // Queue of captures pending playback completion
    this.pendingCaptures = [];
  }

  /**
   * Reconfigures sample rate and ring buffer reference.
   * @param {number} sampleRate 
   * @param {RollingPcmBuffer} [ringBuffer] 
   */
  reconfigure(sampleRate, ringBuffer = null) {
    this.sampleRate = sampleRate;
    if (ringBuffer) this.ringBuffer = ringBuffer;
    this.reset();
  }

  /**
   * Resets all synchronization anchors and pending captures.
   */
  reset() {
    this.currentTimelineId = null;
    this.anchorVideoTime = 0.0;
    this.anchorSample = 0;
    this.anchorWallClock = 0;
    this.playbackRate = 1.0;
    this.isPaused = false;
    this.timelineStartSample = 0;
    this.lastHeartbeatTime = 0;
    this.timelineSegments = [];
    this.pendingCaptures = [];
  }

  /**
   * Ingests a periodic synchronization heartbeat from the content script.
   *
   * @param {Object} heartbeat
   * @param {number|string} heartbeat.timelineId Monotonic timeline identifier
   * @param {number} heartbeat.videoTime Video currentTime in seconds
   * @param {number} [heartbeat.wallClock] performance.now() or Date.now()
   * @param {number} [heartbeat.playbackRate=1.0] Video playback rate
   * @param {boolean} [heartbeat.paused=false] Video paused state
   * @returns {Object} Sync diagnostics
   */
  ingestHeartbeat(heartbeat) {
    if (!heartbeat || typeof heartbeat.videoTime !== "number" || isNaN(heartbeat.videoTime)) {
      return { ok: false, error: "INVALID_HEARTBEAT" };
    }

    const currentSample = this.ringBuffer ? this.ringBuffer.getNewestSampleIndex() : this.anchorSample;
    const incomingTimelineId = heartbeat.timelineId != null ? heartbeat.timelineId : 1;
    const incomingRate = typeof heartbeat.playbackRate === "number" && heartbeat.playbackRate > 0 ? heartbeat.playbackRate : 1.0;
    const incomingPaused = Boolean(heartbeat.paused);
    const incomingWallClock = heartbeat.wallClock || Date.now();

    this.lastHeartbeatTime = Date.now();

    // 1. Genuine Timeline Discontinuity Check (Seek, Video/Element replaced, Navigation)
    if (this.currentTimelineId === null || this.currentTimelineId !== incomingTimelineId) {
      if (this.currentTimelineId !== null) {
        // Record completed segment in history
        this.timelineSegments.push({
          timelineId: this.currentTimelineId,
          startSample: this.timelineStartSample,
          endSample: currentSample
        });

        // Cancel any pending captures for the previous timeline
        this._cancelPendingCapturesOnDiscontinuity(incomingTimelineId);

        // On seek / timeline jump, new timeline starts at current buffer position
        this.timelineStartSample = currentSample;
      } else {
        // Initial timeline anchor: account for prior video time in buffer
        const pastSamples = Math.round((heartbeat.videoTime * this.sampleRate) / incomingRate);
        this.timelineStartSample = Math.max(0, currentSample - pastSamples);
      }

      // Establish new anchor
      this.currentTimelineId = incomingTimelineId;
      this.anchorVideoTime = heartbeat.videoTime;
      this.anchorSample = currentSample;
      this.anchorWallClock = incomingWallClock;
      this.playbackRate = incomingRate;
      this.isPaused = incomingPaused;

      return {
        ok: true,
        reanchored: true,
        reason: "TIMELINE_DISCONTINUITY",
        timelineId: this.currentTimelineId,
        anchorVideoTime: this.anchorVideoTime,
        anchorSample: this.anchorSample
      };
    }

    // 2. Playback Rate Transition Re-Anchor Check
    if (incomingRate !== this.playbackRate) {
      this.anchorVideoTime = heartbeat.videoTime;
      this.anchorSample = currentSample;
      this.anchorWallClock = incomingWallClock;
      this.playbackRate = incomingRate;
      this.isPaused = incomingPaused;

      return {
        ok: true,
        reanchored: true,
        reason: "RATE_CHANGE",
        playbackRate: this.playbackRate,
        timelineId: this.currentTimelineId,
        anchorVideoTime: this.anchorVideoTime,
        anchorSample: this.anchorSample
      };
    }

    // 3. Continuous Playback on the Same Timeline
    this.playbackRate = incomingRate;
    this.isPaused = incomingPaused;

    if (!incomingPaused) {
      // Calculate predicted video time from linear sample count
      const elapsedSamples = currentSample - this.anchorSample;
      const predictedVideoTime = this.anchorVideoTime + (elapsedSamples / this.sampleRate) * this.playbackRate;
      const drift = Math.abs(predictedVideoTime - heartbeat.videoTime);

      // If drift exceeds tolerance (e.g. video decoder stall, tab scheduling jitter > 80ms)
      if (drift > this.maxDriftTolerance) {
        this.anchorVideoTime = heartbeat.videoTime;
        this.anchorSample = currentSample;
        this.anchorWallClock = incomingWallClock;

        return {
          ok: true,
          reanchored: true,
          reason: "DRIFT_CORRECTION",
          driftSec: parseFloat(drift.toFixed(4)),
          timelineId: this.currentTimelineId,
          anchorVideoTime: this.anchorVideoTime,
          anchorSample: this.anchorSample
        };
      }
    } else {
      // While paused, keep anchor synced to current pause point
      this.anchorVideoTime = heartbeat.videoTime;
      this.anchorSample = currentSample;
      this.anchorWallClock = incomingWallClock;
    }

    return {
      ok: true,
      reanchored: false,
      timelineId: this.currentTimelineId,
      anchorVideoTime: this.anchorVideoTime,
      anchorSample: this.anchorSample
    };
  }

  /**
   * Called whenever new PCM samples are written to the circular buffer.
   * Advances sample tracking and checks if any pending audio captures can be finalized.
   *
   * @param {number} numSamples Number of newly written samples
   */
  onPcmChunkWritten(numSamples) {
    if (!numSamples || this.pendingCaptures.length === 0) return;

    const currentSample = this.ringBuffer ? this.ringBuffer.getNewestSampleIndex() : 0;
    const oldestSample = this.ringBuffer ? this.ringBuffer.getOldestSampleIndex() : 0;
    const remainingPending = [];

    for (const pending of this.pendingCaptures) {
      if (pending.targetStartSample < oldestSample) {
        // Start sample has expired/been evicted from the 30-second rolling buffer
        if (typeof this.onStatus === "function") {
          this.onStatus({
            ok: false,
            error: "AUDIO_BUFFER_EXPIRED",
            message: "Pending audio capture expired from the 30-second rolling buffer",
            captureId: pending.captureId
          });
        }
      } else if (currentSample >= pending.targetEndSample) {
        // Required audio has now arrived! Finalize extraction
        this._finalizePendingCapture(pending);
      } else {
        // Still waiting for video playback to deliver the remaining audio
        remainingPending.push(pending);
      }
    }

    this.pendingCaptures = remainingPending;
  }

  /**
   * Finalizes an in-flight pending audio capture once playback reaches subtitle end.
   * @private
   */
  _finalizePendingCapture(pending) {
    if (!this.ringBuffer) return;

    const result = this.ringBuffer.extractRange(pending.targetStartSample, pending.targetEndSample);
    if (result.ok && result.samples) {
      const dataUrl = this.WavEncoder
        ? this.WavEncoder.encodeToDataUrl(result.samples, this.sampleRate)
        : "";

      const payload = {
        ok: true,
        dataUrl,
        mimeType: "audio/wav",
        startTime: pending.targetStartTime,
        endTime: pending.targetEndTime,
        durationMs: Math.round(result.durationSeconds * 1000),
        sampleCount: result.sampleCount,
        cue: pending.cue,
        captureId: pending.captureId,
        wasPending: true
      };

      if (typeof this.onAudioCaptured === "function") {
        this.onAudioCaptured(payload);
      }
    } else {
      if (typeof this.onStatus === "function") {
        this.onStatus({
          ok: false,
          error: result.error || "EXTRACTION_FAILED",
          message: result.message || "Failed to finalize pending audio capture",
          captureId: pending.captureId
        });
      }
    }
  }

  /**
   * Cancels active pending captures when a timeline discontinuity (seek/navigation) occurs.
   * @private
   */
  _cancelPendingCapturesOnDiscontinuity(newTimelineId) {
    if (this.pendingCaptures.length === 0) return;

    for (const pending of this.pendingCaptures) {
      if (typeof this.onStatus === "function") {
        this.onStatus({
          ok: false,
          error: "AUDIO_DISCONTINUITY",
          message: "Pending audio capture cancelled due to video seek / timeline change",
          captureId: pending.captureId
        });
      }
    }

    this.pendingCaptures = [];
  }

  /**
   * Maps a video media timestamp (seconds) to an absolute sample index.
   *
   * @param {number} videoTime 
   * @returns {{ ok: boolean, sample?: number, error?: string }}
   */
  videoTimeToSample(videoTime) {
    if (this.currentTimelineId === null) {
      return { ok: false, error: "AUDIO_SYNC_UNAVAILABLE" };
    }

    const deltaSec = videoTime - this.anchorVideoTime;
    const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
    const deltaSamples = Math.round((deltaSec * this.sampleRate) / rate);
    const sampleIndex = this.anchorSample + deltaSamples;

    return {
      ok: true,
      sample: sampleIndex
    };
  }

  /**
   * Maps an absolute sample index back to video media time (seconds).
   *
   * @param {number} sampleIndex 
   * @returns {{ ok: boolean, videoTime?: number, error?: string }}
   */
  sampleToVideoTime(sampleIndex) {
    if (this.currentTimelineId === null) {
      return { ok: false, error: "AUDIO_SYNC_UNAVAILABLE" };
    }

    const deltaSamples = sampleIndex - this.anchorSample;
    const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
    const deltaSec = (deltaSamples / this.sampleRate) * rate;
    const videoTime = this.anchorVideoTime + deltaSec;

    return {
      ok: true,
      videoTime: parseFloat(videoTime.toFixed(4))
    };
  }

  /**
   * Extracts the audio clip for a mined subtitle interval without disrupting playback.
   *
   * @param {Object} request
   * @param {number} request.startTime Subtitle start time in seconds
   * @param {number} request.endTime Subtitle end time in seconds
   * @param {number|string} [request.timelineId] Monotonic timeline ID from content script
   * @param {Object} [request.cue] Subtitle cue object for metadata
   * @param {number} [request.offset=0.0] Subtitle timing offset in seconds
   * @param {number} [request.paddingStart] Custom start padding in seconds
   * @param {number} [request.paddingEnd] Custom end padding in seconds
   * @param {number|string} [request.captureId] Unique identifier for the mining draft
   * @returns {Object} Structured extraction result
   */
  extractSubtitleAudio(request = {}) {
    if (!this.ringBuffer) {
      return {
        ok: false,
        error: "AUDIO_NOT_AVAILABLE",
        message: "Rolling PCM buffer is not initialized"
      };
    }

    if (this.currentTimelineId === null) {
      return {
        ok: false,
        error: "AUDIO_SYNC_UNAVAILABLE",
        message: "No active video media-time anchor has been established"
      };
    }

    const rawStart = typeof request.startTime === "number" ? request.startTime : null;
    const rawEnd = typeof request.endTime === "number" ? request.endTime : null;

    if (rawStart === null || rawEnd === null || rawStart >= rawEnd) {
      return {
        ok: false,
        error: "INVALID_SUBTITLE_INTERVAL",
        message: "Invalid subtitle start or end time"
      };
    }

    // Validate timeline ID if supplied
    if (request.timelineId != null && request.timelineId !== this.currentTimelineId) {
      return {
        ok: false,
        error: "AUDIO_DISCONTINUITY",
        message: `Requested timeline (${request.timelineId}) does not match current active timeline (${this.currentTimelineId})`
      };
    }

    // Apply subtitle timing offset & extraction padding
    const offset = typeof request.offset === "number" ? request.offset : 0.0;
    const padStart = typeof request.paddingStart === "number" ? request.paddingStart : this.paddingStart;
    const padEnd = typeof request.paddingEnd === "number" ? request.paddingEnd : this.paddingEnd;

    const effectiveStart = rawStart + offset;
    const effectiveEnd = rawEnd + offset;

    const paddedStartSec = Math.max(0, effectiveStart - padStart);
    const paddedEndSec = effectiveEnd + padEnd;

    // Map media times to absolute PCM sample indices
    const startMap = this.videoTimeToSample(paddedStartSec);
    const endMap = this.videoTimeToSample(paddedEndSec);
    const unpaddedEndMap = this.videoTimeToSample(effectiveEnd);

    if (!startMap.ok || !endMap.ok) {
      return {
        ok: false,
        error: "AUDIO_SYNC_FAILED",
        message: "Failed to map subtitle media time to PCM sample positions"
      };
    }

    let targetStartSample = startMap.sample;
    let targetEndSample = endMap.sample;

    // Boundary check: Clamp start sample to timeline start if padding crossed it
    if (targetStartSample < this.timelineStartSample) {
      const unpaddedStartMap = this.videoTimeToSample(effectiveStart);
      if (unpaddedStartMap.ok && unpaddedStartMap.sample >= this.timelineStartSample) {
        // Only the padding crossed the boundary: clamp start to timeline inception
        targetStartSample = this.timelineStartSample;
      } else if (this.timelineStartSample < targetEndSample) {
        targetStartSample = this.timelineStartSample;
      } else {
        // Subtitle itself begins before current timeline inception
        return {
          ok: false,
          error: "AUDIO_DISCONTINUITY",
          message: "Requested subtitle audio precedes current playback timeline"
        };
      }
    }

    // Paused video auto-clamp: if video is paused and post-padding extends beyond the newest sample,
    // but core speech has already arrived, clamp end sample to newest available sample
    const currentNewestSample = this.ringBuffer.getNewestSampleIndex();
    if (this.isPaused && targetEndSample > currentNewestSample) {
      if (unpaddedEndMap.ok && unpaddedEndMap.sample <= currentNewestSample && targetStartSample < currentNewestSample) {
        targetEndSample = currentNewestSample;
      }
    }

    if (targetStartSample >= targetEndSample) {
      return {
        ok: false,
        error: "INVALID_SAMPLE_INTERVAL",
        message: "Computed sample start is not strictly less than sample end"
      };
    }

    // Query the rolling buffer for sample range
    const extraction = this.ringBuffer.extractRange(targetStartSample, targetEndSample);

    // Case A: Complete Audio is already available in the 30-second buffer
    if (extraction.ok && extraction.samples) {
      const dataUrl = this.WavEncoder
        ? this.WavEncoder.encodeToDataUrl(extraction.samples, this.sampleRate)
        : "";

      return {
        ok: true,
        status: "READY",
        pending: false,
        dataUrl,
        mimeType: "audio/wav",
        startTime: paddedStartSec,
        endTime: paddedEndSec,
        durationMs: Math.round(extraction.durationSeconds * 1000),
        sampleCount: extraction.sampleCount,
        cue: request.cue || null,
        captureId: request.captureId || null
      };
    }

    // Case B: Subtitle ends in future (e.g. paused mid-sentence or mining active cue)
    if (extraction.error === "AUDIO_FUTURE_PENDING") {
      // Bound queue length to prevent unbounded memory growth during indefinite pause/rapid mining
      while (this.pendingCaptures.length >= this.maxPendingCaptures) {
        const dropped = this.pendingCaptures.shift();
        if (typeof this.onStatus === "function") {
          this.onStatus({
            ok: false,
            error: "PENDING_QUEUE_OVERFLOW",
            message: "Oldest pending audio capture discarded due to queue capacity limit",
            captureId: dropped.captureId
          });
        }
      }

      const pendingItem = {
        id: "pending_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        captureId: request.captureId || null,
        timelineId: this.currentTimelineId,
        targetStartSample,
        targetEndSample,
        targetStartTime: paddedStartSec,
        targetEndTime: paddedEndSec,
        cue: request.cue || null,
        createdAt: Date.now()
      };

      this.pendingCaptures.push(pendingItem);

      return {
        ok: true,
        status: "PENDING",
        pending: true,
        pendingId: pendingItem.id,
        captureId: request.captureId || null,
        message: "Audio capture queued. Will finalize automatically when playback reaches subtitle end."
      };
    }

    // Case C: Audio has fallen outside the 30-second circular buffer
    if (extraction.error === "AUDIO_BUFFER_EXPIRED") {
      return {
        ok: false,
        error: "AUDIO_BUFFER_EXPIRED",
        message: "Audio for this subtitle has expired from the 30-second rolling buffer"
      };
    }

    // Other buffer error
    return extraction;
  }

  /**
   * Returns engine status and synchronization metrics.
   */
  getStats() {
    const currentSample = this.ringBuffer ? this.ringBuffer.getNewestSampleIndex() : 0;
    const oldestSample = this.ringBuffer ? this.ringBuffer.getOldestSampleIndex() : 0;

    return {
      currentTimelineId: this.currentTimelineId,
      anchorVideoTime: this.anchorVideoTime,
      anchorSample: this.anchorSample,
      playbackRate: this.playbackRate,
      isPaused: this.isPaused,
      timelineStartSample: this.timelineStartSample,
      currentNewestSample: currentSample,
      currentOldestSample: oldestSample,
      activePendingCapturesCount: this.pendingCaptures.length,
      lastHeartbeatTime: this.lastHeartbeatTime
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AudioTimelineSyncEngine
  };
} else if (typeof window !== "undefined") {
  window.AudioTimelineSyncEngine = AudioTimelineSyncEngine;
}
