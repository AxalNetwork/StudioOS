/**
 * D4644 (#4644, Portfolio audit 3/5) — the return domain and the one
 * authoritative as-of valuation mark.
 *
 * Two halves, each pinned against the thing it is supposed to fix:
 *
 *   returns     `computeFundMetrics` / `xirrDetail` tell a valid zero, a total
 *               loss and an unavailable result apart, and every unavailable
 *               result carries the reason that says which input made it so.
 *   valuation   `latestProjectMarks` over real SQLite: the reporting date is a
 *               ceiling, a correction for the same effective date wins, the
 *               order is total (so the answer never depends on row order), and
 *               a fund's scope never reads a sibling fund's mark.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_returns_valuation_4644.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import {
  computeFundMetrics, xirrDetail, rollUpPosition, type CashFlow,
} from '../src/services/portfolioMetrics.ts';
import {
  latestProjectMarks, carryingValue, MARK_PRECEDENCE, POSITION_MARK_PRECEDENCE, positionMarkIdSql,
} from '../src/services/portfolioValuation.ts';

// ---------------------------------------------------------------- returns

test('a zero return is recorded, not missing: capital back and no more is 0%', () => {
  // Mutation checked: reporting this as unavailable → state is not 'computed'.
  const m = computeFundMetrics(
    [
      { date: '2024-01-01', amount: 1000, kind: 'contribution' },
      { date: '2026-01-01', amount: 1000, kind: 'distribution' },
    ],
    0,
    '2026-01-01',
  );
  assert.equal(m.returns.irr.state, 'computed');
  assert.ok(Math.abs(m.irr!) < 0.005, `expected ~0, got ${m.irr}`);
  assert.equal(m.returns.irr.reason, null);
  assert.equal(m.dpi, 1, 'capital returned once over → DPI 1');
  assert.equal(m.returns.dpi.state, 'computed');
});

test('nothing distributed yet is a recorded DPI of zero, not an unavailable one', () => {
  // The distinction the package asks for: a zero numerator over a real
  // denominator is a fact; only a zero denominator is undefined.
  const m = computeFundMetrics(
    [{ date: '2024-01-01', amount: 500, kind: 'contribution' }],
    700,
    '2026-01-01',
  );
  assert.equal(m.dpi, 0);
  assert.equal(m.returns.dpi.state, 'computed', 'no realisations yet is still a real DPI');
  assert.equal(m.returns.rvpi.state, 'computed');
  assert.equal(m.returns.irr.state, 'computed', 'a carrying value is a terminal inflow');
});

test('a total loss is -100%, and is not confused with an unavailable return', () => {
  // Mutation checked: dropping the total-loss branch → state 'unavailable',
  // reason 'outside_bracket', which reads as "we could not work it out".
  const m = computeFundMetrics(
    [
      { date: '2024-01-01', amount: 800, kind: 'contribution' },
      { date: '2024-07-01', amount: 200, kind: 'contribution' },
    ],
    0,
    '2026-01-01',
  );
  assert.equal(m.returns.irr.state, 'total_loss');
  assert.equal(m.irr, -1);
  assert.equal(m.returns.irr.reason, null);
  assert.equal(m.tvpi, 0, 'and the ratios still read zero, not null');
});

test('a part-recovered loss is an ordinary negative rate, not a total loss', () => {
  const m = computeFundMetrics(
    [
      { date: '2024-01-01', amount: 1000, kind: 'contribution' },
      { date: '2026-01-01', amount: 250, kind: 'distribution' },
    ],
    0,
    '2026-01-01',
  );
  assert.equal(m.returns.irr.state, 'computed');
  assert.ok(m.irr !== null && m.irr < 0 && m.irr > -1, `expected a loss above -100%, got ${m.irr}`);
});

test('zero capital makes every ratio unavailable with no_paid_in, never zero', () => {
  // Mutation checked: returning 0 for a zero denominator → dpi is 0, which
  // claims a fund with no capital returned nothing, rather than that the
  // question has no answer.
  const m = computeFundMetrics(
    [{ date: '2024-01-01', amount: 400, kind: 'distribution' }],
    0,
    '2026-01-01',
  );
  for (const key of ['dpi', 'rvpi', 'tvpi', 'moic'] as const) {
    assert.equal(m.returns[key].state, 'unavailable', key);
    assert.equal(m.returns[key].reason, 'no_paid_in', key);
    assert.equal(m[key], null, key);
  }
  // The fund-level reason names the missing INPUT, the same one the ratios
  // give, rather than the solver's view of the series it was handed.
  // Mutation checked: letting the solver answer → 'single_flow', which sends
  // the reader looking for another date instead of for the missing capital.
  assert.equal(m.returns.irr.reason, 'no_paid_in', 'money back with no capital in has no rate');
  assert.equal(m.returns.irr.state, 'unavailable');
});

test('each unavailable return names the input that made it so', () => {
  // One case per reason the domain documents, so a caller can act on it.
  assert.deepEqual(pick(xirrDetail([])), ['unavailable', 'no_flows']);
  assert.deepEqual(pick(xirrDetail([{ date: '2024-01-01', amount: -100 }])), ['unavailable', 'single_flow']);
  assert.deepEqual(pick(xirrDetail([{ date: 'not-a-date', amount: -100 }])), ['unavailable', 'not_a_number']);
  assert.deepEqual(
    pick(xirrDetail([{ date: '2024-01-01', amount: 100 }, { date: '2025-01-01', amount: 50 }])),
    ['unavailable', 'no_contribution'],
    'all inflows: a return on no capital',
  );
  assert.deepEqual(
    pick(xirrDetail([{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: -50 }])),
    ['unavailable', 'outside_bracket'],
    'all outflows: no root to find',
  );
  // A rate past +1000% is noise, not a return, and says so rather than
  // reporting the bracket's edge as if it were solved.
  assert.deepEqual(
    pick(xirrDetail([{ date: '2024-01-01', amount: -1 }, { date: '2024-01-02', amount: 1_000_000 }])),
    ['unavailable', 'outside_bracket'],
  );
});

test('the IRR unit is unchanged: a one-year 100 → 110 is the fraction 0.1 (D4619)', () => {
  // The contract D4619 settled and this package must not move: the Worker
  // returns a fraction and the frontend's formatRate turns it into "10%".
  const m = computeFundMetrics(
    [
      { date: '2025-01-01', amount: 100, kind: 'contribution' },
    ] as CashFlow[],
    110,
    '2026-01-01',
  );
  assert.ok(m.irr !== null && Math.abs(m.irr - 0.1) < 0.005, `expected ~0.1, got ${m.irr}`);
  assert.equal(m.returns.irr.state, 'computed');
});

test('a recorded but negative value is unsupported, and is not read as unmarked', () => {
  // Mutation checked: folding this into `unmarked` → unsupported is null and
  // the page says "no valuation recorded" about a valuation that is recorded.
  const bad = rollUpPosition(1000, -5);
  assert.equal(bad.unsupported, 'negative_fmv');
  assert.equal(bad.fmv, 1000, 'it carries at cost, as an unmarked position does');
  assert.equal(bad.unmarked, true);
  const none = rollUpPosition(1000, null);
  assert.equal(none.unsupported, null, 'no mark at all is not "unsupported"');
  const ok = rollUpPosition(1000, 1500);
  assert.deepEqual([ok.unsupported, ok.unmarked, ok.multiple], [null, false, 1.5]);
  assert.equal(rollUpPosition(1000, 0).unsupported, null, 'a zero mark is a real write-down');
  assert.equal(rollUpPosition(1000, 0).marked_down, true);
});

const pick = (f: { state: string; reason: string | null }) => [f.state, f.reason];

// -------------------------------------------------------------- valuation

const SCHEMA = `
CREATE TABLE portfolio_marks(
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, fund_id INTEGER, project_id INTEGER NOT NULL,
  as_of_date TEXT NOT NULL, fmv REAL NOT NULL, post_money REAL, event TEXT,
  basis TEXT NOT NULL DEFAULT 'gp_estimate', source TEXT, note TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE portfolio_positions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, fund_id INTEGER, project_id INTEGER,
  position_date TEXT, created_at TEXT);
CREATE TABLE fund_position_valuations(
  id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL, valuation_date TEXT NOT NULL,
  value_cents INTEGER NOT NULL, source TEXT, recorded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
`;

/** `env` with a real SQLite D1, and a helper that records a mark. */
function fixture() {
  const { DB, db } = makeD1(SCHEMA) as any;
  const env = { DB } as any;
  let seq = 0;
  const mark = (o: {
    project: number; fund?: number | null; date: string; fmv: number; basis?: string; recorded?: string;
  }) => {
    seq += 1;
    db.prepare(
      `INSERT INTO portfolio_marks(uid, fund_id, project_id, as_of_date, fmv, basis, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`mk-${seq}`, o.fund ?? null, o.project, o.date, o.fmv, o.basis ?? 'gp_estimate',
      o.recorded ?? `2026-01-0${Math.min(9, seq)} 00:00:00`);
    return seq;
  };
  return { env, db, mark };
}

test('the reporting date is a ceiling: a later mark never prices an earlier read', async () => {
  const f = fixture();
  f.mark({ project: 1, date: '2025-03-31', fmv: 100 });
  f.mark({ project: 1, date: '2025-09-30', fmv: 400 });
  const q1 = await latestProjectMarks(f.env, { projectIds: [1], asOf: '2025-06-30', scope: { kind: 'firm' } });
  assert.equal(q1.get(1)!.fmv, 100, 'a June read cannot see the September mark');
  assert.equal(q1.get(1)!.as_of_date, '2025-03-31');
  const now = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'firm' } });
  assert.equal(now.get(1)!.fmv, 400, 'with no ceiling, the latest mark stands');
});

test('a correction for the same effective date wins, and the order is total', async () => {
  // THE DEFECT THIS PACKAGE FIXES. The old read grouped MAX(as_of_date) and
  // then selected bare columns, so with two marks on one effective date SQLite
  // returned either row's value. Mutation checked: ordering by as_of_date
  // alone → this assertion fails on the corrected figure.
  const f = fixture();
  f.mark({ project: 1, date: '2025-03-31', fmv: 100, recorded: '2026-01-01 09:00:00' });
  f.mark({ project: 1, date: '2025-03-31', fmv: 125, recorded: '2026-01-02 09:00:00' });
  const got = await latestProjectMarks(f.env, { projectIds: [1], asOf: '2025-06-30', scope: { kind: 'firm' } });
  assert.equal(got.get(1)!.fmv, 125, 'the correction is the authoritative figure');

  // And the same answer however the rows were inserted: recorded later still
  // wins even when it carries the lower id.
  const g = fixture();
  g.mark({ project: 2, date: '2025-03-31', fmv: 70, recorded: '2026-02-02 09:00:00' });
  g.mark({ project: 2, date: '2025-03-31', fmv: 60, recorded: '2026-02-01 09:00:00' });
  const second = await latestProjectMarks(g.env, { projectIds: [2], asOf: null, scope: { kind: 'firm' } });
  assert.equal(second.get(2)!.fmv, 70, 'created_at decides before id does');
});

test('marks recorded at the same instant on the same date still resolve deterministically', async () => {
  // The last tie-break: same effective date, same recorded time. `id` settles
  // it, so two readers of the same data never disagree.
  const f = fixture();
  f.mark({ project: 1, date: '2025-03-31', fmv: 10, recorded: '2026-01-01 09:00:00' });
  f.mark({ project: 1, date: '2025-03-31', fmv: 20, recorded: '2026-01-01 09:00:00' });
  for (let i = 0; i < 3; i += 1) {
    const got = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'firm' } });
    assert.equal(got.get(1)!.fmv, 20, 'the later row wins, on every read');
  }
  assert.match(MARK_PRECEDENCE, /as_of_date DESC, created_at DESC, id DESC/);
  assert.match(POSITION_MARK_PRECEDENCE, /valuation_date DESC, created_at DESC, id DESC/);
});

test("a fund's scope reads its own marks and firm-level ones, never a sibling fund's", async () => {
  // Mutation checked: dropping the fund predicate → fund 10 reads 999.
  const f = fixture();
  f.mark({ project: 1, fund: 10, date: '2025-03-31', fmv: 100 });
  f.mark({ project: 1, fund: 20, date: '2025-06-30', fmv: 999 });
  const ten = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'fund', fundId: 10 } });
  assert.equal(ten.get(1)!.fmv, 100, "fund 20's later mark is not fund 10's value");
  assert.equal(ten.get(1)!.fund_id, 10);
  const twenty = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'fund', fundId: 20 } });
  assert.equal(twenty.get(1)!.fmv, 999);
});

test('a firm-level mark is a fallback for a fund with none of its own', async () => {
  const f = fixture();
  f.mark({ project: 1, fund: null, date: '2025-03-31', fmv: 50 });
  const ten = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'fund', fundId: 10 } });
  assert.deepEqual([ten.get(1)!.fmv, ten.get(1)!.fund_id], [50, null]);
});

test('in the aggregate a firm-level mark wins outright over a fund\'s', async () => {
  // Mutation checked: dropping the scope's preference key from the ORDER BY →
  // the later-recorded fund row answers for the whole book (fmv 100, fund 10).
  const f = fixture();
  f.mark({ project: 1, fund: 10, date: '2025-03-31', fmv: 100, recorded: '2026-01-05 09:00:00' });
  f.mark({ project: 1, fund: null, date: '2025-03-31', fmv: 90, recorded: '2026-01-01 09:00:00' });
  // The firm-level row is the OLDER of the two, so this also pins that the
  // scope's preference is read before the correction keys: it speaks for the
  // whole book, and a single fund's figure for the same date does not displace
  // or dispute it.
  const firm = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'firm' } });
  assert.equal(firm.get(1)!.conflict, null);
  assert.equal(firm.get(1)!.fund_id, null);
  assert.equal(firm.get(1)!.fmv, 90);
  // And the mirror image: inside fund 10's own scope its own mark is the more
  // specific record, so it wins over the firm-level one on that date.
  const ten = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'fund', fundId: 10 } });
  assert.deepEqual([ten.get(1)!.fmv, ten.get(1)!.fund_id], [100, 10]);
});

test('two funds disagreeing on one date is unavailable in the aggregate, not an arbitrary pick', async () => {
  // Mutation checked: taking the first row and ignoring the runner-up → the
  // conflict is null and one fund's carrying value is published as the firm's.
  const f = fixture();
  f.mark({ project: 1, fund: 10, date: '2025-03-31', fmv: 100 });
  f.mark({ project: 1, fund: 20, date: '2025-03-31', fmv: 160 });
  const firm = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'firm' } });
  assert.equal(firm.get(1)!.conflict, 'fund_marks_conflict');
  const carried = carryingValue(firm.get(1));
  assert.equal(carried.fmv, null, 'no carrying value is published');
  assert.equal(carried.unavailable_reason, 'fund_marks_conflict');
  // A position with a disputed mark carries at cost, like an unmarked one.
  assert.equal(rollUpPosition(1000, carried.fmv).fmv, 1000);
});

test('an older mark from another fund is superseded, not a conflict', async () => {
  const f = fixture();
  f.mark({ project: 1, fund: 20, date: '2025-01-31', fmv: 160 });
  f.mark({ project: 1, fund: 10, date: '2025-03-31', fmv: 100 });
  const firm = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'firm' } });
  assert.equal(firm.get(1)!.conflict, null, 'only the same effective date is a disagreement');
  assert.equal(firm.get(1)!.fmv, 100);
});

test('two rows from the SAME fund on one date are a correction, not a conflict', async () => {
  const f = fixture();
  f.mark({ project: 1, fund: 10, date: '2025-03-31', fmv: 100, recorded: '2026-01-01 09:00:00' });
  f.mark({ project: 1, fund: 10, date: '2025-03-31', fmv: 115, recorded: '2026-01-02 09:00:00' });
  const firm = await latestProjectMarks(f.env, { projectIds: [1], asOf: null, scope: { kind: 'firm' } });
  assert.equal(firm.get(1)!.conflict, null);
  assert.equal(firm.get(1)!.fmv, 115);
});

test('carryingValue keeps no mark, a disputed mark and a negative mark apart', () => {
  assert.equal(carryingValue(null).unavailable_reason, 'no_mark');
  assert.equal(carryingValue(undefined).unavailable_reason, 'no_mark');
  const base = { as_of_date: '2025-03-31', basis: 'gp_estimate', fund_id: null, conflict: null } as const;
  assert.deepEqual(carryingValue({ ...base, fmv: 12 }), { fmv: 12, unavailable_reason: null });
  assert.equal(carryingValue({ ...base, fmv: 0 }).fmv, 0, 'a zero mark is a value');
  assert.equal(carryingValue({ ...base, fmv: -1 }).unavailable_reason, 'negative_fmv');
  assert.equal(carryingValue({ ...base, fmv: Number.NaN }).unavailable_reason, 'negative_fmv');
});

test('the shared position-mark subquery picks the corrected row, for every consumer', async () => {
  // The fund board and the fund's performance read both build their join from
  // `positionMarkIdSql`, so this is the rule both of them follow.
  const f = fixture();
  f.db.prepare(`INSERT INTO portfolio_positions(id, fund_id, project_id) VALUES (201, 10, 1)`).run();
  const add = (date: string, cents: number, recorded: string) => f.db.prepare(
    `INSERT INTO fund_position_valuations(position_id, valuation_date, value_cents, source, recorded_by, created_at)
     VALUES (201, ?, ?, 'test', 1, ?)`).run(date, cents, recorded);
  add('2025-03-31', 10_000, '2026-01-01 09:00:00');
  add('2025-03-31', 12_500, '2026-01-02 09:00:00'); // the correction
  add('2025-09-30', 40_000, '2026-01-03 09:00:00'); // after the read date
  const row = await f.env.DB.prepare(
    `SELECT v.value_cents, v.valuation_date FROM portfolio_positions p
       LEFT JOIN fund_position_valuations v ON v.id = ${positionMarkIdSql('p.id')}
      WHERE p.id = 201`).bind('2025-06-30').first<any>();
  assert.equal(Number(row.value_cents), 12_500, 'the correction, and not the September mark');
  assert.equal(row.valuation_date, '2025-03-31');
});

test('an empty project scope reads nothing and asks the database nothing', async () => {
  const f = fixture();
  f.mark({ project: 1, date: '2025-03-31', fmv: 100 });
  const got = await latestProjectMarks(f.env, { projectIds: [], asOf: null, scope: { kind: 'firm' } });
  assert.equal(got.size, 0);
});
