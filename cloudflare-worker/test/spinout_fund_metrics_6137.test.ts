/**
 * D6137 (#6137) — GET /api/spinout-lab/fund-metrics draws no fund figure
 * without a record, and a visitor's response carries no field reserved for
 * committed LPs. Real route over the migrated schema (node:sqlite); every value
 * is invented.
 *
 *   · a visitor (the investor licence, no committed LP row) gets the headline
 *     only: `available`, `target`, `close`. No `raise`, no `portfolio`, and no
 *     committed / lp_count / positions / MOIC key anywhere in the fund block;
 *   · a committed LP gets the headline plus the raise and the portfolio,
 *     computed from `limited_partners`, `portfolio_positions` and
 *     `portfolio_marks`;
 *   · a figure with no record answers `available: false` (no target, no
 *     positions, an unmarked company, the reserve);
 *   · the first close keeps "date passed; outcome not recorded".
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/spinout_fund_metrics_6137.test.ts
 */
import test, { after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { insertRow } from './_lab_evidence.ts';
import spinoutLab from '../src/routes/spinout_lab.ts';
import { HEADLINE_KEYS, summarizePortfolio } from '../src/services/spinoutFundMetrics.ts';

afterAll(() => removeMigratedDatabases());
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const VISITOR = 701, LP = 702, APPLICANT = 703, ADMIN = 704;
const FUND = 70;

function world({ sizeCents = 2_000_000_000, positions = true, markAll = true } = {}): DatabaseSync {
  const db = migratedDatabase();
  for (const [id, role] of [[VISITOR, 'investor'], [LP, 'investor'], [APPLICANT, 'investor'], [ADMIN, 'admin']] as const) {
    db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, 'Synthetic Person', ?, 1)`)
      .run(id, role, `u${id}@example.test`);
  }
  insertRow(db, 'vc_funds', { id: FUND, name: 'Synthetic Fund', slug: 'spinout-fund-i', fund_size_cents: sizeCents });
  // The committed LP, and an applicant whose row carries no commitment yet.
  insertRow(db, 'limited_partners', { user_id: LP, fund_id: FUND, commitment_amount: 300_000, lpa_signed: 1 });
  insertRow(db, 'limited_partners', { user_id: APPLICANT, fund_id: FUND, commitment_amount: 0, lpa_signed: 0 });
  insertRow(db, 'limited_partners', { user_id: null, fund_id: FUND, commitment_amount: 100_000, lpa_signed: 0, email: 'other@example.test' });
  if (positions) {
    insertRow(db, 'projects', { id: 81, name: 'Alpha Co' });
    insertRow(db, 'projects', { id: 82, name: 'Beta Co' });
    insertRow(db, 'portfolio_positions', { uid: 'p1', fund_id: FUND, project_id: 81, round_name: 'Pre-Seed', invested_amount: 150_000, position_date: '2026-03-01' });
    insertRow(db, 'portfolio_positions', { uid: 'p2', fund_id: FUND, project_id: 82, round_name: 'Pre-Seed', invested_amount: 100_000, position_date: '2026-04-01' });
    insertRow(db, 'portfolio_positions', { uid: 'p3', fund_id: FUND, project_id: 81, round_name: 'Seed', invested_amount: 50_000, position_date: '2026-07-01' });
    insertRow(db, 'portfolio_marks', { uid: 'm1', fund_id: FUND, project_id: 81, as_of_date: '2026-06-30', fmv: 300_000 });
    insertRow(db, 'portfolio_marks', { uid: 'm2', fund_id: FUND, project_id: 81, as_of_date: '2026-09-30', fmv: 400_000 });
    if (markAll) insertRow(db, 'portfolio_marks', { uid: 'm3', fund_id: FUND, project_id: 82, as_of_date: '2026-08-31', fmv: 125_000 });
  }
  return db;
}

async function get(db: DatabaseSync, who: number) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
    .setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await spinoutLab.request('/fund-metrics', { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: (await res.json()) as any };
}

const LP_ONLY = /committed|soft_circled|lp_count|median_commitment|positions|invested|held|follow_ons|reserve|gross_moic|raise|portfolio/;

test('#6137 a visitor gets the headline keys and nothing reserved for LPs', async () => {
  const db = world();
  try {
    for (const who of [VISITOR, APPLICANT]) {
      const { status, body } = await get(db, who);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body.fund).sort(), [...HEADLINE_KEYS].sort(), `user ${who} sees only the headline`);
      assert.doesNotMatch(JSON.stringify(body.fund), LP_ONLY, 'no LP-reserved key, not even as null');
      assert.deepEqual(body.fund.target, { available: true, value: 20_000_000 });
      assert.equal(body.fund.close.first_close_date, '2026-09-15');
      assert.equal(body.fund.close.outcome_recorded, false);
    }
  } finally { db.close(); }
});

test('#6137 a committed LP gets the raise and the portfolio from the records', async () => {
  const db = world();
  try {
    for (const who of [LP, ADMIN]) {
      const { body } = await get(db, who);
      assert.deepEqual(Object.keys(body.fund).sort(), ['available', 'close', 'portfolio', 'raise', 'target']);
      assert.equal(body.fund.raise.available, true);
      assert.equal(body.fund.raise.committed, 300_000, 'countersigned commitments only');
      assert.equal(body.fund.raise.soft_circled, 100_000);
      assert.equal(body.fund.raise.lp_count, 3);
      const p = body.fund.portfolio;
      assert.equal(p.available, true);
      assert.deepEqual(p.positions, { available: true, value: 2 }, 'two companies, three position rows');
      assert.deepEqual(p.invested, { available: true, value: 300_000 });
      assert.deepEqual(p.held, { available: true, value: 525_000 }, 'each company at its latest mark');
      assert.deepEqual(p.follow_ons, { available: true, count: 1, amount: 50_000 });
      assert.equal(p.gross_moic.available, true);
      assert.equal(p.gross_moic.value, 1.75);
      assert.deepEqual(p.as_of, { available: true, value: '2026-09-30' });
      assert.equal(p.reserve.available, false, 'no store records the reserve');
      assert.equal(p.reserve.value, null);
    }
  } finally { db.close(); }
});

test('#6137 no record answers available:false, never a figure', async () => {
  const db = world({ sizeCents: 0, positions: false });
  try {
    const { body } = await get(db, LP);
    assert.deepEqual(body.fund.target, { available: false, value: null, reason: 'no_target_record' });
    const p = body.fund.portfolio;
    assert.equal(p.available, false);
    for (const k of ['positions', 'invested', 'held', 'gross_moic', 'reserve']) {
      assert.equal(p[k].available, false, `${k} has no record`);
      assert.equal(p[k].value, null);
    }
    assert.equal(p.follow_ons.count, null);
    assert.equal(p.as_of.value, null);
    const visitor = await get(db, VISITOR);
    assert.deepEqual(visitor.body.fund.target, { available: false, value: null, reason: 'no_target_record' });
  } finally { db.close(); }
});

test('#6137 a company with no mark leaves the held total and MOIC unrecorded', async () => {
  const db = world({ markAll: false });
  try {
    const p = (await get(db, LP)).body.fund.portfolio;
    assert.deepEqual(p.held, { available: false, value: null, reason: 'unmarked_positions' });
    assert.equal(p.gross_moic.available, false);
    assert.deepEqual(p.invested, { available: true, value: 300_000 }, 'invested is still recorded');
  } finally { db.close(); }
});

test('#6137 no fund row: the headline says so and nobody gets LP fields', async () => {
  const db = migratedDatabase();
  try {
    db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Synthetic', 'a@example.test', 1)`).run(ADMIN);
    const { body } = await get(db, ADMIN);
    assert.deepEqual(Object.keys(body.fund).sort(), [...HEADLINE_KEYS].sort());
    assert.equal(body.fund.available, false);
    assert.equal(body.fund.target.reason, 'no_fund_record');
  } finally { db.close(); }
});

test('#6137 follow-ons are the rows after a company\'s first, by date then id', () => {
  const s = summarizePortfolio([
    // The later-dated row has the LOWER id: the date decides, not the id.
    { id: 1, project_id: 1, invested_amount: 50, position_date: '2026-05-01' },
    { id: 2, project_id: 1, invested_amount: 100, position_date: '2026-01-01' },
    { id: 3, project_id: 2, invested_amount: 70, position_date: null },
  ], []);
  assert.deepEqual(s.follow_ons, { available: true, count: 1, amount: 50 });
  assert.deepEqual(s.held, { available: false, value: null, reason: 'no_mark_records' });
  assert.deepEqual(s.as_of, { available: true, value: '2026-05-01' });
});
