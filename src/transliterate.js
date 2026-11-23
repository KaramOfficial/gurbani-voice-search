/* Gurbani Voice Search — deterministic Latin (romanized Punjabi) ->
 * Gurmukhi transliterator (Gemini pre-ship fix, DESIGN.md §1.4 Q6).
 *
 * Longest-match, syllable-based scanner: consonant cluster + vowel, where
 * the vowel becomes a matra on the consonant (or an independent vowel
 * letter at a syllable start). Output is ordinary Gurmukhi text meant to be
 * fed through the normal fold pipeline (foldWord/reciteFold in matcher.js),
 * so it does NOT need to guess classical spelling — the folded space is
 * forgiving (ਸ਼→ਸ, ਯ→ਜ, ਵ→ਬ, final ਿ/ੁ dropped, etc.).
 *
 * Works in browser (window.PanktiTranslit) and Node (module.exports).
 */
(function (global) {
  "use strict";

  // consonant clusters, longest first when scanning
  var CONS2 = {
    kh: "\u0a16", gh: "\u0a18", ch: "\u0a1a", jh: "\u0a1d", th: "\u0a25",
    dh: "\u0a27", ph: "\u0a2b", bh: "\u0a2d", sh: "\u0a38"
  };
  var CONS1 = {
    k: "\u0a15", g: "\u0a17", j: "\u0a1c", t: "\u0a24", d: "\u0a26",
    n: "\u0a28", p: "\u0a2a", b: "\u0a2c", m: "\u0a2e", y: "\u0a2f",
    r: "\u0a30", l: "\u0a32", v: "\u0a35", w: "\u0a35", s: "\u0a38",
    h: "\u0a39", f: "\u0a2b", z: "\u0a1c", q: "\u0a15", c: "\u0a1a",
    x: "\u0a15"
  };
  // vowel -> [matra (after consonant), independent letter]
  var VOW2 = {
    aa: ["\u0a3e", "\u0a06"], ee: ["\u0a40", "\u0a08"],
    oo: ["\u0a42", "\u0a0a"], ai: ["\u0a48", "\u0a10"],
    au: ["\u0a4c", "\u0a14"]
  };
  var VOW1 = {
    a: ["", "\u0a05"], i: ["\u0a3f", "\u0a07"], u: ["\u0a41", "\u0a09"],
    e: ["\u0a47", "\u0a0f"], o: ["\u0a4b", "\u0a13"]
  };

  function matchCons(w, i) {
    if (w.substr(i, 3) === "chh") return { g: "\u0a1b", len: 3 };
    var two = w.substr(i, 2);
    if (CONS2[two]) return { g: CONS2[two], len: 2 };
    if (CONS1[w[i]]) return { g: CONS1[w[i]], len: 1 };
    return null;
  }
  function matchVow(w, i) {
    var two = w.substr(i, 2);
    if (VOW2[two]) return { m: VOW2[two][0], ind: VOW2[two][1], len: 2 };
    if (VOW1[w[i]]) return { m: VOW1[w[i]][0], ind: VOW1[w[i]][1], len: 1 };
    return null;
  }

  function translitWord(word) {
    var w = word.toLowerCase(), out = "", i = 0;
    while (i < w.length) {
      // nasal assimilation: n before g/k is a bindi (ਮਾਂਗ-, ਸੰਗਤ style)
      if (w[i] === "n" && (w[i + 1] === "g" || w[i + 1] === "k")) {
        out += "\u0a02"; i++; continue;
      }
      var cons = matchCons(w, i);
      if (cons) {
        var rest = w.slice(i + cons.len);
        // trailing "-eh" convention (mangeh, keheh...): the e is unwritten,
        // the word ends in consonant + ਹ
        if (rest === "eh") { out += cons.g + "\u0a39"; break; }
        i += cons.len;
        var vow = matchVow(w, i);
        if (vow) { out += cons.g + vow.m; i += vow.len; }
        else out += cons.g; // inherent 'a'
        continue;
      }
      var v = matchVow(w, i);
      if (v) { out += v.ind; i += v.len; continue; }
      i++; // unknown char (digit, punctuation remnant) — skip
    }
    return out;
  }

  // Transliterate a full string word by word; non-Latin words pass through
  // unchanged, so applying this to Gurmukhi text is a safe no-op.
  function transliterate(text) {
    return String(text || "").split(/(\s+)/).map(function (tok) {
      if (/^\s+$/.test(tok) || !tok) return tok;
      if (!/[a-zA-Z]/.test(tok)) return tok;
      return translitWord(tok.replace(/[^a-zA-Z]/g, ""));
    }).join("");
  }

  // True when the text is predominantly Latin script (typed romanized input
  // or an ASR transcript that leaked Latin tokens).
  function isPredominantlyLatin(text) {
    var s = String(text || "");
    var latin = (s.match(/[a-zA-Z]/g) || []).length;
    var gur = (s.match(/[\u0a00-\u0a7f]/g) || []).length;
    return latin > 0 && latin >= gur;
  }

  var api = {
    transliterate: transliterate,
    translitWord: translitWord,
    isPredominantlyLatin: isPredominantlyLatin
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PanktiTranslit = api;
})(typeof window !== "undefined" ? window : globalThis);
