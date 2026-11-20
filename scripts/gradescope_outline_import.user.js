// ==UserScript==
// @name         Gradescope Outline & Rubric JSON Import/Export
// @namespace    local.gradescope.outline
// @description  Outline editor: export/import the outline (questions, points, box positions) as JSON. Rubric editor: export rubric items as JSON, or import JSON to sync them (add, edit, delete, reorder).
// @match        https://www.gradescope.com/courses/*/assignments/*/outline/edit
// @match        https://www.gradescope.com/courses/*/assignments/*/rubric/edit
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  const csrf = () => document.querySelector('meta[name="csrf-token"]').content;

  function download(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function pickFile(onFile) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });
    input.click();
  }

  function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tiiBtn tiiBtn-primary';
    b.textContent = label;
    b.addEventListener('click', () => Promise.resolve(onClick()).catch((e) => alert(label + ' failed: ' + e.message)));
    return b;
  }

  // Put `bar` after the element matching `selector`, and keep it there if React re-renders.
  function mount(bar, selector) {
    function place() {
      const anchor = document.querySelector(selector);
      if (!anchor || !anchor.parentNode) return;
      if (anchor.nextSibling === bar && bar.isConnected) return;
      anchor.after(bar);
    }
    place();
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  }

  // Dark "please wait" overlay with a percentage. Returns {set(pct), close()}.
  function showOverlay(text) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2147483647;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;color:#fff;font:600 20px sans-serif;cursor:wait';
    const label = document.createElement('div');
    const pctEl = document.createElement('div');
    pctEl.style.cssText = 'font-size:40px;margin-top:12px';
    ov.append(label, pctEl);
    const api = {
      set(pct, t) {
        label.textContent = (t || text) + ' Please wait...';
        pctEl.textContent = Math.max(0, Math.min(100, Math.round(pct))) + '%';
      },
      close() { ov.remove(); },
      // Show 100% and "Reloading...", then reload after a pause so any browser prompt has context.
      async reload() {
        label.textContent = 'Done. Reloading...';
        pctEl.textContent = '100%';
        await new Promise((r) => setTimeout(r, 2000));
        location.reload();
      },
    };
    api.set(0);
    document.body.appendChild(ov);
    return api;
  }

  function makeBar(buttons) {
    const bar = document.createElement('div');
    buttons.forEach((b, i) => { if (i) bar.append(' '); bar.append(b); });
    return bar;
  }

  // ---------------------------------------------------------------- OUTLINE

  function outlineUrl() { return location.href.replace(/\/edit\/?(\?.*)?$/, '/'); }

  // Convert the page's saved-state props into the same shape the save endpoint accepts.
  function propsToOutline(props) {
    const rect = (r) => ({ x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2, page_number: r.page_number });
    const conv = (q) => {
      const o = { title: q.title, weight: Number(q.weight), crop_rect_list: (q.crop_rect_list || []).map(rect) };
      if (q.children && q.children.length) o.children = q.children.map(conv);
      return o;
    };
    const regs = props.assignment.id_regions || {};
    return {
      assignment: { identification_regions: { name: regs.name ? rect(regs.name) : null, sid: regs.sid ? rect(regs.sid) : null } },
      question_data: props.outline.map(conv),
    };
  }

  // Latest SAVED outline as JSON (re-fetches the page so it is never stale).
  async function getOutline() {
    const resp = await fetch(location.href, { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    const el = doc.querySelector('[data-react-class="AssignmentOutline"]');
    if (!el) throw new Error('could not find outline data on the page');
    const props = JSON.parse(el.getAttribute('data-react-props'));
    return { json: propsToOutline(props), name: (props.assignment.title || 'outline').replace(/[^\w.-]+/g, '_') };
  }

  async function exportOutline() {
    const ov = showOverlay('Exporting outline...');
    try {
      ov.set(10);
      const { json, name } = await getOutline();
      ov.set(100);
      download(json, name + '_outline.json');
    } finally { ov.close(); }
  }

  const countQuestions = (qs) => qs.reduce((n, q) => n + 1 + countQuestions(q.children || []), 0);

  // Replaces the whole saved outline. No dialogs; the caller is responsible for confirming.
  async function applyOutline(payload) {
    if (!payload || !payload.question_data) throw new Error('missing question_data');
    // Parents may omit crop_rect_list; copy the first child's rectangle.
    const fill = (q) => {
      (q.children || []).forEach(fill);
      if (!q.crop_rect_list && q.children && q.children.length) q.crop_rect_list = q.children[0].crop_rect_list;
    };
    payload.question_data.forEach(fill);
    const resp = await fetch(outlineUrl(), {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/json',
        'x-csrf-token': csrf(),
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error('save failed: ' + resp.status + ' ' + (await resp.text()).slice(0, 300));
    return { ok: true, questions: countQuestions(payload.question_data) };
  }

  async function importOutline(file) {
    let payload;
    try {
      payload = JSON.parse(await file.text());
      if (!payload.question_data) throw new Error('missing question_data');
    } catch (e) { alert('Could not read that JSON: ' + e.message); return; }
    if (!confirm('This REPLACES the whole saved outline with ' + countQuestions(payload.question_data) +
        ' questions from "' + file.name + '". Continue?')) return;
    const ov = showOverlay('Importing outline...');
    ov.set(10);
    try { await applyOutline(payload); } catch (e) { ov.close(); throw e; }
    await ov.reload();
  }

  // ----------------------------------------------------------------- RUBRIC

  const rubricProps = () =>
    JSON.parse(document.querySelector('[data-react-class="AssignmentRubric"]').dataset.reactProps);

  const byPos = (a, b) => a.position - b.position || a.id - b.id;

  function flattenQuestions(props) {
    const flat = {};
    const walk = (qs) => qs.forEach((q) => { flat[q.full_index] = q; walk(q.children || []); });
    walk(props.questions);
    return flat;
  }

  // Saved rubric -> JSON. A question's `items` is an ordered list of rubric items
  // ({description, weight}) and groups ({group, mutually_exclusive?, items: [...]}).
  function propsToRubric(props) {
    const items = {}; const groups = {};
    props.rubric_items.forEach((i) => { (items[i.question_id] = items[i.question_id] || []).push(i); });
    (props.rubric_item_groups || []).forEach((g) => { (groups[g.question_id] = groups[g.question_id] || []).push(g); });
    const plain = (i) => ({ description: i.description, weight: Number(i.weight) });
    const out = [];
    const walk = (qs) => qs.forEach((q) => {
      const mine = items[q.id] || [];
      const top = mine.filter((i) => i.group_id == null).map((i) => ({ k: 0, o: i }))
        .concat((groups[q.id] || []).map((g) => ({ k: 1, o: g })));
      top.sort((x, y) => x.o.position - y.o.position || x.k - y.k || x.o.id - y.o.id);
      out.push({
        question: q.full_index, title: q.title, scoring_type: q.scoring_type,
        items: top.map(({ k, o }) => {
          if (!k) return plain(o);
          const g = { group: o.description };
          if (o.mutually_exclusive) g.mutually_exclusive = true;
          g.items = mine.filter((i) => i.group_id === o.id).sort(byPos).map(plain);
          return g;
        }),
      });
      walk(q.children || []);
    });
    walk(props.questions);
    return { questions: out };
  }

  function getRubric() {
    const props = rubricProps();
    return { json: propsToRubric(props), name: (props.assignment.title || 'rubric').replace(/[^\w.-]+/g, '_') };
  }

  function exportRubric() {
    const { json, name } = getRubric();
    download(json, name + '_rubric.json');
  }

  const containerOf = (i) => (i.group_id == null ? null : i.group_id);

  // Work out what has to change so each listed question's rubric matches the file.
  // Pure function (no network) so it can be tested.
  //
  // Items are matched, in this order, against the existing items of the question:
  //   identical item in the same place -> keep
  //   same description in the same place, new weight -> update weight
  //   same item elsewhere (other group or ungrouped) -> move (and update weight if needed)
  //   remaining items in the same place -> paired in order and edited
  //   leftovers: file items are created, existing items are deleted (only if the caller allows).
  // Groups are matched by name, then leftover groups are paired in order and renamed;
  // groups that are not in the file are deleted with their items (only if the caller allows deletion).
  function planRubric(props, data) {
    const flat = flattenQuestions(props);
    const items = {}; const groups = {};
    props.rubric_items.forEach((i) => { (items[i.question_id] = items[i.question_id] || []).push(i); });
    (props.rubric_item_groups || []).forEach((g) => { (groups[g.question_id] = groups[g.question_id] || []).push(g); });

    const ops = []; const problems = []; let unchanged = 0;
    for (const entry of data.questions) {
      const q = flat[entry.question];
      if (!q) { problems.push('No question numbered ' + entry.question); continue; }
      if (entry.title !== undefined && entry.title !== q.title) {
        problems.push('Question ' + entry.question + ' is "' + q.title + '" here but "' + entry.title + '" in the file (skipped)');
        continue;
      }
      if (entry.scoring_type !== undefined && entry.scoring_type !== q.scoring_type) {
        ops.push({ type: 'scoring', q, scoring_type: entry.scoring_type, label: q.scoring_type + ' -> ' + entry.scoring_type });
      }
      const mine = items[q.id] || [];
      const wantGroups = (entry.items || []).filter((e) => Array.isArray(e.items));

      // Groups: match by name, then pair leftovers in order (rename); extras are created.
      let haveGroups = (groups[q.id] || []).slice().sort(byPos);
      const pairs = []; let leftover = [];
      for (const w of wantGroups) {
        const k = haveGroups.findIndex((g) => g.description === w.group);
        if (k >= 0) pairs.push({ g: haveGroups.splice(k, 1)[0], w }); else leftover.push(w);
      }
      leftover = leftover.filter((w) => {
        if (!haveGroups.length) return true;
        const g = haveGroups.shift();
        ops.push({ type: 'group_rename', q, id: g.id, description: w.group, label: g.description + ' -> ' + w.group });
        pairs.push({ g, w }); return false;
      });
      for (const { g, w } of pairs) {
        if (w.mutually_exclusive !== undefined && !!w.mutually_exclusive !== !!g.mutually_exclusive) {
          ops.push({ type: 'group_mutex', q, id: g.id, value: !!w.mutually_exclusive, label: w.group });
        }
      }

      // Items that can be matched: ungrouped items and items in groups that are in the file.
      const live = new Set(pairs.map((p) => p.g.id));
      let pool = mine.filter((i) => i.group_id == null || live.has(i.group_id)).sort(byPos);
      let wanted = [];
      (entry.items || []).filter((e) => !Array.isArray(e.items))
        .forEach((i) => wanted.push({ description: i.description, weight: Number(i.weight), cont: null }));
      pairs.forEach(({ g, w }) => w.items.forEach((i) => wanted.push({ description: i.description, weight: Number(i.weight), cont: g.id })));

      // 1. identical item in the same place
      wanted = wanted.filter((w) => {
        const k = pool.findIndex((e) => containerOf(e) === w.cont && e.description === w.description && Number(e.weight) === w.weight);
        if (k < 0) return true;
        pool.splice(k, 1); unchanged++; return false;
      });
      // 2. same description in the same place, new weight
      wanted = wanted.filter((w) => {
        const k = pool.findIndex((e) => containerOf(e) === w.cont && e.description === w.description);
        if (k < 0) return true;
        ops.push({ type: 'update', q, id: pool[k].id, weight: w.weight, label: w.description });
        pool.splice(k, 1); return false;
      });
      // 3. same item in another place: move it
      wanted = wanted.filter((w) => {
        let k = pool.findIndex((e) => e.description === w.description && Number(e.weight) === w.weight);
        let weightChanged = false;
        if (k < 0) { k = pool.findIndex((e) => e.description === w.description); weightChanged = k >= 0; }
        if (k < 0) return true;
        const e = pool.splice(k, 1)[0];
        ops.push({ type: 'move', q, id: e.id, groupId: w.cont, label: w.description });
        if (weightChanged) ops.push({ type: 'update', q, id: e.id, weight: w.weight, label: w.description });
        return false;
      });
      // 4. what is left in the same place is paired in order and edited
      const conts = new Set(wanted.map((w) => w.cont));
      for (const c of conts) {
        const have = pool.filter((e) => containerOf(e) === c);
        const want = wanted.filter((w) => w.cont === c);
        const n = Math.min(have.length, want.length);
        for (let i = 0; i < n; i++) {
          ops.push({ type: 'update', q, id: have[i].id, description: want[i].description,
            weight: Number(have[i].weight) === want[i].weight ? undefined : want[i].weight, label: want[i].description });
          pool.splice(pool.indexOf(have[i]), 1);
          wanted.splice(wanted.indexOf(want[i]), 1);
        }
      }
      // 5. create the rest; delete what is no longer wanted
      wanted.forEach((w) => ops.push({ type: 'create', q, groupId: w.cont, description: w.description, weight: w.weight, label: w.description }));
      pool.forEach((e) => ops.push({ type: 'delete', q, id: e.id, label: e.description }));

      // New groups are created together with their items.
      for (const w of leftover) {
        if (!w.items.length) { problems.push(entry.question + ': group "' + w.group + '" has no items (skipped; a group needs at least one)'); continue; }
        ops.push({ type: 'group_create', q, description: w.group, mutually_exclusive: !!w.mutually_exclusive,
          items: w.items.map((i) => ({ description: i.description, weight: Number(i.weight) })), label: w.group });
      }
      // Groups that are not in the file are deleted along with their items (if the caller allows deletion).
      haveGroups.forEach((g) => ops.push({
        type: 'group_delete', q, id: g.id,
        itemIds: mine.filter((i) => i.group_id === g.id).map((i) => i.id),
        label: 'group "' + g.description + '" (' + mine.filter((i) => i.group_id === g.id).length + ' item(s))',
      }));
    }
    return { ops, problems, unchanged };
  }

  // Desired order, computed against freshly saved props (created items/groups have new ids).
  // Ungrouped items and groups share one position sequence; items inside a group have their own.
  function planOrder(props, data) {
    const flat = flattenQuestions(props);
    const items = {}; const groups = {};
    props.rubric_items.forEach((i) => { (items[i.question_id] = items[i.question_id] || []).push(i); });
    (props.rubric_item_groups || []).forEach((g) => { (groups[g.question_id] = groups[g.question_id] || []).push(g); });
    const take = (pool, w) => {
      const k = pool.findIndex((e) => e.description === w.description && Number(e.weight) === Number(w.weight));
      return k >= 0 ? pool.splice(k, 1)[0] : null;
    };
    const result = [];
    for (const entry of data.questions) {
      const q = flat[entry.question];
      if (!q || (entry.title !== undefined && entry.title !== q.title)) continue;
      const mine = items[q.id] || [];
      const topPool = mine.filter((i) => i.group_id == null).sort(byPos);
      const groupPool = (groups[q.id] || []).slice().sort(byPos);
      const want = {}; // id -> desired position
      const top = [];
      for (const e of entry.items || []) {
        if (Array.isArray(e.items)) {
          const k = groupPool.findIndex((g) => g.description === e.group);
          if (k < 0) continue;
          const g = groupPool.splice(k, 1)[0];
          top.push({ group: g });
          const inner = mine.filter((i) => i.group_id === g.id).sort(byPos);
          const innerCur = inner.map((m) => m.id);
          const ordered = [];
          for (const w of e.items) { const m = take(inner, w); if (m) ordered.push(m); }
          inner.forEach((m) => ordered.push(m));
          if (ordered.map((m) => m.id).join() !== innerCur.join()) {
            ordered.forEach((m, i) => { if (m.position !== i) want['i' + m.id] = { id: m.id, pos: i }; });
          }
        } else {
          const m = take(topPool, e);
          if (m) top.push({ item: m });
        }
      }
      topPool.forEach((m) => top.push({ item: m }));       // unmatched stay, at the end
      groupPool.forEach((g) => top.push({ group: g }));
      // Compare relative order (ties: items before groups) so non-contiguous positions don't trigger writes.
      const curTop = mine.filter((i) => i.group_id == null).map((i) => ({ k: 0, o: i }))
        .concat((groups[q.id] || []).map((g) => ({ k: 1, o: g })))
        .sort((x, y) => x.o.position - y.o.position || x.k - y.k || x.o.id - y.o.id)
        .map((x) => x.k + ':' + x.o.id);
      const wantTop = top.map((t) => t.item ? '0:' + t.item.id : '1:' + t.group.id);
      if (curTop.join() !== wantTop.join()) {
        top.forEach((t, i) => {
          if (t.item) { if (t.item.position !== i) want['i' + t.item.id] = { id: t.item.id, pos: i }; }
          else if (t.group.position !== i) want['g' + t.group.id] = { id: t.group.id, pos: i, group: true };
        });
      }
      const changed = Object.values(want);
      if (changed.length) {
        const ri = {}; const rg = {};
        changed.forEach((w) => { (w.group ? rg : ri)[w.id] = { position: w.pos }; });
        result.push({ q, items: ri, groups: rg });
      }
    }
    return result;
  }

  async function rubricApi(courseId, questionId, path, method, body) {
    const resp = await fetch('/courses/' + courseId + '/questions/' + questionId + path, {
      method,
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/json',
        'x-csrf-token': csrf(),
        'x-requested-with': 'XMLHttpRequest',
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(method + ' ' + path + ' failed (' + resp.status + ')');
  }

  async function freshRubricProps() {
    const resp = await fetch(location.href, { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    return JSON.parse(doc.querySelector('[data-react-class="AssignmentRubric"]').dataset.reactProps);
  }

  // What importing `data` would change, without changing anything. No dialogs.
  function previewRubric(data) {
    if (!data || !Array.isArray(data.questions)) throw new Error('missing questions array');
    const props = rubricProps();
    const { ops, problems, unchanged } = planRubric(props, data);
    const count = (t) => ops.filter((o) => o.type === t).length;
    return {
      adds: count('create') + ops.filter((o) => o.type === 'group_create').reduce((n, o) => n + o.items.length, 0),
      newGroups: count('group_create'),
      edits: count('update') + count('move') + count('group_rename') + count('group_mutex'),
      scoringChanges: ops.filter((o) => o.type === 'scoring').map((o) => o.q.full_index + ': ' + o.label),
      deletions: ops.filter((o) => o.type === 'delete' || o.type === 'group_delete').map((o) => o.q.full_index + ': ' + o.label),
      reorders: planOrder(props, data).length,
      unchanged,
      problems,
    };
  }

  // Make the saved rubric match `data`: scoring type, groups, add, edit, delete (only if
  // opts.deleteMissing), reorder. No dialogs; the caller confirms first. Does not reload.
  async function applyRubric(data, opts) {
    const deleteMissing = !!(opts && opts.deleteMissing);
    if (!data || !Array.isArray(data.questions)) throw new Error('missing questions array');
    const props = rubricProps();
    const { ops } = planRubric(props, data);
    const courseId = props.course.id;
    const itemBody = (d, w, gid) => ({ rubric_item: { description: d, weight: String(w), group_id: gid } });
    let applied = 0;
    const renumber = new Map();
    const onProgress = (opts && opts.onProgress) || (() => {});
    let done = 0;
    const total = ops.length + 1; // +1 for the final renumber/reorder pass
    const tick = () => onProgress((++done / total) * 100);
    // Structure first: scoring type, group renames/flags, new groups.
    for (const o of ops) {
      if (o.type === 'scoring') {
        await rubricApi(courseId, o.q.id, '/save_grading_options', 'POST', {
          question: { id: o.q.id, scoring_type: o.scoring_type, ceiling: o.q.ceiling ? '1' : '0', floor: o.q.floor ? '1' : '0' },
        });
      } else if (o.type === 'group_rename') {
        await rubricApi(courseId, o.q.id, '/rubric_item_groups/' + o.id, 'PUT', { id: o.id, description: o.description });
      } else if (o.type === 'group_mutex') {
        await rubricApi(courseId, o.q.id, '/rubric_item_groups/' + o.id, 'PUT', { id: o.id, mutually_exclusive: o.value });
      } else if (o.type === 'group_create') {
        const known = new Set(((await freshRubricProps()).rubric_item_groups || []).map((g) => g.id));
        await rubricApi(courseId, o.q.id, '/rubric/create_group_with_items', 'POST', {
          rubric_item_group: { description: o.description },
          rubric_items: [{ description: o.items[0].description, weight: String(o.items[0].weight) }],
        });
        const g = ((await freshRubricProps()).rubric_item_groups || [])
          .find((x) => x.question_id === o.q.id && x.description === o.description && !known.has(x.id));
        if (!g) throw new Error('could not find the new group "' + o.description + '" after creating it');
        for (const it of o.items.slice(1)) await rubricApi(courseId, o.q.id, '/rubric_items', 'POST', itemBody(it.description, it.weight, g.id));
        if (o.mutually_exclusive) await rubricApi(courseId, o.q.id, '/rubric_item_groups/' + g.id, 'PUT', { id: g.id, mutually_exclusive: true });
      } else continue;
      applied++;
      tick();
    }
    // Then the items themselves.
    for (const o of ops) {
      if (o.type === 'create') {
        await rubricApi(courseId, o.q.id, '/rubric_items', 'POST', itemBody(o.description, o.weight, o.groupId));
      } else if (o.type === 'move') {
        await rubricApi(courseId, o.q.id, '/rubric_items/' + o.id, 'PUT', { id: o.id, group_id: o.groupId });
      } else if (o.type === 'update') {
        // One field per request, the way the editor sends them.
        if (o.description !== undefined) await rubricApi(courseId, o.q.id, '/rubric_items/' + o.id, 'PUT', { id: o.id, description: o.description });
        if (o.weight !== undefined) await rubricApi(courseId, o.q.id, '/rubric_items/' + o.id, 'PUT', { id: o.id, weight: String(o.weight) });
      } else if (o.type === 'delete') {
        if (!deleteMissing) { tick(); continue; }
        await rubricApi(courseId, o.q.id, '/rubric_items/' + o.id, 'DELETE');
      } else if (o.type === 'group_delete') {
        if (!deleteMissing) { tick(); continue; }
        for (const id of o.itemIds) await rubricApi(courseId, o.q.id, '/rubric_items/' + id, 'DELETE');
        await rubricApi(courseId, o.q.id, '/rubric_item_groups/' + o.id, 'DELETE');
        renumber.set(o.q.id, o.q);
      } else continue;
      applied++;
      tick();
    }
    // After a group was deleted, renumber what is left (as the editor does).
    if (renumber.size) {
      const fresh = await freshRubricProps();
      for (const q of renumber.values()) {
        const top = fresh.rubric_items.filter((i) => i.question_id === q.id && i.group_id == null).map((i) => ({ k: 0, o: i }))
          .concat((fresh.rubric_item_groups || []).filter((g) => g.question_id === q.id).map((g) => ({ k: 1, o: g })))
          .sort((x, y) => x.o.position - y.o.position || x.k - y.k || x.o.id - y.o.id);
        const ri = {}; const rg = {};
        top.forEach((t, i) => { if (t.o.position !== i) (t.k ? rg : ri)[t.o.id] = { position: i }; });
        if (Object.keys(ri).length || Object.keys(rg).length) {
          await rubricApi(courseId, q.id, '/rubric/update_entries', 'PATCH', { question_id: q.id, rubric_items: ri, rubric_item_groups: rg });
          applied++;
        }
      }
    }
    // Reorder against freshly saved data.
    for (const r of planOrder(await freshRubricProps(), data)) {
      await rubricApi(courseId, r.q.id, '/rubric/update_entries', 'PATCH', { question_id: r.q.id, rubric_items: r.items, rubric_item_groups: r.groups });
      applied++;
    }
    onProgress(100);
    return { ok: true, applied };
  }

  async function importRubric(file) {
    let data, pv;
    try {
      data = JSON.parse(await file.text());
      pv = previewRubric(data);
    } catch (e) { alert('Could not read that JSON: ' + e.message); return; }
    if (!pv.adds && !pv.edits && !pv.deletions.length && !pv.reorders && !pv.scoringChanges.length) {
      alert('Nothing to change: ' + pv.unchanged + ' rubric item(s) already match.' +
        (pv.problems.length ? '\n\nNotes:\n' + pv.problems.slice(0, 8).join('\n') : ''));
      return;
    }
    const msg = 'Rubric changes from "' + file.name + '":\n' +
      pv.adds + ' item(s) to add (' + pv.newGroups + ' new group(s)), ' + pv.edits + ' edit(s), ' +
      pv.deletions.length + ' deletion(s), ' + pv.unchanged + ' unchanged' +
      (pv.scoringChanges.length ? '; scoring type changes on ' + pv.scoringChanges.length + ' question(s)' : '') + '.' +
      (pv.problems.length ? '\n\nNotes (' + pv.problems.length + '):\n' + pv.problems.slice(0, 8).join('\n') + (pv.problems.length > 8 ? '\n...' : '') : '') +
      '\n\nContinue?';
    if (!confirm(msg)) return;
    let deleteMissing = false;
    if (pv.deletions.length) {
      deleteMissing = confirm(pv.deletions.length + ' existing rubric item(s) are not in the file and would be DELETED:\n' +
        pv.deletions.slice(0, 10).join('\n') +
        '\n\nOK = delete them.  Cancel = keep them (everything else still applies).');
    }
    const ov = showOverlay('Importing rubric...');
    try {
      await applyRubric(data, { deleteMissing, onProgress: (p) => ov.set(p) });
    } catch (e) {
      ov.close();
      alert('Stopped part-way: ' + e.message + '\nThe page will reload so you can see what was saved.');
      location.reload();
      return;
    }
    await ov.reload();
  }

  // ------------------------------------------------------------------- API
  // Dialog-free entry points (used by Claude in Chrome, or from the console).
  // Nothing here asks for confirmation; callers must confirm with the user first.
  window.gradescopeTools = { getOutline, applyOutline, getRubric, previewRubric, applyRubric };

  // ------------------------------------------------------------------- INIT

  if (location.pathname.endsWith('/outline/edit')) {
    mount(makeBar([
      makeButton('Export outline JSON', exportOutline),
      makeButton('Import outline JSON', () => pickFile(importOutline)),
    ]), '.assignmentOutlineSidebar--heading');
  } else if (location.pathname.endsWith('/rubric/edit')) {
    mount(makeBar([
      makeButton('Export rubric JSON', exportRubric),
      makeButton('Import rubric JSON', () => pickFile(importRubric)),
    ]), '.assignmentRubricHeader .pageHeading');
  }
})();
