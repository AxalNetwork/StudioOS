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
} from '../src/services/subsidiaryUsageCoverage.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION_260 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8',
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
