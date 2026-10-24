/**
 * A zone header action must be backed all the way to a worker route.
 *
 * WHAT THIS EXISTS TO STOP. This repo has shipped a button that 404s before:
 * Trust Center's KYB card posted to `POST /trust/kyb/submit`, a route the worker
 * has never declared, and CI stayed green only because
 * `scripts/api-drift-baseline.json` suppressed it. A founder filled in the form,
 * pressed submit, and got nothing. The zone action rows are the same shape of
 * risk, multiplied.
 *
 * D704 (#1666) DELETED THE CHAIN THIS FILE WAS BUILT AROUND. Its subject was
 * Validate's four zones: every `kind: 'handler'` op the founder table declared
 * for `/validate/*` was supplied by `FounderValidateWorkspace`, and every `api.*`
 * those handlers named existed. The zones became module pages, the workspace is
 * gone, and so are the assertions that read it. What stays is general: the
 * builder's handler rules, the rendered `ZoneActions`, the hypothesis dialogs
 * #1659 still mounts, and the two Validate promises below, moved to where the
 * controls live now.
 *
 * The interesting half is still the NEGATIVE one. `Send to Problem slide` is
 * drawn on two artboards and must never become a button that sends: the pain
 * themes already feed the deck. It is a LINK to the slide, under a label that
 * does not say "send" — on Problem discovery's section now.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { makeZoneActions } from '../src/workspaces/zoneActionBuilder.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

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

test('the retire control is the hypothesis record\'s Edit, and it restores as well as retires', () => {
  // Migration 211 created `hypotheses.retired_at` FOR the canvas's "Retired"
  // filter. The old board's toggle was its only caller; since D704 the caller is
  // the hypothesis record's Edit (#1692), through the same writer the PATCH
  // route uses. Retire AND restore: a claim that cannot come back is a delete
  // wearing a softer word, so the field reads the stored state and an unticked
  // box sends false.
  const records = codeOnly(read('cloudflare-worker/src/services/records/validate.ts'));
  assert.match(records, /\{ key: 'retired', label: 'Retired', kind: 'CK', options: opts\(\[\['true', 'Retire this hypothesis'\]\]\), value: h\.retired_at \? \['true'\] : \[\] \}/,
    'the record no longer offers Retire, so `retired_at` is write-only again');
  assert.match(records, /retired: flag\('retired'\),/, 'the Edit no longer passes Retire to the writer');
  assert.match(records, /return Array\.isArray\(v\) \? v\.includes\('true'\) : v === true \|\| v === 'true';/,
    'an unticked box must read as false, or a retired claim cannot be restored');
});

test('"Send to Problem slide" is a link to the slide, never a button that sends', () => {
  // The canvas gave it to Pain map and Verdict, and the verb is the problem:
  // the pain themes ALREADY feed the deck's slide 2, since `pain_groups` is
  // curated for exactly that. A button that "sends" would be a control over a
  // pipe that already runs. Since D704 the op lives on Problem discovery's
  // section (#1659), which validate_sections_d697 test 2 renders.
  const sections = codeOnly(read('frontend/src/pages/cycles/ValidateSections.jsx'));
  assert.match(sections, /<Link to="\/raise\/pitch\/edit" title=\{PROBLEM_SLIDE_NOTE\}[^>]*>Open the Problem slide<\/Link>/,
    'the Problem slide op is no longer a link to the deck');
  assert.doesNotMatch(sections, /Send to Problem slide/, 'the canvas verb is back on a control, and the control does not send');
  assert.doesNotMatch(sections, /<button[^>]*>[^<]*Problem slide/, 'a "send" button over a feed that is already live must not ship');
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
