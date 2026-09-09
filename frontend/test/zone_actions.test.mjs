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
 * THE CHAIN THIS ASSERTS. Every `kind: 'handler'` op the founder table declares
 * for `/validate/*` is supplied by `FounderValidateWorkspace`; every supplied
 * handler is a state setter or a helper defined in that file; every `api.*` it
 * names exists in `frontend/src/lib/api.js`. `scripts/check-api-drift.mjs`
 * already closes the last link — no `api.js` method without a worker route — so
 * together they mean: an action on screen reaches a route that answers.
 *
 * IT USED TO READ A LOCAL `ACTIONS` MAP, and the map is gone. That literal was
 * the only zone header in the product built outside `founderZoneActions.js`,
 * because `zoneActionBuilder` had no way to say "the page performs this" until
 * `kind: 'handler'` (D67). The chain did not change — the halves are now in two
 * files, and the join between them is the assertion that leads this file: a
 * declared handler the page does not supply renders NOTHING, so without this
 * check a renamed handler would empty a row silently and every other assertion
 * here would still pass.
 *
 * The interesting half is still the NEGATIVE one. `Send to Problem slide` is
 * drawn on two artboards and has no endpoint, so it carries `unbuilt:` and no
 * handler — and this file fails the moment it gains one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { apiMethodNames } from './_apiMethods.mjs';
import { FOUNDER_ZONE_FILTERS } from '../src/workspaces/founderZoneFilters.js';
import { makeZoneActions } from '../src/workspaces/zoneActionBuilder.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const VALIDATE = 'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx';
const src = codeOnly(read(VALIDATE));
const methods = apiMethodNames(read('frontend/src/lib/api.js'));

const TABLE = read('frontend/src/workspaces/founderZoneActions.js');

/** An object literal named by its `const`, by brace balance — they nest. */
function objectBlock(text, decl) {
  const start = text.indexOf(decl);
  assert.ok(start >= 0, `${VALIDATE} no longer declares ${decl}`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`${decl} is not brace-balanced`);
}

const block = objectBlock(src, 'const handlers = {');

/** Zone key → the `handler:` names the founder table declares for it. */
function declaredHandlers() {
  const out = new Map();
  let zone = null;
  for (const line of codeOnly(TABLE).split('\n')) {
    const z = line.match(/^ {2}'([a-z-]+\/[a-z-]+)':/);
    if (z) { zone = z[1]; continue; }
    const h = line.match(/kind: 'handler', handler: '([A-Za-z0-9_]+)'/);
    if (h && zone) out.set(zone, [...(out.get(zone) || []), h[1]]);
  }
  return out;
}

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


test('the builder drops a handler the page did not supply, and keeps one it did', () => {
  // RUN, NOT READ. Every other assertion about `kind: 'handler'` reads source
  // text; this one calls the builder, because the static checks all pass while
  // the branch returns the wrong thing. It is the runtime half of the join
  // above: the static check fails a rename in CI, and this proves what the page
  // does if one ever reaches a browser — the op vanishes rather than rendering a
  // control that does nothing.
  const rows = makeZoneActions({
    'z/a': [
      { label: 'Open', kind: 'handler', handler: 'open' },
      { label: 'Ghost', kind: 'handler', handler: 'neverSupplied' },
      { label: 'Running', kind: 'handler', handler: 'running' },
      { label: 'Gap', unbuilt: 'nothing performs it' },
    ],
  })('z/a', {
    handlers: {
      open: () => 'clicked',
      // The object form, which is why the builder takes one: a server-side
      // export knows when it is in flight and a control needing a venture knows
      // when there is none, and neither fact can live in a table.
      running: { onClick: () => {}, disabled: true, busy: true },
    },
  });

  assert.deepEqual(rows.map((r) => r.label), ['Open', 'Running'],
    'an unsupplied handler must be dropped, and an unbuilt entry with it');
  assert.equal(rows[0].onClick(), 'clicked', 'a bare function is taken as the click itself');
  assert.equal(rows[0].disabled, false, 'a bare function is neither disabled nor busy');
  assert.equal(rows[1].disabled, true, 'the object form must carry disabled through');
  assert.equal(rows[1].busy, true, 'and busy');
  assert.equal(rows[0].testid, 'action-a-open', 'the testid still derives from the label');

  // A supplied value that is not callable is the same as absent — an object
  // without `onClick` would otherwise render a button whose click is undefined.
  const bad = makeZoneActions({ 'z/a': [{ label: 'Open', kind: 'handler', handler: 'open' }] })(
    'z/a', { handlers: { open: { disabled: false } } },
  );
  assert.deepEqual(bad, [], 'a handler object with no onClick must be dropped');
});

test('every handler the table declares is supplied by the workspace', () => {
  // THE JOIN BETWEEN THE TWO HALVES, and the assertion that replaced reading a
  // local map. `zoneActionBuilder` DROPS a handler entry whose function the page
  // did not supply — the right runtime behaviour, since the alternative is a
  // button that does nothing, and the exact reason a rename has to fail here
  // instead: the row would simply lose an op and stay green.
  const declared = declaredHandlers();
  const validate = [...declared].filter(([zone]) => zone.startsWith('validate/'));
  assert.equal(validate.length, 4, `${validate.length} validate zones declare handlers, expected 4`);

  const supplied = new Set(
    [...block.matchAll(/^ {4}([A-Za-z0-9_]+):/gm)].map((m) => m[1]),
  );
  assert.equal(supplied.size, 6, `the workspace supplies ${supplied.size} handlers, expected 6`);

  for (const [zone, names] of validate) {
    for (const name of names) {
      assert.ok(supplied.has(name),
        `${zone} declares handler '${name}' and ${VALIDATE} supplies no such key, `
        + 'so the builder drops the op and the row renders one control short');
    }
  }
  // And nothing the page supplies is unreachable: a handler no table names is
  // dead wiring that reads as a live op to anyone editing this file.
  const named = new Set(validate.flatMap(([, names]) => names));
  for (const key of supplied) {
    assert.ok(named.has(key), `${VALIDATE} supplies '${key}', which no zone declares`);
  }
});

test('every supplied handler resolves to something defined in the workspace', () => {
  // Two legitimate shapes: an inline `onClick` opening a dialog, and a call to
  // the file's own export helper. A setter is checked against its `useState`
  // declaration because a dialog's own `onSave` is what writes.
  const inline = [...block.matchAll(/onClick:\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\(/g)].map((m) => m[1]);
  const helpers = [...block.matchAll(/^ {4}[A-Za-z0-9_]+:\s*([A-Za-z0-9_]+)\(/gm)].map((m) => m[1]);
  assert.ok(inline.length >= 3, `only ${inline.length} inline handlers found — the matcher is not matching`);
  assert.ok(helpers.length >= 3, `only ${helpers.length} helper handlers found — the matcher is not matching`);
  for (const name of new Set(inline)) {
    assert.match(src, new RegExp(`const \\[[A-Za-z0-9_]+, ${name}\\] = useState`),
      `${name} is not a state setter declared in this file`);
  }
  for (const name of new Set(helpers)) {
    assert.match(src, new RegExp(`(const|function) ${name}\\b`),
      `${name} is not defined in this file`);
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

test('each zone\'s view map holds exactly the live chips its table declares', () => {
  // FOUND BY MUTATION, AND THE ESCAPE IS THE ARGUMENT FOR THIS TEST. Deleting
  // `retired` from `HYPOTHESIS_VIEWS` passed the whole suite: its sibling guard
  // searches the PAGE for a declared key, and `/validate/hypotheses` and
  // `/validate/verdict` are one file — so `SUMMARY_VIEWS.retired` vouched for
  // the chip on the other zone. A per-file search cannot tell two zones apart
  // when they share a file, which four of these do.
  //
  // What made it worth closing rather than noting: the fallback is
  // `VIEWS[view] || VIEWS.all`, so the missing predicate does not throw or empty
  // the list — clicking "Retired" would show the LIVE claims. A chip that
  // silently answers a different question is the exact failure the honesty rule
  // exists for, and it looks like working software.
  const MAPS = {
    'validate/interviews': 'const INTERVIEW_VIEWS = {',
    'validate/hypotheses': 'const HYPOTHESIS_VIEWS = {',
    'validate/verdict': 'const SUMMARY_VIEWS = {',
  };
  for (const [zone, decl] of Object.entries(MAPS)) {
    const live = (FOUNDER_ZONE_FILTERS[zone] || []).filter((f) => f.key).map((f) => f.key).sort();
    assert.ok(live.length, `${zone} declares no live chip — this map should not exist`);
    const keys = [...objectBlock(src, decl).matchAll(/^ {2}'?([a-z-]+)'?:/gm)].map((m) => m[1]).sort();
    assert.deepEqual(keys, live,
      `${zone} declares live chips ${JSON.stringify(live)} and its view map holds `
      + `${JSON.stringify(keys)} — a chip with no predicate falls back to the default view `
      + 'and answers a different question');
  }
  // And the zone whose four labels are ALL prose has no map at all: an empty one
  // would be a place for a chip to reappear without its table entry changing.
  const painMap = FOUNDER_ZONE_FILTERS['validate/pain-map'] || [];
  assert.equal(painMap.filter((f) => f.key).length, 0,
    'validate/pain-map gained a live chip; it needs a view map and an entry above');
  assert.ok(!/const PAIN_MAP_VIEWS/.test(src), 'a pain-map view map appeared with no live chip to serve');
});

test('every api method the handlers name is one that exists', () => {
  // THIS ASSERTION MOVED, and the move is the point. It first read "pain-map
  // and verdict must have no entries", which was true only while their export
  // routes did not exist — and it failed, correctly, the moment they did. A
  // test that has to be deleted to ship the next zone was pinning a schedule,
  // not an invariant. The invariant is that an action reaches a route.
  const named = [...block.matchAll(/\bapi\.([A-Za-z0-9_]+)\b/g)].map((m) => m[1]);
  assert.ok(named.length >= 3, `only ${named.length} api methods named in handlers — the matcher is not matching`);
  for (const m of new Set(named)) {
    assert.ok(methods.has(m), `handlers name api.${m}, which frontend/src/lib/api.js does not define`);
  }
  // A row is drawn by the BODY now, not by the shell's `actions` slot, and
  // `ZoneToolbar` returns null when it has neither a chip nor an op — so a zone
  // with nothing backed still renders no row rather than an empty one.
  const toolbar = codeOnly(read('frontend/src/workspaces/ZoneToolbar.jsx'));
  assert.match(toolbar, /if \(!live\.length && !actions\.filter\(Boolean\)\.length\) return null;/,
    'the empty row must be absent, not blank');
  assert.equal((src.match(/<ZoneToolbar/g) || []).length, 4,
    'each of the four zone bodies draws exactly one toolbar');
});

test('the retire control is the caller `retired_at` never had', () => {
  // Migration 211 created `hypotheses.retired_at` FOR the canvas's "Retired"
  // filter, the worker has taken both directions since, and no screen in the SPA
  // called `api.updateHypothesis` — so the column could only ever be NULL and
  // the two labels reading it filtered an empty set. Both are live chips now,
  // which is only true while this caller exists.
  assert.match(src, /api\.updateHypothesis\(id, \{ retired \}\)/,
    'the retire call is gone, so `retired_at` is write-only again and two chips filter nothing');
  assert.ok(methods.has('updateHypothesis'),
    'api.js no longer defines updateHypothesis');
  // Retire AND restore: the route accepts `retired: false` too, and a claim that
  // cannot come back is a delete wearing a softer word.
  assert.match(src, /onRetire\(h\.id, !h\.retired_at\)/,
    'the control no longer toggles, so a retired claim cannot be restored');
});

test('"Send to Problem slide" is not drawn, because it would be theatre', () => {
  // The canvas gives it to Pain map and Verdict. There is no endpoint — and
  // the pain themes ALREADY feed the deck's slide 2, since `pain_groups` is
  // curated for exactly that. A button that "sends" would be a control over a
  // pipe that already runs, which is a worse lie than a missing button.
  // It is IN the table — dropping it would tell the canvas-order guard the
  // artboard never drew it — and it carries `unbuilt:`, which renders nothing.
  const declared = declaredHandlers();
  for (const zone of ['validate/pain-map', 'validate/verdict']) {
    assert.ok(!(declared.get(zone) || []).length || declared.get(zone).length < 2,
      `${zone} declares a handler for every op, so the send button became real`);
  }
  const table = codeOnly(TABLE);
  assert.match(table, /\{ label: 'Send to Problem slide', unbuilt: '/,
    'the send op must stay recorded as a gap, so the canvas-order guard still sees it');
  assert.ok(!/Send to Problem slide/.test(block),
    'a "send" button over a feed that is already live must not ship');
});

test('ZoneActions renders no limit at all, as text or as a button', () => {
  // REVERSED DELIBERATELY. This required an unperformable action to render as a
  // `<span>` reading `{label} — {note}`. That is how the design's `Comparables`
  // chip reached customers as a sentence about how comparables are filed, and
  // how a five-op zone header became five paragraphs. Not drawing a dead button
  // was always right; putting the reason inside the control's own label was
  // not. The entry is dropped by `zoneActionBuilder` and the reason stays in
  // the action table, where the person who can build the op reads it.
  const zone = codeOnly(read('frontend/src/workspaces/ZoneActions.jsx'));
  assert.doesNotMatch(zone, /item\.note/, 'the prose branch is back in ZoneActions');
  assert.doesNotMatch(zone, /\{item\.label\} — /,
    'a label is joined to a sentence again');
  // Everything the component still renders is a control: a link or a button.
  assert.match(zone, /if \(item\.to\)/, 'the link branch went missing');
  assert.ok(zone.lastIndexOf('<button') > zone.indexOf('if (item.to)'),
    'the button branch no longer follows the link branch');

  // And the drop happens upstream, so nothing unperformable ever arrives here.
  const builder = codeOnly(read('frontend/src/workspaces/zoneActionBuilder.js'));
  assert.match(builder, /return null;/, 'the builder no longer drops an unbuilt op');
  assert.match(builder, /\.filter\(Boolean\)/, 'the dropped entries are still in the array');
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
