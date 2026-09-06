/**
 * A zone header action must be backed all the way to a worker route.
 *
 * WHAT THIS EXISTS TO STOP. This repo has shipped a button that 404s before:
 * Trust Center's KYB card posted to `POST /trust/kyb/submit`, a route the worker
 * has never declared, and CI stayed green only because
 * `scripts/api-drift-baseline.json` suppressed it. A founder filled in the form,
 * pressed submit, and got nothing. The zone action rows are the same shape of
 * risk, multiplied: the canvases specify roughly 180 of these labels across four
 * profiles, and most of the endpoints behind them do not exist yet.
 *
 * THE CHAIN THIS ASSERTS. Every action in a zone's map dispatches to a handler
 * defined in the same file; every handler calls `api.<method>`; every method is
 * defined in `frontend/src/lib/api.js`. `scripts/check-api-drift.mjs` already
 * closes the last link — no `api.js` method without a worker route — so together
 * they mean: an action on screen reaches a route that answers.
 *
 * The interesting half is the NEGATIVE one. Pain map and Verdict are drawn on
 * the canvas with `Export map`, `Export summary` and `Send to Problem slide`,
 * and none of those routes exist. They therefore appear in no map, and this file
 * fails the moment a zone gains an action whose handler calls nothing real —
 * which is exactly how the next batch will be attempted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { apiMethodNames } from './_apiMethods.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const VALIDATE = 'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx';
const src = codeOnly(read(VALIDATE));
const methods = apiMethodNames(read('frontend/src/lib/api.js'));

/** The `ACTIONS` object literal, by brace balance — it holds nested objects. */
function actionsBlock(text) {
  const start = text.indexOf('const ACTIONS = {');
  assert.ok(start >= 0, `${VALIDATE} no longer declares an ACTIONS map`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('ACTIONS map is not brace-balanced');
}

const block = actionsBlock(src);

/**
 * The keys of an object literal's body, shorthand included.
 *
 * `{ pain_group_id: Number(groupId), direction }` has two keys and only one
 * colon. The first version of this file matched `/(\w+)\s*:/` and reported one
 * key, so the assertion failed on correct code — and then "caught" four
 * unrelated mutations that had never touched this file, which is the exact
 * false-negative shape a mutation run exists to expose. Split on the commas at
 * depth zero instead, so `Number(groupId)`'s own comma-free parens cannot
 * confuse it either.
 */
function objectKeys(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.includes(':') ? p.slice(0, p.indexOf(':')) : p).trim())
    .sort();
}


test('every Validate zone action dispatches to a handler in the same file', () => {
  const handlers = [...block.matchAll(/onClick:\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\(/g)].map((m) => m[1]);
  const setters = [...block.matchAll(/onClick:\s*\(\)\s*=>\s*(set[A-Za-z0-9_]+)\(/g)].map((m) => m[1]);
  assert.ok(handlers.length >= 3, `only ${handlers.length} actions found — the matcher is not matching`);
  for (const name of new Set(handlers)) {
    // A setter opens a dialog; the dialog's own onSave is what writes.
    if (setters.includes(name)) {
      assert.match(src, new RegExp(`const \\[[A-Za-z0-9_]+, ${name}\\] = useState`),
        `${name} is not a state setter declared in this file`);
    } else {
      assert.match(src, new RegExp(`(const|function) ${name}\\b`),
        `${name} is not defined in this file`);
    }
  }
});

test('every write handler calls an api method that exists', () => {
  // `save*` is the file's convention for "this one writes".
  const writes = [...src.matchAll(/const (save[A-Za-z0-9_]+) = async \([^)]*\) => \{([\s\S]*?)\n  \};/g)];
  assert.ok(writes.length >= 3, `only ${writes.length} save handlers found — the matcher is not matching`);
  for (const [, name, body] of writes) {
    const calls = [...body.matchAll(/\bapi\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, `${name} writes nothing — an action wired to it would do nothing`);
    for (const m of calls) {
      assert.ok(methods.has(m),
        `${name} calls api.${m}, which frontend/src/lib/api.js does not define`);
    }
  }
});

test('a zone whose endpoints do not exist yet draws no action', () => {
  // Pain map and Verdict: the canvas gives them Export and "Send to Problem
  // slide"; the worker has neither route. They must not appear in the map.
  for (const slug of ['pain-map', 'verdict']) {
    assert.ok(!new RegExp(`['"]?${slug}['"]?\\s*:`).test(block),
      `${slug} has entries in ACTIONS — every one needs a live route first`);
  }
  // And the map must still be reachable: a zone with no entry renders nothing.
  assert.match(src, /ACTIONS\[zone\?\.slug\] \? <ZoneActions/,
    'the action row must be absent, not empty, for a zone with no backed action');
});

test('ZoneActions renders a limit as text, never as a button', () => {
  const zone = codeOnly(read('frontend/src/workspaces/ZoneActions.jsx'));
  // The `note` branch must return before either the Link or the button branch.
  const noteAt = zone.indexOf('if (item.note)');
  const linkAt = zone.indexOf('if (item.to)');
  const btnAt = zone.lastIndexOf('<button');
  assert.ok(noteAt > 0 && linkAt > noteAt && btnAt > noteAt,
    'an item carrying a stated limit must short-circuit before anything clickable');
  assert.match(zone, /<span[\s\S]{0,240}\{item\.label\} — \{item\.note\}/,
    'the limit must render beside the label, so the reader learns why');
});

test('ZoneActions adopts no undeclared design token', () => {
  // ~400 usages of these exist across pages/ and workspaces/ and none of them
  // emit CSS — they are declared nowhere. New code does not add to that.
  //
  // Through `codeOnly` because the component's own docblock NAMES these tokens
  // to explain why it avoids them, and the first draft of this test failed on
  // that sentence. A token inside a className survives the strip, which is the
  // only place it would matter.
  const zone = codeOnly(read('frontend/src/workspaces/ZoneActions.jsx'));
  for (const dead of ['axal-ink-2', 'axal-ink-3', 'axal-surface-2', 'axal-border-soft', 'axal-border']) {
    assert.ok(!zone.includes(dead), `ZoneActions uses ${dead}, which is declared nowhere and emits no CSS`);
  }
});

test('the two hypothesis dialogs send exactly what their routes accept', () => {
  const dlg = codeOnly(read('frontend/src/workspaces/founder/ValidateDialogs.jsx'));

  // ASSERT THE PAYLOAD, NOT THE ABSENCE OF AN IDENTIFIER. The first draft of
  // this test banned `setCode(` and a mutation adding `const [code, setCode] =
  // useState('')` walked straight past it — the declaration writes `setCode]`,
  // not `setCode(`. Worse, that mutation was not even the defect: unused state
  // is dead code, while sending a field the server owns is the actual lie. So
  // the assertion is on what leaves the form.

  // `POST /board/:projectId/hypotheses` reads exactly `claim` and allocates the
  // code itself, from the highest ever used, so a retired claim cannot hand its
  // number to a later one. The lane is computed from evidence, never set.
  const create = dlg.match(/await onSave\(\{([^}]*)\}\)/);
  assert.ok(create, 'the create dialog no longer calls onSave with an object');
  const createKeys = objectKeys(create[1]);
  assert.deepEqual(createKeys, ['claim'],
    `the create form sends ${JSON.stringify(createKeys)} — the route reads claim and owns everything else`);

  // `POST /hypotheses/:id/links` reads exactly `pain_group_id` and `direction`,
  // and validates the direction against a two-value set.
  const link = dlg.match(/await onSave\([^,]+,\s*\{([^}]*)\}\)/);
  assert.ok(link, 'the link dialog no longer calls onSave with an id and an object');
  const linkKeys = objectKeys(link[1]);
  assert.deepEqual(linkKeys, ['direction', 'pain_group_id'],
    `the link form sends ${JSON.stringify(linkKeys)}`);

  for (const d of ['supports', 'contradicts']) {
    assert.ok(dlg.includes(`'${d}'`), `the link form must offer ${d} — the route accepts both`);
  }
});
