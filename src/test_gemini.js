/* Gemini pre-ship fix tests (docs/DESIGN.md §1.4, docs/GEMINI-FIXES.md).
 *  A. Cross-check: JS foldWord/reciteFoldWord vs the Python-built index
 *     (shard "f"/"r" arrays) over full source Angs — the two fold ports
 *     must agree word for word.
 *  B. ASR-shaped noise suites over sampled panktis: final-ਿ/ੁ dropped,
 *     ਯ/ਵ modernization, split compound word, merged adjacent words.
 *     Queries are built from base-folded forms (post-fold equivalent of
 *     what pa-IN emits); a hit = same folded text in top ranks.
 *  C. The three required romanized queries.
 * Run: node src/test_gemini.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { Matcher, foldWord, reciteFold } = require("./matcher.js");
const tr = require("./transliterate.js");
const matcher = Matcher.loadFromDir(path.join(__dirname, "..", "data"));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}

// ---- A. fold cross-check against the built index -------------------------
const SRC = path.join(process.env.HOME, "workspace/gurbani-timestamper/app_data");
let ccWords = 0, ccBad = 0;
for (const ang of [1, 2, 555, 1430]) {
  const data = JSON.parse(fs.readFileSync(path.join(SRC, `ang${ang}.json`), "utf8"));
  const rows = matcher.panktis.filter(p => p && p.a === ang);
  const expect = [];
  data.lines.forEach((line, li) => {
    const f = [], r = [];
    for (const w of line.words || []) {
      const fw = foldWord(w.word);
      if (!fw) continue;
      const rw = reciteFold(fw);
      if (!rw) continue;
      f.push(fw); r.push(rw);
    }
    if (r.length) expect.push({ l: li, f, r });
  });
  check(`crosscheck ang ${ang} row count`, rows.length === expect.length,
    `${rows.length} vs ${expect.length}`);
  rows.forEach((row, i) => {
    const e = expect[i];
    if (!e || row.l !== e.l || row.f.join(" ") !== e.f.join(" ") ||
        row.r.join(" ") !== e.r.join(" ")) {
      ccBad++;
      if (ccBad <= 3) console.log(`  mismatch ang ${ang} line ${row.l}:\n    idx f=${row.f.join(" ")}\n    js  f=${e ? e.f.join(" ") : "?"}\n    idx r=${row.r.join(" ")}\n    js  r=${e ? e.r.join(" ") : "?"}`);
    }
    ccWords += e ? e.f.length : 0;
  });
}
check("crosscheck word-level fold agreement", ccBad === 0, `${ccBad} mismatched rows`);
console.log(`A. cross-check: ${ccWords} words over 4 Angs, ${ccBad} mismatched rows`);

// ---- B. ASR-shaped noise suites -------------------------------------------
const eligible = matcher.panktis.filter(p => p && p.f.length >= 6);
const SAMPLES = 20, samples = [];
for (let i = 0; i < SAMPLES; i++) samples.push(eligible[Math.floor(i * eligible.length / SAMPLES)]);

const suites = {
  finalDrop: f => f.map(w => (w.endsWith("ਿ") || w.endsWith("ੁ")) ? w.slice(0, -1) : w).join(" "),
  yaVaModern: f => f.map(w => w.replace(/ਯ/g, "ਜ").replace(/ਵ/g, "ਬ")).join(" "),
  splitWord: f => {
    let li = 0;
    f.forEach((w, i) => { if (w.length > f[li].length) li = i; });
    const w = f[li], mid = Math.ceil(w.length / 2);
    return f.slice(0, li).concat([w.slice(0, mid), w.slice(mid)], f.slice(li + 1)).join(" ");
  },
  mergedPair: f => {
    const mi = Math.floor(f.length / 2) - 1;
    return f.slice(0, mi).concat([f[mi] + f[mi + 1]], f.slice(mi + 2)).join(" ");
  }
};
for (const [kind, make] of Object.entries(suites)) {
  let t1 = 0, t5 = 0;
  const misses = [];
  for (const p of samples) {
    const res = matcher.search(make(p.f.slice()), 10);
    const rank = res.findIndex(r => r.text === p.t || (matcher.panktis[r.id] &&
      matcher.panktis[r.id].f.join(" ") === p.f.join(" ")));
    if (rank === 0) t1++;
    if (rank >= 0 && rank < 5) t5++; else misses.push(`Ang ${p.a} rank=${rank}`);
  }
  console.log(`B. ${kind}: top1 ${t1}/${samples.length} top5 ${t5}/${samples.length}` +
    (misses.length ? ` misses: ${misses.join("; ")}` : ""));
  check(`${kind} top5 all`, t5 === samples.length, misses.join("; "));
  check(`${kind} top1 >= 90%`, t1 >= Math.floor(samples.length * 0.9), `${t1}/${samples.length}`);
}

// split/merge of the canonical compound, both directions
const sat = matcher.panktis.find(p => p && p.f.includes("ਸਤਿਗੁਰੁ"));
const si = sat.f.indexOf("ਸਤਿਗੁਰੁ");
const splitQ = sat.f.slice(0, si).concat(["ਸਤਿ", "ਗੁਰੁ"], sat.f.slice(si + 1)).join(" ");
const splitRes = matcher.search(splitQ, 5);
check("ਸਤਿਗੁਰੁ split as ਸਤਿ ਗੁਰੁ finds its pankti top-5",
  splitRes.some(r => r.id === sat.id), JSON.stringify(splitRes.map(r => r.ang)));
const mergedQ = sat.f.slice(0, si).concat(["ਸਤਿਗੁਰੁ"], sat.f.slice(si + 1)).join(" ");
check("merged form is the clean form (sanity)", mergedQ === sat.f.join(" "));

// ---- C. romanized queries ---------------------------------------------------
const r1 = matcher.search("hukmi hovan akaar hukam na kehia jaee", 5);
check("romanized hukmi... top-1 is Ang 1 hukmi pankti",
  r1.length && r1[0].ang === 1 && r1[0].text.includes("ਹੁਕਮੀ"),
  JSON.stringify(r1.slice(0, 2).map(r => [r.ang, r.score])));
const r2 = matcher.search("aad sach jugaad sach", 5);
check("romanized aad sach... top-1 Ang 1, same-text Ang 285 also present",
  r2.length && r2[0].ang === 1 && r2.some(r => r.ang === 285),
  JSON.stringify(r2.slice(0, 3).map(r => r.ang)));
const r3 = matcher.search("jo mangeh thakur apne te", 5);
check("romanized jo mangeh... pankti in top-5",
  r3.some(r => r.text.includes("ਮਾਗਹਿ") && r.text.includes("ਠਾਕੁਰ")),
  JSON.stringify(r3.slice(0, 3).map(r => [r.ang, r.text])));
check("transliterate leaves Gurmukhi untouched",
  tr.transliterate("ਹੁਕਮੀ ਹੋਵਨਿ") === "ਹੁਕਮੀ ਹੋਵਨਿ");
check("isPredominantlyLatin detects romanized", tr.isPredominantlyLatin("jo mangeh thakur") === true);
check("isPredominantlyLatin rejects Gurmukhi", tr.isPredominantlyLatin("ਜੋ ਮਾਂਗਹਿ") === false);
console.log(`C. romanized: hukmi top=${r1[0] && r1[0].ang}, aad top=${r2[0] && r2[0].ang}, jo-mangeh ranks=${r3.map(r => r.ang).join(",")}`);

console.log(`\nGEMINI TESTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
