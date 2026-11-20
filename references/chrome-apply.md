# Applying and exporting with Claude in Chrome

The userscript doubles as the library: running its source in the page defines `window.gradescopeTools` (it also adds the buttons; harmless). The functions below never show dialogs and never reload the page, so confirm with the user in chat first.

## One-time setup per page load

1. Make sure the tab is on the right page: `.../outline/edit` for outlines, `.../rubric/edit` for rubrics. Navigate there if not.
2. Check `typeof window.gradescopeTools`. If it is `undefined`, read `scripts/gradescope_outline_import.user.js` and run its full text with `javascript_tool` once (it is an IIFE; run it unchanged).

## Run code with javascript_tool, return summaries only

The tool blocks output that looks like cookies or tokens, so return counts and short strings, never raw response bodies. Top-level `await` works.

Export (read-only):

```js
const r = await window.gradescopeTools.getOutline();   // outline page; r.json is the payload
JSON.stringify(r.json)                                 // contains no tokens
```

```js
JSON.stringify(window.gradescopeTools.getRubric().json)  // rubric page, synchronous
```

Preview a rubric import (read-only; show the user this before applying):

```js
const DATA = /* rubric JSON object */ {};
JSON.stringify(window.gradescopeTools.previewRubric(DATA))
// { adds, newGroups, edits, scoringChanges[], deletions[], reorders, unchanged, problems[] }
```

Apply a rubric (writes; only after the user agrees to the preview). Deletions (items, and groups together with their items) only happen when `deleteMissing` is true; set it only after a separate explicit yes naming what will be deleted (`previewRubric(...).deletions` lists it):

```js
const DATA = /* rubric JSON object */ {};
const res = await window.gradescopeTools.applyRubric(DATA, { deleteMissing: false });
JSON.stringify(res)
```

Apply an outline (writes; REPLACES the whole outline; only after an explicit yes that states the question count):

```js
const DATA = /* outline JSON object */ {};
JSON.stringify(await window.gradescopeTools.applyOutline(DATA))
```

## Afterwards

1. Reload the page.
2. Outline: screenshot the pages with boxes and check a few against the exam. Renaming or restructuring questions in the outline can change their numbering, which the rubric import relies on, so re-export before writing a rubric.
3. Rubric: re-export (`getRubric`) and compare with what was intended; report differences.
4. If a call throws, report the message exactly (it names the request that failed) and stop. Do not retry writes blindly; the page may be half-updated, so re-export first.

## Passing large JSON

Embed the JSON literal directly in the `javascript_tool` text. If it is very large, split by question into several `applyRubric` calls (each with a subset of `questions`); questions not listed are untouched.
