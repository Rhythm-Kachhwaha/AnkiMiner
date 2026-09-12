const assert = require("node:assert/strict");
const path = require("node:path");

const SubtitleParser = require(path.resolve(__dirname, "../lib/subtitle-parser.js"));

console.log("Starting SRV3 SubtitleParser tests...");

// 1. Standard YouTube SRV3 format
const srv3Sample = `<?xml version="1.0" encoding="utf-8" ?>
<timedtext format="3">
<head>
  <wp id="0" ap="7" ah="0" av="0" rc="16" cc="32"/>
  <ws id="0" ju="2" pd="0" sd="0"/>
  <w id="0" s="0"/>
</head>
<body id="0">
  <p t="1000" d="3500" wp="0" ws="0">日本語の字幕テスト</p>
  <p t="5000" d="2000"><s>二つ目の</s><s>セグメント</s></p>
  <p t="8000" d="4000">エンティティ &amp; &#39;テスト&#39; &quot;完了&quot;</p>
</body>
</timedtext>`;

const cues = SubtitleParser.parseSRV3(srv3Sample);
assert.equal(cues.length, 3, "SRV3 parser should parse 3 cues");

assert.equal(cues[0].id, 1);
assert.equal(cues[0].startTime, 1.0);
assert.equal(cues[0].endTime, 4.5);
assert.equal(cues[0].text, "日本語の字幕テスト");

assert.equal(cues[1].id, 2);
assert.equal(cues[1].startTime, 5.0);
assert.equal(cues[1].endTime, 7.0);
assert.equal(cues[1].text, "二つ目のセグメント");

assert.equal(cues[2].id, 3);
assert.equal(cues[2].startTime, 8.0);
assert.equal(cues[2].endTime, 12.0);
assert.equal(cues[2].text, "エンティティ & 'テスト' \"完了\"");

console.log("PASS: Standard SRV3 parsing verified.");

// 2. Overlap clamping test
const overlapSample = `<?xml version="1.0" encoding="utf-8" ?>
<timedtext format="3">
<body id="0">
  <p t="1000" d="5000">最初の行（重複あり）</p>
  <p t="3000" d="3000">二番目の行</p>
</body>
</timedtext>`;

const overlapCues = SubtitleParser.parseSRV3(overlapSample);
assert.equal(overlapCues.length, 2);
assert.equal(overlapCues[0].startTime, 1.0);
assert.equal(overlapCues[0].endTime, 3.0, "First cue duration should be clamped to next cue's start time (3.0s)");
assert.equal(overlapCues[1].startTime, 3.0);
assert.equal(overlapCues[1].endTime, 6.0);

console.log("PASS: Overlap clamping verified.");

// 3. Auto-detect with parseSubtitles
const detectedCues = SubtitleParser.parseSubtitles(srv3Sample, "subtitles.srv3");
assert.equal(detectedCues.length, 3);
assert.equal(detectedCues[0].text, "日本語の字幕テスト");

const detectedYtSrv3 = SubtitleParser.parseSubtitles(srv3Sample, "subtitles.ytsrv3");
assert.equal(detectedYtSrv3.length, 3);

console.log("PASS: parseSubtitles auto-detection for SRV3 verified.");
console.log("All SRV3 tests PASSED successfully!");
