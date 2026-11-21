/**
 * #6025 (D6025) — Prototype / MVP's burn-up draws inside one month.
 *
 * Through `routes/cycle_build.ts` over the real migrated schema (`_build_reads.ts`):
 *   1. three must-haves done in three different weeks of one month draw a line
 *      with ISO week labels, and the Ship mark lands in date order;
 *   2. completions in fewer than three weeks but on three days draw by day;
 *   3. fewer than three dated completions (two days, three on one day, or two
 *      real days beside an empty and a malformed done_at) still read the too-little sentence, and no point is
 *      invented;
 *   4. completions in three months or more still draw by month, as before;
 *   5. the grain changes no statement: the overview and the module page run the
 *      same statements by month, by week and by day, one grouped scan each;
 *   6. `burnupPoints` on its own: ISO weeks across a year end, real days only.
 *
 * Every date is fixed; nothing reads the clock. Every venture and must-have is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_burnup_weekly_6025.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, PROJECT } from './_build_reads.ts';
import { burnupPoints } from '../src/routes/cycle_build.ts';

const TOO_LITTLE = 'Fewer than three completion dates are recorded.';

let h: Awaited<ReturnType<typeof buildReads>>;
before(async () => { h = await buildReads(0); });
after(() => h?.close());

/** The venture's must-haves, replaced: done on `doneAt`, one open must-have beside them, and a ship date. */
function venture(doneAt: string[], ship: string | null) {
  h.db.prepare('DELETE FROM mvp_features WHERE project_id = ?').run(PROJECT);
  h.db.prepare('UPDATE projects SET mvp_target_date = ? WHERE id = ?').run(ship, PROJECT);
  // Every done_at is given: the insert trigger dates a Done row with none from created_at, the clock.
  const feat = h.db.prepare(`INSERT INTO mvp_features(project_id, title, is_must_have, delivery_status, sort_order, done_at) VALUES (?, ?, 1, ?, ?, ?)`);
  doneAt.forEach((at, i) => feat.run(PROJECT, `Synthetic must ${i + 1}`, 'Done', i + 1, at));
  feat.run(PROJECT, 'Synthetic open must', 'Backlog', 99, null);
}
const modulePage = () => h.get(`/api/cycles/build/modules/prototype-mvp?project=${PROJECT}`);
const overview = () => h.get(`/api/cycles/build/overview?project=${PROJECT}`);
const line = (card: any) => card.series.find((s: any) => s.kind === 'line');
const labels = (spec: any) => spec.labels.map((l: any) => l.label);

test('1. three must-haves done in three weeks of one month draw a line with week labels; Ship lands in date order', async () => {
  // Mutation checked: the week fallback removed → day labels; the week counted from its Monday, not its
  // Thursday → W44, W45, W47; the scan grouped by month again → too_little; the Ship point not sorted in → the
  // mark sits last.
  // 2026-11-03 is in W45, 2026-11-11 in W46, 2026-11-26 in W48; Ship on 2026-11-20 falls between W47's Monday and W48's.
  venture(['2026-11-03 10:00:00', '2026-11-11', '2026-11-26T09:30:00Z'], '2026-11-20');
  const r = await modulePage();
  assert.equal(r.status, 200);
  assert.equal(r.body.card.state, 'ok');
  assert.equal(r.body.card.reason, null);
  const spec = line(r.body.card);
  assert.deepEqual(labels(spec), ['W45', 'W46', 'Ship', 'W48']);
  assert.deepEqual(spec.values, [1, 2, null, 3]);
  assert.equal(spec.target, 4);
  assert.equal(spec.mark, 2);
  assert.equal(spec.mark_label, 'Ship 2026-11-20');
  // The overview's card is the same card.
  const o = await overview();
  assert.deepEqual(o.body.cards.find((c: any) => c.slug === 'prototype-mvp').series, r.body.card.series);
});

test('2. completions in two weeks but on three days draw by day', async () => {
  // Mutation checked: the day fallback removed → too_little; day labels as ISO dates → '9 Nov' differs.
  // 2026-11-09 and 2026-11-12 are both in W46, 2026-11-16 in W47: two weeks, three days. Ship before them all.
  venture(['2026-11-09', '2026-11-12', '2026-11-12', '2026-11-16'], '2026-11-01');
  const spec = line((await modulePage()).body.card);
  assert.deepEqual(labels(spec), ['Ship', '9 Nov', '12 Nov', '16 Nov']);
  assert.deepEqual(spec.values, [null, 1, 3, 4]);
  assert.equal(spec.mark, 0);
});

test('3. fewer than three dated completions still read the too-little sentence', async () => {
  // Mutation checked: malformed days not skipped → the third case's read fails. (A fallback taken at two
  // points still draws no line: the series needs three, and test 6 pins the fold.)
  for (const doneAt of [['2026-11-03', '2026-11-20'], ['2026-11-12 08:00:00', '2026-11-12 09:00:00', '2026-11-12'], ['2026-11-03', '2026-11-20', '', '2026-11-xx']]) {
    venture(doneAt, '2026-11-30');
    const r = await modulePage();
    assert.equal(r.body.card.state, 'too_little', JSON.stringify(doneAt));
    assert.equal(r.body.card.reason, TOO_LITTLE);
    assert.deepEqual(r.body.card.series, []);
    assert.equal(r.body.facts.done, doneAt.length);
  }
});

test('4. completions in three months or more still draw by month', async () => {
  // Mutation checked: weeks tried before months → W labels here.
  venture(['2026-07-30', '2026-08-03', '2026-09-01', '2026-09-02'], '2026-08-15');
  const spec = line((await modulePage()).body.card);
  assert.deepEqual(labels(spec), ['2026-07', '2026-08', 'Ship', '2026-09']);
  assert.deepEqual(spec.values, [1, 2, null, 4]);
  assert.equal(spec.mark, 2);
});

test('5. the grain changes no statement: the same statements by month, week and day, one grouped scan', async () => {
  // Mutation checked: a statement added only when the line is by week → the week venture runs one more.
  // The overview's absolute budget is build_read_amplification_4603's.
  const grains = { month: ['2026-07-02', '2026-08-02', '2026-09-02'], week: ['2026-11-03', '2026-11-11', '2026-11-26'], day: ['2026-11-09', '2026-11-12', '2026-11-16'] };
  const counts: Record<string, number[]> = {};
  for (const [grain, doneAt] of Object.entries(grains)) {
    venture(doneAt, '2026-12-01');
    const o = await overview(), m = await modulePage();
    assert.equal(o.body.cards.find((c: any) => c.slug === 'prototype-mvp').state, 'ok', grain);
    const scans = (log: Array<{ sql: string }>) => log.filter((s) => /^SELECT g\.status, g\.hypothesis_id/.test(s.sql)).length;
    assert.equal(scans(o.log), 1, `${grain}: one grouped scan on the overview`);
    assert.equal(scans(m.log), 1, `${grain}: one grouped scan on the module page`);
    counts[grain] = [o.statements, m.statements];
  }
  assert.deepEqual(counts.week, counts.month);
  assert.deepEqual(counts.day, counts.month);
});

test('6. burnupPoints: ISO weeks across a year end, real days only, counts per period', () => {
  // Mutation checked: the week's year taken from its Monday, not its Thursday → 2024-12-30 reads W53; weeks
  // keyed by day, not Monday → 2026-12-31 and 2027-01-01 are two points; malformed days not skipped → throws;
  // the day fold taken at two days → the malformed case returns days, not months.
  // 2026 has 53 ISO weeks: 2026-12-28 to 2027-01-03 is W53, 2027-01-04 starts W01, 2026-12-21 is W52.
  assert.deepEqual(burnupPoints([['2026-12-21', 1], ['2026-12-31', 2], ['2027-01-01', 1], ['2027-01-05', 3]]), [
  { date: '2026-12-21', label: 'W52', n: 1 }, { date: '2026-12-28', label: 'W53', n: 3 }, { date: '2027-01-04', label: 'W01', n: 3 }]);
  // 2024-12-30 is a Monday whose Thursday is in 2025: W01 of 2025.
  assert.deepEqual(burnupPoints([['2024-12-30', 1], ['2025-01-08', 1], ['2025-01-15', 1]]).map((p) => p.label), ['W01', 'W02', 'W03']);
  // A malformed day is in no week and on no day: two real days are too few, and the months (two) come back.
  assert.deepEqual(burnupPoints([['2026-11-03', 1], ['2026-11-31', 1], ['2026-11-xx', 1], ['2026-12-01', 1]]).map((p) => p.label), ['2026-11', '2026-12']);
  assert.deepEqual(burnupPoints([]), []);
});
