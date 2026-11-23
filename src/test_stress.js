/* Harder stress test: short fragments + whole-word substitutions.
 * A hit counts if the returned pankti has the SAME folded text as the source
 * (refrain duplicates on other Angs are correct answers, not failures);
 * exact-id hit rate is reported alongside.
 * Run: node src/test_stress.js
 */
"use strict";
const path = require("path");
const { Matcher } = require("./matcher.js");
const matcher = Matcher.loadFromDir(path.join(__dirname, "..", "data"));

let seed = 7;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

const eligible = matcher.panktis.filter(p => p && p.f.length >= 7);
const vocabWords = Object.keys(matcher.vocab).filter(w => matcher.vocab[w][1].length > 20);
const SAMPLES = 30;
const samples = [];
for (let i = 0; i < SAMPLES; i++) samples.push(eligible[Math.floor(i * eligible.length / SAMPLES)]);

function garble(word) {
  if (word.length < 3) return word;
  const chars = Array.from(word);
  const i = 1 + Math.floor(rnd() * (chars.length - 1));
  chars.splice(i, 1); // drop a character entirely — harsher drift
  return chars.join("");
}
function substitute(word) { // recognizer replaces word with a different real word
  return vocabWords[Math.floor(rnd() * vocabWords.length)];
}

function variants(p) {
  const f = p.f;
  const mid = Math.floor(f.length / 2);
  return {
    short3: f.slice(mid, mid + 3).join(" "),
    short4_garble: f.slice(mid - 1, mid + 3).map((w, i) => i === 1 ? garble(w) : w).join(" "),
    subst1: f.map((w, i) => i === mid ? substitute(w) : w).join(" "),
    subst1_garble1_drop1: f.filter((_, i) => i !== 1)
      .map((w, i) => i === 2 ? substitute(w) : i === 4 ? garble(w) : w).join(" "),
    short5_subst1: f.slice(1, 6).map((w, i) => i === 2 ? substitute(w) : w).join(" "),
  };
}

const stats = {}; const failures = [];
for (const p of samples) {
  const key = p.f.join(" ");
  for (const [kind, q] of Object.entries(variants(p))) {
    const res = matcher.search(q, 10);
    const rankText = res.findIndex(r => r.text && matcher.panktis[r.id].f.join(" ") === key);
    const rankId = res.findIndex(r => r.id === p.id);
    stats[kind] = stats[kind] || { n: 0, t1: 0, t5: 0, id1: 0 };
    const s = stats[kind]; s.n++;
    if (rankText === 0) s.t1++;
    if (rankText >= 0 && rankText < 5) s.t5++;
    if (rankId === 0) s.id1++;
    if (rankText < 0 || rankText >= 5) failures.push({ kind, ang: p.a, rank: rankText, text: p.t, query: q,
      top: res.slice(0, 2).map(r => `Ang ${r.ang}: ${r.text} (${r.score})`) });
  }
}
let TN = 0, T1 = 0, T5 = 0;
console.log("kind                n  top1(text) top5(text) top1(exact-id)");
for (const [k, s] of Object.entries(stats)) {
  console.log(`${k.padEnd(20)} ${String(s.n).padStart(2)}   ${s.t1}         ${s.t5}         ${s.id1}`);
  TN += s.n; T1 += s.t1; T5 += s.t5;
}
console.log(`OVERALL n=${TN} top1=${(100*T1/TN).toFixed(1)}% top5=${(100*T5/TN).toFixed(1)}%`);
console.log(`\nfailures outside top5: ${failures.length}`);
for (const f of failures.slice(0, 10)) console.log(`\n[${f.kind}] true Ang ${f.ang} rank=${f.rank === -1 ? "miss" : f.rank + 1}\n  true: ${f.text}\n  query: ${f.query}\n  got: ${f.top.join(" | ")}`);
