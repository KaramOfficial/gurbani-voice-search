# Pankti Search — UI Cook Jury Review (v1)

Date: 2026-11-22 · Build: `index.html` + `app.js` (root), matcher/index unchanged.
Method: five independent critic passes (design, phone usability, text-fit,
accessibility, performance), findings fixed in one pass, then real-user QA
with Playwright at 390×844 (screenshots in `docs/qa/`).

**No Gemini approval is claimed for this UI** — DESIGN.md §1.4 is still empty.

---

## Critic findings and fixes

### 1. Design critic
- **F1 (minor):** Placeholder `ਸਤਿਨਾਮੁ ਵਾਹਿਗੁਰੂ…` clipped mid-word in the input,
  reading as a rendering bug. **Fixed:** placeholder is now `ਪੰਕਤੀ ਇੱਥੇ ਲਿਖੋ…`.
- **F2 (minor):** Raw score must never show (per DESIGN §4) — verified: UI
  shows only ● dots, no numbers. OK as built.
- **F3 (note):** Mic icon is a hand-drawn SVG path; at 112px it reads clearly
  as a microphone in screenshots. Accepted for v1.
- **F4 (note):** One idea per screen holds — header, one primary action (mic),
  one fallback (type), results. No settings. OK.

### 2. Phone-usability critic
- **F5 (major, by design deviation — resolved):** DESIGN §4 wanted the heard
  transcript "tappable to fix". Implemented instead as: the final transcript
  is written into the text input, where it can be edited and re-searched with
  the Search button; the Heard box is the read-only live/interim display.
  This keeps one editable field (simpler than two) and satisfies the intent.
- **F6 (minor):** Results begin below the mic zone, so the user scrolls to
  read a 10-card list. Accepted for v1 (mic stays reachable at top); a sticky
  mini-header is a v2 candidate.
- **F7 (ok):** Touch targets — mic 112px, Search button 48px high, cards are
  full-width links ≥ ~76px tall. All above the 48px minimum.

### 3. Text-fit critic
- **Verified by measurement, not eyeball:** `documentElement.scrollWidth ==
  innerWidth == 390` on home and all three result screens; every card
  measures 358px wide (390 − padding); the longest pankti in the test set
  (Ang 1315, 17 words) wraps inside its card. No horizontal scroll anywhere.
- **F8 (minor):** A long query truncates visually inside the single-line
  input — the full text is always shown in the Heard box, so nothing is lost.
  Accepted.

### 4. Accessibility critic
- **F9 (major):** The confidence dots (●○) would be read aloud literally by
  screen readers, and a bare `aria-label` on a `<span>` is unreliable.
  **Fixed:** dots span is now `aria-hidden="true"`, and each card's link
  `aria-label` carries a confidence word ("very strong / strong / fair /
  weak match") plus Ang and full pankti text.
- **F10 (ok):** Status line is `role="status"` / `aria-live="polite"` and
  announces "N matches found."; mic button has state-dependent `aria-label`
  ("Listening — tap to stop"); focus-visible outlines on mic, Search, cards;
  listening pulse animation is disabled under `prefers-reduced-motion`.
- **F11 (ok):** Vishraam colours (red/green) are decorative only — the words
  themselves carry the meaning, colour is never the sole signal.

### 5. Performance critic
- **F12 (major, measured — accepted with mitigation, v2 fix noted):**
  Lazy shard loading degenerates for common-word queries. Candidate
  generation runs on the vocab alone (as designed), but the top-200
  candidates for the test query touched **all 15 shards**, so the first
  search downloads the whole corpus: 4.38 MB gz total, one time, then cached
  in memory (second search fetched 0 new shards). Measured locally:
  boot 429 ms (manifest + vocab only), first search 578 ms end-to-end,
  second search 361 ms — on desktop-class CPU; a mid-range phone will be
  slower but the flow stays usable. **Mitigations shipped:** boot loads only
  manifest + vocab (~1.2 MB gz); when a search needs >3 new shards the
  status line says "Loading pankti data (first search only)…" with a
  progress bar. **Proper v2 fix:** matcher must tolerate missing pankti
  records so the UI can load shards for only the top ~40 candidates and
  re-rank a subset (the current `Matcher.search` dereferences every
  candidate and throws on a missing record, so partial loading is unsafe
  without a matcher change — out of scope for this UI task).
- **F13 (ok):** No webfont dependency — system Noto Sans/Serif Gurmukhi
  stacks; no external requests at all besides the Reader link on tap.

---

## Real-user QA (Playwright, 390×844, Chromium)

Served from the project root (loaded via `file://` with
`--allow-file-access-from-files`; this Chromium build blocks
`http://localhost` navigations with Local Network Access checks — an
environment quirk, not an app issue; the app itself uses only relative
fetches and works identically over HTTP).

| Screen | Shot | Result |
|---|---|---|
| Home | `docs/qa/01-home.png` | Ready state, mic enabled, no h-scroll |
| Clean query | `docs/qa/02-results-clean.png` | Top hit correct (below) |
| Garbled query | `docs/qa/03-results-garbled.png` | Top hit correct (below) |
| Refrain query | `docs/qa/04-results-refrain.png` | Grouping works (below) |

Console/page errors across all runs: **none**.

### Typed-query test results

| Query | Type | Top hit | Verdict |
|---|---|---|---|
| ਹੁਕਮੀ ਹੋਵਨਿ ਆਕਾਰ ਹੁਕਮੁ ਨ ਕਹਿਆ ਜਾਈ | clean fragment (ਜਪੁਜੀ ਸਾਹਿਬ) | Ang 1, ●●●●, exact pankti | ✅ correct |
| ਹੁਕਮੀ ਹੋਵਨ ਆਕਾਰ ਹੁਕਮ ਨ ਕਹਿਆ ਜਾਇ | garbled (dropped ਿ/ੁ matras, ਹੋਵਨਿ→ਹੋਵਨ, ਜਾਈ→ਜਾਇ) | Ang 1, ●●●○, same pankti | ✅ correct |
| ਆਦਿ ਸਚੁ ਜੁਗਾਦਿ ਸਚੁ | refrain fragment | Ang 1, ●●●●, card grouped "also on Ang 285" | ✅ correct + D4 grouping verified |

All three return 10 grouped results; the correct pankti is #1 in each.

## Known limitations carried forward

1. **Voice capture itself is untested end-to-end** — the sandbox has no
   microphone; the SpeechRecognition wiring (pa-IN, interim results,
   auto-search on final, friendly error messages for denied/no-speech/
   network) is code-reviewed and the button enables where the API exists,
   but the first real test must happen on Karam's phone.
2. **Reader deep-link is best-effort** — cards link to
   `https://karamofficial.github.io/gurbani-reader/?ang=N`; the Reader has
   no `?ang=` routing yet (DESIGN.md §4), so the footer and this doc say so.
3. **Grouping scope** — identical-text grouping aggregates the top-30 raw
   hits; a refrain occurring many times may list only the Angs that made
   the top 30 (ties break by ascending Ang, so the earliest Angs show).
4. First-search full-corpus download — see F12.
