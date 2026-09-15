const assert = require("node:assert/strict");
const path = require("node:path");
const { RollingPcmBuffer } = require("../offscreen/rolling-pcm-buffer.js");

console.log("Starting Rolling Circular PCM Buffer Tests...\n");

function testInitializationAndSizing() {
  // Default 48kHz, 30 seconds
  const buf48k = new RollingPcmBuffer();
  assert.equal(buf48k.sampleRate, 48000);
  assert.equal(buf48k.durationSeconds, 30);
  assert.equal(buf48k.capacity, 1440000, "48000 * 30 = 1,440,000 samples");
  assert.equal(buf48k.buffer.length, 1440000);
  assert.equal(buf48k.getMemoryUsageBytes(), 5760000, "1,440,000 * 4 bytes = 5.76 MB");
  assert.equal(buf48k.getAvailableSamplesCount(), 0);
  assert.equal(buf48k.getBufferDuration(), 0.0);
  assert.equal(buf48k.isFull, false);

  // Custom 44.1kHz, 30 seconds
  const buf44k = new RollingPcmBuffer({ sampleRate: 44100, durationSeconds: 30 });
  assert.equal(buf44k.sampleRate, 44100);
  assert.equal(buf44k.capacity, 1323000, "44100 * 30 = 1,323,000 samples");
  assert.equal(buf44k.getMemoryUsageBytes(), 5292000, "1,323,000 * 4 bytes = 5.292 MB");

  console.log("PASS: RollingPcmBuffer initialization and sizing verified.");
}

function testLinearWriteAndAvailableDuration() {
  const buf = new RollingPcmBuffer({ sampleRate: 1000, durationSeconds: 10 }); // 10,000 samples capacity
  assert.equal(buf.capacity, 10000);

  // Write 2000 samples
  const chunk1 = new Float32Array(2000);
  chunk1.fill(0.5);
  buf.write(chunk1);

  assert.equal(buf.totalSamplesWritten, 2000);
  assert.equal(buf.getAvailableSamplesCount(), 2000);
  assert.equal(buf.getBufferDuration(), 2.0);
  assert.equal(buf.isFull, false);

  // Write another 3000 samples
  const chunk2 = new Float32Array(3000);
  chunk2.fill(0.75);
  buf.write(chunk2);

  assert.equal(buf.totalSamplesWritten, 5000);
  assert.equal(buf.getAvailableSamplesCount(), 5000);
  assert.equal(buf.getBufferDuration(), 5.0);
  assert.equal(buf.isFull, false);

  console.log("PASS: Linear write and available duration calculation verified.");
}

function testCircularWraparoundAndOverwrite() {
  // Small capacity buffer for exact sample assertion: 10 samples capacity
  const buf = new RollingPcmBuffer({ sampleRate: 10, durationSeconds: 1 });
  assert.equal(buf.capacity, 10);

  // Ingest sample numbers 1 to 6
  const chunk1 = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
  buf.write(chunk1);
  assert.equal(buf.writeIndex, 6);
  assert.equal(buf.totalSamplesWritten, 6);
  assert.equal(buf.isFull, false);

  // Ingest sample numbers 7 to 12 (crosses boundary at index 10 and wraps to 0..2)
  const chunk2 = new Float32Array([7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
  buf.write(chunk2);
  assert.equal(buf.totalSamplesWritten, 12);
  assert.equal(buf.writeIndex, 2);
  assert.equal(buf.isFull, true);
  assert.equal(buf.getAvailableSamplesCount(), 10, "Capacity is bounded to 10");

  // Read all 10 available recent samples in chronological order
  const recent = buf.readRecent(10);
  assert.equal(recent.length, 10);
  // Expected chronological order: 3.0 through 12.0 (1.0 and 2.0 were overwritten)
  const expected = [3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0];
  for (let i = 0; i < 10; i++) {
    assert.equal(recent[i], expected[i], `Sample at index ${i} should be ${expected[i]}`);
  }

  console.log("PASS: Circular wraparound and oldest sample overwrite verified.");
}

function testLongStreamSimulation() {
  // Simulate 120 seconds of audio at 48kHz ingested via 2048-sample blocks into a 30s buffer
  const sampleRate = 48000;
  const durationSec = 30;
  const buf = new RollingPcmBuffer({ sampleRate, durationSeconds: durationSec });

  const totalSimulationSeconds = 120;
  const totalSamples = sampleRate * totalSimulationSeconds;
  const blockSize = 2048;
  const totalBlocks = Math.ceil(totalSamples / blockSize);

  const block = new Float32Array(blockSize);
  for (let b = 0; b < totalBlocks; b++) {
    block.fill(b);
    buf.write(block);
  }

  assert.equal(buf.isFull, true);
  assert.equal(buf.getAvailableSamplesCount(), buf.capacity);
  assert.equal(buf.getBufferDuration(), 30.0);
  assert.equal(buf.getMemoryUsageBytes(), 5760000, "Memory footprint must remain constant");

  const stats = buf.getStats();
  assert.equal(stats.sampleRate, 48000);
  assert.equal(stats.durationSeconds, 30);
  assert.equal(stats.isFull, true);
  assert.equal(stats.memoryUsageMB, 5.49); // 5760000 / (1024 * 1024) = 5.49 MB

  console.log("PASS: Long stream simulation (120s @ 48kHz) with bounded memory verified.");
}

function testClearAndReconfigure() {
  const buf = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  buf.write(new Float32Array(10000));
  assert.equal(buf.totalSamplesWritten, 10000);

  buf.clear();
  assert.equal(buf.totalSamplesWritten, 0);
  assert.equal(buf.writeIndex, 0);
  assert.equal(buf.isFull, false);
  assert.equal(buf.getAvailableSamplesCount(), 0);

  buf.reconfigure(44100, 30);
  assert.equal(buf.sampleRate, 44100);
  assert.equal(buf.capacity, 1323000);

  console.log("PASS: RollingPcmBuffer clear and reconfigure verified.");
}

function runAll() {
  testInitializationAndSizing();
  testLinearWriteAndAvailableDuration();
  testCircularWraparoundAndOverwrite();
  testLongStreamSimulation();
  testClearAndReconfigure();
  console.log("\n>>> ALL ROLLING PCM BUFFER TESTS PASSED SUCCESSFULLY! <<<\n");
}

runAll();
