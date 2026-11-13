/**
 * D5039 (#5039, Revenue v2 part 1) — `GET /api/admin/revenue/summary?period=YYYY-Qn`.
 *
 * What this guards. The page's Period selector now drives the summary, and the
 * failure that matters is a quiet one: a period the Worker cannot read being
 * answered as "this quarter" under the other quarter's label, or a
 * point-in-time figure (the licence run-rate, the promotion counts) dressed as
 * if it belonged to the period. So: a strict key or a 400, period-window
 * figures that move with it, point-in-time figures that do not, and a reply
 * that says which is which. Super Admin only, exactly as before.
 *
 * The DDL is the baseline's own, as in `admin_revenue.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import revenue, { quarterFromKey, quarterOf, SUMMARY_TEMPORAL } from '../src/routes/admin_revenue.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 601;
const PLAIN_ADMIN = 602;
const MEMBER = 900;

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
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'territory_licences', 'ai_usage_logs', 'promo_codes']) db.exec(ddl(t));
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8'));
  for (const m of ['419_ai_caps_topups', '430_ai_budget_review_cost', '486_ai_credits_token_packs', '493_ai_usage_charged']) {
    db.exec(readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${m}.sql`), 'utf8'));
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  u.run(MEMBER, 'founder', 'Member', 'm@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency)
     VALUES ('lic_fr', 'FR-001', 'FR SAS', 'France', 'active', 40000000, 'EUR')`,
  ).run();
  // One AI call in Q3 2026 and two in Q4 2026, so a period moves the cost.
  const log = db.prepare("INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at) VALUES (?, 't', 'm', ?, ?)");
  log.run(MEMBER, 1.5, '2026-08-10 10:00:00');
  log.run(MEMBER, 0.25, '2026-10-02 10:00:00');
  log.run(MEMBER, 0.25, '2026-11-02 10:00:00');
  // A branch reported Q3 and nothing for Q4.
  db.prepare(
    `INSERT INTO subsidiary_usage_reports (licence_uid, branch_code, period, stream, gross_cents, reported_at)
     VALUES ('lic_fr', 'fr', '2026-Q3', 'subscriptions', NULL, '2026-09-30T06:00:00Z')`,
  ).run();
  return db;
}

async function call(db: any, actor: number, query = '') {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await revenue.fetch(
    new Request(`http://x/summary${query}`, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('a plain admin cannot read any period, valid or not', async () => {
  const db = freshDb();
  for (const q of ['', '?period=2026-Q3', '?period=nonsense']) {
    const r = await call(db, PLAIN_ADMIN, q);
    assert.notEqual(r.status, 200, `a plain admin read the summary with "${q}"`);
    assert.equal(r.body.licence_fees, undefined, 'the payload leaked to a plain admin');
    assert.equal(r.body.quarter, undefined, 'the payload leaked to a plain admin');
  }
});

test('a period not written exactly YYYY-Qn is refused with 400, never read as this quarter', async () => {
  const db = freshDb();
  for (const bad of ['2026-Q5', '2026-Q0', '2026Q4', 'Q4 2026', '2026-q4', '2026-04', '26-Q4', '1999-Q4', '2026-Q4x', ' 2026-Q4', '']) {
    const r = await call(db, SUPER, `?period=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, `"${bad}" was accepted`);
    assert.equal(r.body.error, 'bad_period');
    assert.equal(r.body.licence_fees, undefined, `"${bad}" answered with figures`);
  }
});

test('with no period the summary is today\'s quarter, as before, and says so', async () => {
  const db = freshDb();
  const r = await call(db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const now = quarterOf(new Date());
  assert.equal(r.body.quarter.key, now.key);
  assert.equal(r.body.quarter.label, now.label);
  assert.equal(r.body.current_period, now.key);
  assert.equal(r.body.period_requested, false);
  assert.ok(Number.isFinite(Date.parse(r.body.read_at)), 'the read time is missing');
});

test('period-window figures follow the period: token cost and usage coverage', async () => {
  const db = freshDb();
  const q3 = await call(db, SUPER, '?period=2026-Q3');
  const q4 = await call(db, SUPER, '?period=2026-Q4');
  assert.equal(q3.status, 200, JSON.stringify(q3.body));
  assert.deepEqual(
    { key: q3.body.quarter.key, label: q3.body.quarter.label, start: q3.body.quarter.start, end: q3.body.quarter.end },
    { key: '2026-Q3', label: 'Q3 2026', start: '2026-07-01', end: '2026-10-01' },
  );
  assert.equal(q3.body.period_requested, true);
  assert.equal(q3.body.token_cost.calls, 1);
  assert.equal(q3.body.token_cost.cost_usd, 1.5);
  assert.equal(q4.body.token_cost.calls, 2);
  assert.equal(q4.body.token_cost.cost_usd, 0.5);

  assert.equal(q3.body.usage_coverage.period, '2026-Q3');
  assert.equal(q3.body.usage_coverage.by_licence[0].reported, true, 'the Q3 report was not found under Q3');
  assert.equal(q4.body.usage_coverage.period, '2026-Q4');
  assert.equal(q4.body.usage_coverage.by_licence[0].reported, false, 'Q3\'s report was read as Q4\'s');
});

test('point-in-time figures do not follow the period, and the reply says which is which', async () => {
  const db = freshDb();
  const a = await call(db, SUPER, '?period=2025-Q1');
  const b = await call(db, SUPER, '?period=2026-Q4');
  assert.deepEqual(a.body.licence_fees, b.body.licence_fees, 'the run-rate moved with the period');
  assert.deepEqual(a.body.promos, b.body.promos, 'the promotion counts moved with the period');
  assert.equal(a.body.current_period, quarterOf(new Date()).key, 'the current period followed the request');
  assert.deepEqual(a.body.temporal, SUMMARY_TEMPORAL);
  assert.equal(SUMMARY_TEMPORAL.licence_fees, 'as_of_now');
  assert.equal(SUMMARY_TEMPORAL.promos, 'as_of_now');
  assert.equal(SUMMARY_TEMPORAL.token_cost, 'period');
  assert.equal(SUMMARY_TEMPORAL.usage_coverage, 'period');
  assert.equal(SUMMARY_TEMPORAL.subscriptions, 'not_recorded');
  // Still never one cross-currency figure, and subscriptions still have none.
  assert.equal(a.body.subscriptions_available, false);
  assert.ok(!/"total_cents"|"platform_revenue/.test(JSON.stringify(a.body)));
});

test('quarterFromKey is exact, and agrees with quarterOf', () => {
  assert.deepEqual(quarterFromKey('2026-Q1'), { start: '2026-01-01', end: '2026-04-01', label: 'Q1 2026', key: '2026-Q1' });
  assert.deepEqual(quarterFromKey('2026-Q4'), { start: '2026-10-01', end: '2027-01-01', label: 'Q4 2026', key: '2026-Q4' });
  assert.equal(quarterFromKey('2026-Q5'), null);
  assert.equal(quarterFromKey('2026-Q4 '), null);
  assert.equal(quarterOf(new Date(Date.UTC(2026, 10, 8))).key, '2026-Q4');
});
