/**
 * Kiroku Note - Deterministic 16-Bit Mono PCM WAV Encoder
 *
 * Encodes Float32 mono PCM samples into canonical 16-bit signed integer RIFF/WAVE audio.
 * Zero external dependencies, pure vanilla JavaScript using DataView and TypedArrays.
 */

class WavEncoder {
  /**
   * Encodes Float32 mono PCM samples into a 16-bit WAV ArrayBuffer.
   *
   * @param {Float32Array|number[]} samples Float32 PCM samples (-1.0 to 1.0)
   * @param {number} [sampleRate=48000] Audio sample rate in Hz
   * @returns {ArrayBuffer} Canonical 16-bit Mono WAV binary buffer
   */
  static encode(samples, sampleRate = 48000) {
    const rate = typeof sampleRate === "number" && sampleRate > 0 ? Math.round(sampleRate) : 48000;
    const numSamples = samples ? samples.length : 0;
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8; // 2 bytes
    const blockAlign = numChannels * bytesPerSample; // 2 bytes
    const byteRate = rate * blockAlign; // rate * 2
    const dataSize = numSamples * bytesPerSample; // numSamples * 2
    const totalBufferSize = 44 + dataSize; // 44-byte RIFF header + data

    const buffer = new ArrayBuffer(totalBufferSize);
    const view = new DataView(buffer);

    // Helper to write ASCII strings to DataView
    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // 1. RIFF Chunk Descriptor
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true); // chunkSize = 36 + subchunk2Size (Little Endian)
    writeString(8, "WAVE");

    // 2. "fmt " Sub-chunk
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // subchunk1Size = 16 for PCM
    view.setUint16(20, 1, true); // audioFormat = 1 (Linear PCM)
    view.setUint16(22, numChannels, true); // numChannels = 1 (Mono)
    view.setUint32(24, rate, true); // sampleRate
    view.setUint32(28, byteRate, true); // byteRate
    view.setUint16(32, blockAlign, true); // blockAlign
    view.setUint16(34, bitsPerSample, true); // bitsPerSample = 16

    // 3. "data" Sub-chunk
    writeString(36, "data");
    view.setUint32(40, dataSize, true); // subchunk2Size = numSamples * 2

    // 4. Convert and write 16-bit PCM samples with clamping
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      let s = samples[i];
      // Clamping to [-1.0, 1.0] range
      if (s > 1.0) s = 1.0;
      else if (s < -1.0) s = -1.0;
      else if (isNaN(s)) s = 0;

      // Scale to 16-bit signed integer range [-32768, 32767]
      const int16Sample = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
      view.setInt16(offset, int16Sample, true);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Encodes Float32 mono PCM samples and returns a Base64 Data URL string.
   *
   * @param {Float32Array|number[]} samples Float32 PCM samples (-1.0 to 1.0)
   * @param {number} [sampleRate=48000] Audio sample rate in Hz
   * @returns {string} Base64 Data URL (e.g. "data:audio/wav;base64,...")
   */
  static encodeToDataUrl(samples, sampleRate = 48000) {
    const arrayBuffer = WavEncoder.encode(samples, sampleRate);
    return WavEncoder.arrayBufferToDataUrl(arrayBuffer);
  }

  /**
   * Converts an ArrayBuffer to a data:audio/wav;base64 Data URL.
   *
   * @param {ArrayBuffer} arrayBuffer 
   * @returns {string}
   */
  static arrayBufferToDataUrl(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return "data:audio/wav;base64,";
    }

    if (typeof Buffer !== "undefined") {
      // Node.js environment
      const b64 = Buffer.from(arrayBuffer).toString("base64");
      return `data:audio/wav;base64,${b64}`;
    }

    // Browser environment: safe chunked binary string accumulation
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 0x4000; // 16KB chunks
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, bytes.length);
      for (let j = i; j < end; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
    }
    const b64 = typeof btoa === "function" ? btoa(binary) : "";
    return `data:audio/wav;base64,${b64}`;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WavEncoder
  };
} else if (typeof window !== "undefined") {
  window.WavEncoder = WavEncoder;
}
