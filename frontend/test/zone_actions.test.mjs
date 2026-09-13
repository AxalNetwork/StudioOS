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
 * drawn on two artboards and must never become a button that sends: the pain
 * themes already feed the deck. It is a LINK to the slide now, under a label
 * that does not say "send" — and this file fails the moment it gains a handler
 * or gets the canvas's verb back on a control.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { apiMethodNames } from './_apiMethods.mjs';
import { FOUNDER_ZONE_FILTERS } from '../src/workspaces/founderZoneFilters.js';
import { FOUNDER_ZONE_ACTIONS as ZONE_ACTIONS } from '../src/workspaces/founderZoneActions.js';
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

  // WAS `['Open', 'Running']` under "an unsupplied handler must be dropped, and
  // an unbuilt entry with it". The two halves have come apart and the reason is
  // the point of the split: an UNSUPPLIED HANDLER is a wiring mistake — the
  // table declares an op and the page forgot to pass its callback — and the
  // only safe answer is to drop it, because nothing is known about why. An
  // UNBUILT entry is a stated fact with a reason attached, and it is drawn
  // disabled so the reader sees the artboard's row and can hover for the
  // reason. `scripts/check-zone-handlers.mjs` fails the build on the first
  // case, so the silent drop is the second line rather than the only one.
  assert.deepEqual(rows.map((r) => r.label), ['Open', 'Running', 'Gap'],
    'an unsupplied handler must be dropped, and an unbuilt entry drawn disabled');
  const gap = rows.find((r) => r.label === 'Gap');
  assert.equal(gap.disabled, true, 'an unbuilt op is drawn live');
  assert.equal(gap.onClick, undefined, 'an unbuilt op is clickable with nothing to perform');
  assert.equal(gap.title, 'nothing performs it', 'an unbuilt op says nothing on hover');
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
    // JOINED WHEN ITS FIRST CHIP WENT LIVE. `Need-to-have` was prose because
    // `interview_pain_severities` had no reader and no writer; it has both now,
    // so the zone has a live key and needs its predicate under this guard like
    // the other three. The other three labels on that row are still prose.
    'validate/pain-map': 'const PAIN_VIEWS = {',
  };
  // A CHIP'S BEHAVIOUR MAY BE ANY OF THREE THINGS, AND MUST BE EXACTLY ONE.
  // Three of these zones only ever narrow, so a predicate map said everything
  // about them. `validate/pain-map` does not: its row is `ICP only · All
  // interviews · Need-to-have · By recency`, where `All interviews` is the
  // cleared state and `By recency` REORDERS the same set. Requiring those two to
  // appear as predicates would have forced `() => true` entries that satisfy this
  // guard while lying about what the chip does — a test shaping the code to fit
  // itself. So the rule is the invariant rather than the shape: every live chip
  // in the table is claimed by exactly one declared role, and every declared role
  // belongs to a live chip.
  //
  // `EXTRA_ROLES` lists the non-predicate roles a zone declares. A zone absent
  // from it must account for all of its chips with predicates, exactly as before.
  const EXTRA_ROLES = {
    'validate/pain-map': {
      sorts: 'const PAIN_SORTS = {',
      cleared: /^const PAIN_CLEARED = '([a-z-]+)';$/m,
    },
  };
  for (const [zone, decl] of Object.entries(MAPS)) {
    const live = (FOUNDER_ZONE_FILTERS[zone] || []).filter((f) => f.key).map((f) => f.key).sort();
    assert.ok(live.length, `${zone} declares no live chip — this map should not exist`);
    const keys = [...objectBlock(src, decl).matchAll(/^ {2}'?([a-z-]+)'?:/gm)].map((m) => m[1]);
    const extra = EXTRA_ROLES[zone] || {};
    const sorts = extra.sorts
      ? [...objectBlock(src, extra.sorts).matchAll(/^ {2}'?([a-z-]+)'?:/gm)].map((m) => m[1])
      : [];
    let cleared = [];
    if (extra.cleared) {
      const m = src.match(extra.cleared);
      assert.ok(m, `${zone} declares a cleared-state constant this guard cannot find — ${extra.cleared}`);
      cleared = [m[1]];
    }
    const claimed = [...keys, ...sorts, ...cleared];
    // NO KEY IN TWO ROLES. A chip that is both a predicate and a sort has no
    // single answer to "what does pressing this do", and the page would pick one
    // silently — the same class of failure as a chip with no role at all.
    assert.equal(new Set(claimed).size, claimed.length,
      `${zone} claims a chip in more than one role (${JSON.stringify(claimed)}) — a chip that both `
      + 'narrows and reorders has no defined behaviour');
    assert.deepEqual([...claimed].sort(), live,
      `${zone} declares live chips ${JSON.stringify(live)} and its view maps claim `
      + `${JSON.stringify([...claimed].sort())} — a chip with no predicate, sort or cleared-state `
      + 'declaration falls through and answers a different question');
  }
  // WAS "the zone whose four labels are ALL prose has no map at all", asserting
  // `validate/pain-map` had zero live chips and no map — "an empty one would be
  // a place for a chip to reappear without its table entry changing". That was
  // a true statement about a schedule, and the loop above is the invariant: a
  // zone's map holds exactly its live keys, whether that is none or four. The
  // zone is now in `MAPS` and checked by the same rule as its siblings.
  //
  // What the sentence was protecting is kept, generalised: a map with no zone
  // in `MAPS` is a map nothing checks.
  // `_SORTS` IS SWEPT UP TOO, for the reason the original sentence gives. A
  // chip-behaviour map nobody checks is a chip row that can drift from its
  // table, and that is as true of an ordering map as of a predicate one — a
  // `BUILD_SORTS` added next to `PAIN_SORTS` without an `EXTRA_ROLES` entry
  // would otherwise be invisible here.
  const declared = [...src.matchAll(/^const ([A-Z_]+_(?:VIEWS|SORTS)) = \{/gm)].map((m) => m[1]).sort();
  const guarded = [
    ...Object.values(MAPS),
    ...Object.values(EXTRA_ROLES).map((r) => r.sorts).filter(Boolean),
  ].map((d) => d.slice('const '.length, d.indexOf(' = {'))).sort();
  assert.deepEqual(declared, guarded,
    `this file declares ${JSON.stringify(declared)} and the guard covers ${JSON.stringify(guarded)} — `
    + 'a chip-behaviour map nobody checks is a chip row that can drift from its table');
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

test('"Send to Problem slide" is a link to the slide, never a button that sends', () => {
  // The canvas gives it to Pain map and Verdict, and the verb is the problem:
  // the pain themes ALREADY feed the deck's slide 2, since `pain_groups` is
  // curated for exactly that. A button that "sends" would be a control over a
  // pipe that already runs — a worse lie than a missing button.
  //
  // IT WAS `unbuilt:` UNTIL 2026-09-13 AND THAT IS NO LONGER THE RIGHT ANSWER.
  // An unbuilt op renders disabled with its reason on hover, which says "this
  // cannot run" about a connection that runs fine. What a reader pressing it
  // actually wants is to SEE the slide, and that is a route they may open. So
  // the op is a link to the deck workspace, the artboard's word stays in
  // `canvas:` where the canvas-order guard reads it, and the word on screen is
  // one that does not claim to send.
  const declared = declaredHandlers();
  for (const zone of ['validate/pain-map', 'validate/verdict']) {
    assert.ok(!(declared.get(zone) || []).length || declared.get(zone).length < 2,
      `${zone} declares a handler for every op, so the send button became real`);
  }
  const table = codeOnly(TABLE);
  assert.match(table, /canvas: 'Send to Problem slide', label: '([^']+)', to: '\/raise\/pitch\?mode=workspace'/,
    'the artboard op must stay recorded, as a link, or the canvas-order guard stops seeing it');
  assert.doesNotMatch(table, /label: 'Send to Problem slide'/,
    'the canvas verb is back on a control, and the control does not send');
  assert.ok(!/Send to Problem slide/.test(block),
    'a "send" button over a feed that is already live must not ship');

  // AND RENDERED, not just declared. The table could hold the right entry and
  // the builder still emit a dead control; this is the half a reader sees.
  const zoneActions = makeZoneActions(ZONE_ACTIONS);
  for (const zone of ['validate/pain-map', 'validate/verdict']) {
    const op = zoneActions(zone, { query: '?project_id=7' })
      .find((a) => /Problem slide/.test(a.label));
    assert.ok(op, `${zone} no longer draws the Problem-slide op at all`);
    assert.doesNotMatch(op.label, /send/i, `${zone} draws a control whose label claims to send`);
    assert.equal(op.to, '/raise/pitch?mode=workspace&project_id=7',
      `${zone}'s Problem-slide op does not carry the reader's scope to the deck`);
    assert.equal(typeof op.onClick, 'undefined', 'a link must not also carry a click');
    assert.ok(!op.disabled, 'the op is a live route, so it must not render disabled');
  }
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
    assert.ok(!zone.includes(dead), `ZoneActions uses ${dead}, a name the U11 sweep retired — it is declared nowhere and emits no CSS`);
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

test('the pain map divides interviews by interviews, not wordings by interviews', () => {
  // THE BUG THIS PINS, MEASURED. `analyzePains` seeds every curated alias as a
  // phrase whether or not an interview logged it, and this page divided
  // `g.phrases.length` by `view.interview_total`. Run against the real service:
  // a theme with three curated wordings that NO interview mentioned, on a
  // two-interview project, drew "3 phrases · 150%" with the bar pinned at 100%
  // while the server's own `count` was 0.
  //
  // It was not a disagreement nobody had noticed. `serializePainMapCsv`'s
  // docblock already asserted `count` is "the same number the pain map page
  // shows" — the export used `count` and the page did not, so one record read two
  // ways one screen apart, and the comment vouched for the agreement.
  //
  // ASSERTED ON THE EXPRESSION, NOT ON A BANNED TOKEN. `phrases.length` is still
  // in this file and should be: the wording count is what a founder curating the
  // map needs to see. What must never come back is `phrases.length` as the
  // NUMERATOR over the interview total, which is what these two read.
  const pct = src.match(/const pct = total \? Math\.round\(\(([^/]+)\/ total\) \* 100\) : 0;/);
  assert.ok(pct, 'the pain map no longer computes a percentage the way this guard can read');
  assert.match(pct[1], /^n\s*$/, `the percentage divides ${pct[1].trim()} by the interview total`);
  assert.match(src, /const n = g\.count \|\| 0;/,
    'the numerator must be `count` — distinct interviews — and not a length of anything');

  // The leading-theme sentence in the footnote takes the same number. It read
  // `top.phrases?.length` and so could name a different theme from the one at
  // the top of its own list once the ranking was fixed.
  assert.ok(!/top\.phrases\?\.length/.test(src),
    'the footnote still computes its headline percentage from the wording count');
  assert.match(src, /top\.count \|\| 0/, 'the footnote must quote the same frequency the rows show');

  // AND THE RANKING. `analyzePains` sorts its `themes` by `count` desc then
  // title — the order the deck's Problem slide renders — and this zone's own
  // `Send to Problem slide` op is a LINK to that slide. Sorting the page by
  // wording variety let the page and the slide it points at name different
  // leading pains.
  assert.match(src, /\(b\.count \|\| 0\) - \(a\.count \|\| 0\)\s*\n?\s*\|\| String\(a\.title\)\.localeCompare\(String\(b\.title\)\)/,
    'the rows must rank by interviews then title — the same order the deck slide uses');
});

test('every chip the pain map narrows on reads a field the view carries', () => {
  // A predicate over a field the server does not send is a chip that matches
  // nothing forever, and it looks exactly like "you have no such themes". The
  // fields are asserted against `painGroups.ts` itself rather than a list here,
  // so removing one from the view breaks this rather than the screen.
  const service = codeOnly(read('cloudflare-worker/src/services/painGroups.ts'));
  const views = objectBlock(src, 'const PAIN_VIEWS = {');
  const fields = [...views.matchAll(/g\.([a-z_]+)\b/g)].map((m) => m[1]);
  assert.ok(fields.length >= 2, `only ${fields.length} fields read by the predicates — the matcher is not matching`);
  for (const f of new Set(fields)) {
    assert.ok(new RegExp(`\\b${f}:`).test(service),
      `the pain map narrows on g.${f}, which PainGroupsView does not carry`);
  }
  // The sort reads one too, and the same argument applies to it.
  const sorts = objectBlock(src, 'const PAIN_SORTS = {');
  const sortFields = [...sorts.matchAll(/\b[ab]\.([a-z_]+)\b/g)].map((m) => m[1]);
  assert.ok(sortFields.length >= 2, 'the sort reads no view field — the matcher is not matching');
  for (const f of new Set(sortFields)) {
    assert.ok(new RegExp(`\\b${f}:`).test(service),
      `the pain map sorts on ${f}, which PainGroupsView does not carry`);
  }
});

test('the two absent-is-not-empty flags are read before their counts are stated', () => {
  // `icp_recorded` and `severity_recorded` exist so an empty chip can be
  // explained by the right reason: "nobody recorded who these people were" is a
  // gap in the log, and "none of them was your customer" is a finding about the
  // customers. A page that states the second when the first is true is the
  // failure `verdictFor`'s header describes — confident, wrong, and
  // indistinguishable on screen from a real result.
  for (const flag of ['icp_recorded', 'severity_recorded']) {
    assert.ok(src.includes(`view.${flag}`), `the pain map never reads view.${flag}`);
  }
  // The stat tile must go to NotRecorded rather than to 0 when the field was
  // never filled in — `StatRow` renders `null` as `<NotRecorded />`.
  assert.match(src, /value: view\.icp_recorded \? icpTotal : null/,
    'the ICP tile reports a number where the honest answer is "not recorded"');
  // And the empty state must have both branches, or one of the two findings
  // above is being reported as the other.
  assert.match(src, /narrow === 'icp' && shown\.length === 0/,
    'narrowing to ICP with no match falls through to the generic empty state');
});
