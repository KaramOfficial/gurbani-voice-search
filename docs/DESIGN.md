# Search by Voice — Pankti Search across Gurbani — Design (v1 foundation)

Status: **Gemini pass DONE 2026-11-22 — verdict in §1.4.** The "design critique"
section below holds the exact questions put to Gemini and the reasoned v1
decisions taken before the pass; §1.4 records what Gemini actually said and
which decisions it amended or reversed.

Date: 2026-11-22 · Workspace: `~/workspace/gurbani-voice-search/`
Companion code: `src/build_index.py`, `src/matcher.js`, `src/test_matcher.js`

Hard constraints carried in from the existing projects (non-negotiable):

- **Text source:** the pankti text is the Gursevak / Read Gurbani vishraam text
  exactly as stored in the CTC-aligned Ang JSONs
  (`~/workspace/gurbani-timestamper/app_data/ang*.json`). Never substitute plain
  SGGS text.
- **Corpus:** all 1,430 Angs, 60,610 panktis, 418,680 words (verified by
  `build_index.py` run, §3).
- **Matching primitives are reused, not reinvented:** `foldWord()` and `sim()`
  are ported verbatim from Cracker `~/workspace/cracker-prototype/aligner-v2.js`
  (nukta fold, addak dropped, vishraam/punctuation stripped, ਞ/ਙ → ਨ, digits
  dropped; normalized Levenshtein similarity). The Python builder implements
  the identical fold so index and query sides always agree.
- **Bani names**, where they appear in any future UI, use the source-exact
  names (ਜਪੁਜੀ ਸਾਹਿਬ, ਜਾਪੁ ਸਾਹਿਬ, ਤ੍ਵਪ੍ਰਸਾਦਿ ਸ੍ਵਯੇ — no "Sahib", ਚੌਪਈ ਸਾਹਿਬ,
  ਅਨੰਦੁ ਸਾਹਿਬ, ਰਹਰਾਸਿ ਸਾਹਿਬ, ਕੀਰਤਨ ਸੋਹਿਲਾ — no "Sahib", ਸੁਖਮਨੀ ਸਾਹਿਬ).
  v1 search is over SGGS Angs only, so this barely surfaces yet.

---

## 1. Design critique — questions for Gemini / Google AI Mode

### 1.1 The questions (to be asked verbatim in the real pass)

1. Recognizer: for a browser-first v1, is Web Speech API (`pa-IN`) the right
   first engine, with offline ONNX (the Cracker fp32 wav2vec2/indic-conformer
   route) deferred? What breaks first in the wild with `pa-IN` Web Speech —
   Gurmukhi script output vs. romanized output, word segmentation, Chrome-only
   support, iOS Safari behaviour?
2. Index: ~60k short lines. Is a client-side inverted index + re-rank fast and
   small enough on a mid-range phone, or should search be a tiny server/Worker?
   What shard granularity keeps first-search latency acceptable?
3. Fuzzy scoring: is IDF-weighted candidate generation followed by a local
   sequence-alignment re-rank (Levenshtein word similarity, gap/merge/split
   moves) the right shape for "recited imperfectly, from memory, mid-line"?
   What failure modes dominate: refrain twins (same line repeated across
   Angs), very common words (ਨਾਨਕ, ਹਰਿ, ਸਤਿਨਾਮੁ…), 2–3 word queries?
4. Result presentation: when the true pankti is repeated verbatim on many
   Angs, is grouping duplicates with all Ang numbers the right answer, or
   rank-by-context? How many results before the user is lost — 5, 10?
5. Confidence UX: should a low-confidence search ask the user to recite
   *more* of the line rather than show weak results? What threshold?
6. Romanized input: many recognizers return Punjabi in Latin script for some
   users. Is a transliteration fallback (Latin → folded Gurmukhi phonetic
   form) a v1 requirement or a v2 item?

### 1.2 Decisions taken for v1 (pending Gemini review)

**D1 — Recognizer: Web Speech API `pa-IN`, online, first. Offline ONNX later.**
Rationale: Cracker's hard lesson is that the offline route is heavy — ORT
1.19.2 lacks ConvInteger so int8 cannot run, and the fp32 APK bundles at
~510 MB. That is an app-store problem, not a web-v1 problem. Web Speech with
`lang="pa-IN"` is zero-install, zero-model-download, and Cracker's Online
(Google Punjabi) engine already proved users accept it. v1 therefore treats
recognition as a replaceable front end: the matcher consumes *text* (a heard
transcript), so swapping in an offline engine later changes nothing in the
index or matcher. Known accepted risks for v1: Chrome/Android-first (Safari
support is partial), requires network, transcript script/segmentation varies —
which is exactly why the matcher (§2) is fuzzy at the character level and
tolerant of split/merged words. Text typing/paste is kept as a first-class
input alongside voice, so the product is testable and usable where speech
fails.

**D2 — Index: client-side, sharded, no server for v1.**
The full index built by `src/build_index.py` measures **18.04 MB raw JSON,
4.38 MB gzipped in total** (vocab file 1.21 MB gz; 15 shards of 100 Angs at
~0.22 MB gz each — §3). A phone can
hold this; a server round-trip per keystroke/recitation is not needed.
Sharding by Ang range lets the future UI lazy-load, and lets a later version
ship the vocab + only popular shards first. If measured phone latency is bad,
the same index format can be moved behind a Cloudflare Worker unchanged —
the format is the contract, not the transport.

**D3 — Scoring: IDF candidate generation → local-alignment re-rank.**
Formula in §2. Key choices: common words are deliberately *weak* evidence
(IDF), rare words are anchors (the same "rare word ≤3 occurrences is a safe
global anchor" lesson Cracker's tracker learned from refrain twins);
re-ranking is a *local* alignment so a mid-line fragment scores as well as a
full line; merge (ladiwar) and split moves are explicit DP transitions, not
post-hoc hacks, because recognizers merge/split Gurmukhi words constantly.

**D4 — Duplicates are grouped, all Angs shown.**
Identical panktis recur across SGGS (refrains, repeated saloks). Returning
the same text 8 times as 8 "different" results is noise; v1's matcher
de-duplicates identical folded lines in its top-10 and the UI (§4) shows one
card with every Ang it occurs on. (Matcher v1 returns the best-scoring
occurrence; grouping is a UI-layer aggregation over the full hit list —
flagged as remaining work.)

**D5 — Short queries stay honest.**
Queries under 3 folded words return results but flagged low-confidence in
the UI; the design asks for "say a few more words" rather than pretending
precision. The matcher itself imposes no hard minimum — evaluation (§3 of
matcher tests) shows where accuracy actually falls off.

**D6 — Romanized transcripts: NOT v1.**
If `pa-IN` returns Latin-script Punjabi, v1 will score poorly; that is an
accepted, documented gap. A phonetic Latin→Gurmukhi fold is a v2 candidate
pending Gemini's answer to Q6 and real transcripts from Karam's phone.

### 1.3 What would change these decisions

- Real `pa-IN` transcripts from device testing (script, segmentation, error
  shape) — could promote D6 to v1, or change fold rules.
- Gemini pass answers, once actually obtained.
- Phone timing of full re-rank on the real index (Node timings in the test
  harness are a proxy only).

### 1.4 Gemini verdict

**REAL PASS DONE 2026-11-22** — Gemini (Google AI Pro, signed in as Karam),
chat "Gurbani Voice Search Design Critique",
https://gemini.google.com/app/35261087f9c56765 — context message + all six
§1.1 questions put verbatim; answers received for both messages.

Overall: architecture approved — thin cloud ASR feeding a local client-side
candidate-generation + sequence-alignment search is the right shape. BUT the
v1 normalizer/index must be fixed before shipping: modern pa-IN ASR vs
classical Gurbani orthography "can quietly tank recall".

Per question (summary, not transcript):
- **Q1 Recognizer:** Web Speech pa-IN = yes for v1; deferring the ~510 MB
  ONNX bundle = right. Breaks first: (1) iOS Safari / non-Chromium — Apple's
  backend does not reliably support pa-IN; falls back to device locale and
  mangles output. Mitigate: feature-detect, catch errors / Latin output,
  typed fallback (or a future MediaRecorder→cloud STT relay). (2) pa-IN
  systematically drops silent final ਿ/ੁ, splits compounds, merges particles,
  modernizes ਯ→ਜ / ਵ→ਬ. (3) Chrome/Android reliably returns Gurmukhi.
  (4) Chrome cuts sessions on pauses — buffer isFinal segments properly.
  v2 offline idea: int8 Conformer/CTC or distilled Whisper-small fine-tuned
  on Gurbani audio, ~45–75 MB.
- **Q2 Index:** Client-side yes, no server. Ang-sharding criticised — a
  from-memory query has no Ang filter, so sharding saves no bandwidth (this
  matches the UI QA finding: first search touched all 15 shards). Recommends
  2 role-split assets (search index ~1.2–1.5 MB gz prefetched; display
  corpus ~2.5–2.9 MB gz background) cached in IndexedDB, and search running
  in a Web Worker.
- **Q3 Scoring:** Shape approved, one critical upgrade: add character
  3-gram candidate generation (over consonant-heavy skeletons) so split /
  merged forms (ਸਤਿ ਗੁਰ ↔ ਸਤਿਗੁਰੁ) still surface — whole-word postings alone
  can miss the true pankti entirely. Stage 2: Smith-Waterman with a phonetic
  cost matrix (matra swaps / final ਿ/ੁ / aspirate pairs = low cost 0.2;
  gap-open 0.6, gap-extend 0.15). Failure modes: refrain twins (tie-break
  with unfolded-text similarity micro-bonus), all-common-word queries (cap
  K=300 pre-sorted by token count + bigram proximity), 2–3 word queries
  (contiguous phrase-order bonus +0.05, don't auto-commit voice on them).
- **Q4 Presentation:** Group duplicates — but keyed on EXACT UNFOLDED
  Gurmukhi, not the folded key (folded grouping collapses distinct lines
  differing only in ਿ/ੁ or nasalization). First Ang prominent + expandable
  chip for the rest. Show 5, "Show 5 more" toggle (compute 10).
- **Q5 Confidence:** Prompt for more on low confidence, never a dead end —
  show best-effort guesses below the prompt. Thresholds on normalized score
  with a length gate (≥8 folded chars): ≥0.78 high (show 5, highlight matched
  substring), 0.55–0.77 medium (show 5 + "recite the next few words"),
  <0.55 or <8 chars low (prompt + guesses).
- **Q6 Romanized input:** DISAGREES with D6 — a lightweight deterministic
  Latin→folded-Gurmukhi transliterator (~150 lines) is a v1 requirement:
  diaspora users lack Gurmukhi keyboards (typed fallback is otherwise
  unusable) and it is the safety net when ASR leaks Latin tokens. Mapping
  directly into folded space avoids spelling-guessing.
- **Unprompted:** add a "recitation fold" on top of the Cracker fold —
  strip word-final ਿ/ੁ, normalize ਂ/ੰ to one nasal marker, ਯ→ਜ, ਵ→ਬ, strip
  pairi haha (੍ਹ); keep original text for display + tie-breaking. pa-IN
  mangles subscript conjuncts (ਪ੍ਰਭ→ਪਰਭ etc.) — systematic penalties if the
  normalizer is not extended. Re-rank on each interim speech event.

**Effect on v1 decisions:** D1, D3 (shape), D4, D5 stand with amendments.
D2 amended (role-split assets + Worker — scheduled; sharding kept only as
an interim). D6 REVERSED: transliterator is v1. Recitation fold + trigram
candidates are pre-ship fixes, not v2.

---

### 1.5 Gemini follow-up verdict — resilience (REAL PASS, 2026-11-25)

Same Gemini conversation as §1.4. Seven messages: the owner's two field
failures (next-line bleed "fareeda" case; rotation case), kirtan chunk
permutation, Punjabi grammar-aware reordering, chunk-boundary integrity,
vishraam portability, and a simplicity check. Gemini's early answers
proposed heavier machinery (asymmetric-gap Smith–Waterman rewrite,
chunk segmentation with a five-signal boundary scorer, two-line window
matching). Its FINAL answer superseded them: ship the simple rescoring
— IDF-weighted word-set overlap (query-normalised) as the primary
score, sequential alignment demoted to a blend/tie-break, α gated by
query IDF mass, 1-to-1 multiset matching, particle downweighting, sim
clamp 0.65, 1-step merge rescue — and treat chunking as optional
Phase 2. "You do not need a chunking or segmentation pipeline."
Warnings that shaped the shipped version: the min(W_Q, W_P)
short-pankti trap, recalibrate confidence bands to the shipped score
(a found match must not land on a "recite more" dead end), rotation
can starve candidate generation (verify pool inclusion in tests —
ours held). Owner constraints recorded with it: no vishraam
dependence (Dasam Baani portability), fix in both deployed places via
the one-source sync rule. **Shipped as specified — full record in
docs/RESILIENCE-FIX.md.**

## 2. Matcher design

Pipeline: `heard text → fold → candidate generation → re-rank → top 10`.

### 2.1 Folding (shared, verbatim from Cracker)

`foldWord(w)`: NFC-normalize; fold nukta letters (ਖ਼→ਖ, ਗ਼→ਗ, ਜ਼→ਜ, ਫ਼→ਫ,
ਸ਼→ਸ, ਲ਼→ਲ); drop addak (ੱ); drop whitespace and vishraam/punctuation
(`; . , । ॥ « » ' " - :`); drop digits (Latin + Gurmukhi — unspoken ang/line
markers); map ਞ→ਨ and ਙ→ਨ (recognizers and the CTC vocab both confuse these
nasals). Applied identically to index words (Python builder) and to heard
words (JS matcher) — one definition, two ports, cross-checked by the test
harness using index-folded words as query source.

### 2.2 Index

Per pankti (global sequential `id` across Angs 1→1430):

| field | meaning |
|---|---|
| `id` | global pankti id |
| `a` | Ang (1–1430) |
| `l` | line index within the Ang (0-based, order in source JSON) |
| `t` | original text, vishraam marks intact (display text) |
| `f` | folded words, in order (matching text) |
| `s`, `e` | line start/end seconds in the Sehaj Paath audio (from CTC alignment; enables future "play this line" / Reader audio deep-link) |

Global vocab file: for every distinct folded word —
`idf = ln(1 + N / df)` (N = 60,610 panktis, df = panktis containing the word),
and `postings` = sorted list of pankti ids containing it.

### 2.3 Candidate generation (recall stage)

For each heard folded word `h`:

1. **Exact:** postings of `h`, weight `idf(h)`.
2. **Fuzzy rescue:** if exact postings are few (< 40) or absent, scan vocab
   for words `v` with `sim(h, v) ≥ 0.75` and length within ±3 — add their
   postings at weight `idf(v) · sim(h, v)`. (Bounded scan; common words skip
   the rescue because their exact postings already flood the candidate set.)

Candidate score = sum over distinct heard words of best weight contributed.
Keep the top **200** candidates for re-ranking. This stage is deliberately
recall-heavy: a pankti sharing only one rare, slightly-garbled word with the
query must survive to re-rank.

### 2.4 Re-rank (precision stage) — local sequence alignment

For each candidate, a Smith-Waterman-style local alignment between the heard
folded sequence `H` and the candidate's folded words `T`, finding the best
contiguous window of `T` (partial-line matching: the user may start mid-line
and stop early, so leading/trailing target words are free). DP moves:

| move | consumes | gain |
|---|---|---|
| match / substitute | 1 heard, 1 target | `sim(h, t)` |
| merge (ladiwar) | 1 heard, 2 target | `sim(h, t₁+t₂)` |
| split | 2 heard, 1 target | `sim(h₁+h₂, t)` |
| gap in target (word dropped by reciter/recognizer) | 0 heard, 1 target | −0.35 |
| gap in heard (extra word inserted) | 1 heard, 0 target | −0.35 |

Final score = `0.9 · (best alignment gain / |H|)` + `0.1 · IDF coverage`
(IDF-weighted fraction of heard words with an exact/fuzzy hit in this
candidate). Scores are in ~[0, 1]; results sorted desc, ties broken by
higher IDF coverage then lower Ang. Top 10 returned as
`{ang, line, text, score}` (plus `id`, `start`, `end` for the UI/audio).

Why not Cracker's beam tracker? The tracker solves a different problem —
following a *known* text in real time. Search has no known position and no
stream; a batch local alignment over 200 candidates is simpler, stateless,
and directly optimizes the search metric (right pankti in top 5).

### 2.5 Known weaknesses (by design, to measure)

- Refrain twins: genuinely identical lines on different Angs are
  indistinguishable from text alone — grouped per D4, not "solved".
- 1–2 word queries: many plausible lines; scores compress.
- A query whose every word is garbled beyond sim 0.75 of any vocab word
  generates no candidates. Mitigation candidate for v2: character n-gram
  fallback index.

---

## 3. Index build — measured (from `build_index.py` run, updated 2026-11-22 after the Gemini fixes)

Format: `data/vocab.json` (idf + postings, keyed on **recite-folded** words)
+ `data/trigrams.json` (char-3-gram postings, df ≤ 400) +
`data/shard-XXXX-YYYY.json` per 100-Ang range (rows carry both `f` base-folded
and `r` recite-folded word arrays) + `data/manifest.json` (authoritative
numbers).

| item | value |
|---|---|
| Angs | 1,430 |
| Panktis indexed | 60,610 |
| Folded words total | 396,404 (of 418,680 source words; the rest fold to empty — digit/punctuation-only tokens) |
| Distinct folded vocab | 29,714 base-fold → **25,643 recite-fold** |
| vocab.json | 2.98 MB raw / 1.17 MB gz |
| trigrams.json | 5.28 MB raw / 2.30 MB gz (34,152 of 34,666 trigrams kept, 823,868 postings) |
| 15 shards | ~1.4 MB raw / ~0.27 MB gz each (last shard, Angs 1401–1430: 0.42 / 0.08 MB) |
| **Total** | **28.92 MB raw / 7.34 MB gz** (was 18.04 / 4.38 before the Gemini fixes — growth is the trigram index + the second folded form per pankti; see docs/GEMINI-FIXES.md) |

Matcher evaluation (Node, synthetic noise — a proxy, not real transcripts):

- `src/test_matcher.js`: 24 panktis × 7 variants (clean, garble×1, garble×2,
  drop-a-word, mid-line start, merged words, combined) = 168 queries →
  **top-1 100%, top-5 100%**, ~269 ms/query (was ~31 ms before the Gemini
  fixes — phonetic DP + trigram candidates + affine gaps are heavier;
  acceptable for a one-shot search, revisit in the Worker pass).
- `src/test_stress.js` (harder): 30 panktis × 5 variants (3-word fragment,
  4-word fragment + char-drop garble, whole-word substitution, substitution +
  garble + drop combined, 5-word fragment + substitution) = 150 queries →
  **top-1 99.3%, top-5 100%** counting a same-text refrain on another Ang as
  correct. The single top-1 miss was a 3-word fragment. (No regression from
  the Gemini fixes: identical rates to the pre-fix run.)
- `src/test_gemini.js` (new): fold cross-check JS vs Python index (1,002
  words over Angs 1/2/555/1430, 0 mismatches); ASR-shaped suites — final-ਿ/ੁ
  dropped, ਯ/ਵ modernized, split word, merged pair — 20/20 top-1 and top-5
  each; the 3 required romanized queries all land (Ang 1 / Ang 1 / Ang 681
  top-1). 21 checks, 0 failed.

Caveat that must survive into every future report: synthetic garbling is
*easier* than real `pa-IN` recognizer output (which can romanize, resegment,
or substitute systematically). These numbers prove the pipeline shape, not
field accuracy. Field accuracy waits for device transcripts (§5.5).

---

## 4. UI sketch — phone-first, 390 × 844 (for the Cook jury loop, not built here)

```
┌─────────────────────────────┐  390px
│  Pankti Search              │  header, small
│  "Recite a line — find it"  │
├─────────────────────────────┤
│                             │
│        ╭──────────╮         │
│        │   🎙 big  │         │  one primary action; mic button ≥96px,
│        ╰──────────╯         │  thumb-reachable lower-middle
│   Tap and recite a pankti   │
│                             │
│  ── or type / paste ──      │  text field (test + fallback input)
│  [ ਸਤਿਨਾਮੁ ਵਾਹਿਗੁਰੂ…    ] [Go]│
├─────────────────────────────┤
│  Heard: "…" (editable)      │  transcript shown, tappable to fix
│                             │
│  Results                    │
│  ┌───────────────────────┐  │
│  │ ਸਤਿਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ…     │  │  pankti, Gurmukhi, large, vishraam
│  │ Ang 1 · tap to open → │  │  hidden in display like Reader
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ …next candidate…      │  │  score shown only as subtle
│  │ Ang …                 │  │  confidence (●●●○), never raw %
│  └───────────────────────┘  │
│        … up to 10 …         │
├─────────────────────────────┤
│  Low confidence state:      │  "I heard only a little — recite a
│  few more words and retry"  │  few more words" + big retry mic
└─────────────────────────────┘
```

Rules carried from Reader/Cracker: Gurmukhi first (Noto Sans/Serif Gurmukhi),
vishraam symbols hidden in display, words coloured as in Reader; one idea per
screen; listening state = pulsing mic + live transcript; no settings in v1.

**Reader deep-link (investigated 2026-11-22):** the live Reader
(https://karamofficial.github.io/gurbani-reader/) is a single-page infinite
stream; its code addresses Angs internally (`state.ang`, `<section
data-ang="N">`, `loadAng(n)`, `scrollToAng`) and persists position via
localStorage. Inspection of the served page found **no `URLSearchParams`,
`location.hash`, or query-param routing** — so `?ang=N` is an **assumption,
not a supported Reader feature today**. v1 result cards link to
`https://karamofficial.github.io/gurbani-reader/?ang=N` and this is
documented as best-effort: until the Reader grows a param reader (a ~5-line
addition: on load, if `?ang=` present, `loadAng` it), the link opens the
Reader at its remembered position and the card must also state the Ang
prominently so the user can jump manually. Do not claim deep-linking works
until that Reader change ships and is verified.

---

## 5. Remaining after this foundation

1. ~~Real Gemini design pass on §1.1; fold verdict into §1.4.~~ DONE
   2026-11-22 (§1.4); its pre-ship fixes are implemented — see
   docs/GEMINI-FIXES.md. Still scheduled from that verdict: role-split
   assets (search/display) + Web Worker migration (Q2), and interim-result
   re-ranking on each speech event (Q1 note).
2. Voice UI per §4 + Cook jury loop + 390×844 QA (separate task).
3. Reader `?ang=` support (tiny Reader change) + verification.
4. Duplicate grouping (D4) at UI layer.
5. Device testing with real `pa-IN` transcripts; tune sim threshold, gap
   penalties, candidate cap from real errors, not synthetic ones.
6. Repo creation + GitHub Pages deploy (explicitly out of scope here).
