# Turning an answer key into rubric items

## Questions to ask the user (AskUserQuestion; skip any the key already answers)

1. **Scoring type.** Subtract points (start from full marks, deduct per mistake; Gradescope value `negative`) or add points (start from zero; `positive`)? The questions already show which one is set; ask before changing it. Import changes it when the file's `scoring_type` differs.
2. **Partial credit.** Fixed tiers per question (for example full, half, none), or per-mistake deductions? Is there a floor at zero and a cap at the question's points?
3. **Default item.** Keep the "Correct" item (weight 0 under subtract scoring)? Rubric import deletes any existing item not listed in the file, so "Correct" must be listed if it should stay.
4. **Groups.** Should related deductions be grouped (for example "Syntax errors")? Should a group be mutually exclusive (graders pick at most one item)?
5. **Question types that need a convention:** multiple choice (one item "Incorrect or blank"), code (common mistakes as deductions), short answer (key ideas as items), matching and fill-in-the-blank (per-blank items).
6. **Scope:** all questions, or only some? (Questions left out of the file are not touched.)
7. **Existing rubric:** if the assignment already has items, should they be kept, extended, or replaced? Export first and show the difference.

## Writing good items

- One item = one gradable observation a grader can apply in seconds ("Missing semicolon after statement"), not an essay.
- Under subtract scoring, weights are the points deducted; no item should deduct more than the question is worth, and the largest combination of non-exclusive items should not be able to push the score below zero (the floor handles that, but flag it).
- Under add scoring, the items that can all apply together should sum to the question's points.
- Mutually exclusive tiers go in a group with `mutually_exclusive: true`.
- Use the wording of the answer key where possible so graders can match it quickly.
- Titles of questions in the rubric JSON must match the outline titles exactly; question numbers are positional ("1.1", "4.12").
- Weights are non-negative numbers in the JSON.
- **Formatting.** Item descriptions are rendered as Markdown with LaTeX: use backticks for code, identifiers and tags (`` `<div>` ``, `` `const x = 1;` ``), fenced blocks with a language tag (` ```java `, ` ```js `, ` ```html `, ...) for multi-line code only, so Gradescope highlights it (use backticks for anything shorter), bold or italics for emphasis, lists where helpful, and `$$x^2 + 1$$` for math. In JSON, escape backslashes (`\\frac` for `\frac`) and newlines (`\n`). Keep simple items as plain text.

## Process

1. Draft the JSON per `references/rubric.schema.json`, validate it with `scripts/check_outline.py --outline outline.json --rubric rubric.json`.
2. Show the user a readable table (question, item, points) and get approval before applying.
3. Apply (see SKILL.md). Preview first; deletions need a separate yes.
4. After applying, re-export the rubric and compare with the draft.
