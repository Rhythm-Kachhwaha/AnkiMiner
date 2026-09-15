const assert = require("node:assert/strict");
const { WavEncoder } = require("../offscreen/wav-encoder.js");

console.log("Starting Deterministic 16-Bit Mono WAV Encoder Tests...\n");

function testRiffWaveHeaderStructure() {
  const sampleRate = 48000;
  const numSamples = 4800; // 0.1s of audio
  const samples = new Float32Array(numSamples);

  // Generate 440 Hz sine wave
  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8;
  }

  const arrayBuffer = WavEncoder.encode(samples, sampleRate);
  assert.equal(arrayBuffer.byteLength, 44 + (numSamples * 2), "Total buffer size must be 44-byte header + (numSamples * 2 bytes)");

  const view = new DataView(arrayBuffer);

  // Helper to read ASCII
  function readString(offset, len) {
    let str = "";
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(view.getUint8(offset + i));
    }
    return str;
  }

  // 1. RIFF descriptor
  assert.equal(readString(0, 4), "RIFF", "Header must begin with 'RIFF'");
  const expectedChunkSize = 36 + (numSamples * 2);
  assert.equal(view.getUint32(4, true), expectedChunkSize, `Chunk size must be ${expectedChunkSize}`);
  assert.equal(readString(8, 4), "WAVE", "Format must be 'WAVE'");

  // 2. fmt sub-chunk
  assert.equal(readString(12, 4), "fmt ", "Subchunk1 ID must be 'fmt '");
  assert.equal(view.getUint32(16, true), 16, "Subchunk1 size must be 16 for standard PCM");
  assert.equal(view.getUint16(20, true), 1, "Audio format must be 1 (Linear PCM)");
  assert.equal(view.getUint16(22, true), 1, "Channel count must be 1 (Mono)");
  assert.equal(view.getUint32(24, true), 48000, "Sample rate must be 48000");
  assert.equal(view.getUint32(28, true), 48000 * 2, "Byte rate must be sampleRate * numChannels * 2");
  assert.equal(view.getUint16(32, true), 2, "Block align must be numChannels * bytesPerSample = 2");
  assert.equal(view.getUint16(34, true), 16, "Bits per sample must be 16");

  // 3. data sub-chunk
  assert.equal(readString(36, 4), "data", "Subchunk2 ID must be 'data'");
  assert.equal(view.getUint32(40, true), numSamples * 2, "Data size must be numSamples * 2");

  console.log("PASS: Canonical 44-byte RIFF/WAVE header structure verified.");
}

function testSampleConversionAndClamping() {
  const sampleRate = 44100;
  // Test specific sample values: -1.0, 1.0, 0.0, -0.5, 0.5, clamped beyond +/- 1.0, and NaN
  const inputSamples = new Float32Array([-1.0, 1.0, 0.0, -0.5, 0.5, -2.5, 3.0, NaN]);
  const arrayBuffer = WavEncoder.encode(inputSamples, sampleRate);
  const view = new DataView(arrayBuffer);

  const sample0 = view.getInt16(44 + 0 * 2, true);
  assert.equal(sample0, -32768, "-1.0 must convert to -32768");

  const sample1 = view.getInt16(44 + 1 * 2, true);
  assert.equal(sample1, 32767, "1.0 must convert to 32767");

  const sample2 = view.getInt16(44 + 2 * 2, true);
  assert.equal(sample2, 0, "0.0 must convert to 0");

  const sample3 = view.getInt16(44 + 3 * 2, true);
  assert.equal(sample3, -16384, "-0.5 must convert to -16384");

  const sample4 = view.getInt16(44 + 4 * 2, true);
  assert.equal(sample4, 16384, "0.5 must convert to 16384 (rounded 0.5 * 32767)");

  const sample5 = view.getInt16(44 + 5 * 2, true);
  assert.equal(sample5, -32768, "-2.5 must clamp to -32768");

  const sample6 = view.getInt16(44 + 6 * 2, true);
  assert.equal(sample6, 32767, "3.0 must clamp to 32767");

  const sample7 = view.getInt16(44 + 7 * 2, true);
  assert.equal(sample7, 0, "NaN must map to 0");

  console.log("PASS: Float32 to Int16 sample conversion and clamping verified.");
}

function testDataUrlEncoding() {
  const sampleRate = 48000;
  const samples = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
  const dataUrl = WavEncoder.encodeToDataUrl(samples, sampleRate);

  assert.ok(dataUrl.startsWith("data:audio/wav;base64,"), "Data URL must have 'data:audio/wav;base64,' prefix");
  const b64Payload = dataUrl.replace("data:audio/wav;base64,", "");
  const decodedBuffer = Buffer.from(b64Payload, "base64");

  assert.equal(decodedBuffer.length, 44 + (5 * 2), "Decoded Base64 buffer length must match header + samples");

  console.log("PASS: Base64 Data URL encoding verified.");
}

function testEdgeCases() {
  // Empty samples
  const emptyBuf = WavEncoder.encode(new Float32Array(0), 48000);
  assert.equal(emptyBuf.byteLength, 44, "Empty sample array must produce valid 44-byte header with data size 0");
  const emptyDataUrl = WavEncoder.encodeToDataUrl(new Float32Array(0), 48000);
  assert.ok(emptyDataUrl.startsWith("data:audio/wav;base64,"));

  // Null / undefined handling
  const nullBuf = WavEncoder.encode(null, 44100);
  assert.equal(nullBuf.byteLength, 44);

  // Default sample rate fallback
  const defaultRateBuf = WavEncoder.encode(new Float32Array(100), 0);
  const view = new DataView(defaultRateBuf);
  assert.equal(view.getUint32(24, true), 48000, "Invalid sample rate must default to 48000 Hz");

  console.log("PASS: Edge cases (empty, null, fallback sample rate) verified.");
}

function runAll() {
  testRiffWaveHeaderStructure();
  testSampleConversionAndClamping();
  testDataUrlEncoding();
  testEdgeCases();
  console.log("\n>>> ALL WAV ENCODER TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAll();
