/**
 * Kiroku Note - AudioWorklet PCM Processor
 *
 * Runs on the high-priority Web Audio rendering thread inside the Offscreen Document.
 * 1. Ingests 128-sample multi-channel audio frames from the tabCapture stream.
 * 2. Downmixes stereo/multi-channel input to 1-channel Mono (L+R)/2.
 * 3. Batches samples into 2048-sample Float32Array blocks (~42.6ms @ 48kHz).
 * 4. Transfers blocks to the main Offscreen thread via zero-copy MessagePort.postMessage.
 */

// Use global AudioWorkletProcessor if available (standard AudioWorklet environment)
const BaseProcessor = typeof AudioWorkletProcessor !== "undefined"
  ? AudioWorkletProcessor
  : class {
      constructor() {
        this.port = { postMessage: () => {} };
      }
    };

class PCMRecorderProcessor extends BaseProcessor {
  constructor(options = {}) {
    super(options);
    this.blockSize = (options.processorOptions && options.processorOptions.blockSize) || 2048;
    this.buffer = new Float32Array(this.blockSize);
    this.bufferIndex = 0;
    this.isRecording = true;

    if (this.port && typeof this.port.onmessage !== "undefined") {
      this.port.onmessage = (event) => {
        if (event.data && event.data.type === "STOP") {
          this.flush();
          this.isRecording = false;
        } else if (event.data && event.data.type === "START") {
          this.isRecording = true;
          this.bufferIndex = 0;
        }
      };
    }
  }

  flush() {
    if (this.bufferIndex > 0) {
      const slice = this.buffer.subarray(0, this.bufferIndex);
      const outBuffer = new Float32Array(slice.length);
      outBuffer.set(slice);
      this.port.postMessage(outBuffer.buffer, [outBuffer.buffer]);
      this.bufferIndex = 0;
    }
  }

  process(inputs, _outputs, _parameters) {
    if (!this.isRecording) {
      return true;
    }

    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
      // If no audio is currently streaming (silence/inactive track), keep processor alive
      return true;
    }

    const numChannels = input.length;
    const channelLength = input[0].length; // Standard Web Audio chunk is 128 samples

    for (let i = 0; i < channelLength; i++) {
      let monoSample = 0;
      if (numChannels === 1) {
        monoSample = input[0][i];
      } else if (numChannels === 2) {
        monoSample = (input[0][i] + input[1][i]) * 0.5;
      } else {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += input[ch][i];
        }
        monoSample = sum / numChannels;
      }

      // Defensive clamping & NaN/Infinity protection
      if (typeof monoSample !== "number" || !isFinite(monoSample)) {
        monoSample = 0.0;
      } else if (monoSample > 1.0) {
        monoSample = 1.0;
      } else if (monoSample < -1.0) {
        monoSample = -1.0;
      }

      this.buffer[this.bufferIndex++] = monoSample;

      if (this.bufferIndex >= this.blockSize) {
        const transferBuffer = this.buffer;
        this.port.postMessage(transferBuffer.buffer, [transferBuffer.buffer]);
        this.buffer = new Float32Array(this.blockSize);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("pcm-recorder-processor", PCMRecorderProcessor);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PCMRecorderProcessor
  };
}
