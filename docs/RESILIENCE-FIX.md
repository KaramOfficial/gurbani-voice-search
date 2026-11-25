# Resilience fix — extra words, rotation, kirtan word order (2026-11-25)

Context for future devs. Read this before touching the scoring in
`src/matcher.js`. The Gemini follow-up verdict is summarised in
DESIGN.md §1.5; this file is the shipped change and why.

## The field failures (owner-reported, with screenshots, 2026-11-25)

The owner tested the live tool + the Reader popup (same matcher) and hit:

1. **Next-line bleed ("fareeda case").** Query `aap sawaaryai main mila`
   → correct top-1 (ਆਪੁ ਸਵਾਰਹਿ ਮੈ ਮਿਲਹਿ ਮੈ ਮਿਲਿਆ ਸੁਖੁ ਹੋਇ ॥, Ang 1382,
   score 0.712). Prepending one confused word —
   `fareeda aap sawaaryai main mila` — dropped the correct pankti to
   **rank 26, score 0.333**, and the UI showed only "best guesses".
   ਫਰੀਦਾ is the first word of the NEXT pankti on that Ang
   (ਫਰੀਦਾ ਜੇ ਤੂ ਮੇਰਾ ਹੋਇ ਰਹਹਿ...). Bleeding the next line's opening word
   into the previous line is a natural memory error, and the dataset
   itself makes it predictable (lines are stored in Ang order).
2. **Rotation.** `man eko sahib bhai re` → correct top-1 (Ang 156,
   0.817). The same words rotated — `bhai re man eko sahib` (recitation
   starts mid-line and wraps) → correct pankti **not in top 10**, both
   scripts. One adjacent swap dropped it to rank 2 at 0.493.
3. **Kirtan order (owner's domain note).** In kirtan, singers switch
   word order musically; a listener searches in the SUNG order. The
   movement is not arbitrary: it follows Punjabi's natural flexibility
   and respects phrase-chunk boundaries — a vocative chunk like ਭਾਈ ਰੇ
   moves as a unit (front is natural; interleaved into the middle —
   "man bhai re eko sahib" — is not something anyone sings).

## Root cause (measured)

Candidate generation was never the problem: the correct pankti was in
the 300-candidate pool in every failing case. The old score
(`0.9 * sequential alignment + 0.1 * coverage`, normalised over ALL
heard words) made one unmatched word cost a full gap plus a
normalisation drag, and made any reordering catastrophic. Romanized
heard words are already imperfect (transliteration gives ਸਬਾਰਜੈ for
ਸਵਾਰਹਿ), so there was no headroom: one extra word sank the match.

## What shipped (deliberately the SIMPLE fix)

Owner's steer: "think about the most simple way this can be fixed."
Gemini's final (superseding) answer agreed — verbatim gist: you do not
need a chunking or segmentation pipeline; ship the simple rescoring
first, chunking is an optional Phase 2. Shipped formula, all inside
`src/matcher.js`, **no index change, no segmentation**:

```
BoW_Q = Σ_i w(q_i) · best_sim(q_i) / W_Q          (overlapScore)
score = α · BoW_Q + (1 − α) · align + bonuses
α     = clamp((W_Q − 10) / 6, 0.25, 0.85)
```

- **Query-only normalisation.** NEVER normalise by min(W_Q, W_P):
  hundreds of 1–3 word panktis (Rahao refrains, headers) would score
  1.0 against longer queries and outrank the true line (Gemini's
  "short-pankti trap" — the biggest risk of the naive version).
- **1-to-1 multiset matching**, rarest heard word first; phonetic sim
  clamped to 0 below 0.65; a 1-step merge rescue (heard word vs two
  adjacent target words joined) for ਸਤਿ ਗੁਰ ↔ ਸਤਿਗੁਰੁ splits.
- **Particle downweight ×0.35** for ~17 ultra-common tokens (ਰੇ, ਹੇ,
  ਵੇ, ਜੀ, ਕਉ, ਮਹਿ, ਤੇ, ਨਾਲ, ਸਿਉ, ਹੈ, ਹੋਇ, ਭਇਆ, ਮੈ, ਤੂ, ਜੋ, ਸੋ, ਨਾਨਕ):
  they move freely and match everywhere.
- **α blend:** order-free BoW dominates only when the query carries
  enough IDF mass; short/common-word queries keep the sequential
  alignment in charge, which is what stops short phrases colliding.
- Alignment, contiguous-phrase bonus (+0.05) and the unfolded-text
  micro-bonus (+0.01) survive as bonus/tie-break terms only.

## Confidence bands recalibrated

The new score's distribution differs from the old one, so bands were
re-fit to measured correct-match scores (hard romanized cases land
0.52–0.67; clean matches 0.9–1.0): **high ≥ 0.78 · medium 0.50–0.77 ·
low < 0.50** (plus the existing <8 folded chars low gate). Both apps
(`app.js` here, the search sheet in the Reader's `index.html`) use
0.50. A correct match must never land on the "best guesses — recite
more" dead-end screen; medium shows results with a soft hint.

## Test results (Node, this machine)

| Suite | Before | After |
|---|---|---|
| test_matcher.js (168 q) | top-1 100%, top-5 100%, ~269 ms/q | top-1 100%, top-5 100%, ~308 ms/q |
| test_stress.js (150 q) | top-1 99.3%, top-5 100% | top-1 98.7%, top-5 100% (one extra top-1 flip on a short+substituted query; no top-5 change) |
| test_gemini.js | 21/21 | 21/21 |
| **test_resilience.js (new)** | named cases: fareeda rank 26, rotation not-in-top-10 | **named 10/10 top-1; generated 168 q (bleed/insert/rotate/wrap/half-swap/adj-swap/repeat) top-1 99.4%, top-5 100%** |

Named-case scores after: fareeda roman 0.518 (was 0.333, rank 26 →
rank 1), fareeda Gurmukhi 0.738, rotated roman 0.627, rotated
Gurmukhi 0.92, kirtan half-swap 0.669.

## NOT built (Phase 2 candidates, in Gemini's order of value)

- Chunk segmentation + chunk-set scoring (portable boundary signals —
  postpositions, vocatives, verb endings, corpus PMI — with vishraam
  as a bonus signal only). Build only if field data shows BoW leaking.
- Two-line window matching (N+N+1) with a ×0.92 window penalty for
  cross-line queries. The fareeda pattern is already handled by cheap
  extra words; windows would matter for queries that genuinely span
  two lines' content.
- Asymmetric-gap Smith–Waterman rewrite of alignScore (Gemini Q1's
  first, heavier proposal — superseded by its own simplicity answer).

## Portability constraint (owner, 2026-11-25) — do not regress this

Nothing in the matcher may depend on vishraam marks. They exist for
Sri Guru Granth Sahib Ji in our Gursevak text, but this engine is
expected to extend to **Dasam Baani** and other texts where a vishraam
edition may not exist. Vishraam may only ever be a bonus signal, never
a foundation. The shipped fix uses words + IDF only — safe.

## Two-repo rule (owner, 2026-11-25) — do not break this

This matcher lives in TWO deployed places: this repo (standalone
tool) and a vendored copy `search-matcher.js` in
KaramOfficial/gurbani-reader (the Reader fetches its index from this
site's live `data/`). Rules: edit ONLY here → run all four suites →
copy the file over the vendored copy → verify md5 equality → deploy
this repo first, then the Reader → run the named cases live on both
surfaces. Same for `transliterate.js` / `search-transliterate.js`.
