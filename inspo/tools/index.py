#!/usr/bin/env python3
"""Regenerate inspo/INDEX.md from tools/annotations.json + each post's meta.json. Run from the repo root."""
import json, os
ROOT = os.path.join(os.path.dirname(__file__), "..")
A = json.load(open(os.path.join(ROOT, "tools", "annotations.json")))
meta = lambda acc, c: json.load(open(os.path.join(ROOT, acc, c, "meta.json")))
out = ["# inspo — reference posts from the swipe-file accounts", "",
"Captured 2026-09-14 from the 20 accounts in the owner's swipe file (artifact ff5fe15d). Every slide of every carousel; one file for single-image posts. Use this folder when judging a new deck: find the nearest form in the table, open its `sheet.jpg`, and compare at phone size.", "",
"Forms use the vocabulary from `docs/audit/01-references.md`: **one-liner**, **number**, **exhibit**, **numbered teaching poster**, **product proof**, **picture owns the frame**, **close as an arrival** (plus list, quote, tweet, comparison, promo where useful).", "",
"| account | posts | slides |", "|---|---|---|"]
tp = total = 0
for acc in sorted(A):
    codes = [c for c in A[acc] if not c.startswith("_")]
    n = sum(meta(acc, c)["slides"] for c in codes)
    out.append(f"| [{acc}](#{acc}) | {len(codes)} | {n} |"); total += n; tp += len(codes)
out += [f"| **total** | **{tp}** | **{total}** |", ""]
for acc in sorted(A):
    out += [f"## {acc}", "", f"_{A[acc]['_about']}_", "", "| post | slides | forms | what to copy |", "|---|---|---|---|"]
    for c, (title, forms, why) in ((c, v) for c, v in A[acc].items() if not c.startswith("_")):
        m = meta(acc, c); vid = " · video" if m.get("video") else ""
        out.append(f"| [{title}]({acc}/{c}/sheet.jpg) ([post](https://www.instagram.com/p/{c}/)) | {m['slides']}{vid} | {forms} | {why} |")
    out.append("")
open(os.path.join(ROOT, "INDEX.md"), "w").write("\n".join(out))
print(tp, "posts", total, "slides")
