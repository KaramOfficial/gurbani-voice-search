# Gemini pre-ship fixes — changelog

Applied 2026-11-22, implementing the real Gemini verdict in DESIGN.md §1.4
(chat "Gurbani Voice Search Design Critique"). No deploy, no GitHub push.
Role-split assets + Web Worker migration (Q2) deliberately NOT in this pass.

## 1. Recitation fold — `reciteFold()` / `recite_fold()`

New fold layer on top of the verbatim Cracker base fold, implemented
identically in `src/matcher.js` and `src/build_index.py`:
strip word-final ਿ (U+0A3F) / ੁ (U+0A41); ਯ (U+0A2F)→ਜ (U+0A1C);
ਵ (U+0A35)→ਬ (U+0A2C); ਟਿੱਪੀ (U+0A70)→ਬਿੰਦੀ (U+0A02) as the single nasal
marker; pairi haha (U+0A4D U+0A39) stripped.
Index rebuilt: shards now carry both `f` (base-folded, kept for the
unfolded-similarity micro-bonus and existing tests) and `r` (recite-folded,
the matching form); vocab is keyed on recite-folded words.
Cross-checked: `test_gemini.js` §A compares JS folds against the Python-built
index over Angs 1/2/555/1430 — 1,002 words, 0 mismatched rows.
Effect: recite vocab 29,714 → 25,643 distinct words.

## 2. Trigram candidate generation

Builder emits `data/trigrams.json`: character 3-grams over each pankti's
joined recite-folded string → pankti-id postings, capped at df ≤ 400
(34,152 of 34,666 trigrams kept; the dropped ones occur in >400 panktis and
carry no discrimination). Matcher unions trigram-overlap candidates with
word-posting + fuzzy-rescue candidates; pool capped at **300**, pre-sorted
by (matched token count, bigram proximity, trigram overlap, IDF score).
Verified rescue: ਸਤਿਗੁਰੁ split as "ਸਤਿ ਗੁਰੁ" (and a generic longest-word
split suite, 20 samples) → top-1 20/20.

## 3. Phonetic costs + affine gaps in re-rank

`simPhon()`: Levenshtein where substitution inside a phonetic group costs
0.2 instead of 1.0 — matra pairs (ਿ/ੀ, ੁ/ੂ, ੇ/ੈ, ੋ/ੌ), aspirate pairs
(ਕ/ਖ, ਗ/ਘ, ਚ/ਛ, ਜ/ਝ, ਟ/ਠ, ਡ/ਢ, ਤ/ਥ, ਦ/ਧ, ਪ/ਫ, ਬ/ਭ), ਯ/ਜ, ਵ/ਬ. Used for
alignment match/sub/merge/split moves and for the vocab fuzzy rescue.
Gaps are affine as Gemini specified: open 0.6, extend 0.15, tracked as
separate run states in both directions inside the local-alignment DP
(no adaptation needed — the DP carries the extra state alongside the
merge/split transitions).
Bonuses: +0.05 when the heard sequence appears as a contiguous subsequence
of the candidate (phrase order); up to +0.01 unfolded-text micro-bonus
(fraction of heard words whose base-folded form appears verbatim in the
candidate) for refrain-twin tie-breaking. Final score clamped to [0,1].

## 4. Romanized transliterator — `src/transliterate.js` (D6 reversed)

Deterministic longest-match Latin→Gurmukhi scanner (~150 lines): digraphs
(chh, kh, gh, ch, jh, th, dh, ph, bh, sh), syllable vowel→matra mapping
(aa/ee/oo/ai/au + singles), independent vowels at syllable start, bindi for
n before g/k (ਮਾਂਗ-, ਸੰਗ-), and the trailing "-eh" convention (mangeh →
ਮਾਂਗਹ). Output feeds the normal fold pipeline, so it never has to guess
classical spelling. Wired in two places: `matcher.search()` auto-applies it
when input is predominantly Latin, and `app.js` uses the same pipeline via
`foldHeard()`. Required cases (all top-1):
"hukmi hovan akaar hukam na kehia jaee" → Ang 1; "aad sach jugaad sach" →
Ang 1 (Ang 285 same-text also returned); "jo mangeh thakur apne te" →
Ang 681 (requirement was top-5).
Known transliteration imperfections the fuzzy stage absorbs: kehia → ਕੇਹਿਅ
(target ਕਹਿਆ), thakur → ਥਕੁਰ (target ਠਾਕੁਰ, aspirate-pair cost 0.2).

## 5. UI fixes — `app.js` / `index.html`

- (a) Duplicate grouping now keyed on the **exact original pankti text**
  (`p.t`), not the folded form.
- (b) Results show **5 + "Show 5 more"** toggle (10 computed).
- (c) Confidence bands on the matcher score, which is already the
  normalized score of §1.4 Q5 (0.9·align + 0.1·IDF coverage + bonuses,
  clamped [0,1]) — no rescaling needed: ≥0.78 high (no banner),
  0.55–0.77 medium ("Not quite right? Recite the next few words…"),
  <0.55 **or <8 folded chars** low (prompt to recite 3–5 more words,
  best-effort guesses rendered below the prompt). Confidence dots/confWord
  thresholds realigned to the same bands.
- (d) ASR buffering: final segments accumulate in `finalSegments` with a
  `committedResults` cursor; interim text is displayed separately and never
  concatenated into the searched string. Buffer resets on each mic start.
- Boot now also fetches `trigrams.json` (graceful null if missing) and
  passes it to the Matcher; candidate generation runs on recite-folded
  heard words via `foldHeard()`.

## Test results — before → after

| suite | before | after |
|---|---|---|
| test_matcher.js (168 q) | top-1 100%, top-5 100%, ~31 ms/q | top-1 100%, top-5 100%, ~269 ms/q |
| test_stress.js (150 q) | top-1 99.3%, top-5 100% | top-1 99.3%, top-5 100% (identical) |
| test_gemini.js (new, 21 checks) | — | **21 passed, 0 failed** |

New-suite detail: final-ਿ/ੁ-dropped 20/20 top-1; ਯ/ਵ-modernized 20/20;
split-word 20/20; merged-pair 20/20; romanized 3/3 as above; fold
cross-check 0 mismatches. **No failures in any suite.**

## Costs / adaptations to note

- Index size grew: **18.04 MB raw / 4.38 MB gz → 28.92 MB raw / 7.34 MB gz**.
  trigrams.json alone is 5.28 MB raw / 2.30 MB gz, and shards grew with the
  second folded form. This is the price of the trigram rescue; shrinking it
  (delta-encoded postings, role-split assets) belongs to the scheduled
  packaging pass.
- Query latency in Node rose ~31 ms → ~269 ms (phonetic DP, affine state,
  300-candidate pool). Fine for one-shot search; the Web Worker pass should
  keep it off the UI thread.
- Nothing from the Gemini list was left unimplemented in this pass's scope.
  Not done by design (separate scheduled pass): role-split search/display
  assets, IndexedDB caching, Web Worker search, re-rank on each interim
  speech event, highlight of the matched substring inside result cards.
