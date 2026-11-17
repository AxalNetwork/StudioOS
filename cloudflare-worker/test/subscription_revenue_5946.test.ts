import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/types.ts';
import { quarterFromKey } from '../src/routes/admin_revenue.ts';
import { FINANCIAL_EVENTS_DDL, writeFinancialEvent } from '../src/services/financialEvents.ts';
import type { FinancialEventRow } from '../src/services/financialEvents.ts';
import { subscriptionRevenue } from '../src/services/subscriptionRevenue.ts';
import { d1Over } from './_d1_sqlite.mjs';

const quarter = quarterFromKey('2026-Q4')!;

function ledger(coverage = '2026-10-01T00:00:00Z') {
  const db = new DatabaseSync(':memory:');
  for (const statement of FINANCIAL_EVENTS_DDL) {
    if (statement.startsWith('INSERT OR IGNORE INTO financial_event_coverage')) {
      const insert = db.prepare('INSERT INTO financial_event_coverage (source, coverage_starts_at) VALUES (?, ?)');
      insert.run('stripe', coverage);
      insert.run('hq', coverage);
    } else {
      db.exec(statement);
    }
  }
  return { db, env: { DB: d1Over(db) } as Env };
}

function event(id: string, overrides: Partial<FinancialEventRow> = {}): FinancialEventRow {
  return {
    source: 'stripe', source_event_id: id, source_event_type: 'invoice.paid', kind: 'invoice', livemode: 1,
    object_ref: 'in_test', charge_ref: null, payment_intent_ref: null, invoice_ref: 'in_test', customer_ref: null,
    refund_key: null, user_id: null, company_id: null, project_id: null, licence_uid: null,
    revenue_stream: 'tier', product_ref: null, actor_user_id: null,
    currency: 'USD', gross_cents: 1000, refund_cents: 0, net_cents: 1000,
    occurred_at: '2026-10-01T00:00:00Z', ...overrides,
  };
}

test('recurring invoices and period refunds total once per currency and never call Stripe', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; throw new Error('unexpected network access'); });
  const { env } = ledger();
  const refund = {
    kind: 'refund' as const, source_event_type: 'charge.refunded', refund_key: 'ch_test:300',
    gross_cents: 0, refund_cents: 300, net_cents: -300, occurred_at: '2026-11-05T00:00:00Z',
  };
  for (const row of [
    event('evt_usd'), event('evt_usd'), event('evt_eur', { currency: 'EUR', revenue_stream: 'investor' }),
    event('evt_charge', { kind: 'charge' }), event('evt_payment', { kind: 'payment' }),
    event('evt_refund', refund), event('re_refund', { ...refund, source: 'hq', source_event_type: 'hq.refund' }),
    event('evt_non_subscription', { revenue_stream: 'cart_order' }),
    event('evt_test_mode', { livemode: 0 }),
    event('evt_next', { occurred_at: '2027-01-01T00:00:00Z' }),
  ]) await writeFinancialEvent(env, row);
  const result = await subscriptionRevenue(env, quarter);
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.by_currency, [
    { currency: 'EUR', gross_cents: 1000, refund_cents: 0, net_cents: 1000 },
    { currency: 'USD', gross_cents: 1000, refund_cents: 300, net_cents: 700 },
  ]);
  assert.equal(result.mrr.state, 'not_recorded');
  assert.equal(result.arr.state, 'not_recorded');
  assert.equal(result.ltv.state, 'not_recorded');
  assert.equal(calls, 0);
});

test('coverage gaps and missing values are explicit, including when all amounts are absent', async () => {
  const start = '2026-10-15T09:30:00Z';
  const { env } = ledger(start);
  const missing = { gross_cents: null, refund_cents: null, net_cents: null, occurred_at: '2026-11-01T00:00:00Z' };
  await writeFinancialEvent(env, event('evt_missing', missing));
  await writeFinancialEvent(env, event('evt_unattributed', { ...missing, currency: null, revenue_stream: null }));
  const partial = await subscriptionRevenue(env, quarter);
  assert.equal(partial.state, 'incomplete');
  assert.equal(partial.coverage_starts_at, start);
  assert.match(partial.reason ?? '', /2026-10-15T09:30:00Z/);
  assert.equal(partial.missing_amount_rows, 2);
  assert.equal(partial.unattributed_rows, 1);
  assert.deepEqual(partial.by_currency, [{ currency: 'USD', gross_cents: null, refund_cents: 0, net_cents: null }]);
  const outside = await subscriptionRevenue(env, quarterFromKey('2026-Q3')!);
  assert.equal(outside.state, 'not_recorded');
  assert.equal(outside.coverage_starts_at, start);
  assert.equal(outside.by_currency, undefined);
});

test('absent financial ledger returns an unreadable state', async () => {
  const db = new DatabaseSync(':memory:');
  const result = await subscriptionRevenue({ DB: d1Over(db) } as Env, quarter);
  assert.equal(result.state, 'unreadable');
  assert.equal(result.by_currency, undefined);
});
