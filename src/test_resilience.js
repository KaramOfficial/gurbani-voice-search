/* Resilience test for matcher.js — owner-reported field failure patterns
 * (2026-11-25, docs/RESILIENCE-FIX.md):
 *   - extra/confused word inserted (incl. the NEXT pankti's first word
 *     bleeding in — the "fareeda" case, Ang 1382)
 *   - rotation (recitation starts mid-line and wraps — Ang 156 case)
 *   - adjacent swap and half-line (kirtan chunk) reorder
 * Named cases assert top-1; generated cases report top-1 / top-5.
 * Run: node src/test_resilience.js
 */
"use strict";
const path = require("path");
const { Matcher } = require("./matcher.js");

const matcher = Matcher.loadFromDir(path.join(__dirname, "..", "data"));

let pass = 0, fail = 0;
function named(label, q, ang) {
  const res = matcher.search(q, 10);
  const rank = res.findIndex(r => r.ang === ang);
  const ok = rank === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} :: "${q}" -> Ang ${ang} rank ${rank < 0 ? "miss" : rank + 1} score ${rank >= 0 ? res[rank].score : "-"}`);
  if (ok) pass++; else fail++;
}

// --- the owner's exact cases ---
named("clean roman", "aap sawaaryai main mila", 1382);
named("next-line word prepended (roman)", "fareeda aap sawaaryai main mila", 1382);
named("next-line word prepended (gurmukhi)", "ਫਰੀਦਾ ਆਪੁ ਸਵਾਰਹਿ ਮੈ ਮਿਲਹਿ", 1382);
named("extra word middle (roman)", "aap sawaaryai fareeda main mila", 1382);
named("extra word end (roman)", "aap sawaaryai main mila fareeda", 1382);
named("in order (roman)", "man eko sahib bhai re", 156);
named("rotated (roman)", "bhai re man eko sahib", 156);
named("rotated (gurmukhi)", "ਭਾਈ ਰੇ ਮਨ ਏਕੋ ਸਾਹਿਬੁ", 156);
named("adjacent swap (roman)", "man sahib eko bhai re", 156);
named("kirtan half-swap (roman)", "main mila aap sawaaryai", 1382);
named("bleed + weak transliteration (sawarehe)", "fareeda aap sawarehe main mila", 1382);

// --- generated cases over sampled panktis ---
let seed = 7;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
const byId = {};
matcher.panktis.forEach(p => { if (p) byId[p.id] = p; });
const eligible = matcher.panktis.filter(p => p && p.f.length >= 6);
const SAMPLES = 24;
const samples = [];
for (let i = 0; i < SAMPLES; i++) samples.push(eligible[Math.floor(i * eligible.length / SAMPLES)]);

function variants(p) {
  const f = p.f.slice(); // base-folded words (query in clean Gurmukhi form)
  const out = {};
  const next = byId[p.id + 1];
  if (next && next.a === p.a && next.f.length) out.nextLineBleed = [next.f[0]].concat(f.slice(0, 5)).join(" ");
  const prev = byId[p.id - 1];
  if (prev && prev.a === p.a && prev.f.length) out.prevLineBleed = prev.f.slice(-1).concat(f.slice(0, 5)).join(" ");
  if (prev && prev.a === p.a && prev.f.length >= 2) out.prevLineBleed2 = prev.f.slice(-2).concat(f.slice(0, 5)).join(" ");
  const other = eligible[Math.floor(rnd() * eligible.length)];
  out.insertWord = f.slice(0, 2).concat([other.f[1] || other.f[0]], f.slice(2, 5)).join(" ");
  out.rotate2 = f.slice(2).concat(f.slice(0, 2)).join(" ");
  out.wrapFront = f.slice(-2).concat(f.slice(0, -2)).join(" ");
  const mid = Math.floor(f.length / 2);
  out.halfSwap = f.slice(mid).concat(f.slice(0, mid)).join(" ");
  const sw = f.slice(); const t = sw[1]; sw[1] = sw[2]; sw[2] = t;
  out.adjSwap = sw.join(" ");
  out.repeatWord = f.slice(0, 3).concat([f[2]], f.slice(3)).join(" ");
  return out;
}

const stats = {};
for (const p of samples) {
  const vs = variants(p);
  for (const [kind, q] of Object.entries(vs)) {
    const res = matcher.search(q, 10);
    const rank = res.findIndex(r => r.id === p.id);
    stats[kind] = stats[kind] || { n: 0, top1: 0, top5: 0 };
    stats[kind].n++;
    if (rank === 0) stats[kind].top1++;
    if (rank >= 0 && rank < 5) stats[kind].top5++;
    if (rank < 0 || rank >= 5) console.log(`  MISS [${kind}] Ang ${p.a}: "${q}" (true: ${p.t})`);
  }
}
console.log("\nkind            n  top1  top5");
let TN = 0, T1 = 0, T5 = 0;
for (const [kind, s] of Object.entries(stats)) {
  console.log(`${kind.padEnd(15)} ${String(s.n).padStart(2)}  ${String(s.top1).padStart(4)}  ${String(s.top5).padStart(4)}`);
  TN += s.n; T1 += s.top1; T5 += s.top5;
}
console.log(`\nGENERATED OVERALL: n=${TN} top1=${(100 * T1 / TN).toFixed(1)}% top5=${(100 * T5 / TN).toFixed(1)}%`);
console.log(`NAMED CASES: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
