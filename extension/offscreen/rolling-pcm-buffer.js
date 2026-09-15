/**
 * AnkiMiner - Rolling Circular PCM Ring Buffer
 *
 * Implements a bounded, fixed-capacity circular ring buffer holding ~30 seconds of Float32 mono PCM.
 * Continuously overwrites the oldest samples upon wraparound with zero memory reallocations or GC churn.
 */

class RollingPcmBuffer {
  /**
   * @param {Object} options
   * @param {number} [options.sampleRate=48000] Native sample rate (Hz) from AudioContext
   * @param {number} [options.durationSeconds=30] Retention window in seconds
   */
  constructor(options = {}) {
    this.sampleRate = typeof options.sampleRate === "number" && options.sampleRate > 0
      ? options.sampleRate
      : 48000;
    this.durationSeconds = typeof options.durationSeconds === "number" && options.durationSeconds > 0
      ? options.durationSeconds
      : 30;

    this.capacity = Math.round(this.sampleRate * this.durationSeconds);
    this.buffer = new Float32Array(this.capacity);
    this.writeIndex = 0;
    this.totalSamplesWritten = 0;
    this.isFull = false;
    this.lastWriteTimestamp = null;
  }

  /**
   * Reconfigures buffer capacity for a new sample rate or duration.
   * @param {number} sampleRate 
   * @param {number} [durationSeconds=30] 
   */
  reconfigure(sampleRate, durationSeconds = 30) {
    this.sampleRate = sampleRate;
    this.durationSeconds = durationSeconds;
    this.capacity = Math.round(this.sampleRate * this.durationSeconds);
    this.buffer = new Float32Array(this.capacity);
    this.writeIndex = 0;
    this.totalSamplesWritten = 0;
    this.isFull = false;
    this.lastWriteTimestamp = null;
  }

  /**
   * Ingests a chunk of Float32 PCM samples into the circular buffer.
   * @param {Float32Array|ArrayBuffer} chunk 
   * @returns {number} Total samples written so far
   */
  write(chunk) {
    if (!chunk) return this.totalSamplesWritten;

    const samples = chunk instanceof Float32Array ? chunk : new Float32Array(chunk);
    const len = samples.length;
    if (len === 0) return this.totalSamplesWritten;

    if (len >= this.capacity) {
      // If incoming chunk is larger than entire buffer, only keep the tail
      const tail = samples.subarray(len - this.capacity);
      this.buffer.set(tail, 0);
      this.writeIndex = 0;
      this.totalSamplesWritten += len;
      this.isFull = true;
      this.lastWriteTimestamp = Date.now();
      return this.totalSamplesWritten;
    }

    const availableToEnd = this.capacity - this.writeIndex;

    if (len <= availableToEnd) {
      this.buffer.set(samples, this.writeIndex);
      this.writeIndex += len;
      if (this.writeIndex === this.capacity) {
        this.writeIndex = 0;
      }
    } else {
      // Wraparound write: split chunk across boundary
      this.buffer.set(samples.subarray(0, availableToEnd), this.writeIndex);
      const remaining = len - availableToEnd;
      this.buffer.set(samples.subarray(availableToEnd), 0);
      this.writeIndex = remaining;
    }

    this.totalSamplesWritten += len;
    if (!this.isFull && this.totalSamplesWritten >= this.capacity) {
      this.isFull = true;
    }
    this.lastWriteTimestamp = Date.now();

    return this.totalSamplesWritten;
  }

  /**
   * Returns the count of currently available valid samples in the buffer.
   * @returns {number}
   */
  getAvailableSamplesCount() {
    return Math.min(this.totalSamplesWritten, this.capacity);
  }

  /**
   * Returns the duration in seconds of currently available audio in the buffer.
   * @returns {number}
   */
  getBufferDuration() {
    return this.getAvailableSamplesCount() / this.sampleRate;
  }

  /**
   * Returns the total memory footprint in bytes for the Float32 sample array.
   * @returns {number}
   */
  getMemoryUsageBytes() {
    return this.capacity * 4;
  }

  /**
   * Returns a copy of the most recent N samples in chronological order.
   * Useful for inspection, diagnostics, and testing.
   * @param {number} numSamples 
   * @returns {Float32Array}
   */
  readRecent(numSamples) {
    const available = this.getAvailableSamplesCount();
    const count = Math.min(Math.max(0, numSamples), available);
    if (count === 0) return new Float32Array(0);

    const out = new Float32Array(count);
    const startOffset = (this.writeIndex - count + this.capacity) % this.capacity;

    const firstSegmentLen = Math.min(count, this.capacity - startOffset);
    out.set(this.buffer.subarray(startOffset, startOffset + firstSegmentLen), 0);

    if (firstSegmentLen < count) {
      const secondSegmentLen = count - firstSegmentLen;
      out.set(this.buffer.subarray(0, secondSegmentLen), firstSegmentLen);
    }

    return out;
  }

  /**
   * Returns diagnostic statistics regarding buffer health and occupancy.
   */
  getStats() {
    return {
      sampleRate: this.sampleRate,
      durationSeconds: this.durationSeconds,
      capacity: this.capacity,
      totalSamplesWritten: this.totalSamplesWritten,
      availableSamples: this.getAvailableSamplesCount(),
      availableDurationSec: parseFloat(this.getBufferDuration().toFixed(3)),
      isFull: this.isFull,
      memoryUsageBytes: this.getMemoryUsageBytes(),
      memoryUsageMB: parseFloat((this.getMemoryUsageBytes() / (1024 * 1024)).toFixed(2)),
      lastWriteTimestamp: this.lastWriteTimestamp
    };
  }

  /**
   * Returns the absolute sample index of the oldest sample currently stored in the buffer.
   * @returns {number}
   */
  getOldestSampleIndex() {
    return Math.max(0, this.totalSamplesWritten - this.capacity);
  }

  /**
   * Returns the absolute sample index of the newest sample currently stored in the buffer.
   * @returns {number}
   */
  getNewestSampleIndex() {
    return this.totalSamplesWritten;
  }

  /**
   * Extracts an absolute range of Float32 PCM samples [startSample, endSample] from the circular ring buffer.
   *
   * @param {number} startSample Absolute starting sample index (inclusive)
   * @param {number} endSample Absolute ending sample index (exclusive)
   * @returns {{ ok: boolean, samples?: Float32Array, error?: string, message?: string, [key: string]: any }}
   */
  extractRange(startSample, endSample) {
    if (typeof startSample !== "number" || typeof endSample !== "number" || isNaN(startSample) || isNaN(endSample)) {
      return {
        ok: false,
        error: "INVALID_RANGE",
        message: "startSample and endSample must be valid numbers"
      };
    }

    const start = Math.round(startSample);
    const end = Math.round(endSample);

    if (start >= end) {
      return {
        ok: false,
        error: "INVALID_RANGE",
        message: `startSample (${start}) must be strictly less than endSample (${end})`
      };
    }

    const oldest = this.getOldestSampleIndex();
    const newest = this.getNewestSampleIndex();

    if (start < oldest) {
      return {
        ok: false,
        error: "AUDIO_BUFFER_EXPIRED",
        message: `Requested start sample (${start}) was evicted from the 30s buffer. Oldest available is ${oldest}.`,
        oldestAvailableSample: oldest,
        requestedStartSample: start
      };
    }

    if (end > newest) {
      return {
        ok: false,
        error: "AUDIO_FUTURE_PENDING",
        message: `Requested end sample (${end}) has not yet been captured. Current newest is ${newest}.`,
        requiredSample: end,
        availableSample: newest
      };
    }

    const length = end - start;
    const out = new Float32Array(length);
    const startOffset = start % this.capacity;
    const firstSegmentLen = Math.min(length, this.capacity - startOffset);

    out.set(this.buffer.subarray(startOffset, startOffset + firstSegmentLen), 0);

    if (firstSegmentLen < length) {
      const secondSegmentLen = length - firstSegmentLen;
      out.set(this.buffer.subarray(0, secondSegmentLen), firstSegmentLen);
    }

    return {
      ok: true,
      samples: out,
      startSample: start,
      endSample: end,
      sampleCount: length,
      durationSeconds: length / this.sampleRate,
      sampleRate: this.sampleRate
    };
  }

  /**
   * Clears the buffer contents and resets write indices.
   */
  clear() {
    this.buffer.fill(0);
    this.writeIndex = 0;
    this.totalSamplesWritten = 0;
    this.isFull = false;
    this.lastWriteTimestamp = null;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RollingPcmBuffer
  };
} else if (typeof window !== "undefined") {
  window.RollingPcmBuffer = RollingPcmBuffer;
}
