/* Gurbani Voice Search — fuzzy pankti matcher.
 * foldWord/sim ported verbatim from Cracker (~/workspace/cracker-prototype/aligner-v2.js).
 * Gemini pre-ship fixes applied (docs/DESIGN.md §1.4, docs/GEMINI-FIXES.md):
 *   - reciteFold(): recitation fold on top of the base fold (final ਿ/ੁ
 *     stripped, ਯ→ਜ, ਵ→ਬ, ਟਿੱਪੀ→ਬਿੰਦੀ, pairi haha stripped) — index and
 *     query MUST apply it identically (Python twin: recite_fold in
 *     src/build_index.py).
 *   - Character-trigram candidate generation unioned with word postings,
 *     candidates capped at 300 pre-sorted by (matched token count, bigram
 *     proximity, trigram overlap, IDF score) — rescues split/merged words.
 *   - Phonetic substitution costs (simPhon) + affine gaps in re-rank.
 *   - Phrase-order bonus + unfolded-text micro-bonus for refrain twins.
 *   - Latin-script input is transliterated first (transliterate.js).
 * Search: IDF-weighted candidate generation over an inverted index, then a
 * local (partial-line) sequence-alignment re-rank with merge/split moves.
 * Works in browser (window.PanktiMatcher) and Node (module.exports).
 *
 * Index data (from build_index.py):
 *   vocab: { reciteFoldedWord: [idf, [panktiId, ...]], ... }
 *   panktis: [{id, a (ang), l (line idx), t (text), f (base-folded words),
 *              r (recite-folded words), s, e}]
 *   trigrams: { trigram: [panktiId, ...], ... } (optional, df-capped)
 */
(function (global) {
  "use strict";

  // ---- BEGIN verbatim port from Cracker aligner-v2.js ----
  var NUKTA_FOLD = {
    "\u0a5a": "\u0a17", // khha -> ga
    "\u0a5b": "\u0a1c", // za -> ja
    "\u0a59": "\u0a16", // kha-nukta -> kha
    "\u0a5e": "\u0a2b", // fa -> pha
    "\u0a36": "\u0a38", // sha -> sa
    "\u0a33": "\u0a32"  // lla -> la
  };

  function foldWord(w) {
    if (!w) return "";
    var t = String(w).normalize("NFC");
    var out = "";
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (NUKTA_FOLD[ch]) ch = NUKTA_FOLD[ch];
      if (ch === "\u0a71") continue;            // addak: dropped in folded form
      if (/[\s;.,\u0964\u0965\u00ab\u00bb'"\-:]/.test(ch)) continue; // punct / vishraam marks
      if (/[0-9\u0a66-\u0a6f]/.test(ch)) continue; // digits (unspoken markers)
      if (ch === "\u0a1e") ch = "\u0a28";        // nya -> na
      if (ch === "\u0a19") ch = "\u0a28";        // nga -> na
      out += ch;
    }
    return out;
  }

  // normalized Levenshtein similarity in [0,1]
  function sim(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    var la = a.length, lb = b.length;
    var prev = new Array(lb + 1), cur = new Array(lb + 1);
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur[0] = i;
      for (var k = 1; k <= lb; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return 1 - prev[lb] / Math.max(la, lb);
  }
  // ---- END verbatim port ----

  // Recitation fold over a BASE-folded word (Gemini §1.4): models how pa-IN
  // ASR renders recitation vs classical orthography. MUST stay identical to
  // recite_fold() in src/build_index.py.
  function reciteFold(f) {
    if (!f) return "";
    f = f.split("\u0a4d\u0a39").join("");       // pairi haha stripped
    f = f.split("\u0a2f").join("\u0a1c");       // ya -> ja
    f = f.split("\u0a35").join("\u0a2c");       // va -> ba
    f = f.split("\u0a70").join("\u0a02");       // tippi -> bindi
    var last = f.charAt(f.length - 1);
    if (last === "\u0a3f" || last === "\u0a41") f = f.slice(0, -1); // final sihari/aunkar
    return f;
  }
  function reciteFoldWord(w) { return reciteFold(foldWord(w)); }

  // ---- Phonetic similarity (Gemini §1.4 Q3) ----
  // Substitution inside a group costs 0.2 instead of 1.0: matra length
  // pairs, aspirated/unaspirated pairs, and the ਯ/ਜ, ਵ/ਬ modernizations
  // (the last two are already folded away, kept here for safety).
  var PHON_GROUPS = [
    "\u0a3f\u0a40", "\u0a41\u0a42", "\u0a47\u0a48", "\u0a4b\u0a4c",
    "\u0a15\u0a16", "\u0a17\u0a18", "\u0a1a\u0a1b", "\u0a1c\u0a1d",
    "\u0a1f\u0a20", "\u0a21\u0a22", "\u0a24\u0a25", "\u0a26\u0a27",
    "\u0a2a\u0a2b", "\u0a2c\u0a2d", "\u0a2f\u0a1c", "\u0a35\u0a2c"
  ];
  var PHON = {};
  PHON_GROUPS.forEach(function (g) {
    for (var i = 0; i < g.length; i++) PHON[g[i]] = g;
  });
  function subCost(a, b) {
    if (a === b) return 0;
    if (PHON[a] && PHON[a] === PHON[b]) return 0.2;
    return 1;
  }
  // Levenshtein similarity with phonetic substitution costs, in [0,1]
  function simPhon(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    var la = a.length, lb = b.length;
    var prev = new Array(lb + 1), cur = new Array(lb + 1);
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur[0] = i;
      for (var k = 1; k <= lb; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1,
          prev[k - 1] + subCost(a[i - 1], b[k - 1]));
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return 1 - prev[lb] / Math.max(la, lb);
  }

  function getTranslit() {
    if (global.PanktiTranslit) return global.PanktiTranslit;
    if (typeof require !== "undefined") {
      try { return require("./transliterate.js"); } catch (e) { /* browser */ }
    }
    return null;
  }

  // Full query pipeline: raw text -> [{pre (base fold), rec (recite fold)}]
  function foldHeardPairs(text) {
    var raw = String(text || "");
    var tr = getTranslit();
    if (tr && tr.isPredominantlyLatin(raw)) raw = tr.transliterate(raw);
    return raw.split(/\s+/).filter(Boolean).map(function (w) {
      var pre = foldWord(w);
      return { pre: pre, rec: reciteFold(pre) };
    }).filter(function (p) { return p.rec; });
  }
  function foldHeard(text) {
    return foldHeardPairs(text).map(function (p) { return p.rec; });
  }

  var GAP_OPEN = 0.6;         // affine gap penalties (Gemini §1.4 Q3)
  var GAP_EXT = 0.15;
  var CAND_CAP = 300;         // candidates surviving to re-rank (Gemini K=300)
  var FUZZY_SIM = 0.75;       // vocab rescue threshold
  var FUZZY_MAX_POSTINGS = 40;

  function Matcher(vocab, panktis, trigrams) {
    this.vocab = vocab;               // recite word -> [idf, postings]
    this.panktis = panktis;           // array indexed by id (must be id-ordered)
    this.trigrams = trigrams || null; // trigram -> postings (optional)
    this.vocabWords = Object.keys(vocab);
  }

  // Load from the data/ directory (Node) — browser code should fetch the
  // same files and construct Matcher directly.
  Matcher.loadFromDir = function (dir) {
    var fs = require("fs"), path = require("path");
    var vocab = JSON.parse(fs.readFileSync(path.join(dir, "vocab.json"), "utf8"));
    var manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    var panktis = [];
    manifest.shards.forEach(function (sh) {
      var rows = JSON.parse(fs.readFileSync(path.join(dir, sh.file), "utf8"));
      rows.forEach(function (r) { panktis[r.id] = r; });
    });
    var trigrams = null;
    try {
      trigrams = JSON.parse(fs.readFileSync(path.join(dir, "trigrams.json"), "utf8"));
    } catch (e) { /* trigram stage is optional */ }
    return new Matcher(vocab, panktis, trigrams);
  };

  function bigramProximity(H, T) {
    if (H.length < 2 || T.length < 2) return 0;
    var set = {};
    for (var j = 0; j + 1 < T.length; j++) set[T[j] + "\u0001" + T[j + 1]] = true;
    var hit = 0;
    for (var i = 0; i + 1 < H.length; i++) {
      if (set[H[i] + "\u0001" + H[i + 1]]) hit++;
    }
    return hit / (H.length - 1);
  }

  // heard: recite-folded word array -> candidate pankti ids, pre-sorted by
  // (matched token count, bigram proximity, trigram overlap, IDF score).
  Matcher.prototype.candidates = function (heard) {
    var stats = new Map(); // id -> {idf, tok, tri, big}
    function entry(id) {
      var e = stats.get(id);
      if (!e) { e = { idf: 0, tok: 0, tri: 0, big: 0 }; stats.set(id, e); }
      return e;
    }
    var self = this, seen = {};
    heard.forEach(function (h) {
      if (seen[h]) return; seen[h] = true;
      var ent = self.vocab[h];
      if (ent) {
        ent[1].forEach(function (id) {
          var e = entry(id); e.idf += ent[0]; e.tok += 1;
        });
      }
      if (!ent || ent[1].length < FUZZY_MAX_POSTINGS) {
        // fuzzy rescue: garbled rare words still anchor their pankti
        var counted = {};
        for (var vi = 0; vi < self.vocabWords.length; vi++) {
          var v = self.vocabWords[vi];
          if (v === h || Math.abs(v.length - h.length) > 3) continue;
          var s = simPhon(h, v);
          if (s >= FUZZY_SIM) {
            self.vocab[v][1].forEach(function (id) {
              var e = entry(id); e.idf += self.vocab[v][0] * s;
              if (!counted[id]) { counted[id] = true; e.tok += 1; }
            });
          }
        }
      }
    });
    // trigram stage: joined-string character 3-grams ignore word
    // boundaries, so split/merged forms of the same line still surface.
    if (this.trigrams) {
      var joined = heard.join(""), tset = {};
      for (var i = 0; i + 3 <= joined.length; i++) {
        tset[joined.substr(i, 3)] = true;
      }
      Object.keys(tset).forEach(function (tg) {
        var post = self.trigrams[tg];
        if (post) post.forEach(function (id) { entry(id).tri += 1; });
      });
    }
    // bigram proximity needs pankti records; skipped for ids whose shard
    // is not loaded yet (browser lazy-load flow tolerates big=0 there).
    if (heard.length >= 2) {
      stats.forEach(function (e, id) {
        var p = self.panktis[id];
        var T = p && (p.r || p.f);
        if (T) e.big = bigramProximity(heard, T);
      });
    }
    return Array.from(stats.entries())
      .sort(function (a, b) {
        var x = a[1], y = b[1];
        return y.tok - x.tok || y.big - x.big || y.tri - x.tri || y.idf - x.idf;
      })
      .slice(0, CAND_CAP)
      .map(function (e) { return e[0]; });
  };

  // Best local alignment gain of heard H against target T (recite-folded
  // arrays). Free leading/trailing target words (partial-line). DP moves:
  // match/sub (phonetic sim), merge (1 heard = 2 target), split (2 heard =
  // 1 target), and affine gaps in both directions (open 0.6, extend 0.15 —
  // Gemini §1.4 Q3; a missing/extra space or dropped word stays cheap to
  // extend once opened).
  Matcher.prototype.alignScore = function (H, T) {
    var n = H.length, m = T.length;
    if (!n || !m) return 0;
    var NEG = -1e9;
    var prev = new Float64Array(m + 1), cur = new Float64Array(m + 1);
    var prev2 = new Float64Array(m + 1);
    var prevF = new Float64Array(m + 1), curF = new Float64Array(m + 1);
    var best = 0;
    for (var i = 1; i <= n; i++) {
      cur[0] = NEG; curF[0] = NEG;
      var eRun = NEG; // target-gap run state E(i, j-1)
      for (var j = 1; j <= m; j++) {
        var F = Math.max(prev[j] - GAP_OPEN, prevF[j] - GAP_EXT); // heard word inserted
        var E = Math.max(cur[j - 1] - GAP_OPEN, eRun - GAP_EXT);  // target word dropped
        var v = Math.max(E, F);
        var s1 = simPhon(H[i - 1], T[j - 1]);
        v = Math.max(v, prev[j - 1] + s1);                        // match/sub
        if (j >= 2) {
          var sm = simPhon(H[i - 1], T[j - 2] + T[j - 1]);
          if (sm >= 0.6) v = Math.max(v, prev[j - 2] + sm);       // merge (ladiwar)
        }
        if (i >= 2) {
          var ss = simPhon(H[i - 2] + H[i - 1], T[j - 1]);
          if (ss >= 0.6) v = Math.max(v, prev2[j - 1] + ss);      // split
        }
        cur[j] = v; curF[j] = F; eRun = E;
        if (v > best) best = v;
      }
      var tmp = prev2; prev2 = prev; prev = cur; cur = tmp;
      var tf = prevF; prevF = curF; curF = tf;
    }
    return best / n;
  };

  Matcher.prototype.idfCoverage = function (heard, T) {
    var set = {};
    T.forEach(function (t) { set[t] = true; });
    var tot = 0, hit = 0, seen = {};
    var self = this;
    heard.forEach(function (h) {
      if (seen[h]) return; seen[h] = true;
      var e = self.vocab[h];
      var w = e ? e[0] : 1;
      tot += w;
      if (set[h]) hit += w;
    });
    return tot ? hit / tot : 0;
  };

  function isContiguousSubseq(H, T) {
    if (!H.length || H.length > T.length) return false;
    outer:
    for (var s = 0; s + H.length <= T.length; s++) {
      for (var i = 0; i < H.length; i++) if (T[s + i] !== H[i]) continue outer;
      return true;
    }
    return false;
  }

  // heardText: raw transcript string (Gurmukhi or romanized Latin) ->
  // ranked top-k results. Score = 0.9*align + 0.1*IDF coverage, plus
  // +0.05 contiguous phrase-order bonus and up to +0.01 unfolded-text
  // micro-bonus (refrain-twin tie-break), clamped to [0,1]. This score IS
  // the normalized score Gemini's confidence bands apply to (§1.4 Q5).
  Matcher.prototype.search = function (heardText, k) {
    k = k || 10;
    var pairs = foldHeardPairs(heardText);
    if (!pairs.length) return [];
    var heard = pairs.map(function (p) { return p.rec; });
    var heardPre = pairs.map(function (p) { return p.pre; });
    var self = this;
    var candIds = this.candidates(heard);
    var results = candIds.map(function (id) {
      var p = self.panktis[id];
      if (!p) return null;
      var T = p.r || p.f;
      var align = self.alignScore(heard, T);
      var cov = self.idfCoverage(heard, T);
      var bonus = 0;
      if (heard.length >= 2 && isContiguousSubseq(heard, T)) bonus += 0.05;
      if (p.f) {
        var fset = {};
        p.f.forEach(function (t) { fset[t] = true; });
        var exact = 0;
        heardPre.forEach(function (h) { if (fset[h]) exact++; });
        bonus += 0.01 * (exact / heardPre.length);
      }
      return {
        id: p.id, ang: p.a, line: p.l, text: p.t,
        start: p.s, end: p.e,
        score: Math.round(Math.min(1, 0.9 * align + 0.1 * cov + bonus) * 1000) / 1000,
        _align: align, _cov: cov
      };
    }).filter(Boolean);
    results.sort(function (a, b) {
      return b.score - a.score || b._cov - a._cov || a.ang - b.ang;
    });
    return results.slice(0, k).map(function (r) {
      delete r._align; delete r._cov; return r;
    });
  };

  var api = {
    foldWord: foldWord, reciteFold: reciteFold, reciteFoldWord: reciteFoldWord,
    sim: sim, simPhon: simPhon, foldHeard: foldHeard,
    foldHeardPairs: foldHeardPairs, Matcher: Matcher
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PanktiMatcher = api;
})(typeof window !== "undefined" ? window : globalThis);
