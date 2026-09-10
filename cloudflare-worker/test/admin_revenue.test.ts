/**
 * `GET /api/admin/revenue/summary` — canvas H5.
 *
 * WHAT THIS FILE IS REALLY GUARDING. The artboard draws five zones of money.
 * Two of them have a store, one has half a store, and two have none — and
 * the failure mode for a page like this is not a crash, it is a plausible
 * number. A zero next to "Subscriptions" is a claim that the platform earned
 * nothing this quarter; the truth is that nobody can say. So most of what
 * follows asserts that a figure is ABSENT and that its reason is present,
 * which is the assertion that rots first when someone later "fills in the
 * gaps" (D56/D68, and `hq_home.test.mjs`'s ban on `|| 0`).
 *
 * The DDL is lifted verbatim from `sql/schema_baseline.sql` rather than
 * hand-written: a harness that invents its own schema only ever confirms its
 * own assumptions, and `territory_licences` in particular carries a CHECK on
 * `status` that a hand-written copy would drop — which is exactly the column
 * this route filters on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import revenue, { quarterOf } from '../src/routes/admin_revenue.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 601;
const PLAIN_ADMIN = 602;

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

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'territory_licences', 'ai_usage_logs', 'promo_codes']) {
    db.exec(ddl(t));
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  // D35 — Super Admin is an ELEVATION on `admin`, held in a side table.
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

function licence(db: any, ref: string, status: string, feeCents: number | null, currency = 'EUR') {
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, annual_fee_cents, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`uid-${ref}`, ref, `${ref} SAS`, ref, status, feeCents, currency);
}

async function call(db: any, actor: number) {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await revenue.fetch(
    new Request('http://x/summary', { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('a plain admin cannot read HQ revenue', async () => {
  // D35: `super_admin` is in no guard array — it is an elevation, re-checked
  // server-side on every HQ route. Cross-tenant money is the whole point of
  // the elevation existing.
  const db = freshDb();
  const r = await call(db, PLAIN_ADMIN);
  assert.notEqual(r.status, 200, 'a plain admin read the cross-tenant revenue summary');
  assert.equal(r.body.licence_fees, undefined, 'the payload leaked to a plain admin');
});

test('licence fees are real, per currency, and never added together', async () => {
  const db = freshDb();
  licence(db, 'FR-001', 'active', 200_000_00, 'EUR');
  licence(db, 'DE-001', 'active', 300_000_00, 'EUR');
  licence(db, 'UK-001', 'active', 100_000_00, 'GBP');
  const r = await call(db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const fees = r.body.licence_fees;
  assert.equal(fees.available, true);
  const by = Object.fromEntries(fees.by_currency.map((x: any) => [x.currency, x]));
  assert.equal(by.EUR.licences, 2);
  assert.equal(by.EUR.annual_cents, 500_000_00);
  assert.equal(by.EUR.quarter_cents, 125_000_00, 'the quarterly share is not a quarter of the annual fee');
  assert.equal(by.GBP.quarter_cents, 25_000_00);

  // THE ONE THAT MATTERS. Two currencies, two buckets, and no field anywhere
  // that adds them: a combined figure would be wrong by the exchange rate
  // and presented to the cent.
  assert.equal(fees.by_currency.length, 2);
  const flat = JSON.stringify(r.body);
  assert.ok(!/"total_cents"/.test(flat), 'a cross-currency total was added to the payload');
  assert.ok(!/"platform_revenue/.test(flat), 'a single platform-revenue figure was added across currencies');
});

test('a suspended licence contributes nothing, and is counted rather than dropped', async () => {
  // A suspended licence keeps its territory and bills nothing. Leaving it
  // out of the total silently would make the total look like the whole
  // estate; the canvas explicitly calls this case out.
  const db = freshDb();
  licence(db, 'FR-001', 'active', 200_000_00);
  licence(db, 'ES-001', 'suspended', 400_000_00);
  const r = await call(db, SUPER);
  assert.equal(r.body.licence_fees.by_currency.length, 1);
  assert.equal(r.body.licence_fees.by_currency[0].annual_cents, 200_000_00,
    'a suspended licence was billed');
  assert.equal(r.body.licence_fees.suspended_licences, 1, 'the suspended licence vanished from the payload');
});

test('an active licence with no fee recorded is reported, not silently excluded', async () => {
  const db = freshDb();
  licence(db, 'FR-001', 'active', 200_000_00);
  licence(db, 'NL-001', 'active', null);
  const r = await call(db, SUPER);
  assert.equal(r.body.licence_fees.by_currency[0].licences, 1, 'a null fee was counted as a licence billing zero');
  assert.equal(r.body.licence_fees.active_without_fee, 1,
    'an active licence with no fee recorded is missing from the payload — the total reads as complete');
});

test('token cost is real; token MARGIN is refused', async () => {
  // The canvas draws a margin. The cost is recorded and the price is not, so
  // the margin cannot be computed — and reporting the cost as though it were
  // the margin would be the exact false claim this endpoint exists to avoid.
  const db = freshDb();
  const q = quarterOf(new Date());
  const ins = db.prepare(
    "INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at) VALUES (?, 't', 'm', ?, ?)",
  );
  ins.run(1, 1.5, `${q.start} 10:00:00`);
  ins.run(1, 2.5, `${q.start} 11:00:00`);
  ins.run(1, 99.0, '1999-01-01 10:00:00');          // a previous quarter

  const r = await call(db, SUPER);
  const t = r.body.token_cost;
  assert.equal(t.available, true);
  assert.equal(t.calls, 2, 'the quarter window does not bound the query');
  assert.equal(t.cost_usd, 4, 'the cost is not the sum of this quarter\'s calls');
  assert.equal(t.currency, 'USD', 'the cost is not labelled with the currency it is in');
  assert.equal(t.billed_available, false, 'the payload claims to know what tokens were billed at');
  assert.match(String(t.billed_reason), /not stored/, 'no reason is given for the missing margin');
  assert.equal(t.margin_usd, undefined, 'a margin was derived from a price that does not exist');
});

test('the four figures with no source are absent, each with its own reason', async () => {
  // Not one blanket "some data unavailable": a reader needs to know WHICH
  // fact is missing and why, or the page is just apologising.
  const db = freshDb();
  const r = await call(db, SUPER);

  assert.equal(r.body.subscriptions_available, false);
  assert.match(String(r.body.subscriptions_reason), /no amount|not totalled/i);
  assert.equal(r.body.subscriptions_cents, undefined, 'a subscriptions figure appeared');

  assert.equal(r.body.statements_available, false);
  assert.match(String(r.body.statements_reason), /statement store/i);
  assert.equal(r.body.statements, undefined, 'a statements list appeared');

  assert.equal(r.body.promos.budget_available, false);
  assert.match(String(r.body.promos.budget_reason), /no promotional budget/i);
  assert.equal(r.body.promos.budget_left_cents, undefined, 'a promo budget figure appeared');

  // U1 — every per-subsidiary figure, the token P&L split included.
  assert.equal(r.body.derived_metrics_available, false);
  assert.match(String(r.body.derived_metrics_reason), /licence it belongs to/);
  assert.equal(r.body.token_pl_by_subsidiary, undefined, 'a per-subsidiary token split appeared');
});

test('promotions report what promo_codes holds, not what the canvas wanted', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id, times_redeemed, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('p1', 'LAUNCH', 'launch', 'c1', 7, 1);
  db.prepare(
    `INSERT INTO promo_codes (id, code, code_normalized, coupon_id, times_redeemed, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('p2', 'OLD', 'old', 'c2', 3, 0);
  const r = await call(db, SUPER);
  assert.equal(r.body.promos.active_codes, 1, 'an inactive code was counted as active');
  assert.equal(r.body.promos.redemptions, 7, 'redemptions include inactive codes');
});

test('an unreadable table says so and does not take the rest down', async () => {
  // Each zone reads independently. One missing table used to be the
  // difference between a page and a stack trace; here it must be the
  // difference between one zone and the other three.
  const db = freshDb();
  db.exec('DROP TABLE ai_usage_logs');
  const r = await call(db, SUPER);
  assert.equal(r.status, 200, 'one unreadable table took the whole payload down');
  assert.equal(r.body.token_cost.available, false);
  assert.match(String(r.body.token_cost.reason), /could not be read/);
  assert.equal(r.body.token_cost.cost_usd, undefined, 'an unreadable cost was reported as a number');
  assert.equal(r.body.licence_fees.available, true, 'a readable zone was dragged down with the unreadable one');
});

test('disputes are pointed at, not fetched', async () => {
  // Open disputes live in the Stripe API. Fanning out to it here would make
  // the whole payload as slow and as failure-prone as the slowest external
  // call, so the page reads that endpoint separately.
  const db = freshDb();
  const r = await call(db, SUPER);
  assert.equal(r.body.disputes_endpoint, '/api/admin/billing/disputes');
  assert.equal(r.body.disputes, undefined, 'the summary fetched disputes inline');
  assert.equal(r.body.open_disputes, undefined, 'the summary fetched disputes inline');
});

test('the quarter is the calendar quarter the date falls in', async () => {
  for (const [iso, label, start, end] of [
    ['2026-01-01T00:00:00Z', 'Q1 2026', '2026-01-01', '2026-04-01'],
    ['2026-03-31T23:59:59Z', 'Q1 2026', '2026-01-01', '2026-04-01'],
    ['2026-09-10T12:00:00Z', 'Q3 2026', '2026-07-01', '2026-10-01'],
    ['2026-12-31T23:59:59Z', 'Q4 2026', '2026-10-01', '2027-01-01'],
  ] as const) {
    const q = quarterOf(new Date(iso));
    assert.deepEqual([q.label, q.start, q.end], [label, start, end], `wrong quarter for ${iso}`);
  }
});
