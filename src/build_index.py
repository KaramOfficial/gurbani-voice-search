#!/usr/bin/env python3
"""Build the searchable pankti index for Gurbani Voice Search.

Reads all CTC-aligned Ang JSONs from
  ~/workspace/gurbani-timestamper/app_data/ang*.json
(Gursevak / Read Gurbani vishraam text — used verbatim, never substituted)
and emits into ../data/:
  vocab.json          {recite_word: [idf, [pankti_id, ...]], ...}
  shard-0001-0100.json [{"id":..,"a":ang,"l":line_idx,"t":text,
                         "f":[base-folded words],"r":[recite-folded words],
                         "s":start,"e":end}, ...]  (per 100 Angs)
  trigrams.json       {char_trigram: [pankti_id, ...], ...}  (df-capped)
  manifest.json       counts, sizes, shard list

Two fold layers, kept in lockstep with src/matcher.js:
  fold_word()   — faithful Python port of foldWord() in
                  ~/workspace/cracker-prototype/aligner-v2.js.
  recite_fold() — Gemini pre-ship fix (DESIGN.md §1.4): on top of the base
                  fold, models how pa-IN ASR actually renders recitation:
                  strip word-final ਿ/ੁ, ਯ→ਜ, ਵ→ਬ, ਟਿੱਪੀ→ਬਿੰਦੀ, pairi haha
                  stripped. Index vocab + trigrams are keyed on recite-folded
                  words; shards keep BOTH "f" (base) and "r" (recite) forms.
"""
import glob
import gzip
import json
import math
import os
import re
import unicodedata

SRC_DIR = os.path.expanduser("~/workspace/gurbani-timestamper/app_data")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
SHARD_ANGS = 100
TRIGRAM_DF_CAP = 400  # trigrams in more panktis than this are not discriminative

NUKTA_FOLD = {
    "\u0a5a": "\u0a17",  # khha -> ga
    "\u0a5b": "\u0a1c",  # za -> ja
    "\u0a59": "\u0a16",  # kha-nukta -> kha
    "\u0a5e": "\u0a2b",  # fa -> pha
    "\u0a36": "\u0a38",  # sha -> sa
    "\u0a33": "\u0a32",  # lla -> la
}
DROP_RE = re.compile(r"[\s;.,\u0964\u0965\u00ab\u00bb'\"\-:]")
DIGIT_RE = re.compile(r"[0-9\u0a66-\u0a6f]")


def fold_word(w):
    if not w:
        return ""
    t = unicodedata.normalize("NFC", str(w))
    out = []
    for ch in t:
        if ch in NUKTA_FOLD:
            ch = NUKTA_FOLD[ch]
        if ch == "\u0a71":  # addak dropped
            continue
        if DROP_RE.match(ch):
            continue
        if DIGIT_RE.match(ch):
            continue
        if ch == "\u0a1e":  # nya -> na
            ch = "\u0a28"
        if ch == "\u0a19":  # nga -> na
            ch = "\u0a28"
        out.append(ch)
    return "".join(out)


def recite_fold(f):
    """Recitation fold over an already base-folded word (see module docstring).
    MUST stay identical to reciteFold() in src/matcher.js."""
    if not f:
        return ""
    f = f.replace("\u0a4d\u0a39", "")   # pairi haha stripped
    f = f.replace("\u0a2f", "\u0a1c")   # ya -> ja
    f = f.replace("\u0a35", "\u0a2c")   # va -> ba
    f = f.replace("\u0a70", "\u0a02")   # tippi -> bindi (single nasal marker)
    if f and f[-1] in ("\u0a3f", "\u0a41"):  # final sihari / aunkar dropped
        f = f[:-1]
    return f


def trigrams_of(joined):
    if len(joined) < 3:
        return set()
    return {joined[i:i + 3] for i in range(len(joined) - 2)}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = {}
    for path in glob.glob(os.path.join(SRC_DIR, "ang*.json")):
        m = re.search(r"ang(\d+)\.json$", path)
        if m:
            files[int(m.group(1))] = path
    angs = sorted(files)
    print(f"source angs: {len(angs)} ({angs[0]}..{angs[-1]})")

    panktis = []          # global, in ang/line order
    df = {}               # recite word -> number of panktis containing it
    postings = {}         # recite word -> [pankti ids]
    tri_postings = {}     # trigram -> [pankti ids]
    total_words = 0

    for ang in angs:
        with open(files[ang], encoding="utf-8") as fh:
            data = json.load(fh)
        for li, line in enumerate(data.get("lines", [])):
            words_src = [w["word"] for w in line.get("words", [])]
            if not words_src and line.get("text"):
                words_src = line["text"].split()
            folded, recited = [], []
            for w in words_src:
                f = fold_word(w)
                if not f:
                    continue
                r = recite_fold(f)
                if not r:
                    continue
                folded.append(f)
                recited.append(r)
            if not recited:
                continue
            pid = len(panktis)
            panktis.append({
                "id": pid,
                "a": ang,
                "l": li,
                "t": line.get("text", ""),
                "f": folded,
                "r": recited,
                "s": line.get("start"),
                "e": line.get("end"),
            })
            total_words += len(recited)
            for fw in set(recited):
                df[fw] = df.get(fw, 0) + 1
                postings.setdefault(fw, []).append(pid)
            for tg in trigrams_of("".join(recited)):
                tri_postings.setdefault(tg, []).append(pid)

    n = len(panktis)
    tri_total = len(tri_postings)
    tri_postings = {t: ids for t, ids in tri_postings.items()
                    if len(ids) <= TRIGRAM_DF_CAP}
    print(f"panktis: {n}  words: {total_words}  recite vocab: {len(df)}")
    print(f"trigrams: {tri_total} distinct, {len(tri_postings)} kept "
          f"(df <= {TRIGRAM_DF_CAP}), "
          f"{sum(len(v) for v in tri_postings.values())} postings")

    def dump(obj, name):
        raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with open(os.path.join(OUT_DIR, name), "wb") as fh:
            fh.write(raw)
        gz = len(gzip.compress(raw, 9))
        print(f"{name}: {len(raw)/1e6:.2f} MB raw, {gz/1e6:.2f} MB gz")
        return {"file": name, "raw": len(raw), "gz": gz}

    stats = []
    vocab = {w: [round(math.log(1 + n / df[w]), 4), postings[w]] for w in sorted(df)}
    stats.append(dump(vocab, "vocab.json"))
    stats.append(dump({t: tri_postings[t] for t in sorted(tri_postings)},
                      "trigrams.json"))

    shards = []
    for lo in range(1, angs[-1] + 1, SHARD_ANGS):
        hi = min(lo + SHARD_ANGS - 1, angs[-1])
        rows = [p for p in panktis if lo <= p["a"] <= hi]
        if not rows:
            continue
        name = f"shard-{lo:04d}-{hi:04d}.json"
        info = dump(rows, name)
        shards.append({**info, "ang_from": lo, "ang_to": hi, "panktis": len(rows)})
        stats.append(info)

    total_raw = sum(s["raw"] for s in stats)
    total_gz = sum(s["gz"] for s in stats)
    manifest = {
        "source": "gurbani-timestamper/app_data/ang*.json (Gursevak vishraam text, CTC-aligned)",
        "angs": len(angs),
        "panktis": n,
        "words": total_words,
        "vocab_words": len(df),
        "trigrams": len(tri_postings),
        "trigram_df_cap": TRIGRAM_DF_CAP,
        "total_raw_bytes": total_raw,
        "total_gz_bytes": total_gz,
        "files": stats,
        "shards": shards,
    }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"TOTAL: {total_raw/1e6:.2f} MB raw, {total_gz/1e6:.2f} MB gz")
    print("manifest.json written")


if __name__ == "__main__":
    main()
