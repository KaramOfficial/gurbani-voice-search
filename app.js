/* Pankti Search — v1 UI.
 * Loading strategy (lazy shards):
 *   1. Fetch manifest.json + vocab.json + trigrams.json up front
 *      (Gemini fixes: vocab/trigrams are keyed on recite-folded words).
 *   2. On search, run candidate generation on the vocab+trigrams alone
 *      (Matcher.candidates only touches those), find which shards hold
 *      the top-300 candidate panktis, fetch ONLY those shards, then re-rank.
 *   Shards are cached after first fetch, so later searches get faster.
 * Result cards link to the Reader with ?ang=N&line=L — the Reader lands
 * on that exact pankti as the focus, as a detour: its saved place/focus
 * and every Sehaj Paath snapshot stay untouched (see the Reader's
 * CONTEXT.md, deep-link detour).
 * Confidence bands (Gemini §1.4 Q5): matcher score IS the normalized score.
 *   >= 0.78 high · 0.55–0.77 medium · < 0.55 OR < 8 folded chars low.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status"), loadbar = $("loadbar"), loadprog = $("loadprog");
  var micBtn = $("micBtn"), micHint = $("micHint");
  var form = $("searchForm"), input = $("queryInput"), searchBtn = $("searchBtn");
  var heardBox = $("heardBox"), heardText = $("heardText");
  var lowconfEl = $("lowconf"), noresultsEl = $("noresults"), resultsEl = $("results");
  var moreBtn = $("moreBtn");

  var READER_URL = "https://karamofficial.github.io/gurbani-reader/?ang=";
  var FETCH_K = 30; // fetch more than 10 so duplicate grouping has material

  var vocab = null, manifest = null, matcher = null, trigrams = null;
  var panktis = [];               // sparse, filled as shards load
  var shardRanges = [];           // [{file, fromId, toId}] inclusive ids
  var shardLoaded = {};           // file -> true
  var shardPromises = {};         // file -> Promise

  function setStatus(msg) { statusEl.textContent = msg || ""; }
  function setLoading(on, pct) {
    loadbar.classList.toggle("show", !!on);
    if (typeof pct === "number") loadprog.value = pct;
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("fetch " + url + " -> " + r.status);
      return r.json();
    });
  }

  function buildShardRanges() {
    var next = 0;
    manifest.shards.forEach(function (sh) {
      shardRanges.push({ file: sh.file, fromId: next, toId: next + sh.panktis - 1 });
      next += sh.panktis;
    });
  }
  function shardForId(id) {
    for (var i = 0; i < shardRanges.length; i++) {
      if (id >= shardRanges[i].fromId && id <= shardRanges[i].toId) return shardRanges[i];
    }
    return null;
  }
  function loadShard(file) {
    if (shardLoaded[file]) return Promise.resolve();
    if (shardPromises[file]) return shardPromises[file];
    shardPromises[file] = fetchJSON("data/" + file).then(function (rows) {
      rows.forEach(function (r) { panktis[r.id] = r; });
      shardLoaded[file] = true;
    });
    return shardPromises[file];
  }

  // ---- Vishraam presentation (Reader convention) -------------------------
  // Symbols are hidden; the word before a major vishraam ( ; ) is coloured
  // one way, before a minor vishraam ( . or , ) another. Source text in the
  // data is never altered — this is display only. Line-end ॥ and verse
  // digits are presentation marks and are hidden too.
  function renderPankti(text) {
    var frag = document.createDocumentFragment();
    var tokens = String(text).split(/\s+/);
    tokens.forEach(function (tok, idx) {
      if (!tok) return;
      var cls = "";
      if (/;$/.test(tok)) cls = "vmaj";
      else if (/[.,]$/.test(tok)) cls = "vmin";
      var clean = tok.replace(/[;.,\u0964\u0965\u0a66-\u0a6f0-9]/g, "");
      if (!clean) return;
      var span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = clean;
      frag.appendChild(span);
      if (idx < tokens.length - 1) frag.appendChild(document.createTextNode(" "));
    });
    return frag;
  }

  function dots(score) {
    var n = score >= 0.78 ? 4 : score >= 0.65 ? 3 : score >= 0.55 ? 2 : 1;
    var s = "";
    for (var i = 0; i < 4; i++) s += i < n ? "●" : "○";
    return s;
  }
  function confWord(score) {
    return score >= 0.78 ? "strong match" : score >= 0.55 ? "fair match" : "weak match";
  }

  // Group duplicates keyed on the EXACT original (unfolded) pankti text
  // (Gemini §1.4 Q4): folding-keyed grouping would collapse distinct lines
  // that differ only in ਿ/ੁ or nasalization into one card.
  function groupResults(raw) {
    var byKey = {}, order = [];
    raw.forEach(function (r) {
      var p = panktis[r.id];
      var key = p ? p.t : r.text;
      if (!byKey[key]) { byKey[key] = { best: r, angs: [] }; order.push(key); }
      var g = byKey[key];
      if (r.score > g.best.score) g.best = r;
      if (g.angs.indexOf(r.ang) === -1) g.angs.push(r.ang);
    });
    return order.map(function (k) {
      var g = byKey[k];
      g.angs.sort(function (a, b) { return a - b; });
      return g;
    }).sort(function (a, b) { return b.best.score - a.best.score; }).slice(0, 10);
  }

  var PAGE = 5;             // Gemini §1.4 Q4: show 5, "Show 5 more" toggle
  var currentGroups = [];

  function renderResults(groups, foldedChars) {
    currentGroups = groups;
    resultsEl.innerHTML = "";
    moreBtn.style.display = "none";
    noresultsEl.classList.toggle("show", groups.length === 0);
    // Confidence band on the top score (matcher score = normalized score),
    // with the Gemini length gate: < 8 folded chars is always "low".
    var band = null;
    if (groups.length) {
      var top = groups[0].best.score;
      band = (foldedChars < 8 || top < 0.55) ? "low" : top < 0.78 ? "medium" : "high";
    }
    if (band === "low") {
      lowconfEl.textContent = foldedChars < 8
        ? "That was very short — I can only guess. Recite a few more words of the line (3–5 more) for a surer match. Best guesses so far:"
        : "No close match yet — try reciting 3–5 words more of the line. Best guesses so far:";
      lowconfEl.classList.add("show");
    } else if (band === "medium") {
      lowconfEl.textContent = "Not quite right? Recite the next few words of the line to sharpen the match.";
      lowconfEl.classList.add("show");
    } else {
      lowconfEl.classList.remove("show");
    }
    renderCards(groups.slice(0, PAGE));
    if (groups.length > PAGE) moreBtn.style.display = "";
    if (groups.length) setStatus(groups.length + (groups.length === 1 ? " match" : " matches") + " found.");
  }

  moreBtn.addEventListener("click", function () {
    renderCards(currentGroups.slice(PAGE));
    moreBtn.style.display = "none";
  });

  function renderCards(groups) {
    groups.forEach(function (g) {
      var r = g.best;
      var a = document.createElement("a");
      a.className = "card";
      a.href = READER_URL + r.ang + "&line=" + r.line;
      a.target = "_blank"; a.rel = "noopener";
      a.setAttribute("aria-label", "Ang " + r.ang + ", " + confWord(r.score) + ": " + r.text);
      var p = document.createElement("div");
      p.className = "pankti";
      p.appendChild(renderPankti(r.text));
      a.appendChild(p);
      var meta = document.createElement("div"); meta.className = "meta";
      var ang = document.createElement("span"); ang.className = "ang";
      ang.textContent = "Ang " + r.ang;
      meta.appendChild(ang);
      if (g.angs.length > 1) {
        var note = document.createElement("span"); note.className = "angs-note";
        note.textContent = "also on Ang " + g.angs.filter(function (x) { return x !== r.ang; }).join(", ");
        meta.appendChild(note);
      }
      var d = document.createElement("span"); d.className = "dots";
      d.textContent = dots(r.score);
      d.setAttribute("aria-hidden", "true");
      meta.appendChild(d);
      var open = document.createElement("span"); open.className = "open-hint";
      open.textContent = "tap to open in Reader →";
      meta.appendChild(open);
      a.appendChild(meta);
      resultsEl.appendChild(a);
    });
  }

  var searching = false;
  function runSearch(text) {
    text = (text || "").trim();
    if (!text || !matcher || searching) return;
    searching = true; searchBtn.disabled = true;
    heardBox.classList.add("show");
    heardText.textContent = text;
    setStatus("Searching…"); setLoading(true, 30);
    // foldHeard = transliterate-if-Latin + base fold + recitation fold —
    // the same pipeline matcher.search applies (vocab is recite-keyed).
    var heard = window.PanktiMatcher.foldHeard(text);
    var candIds;
    try {
      candIds = matcher.candidates(heard);
    } catch (e) { candIds = []; }
    var files = {}, list = [];
    candIds.forEach(function (id) {
      var sh = shardForId(id);
      if (sh && !files[sh.file]) { files[sh.file] = true; list.push(sh.file); }
    });
    if (list.length > 3) setStatus("Loading pankti data (first search only)…");
    var done = 0;
    var jobs = list.map(function (f) {
      return loadShard(f).then(function () {
        done++; setLoading(true, 30 + Math.round(60 * done / Math.max(1, list.length)));
      });
    });
    Promise.all(jobs).then(function () {
      var raw = matcher.search(text, FETCH_K);
      // keep only results whose pankti record is actually loaded
      raw = raw.filter(function (r) { return panktis[r.id]; });
      renderResults(groupResults(raw), heard.join("").length);
    }).catch(function (err) {
      setStatus("Search failed — check your connection and try again.");
      console.error(err);
    }).then(function () {
      searching = false; searchBtn.disabled = false; setLoading(false);
    });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    runSearch(input.value);
  });

  // ---- Voice -------------------------------------------------------------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recog = null, listening = false;
  function setupMic() {
    if (!SR) {
      micBtn.disabled = true;
      micHint.textContent = "Voice is not supported in this browser — type or paste the line below instead.";
      return;
    }
    recog = new SR();
    recog.lang = "pa-IN";
    recog.interimResults = true;
    recog.continuous = false;
    recog.maxAlternatives = 1;
    // Final segments are buffered separately from interim text (Gemini
    // §1.4 Q1: Chrome cuts sessions on pauses — concatenating raw interim
    // strings duplicates/garbles words). committedResults counts result
    // entries already moved into finalSegments; both reset on each start.
    var finalSegments = [], committedResults = 0;
    recog.onresult = function (ev) {
      var interim = "", newFinal = false;
      for (var i = committedResults; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          finalSegments.push(t.trim());
          committedResults = i + 1;
          newFinal = true;
        } else {
          interim += t;
        }
      }
      var finals = finalSegments.filter(Boolean).join(" ");
      heardBox.classList.add("show");
      heardText.textContent = finals;
      if (interim) {
        var s = document.createElement("span");
        s.className = "interim";
        s.textContent = (finals ? " " : "") + interim;
        heardText.appendChild(s);
      }
      if (finals) input.value = finals;
      if (newFinal && finals) runSearch(finals);
    };
    recog._resetBuffer = function () {
      finalSegments = []; committedResults = 0;
    };
    recog.onend = function () {
      listening = false;
      micBtn.classList.remove("listening");
      micBtn.setAttribute("aria-label", "Tap and recite a pankti");
      if (micHint.dataset.mode !== "error") micHint.textContent = "Tap and recite a pankti";
    };
    recog.onerror = function (ev) {
      micHint.dataset.mode = "error";
      var msg = {
        "not-allowed": "Microphone permission was denied — allow the mic, or type the line below.",
        "service-not-allowed": "Microphone permission was denied — allow the mic, or type the line below.",
        "no-speech": "I didn't hear anything — tap and try again, a little closer to the mic.",
        "audio-capture": "No microphone found — type the line below instead.",
        "network": "Voice needs a network connection — check it, or type the line below."
      }[ev.error] || "Voice didn't work that time — tap to retry, or type the line below.";
      micHint.textContent = msg;
    };
    micBtn.disabled = false;
  }
  micBtn.addEventListener("click", function () {
    if (!recog || listening) { if (recog && listening) try { recog.stop(); } catch (e) {} return; }
    delete micHint.dataset.mode;
    if (recog._resetBuffer) recog._resetBuffer();
    try {
      recog.start();
      listening = true;
      micBtn.classList.add("listening");
      micBtn.setAttribute("aria-label", "Listening — tap to stop");
      micHint.textContent = "Listening… recite the pankti";
      heardBox.classList.add("show");
      heardText.textContent = "";
    } catch (e) { /* already started */ }
  });

  // ---- Boot ---------------------------------------------------------------
  setLoading(true, 10);
  Promise.all([
    fetchJSON("data/manifest.json"), fetchJSON("data/vocab.json"),
    fetchJSON("data/trigrams.json").catch(function () { return null; })
  ])
    .then(function (res) {
      manifest = res[0]; vocab = res[1]; trigrams = res[2];
      buildShardRanges();
      matcher = new window.PanktiMatcher.Matcher(vocab, panktis, trigrams);
      setLoading(false);
      setStatus("Ready — " + manifest.panktis.toLocaleString("en-US") + " panktis across " + manifest.angs + " Angs.");
      searchBtn.disabled = false;
      setupMic();
      var q = new URLSearchParams(location.search).get("q");
      if (q) { input.value = q; runSearch(q); }
    })
    .catch(function (err) {
      setLoading(false);
      setStatus("Could not load the search index — check your connection and reload.");
      console.error(err);
    });
})();
