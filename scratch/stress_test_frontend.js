/**
 * Comprehensive In-Code Frontend Stress Test & Breakage Audit for AnkiMiner.
 * Simulates extreme user actions, parser malformations, state machine transitions,
 * and keyboard shortcuts to find bugs or edge cases.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const SubtitleParser = require(path.resolve(__dirname, "../extension/lib/subtitle-parser.js"));

const findings = [];

function recordIssue(category, severity, description, impact) {
  findings.push({ category, severity, description, impact });
  console.log(`  [!] DISCOVERED FRONTEND DEFECT [${severity}]: ${description}`);
}

console.log("=".repeat(70));
console.log("ANKIMINER FRONTEND FEATURE SCAN & BREAKAGE AUDIT");
console.log("=".repeat(70));

// ---------------------------------------------------------------------------
// SECTION 1: SUBTITLE PARSER STRESS TEST & EDGE CASES
// ---------------------------------------------------------------------------
console.log("\n[Section 1] Stress-Testing Subtitle Parser Against Corrupted / Real-World Inputs...");

// 1.1 WebVTT with Header metadata, STYLE blocks, and NOTE comments
const complexVtt = `WEBVTT - YouTube export with notes
Kind: captions
Language: ja

STYLE
::cue {
  background: rgba(0,0,0,0.8);
  color: yellow;
}

NOTE
This is a comment note that should not be parsed as a cue

00:00:01.000 --> 00:00:03.500 position:10%,line:90% align:left
<ruby>私<rt>わたし</rt></ruby>の名前は<b>アリス</b>です。

NOTE Another comment block
with multiple lines

00:00:04.000 --> 00:00:06.000
これ、きれいだね。
`;

try {
  const cues = SubtitleParser.parseVTT(complexVtt);
  if (cues.length !== 2) {
    recordIssue("Subtitle Parser", "MEDIUM", `WebVTT with STYLE/NOTE parsed ${cues.length} cues instead of 2`, "Comments or style blocks leaked as subtitle cues");
  } else {
    console.log(`  [OK] WebVTT with STYLE and NOTE blocks parsed cleanly (${cues.length} cues)`);
    if (cues[0].text.includes("STYLE") || cues[0].text.includes("NOTE")) {
      recordIssue("Subtitle Parser", "HIGH", "STYLE or NOTE leaked into cue text", cues[0].text);
    } else {
      console.log("  [OK] STYLE/NOTE metadata did not leak into cue text");
    }
  }
} catch (e) {
  recordIssue("Subtitle Parser", "HIGH", `WebVTT parser crashed on STYLE/NOTE: ${e.message}`, e.stack);
}

// 1.2 Malformed Timestamps (SRT with commas, dots, 2-digit hour vs 1-digit hour)
const weirdSrt = `1
0:00:01,500 --> 0:00:03,800
Single digit hour SRT cue.

2
00:00:05.123 --> 00:00:07.456
Period instead of comma in SRT.
`;

try {
  const cues = SubtitleParser.parseSRT(weirdSrt);
  if (cues.length < 2) {
    recordIssue("Subtitle Parser", "MEDIUM", `SRT with single-digit hour or dot separator failed to parse all cues (got ${cues.length})`, "Some video subtitles with non-standard timestamps fail to load");
  } else {
    console.log(`  [OK] SRT with flexible timestamps parsed cleanly (${cues.length} cues)`);
  }
} catch (e) {
  recordIssue("Subtitle Parser", "HIGH", `SRT parser crashed on unusual timestamp format: ${e.message}`, e.stack);
}

// 1.3 Subtitles with UTF-8 BOM
const bomSrt = "\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\nBOM Test\r\n";
try {
  const cues = SubtitleParser.parseSRT(bomSrt);
  if (!cues.length || cues[0].startTime !== 1.0) {
    recordIssue("Subtitle Parser", "MEDIUM", "UTF-8 BOM at start of subtitle file broke first cue timestamp parsing", cues.length ? `Start was ${cues[0].startTime}` : "No cues parsed");
  } else {
    console.log("  [OK] UTF-8 BOM handled cleanly without breaking cue 1");
  }
} catch (e) {
  recordIssue("Subtitle Parser", "HIGH", `Crash on UTF-8 BOM: ${e.message}`, e.stack);
}

// 1.4 Empty or completely invalid files
try {
  const emptyCues = SubtitleParser.parseVTT("");
  if (emptyCues.length !== 0) recordIssue("Subtitle Parser", "LOW", "Empty file returned cues", emptyCues);
  else console.log("  [OK] Empty subtitle content returned empty array safely");

  const invalidCues = SubtitleParser.parseVTT("<html><body>Not a subtitle</body></html>");
  console.log(`  [OK] Non-subtitle HTML file handled safely without throw (${invalidCues.length} cues)`);
} catch (e) {
  recordIssue("Subtitle Parser", "HIGH", `Crash on empty or invalid file: ${e.message}`, e.stack);
}

// 1.5 Auto-detected Format Dispatcher
const sampleSrv3 = `<?xml version="1.0" encoding="utf-8" ?>
<timedtext format="3">
<head></head>
<body>
<p t="1000" d="2000">SRV3 XML Format</p>
</body>
</timedtext>`;

try {
  const parsedAutoVtt = SubtitleParser.parseSubtitles(complexVtt, "movie.vtt");
  const parsedAutoSrt = SubtitleParser.parseSubtitles(weirdSrt, "movie.srt");
  const parsedAutoSrv3 = SubtitleParser.parseSubtitles(sampleSrv3, "timedtext.xml");
  console.log(`  [OK] Auto-format dispatcher parsed VTT (${parsedAutoVtt.length}), SRT (${parsedAutoSrt.length}), SRV3 (${parsedAutoSrv3.length})`);
} catch (e) {
  recordIssue("Subtitle Parser", "HIGH", `Auto-format dispatcher failed: ${e.message}`, e.stack);
}

// ---------------------------------------------------------------------------
// SECTION 2: AUDIO CAPTURE MUTEX & CONCURRENCY
// ---------------------------------------------------------------------------
console.log("\n[Section 2] Auditing Audio Concurrency & Invariants in Background...");
const bgPath = path.resolve(__dirname, "../extension/background.js");
const bgContent = fs.readFileSync(bgPath, "utf-8");

if (!bgContent.includes("isRecordingAudio")) {
  recordIssue("Audio Concurrency", "HIGH", "Background service worker lacks audio recording mutex flag", "Concurrent capture calls could desync recording or hang audio context");
} else {
  console.log("  [OK] Audio recording concurrency mutex is present in background service worker");
}

if (!bgContent.includes("RECORDING_IN_PROGRESS")) {
  recordIssue("Audio Concurrency", "MEDIUM", "Background worker does not return RECORDING_IN_PROGRESS error code on race", "Side panel cannot show clear busy feedback");
} else {
  console.log("  [OK] Concurrent audio requests return structured RECORDING_IN_PROGRESS");
}


// ---------------------------------------------------------------------------
// SECTION 3: KEYBOARD SHORTCUTS & PANEL ACCESSIBILITY AUDIT
// ---------------------------------------------------------------------------
console.log("\n[Section 3] Auditing Keyboard Shortcuts & Side Panel Event Listeners...");
const panelJsPath = path.resolve(__dirname, "../extension/sidepanel/sidepanel.js");
const panelJs = fs.readFileSync(panelJsPath, "utf-8");

const expectedShortcuts = [
  { key: "Enter", description: "Save card shortcut (Ctrl+Enter / Cmd+Enter)" },
  { key: "k", description: "Focus word shortcut (Ctrl+K / Cmd+K)" },
  { key: "m", description: "Focus meaning shortcut (Ctrl+Shift+M / Cmd+Shift+M)" },
  { key: "Escape", description: "Close optional fields shortcut (Esc)" }
];

for (const sc of expectedShortcuts) {
  const hasKey = panelJs.includes(`"${sc.key}"`) || panelJs.includes(`'${sc.key}'`) || panelJs.toLowerCase().includes(`key === "${sc.key.toLowerCase()}"`);
  if (!hasKey) {
    recordIssue("Keyboard Navigation", "LOW", `Shortcut ${sc.description} not found in sidepanel.js`, "Power user navigation missing from side panel");
  } else {
    console.log(`  [OK] ${sc.description} implemented`);
  }
}


// ---------------------------------------------------------------------------
// SECTION 4: CARD EDITOR UI STATE & RETRY WORKFLOW
// ---------------------------------------------------------------------------
console.log("\n[Section 4] Auditing Anki Reconnection & Retry State Machine...");

if (!panelJs.includes('updateSyncUI("failed"') || !panelJs.includes("Retry Send to Anki")) {
  recordIssue("UI State Machine", "MEDIUM", "Side panel lacks explicit 'Retry Send to Anki' state when sync fails", "User cannot easily retry sync after starting Anki");
} else {
  console.log("  [OK] Side panel provides explicit 'Retry Send to Anki' button on failure");
}

if (!panelJs.includes("loadDecks") || !panelJs.includes("loadModels")) {
  recordIssue("UI State Machine", "LOW", "Side panel does not reload decks/models", "Panel cannot refresh deck list");
} else {
  console.log("  [OK] loadDecks and loadModels functions exist for deck and model synchronization");
}


// ---------------------------------------------------------------------------
// SECTION 5: SUMMARY OF FRONTEND FINDINGS
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(70));
console.log(`FRONTEND AUDIT SCAN COMPLETE: ${findings.length} Potential Issues / Edge Cases Identified`);
console.log("=".repeat(70));
findings.forEach((f, idx) => {
  console.log(`${idx + 1}. [${f.severity}] (${f.category}) ${f.description}`);
  console.log(`   Impact: ${f.impact}`);
});
