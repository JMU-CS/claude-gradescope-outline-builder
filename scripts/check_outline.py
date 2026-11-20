#!/usr/bin/env python3
"""Validate a Gradescope outline (and optionally rubric) JSON, check point sums, and draw
every answer box on the exam pages so the placement can be inspected by eye.

Usage:
  python check_outline.py --outline outline.json [--rubric rubric.json] \
      [--pdf exam.pdf --out preview_dir] [--total 100]

Requires: jsonschema (pip install jsonschema --break-system-packages).
For previews also: pdftoppm (poppler) and Pillow.
Exit status is 1 if anything is invalid or inconsistent.
"""
import argparse, json, os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFS = HERE.parent / "references"


def load(p):
    return json.loads(Path(p).read_text())


def validate(data, schema_path, label, problems):
    import jsonschema
    v = jsonschema.Draft202012Validator(load(schema_path))
    for e in sorted(v.iter_errors(data), key=lambda e: list(e.path)):
        problems.append(f"{label}: {'/'.join(map(str, e.path)) or '<root>'}: {e.message}")


def walk(qs):
    for q in qs:
        yield q
        yield from walk(q.get("children", []))


def check_outline(outline, total, problems, notes):
    qd = outline["question_data"]
    for q in walk(qd):
        kids = q.get("children")
        if kids:
            s = round(sum(c["weight"] for c in kids), 6)
            if abs(s - q["weight"]) > 1e-6:
                problems.append(f"outline: '{q['title']}' weight {q['weight']} != sum of children {s}")
            for c in kids:
                if c.get("children"):
                    problems.append(f"outline: '{c['title']}' has children; only one level of subquestions is supported")
        for r in q.get("crop_rect_list", []):
            if not (r["x1"] < r["x2"] and r["y1"] < r["y2"]):
                problems.append(f"outline: '{q['title']}' has an empty/inverted box {r}")
    t = round(sum(q["weight"] for q in qd), 6)
    notes.append(f"outline: {len(qd)} questions, {sum(1 for _ in walk(qd))} total entries, {t} points")
    if total is not None and abs(t - total) > 1e-6:
        problems.append(f"outline: total {t} != expected {total}")
    # overlapping leaf boxes on the same page (a common placement mistake)
    leaves = [q for q in walk(qd) if not q.get("children")]
    boxes = [(q["title"], r) for q in leaves for r in q["crop_rect_list"]]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (ta, a), (tb, b) = boxes[i], boxes[j]
            if a["page_number"] != b["page_number"]:
                continue
            ox = min(a["x2"], b["x2"]) - max(a["x1"], b["x1"])
            oy = min(a["y2"], b["y2"]) - max(a["y1"], b["y1"])
            if ox > 0.5 and oy > 0.5:
                notes.append(f"overlap: '{ta}' and '{tb}' on page {a['page_number']} ({ox:.1f}% x {oy:.1f}%)")


def check_rubric(rubric, outline, problems, notes):
    weights = {}
    if outline:
        # Gradescope numbers questions by position: 1, 1.1, 1.2, 2, ...
        for i, q in enumerate(outline["question_data"], 1):
            weights[str(i)] = (q["title"], q["weight"])
            for j, c in enumerate(q.get("children", []), 1):
                weights[f"{i}.{j}"] = (c["title"], c["weight"])
    seen = set()
    for e in rubric["questions"]:
        n = e["question"]
        if n in seen:
            problems.append(f"rubric: question {n} listed twice")
        seen.add(n)
        if n in weights:
            title, w = weights[n]
            if "title" in e and e["title"] != title:
                problems.append(f"rubric: {n} title '{e['title']}' != outline title '{title}'")
            flat = []
            for it in e["items"]:
                flat += it["items"] if "items" in it else [it]
            if e.get("scoring_type", "negative") == "negative":
                big = [x for x in flat if x["weight"] > w + 1e-9]
                for x in big:
                    problems.append(f"rubric: {n} item '{x['description']}' deducts {x['weight']} > question points {w}")
        elif outline:
            problems.append(f"rubric: no question numbered {n} in the outline")
    notes.append(f"rubric: {len(rubric['questions'])} question(s) with rubric items")


def preview(pdf, outline, outdir):
    from PIL import Image, ImageDraw
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftoppm", "-r", "70", "-png", str(pdf), str(outdir / "page")], check=True)
    pages = sorted(outdir.glob("page-*.png"))
    imgs = {i + 1: Image.open(p).convert("RGB") for i, p in enumerate(pages)}
    colors = [(220, 50, 50), (40, 120, 220), (30, 160, 80), (200, 120, 20), (140, 60, 190)]
    k = 0
    for q in walk(outline["question_data"]):
        if q.get("children"):
            continue
        for r in q["crop_rect_list"]:
            im = imgs.get(r["page_number"])
            if im is None:
                continue
            W, H = im.size
            box = [r["x1"] / 100 * W, r["y1"] / 100 * H, r["x2"] / 100 * W, r["y2"] / 100 * H]
            d = ImageDraw.Draw(im)
            c = colors[k % len(colors)]
            d.rectangle(box, outline=c, width=2)
            d.text((box[0] + 3, box[1] + 1), q["title"][:40], fill=c)
            k += 1
    written = []
    for n, im in imgs.items():
        f = outdir / f"overlay-{n:02d}.png"
        im.save(f)
        written.append(str(f))
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outline")
    ap.add_argument("--rubric")
    ap.add_argument("--pdf")
    ap.add_argument("--out", default="preview")
    ap.add_argument("--total", type=float, help="expected total points of the exam")
    a = ap.parse_args()
    problems, notes = [], []
    outline = rubric = None
    if a.outline:
        outline = load(a.outline)
        validate(outline, REFS / "outline.schema.json", "outline", problems)
        if not problems:
            check_outline(outline, a.total, problems, notes)
    if a.rubric:
        rubric = load(a.rubric)
        validate(rubric, REFS / "rubric.schema.json", "rubric", problems)
        if "questions" in rubric and not any(p.startswith("rubric:") for p in problems):
            check_rubric(rubric, outline, problems, notes)
    if a.pdf and outline and not problems:
        notes.append("overlays: " + ", ".join(preview(a.pdf, outline, a.out)))
    for n in notes:
        print("note:", n)
    for p in problems:
        print("PROBLEM:", p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
