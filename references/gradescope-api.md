# Gradescope requests and page data

Everything here was observed in a real Gradescope session on a PDF-template assignment. All requests go to `https://www.gradescope.com`, use the signed-in session cookie, and send these headers: `accept: application/json, text/javascript, */*; q=0.01`, `content-type: application/json`, `x-requested-with: XMLHttpRequest`, and `x-csrf-token` taken from `<meta name="csrf-token">` on the page. Never hard-code or print a token.

## Outline (page: `/courses/{cid}/assignments/{aid}/outline/edit`)

- Saved state is embedded as JSON in the `data-react-props` attribute of `[data-react-class="AssignmentOutline"]`. Keys used: `assignment.id_regions` (name, sid), `assignment.title`, `outline` (array of questions with `title`, `weight` as a string, `crop_rect_list`, `children`).
- Save: `PATCH /courses/{cid}/assignments/{aid}/outline/` with body `{"assignment":{"identification_regions":{"name":rect|null,"sid":rect|null}},"question_data":[{title, weight, crop_rect_list:[rect], children:[...]}]}`. A successful save returns 200 with a JSON path to the rubric editor. The save replaces the whole outline.
- A rect is `{x1,x2,y1,y2,page_number}` in percent of that page's width and height from the top-left; `page_number` is 1-based.
- Subquestions could not be nested under subquestions in the editor.

## Rubric (page: `/courses/{cid}/assignments/{aid}/rubric/edit`)

- Page data: `JSON.parse(document.querySelector('[data-react-class="AssignmentRubric"]').dataset.reactProps)`. Keys used: `course.id`, `questions` (tree; each has `id`, `full_index` such as "1.1", `title`, `weight`, `scoring_type`, `floor`, `ceiling`, `children`), `rubric_items` (`id`, `description`, `weight` as a string, `position`, `group_id`, `question_id`), `rubric_item_groups` (`id`, `position`, `description`, `mutually_exclusive`, `question_id`).
- There is no GET for rubric items (`GET /courses/{cid}/questions/{qid}/rubric_items` returns 404); read the page data instead. Re-fetch the page HTML after writes to get new ids.
- Every question starts with a default item "Correct" at weight 0.
- Weights are stored as positive numbers whatever the scoring type; the question's `scoring_type` decides whether items add or deduct. The values are `negative` (subtract points) and `positive` (add points).

Requests (`{qid}` is the question id from the page data):

| Purpose | Request |
| --- | --- |
| Create item | `POST /courses/{cid}/questions/{qid}/rubric_items` body `{"rubric_item":{"description":"...","weight":"1","group_id":null or gid}}` |
| Edit item | `PUT .../rubric_items/{id}` body `{"id":id,"description":"..."}` or `{"id":id,"weight":"2"}`. Send one field per request. |
| Delete item | `DELETE .../rubric_items/{id}` (no body) |
| Reorder | `PATCH /courses/{cid}/questions/{qid}/rubric/update_entries` body `{"question_id":qid,"rubric_items":{"<id>":{"position":n}},"rubric_item_groups":{"<gid>":{"position":n}}}`. Ungrouped items and groups share one position sequence; items inside a group are numbered within the group. |
| Scoring type | `POST .../questions/{qid}/save_grading_options` body `{"question":{"id":qid,"scoring_type":"negative","ceiling":"1","floor":"1"}}`. `ceiling` and `floor` are "1" when the option is on and "0" when off; the script sends each question's current values. |
| Create group (with its first item) | `POST .../questions/{qid}/rubric/create_group_with_items` body `{"rubric_item_group":{"description":"..."},"rubric_items":[{"description":"...","weight":"0"}]}`. The response is not used; the new group id is found by re-reading the page data. |
| Rename group | `PUT .../questions/{qid}/rubric_item_groups/{gid}` body `{"id":gid,"description":"..."}` |
| Add item to group | create-item request with `"group_id": gid` |
| Move item into or out of a group | `PUT .../rubric_items/{id}` body `{"id":id,"group_id":gid}` (`null` to take it out of its group). The editor also sends two `update_entries` requests around this call to set positions; the script moves first and fixes the order afterwards. |
| Delete group | `DELETE .../questions/{qid}/rubric_item_groups/{gid}` (no body), followed by an `update_entries` request that renumbers the remaining entries. The script deletes the group's items first, then the group. |
| Set a group's selection style | `PUT .../rubric_item_groups/{gid}` body `{"id":gid,"mutually_exclusive":true}` (`false` for pick-any) |


## Behaviour of the userscript's rubric sync (per question listed in the file)

1. Scoring type changed if `scoring_type` is given and differs.
2. Groups matched by name; leftover groups paired in order and renamed; new groups created; existing groups missing from the file are deleted together with their items, only if the caller allows deletion (the remaining entries are then renumbered).
3. Items matched against the question's existing items: identical in the same place stays; same description in the same place gets its weight edited; the same item in another place (another group, or ungrouped) is moved (and its weight edited if it differs); what is left in the same place is paired in order and edited; extra file items are created; surplus existing items are deleted only if the caller allows deletion. Items listed in a group that is new to the question are created with the group, not moved.
4. Order fixed last, against freshly read data, writing only when the relative order differs.

Questions not listed in the file are untouched.
