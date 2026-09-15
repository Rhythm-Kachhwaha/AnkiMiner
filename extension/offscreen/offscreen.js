/**
 * AnkiMiner - Persistent Offscreen Audio Capture Engine
 *
 * Runs in a Manifest V3 Offscreen Document to provide continuous, passive tab audio capture.
 * 1. Owns the single active MediaStream and AudioContext for the duration of a mining session.
 * 2. Mirrors tab audio to local speakers so video playback remains audible and unaltered.
 * 3. Pipes audio through AudioWorklet (Mono downmix) into a 30-second rolling circular PCM buffer.
 * 4. Manages capture states: IDLE, STARTING, CAPTURING, PAUSED, ERROR, STOPPED.
 */

let RollingPcmBufferClass = typeof RollingPcmBuffer !== "undefined"
  ? RollingPcmBuffer
  : (typeof require !== "undefined" ? require("./rolling-pcm-buffer.js").RollingPcmBuffer : null);

let AudioTimelineSyncEngineClass = typeof AudioTimelineSyncEngine !== "undefined"
  ? AudioTimelineSyncEngine
  : (typeof require !== "undefined" ? require("./audio-timeline-sync.js").AudioTimelineSyncEngine : null);

let WavEncoderClass = typeof WavEncoder !== "undefined"
  ? WavEncoder
  : (typeof require !== "undefined" ? require("./wav-encoder.js").WavEncoder : null);

const CaptureState = {
  IDLE: "idle",
  STARTING: "starting",
  CAPTURING: "capturing",
  PAUSED: "paused",
  ERROR: "error",
  STOPPED: "stopped"
};

class PersistentAudioCaptureEngine {
  constructor(options = {}) {
    this.state = CaptureState.IDLE;
    this.mediaStream = null;
    this.audioContext = null;
    this.audioSource = null;
    this.pcmWorkletNode = null;
    this.activeStreamId = null;
    this.lastError = null;
    this.isMirroring = false;

    this.RollingPcmBuffer = options.RollingPcmBuffer || RollingPcmBufferClass;
    this.ringBuffer = new this.RollingPcmBuffer({
      sampleRate: options.sampleRate || 48000,
      durationSeconds: options.durationSeconds || 30
    });

    this.AudioTimelineSyncEngine = options.AudioTimelineSyncEngine || AudioTimelineSyncEngineClass;
    this.WavEncoder = options.WavEncoder || WavEncoderClass;
    this.syncEngine = new this.AudioTimelineSyncEngine({
      ringBuffer: this.ringBuffer,
      sampleRate: options.sampleRate || 48000,
      WavEncoder: this.WavEncoder,
      onAudioCaptured: options.onAudioCaptured || ((payload) => {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "AUDIO_CAPTURED",
            ...payload
          }).catch(() => {});
        }
      }),
      onStatus: options.onStatus || ((status) => {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "AUDIO_CAPTURE_STATUS",
            ...status
          }).catch(() => {});
        }
      })
    });

    // Injectable dependencies for testing and cross-environment execution
    this.getUserMedia = options.getUserMedia || (
      typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : null
    );
    this.AudioContextClass = options.AudioContextClass || (
      typeof window !== "undefined"
        ? (window.AudioContext || window.webkitAudioContext)
        : null
    );
    this.AudioWorkletNodeClass = options.AudioWorkletNodeClass || (
      typeof AudioWorkletNode !== "undefined" ? AudioWorkletNode : null
    );
  }

  getState() {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      activeStreamId: this.activeStreamId,
      isMirroring: this.isMirroring,
      lastError: this.lastError,
      ...this.ringBuffer.getStats(),
      syncStats: this.syncEngine ? this.syncEngine.getStats() : null
    };
  }

  async startCapture({ streamId }) {
    if (this.state === CaptureState.CAPTURING && this.activeStreamId === streamId) {
      return {
        ok: true,
        state: this.state,
        stats: this.getStats()
      };
    }

    if (this.state === CaptureState.CAPTURING || this.state === CaptureState.STARTING) {
      await this.stopCapture();
    }

    if (!streamId) {
      this.state = CaptureState.ERROR;
      this.lastError = "MISSING_STREAM_ID";
      return {
        ok: false,
        error: "MISSING_STREAM_ID",
        message: "No streamId provided for tab audio capture"
      };
    }

    if (!this.getUserMedia) {
      this.state = CaptureState.ERROR;
      this.lastError = "USER_MEDIA_UNAVAILABLE";
      return {
        ok: false,
        error: "USER_MEDIA_UNAVAILABLE",
        message: "navigator.mediaDevices.getUserMedia is not available"
      };
    }

    this.state = CaptureState.STARTING;
    this.activeStreamId = streamId;
    this.lastError = null;

    try {
      this.mediaStream = await this.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId
          }
        },
        video: false
      });
    } catch (err) {
      const isDrm = err?.name === "AbortError" || err?.name === "NotAllowedError" || err?.name === "SecurityError";
      this.state = CaptureState.ERROR;
      this.lastError = isDrm ? "DRM_AUDIO_RESTRICTED" : "GET_USER_MEDIA_FAILED";
      this.cleanup();
      return {
        ok: false,
        error: this.lastError,
        message: isDrm
          ? "Audio capture is restricted on this source (DRM protected)."
          : (err?.message || "Failed to acquire tab audio stream")
      };
    }

    // Initialize AudioContext and Audio Mirroring
    if (this.AudioContextClass) {
      try {
        this.audioContext = new this.AudioContextClass({ latencyHint: "interactive" });
        if (this.audioContext.state === "suspended" && typeof this.audioContext.resume === "function") {
          await this.audioContext.resume().catch(() => {});
        }

        const nativeSampleRate = this.audioContext.sampleRate || 48000;
        this.ringBuffer.reconfigure(nativeSampleRate, 30);
        if (this.syncEngine) {
          this.syncEngine.reconfigure(nativeSampleRate, this.ringBuffer);
        }

        this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);

        // Connect to destination (Speakers) so user continues hearing tab audio normally
        if (this.audioContext.destination) {
          this.audioSource.connect(this.audioContext.destination);
          this.isMirroring = true;
        }

        // Load AudioWorklet module
        const workletPath = typeof chrome !== "undefined" && chrome.runtime?.getURL
          ? chrome.runtime.getURL("offscreen/pcm-worklet-processor.js")
          : "pcm-worklet-processor.js";

        if (this.audioContext.audioWorklet?.addModule) {
          await this.audioContext.audioWorklet.addModule(workletPath);
        }

        // Instantiate Worklet Node and connect pipeline
        const WorkletNodeClass = this.AudioWorkletNodeClass || (typeof AudioWorkletNode !== "undefined" ? AudioWorkletNode : null);
        if (WorkletNodeClass) {
          this.pcmWorkletNode = new WorkletNodeClass(this.audioContext, "pcm-recorder-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1]
          });

          this.pcmWorkletNode.port.onmessage = (event) => {
            if (event.data) {
              const chunk = event.data;
              this.ringBuffer.write(chunk);
              const numSamples = chunk.byteLength ? (chunk.byteLength / 4) : (chunk.length || 0);
              if (this.syncEngine) {
                this.syncEngine.onPcmChunkWritten(numSamples);
              }
            }
          };

          this.audioSource.connect(this.pcmWorkletNode);
        }

        // Listen for track end or suspension
        const audioTracks = this.mediaStream.getAudioTracks ? this.mediaStream.getAudioTracks() : this.mediaStream.getTracks?.() || [];
        audioTracks.forEach(track => {
          track.onended = () => {
            if (this.state === CaptureState.CAPTURING || this.state === CaptureState.STARTING) {
              this.state = CaptureState.STOPPED;
              this.cleanup();
            }
          };
        });

        if (typeof this.audioContext.addEventListener === "function") {
          this.audioContext.addEventListener("statechange", () => {
            if (this.audioContext?.state === "suspended" && this.state === CaptureState.CAPTURING) {
              this.state = CaptureState.PAUSED;
            } else if (this.audioContext?.state === "running" && this.state === CaptureState.PAUSED) {
              this.state = CaptureState.CAPTURING;
            }
          });
        }

      } catch (audioErr) {
        console.warn("[Offscreen Audio Engine] AudioWorklet pipeline initialization warning:", audioErr);
      }
    }

    this.state = CaptureState.CAPTURING;
    return {
      ok: true,
      state: this.state,
      stats: this.getStats()
    };
  }

  async stopCapture() {
    this.cleanup();
    this.state = CaptureState.STOPPED;
    this.activeStreamId = null;
    return {
      ok: true,
      state: this.state
    };
  }

  cleanup() {
    this.isMirroring = false;

    if (this.pcmWorkletNode) {
      try {
        if (this.pcmWorkletNode.port) {
          this.pcmWorkletNode.port.postMessage({ type: "STOP" });
          this.pcmWorkletNode.port.onmessage = null;
        }
        this.pcmWorkletNode.disconnect();
      } catch (_) {}
      this.pcmWorkletNode = null;
    }

    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch (_) {}
      this.audioSource = null;
    }

    if (this.audioContext) {
      try {
        if (this.audioContext.state !== "closed" && typeof this.audioContext.close === "function") {
          this.audioContext.close().catch(() => {});
        }
      } catch (_) {}
      this.audioContext = null;
    }

    if (this.syncEngine) {
      this.syncEngine.reset();
    }

    if (this.ringBuffer && typeof this.ringBuffer.clear === "function") {
      this.ringBuffer.clear();
    }

    if (this.mediaStream) {
      try {
        const tracks = this.mediaStream.getTracks?.() || [];
        tracks.forEach(track => {
          track.onended = null;
          if (typeof track.stop === "function") {
            track.stop();
          }
        });
      } catch (_) {}
      this.mediaStream = null;
    }
  }
}

// Backward-compatible recorder wrapper for existing test suites
class OffscreenAudioRecorder {
  constructor(options = {}) {
    this.engine = new PersistentAudioCaptureEngine(options);
    this.mediaRecorder = null;
    this.chunks = [];
    this.timerId = null;
    this.isRecording = false;
    this.activeResolve = null;

    this.MediaRecorderClass = options.MediaRecorderClass || (
      typeof MediaRecorder !== "undefined" ? MediaRecorder : null
    );
    this.blobToDataUrl = options.blobToDataUrl || (async (blob) => {
      if (typeof FileReader !== "undefined") {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      if (blob?.arrayBuffer) {
        const buf = await blob.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        return `data:${blob.type || "audio/webm"};base64,${b64}`;
      }
      throw new Error("Unable to convert blob to data URL");
    });
  }

  resolveMimeType(requestedMimeType) {
    if (requestedMimeType) return requestedMimeType;
    const MRecorder = this.MediaRecorderClass;
    if (MRecorder && typeof MRecorder.isTypeSupported === "function") {
      if (MRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
      if (MRecorder.isTypeSupported("audio/webm")) return "audio/webm";
    }
    return "audio/webm";
  }

  async startRecording({ streamId, durationMs, mimeType }) {
    const startRes = await this.engine.startCapture({ streamId });
    if (!startRes.ok) return startRes;

    const chosenMimeType = this.resolveMimeType(mimeType);
    this.chunks = [];

    const MRecorder = this.MediaRecorderClass;
    if (!MRecorder) {
      await this.engine.stopCapture();
      return { ok: false, error: "MEDIA_RECORDER_UNAVAILABLE", message: "MediaRecorder not available" };
    }

    try {
      this.mediaRecorder = new MRecorder(this.engine.mediaStream, { mimeType: chosenMimeType });
    } catch (_) {
      try {
        this.mediaRecorder = new MRecorder(this.engine.mediaStream);
      } catch (recErr) {
        await this.engine.stopCapture();
        return { ok: false, error: "RECORDER_INIT_FAILED", message: recErr?.message || "Failed to initialize MediaRecorder" };
      }
    }

    this.isRecording = true;

    return new Promise((resolve) => {
      this.activeResolve = resolve;

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const recordingMime = this.mediaRecorder?.mimeType || chosenMimeType || "audio/webm";
        let blob;
        if (typeof Blob !== "undefined") {
          blob = new Blob(this.chunks, { type: recordingMime });
        } else {
          blob = { type: recordingMime, chunks: this.chunks };
        }

        let dataUrl = "";
        try {
          dataUrl = await this.blobToDataUrl(blob);
        } catch (convErr) {
          this.cleanup();
          this.activeResolve?.({ ok: false, error: "BLOB_CONVERSION_FAILED", message: convErr?.message });
          return;
        }

        this.cleanup();
        this.activeResolve?.({ ok: true, dataUrl, mimeType: recordingMime, durationMs });
      };

      this.mediaRecorder.onerror = (event) => {
        this.cleanup();
        this.activeResolve?.({ ok: false, error: "RECORDING_ERROR", message: event?.error?.message });
      };

      this.mediaRecorder.start();

      if (typeof durationMs === "number" && durationMs > 0) {
        this.timerId = setTimeout(() => {
          this.stopRecording();
        }, durationMs);
      }
    });
  }

  async stopRecording() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch (err) {
        console.warn("[Offscreen Audio] Error stopping recorder:", err);
      }
    } else {
      this.cleanup();
    }
  }

  cleanup() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.engine.stopCapture().catch(() => {});
    this.mediaRecorder = null;
    this.isRecording = false;
  }
}

// Global engine instance for offscreen execution
let engineInstance = null;
function getEngineInstance() {
  if (!engineInstance) {
    engineInstance = new PersistentAudioCaptureEngine();
  }
  return engineInstance;
}

let legacyRecorderInstance = null;
function getRecorderInstance() {
  if (!legacyRecorderInstance) {
    legacyRecorderInstance = new OffscreenAudioRecorder();
  }
  return legacyRecorderInstance;
}

// Runtime message listener for browser offscreen environment
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Stage 3: Audio Timeline Synchronization & Subtitle Extraction
    if (message?.type === "AUDIO_SYNC_HEARTBEAT") {
      const engine = getEngineInstance();
      const res = engine.syncEngine
        ? engine.syncEngine.ingestHeartbeat(message)
        : { ok: false, error: "NO_SYNC_ENGINE" };
      sendResponse(res);
      return true;
    }

    if (message?.type === "EXTRACT_SUBTITLE_AUDIO") {
      const engine = getEngineInstance();
      const res = engine.syncEngine
        ? engine.syncEngine.extractSubtitleAudio(message)
        : { ok: false, error: "NO_SYNC_ENGINE" };
      sendResponse(res);
      return true;
    }

    if (message?.type === "GET_SYNC_STATE") {
      const engine = getEngineInstance();
      sendResponse({
        ok: true,
        syncStats: engine.syncEngine ? engine.syncEngine.getStats() : null,
        bufferStats: engine.ringBuffer.getStats()
      });
      return true;
    }

    if (message?.type === "CANCEL_PENDING_AUDIO_CAPTURE") {
      const engine = getEngineInstance();
      if (engine.syncEngine && message.captureId) {
        engine.syncEngine.pendingCaptures = engine.syncEngine.pendingCaptures.filter(p => p.captureId !== message.captureId);
      }
      sendResponse({ ok: true });
      return true;
    }

    // Persistent capture lifecycle messages (Stage 2)
    if (message?.type === "START_PERSISTENT_CAPTURE") {
      const engine = getEngineInstance();
      engine.startCapture({ streamId: message.streamId }).then(res => {
        sendResponse(res);
      }).catch(err => {
        sendResponse({ ok: false, error: "CAPTURE_FAILED", message: err?.message });
      });
      return true;
    }

    if (message?.type === "STOP_PERSISTENT_CAPTURE") {
      const engine = getEngineInstance();
      engine.stopCapture().then(res => {
        sendResponse(res);
      }).catch(err => {
        sendResponse({ ok: false, error: err?.message });
      });
      return true;
    }

    if (message?.type === "GET_CAPTURE_STATE") {
      const engine = getEngineInstance();
      sendResponse({
        ok: true,
        state: engine.getState(),
        stats: engine.getStats()
      });
      return true;
    }

    // Ping & legacy support
    if (message?.type === "PING_OFFSCREEN") {
      const engine = getEngineInstance();
      const legacyRecorder = getRecorderInstance();
      sendResponse({
        ok: true,
        state: engine.getState(),
        isCapturing: engine.getState() === CaptureState.CAPTURING,
        isRecording: legacyRecorder.isRecording
      });
      return true;
    }

    if (message?.type === "START_RECORDING_OFFSCREEN") {
      const recorder = getRecorderInstance();
      recorder.startRecording({
        streamId: message.streamId,
        durationMs: message.durationMs,
        mimeType: message.mimeType
      }).then(res => {
        sendResponse(res);
      }).catch(err => {
        sendResponse({ ok: false, error: "RECORDING_FAILED", message: err?.message });
      });
      return true;
    }

    if (message?.type === "STOP_RECORDING_OFFSCREEN") {
      const recorder = getRecorderInstance();
      recorder.stopRecording().then(() => {
        sendResponse({ ok: true });
      }).catch(err => {
        sendResponse({ ok: false, error: err?.message });
      });
      return true;
    }
  });
}

// Universal module export for Node.js tests and browser globals
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CaptureState,
    PersistentAudioCaptureEngine,
    OffscreenAudioRecorder,
    getEngineInstance,
    getRecorderInstance
  };
} else if (typeof window !== "undefined") {
  window.CaptureState = CaptureState;
  window.PersistentAudioCaptureEngine = PersistentAudioCaptureEngine;
  window.OffscreenAudioRecorder = OffscreenAudioRecorder;
  window.getEngineInstance = getEngineInstance;
  window.getRecorderInstance = getRecorderInstance;
}
