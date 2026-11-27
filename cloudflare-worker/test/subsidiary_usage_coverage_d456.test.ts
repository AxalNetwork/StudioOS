/**
 * D456 — HQ reads subsidiary usage coverage without inventing revenue totals.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/subsidiary_usage_coverage_d456.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  subsidiaryUsageCoverage,
  revenueAbsenceReason,
  REVENUE_PER_SUBSIDIARY_REASON,
  REVENUE_PER_SUBSIDIARY_PARTLY_MEASURED_REASON,
} from '../src/services/subsidiaryUsageCoverage.ts';
import { revenuePerSubsidiaryUnavailable, REVENUE_PER_SUBSIDIARY_UNAVAILABLE } from '../src/routes/licence.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION_260 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8',
);
const MIGRATION_5947 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/202611161359_5947_usage_report_source.sql'), 'utf8',
);

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
      };
      return api;
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(ddl('territory_licences'));
  db.exec(MIGRATION_260);
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency, revenue_share_bps)
     VALUES ('lic-a', 'AX-001', 'Alpha Ltd', 'Alpha', 'active', 100000, 'EUR', 3500)`,
  ).run();
  return db;
}

test('coverage lists every licence and never sums gross_cents', async () => {
  const db = freshDb();
  const cov = await subsidiaryUsageCoverage({ DB: makeD1(db) } as any, new Date('2026-02-15T12:00:00Z'));
  assert.equal(cov.available, true);
  if (!cov.available) return;
  assert.equal(cov.period, '2026-Q1');
  assert.equal(cov.by_licence.length, 1);
  assert.equal(cov.by_licence[0].reported, false);
  assert.match(cov.revenue_reason, /unmeasured/);
  assert.doesNotMatch(cov.revenue_reason, /licence it belongs to/);
});

test('reported unmeasurable streams use a different sentence than not reported', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO subsidiary_usage_reports
       (licence_uid, branch_code, period, stream, gross_cents, currency, is_estimate, reported_at)
     VALUES ('lic-a', 'alpha', '2026-Q1', 'subscriptions', NULL, 'EUR', 0, '2026-02-01T08:00:00Z')`,
  ).run();
  const cov = await subsidiaryUsageCoverage({ DB: makeD1(db) } as any, new Date('2026-02-15T12:00:00Z'));
  assert.equal(cov.available, true);
  if (!cov.available) return;
  const reason = revenueAbsenceReason(cov, 'lic-a');
  assert.match(reason, /Report received/);
  assert.match(reason, /unmeasured/);
  const missing = revenueAbsenceReason(cov, 'missing-uid');
  assert.equal(missing, REVENUE_PER_SUBSIDIARY_REASON);
});


test('D5947: coverage names, per licence, which streams were measurable — and stops saying every stream is unmeasured', async () => {
  const db = freshDb();
  db.exec(MIGRATION_5947);
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency, revenue_share_bps)
     VALUES ('lic-b', 'AX-002', 'Beta Ltd', 'Beta', 'active', 100000, 'EUR', 3500)`,
  ).run();
  const ins = db.prepare(
    `INSERT INTO subsidiary_usage_reports
       (licence_uid, branch_code, period, stream, gross_cents, currency, is_estimate, reported_at, state, reason, source, source_as_of)
     VALUES (?, ?, '2026-Q1', ?, ?, ?, 0, '2026-02-01T08:00:00Z', ?, ?, ?, ?)`,
  );
  ins.run('lic-a', 'alpha', 'subscriptions', 15_500, 'CHF', 'complete', null, 'financial_events', '2026-02-01T07:59:00.000Z');
  ins.run('lic-a', 'alpha', 'licence_fees', null, 'EUR', 'not_available', 'No onward fee.', 'none', '2026-02-01T07:59:00.000Z');
  ins.run('lic-b', 'beta', 'subscriptions', null, 'EUR', 'not_recorded', 'Empty by design.', 'financial_events', '2026-02-01T07:59:00.000Z');

  const cov = await subsidiaryUsageCoverage({ DB: makeD1(db) } as any, new Date('2026-02-15T12:00:00Z'));
  assert.equal(cov.available, true);
  if (!cov.available) return;
  const a = cov.by_licence.find((x) => x.licence_uid === 'lic-a')!;
  const b = cov.by_licence.find((x) => x.licence_uid === 'lic-b')!;
  assert.deepEqual(a.measurable_streams, ['subscriptions']);
  assert.equal(a.streams_measurable, 1);
  assert.deepEqual(a.streams.map((x) => [x.stream, x.measurable, x.currency, x.state, x.source]), [
    ['licence_fees', false, 'EUR', 'not_available', 'none'],
    ['subscriptions', true, 'CHF', 'complete', 'financial_events'],
  ]);
  assert.equal(JSON.stringify(cov).includes('15500'), false, 'coverage carried an amount');
  assert.deepEqual(b.measurable_streams, []);
  assert.equal(b.streams[0].reason, 'Empty by design.');

  assert.equal(cov.revenue_reason, REVENUE_PER_SUBSIDIARY_PARTLY_MEASURED_REASON);
  assert.doesNotMatch(cov.revenue_reason, /every stream/);
  const forA = revenueAbsenceReason(cov, 'lic-a');
  assert.match(forA, /measured: subscriptions/);
  assert.doesNotMatch(forA, /every stream/, 'a licence that measured a stream was told every stream arrived unmeasured');
  assert.match(revenueAbsenceReason(cov, 'lic-b'), /every stream arrived unmeasured/, 'a licence that measured none keeps the sentence');

  assert.deepEqual(revenuePerSubsidiaryUnavailable(cov), {
    revenue_per_subsidiary_available: false,
    revenue_per_subsidiary_reason: REVENUE_PER_SUBSIDIARY_PARTLY_MEASURED_REASON,
  });
});

test('D5947: with no measured stream anywhere, the D266 sentence stands, word for word', async () => {
  const db = freshDb();
  db.exec(MIGRATION_5947);
  db.prepare(
    `INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, currency, is_estimate, reported_at)
     VALUES ('lic-a', 'alpha', '2026-Q1', 'subscriptions', NULL, 'EUR', 0, '2026-02-01T08:00:00Z')`,
  ).run();
  const cov = await subsidiaryUsageCoverage({ DB: makeD1(db) } as any, new Date('2026-02-15T12:00:00Z'));
  assert.equal(cov.available, true);
  if (!cov.available) return;
  assert.equal(cov.revenue_reason, REVENUE_PER_SUBSIDIARY_REASON);
  assert.equal(cov.by_licence[0].streams[0].state, null, 'a pre-D5947 row has no state, and none is invented');
  assert.deepEqual(revenuePerSubsidiaryUnavailable(cov), REVENUE_PER_SUBSIDIARY_UNAVAILABLE);
  assert.deepEqual(revenuePerSubsidiaryUnavailable({ available: false }), REVENUE_PER_SUBSIDIARY_UNAVAILABLE);
});

test('D5947: HQ Home words revenue per subsidiary from its own coverage read, after the fixed sentence', () => {
  // ORDER IS THE POINT: a spread of DERIVED_UNAVAILABLE after this line would put the fixed
  // "every stream arrives unmeasured" back over a quarter in which a stream was measured.
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/admin_hq.ts'), 'utf8');
  assert.match(src, /\.\.\.DERIVED_UNAVAILABLE,\n(?:\s*\/\/[^\n]*\n)*\s*\.\.\.revenuePerSubsidiaryUnavailable\(usageCoverage\),\n\s*\}\);/);
});
