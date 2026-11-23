/* Synthetic noisy-query test for matcher.js.
 * Samples real panktis (deterministic spread across all Angs, >=6 words),
 * builds noisy variants, and reports top-1 / top-5 hit rates per noise type.
 * Noise is synthetic — a proxy until real pa-IN transcripts exist.
 * Run: node src/test_matcher.js
 */
"use strict";
const path = require("path");
const { Matcher } = require("./matcher.js");

const t0 = Date.now();
const matcher = Matcher.loadFromDir(path.join(__dirname, "..", "data"));
console.log(`index loaded in ${Date.now() - t0} ms; panktis=${matcher.panktis.length}`);

// deterministic RNG
let seed = 42;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(arr) { return Math.floor(rnd() * arr.length); }

// sample 24 panktis spread across the corpus, >= 6 folded words
const eligible = matcher.panktis.filter(p => p && p.f.length >= 6);
const SAMPLES = 24;
const samples = [];
for (let i = 0; i < SAMPLES; i++) samples.push(eligible[Math.floor(i * eligible.length / SAMPLES)]);

function garble(word) {
  if (word.length < 3) return word;
  const i = 1 + Math.floor(rnd() * (word.length - 1));
  const chars = Array.from(word);
  chars[i] = chars[i] === "ਾ" ? "ਿ" : "ਾ"; // swap a matra — typical recognizer drift
  return chars.join("");
}

function variants(p) {
  const f = p.f.slice();
  const out = {};
  out.clean = f.join(" ");
  out.garble1 = f.map((w, i) => i === Math.floor(f.length / 2) ? garble(w) : w).join(" ");
  const g2 = f.slice(); const a = pick(g2); g2[a] = garble(g2[a]);
  let b = pick(g2); g2[b] = garble(g2[b]);
  out.garble2 = g2.join(" ");
  out.drop = f.filter((_, i) => i !== Math.floor(f.length / 3)).join(" ");
  out.midline = f.slice(Math.floor(f.length * 0.4)).join(" ");
  const mg = f.slice(); const mi = Math.floor(mg.length / 2) - 1;
  out.merge = mg.slice(0, mi).concat([mg[mi] + mg[mi + 1]], mg.slice(mi + 2)).join(" ");
  out.garble_drop_mid = f.slice(1).filter((_, i) => i !== 2)
    .map((w, i) => i === 1 ? garble(w) : w).join(" ");
  return out;
}

const stats = {};
const failures = [];
let totalMs = 0, queries = 0;

for (const p of samples) {
  const vs = variants(p);
  for (const [kind, q] of Object.entries(vs)) {
    const s = Date.now();
    const res = matcher.search(q, 10);
    totalMs += Date.now() - s; queries++;
    const rank = res.findIndex(r => r.id === p.id);
    stats[kind] = stats[kind] || { n: 0, top1: 0, top5: 0, top10: 0 };
    stats[kind].n++;
    if (rank === 0) stats[kind].top1++;
    if (rank >= 0 && rank < 5) stats[kind].top5++;
    if (rank >= 0) stats[kind].top10++;
    if (rank < 0 || rank >= 5) {
      failures.push({ kind, ang: p.a, line: p.l, rank: rank === -1 ? "miss" : rank + 1,
        text: p.t, query: q,
        top: res.slice(0, 3).map(r => `Ang ${r.ang}: ${r.text} (${r.score})`) });
    }
  }
}

let TN = 0, T1 = 0, T5 = 0;
console.log("\nkind              n  top1  top5  top10");
for (const [kind, s] of Object.entries(stats)) {
  console.log(`${kind.padEnd(18)} ${String(s.n).padStart(2)}  ${s.top1}    ${s.top5}    ${s.top10}`);
  TN += s.n; T1 += s.top1; T5 += s.top5;
}
console.log(`\nOVERALL: n=${TN} top1=${(100*T1/TN).toFixed(1)}% top5=${(100*T5/TN).toFixed(1)}% avg ${(totalMs/queries).toFixed(0)} ms/query`);
console.log(`\nFAILURES outside top5: ${failures.length}`);
for (const f of failures.slice(0, 12)) {
  console.log(`\n[${f.kind}] true Ang ${f.ang} line ${f.line} rank=${f.rank}\n  true: ${f.text}\n  query: ${f.query}\n  got:  ${f.top.join("\n        ")}`);
}
