const assert = require("node:assert/strict");
const path = require("node:path");

const SubtitleParser = require(path.resolve(__dirname, "../lib/subtitle-parser.js"));

console.log("Starting subtitle-parser tests...");

// 1. SRT Parsing
const sampleSRT = `
1
00:00:01,200 --> 00:00:04,500
これは<b>テスト</b>です。
二行目の字幕。

2
00:01:15,000 --> 00:01:18,750
<i>逃げるな！</i>生きる方が戦いだ！
<font color="#ff0000">赤色テキスト</font>

3
00:02:00,000 --> 00:02:05,000
約束の場所へ行こう
`;

const srtCues = SubtitleParser.parseSRT(sampleSRT);
assert.equal(srtCues.length, 3, "SRT should parse 3 cues");

assert.equal(srtCues[0].id, 1);
assert.equal(srtCues[0].startTime, 1.2);
assert.equal(srtCues[0].endTime, 4.5);
assert.equal(srtCues[0].text, "これはテストです。\n二行目の字幕。");

assert.equal(srtCues[1].id, 2);
assert.equal(srtCues[1].startTime, 75.0);
assert.equal(srtCues[1].endTime, 78.75);
assert.equal(srtCues[1].text, "逃げるな！生きる方が戦いだ！\n赤色テキスト");

assert.equal(srtCues[2].id, 3);
assert.equal(srtCues[2].startTime, 120.0);
assert.equal(srtCues[2].endTime, 125.0);
assert.equal(srtCues[2].text, "約束の場所へ行こう");

console.log("PASS: SRT parsing verified.");

// 2. WebVTT Parsing
const sampleVTT = `WEBVTT - Sample File
Kind: captions
Language: ja

cue-1
00:00:02.500 --> 00:00:06.000
<c.yellow>こんにちは世界</c>

01:20.000 --> 01:23.500
短縮タイムスタンプのテスト
`;

const vttCues = SubtitleParser.parseVTT(sampleVTT);
assert.equal(vttCues.length, 2, "VTT should parse 2 cues");

assert.equal(vttCues[0].startTime, 2.5);
assert.equal(vttCues[0].endTime, 6.0);
assert.equal(vttCues[0].text, "こんにちは世界");

assert.equal(vttCues[1].startTime, 80.0);
assert.equal(vttCues[1].endTime, 83.5);
assert.equal(vttCues[1].text, "短縮タイムスタンプのテスト");

console.log("PASS: WebVTT parsing verified.");

// 3. Auto-detection via parseSubtitles
const autoSrt = SubtitleParser.parseSubtitles(sampleSRT, "frieren_ep1.srt");
assert.equal(autoSrt.length, 3);

const autoVtt = SubtitleParser.parseSubtitles(sampleVTT, "anime.vtt");
assert.equal(autoVtt.length, 2);

const autoSniffedVtt = SubtitleParser.parseSubtitles(sampleVTT);
assert.equal(autoSniffedVtt.length, 2);

console.log("PASS: Auto-detection verified.");

// 4. Timing shift utility
const shiftedPlus = SubtitleParser.shiftCues(srtCues, 0.5);
assert.equal(shiftedPlus[0].startTime, 1.7);
assert.equal(shiftedPlus[0].endTime, 5.0);

const shiftedMinus = SubtitleParser.shiftCues(srtCues, -2.0);
assert.equal(shiftedMinus[0].startTime, 0); // clamped to 0
assert.equal(shiftedMinus[0].endTime, 2.5);

console.log("PASS: Timing shift verified.");

// 5. Edge cases: Empty or malformed input
assert.deepEqual(SubtitleParser.parseSubtitles(""), []);
assert.deepEqual(SubtitleParser.parseSubtitles(null), []);
assert.deepEqual(SubtitleParser.parseSRT("Not a subtitle file at all\njust random text"), []);

console.log("ALL SUBTITLE PARSER TESTS PASSED!");
