---
name: gradescope-outline-builder
description: Build a Gradescope assignment outline (questions, points, answer boxes) from an exam PDF, and rubric items from an answer key, as JSON that can be imported into Gradescope. Use when the user has an exam PDF or answer key and wants to set up a Gradescope outline or rubric.
---

# Gradescope outline and rubric builder

Turn an exam PDF into an outline JSON (question names, point values, subquestion grouping, answer-box rectangles). Optionally turn an answer key (PDF, Word, text, or the user's own rubric notes) into a rubric JSON. Then apply both to Gradescope, either with the userscript the user installs or by running the same code through Claude in Chrome.

Bundled files (read them when needed, do not paste them into the conversation):

- `references/outline.schema.json`, `references/rubric.schema.json`: the JSON formats.
- `references/gradescope-api.md`: what is known about Gradescope's requests and page data, and what is NOT verified.
- `references/rubric-guidelines.md`: how to turn an answer key into good rubric items, and what to ask the user.
- `references/chrome-apply.md`: exact steps for applying or exporting through Claude in Chrome.
- `scripts/gradescope_outline_import.user.js`: the userscript (also the code Claude in Chrome runs).
- `scripts/check_outline.py`: validates the JSON, checks point sums, and draws every box on the exam pages for a visual check.
- `examples/exam1_outline.json`, `examples/rubric_example.json`: a real 100-point outline and a small, illustrative rubric (not a real answer key).

## Part 1: outline from the exam PDF

1. **Read the whole exam first.** Get the PDF; confirm it is the same file used as the Gradescope template (same pages, same order). Pages are numbered from 1 including any cover page, and `page_number` in the JSON uses that numbering.
2. **Measure positions from the PDF, not by eye.** Use pdfplumber (words, lines, rects, curves) to get exact positions of table borders, answer lines, checkboxes and bubbles, and convert to percent: `x / page.width * 100`, `y / page.height * 100` (top-left origin). Also render pages to PNG and look at them to understand the layout.
3. **Ask about anything the exam leaves open** (AskUserQuestion, one batch of up to four questions). Typical decisions:
   - Point splits where only a question total is printed: even split, or the user's own numbers? Flag fractional results (5 pts over 10 parts is 0.5).
   - Grouping: one box per part or one box for a whole question? For tables, one box per row, or separate boxes for different columns (for example a free-text column and a bubble column)?
   - Bubble and multiple-choice questions: box the bubbles only, or bubbles plus option text? (Default: bubbles plus option text.)
   - Naming style for parts (short and descriptive, for example "Match 3: news story").
   - The name region on the cover page (and whether there is a student ID region).
   - Mismatch between printed totals and the sum of parts: show the arithmetic and ask which part absorbs the difference. Never invent points silently.

   If the session is unattended, choose the most reasonable default, say so at the top of the reply, and continue.
4. **Build the JSON** following `references/outline.schema.json`. Rules that matter:
   - One level of subquestions under each top-level question; deeper nesting is not supported.
   - A parent's weight equals the sum of its children. A parent's `crop_rect_list` may be omitted (the importer copies the first child's).
   - Titles do not include numbers; Gradescope numbers by position (1, 1.1, 1.2, ...).
   - Inset boxes slightly inside the cell or line (about 0.2 percent) so neighbours do not overlap; keep every rectangle within 0 to 100 with `x1 < x2` and `y1 < y2`.
   - Order questions as they appear on the exam.
5. **Check before delivering:** run `python scripts/check_outline.py --outline outline.json --pdf exam.pdf --out preview --total <exam total>`. Fix every problem it reports, then look at the overlay PNGs (required: text-derived coordinates can still land on the wrong line). Write the JSON to the outputs folder and deliver it with a short note of the choices made.

## Part 2: rubric from an answer key (optional)

Only start this once the outline exists in Gradescope (rubric questions are matched by their number and title). Read `references/rubric-guidelines.md`, then:

1. Read the answer key and, if present, any rubric the user already wrote.
2. Ask the user the partial-credit and scoring questions listed in the guidelines (scoring type, how to treat partial credit, whether to group related deductions, whether to keep the default "Correct" item).
3. Use Markdown and LaTeX (`$$ ... $$`) in item descriptions where it helps (code in backticks, math in `$$`; a fenced block with a language tag such as ` ```java ` only for multi-line code), escaping backslashes in JSON.
4. Draft `rubric.json` per `references/rubric.schema.json`, validate it with `check_outline.py --outline ... --rubric ...`, and show the user a readable summary (question, items, points) before applying anything.

## Applying to Gradescope

Offer both options.

**Option A: userscript.** Give the user `scripts/gradescope_outline_import.user.js` to install in Tampermonkey or Violentmonkey. On the outline edit page it adds Export and Import outline buttons under the sidebar heading; on the rubric edit page it adds Export and Import rubric buttons under the page heading. Imports show a summary and ask for confirmation. Rubric import can change scoring type, create and delete groups, move items between groups, edit, delete and reorder.

**Option B: Claude in Chrome.** Follow `references/chrome-apply.md`. Non-negotiable rules:

- Applying an outline REPLACES the whole saved outline. Applying a rubric can ADD, EDIT, MOVE and DELETE items and groups (an unlisted group is deleted with its items). State what will change (counts, and any deletions by name) and get a clear yes before running anything that writes. Deletions need their own explicit yes.
- Export the current outline or rubric first if the assignment already has work in it, and offer the user that backup.
- The CSRF token is read from the page by the code. Never ask the user to paste a token and never print one.
- After a write, reload the page and verify (screenshot a few pages of boxes, or re-export the rubric and compare).

## Known limits

- Only tested on PDF-template assignments. Online, bubble-sheet and variable-length assignments may behave differently.
- Items listed under a brand-new group are created with that group; existing items are not moved into a group that does not exist yet.
- Applying an outline restructures questions, so re-export before writing a rubric: the rubric import finds questions by their number and title.
- See `references/gradescope-api.md` for the requests the script sends and the page data it reads.
