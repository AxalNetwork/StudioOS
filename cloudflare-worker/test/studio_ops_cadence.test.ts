/**
 * Studio Ops cadence service (services/studioOpsCadence.ts) — the validation
 * and state transitions behind /api/spinout-lab/studio-ops.
 *
 * Imports the source module directly (pure TS, no Hono/db/auth), same as
 * advisor.scenarios.test.ts.
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/studio_ops_cadence.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CADENCE_DAYS,
  REVIEW_FIELDS,
  MAX_CADENCE_ITEMS,
  defaultCadence,
  emptyReview,
  seedCadence,
  lockCadence,
  parseCadence,
  parseReview,
  readJsonColumn,
  reviewHasContent,
} from '../src/services/studioOpsCadence';

// ---------------------------------------------------------------- defaults

test('defaultCadence: every row is Proposed or Optional — nothing ships pre-committed', () => {
  const items = defaultCadence();
  assert.ok(items.length >= 3);
  for (const it of items) {
    assert.notEqual(it.tag, 'Set', `"${it.name}" must not ship as an already-made commitment`);
    assert.ok(CADENCE_DAYS.includes(it.day));
    assert.ok(it.name && it.agenda, 'starter rows carry name + agenda');
  }
  // Owners are roles, never invented people.
  for (const it of items) {
    assert.match(it.owner, /founder|advisor|Solo/i, `"${it.owner}" must be a role, not a name`);
  }
});

// ---------------------------------------------------------------- seeding

test('seedCadence: null/empty previous → the starter cadence', () => {
  assert.deepEqual(seedCadence(null), defaultCadence());
  assert.deepEqual(seedCadence([]), defaultCadence());
});

test('seedCadence: previous week carries forward with Set demoted to Proposed', () => {
  const prev = lockCadence(defaultCadence());
  assert.ok(prev.some((it) => it.tag === 'Set'), 'precondition: something was locked');
  const next = seedCadence(prev);
  assert.equal(next.length, prev.length);
  for (const it of next) {
    assert.notEqual(it.tag, 'Set', 'a new week must be re-committed explicitly, not inherited');
  }
  // Optional rows stay optional through the carry-forward.
  const optBefore = prev.filter((i) => i.tag === 'Optional').length;
  const optAfter = next.filter((i) => i.tag === 'Optional').length;
  assert.equal(optAfter, optBefore);
});

// ---------------------------------------------------------------- locking

test('lockCadence: promotes Proposed → Set and leaves Optional alone', () => {
  const locked = lockCadence(defaultCadence());
  assert.ok(locked.every((it) => it.tag !== 'Proposed'), 'no proposals survive a lock');
  assert.ok(locked.some((it) => it.tag === 'Optional'), 'the optional reflection is not force-committed');
});

// ---------------------------------------------------------------- parsing

test('parseCadence: non-array and oversize payloads are rejected, not repaired', () => {
  assert.equal(parseCadence(null).ok, false);
  assert.equal(parseCadence('nope').ok, false);
  assert.equal(parseCadence({}).ok, false);
  const too = Array.from({ length: MAX_CADENCE_ITEMS + 1 }, (_, i) => ({ name: `m${i}` }));
  assert.equal(parseCadence(too).ok, false);
});

test('parseCadence: normalises fields and drops nameless rows', () => {
  const r = parseCadence([
    { name: 'Standup', day: 'Wed', time: '9:5', owner: 'Both', agenda: 'a', tag: 'Set' },
    { name: '', day: 'Mon' }, // nameless → dropped
    { name: 'Weird', day: 'Caturday', time: '25:00', tag: 'Sneaky' },
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.length, 2, 'the nameless row is gone');
  const [a, b] = r.value;
  assert.equal(a.time, '09:05', '9:5 normalises to zero-padded 24h');
  assert.equal(a.tag, 'Set');
  assert.equal(b.day, 'Mon', 'unknown day falls back to Mon');
  assert.equal(b.time, '', 'impossible time stores as empty, never as junk text');
  assert.equal(b.tag, 'Proposed', 'unknown tag falls back to Proposed');
});

test('parseCadence: ids are re-derived server-side — client ids cannot collide keys', () => {
  const r = parseCadence([
    { id: 'same', name: 'A' },
    { id: 'same', name: 'B' },
  ]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.notEqual(r.value[0].id, r.value[1].id);
});

test('parseCadence: over-long text is truncated rather than failing the save', () => {
  const r = parseCadence([{ name: 'x'.repeat(500), agenda: 'y'.repeat(500) }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value[0].name.length, 80);
  assert.equal(r.value[0].agenda.length, 240);
});

// ---------------------------------------------------------------- review

test('parseReview: keeps the four known fields, drops everything else', () => {
  const parsed = parseReview({ shipped: ' a ', slipped: 'b', bogus: 'c', next: 1 });
  assert.deepEqual(Object.keys(parsed).sort(), [...REVIEW_FIELDS].sort());
  assert.equal(parsed.shipped, 'a', 'trimmed');
  assert.equal(parsed.next, '', 'non-string coerces to empty, never to "1"');
  assert.equal('bogus' in parsed, false);
});

test('reviewHasContent: empty review is empty; any field counts', () => {
  assert.equal(reviewHasContent(emptyReview()), false);
  assert.equal(reviewHasContent({ ...emptyReview(), changed: 'x' }), true);
});

// ---------------------------------------------------------------- storage

test('readJsonColumn: damaged or missing stored JSON degrades to the fallback', () => {
  assert.deepEqual(readJsonColumn('not json', []), []);
  assert.deepEqual(readJsonColumn(null, { a: 1 }), { a: 1 });
  assert.deepEqual(readJsonColumn('', 'fb'), 'fb');
  assert.deepEqual(readJsonColumn('null', 'fb'), 'fb');
  assert.deepEqual(readJsonColumn('[{"x":1}]', []), [{ x: 1 }]);
});
