/**
 * AnkiMiner - Offscreen Audio Recording Service
 * 
 * Runs in a Manifest V3 Offscreen Document to record tab audio streams.
 * Service workers cannot access DOM or navigator.mediaDevices; this document
 * receives single-use tab capture stream IDs from background.js, acquires the
 * MediaStream, mirrors audio to local speakers, records audio/webm via MediaRecorder,
 * and converts the output to a base64 data URL.
 */

class OffscreenAudioRecorder {
  constructor(options = {}) {
    this.mediaStream = null;
    this.audioContext = null;
    this.audioSource = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.timerId = null;
    this.isRecording = false;
    this.activeResolve = null;
    this.activeReject = null;

    // Injectable dependencies for Node.js unit testing
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
      // Node.js fallback if buffer available
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
      if (MRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        return "audio/webm;codecs=opus";
      }
      if (MRecorder.isTypeSupported("audio/webm")) {
        return "audio/webm";
      }
    }
    return "audio/webm";
  }

  async startRecording({ streamId, durationMs, mimeType }) {
    if (this.isRecording) {
      await this.stopRecording();
    }

    if (!streamId) {
      return {
        ok: false,
        error: "MISSING_STREAM_ID",
        message: "No streamId provided for audio recording"
      };
    }

    if (!this.getUserMedia) {
      return {
        ok: false,
        error: "USER_MEDIA_UNAVAILABLE",
        message: "navigator.mediaDevices.getUserMedia is not available"
      };
    }

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
      this.cleanup();
      // AbortError or NotAllowedError occurs on protected/encrypted streams (Netflix EME/Widevine)
      const isDrm = err?.name === "AbortError" || err?.name === "NotAllowedError" || err?.name === "SecurityError";
      return {
        ok: false,
        error: isDrm ? "DRM_AUDIO_RESTRICTED" : "GET_USER_MEDIA_FAILED",
        message: isDrm
          ? "Audio capture is restricted on this source (DRM protected)."
          : (err?.message || "Failed to acquire tab audio stream")
      };
    }

    // Audio Mirroring: Pass stream to speakers so the user continues hearing playback
    if (this.AudioContextClass) {
      try {
        this.audioContext = new this.AudioContextClass();
        this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.audioSource.connect(this.audioContext.destination);
      } catch (err) {
        console.warn("[Offscreen Audio] Audio mirroring failed:", err);
      }
    }

    const chosenMimeType = this.resolveMimeType(mimeType);
    this.chunks = [];

    const MRecorder = this.MediaRecorderClass;
    if (!MRecorder) {
      this.cleanup();
      return {
        ok: false,
        error: "MEDIA_RECORDER_UNAVAILABLE",
        message: "MediaRecorder is not available in this environment"
      };
    }

    try {
      this.mediaRecorder = new MRecorder(this.mediaStream, { mimeType: chosenMimeType });
    } catch (_) {
      try {
        this.mediaRecorder = new MRecorder(this.mediaStream);
      } catch (recErr) {
        this.cleanup();
        return {
          ok: false,
          error: "RECORDER_INIT_FAILED",
          message: recErr?.message || "Failed to initialize MediaRecorder"
        };
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
          this.activeResolve?.({
            ok: false,
            error: "BLOB_CONVERSION_FAILED",
            message: convErr?.message || "Failed to convert audio blob to base64"
          });
          return;
        }

        this.cleanup();
        this.activeResolve?.({
          ok: true,
          dataUrl,
          mimeType: recordingMime,
          durationMs
        });
      };

      this.mediaRecorder.onerror = (event) => {
        this.cleanup();
        this.activeResolve?.({
          ok: false,
          error: "RECORDING_ERROR",
          message: event?.error?.message || "Error occurred during audio recording"
        });
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

    if (this.mediaStream) {
      try {
        const tracks = this.mediaStream.getTracks();
        tracks.forEach(track => {
          if (typeof track.stop === "function") {
            track.stop();
          }
        });
      } catch (_) {}
      this.mediaStream = null;
    }

    this.mediaRecorder = null;
    this.isRecording = false;
  }
}

// Global recorder instance for offscreen execution
let recorderInstance = null;
function getRecorderInstance() {
  if (!recorderInstance) {
    recorderInstance = new OffscreenAudioRecorder();
  }
  return recorderInstance;
}

// Runtime message listener for browser offscreen environment
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      return true; // Keep channel open for async response
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

    if (message?.type === "PING_OFFSCREEN") {
      const recorder = getRecorderInstance();
      sendResponse({ ok: true, isRecording: recorder.isRecording });
      return true;
    }
  });
}

// Universal module export for Node.js tests and browser globals
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OffscreenAudioRecorder,
    getRecorderInstance
  };
} else if (typeof window !== "undefined") {
  window.OffscreenAudioRecorder = OffscreenAudioRecorder;
  window.getRecorderInstance = getRecorderInstance;
}
