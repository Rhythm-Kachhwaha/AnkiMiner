# Kiroku Note — V1.0 Stage 3A Research & Design Report: Dictionary Architecture & Normalization Engine

**Document Path:** `V1/Stage3A.md`  
**Execution Type:** Research & Technical Design Only (Zero Source Code Changes)  
**Date:** 2026-09-16  
**Status:** Complete  

---

## 1. Executive Summary

### 1.1 Purpose of Stage 3A
Stage 3A conducts an exhaustive architectural audit, technical research, and system design for the dictionary ingestion and presentation pipeline in **Kiroku Note**.

In the current baseline (V1.0 Stage 2), Japanese text capture and dictionary lookup operate end-to-end between the Chromium extension and the FastAPI backend. However, the existing dictionary parser is ad-hoc, overly aggressive in discarding linguistic metadata, flattens grammatical part-of-speech context, truncates polysemous vocabulary to a single meaning in card drafts, and forces the frontend Side Panel to perform fragile client-side string deduplication and parsing.

This report establishes:
1. A thorough **audit** of the existing dictionary data flow across all system layers.
2. A comprehensive **taxonomy of the Yomitan dictionary ecosystem** (bilingual, monolingual, frequency, pitch accent, kanji, and grammar datasets).
3. A rigorous assessment of **JLPT metadata availability, reliability, and architectural placement**.
4. A verified breakdown of **Yomitan's native messaging and HTTP API capabilities**.
5. A **provider-agnostic architecture** that decouples dictionary parsing from specific upstream vendors while preserving maximum linguistic richness.
6. Formal **Pydantic/Dataclass domain models** for structured dictionary entries, senses, pitch accents, frequencies, and examples.
7. A concrete, zero-downtime **migration plan** for Stage 3B.
8. An exhaustive **test plan** addressing edge cases, malformed payloads, and polysemy.
9. An analysis of **architectural risks, constraints, and open questions**.
10. A phased **Stage 3B implementation sequence**.

---

## 2. Current Architecture Audit

### 2.1 End-to-End Pipeline Trace

```
[ Webpage Text Selection / Subtitle ]
                │
                ▼
[ extension/content/capture-utils.js ]
  Passes Japanese string via chrome.runtime messaging: JAPANESE_TEXT_CAPTURED
                │
                ▼
[ extension/sidepanel/sidepanel.js ]
  Calls POST http://127.0.0.1:8000/api/capture with payload {"text": "...", "deck_name": "Default", "auto_save": false}
                │
                ▼
[ backend/app/main.py: capture_term() ]
  Routes request to CardService.capture_term(text, deck_name)
                │
                ▼
[ backend/app/services/card_service.py ]
  1. Calls YomitanService.identify(text) -> POST /tokenize (127.0.0.1:19633)
  2. Calls YomitanService.enrich(term)  -> POST /termEntries (127.0.0.1:19633)
  3. Flattens first sense of first entry into `default_meaning`
  4. Flattens first example of first sense into `default_example`
  5. Queries SQLite CardRepository.find_by_identity(expression, reading, deck_name)
  6. Constructs CaptureResponse(entries=[asdict(e) for e in enriched.entries], ...)
                │
                ▼
[ backend/app/services/yomitan.py ]
  - normalize_tokenize_response: extracts headword term, reading, source_text, deinflected_text
  - normalize_term_entries_response: parses AST JSON nodes via _find_marked, _plain_text
                │
                ▼
[ FastAPI JSON Response: CaptureResponse ]
                │
                ▼
[ extension/sidepanel/sidepanel.js: renderDetails() ]
  1. Builds custom Set for parts-of-speech
  2. Creates composite string key: senseKey = distinctGlosses.map(g => g.toLowerCase()).sort().join("|")
  3. Deduplicates senses across dictionaries on client
  4. Renders study view DOM (#meanings) and raw text DOM (#dict-raw-view)
```

### 2.2 Deep Audit of Component Deficiencies

| Component | File & Lines | Current Behavior | Critical Defects & Data Loss |
| :--- | :--- | :--- | :--- |
| **Yomitan Tokenizer Normalization** | `backend/app/services/yomitan.py`<br>`lines 74–92` | Scans `/tokenize` content for `headwords` or first text token matching Japanese Unicode ranges. | Functional, but assumes token segments always have `headwords` arrays. If Yomitan's deinflector encounters complex colloquial conjugations (e.g. `食べさせられちゃった`), fallback to raw token text can drop the lemma reading. |
| **Yomitan Term Normalizer** | `backend/app/services/yomitan.py`<br>`lines 103–188` | Recursively searches AST nodes for tags `sense-group`, `part-of-speech-info`, `glossary`, and `example-sentence`. | **1. Detaches POS from Senses:** POS tags are extracted at the group level and dumped into `DictionaryEntry.parts_of_speech` (a flat list on the entry). If Sense 1 is a transitive verb and Sense 2 is an intransitive verb, that distinction is lost.<br>**2. Drops Pitch Accent:** Discards Yomitan's `pitches` data array entirely.<br>**3. Drops Frequency Data:** Discards Yomitan's `frequencies` data array entirely.<br>**4. Strips Ruby Furigana:** Recursively discards `<rt>` tags in `_plain_text`, destroying furigana annotations in example sentences.<br>**5. Discards Linguistic Tags:** Drops JLPT markers, archaic tags, dialect markers, vulgarity tags, and field tags (`[comp]`, `[med]`, `[ling]`). |
| **CardService Draft Synthesis** | `backend/app/services/card_service.py`<br>`lines 59–78` | Loops through `enriched.entries` and assigns `default_meaning` to `", ".join(sense.glosses)` for the **first sense only** of the first dictionary. | **Massive Polysemy Truncation:** Words with multiple core meanings (e.g., 掛ける, 出る, 取る, 立つ) have all subsequent senses (2, 3, 4...) discarded from the default card draft. The user must manually re-type or copy definitions. |
| **Backend Schemas** | `backend/app/schemas.py`<br>`lines 22–43` | Defines simple `Example`, `Sense`, and `DictionaryEntry` Pydantic models. | Schema lacks fields for `parts_of_speech` per sense, `tags` per sense, `pitch_accents`, `frequencies`, `score`, `jlpt`, and `dictionary_alias`. |
| **Side Panel Controller** | `extension/sidepanel/sidepanel.js`<br>`lines 443–640` | `renderDetails()` parses `body.entries`, deduplicates POS tags across dictionaries using a JavaScript `Set`, and deduplicates senses across dictionaries using compound string keys. | **Violation of Layer Boundaries:** The browser frontend performs complex business logic and heuristic cross-dictionary deduplication in unbundled vanilla JS. Formatting changes or dictionary schema variations easily cause rendering bugs. |
| **Side Panel DOM** | `extension/sidepanel/sidepanel.html`<br>`lines 135–155` | Renders a single `#meanings` container and hidden `#dict-raw-view`. | Lacks structured slots for pitch accent graphs, frequency badges, sense-specific grammatical tags, or interactive copy-to-field buttons. |

---

## 3. Japanese Dictionary Ecosystem Research

To design a robust, future-proof dictionary engine, we investigated all major dictionary formats and datasets compatible with the Yomitan / Yomichan specification.

### 3.1 Bilingual Japanese–English Dictionaries

| Dictionary Name | Primary Source / Engine | Strengths | Limitations / Edge Cases | AST & Data Representation |
| :--- | :--- | :--- | :--- | :--- |
| **Jitendex** (`Jitendex.org`) | Modern community fork of JMdict, JMnedict, and Wadoku | Rich structured HTML/JSON nodes, embedded pitch accent indicators, frequency stars/ranks, clean example sentence pairs (`example-sentence-a` / `b`), JLPT tags, cross-references. Actively maintained. | Heavily nested structured content AST (`div`, `span`, `ruby`, `ul`, `table`); requires sophisticated recursive parsing. | Uses `type: "structured-content"` with custom `data: { "content": "..." }` attributes (`sense`, `sense-group`, `glossary`, `example-sentence`). |
| **JMdict (English)** | Electronic Dictionary Research and Development Group (EDRDG) | Standard baseline for open-source Japanese lexicography. Comprehensive vocabulary coverage, standardized part-of-speech codes (`v5r`, `adj-i`, `vs`, `vt`, `vi`), cross-references (`see`, `ant`). | Formatting can be terse. Older distributions lack modern colloquialisms or embedded example sentences. | Often represented as arrays of plain strings or basic structured-content lists. |
| **Kenkyusha’s New Japanese-English Dictionary (5th Ed.)** | Kenkyusha (commercial EPWING conversion) | The "Green Goddess." Deepest bilingual reference available; exceptional nuanced English translations, idioms, proverbs, collocations, and literary examples. | Large AST; conversion tools vary widely in tag output. Often contains complex HTML tables and indentation markers. | Mixed: structured HTML blocks or preformatted text lines with custom delimiter symbols (`◆`, `【`, `〔`). |
| **Wisdom Japanese-English / Progressive Japanese-English** | Sanseido / Shogakukan (EPWING conversion) | Clear, learner-oriented English glosses; strong focus on modern usage, transitive/intransitive pairings, and common syntactic patterns. | Less exhaustive than Kenkyusha for rare or historical terms. | Nested sense groups with lettered/numbered sub-senses (`(1)`, `(2)`, `[a]`, `[b]`). |

### 3.2 Monolingual Japanese Dictionaries (Kokugo Jiten)

| Dictionary Name | Publisher | Characteristics | Parser Requirements |
| :--- | :--- | :--- | :--- |
| **Daijirin (大辞林 - 3rd/4th Ed.)** | Sanseido | Modern descriptive definitions, pitch accent numbers (e.g. `⓪`, `①`), historical and modern etymologies, kanji headword distinctions. | Definitions written entirely in Japanese. Headword readings may be presented in historical kana. Pitch numbers must be extracted from definition headers. |
| **Shinmeikai Kokugo Jiten (新明解国語辞典 - 7th/8th Ed.)** | Sanseido | Famous for precise, highly opinionated, semantic distinctions, deep grammatical guidance, and explicit transitive/intransitive/particle patterns (`…を…する`, `…に…する`). | Uses custom grammatical symbols and abbreviation markers. Pitch accent numbers embedded in headword tags. |
| **Meikyo Kokugo Jiten (明鏡国語辞典 - 2nd/3rd Ed.)** | Taishukan Shoten | Superb coverage of word usage errors, keigo (politeness levels), particle collocations, and subtle nuances between near-synonyms. | Rich metadata tags for usage warnings (`【使い方】`, `【注意】`, `【誤用】`). |
| **Daijisen (大辞泉 - Digital Ed.)** | Shogakukan | Encyclopedic breadth, modern neologisms, popular culture terms, clear example sentences, full-color image references in some digital releases. | Frequent updates; high volume of proper nouns and technical jargon. |
| **Koujien (広辞苑 - 7th Ed.)** | Iwanami Shoten | Definitive historical authority; senses ordered chronologically from classical Japanese to modern usage. | Sense 1 is often historical/archaic; modern learners require reading subsequent senses. |

### 3.3 Specialized Meta-Dictionaries

#### A. Frequency Dictionaries (`term_meta_bank`)
- **BCCWJ (Balanced Corpus of Contemporary Written Japanese):** Official 100-million-word corpus by the National Institute for Japanese Language and Linguistics (NINJAL). Gold standard for written Japanese frequency.
- **Innocent Corpus (Novels & Visual Novels):** Derived from over 5,000 light novels and visual novels (~60M words). Highly relevant for media consumption.
- **Netflix / Anime Subtitle Frequency (Jitendex / MarvNC):** Ranks terms based on spoken television and movie dialogues.
- **JPDB Frequency Database:** 1-to-N frequency ranking based on web fiction, anime subtitles, and novels.
- *Data Model Representation in Yomitan:* Encoded in `term_meta_bank_*.json` as `[term, "freq", { "value": integer_rank, "displayValue": "...", "frequency": ... }]`.

#### B. Pitch Accent Dictionaries (`term_meta_bank`)
- **NHK Japanese Pronunciation and Accent Dictionary (NHK日本語発音アクセント新辞典):** Standard Tokyo dialect broadcasting accent rules.
- **Shinmeikai Accent Dictionary (新明解日本語アクセント辞典):** Comprehensive accent patterns with secondary accent variations.
- **Kanjium Pitch Dataset:** Open-source pitch accent positions and downstep integers.
- *Data Model Representation in Yomitan:* Encoded in `term_meta_bank_*.json` as `[term, "pitch", { "reading": "...", "pitches": [{ "position": 0, "tags": [...] }] }]`.

#### C. Kanji Dictionaries (`kanji_bank` & `kanji_meta_bank`)
- **KANJIDIC2:** Radical breakdowns, stroke counts, ON/KUN readings, nanori (name readings), English meanings, grade level, and frequency ranks.
- **Kanjium Kanji Dataset:** Kanji composition trees, stroke order SVGs, and etymological components.

---

## 4. JLPT Metadata Research

### 4.1 The Reality of JLPT Classification
1. **No Official Lists Since 2010:** When the Japanese Language Proficiency Test transitioned to the 5-level system (N1–N5) in 2010, the Japan Foundation and Japan Educational Exchanges and Services (JEES) **explicitly ceased publishing official vocabulary or kanji lists**.
2. **Community Reverse-Engineering:** All modern "JLPT N1–N5" tags found in software (including JMdict `jlpt-n*` tags, Anki decks, and online dictionaries) are derived from pre-2010 Level 1–4 lists (mapped by Jonathan Waller, Tanos, or Peter van der Woude) supplemented by community test analysis.
3. **Inconsistencies & Collisions:**
   - A single word may be classified as N3 in one dictionary and N2 in another.
   - Polysemous words often belong to different JLPT levels depending on the sense (e.g. 立つ N5 for "to stand", but N2 for "to depart/leave" or "to shut").
   - Compound or derived words (e.g. 気にする, 申し訳ない) frequently lack explicit JLPT tags in standard dictionaries despite their constituent words being tagged.
4. **Presence in Yomitan Responses:**
   - In **Jitendex / JMdict**: JLPT tags appear as tag objects (e.g., `{"name": "N3"}` or `{"name": "jlpt-n3"}`) attached to either the definition header or specific sense groups.
   - In **Monolingual Dictionaries (Daijirin, Shinmeikai)**: JLPT data is **completely absent**.
   - In **Dedicated JLPT Meta-Dictionaries** (`stephenmk/yomitan-jlpt-vocab`): Injected as separate tag banks matching headwords.

### 4.2 Architectural Strategy for Kiroku Note
- **Locked Boundary Rule (from `AGENTS.md`):** *JLPT resolution comes from a local replaceable vocabulary-level dataset/service and returns N5, N4, N3, N2, N1, or Unknown. It is independent of Yomitan and never hardcoded in the frontend.*
- **Reconciliation Engine:**
  1. The backend inspects Yomitan dictionary tags for any explicit JLPT indicators.
  2. The backend queries Kiroku's authoritative internal `JLPTService` (backed by a bundled, indexed SQLite/JSON dataset).
  3. If Yomitan provides a tag that agrees or refines the level, it is noted; otherwise, the internal `JLPTService` determination is authoritative.
  4. The frontend receives a single, resolved `jlpt_level: "N5" | "N4" | "N3" | "N2" | "N1" | null` on the card draft and entry models.

---

## 5. Yomitan Capabilities & Integration Boundaries

### 5.1 Native Messaging Host & HTTP Bridge
Yomitan exposes an HTTP bridge (`yomitan-api` running on `http://127.0.0.1:19633`) that communicates with the Yomitan Chrome extension via Chrome Native Messaging (`chrome.runtime.sendNativeMessage` over `stdin`/`stdout`).

### 5.2 Endpoint Capabilities & Payloads

#### 1. `POST /tokenize`
- **Request:** `{"text": "日本語の文章", "scanLength": 16, "parser": "scanning-parser"}`
- **Response:** Array of segment objects. Each segment contains token objects with:
  - `text`: Surface form
  - `reading`: Token kana reading
  - `headwords`: Array of headword candidates `[{ "term": "...", "reading": "...", "sources": [{ "originalText": "...", "deinflectedText": "..." }] }]`

#### 2. `POST /termEntries`
- **Request:** `{"term": "映画"}` (or `{"term": "食べる", "definitionFilters": [], "maxDefinitions": 10}`)
- **Response:** Root object `{"dictionaryEntries": [...]}` containing:
  - `dictionary`: Name of the source dictionary (e.g. `"Jitendex"`, `"Daijirin"`, `"JMdict"`).
  - `dictionaryAlias`: Optional short alias configured in Yomitan settings.
  - `dictionaryOrder`: Integer sort index configured in Yomitan dictionary priorities.
  - `isPrimary`: Boolean flag indicating if this is the user's top-priority dictionary.
  - `headwords`: Array of `{ "term": "...", "reading": "...", "sources": [...], "tags": [...] }`.
  - `definitions`: Array of definition objects with `headwordIndices`, `tags`, and `entries` (which contain the structured-content AST or string arrays).
  - `frequencies`: Array of frequency records `[{ "dictionary": "BCCWJ", "frequency": 420, "displayValue": "420", "score": ... }]`.
  - `pitches`: Array of pitch records `[{ "dictionary": "NHK", "reading": "えいが", "position": 0, "tags": [...] }]`.
  - `score`: Yomitan's internal match relevance score.

### 5.3 What Happens When Dictionaries Lack Fields?

| Scenario | Yomitan Output | Desired Kiroku Normalization Behavior |
| :--- | :--- | :--- |
| **No Example Sentences** (e.g. standard JMdict) | `example-sentence` nodes absent in AST | `Sense.examples = []`; draft synthesis leaves `example_sentence` empty or falls back to captured subtitle. |
| **No Reading / Kana Only** (e.g. hiragana words) | `reading` is empty string or matches `term` | `term.reading` populated with expression or kana; no duplicate display. |
| **No Pitch Accent** | `pitches: []` | `Entry.pitches = []`; UI omits pitch badge gracefully. |
| **No Frequency Data** | `frequencies: []` | `Entry.frequencies = []`; UI omits frequency badge gracefully. |
| **Monolingual Definition** | AST contains plain Japanese text in glossary | Normalized as standard glosses; preserved without translation. |
| **Malformed / Unknown AST Tags** | Custom tags (e.g. `<canvas>`, `<svg>`, `custom-tag`) | Safe AST recursive traversal strips unknown wrappers while preserving text content. |

---

## 6. Provider-Agnostic Architecture Proposal

### 6.1 Architecture Evaluation

| Architecture | Description | Pros | Cons | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Option A: Pure Yomitan Passthrough** | Kiroku accepts Yomitan's exact raw JSON response and sends it straight to the Side Panel. | Zero backend transformation logic. | Frontend must implement full AST parser, handling edge cases in JS; breaks provider-neutrality; leaks Yomitan internals into UI; couples Anki field generation to raw AST. | **REJECTED** |
| **Option B: Independent Local Engine** | Kiroku bundles its own SQLite/Epwing dictionary parser and bypasses Yomitan entirely. | Complete control over dictionary indexing and formatting. | Massive engineering cost; duplicates Yomitan's deinflection and tokenizer engine; forces users to manage dictionary imports twice. | **REJECTED** |
| **Option C: Provider-Neutral Normalization Boundary (Recommended)** | `YomitanService` acts as the provider adapter. It consumes Yomitan payloads and translates them into an open, vendor-neutral **Kiroku Dictionary Schema**. | 1. Decouples UI and persistence from Yomitan AST quirks.<br>2. Allows future alternative providers (e.g. Jisho API, local MeCab/UniDic, EPWING daemon) without touching UI or CardService.<br>3. Normalizes multi-senses, POS, pitch, and frequency on the backend.<br>4. Keeps frontend purely as a declarative DOM renderer. | Requires robust recursive AST normalizer in Python. | **RECOMMENDED** |

### 6.2 Recommended Architecture & Layer Responsibilities

```
+─────────────────────────────────────────────────────────────────────────+
│                           BROWSER EXTENSION                             │
│                                                                         │
│  [ Side Panel UI: Declarative Renderer ]                                │
│   - Renders structured DictionaryEntry cards (Headword, Pitch, Senses)  │
│   - Renders sense-specific POS badges, tags, notes, and examples        │
│   - Provides single-click "Copy meaning to card draft" action           │
│   - Zero AST parsing or cross-dictionary string munging                 │
+────────────────────────────────────┬────────────────────────────────────+
                                     │ JSON API (CaptureResponse)
                                     ▼
+─────────────────────────────────────────────────────────────────────────+
│                         FASTAPI BACKEND                                 │
│                                                                         │
│  [ CardService: Orchestration & Synthesis ]                             │
│   - Orchestrates identify -> enrich -> JLPT resolution                  │
│   - Synthesizes clean multi-sense card draft meaning:                   │
│       "1. movie; film\n2. motion picture"                               │
│   - Synthesizes primary example sentence & translation                  │
│   - Checks SQLite duplicate identity                                    │
│                                                                         │
│  [ YomitanService: Provider Boundary & AST Normalizer ]                 │
│   - Queries POST /tokenize and POST /termEntries                        │
│   - Recursively normalizes complex AST nodes into domain dataclasses    │
│   - Attaches POS, tags, notes, and examples to individual Sense objects │
│   - Extracts pitch accent positions and frequency rankings              │
│                                                                         │
│  [ JLPTService: Authoritative Vocabulary Level Resolver ]               │
│   - Resolves N5/N4/N3/N2/N1/Unknown from local replaceable dataset      │
+────────────────────────────────────┬────────────────────────────────────+
                                     │ HTTP (127.0.0.1:19633)
                                     ▼
+─────────────────────────────────────────────────────────────────────────+
│                     YOMITAN LOCAL HTTP SERVER                           │
│  - Tokenizes Japanese text via configured dictionary indexes            │
│  - Returns raw dictionaryEntries AST payloads                           │
+─────────────────────────────────────────────────────────────────────────+
```

---

## 7. Proposed Data Models (Domain & API Schemas)

### 7.1 Python Domain Models (`backend/app/services/yomitan.py` / `domain.py`)

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

@dataclass(frozen=True)
class ExampleSentence:
    japanese: str
    reading: Optional[str] = None
    translation: Optional[str] = None
    source_dictionary: Optional[str] = None

@dataclass(frozen=True)
class PitchAccent:
    reading: str
    position: int
    pattern_name: Optional[str] = None  # e.g. "heiban" (0), "atamadaka" (1), "nakadaka", "odaka"
    nasal_positions: list[int] = field(default_factory=list)
    devoice_positions: list[int] = field(default_factory=list)
    dictionary: Optional[str] = None

@dataclass(frozen=True)
class FrequencyRank:
    dictionary: str
    frequency: int
    display_value: Optional[str] = None
    rank: Optional[int] = None
    is_common: bool = False

@dataclass(frozen=True)
class DictionarySense:
    index: int
    glosses: list[str] = field(default_factory=list)
    parts_of_speech: list[str] = field(default_factory=list)  # Bound directly to this sense!
    tags: list[str] = field(default_factory=list)            # e.g. "archaic", "slang", "uk"
    field_tags: list[str] = field(default_factory=list)      # e.g. "comp", "med", "math"
    notes: list[str] = field(default_factory=list)
    examples: list[ExampleSentence] = field(default_factory=list)

@dataclass(frozen=True)
class DictionaryEntry:
    dictionary: str
    dictionary_alias: Optional[str] = None
    is_primary: bool = False
    term: str = ""
    reading: str = ""
    alt_terms: list[str] = field(default_factory=list)
    alt_readings: list[str] = field(default_factory=list)
    parts_of_speech: list[str] = field(default_factory=list)  # Distinct union of all sense POS
    tags: list[str] = field(default_factory=list)            # Entry-level tags (e.g. "★", "common")
    senses: list[DictionarySense] = field(default_factory=list)
    pitches: list[PitchAccent] = field(default_factory=list)
    frequencies: list[FrequencyRank] = field(default_factory=list)
    score: int = 0

@dataclass(frozen=True)
class EnrichedTerm:
    expression: str
    reading: str
    source_text: str
    deinflected_text: str
    jlpt_level: Optional[str] = None  # Resolved N5..N1
    entries: list[DictionaryEntry] = field(default_factory=list)
    dictionary_error: Optional[str] = None
```

### 7.2 Pydantic API Schemas (`backend/app/schemas.py`)

```python
from typing import Optional
from pydantic import BaseModel, Field

class ExampleSentenceSchema(BaseModel):
    japanese: str
    reading: Optional[str] = None
    translation: Optional[str] = None
    source_dictionary: Optional[str] = None

class PitchAccentSchema(BaseModel):
    reading: str
    position: int
    pattern_name: Optional[str] = None
    nasal_positions: list[int] = []
    devoice_positions: list[int] = []
    dictionary: Optional[str] = None

class FrequencyRankSchema(BaseModel):
    dictionary: str
    frequency: int
    display_value: Optional[str] = None
    rank: Optional[int] = None
    is_common: bool = False

class DictionarySenseSchema(BaseModel):
    index: int
    glosses: list[str] = []
    parts_of_speech: list[str] = []
    tags: list[str] = []
    field_tags: list[str] = []
    notes: list[str] = []
    examples: list[ExampleSentenceSchema] = []

class DictionaryEntrySchema(BaseModel):
    dictionary: str
    dictionary_alias: Optional[str] = None
    is_primary: bool = False
    term: str
    reading: str = ""
    alt_terms: list[str] = []
    alt_readings: list[str] = []
    parts_of_speech: list[str] = []
    tags: list[str] = []
    senses: list[DictionarySenseSchema] = []
    pitches: list[PitchAccentSchema] = []
    frequencies: list[FrequencyRankSchema] = []
    score: int = 0

class CaptureResponse(BaseModel):
    id: Optional[int] = None
    expression: str
    reading: str = ""
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    jlpt_level: Optional[str] = None
    entries: list[DictionaryEntrySchema] = []
    dictionary_error: Optional[str] = None
    deck_name: str = "Default"
    model_name: str = ""
    status: str = "draft"
    sync_status: str = "pending"
    anki_note_id: Optional[int] = None
    is_duplicate: bool = False
    is_new: bool = False
    is_updated: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
```

### 7.3 Multi-Sense Draft Synthesis Strategy

To solve the V1 bug where `default_meaning` truncates polysemous words to only sense 1:
```python
def synthesize_default_meaning(entries: list[DictionaryEntry]) -> str:
    """
    Synthesize an intelligent, multi-sense default meaning for the card editor.
    Takes all senses from the primary dictionary (or top dictionary if none marked primary).
    Formats polysemous words cleanly as numbered lines:
      1. movie; film
      2. motion picture
    Single-sense words are formatted cleanly without line numbers:
      cat; feline
    """
    if not entries:
        return ""
    
    primary = next((e for e in entries if e.is_primary), entries[0])
    valid_senses = [s for s in primary.senses if s.glosses]
    
    if not valid_senses:
        return ""
    
    if len(valid_senses) == 1:
        return "; ".join(valid_senses[0].glosses)
    
    lines = []
    for s in valid_senses:
        gloss_str = "; ".join(s.glosses)
        lines.append(f"{s.index}. {gloss_str}")
    
    return "\n".join(lines)
```

---

## 8. Preserved Information Policy (What NOT to Discard)

The audit revealed that prior iterations aggressively flattened or stripped data because the early UI didn't have space for it. Stage 3 establishes a strict **Non-Discard Policy**:

1. **Part-of-Speech Association:** POS tags must never be stripped of their sense binding. Each `DictionarySense` retains its specific `parts_of_speech` array.
2. **All Senses Retained:** Normalization must never truncate senses. All senses provided by every installed dictionary are preserved in `DictionaryEntry.senses`.
3. **Pitch Accent Numbers & Mora Arrays:** Pitch integers, nasal positions, and devoiced mora positions must be parsed from `pitches` and stored in `PitchAccent`.
4. **Frequency Statistics:** Raw rank integers, normalized score percentiles, and display strings must be parsed from `frequencies` and stored in `FrequencyRank`.
5. **Furigana / Ruby Annotations:** When extracting example sentences from structured content, the parser must preserve ruby pairs: `[{"kanji": "映画", "furigana": "えいが"}]` or standard bracketed furigana `映画[えいが]` rather than permanently deleting `<rt>` content.
6. **Linguistic Usage Tags:** Archaic (`arch`), slang (`sl`), vulgar (`vulg`), usually kana (`uk`), idiom (`id`), transitive (`vt`), intransitive (`vi`), honorific (`hon`), humble (`hum`), and domain-specific tags (`comp`, `med`) must be retained in `DictionarySense.tags` and `DictionarySense.field_tags`.
7. **Dictionary Attribution:** The source dictionary name (`dictionary`) and user alias (`dictionaryAlias`) must be preserved on every entry and example to give clear provenance in the UI.

---

## 9. Migration Plan (Stage 3A → Stage 3B)

### 9.1 Zero-Downtime Migration Strategy

```
Phase 1: Backend AST Engine & Models (yomitan.py)
  - Implement full recursive AST parser handling structured content, sense groups, pitch, frequency.
  - Implement unit test suite verifying parser across all dictionary fixtures.

Phase 2: Schemas & CardService Draft Synthesis (schemas.py, card_service.py)
  - Update Pydantic schemas with backward-compatible defaults.
  - Integrate synthesize_default_meaning and synthesize_default_example.
  - Verify SQLite persistence safely serializes new entry schema into JSON column.

Phase 3: Side Panel Study View Modernization (sidepanel.js, sidepanel.html, sidepanel.css)
  - Replace fragile string-munging in sidepanel.js with clean declarative rendering.
  - Display sense-bound POS badges, pitch accent indicators, frequency pills, and full multi-sense layout.
  - Update extension mock tests.

Phase 4: Anki Note Mapping & Full Regression
  - Verify Anki note generation cleanly formats multi-senses with semantic HTML.
  - Run full backend (135+ tests) and extension (26+ test files) suites.
```

### 9.2 Backward-Compatibility Guarantees
- **SQLite Database:** The `entries` column in SQLite is stored as a JSON string. Existing cards created under Stage 1/2 will continue to load safely because all new Pydantic fields have default values (`list = []`, `Optional = None`).
- **Media Storage & Prefixes:** Unaffected.
- **Card Editor Form Contracts:** Input element names (`expression`, `reading`, `meaning`, `deck_name`, `tags`, etc.) remain 100% identical.

---

## 10. Comprehensive Test Plan

The Stage 3B implementation must satisfy an exhaustive test matrix covering all linguistic edge cases and malformed inputs.

### 10.1 Backend Test Matrix (`backend/tests/`)

| Test File | Test Case Description | Input Scenario | Expected Verification |
| :--- | :--- | :--- | :--- |
| `test_dictionary_ast.py` | Single Bilingual Dictionary (Jitendex) | Nested AST with `sense-group`, `part-of-speech-info`, `glossary`, `example-sentence` | Correctly parses term, reading, POS per sense, multi-senses, and ruby example sentences. |
| `test_dictionary_ast.py` | Monolingual Kokugo (Daijirin / Shinmeikai) | Complex Japanese definitions with historical kana and embedded pitch numbers (`⓪`, `①`) | Extracts clean Japanese definitions, parses pitch integers, preserves sense hierarchy. |
| `test_dictionary_ast.py` | Multiple Dictionaries with Ordering | Payload containing Jitendex (primary), JMdict (secondary), and NHK Accent | Preserves `is_primary` order, associates pitch records to NHK entry, maintains distinct sense lists. |
| `test_dictionary_ast.py` | Pitch Accent Extraction | Payload with `pitches` array containing position 0, nasal, and devoice arrays | Populates `PitchAccent` objects with accurate pattern classifications (`heiban`, `atamadaka`). |
| `test_dictionary_ast.py` | Frequency Ranking Extraction | Payload with `frequencies` array from BCCWJ (rank 450) and Innocent (rank 312) | Populates `FrequencyRank` objects with integer ranks and frequency values. |
| `test_dictionary_ast.py` | Polysemy & Multi-Sense Synthesis | Term with 4 distinct senses (e.g. 掛ける) | `CardService.capture_term` produces numbered multi-line `meaning`: `1. to hang\n2. to wear (glasses)\n3. to sit\n4. to multiply`. |
| `test_dictionary_ast.py` | Single-Sense Word Synthesis | Term with 1 sense (e.g. 猫) | `meaning` formatted cleanly without line numbers: `cat; feline`. |
| `test_dictionary_ast.py` | Missing Fields & Degradation | Entry with missing POS, missing examples, missing pitch, missing frequency | Normalizes gracefully with empty arrays; zero exceptions raised. |
| `test_dictionary_ast.py` | Malformed & Hostile AST | Arbitrary tags (`<script>`, `<canvas>`, deeply recursive unclosed structures) | Recursive parser clamps depth, escapes text, strips hostile nodes without crashing. |
| `test_dictionary_ast.py` | Backward Compatibility | Deserializing legacy Stage 1/2 card records from SQLite | Pydantic schema validation succeeds with default fields populated. |

### 10.2 Extension Test Matrix (`extension/tests/`)

| Test File | Test Case Description | Expected Verification |
| :--- | :--- | :--- |
| `dictionary-study-view.test.js` | Multi-Sense Rendering | Verifies numbered `<ol>` list with individual gloss spans, sense-level POS badges, and note callouts. |
| `dictionary-study-view.test.js` | Pitch Accent Display | Verifies pitch accent pill (e.g. `[0] 平板` / `[1] 頭高`) renders alongside headword reading. |
| `dictionary-study-view.test.js` | Frequency Badge Display | Verifies frequency rank pill (e.g. `★ 450` / `Top 500`) renders with appropriate style. |
| `dictionary-study-view.test.js` | Collapsible Examples Accordion | Verifies Japanese example and translation pair render inside `<details>` element with accurate count badge. |
| `dictionary-study-view.test.js` | Raw View & Clipboard Copy | Verifies unabridged full-text serialization and clipboard copy trigger. |

---

## 11. Architectural Risks, Open Questions & Mitigations

### 11.1 Identified Risks & Mitigations

| Risk | Impact | Root Cause | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Yomitan Schema Drift** | High | Upstream Yomitan updates could modify native messaging payload structure. | Strict fail-soft normalization in Python: every dictionary field lookup uses safe `.get()` with type-checks and fallbacks. Unrecognized nodes log a debug warning and fall back to plain text extraction. |
| **XSS / HTML Injection in Side Panel** | Critical | Malicious or unescaped HTML inside third-party dictionary definitions. | The Side Panel must never use `innerHTML` on dictionary text. All DOM node creation must use `document.createElement`, `textContent`, and safe `replaceChildren`. |
| **Parser Performance Bottleneck** | Medium | Deeply nested structured content across 5+ installed dictionaries slowing down capture response. | Optimized iterative/recursive Python visitor pattern with recursion depth clamping (max depth 32); avoids regex backtracking. Target response time < 50ms. |
| **Card Editor Overcrowding** | Medium | Multi-sense definitions making the card editor textarea overly large. | Synthesize concise top glosses per sense (up to 3 glosses per sense); allow user to easily toggle/trim in editor. |

### 11.2 Open Questions Resolved
1. **Should dictionary selection happen in Yomitan, Kiroku, or both?**
   - *Resolution:* **Yomitan owns dictionary installation, indexing, and enabled status.** Kiroku acts as the client and respects Yomitan's prioritization (`is_primary`), but Kiroku's backend normalizes all returned data so the user can see all active dictionaries in the Side Panel.
2. **Should Kiroku filter out duplicate definitions across dictionaries?**
   - *Resolution:* The backend retains the full data from all dictionaries for the "Full Dictionary / Raw View" and identifies the `is_primary` dictionary for the clean "Study View" and card draft, eliminating messy client-side regex deduplication.
3. **How should pitch accent be visually represented in V1?**
   - *Resolution:* Display both the integer position (e.g. `[0]`, `[1]`) and standard Japanese pattern classification badge (e.g. `平板`, `頭高`, `中高`, `尾高`) next to the reading hero element.

---

## 12. Recommended Stage 3B Implementation Sequence

The implementation of Stage 3B should follow this ordered, bite-sized sequence:

- [ ] **Task 1: AST Normalizer & Domain Dataclasses (`backend/app/services/yomitan.py`)**
  - Implement `DictionarySense`, `PitchAccent`, `FrequencyRank`, `ExampleSentence`, and `DictionaryEntry` dataclasses.
  - Rewrite `normalize_term_entries_response` with a robust recursive AST visitor extracting sense-bound POS, linguistic tags, pitch accents, and frequencies.
- [ ] **Task 2: Multi-Sense Draft Synthesis & Schemas (`backend/app/schemas.py`, `backend/app/services/card_service.py`)**
  - Update Pydantic API response models.
  - Implement `synthesize_default_meaning` and `synthesize_default_example` in `CardService`.
  - Ensure zero regressions in `save_card` and `sync_card`.
- [ ] **Task 3: Backend Unit Test Suite (`backend/tests/test_dictionary.py`, `backend/tests/test_yomitan.py`)**
  - Add comprehensive unit tests verifying multi-sense parsing, POS preservation, pitch/frequency extraction, and malformed payload resilience.
- [ ] **Task 4: Side Panel Declarative Rendering Engine (`extension/sidepanel/sidepanel.js`)**
  - Refactor `renderDetails` in `sidepanel.js` to render the structured API model without client-side string deduplication.
  - Add pitch accent and frequency badge renderers.
- [ ] **Task 5: Side Panel Styling & DOM Polish (`extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.css`)**
  - Style sense-bound POS badges, pitch badges, frequency indicators, and multi-sense numbering adhering to dark utility theme.
- [ ] **Task 6: Extension Test Suite Updates (`extension/tests/dictionary-study-view.test.js`)**
  - Update and expand Node.js DOM mock tests to verify multi-sense rendering and new metadata elements.
- [ ] **Task 7: End-to-End Regression & Progress Handoff**
  - Execute full backend test suite (`python -m pytest`).
  - Execute full extension test suite (`node --test extension/tests/*.test.js`).
  - Update `PROGRESS.md` to reflect Stage 3 completion.

---
*End of Stage 3A Research & Design Report. Ready for Stage 3B implementation upon review.*
