/**
 * D5950 (#5950) — the Revenue read model: every metric in one envelope, with its source, period, currencies, last
 * reconciliation, incomplete rows and coverage gap. Each metric is checked with an empty store, a partial store and a
 * failed read, and none of them may turn missing data into 0. Part 2 wires the last two: revenue per subsidiary from the
 * branches' measured gross (#5947) and AI billed, cost and margin per licence from the licence on AI runs (#5948).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from '../src/types.ts';
import { quarterFromKey } from '../src/routes/admin_revenue.ts';
import { FINANCIAL_EVENTS_DDL, writeFinancialEvent, setReconciliationState } from '../src/services/financialEvents.ts';
import type { FinancialEventRow } from '../src/services/financialEvents.ts';
import { subscriptionRevenue } from '../src/services/subscriptionRevenue.ts';
import {
  aiMarginPerLicenceMetric, coverageFor, licenceInvoicesMetric, promoIssuedMetric, refundsAndDisputesMetric,
  revenuePerSubsidiaryMetric, revenueReadModel, subscriptionRevenueMetric,
} from '../src/services/revenueReadModel.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';

const Q4 = quarterFromKey('2026-Q4')!;
const Q3 = quarterFromKey('2026-Q3')!;
// A fixed instant inside Q4 2026: the promo states read "current period" and staleness from it.
const NOW = new Date('2026-11-16T12:00:00Z');
const ENVELOPE_KEYS = [
  'coverage', 'currencies', 'incomplete_detail', 'incomplete_rows', 'key', 'label', 'last_reconciled_at',
  'last_reconciled_basis', 'pending_issue', 'period', 'reason', 'source', 'state', 'values',
];

function db(opts: { ledger?: string | null; promo?: boolean } = {}) {
  const sql = new DatabaseSync(':memory:');
  const coverage = opts.ledger === undefined ? '2026-10-01T00:00:00Z' : opts.ledger;
  if (coverage !== null) {
    for (const statement of FINANCIAL_EVENTS_DDL) {
      if (statement.startsWith('INSERT OR IGNORE INTO financial_event_coverage')) {
        const insert = sql.prepare('INSERT INTO financial_event_coverage (source, coverage_starts_at) VALUES (?, ?)');
        insert.run('stripe', coverage);
        insert.run('hq', coverage);
      } else sql.exec(statement);
    }
  }
  if (opts.promo !== false) {
    sql.exec(`CREATE TABLE territory_licences (uid TEXT PRIMARY KEY, licence_ref TEXT, brand_name TEXT, status TEXT NOT NULL DEFAULT 'active')`);
    sql.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8'));
    sql.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611161359_5947_usage_report_source.sql'), 'utf8'));
    sql.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611150136_5949_promo_issued_reports.sql'), 'utf8'));
  }
  return { sql, env: { DB: d1Over(sql) } as Env };
}

function event(id: string, o: Partial<FinancialEventRow> = {}): FinancialEventRow {
  return {
    source: 'stripe', source_event_id: id, source_event_type: 'invoice.paid', kind: 'invoice', livemode: 1,
    object_ref: null, charge_ref: null, payment_intent_ref: null, invoice_ref: null, customer_ref: null,
    refund_key: null, user_id: null, company_id: null, project_id: null, licence_uid: null,
    revenue_stream: 'tier', product_ref: null, actor_user_id: null,
    currency: 'EUR', gross_cents: 1000, refund_cents: 0, net_cents: 1000, occurred_at: '2026-11-01T00:00:00Z', ...o,
  };
}
const refund = (id: string, o: Partial<FinancialEventRow> = {}) => event(id, {
  kind: 'refund', source_event_type: 'charge.refunded', refund_key: `ch_${id}:1`, gross_cents: 0, refund_cents: 200, net_cents: -200, ...o,
});
const dispute = (id: string, o: Partial<FinancialEventRow> = {}) => event(id, {
  kind: 'dispute', source_event_type: 'charge.dispute.created', gross_cents: 0, refund_cents: 500, net_cents: -500, ...o,
});

/** Every number anywhere in a value, so a test can say "no figure at all". */
function numbers(v: unknown): number[] {
  if (typeof v === 'number') return [v];
  if (v && typeof v === 'object') return Object.values(v).flatMap(numbers);
  return [];
}

test('every metric answers the same envelope, keyed by its own name and the requested period', async () => {
  const { env } = db();
  const model = await revenueReadModel(env, Q4, NOW, {
    subscriptions: await subscriptionRevenue(env, Q4),
    licenceInvoices: { available: false, reason: 'x' },
  });
  assert.equal(model.period, '2026-Q4');
  assert.deepEqual(Object.keys(model.metrics), [
    'subscription_revenue', 'refunds_and_disputes', 'revenue_per_subsidiary', 'ai_margin_per_licence',
    'promo_issued_per_licence', 'licence_fees_invoiced',
  ]);
  for (const [key, m] of Object.entries(model.metrics)) {
    assert.deepEqual(Object.keys(m).sort(), ENVELOPE_KEYS, `${key} does not carry the envelope`);
    assert.equal(m.key, key);
    assert.equal(m.period, '2026-Q4', `${key} did not follow the period`);
    assert.ok(m.source.length > 0, `${key} names no source`);
    assert.ok(m.last_reconciled_basis.length > 0, `${key} does not say what reconciled means`);
    assert.ok(m.coverage.recorded_by.length > 0, `${key} does not say where its coverage comes from`);
  }
});

test('no metric is a named gap any more: revenue per subsidiary and AI margin per licence read their stores', async () => {
  const model = await revenueReadModel(db().env, Q4, NOW, {
    subscriptions: { period: '2026-Q4', state: 'unreadable', reason: 'x' } as any,
    licenceInvoices: { available: false, reason: 'x' },
  });
  for (const m of Object.values(model.metrics)) {
    assert.notEqual(m.state, 'not_available', `${m.key} is still a named gap`);
    assert.equal(m.pending_issue, null, `${m.key} still names a pending slice`);
  }
});

// ── Revenue per subsidiary (#5947) ────────────────────────────────────────────

function report(sql: DatabaseSync, o: {
  licence: string; stream?: string; period?: string; gross?: number | null; currency?: string; state?: string | null;
  estimate?: number; reason?: string | null; asOf?: string | null;
}) {
  sql.prepare(
    `INSERT INTO subsidiary_usage_reports
       (licence_uid, branch_code, period, stream, gross_cents, currency, is_estimate, reported_at, state, reason, source, source_as_of)
     VALUES (?, 'br', ?, ?, ?, ?, ?, '2026-11-16T05:10:00Z', ?, ?, ?, ?)`,
  ).run(o.licence, o.period ?? '2026-Q4', o.stream ?? 'subscriptions', o.gross ?? null, o.currency ?? 'EUR', o.estimate ?? 0,
    o.state === undefined ? 'complete' : o.state, o.reason ?? null, 'financial_events', o.asOf ?? '2026-11-16T05:09:00Z');
}
const LICENCES = `INSERT INTO territory_licences (uid, licence_ref, brand_name, status) VALUES
  ('lic_fr', 'FR-001', 'France', 'active'), ('lic_de', 'DE-001', 'Germany', 'active'),
  ('lic_uk', 'UK-001', 'UK', 'suspended'), ('lic_old', 'XX-001', 'Gone', 'terminated')`;

test('revenue per subsidiary: an empty store is not recorded, never a zero per licence', async () => {
  const bare = await revenuePerSubsidiaryMetric(db().env, Q4);
  assert.equal(bare.state, 'not_recorded');
  assert.equal(bare.values, null);
  assert.deepEqual(bare.currencies, []);
  assert.equal(bare.incomplete_rows, 0);

  const { sql, env } = db();
  sql.exec(LICENCES);
  const m = await revenuePerSubsidiaryMetric(env, Q4);
  assert.equal(m.state, 'not_recorded');
  assert.equal(m.values, null, 'an unreported quarter carried figures');
  assert.deepEqual(m.incomplete_detail, { not_reported: 3 }, 'a terminated licence was expected to report, or one was dropped');
  assert.match(m.reason ?? '', /No branch has reported 2026-Q4/);
  assert.equal(m.last_reconciled_at, null);
  assert.equal(m.coverage.state, 'unknown');
  assert.match(m.coverage.recorded_by, /202611161359_5947/);
});

test('revenue per subsidiary: reports with every stream unmeasured carry each branch\'s reason and no figure', async () => {
  const { sql, env } = db();
  sql.exec(LICENCES);
  report(sql, { licence: 'lic_fr', state: 'not_recorded', reason: 'Ledger empty by design.' });
  report(sql, { licence: 'lic_fr', stream: 'licence_fees', state: 'not_available' });
  report(sql, { licence: 'lic_de', state: null }); // reported by a build before D5947
  const m = await revenuePerSubsidiaryMetric(env, Q4);
  assert.equal(m.state, 'not_recorded');
  assert.deepEqual(m.currencies, []);
  const by = Object.fromEntries(m.values!.by_licence.map((l) => [l.licence_uid, l]));
  assert.deepEqual(by.lic_fr.streams.map((x) => [x.stream, x.gross_cents, x.currency, x.state]), [
    ['licence_fees', null, null, 'not_available'], ['subscriptions', null, null, 'not_recorded'],
  ]);
  assert.equal(by.lic_fr.streams[1].reason, 'Ledger empty by design.');
  assert.equal(by.lic_uk.reported, false);
  // `not_available` is a stream the branch has no store for, by design: not a gap.
  assert.deepEqual(m.incomplete_detail, { not_recorded: 1, no_state: 1, not_reported: 1 });
  assert.equal(m.incomplete_rows, 3);
});

test('revenue per subsidiary: a partial store shows each figure in its own currency, totals nothing, counts the gaps', async () => {
  const { sql, env } = db();
  sql.exec(LICENCES);
  report(sql, { licence: 'lic_fr', gross: 1200, currency: 'EUR' });
  report(sql, { licence: 'lic_fr', stream: 'licence_fees', state: 'not_available' });
  report(sql, { licence: 'lic_de', gross: 900, currency: 'gbp', state: 'incomplete', reason: 'Coverage began 2026-10-15.' });
  // Stored with a number but a state that says nothing was measured: the number is not a figure.
  report(sql, { licence: 'lic_de', stream: 'other', gross: 0, state: 'unreadable' });
  report(sql, { licence: 'lic_fr', period: '2026-Q3', gross: 99 });
  const m = await revenuePerSubsidiaryMetric(env, Q4);
  assert.equal(m.state, 'incomplete');
  assert.deepEqual(m.currencies, ['EUR', 'GBP']);
  const by = Object.fromEntries(m.values!.by_licence.map((l) => [l.licence_uid, l]));
  assert.deepEqual(by.lic_fr.streams.find((x) => x.stream === 'subscriptions')!.gross_cents, 1200);
  assert.deepEqual(by.lic_de.streams.map((x) => [x.stream, x.gross_cents, x.currency]), [['other', null, null], ['subscriptions', 900, 'GBP']]);
  assert.equal(by.lic_uk.reported, false);
  assert.equal(by.lic_uk.streams.length, 0);
  assert.equal(by.lic_old, undefined, 'a terminated licence that never reported was listed');
  assert.deepEqual(m.incomplete_detail, { incomplete: 1, unreadable: 1, not_reported: 1 });
  assert.equal(m.incomplete_rows, 3);
  assert.equal(m.values!.by_licence.flatMap((l) => l.streams).length, 4, 'another period\'s report was read');
  assert.ok(!/total/.test(JSON.stringify(m.values)), 'a total appeared');

  // Every licence measured and complete, the `not_available` stream aside: complete.
  sql.exec("DELETE FROM subsidiary_usage_reports WHERE licence_uid = 'lic_de'; UPDATE territory_licences SET status = 'terminated' WHERE uid <> 'lic_fr'");
  const c = await revenuePerSubsidiaryMetric(env, Q4);
  assert.equal(c.state, 'complete');
  assert.equal(c.incomplete_rows, 0);
  assert.equal(c.reason, null);
});

test('revenue per subsidiary: a failed read is unreadable, with no figure', async () => {
  const { sql, env } = db();
  sql.exec(LICENCES);
  report(sql, { licence: 'lic_fr', gross: 1200 });
  sql.exec('DROP TABLE subsidiary_usage_reports');
  const m = await revenuePerSubsidiaryMetric(env, Q4);
  assert.equal(m.state, 'unreadable');
  assert.equal(m.values, null);
  assert.equal(m.incomplete_rows, null);
  assert.equal(m.currencies, null);
  const gone = await revenuePerSubsidiaryMetric(db({ promo: false }).env, Q4);
  assert.equal(gone.state, 'unreadable');
});

// ── AI billed, cost and margin per licence (#5948) ────────────────────────────

const AI_MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611150131_5948_ai_licence_uid.sql'), 'utf8');

function aiDb(opts: { migrated?: boolean; started?: string | null } = {}) {
  const f = aiBudgetFixture();
  if (opts.migrated !== false) {
    f.db.exec(AI_MIGRATION);
    if (opts.started === null) f.db.exec('DELETE FROM ai_licence_attribution_start');
    else f.db.prepare('UPDATE ai_licence_attribution_start SET started_at = ? WHERE id = 1').run(opts.started ?? '2026-09-01 00:00:00');
  }
  return { db: f.db, env: { DB: f.DB } as Env };
}
function settled(sql: any, uid: string, o: { licence: string | null; created?: string; updated?: string; included?: number; topup?: number; cost?: number | null; user?: number }) {
  const created = o.created ?? '2026-11-02 10:00:00', updated = o.updated ?? '2026-11-02 10:01:00';
  sql.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,settlement_uid,
      actual_included_microusd,actual_topup_microusd,expires_at,created_at,updated_at,licence_uid)
    VALUES(?,?,?,?,?,?,'settled',?,?,?,?,?,?,?)`)
    .run(uid, o.user ?? 2, created.slice(0, 10), created.slice(0, 7), o.included ?? 0, o.topup ?? 0, `s-${uid}`,
      o.included ?? 0, o.topup ?? 0, updated, created, updated, o.licence);
  if (o.cost !== null) {
    sql.prepare("INSERT INTO ai_usage_logs(user_id,task,model,est_cost_usd,reservation_uid,licence_uid) VALUES(?,?,?,?,?,?)")
      .run(o.user ?? 2, 'advisor_turn', 'm', o.cost ?? 1, uid, o.licence);
  }
}

test('AI margin per licence: an empty store is not recorded, and says why at HQ', async () => {
  const { db: sql, env } = aiDb();
  try {
    const m = await aiMarginPerLicenceMetric(env, Q4);
    assert.equal(m.state, 'not_recorded');
    assert.equal(m.values, null);
    assert.deepEqual(m.currencies, []);
    assert.deepEqual(m.incomplete_detail, { unattributed: 0, not_recorded: 0, pre_migration: 0 });
    assert.match(m.reason ?? '', /No AI run settled in 2026-Q4 names a licence/);
    assert.match(m.reason ?? '', /report to HQ carries no AI figure/, 'HQ did not say where branch runs are');
    assert.equal(m.coverage.state, 'covered');
    assert.equal(m.coverage.recorded_from, '2026-09-01T00:00:00Z', 'the SQLite UTC start was not read as UTC');

    // HQ's own runs name no licence: counted as unattributed, still no per-licence figure.
    settled(sql, 'h1', { licence: null, topup: 500_000 });
    const hq = await aiMarginPerLicenceMetric(env, Q4);
    assert.equal(hq.state, 'not_recorded');
    assert.equal(hq.incomplete_rows, 1);
    assert.equal(hq.values, null);
  } finally { sql.close(); }
});

test('AI margin per licence: a partial store keeps per-licence figures in USD, and an uncosted licence reads null, not 0', async () => {
  const { db: sql, env } = aiDb({ started: '2026-10-15 00:00:00' });
  try {
    settled(sql, 'a1', { licence: 'lic_a', created: '2026-11-02 10:00:00', included: 1_000_000, topup: 1_000_000, cost: 1 });
    settled(sql, 'a2', { licence: 'lic_a', created: '2026-11-02 10:00:00', topup: 3_000_000, cost: 1 });
    settled(sql, 'b1', { licence: 'lic_b', created: '2026-11-02 10:00:00', topup: 500_000, cost: null });
    settled(sql, 'n1', { licence: null, created: '2026-11-02 10:00:00', topup: 700_000 });
    settled(sql, 'p1', { licence: null, created: '2026-10-02 10:00:00', updated: '2026-10-20 10:00:00', topup: 700_000 });
    settled(sql, 'q3', { licence: 'lic_a', created: '2026-08-02 10:00:00', updated: '2026-08-02 10:01:00', topup: 9_000_000 });
    const m = await aiMarginPerLicenceMetric(env, Q4);
    assert.equal(m.state, 'incomplete');
    assert.deepEqual(m.currencies, ['USD']);
    assert.equal(m.coverage.state, 'partial');
    assert.deepEqual(m.values!.by_licence, [
      { licence_uid: 'lic_a', runs: 2, runs_not_recorded: 0, included_microusd: 1_000_000, billed_microusd: 4_000_000, cost_microusd: 1_500_000, margin_microusd: 2_500_000 },
      { licence_uid: 'lic_b', runs: 1, runs_not_recorded: 1, included_microusd: 0, billed_microusd: null, cost_microusd: null, margin_microusd: null },
    ]);
    assert.equal(m.values!.unattributed_runs, 1);
    assert.equal(m.values!.pre_migration_runs, 1);
    assert.deepEqual(m.incomplete_detail, { unattributed: 1, not_recorded: 1, pre_migration: 1 });
    assert.equal(m.incomplete_rows, 3);
    assert.equal(m.last_reconciled_at, null);
    assert.ok(!/total/.test(JSON.stringify(m.values)), 'a total appeared');

    // Q3 is wholly before attribution began: not recorded, no figure, even though a stamped row sits in it.
    const q3 = await aiMarginPerLicenceMetric(env, Q3);
    assert.equal(q3.state, 'not_recorded');
    assert.equal(q3.coverage.state, 'none');
    assert.equal(q3.values, null);
  } finally { sql.close(); }
});

test('AI margin per licence: complete only with every run costed and attributed over a covered period', async () => {
  const { db: sql, env } = aiDb();
  try {
    settled(sql, 'a1', { licence: 'lic_a', topup: 2_000_000, cost: 1 });
    const m = await aiMarginPerLicenceMetric(env, Q4);
    assert.equal(m.state, 'complete');
    assert.equal(m.reason, null);
    assert.equal(m.incomplete_rows, 0);
    assert.equal(m.values!.by_licence[0].margin_microusd, 1_000_000);
  } finally { sql.close(); }
  // No start row: attribution's start is unknown, so even a clean licence is not complete.
  const u = aiDb({ started: null });
  try {
    settled(u.db, 'a1', { licence: 'lic_a', topup: 2_000_000, cost: 1 });
    const m = await aiMarginPerLicenceMetric(u.env, Q4);
    assert.equal(m.state, 'incomplete');
    assert.equal(m.coverage.state, 'unknown');
    assert.equal(m.values!.pre_migration_runs, null);
    assert.deepEqual(m.incomplete_detail, { unattributed: 0, not_recorded: 0 }, 'an unknown pre-migration count became 0');
  } finally { u.db.close(); }
});

test('AI margin per licence: a failed read is unreadable, with no figure', async () => {
  const { db: sql, env } = aiDb({ migrated: false });
  try {
    const m = await aiMarginPerLicenceMetric(env, Q4);
    assert.equal(m.state, 'unreadable');
    assert.equal(m.values, null);
    assert.equal(m.incomplete_rows, null);
    assert.equal(m.currencies, null);
  } finally { sql.close(); }
  const none = await aiMarginPerLicenceMetric(db().env, Q4);
  assert.equal(none.state, 'unreadable');
});

test('subscription revenue: empty, partial, reconciled, before coverage and unreadable', async () => {
  // Empty and covered: no bucket at all, not a zero bucket.
  const empty = db();
  const e = await subscriptionRevenueMetric(empty.env, Q4, await subscriptionRevenue(empty.env, Q4));
  assert.equal(e.state, 'complete');
  assert.deepEqual(e.currencies, []);
  assert.deepEqual((e.values as any).by_currency, []);
  assert.equal(e.incomplete_rows, 0);
  assert.equal(e.last_reconciled_at, null);
  assert.equal(e.coverage.state, 'covered');

  // Partial: coverage began mid-quarter, one row has no amount, one has no date, one is reconciled.
  const partial = db({ ledger: '2026-10-15T00:00:00Z' });
  await writeFinancialEvent(partial.env, event('evt_ok'));
  await writeFinancialEvent(partial.env, event('evt_usd', { currency: 'USD', gross_cents: 300, net_cents: 300 }));
  await writeFinancialEvent(partial.env, event('evt_null', { gross_cents: null, refund_cents: null, net_cents: null }));
  await writeFinancialEvent(partial.env, event('evt_undated', { occurred_at: null }));
  await writeFinancialEvent(partial.env, event('evt_other_quarter', { occurred_at: '2026-08-01T00:00:00Z' }));
  const uid = (partial.sql.prepare("SELECT uid FROM financial_events WHERE source_event_id = 'evt_ok'").get() as any).uid;
  assert.deepEqual(await setReconciliationState(partial.env, { uid, from: 'pending', to: 'matched', actorUserId: 1 }), { ok: true });
  const p = await subscriptionRevenueMetric(partial.env, Q4, await subscriptionRevenue(partial.env, Q4));
  assert.equal(p.state, 'incomplete');
  assert.deepEqual(p.currencies, ['EUR', 'USD']);
  assert.equal(p.incomplete_rows, 2);
  assert.deepEqual(p.incomplete_detail, { missing_amount: 1, unattributed: 0, undated: 1 });
  assert.equal(p.coverage.state, 'partial');
  assert.equal(p.coverage.recorded_from, '2026-10-15T00:00:00Z');
  assert.match(p.last_reconciled_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(p.reason ?? '', /no date/);
  assert.deepEqual((p.values as any).by_currency.map((b: any) => [b.currency, b.gross_cents]), [['EUR', 1000], ['USD', 300]]);

  // Covered, and one row with no date: the reader alone would say complete; the envelope says incomplete.
  const undated = db();
  await writeFinancialEvent(undated.env, event('evt_ok'));
  await writeFinancialEvent(undated.env, event('evt_undated', { occurred_at: null }));
  const ud = await subscriptionRevenueMetric(undated.env, Q4, await subscriptionRevenue(undated.env, Q4));
  assert.equal(ud.state, 'incomplete', 'an undated row left the metric complete');
  assert.deepEqual(ud.incomplete_detail, { missing_amount: 0, unattributed: 0, undated: 1 });

  // Wholly before coverage: not recorded, no figure.
  const before = await subscriptionRevenueMetric(partial.env, Q3, await subscriptionRevenue(partial.env, Q3));
  assert.equal(before.state, 'not_recorded');
  assert.equal(before.coverage.state, 'none');
  assert.equal(before.values, null);

  // No ledger: unreadable, no figure.
  const none = db({ ledger: null });
  const u = await subscriptionRevenueMetric(none.env, Q4, await subscriptionRevenue(none.env, Q4));
  assert.equal(u.state, 'unreadable');
  assert.equal(u.values, null);
  assert.equal(u.incomplete_rows, null);
  assert.equal(u.currencies, null);
});

test('refunds and disputes: per currency, nothing added across, a missing amount is null and counted', async () => {
  const empty = await refundsAndDisputesMetric(db().env, Q4);
  assert.equal(empty.state, 'complete');
  assert.deepEqual(empty.values, { by_currency: [] });
  assert.deepEqual(empty.currencies, []);

  const { env } = db();
  await writeFinancialEvent(env, refund('evt_r1'));
  await writeFinancialEvent(env, refund('re_r1', { source: 'hq', source_event_type: 'hq.refund', refund_key: 'ch_evt_r1:1' })); // same refund
  await writeFinancialEvent(env, refund('evt_r2', { currency: 'USD', refund_cents: 70, net_cents: -70, revenue_stream: 'cart_order' }));
  await writeFinancialEvent(env, dispute('evt_d1'));
  await writeFinancialEvent(env, dispute('evt_d2', { source_event_type: 'charge.dispute.closed', gross_cents: 500, refund_cents: 0, net_cents: 500 }));
  await writeFinancialEvent(env, refund('evt_test', { livemode: 0 }));
  await writeFinancialEvent(env, dispute('evt_gbp', { currency: 'GBP', refund_cents: null, net_cents: null }));
  await writeFinancialEvent(env, refund('evt_nocur', { currency: null, refund_key: 'ch_nocur:1' }));
  const m = await refundsAndDisputesMetric(env, Q4);
  assert.equal(m.state, 'incomplete');
  assert.deepEqual(m.values!.by_currency, [
    { currency: 'EUR', refunds: 1, refunded_cents: 200, disputes: 2, dispute_withdrawn_cents: 500, dispute_reinstated_cents: 500 },
    { currency: 'GBP', refunds: 0, refunded_cents: 0, disputes: 1, dispute_withdrawn_cents: null, dispute_reinstated_cents: 0 },
    { currency: 'USD', refunds: 1, refunded_cents: 70, disputes: 0, dispute_withdrawn_cents: 0, dispute_reinstated_cents: 0 },
  ]);
  assert.deepEqual(m.currencies, ['EUR', 'GBP', 'USD']);
  assert.equal(m.incomplete_rows, 2);
  assert.deepEqual(m.incomplete_detail, { missing_amount: 2, undated: 0 });
  assert.match(m.reason ?? '', /1 with no currency/);
  assert.ok(!/total/.test(JSON.stringify(m.values)), 'a cross-currency total appeared');

  const lone = db();
  await writeFinancialEvent(lone.env, refund('evt_undated', { occurred_at: null }));
  const ld = await refundsAndDisputesMetric(lone.env, Q4);
  assert.equal(ld.state, 'incomplete', 'an undated refund left the metric complete');
  assert.deepEqual(ld.incomplete_detail, { missing_amount: 0, undated: 1 });

  const before = await refundsAndDisputesMetric(env, Q3);
  assert.equal(before.state, 'not_recorded');
  assert.equal(before.values, null);

  const u = await refundsAndDisputesMetric(db({ ledger: null }).env, Q4);
  assert.equal(u.state, 'unreadable');
  assert.equal(u.values, null);
  assert.equal(u.incomplete_rows, null);
});

test('promo issued per licence: none set, reported, not reported, mismatch and unreadable stores', async () => {
  const { sql, env } = db();
  const none = await promoIssuedMetric(env, Q4, NOW);
  assert.equal(none.state, 'not_recorded');
  assert.equal(none.values, null);

  sql.exec(`INSERT INTO territory_licences (uid, licence_ref, brand_name) VALUES ('lic_fr', 'FR-001', 'France'), ('lic_de', 'DE-001', 'Germany'), ('lic_uk', 'UK-001', 'UK')`);
  const ceiling = sql.prepare(
    `INSERT INTO licence_promo_ceilings (licence_uid, period, ceiling_cents, currency, issued_cents, spent_cents, issued_currency, issued_reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ceiling.run('lic_fr', '2026-Q4', 50000, 'EUR', 1200, 800, 'EUR', '2026-11-16T05:10:00Z');
  ceiling.run('lic_de', '2026-Q4', 50000, 'EUR', null, null, null, null);
  ceiling.run('lic_uk', '2026-Q4', 40000, 'GBP', 900, 100, 'EUR', '2026-11-16T05:10:00Z');
  ceiling.run('lic_fr', '2026-Q3', 50000, 'EUR', 99, 99, 'EUR', '2026-09-30T05:10:00Z');
  const m = await promoIssuedMetric(env, Q4, NOW);
  assert.equal(m.state, 'incomplete');
  const by = Object.fromEntries(m.values!.by_licence.map((l) => [l.licence_uid, l]));
  assert.equal(by.lic_fr.issued_state, 'reported');
  assert.equal(by.lic_fr.issued_cents, 1200);
  assert.equal(by.lic_fr.spent_cents, 800);
  assert.equal(by.lic_de.issued_state, 'not_reported');
  assert.equal(by.lic_de.issued_cents, null, 'an unreported figure read as a number');
  assert.equal(by.lic_uk.issued_state, 'mismatch');
  assert.equal(by.lic_uk.issued_cents, null, 'a figure in another currency was shown against the ceiling');
  assert.equal(m.incomplete_rows, 2);
  assert.deepEqual(m.incomplete_detail, { not_reported: 1, mismatch: 1 });
  assert.deepEqual(m.currencies, ['EUR', 'GBP']);
  assert.equal(m.last_reconciled_at, '2026-11-16T05:10:00Z');
  assert.equal(m.values!.by_licence.length, 3, 'another period\'s ceiling was read');

  // The reports table gone: the unreported row says unreadable; the reported figure stays.
  sql.exec('DROP TABLE licence_promo_issued_reports');
  const r = await promoIssuedMetric(env, Q4, NOW);
  const rb = Object.fromEntries(r.values!.by_licence.map((l) => [l.licence_uid, l]));
  assert.equal(rb.lic_de.issued_state, 'unreadable');
  assert.equal(rb.lic_fr.issued_cents, 1200);

  const gone = await promoIssuedMetric(db({ promo: false }).env, Q4, NOW);
  assert.equal(gone.state, 'unreadable');
  assert.equal(gone.values, null);
});

test('licence fees invoiced: an unreadable ledger is unreadable, a licence that cannot be invoiced is counted', () => {
  const u = licenceInvoicesMetric(Q4, { available: false, reason: 'The licence-fee invoice ledger could not be read.' });
  assert.equal(u.state, 'unreadable');
  assert.equal(u.values, null);
  const read = {
    available: true, by_currency: [{ currency: 'EUR', invoiced_cents: 100 }], expected_not_invoiced: [{}],
    cannot_invoice: [{ reason: 'no_annual_fee' }],
  } as any;
  const m = licenceInvoicesMetric(Q4, read);
  assert.equal(m.state, 'incomplete');
  assert.equal(m.incomplete_rows, 1);
  assert.deepEqual(m.currencies, ['EUR']);
  assert.equal(m.last_reconciled_at, null);
  assert.equal((m.values as any).expected_not_invoiced, 1);
});

test('one unreadable store leaves the other metrics answering', async () => {
  const { env } = db({ ledger: null });
  const model = await revenueReadModel(env, Q4, NOW, {
    subscriptions: await subscriptionRevenue(env, Q4),
    licenceInvoices: { available: false, reason: 'x' },
  });
  assert.equal(model.metrics.subscription_revenue.state, 'unreadable');
  assert.equal(model.metrics.refunds_and_disputes.state, 'unreadable');
  assert.equal(model.metrics.promo_issued_per_licence.state, 'not_recorded');
  assert.equal(model.metrics.revenue_per_subsidiary.state, 'not_recorded');
  // No AI tables in this fixture: that metric alone is unreadable, and the rest still answer.
  assert.equal(model.metrics.ai_margin_per_licence.state, 'unreadable');
});

test('coverage says covered, partial, none or unknown against the quarter', () => {
  assert.equal(coverageFor('2026-10-01T00:00:00Z', Q4, 'x').state, 'covered');
  assert.equal(coverageFor('2026-10-01T00:00:01Z', Q4, 'x').state, 'partial');
  assert.equal(coverageFor('2027-01-01T00:00:00Z', Q4, 'x').state, 'none');
  assert.equal(coverageFor(null, Q4, 'x').state, 'unknown');
  assert.equal(coverageFor('soon', Q4, 'x').state, 'unknown');
});
