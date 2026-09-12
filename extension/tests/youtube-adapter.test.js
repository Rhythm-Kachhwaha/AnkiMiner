const assert = require("node:assert/strict");
const path = require("node:path");

const SubtitleParser = require(path.resolve(__dirname, "../lib/subtitle-parser.js"));
global.SubtitleParser = SubtitleParser;

const YouTubeModule = require(path.resolve(__dirname, "../content/adapters/youtube-adapter.js"));
const {
  normalizeCaptionTrack,
  prioritizeTracks,
  extractTracksFromHtml,
  YouTubeAdapter
} = YouTubeModule;

console.log("Starting youtube-adapter tests...");

// 1. normalizeCaptionTrack with SRV3
const rawTrackJa = {
  baseUrl: "https://www.youtube.com/api/timedtext?v=123&lang=ja",
  name: { simpleText: "Japanese" },
  languageCode: "ja",
  kind: "standard"
};

const normJa = normalizeCaptionTrack(rawTrackJa);
assert.equal(normJa.languageCode, "ja");
assert.equal(normJa.name, "Japanese");
assert.equal(normJa.isAuto, false);
assert.ok(normJa.srv3Url.includes("fmt=srv3"), "Must format URL with fmt=srv3");
assert.ok(normJa.srv3Url.includes("c=WEB"), "Must include client parameter c=WEB");

const rawTrackJaAuto = {
  baseUrl: "https://www.youtube.com/api/timedtext?v=123&lang=ja&kind=asr",
  name: { simpleText: "Japanese (auto-generated)" },
  languageCode: "ja",
  kind: "asr"
};

const normJaAuto = normalizeCaptionTrack(rawTrackJaAuto);
assert.equal(normJaAuto.isAuto, true);
assert.ok(normJaAuto.srv3Url.includes("fmt=srv3"));

console.log("PASS: normalizeCaptionTrack verified.");

// 2. prioritizeTracks
const rawTracks = [
  {
    baseUrl: "https://www.youtube.com/api/timedtext?v=123&lang=en",
    name: { simpleText: "English" },
    languageCode: "en"
  },
  rawTrackJaAuto,
  rawTrackJa,
  {
    baseUrl: "https://www.youtube.com/api/timedtext?v=123&lang=es",
    name: { simpleText: "Spanish" },
    languageCode: "es"
  }
];

const prioritized = prioritizeTracks(rawTracks);
assert.equal(prioritized.length, 4);
assert.equal(prioritized[0].name, "Japanese", "Manual Japanese track must be #1 priority");
assert.equal(prioritized[1].name, "Japanese (auto-generated)", "Auto Japanese track must be #2 priority");
assert.ok(!prioritized[2].languageCode.startsWith("ja"), "Non-Japanese tracks follow");

// 2b. Auto-translate track generation when only English exists
const englishOnly = [
  {
    baseUrl: "https://www.youtube.com/api/timedtext?v=xyz&lang=en",
    name: { simpleText: "English" },
    languageCode: "en"
  }
];

const prioritizedAutoTranslate = prioritizeTracks(englishOnly);
assert.equal(prioritizedAutoTranslate.length, 2);
assert.equal(prioritizedAutoTranslate[0].languageCode, "ja_translated");
assert.ok(prioritizedAutoTranslate[0].srv3Url.includes("tlang=ja"));

console.log("PASS: prioritizeTracks & auto-translate synthesis verified.");

// 3. extractTracksFromHtml
const mockPlayerScript = `
  var ytInitialPlayerResponse = {
    "responseContext": {},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [
          {
            "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=ja",
            "name": {"simpleText": "Japanese"},
            "languageCode": "ja"
          }
        ]
      }
    }
  };
`;

const extracted = extractTracksFromHtml(mockPlayerScript);
assert.equal(extracted.length, 1);
assert.equal(extracted[0].languageCode, "ja");
assert.equal(extracted[0].baseUrl, "https://www.youtube.com/api/timedtext?v=abc&lang=ja");

console.log("PASS: extractTracksFromHtml verified.");

// 4. YouTubeAdapter Integration with Mock Environment & SRV3 XML Response
let loadedCues = null;
let loadedTrack = null;

const sampleSRV3 = `<?xml version="1.0" encoding="utf-8" ?>
<timedtext format="3">
<body id="0">
  <p t="1500" d="3000">日本語のアダプターテスト</p>
</body>
</timedtext>
`;

// Mock global environment
global.location = { hostname: "www.youtube.com", href: "https://www.youtube.com/watch?v=abc" };
global.document = {
  getElementById: () => null,
  head: { appendChild: () => {} },
  createElement: () => ({ id: "", textContent: "" }),
  querySelectorAll: () => [
    { textContent: mockPlayerScript }
  ]
};
global.chrome = {
  runtime: {
    sendMessage: (msg) => {
      if (msg.type === "FETCH_YOUTUBE_TIMEDTEXT") {
        return Promise.resolve({ ok: true, text: sampleSRV3 });
      }
      return Promise.resolve({ ok: true });
    },
    onMessage: { addListener: () => {} }
  }
};

const adapter = new YouTubeAdapter({
  onCuesLoaded: (cues, track) => {
    loadedCues = cues;
    loadedTrack = track;
  }
});

adapter.checkAndLoad().then(() => {
  assert.ok(loadedCues, "Cues must be loaded from mock SRV3 response");
  assert.equal(loadedCues.length, 1);
  assert.equal(loadedCues[0].text, "日本語のアダプターテスト");
  assert.equal(loadedCues[0].startTime, 1.5);
  assert.equal(loadedCues[0].endTime, 4.5);
  assert.equal(loadedTrack.languageCode, "ja");

  console.log("PASS: YouTubeAdapter end-to-end SRV3 integration verified.");
  console.log("ALL YOUTUBE ADAPTER TESTS PASSED!");
}).catch(err => {
  console.error("FAILED:", err);
  process.exit(1);
});
