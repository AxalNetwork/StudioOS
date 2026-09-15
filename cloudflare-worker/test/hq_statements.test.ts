/**
 * D111 — a statement is a CLAIM, and the four ways one can quietly become a lie.
 *
 * This file exists because every failure mode here is silent. A wrong statement
 * does not crash, does not 500 and does not look wrong: it is a plausible
 * number on a screen that somebody pays against. The four it guards:
 *
 *   1. A STREAM NOBODY REPORTED COUNTED AS ZERO. The honest total over three
 *      reported streams and one missing is a FLOOR; presenting it as a total
 *      under-bills by however much the missing stream earned, and nothing about
 *      the figure says so. `unreported_streams` and `complete` are what carry
 *      that, and the route stores both.
 *   2. A RE-DRAW RESTATING AN ISSUED FIGURE. A revenue share can be re-termed;
 *      re-running the draw under the new one would silently change what a
 *      subsidiary was told it owed last quarter. Past `draft`, a re-draw
 *      refuses.
 *   3. A NULL SHARE READ AS 0%. That draws a statement for nothing and files it
 *      as settled, which is worse than refusing.
 *   4. MONEY LOST TO ROUNDING OR MIXED ACROSS CURRENCIES. Integer cents,
 *      integer basis points, rounded once, and a stream in another currency
 *      reported rather than converted.
 *
 * Dispatched through the real router with a real JWT and a real (node:sqlite)
 * D1: `requireSuperAdmin` resolves the token and the `users` row, and a
 * hand-built context would let the arithmetic be asserted while skipping the
 * gate it sits behind.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_statements.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminStatements from '../src/routes/admin_statements.ts';
import { drawStatement, shareOf, quarterKey, PERIOD_RE } from '../src/services/statements.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7; // an admin WITH a super_admins row
const PLAIN = 9;  // an admin without one

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const prepare = (sql: string) => {
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
  };
  return {
    prepare,
    // The PATCH handler sends its updates as a batch. Applying them one at a
    // time here matches D1's own ordering; what the shim cannot model is the
    // rollback, which is why the route validates everything before it builds
    // a single statement.
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts || []) out.push(await s.run());
      return out;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      jwt_min_iat INTEGER, name TEXT, email TEXT);
  CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
  CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
    licence_ref TEXT UNIQUE NOT NULL, legal_entity_name TEXT NOT NULL, brand_name TEXT NOT NULL,
    revenue_share_bps INTEGER, currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live', rpc_secret_hash TEXT);
`;

/** Migration 260's three tables, read from the file rather than retyped. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_260 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/260_subsidiary_statements.sql'), 'utf8',
);

function seededDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(SCHEMA);
  // THE REAL MIGRATION, not a hand-written approximation of it. A fixture that
  // drifted from the shipped DDL would let a column rename pass here and fail
  // in production, which is the one thing this fixture must not do.
  db.exec(MIGRATION_260);

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);

  const l = db.prepare(
    `INSERT INTO territory_licences
       (uid, licence_ref, legal_entity_name, brand_name, revenue_share_bps, currency, status)
     VALUES (?,?,?,?,?,?,?)`,
  );
  l.run('lic_fr', 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 3500, 'EUR', 'active');
  // No agreed share: the licence exists and cannot be billed.
  l.run('lic_untermed', 'AXL-009', 'Axal VC Nowhere BV', 'Axal VC Nowhere', null, 'EUR', 'active');
  return db;
}

function statementsApp() {
  const db = seededDb();
  const env = { DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/admin', adminStatements);
  app.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    return c.json({ detail: msg }, 403);
  });

  const call = async (path: string, init: RequestInit = {}, userId: number | null = HOLDER) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId !== null) {
      const token = await new SignJWT({ user_id: userId, role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
        .sign(new TextEncoder().encode(JWT_SECRET));
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await app.request(`/api/admin${path}`, { ...init, headers }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const report = (stream: string, gross: number | null, extra: Record<string, unknown> = {}) =>
    db.prepare(
      `INSERT INTO subsidiary_usage_reports
         (licence_uid, branch_code, period, stream, gross_cents, currency, is_estimate, estimate_basis, reported_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      String(extra.licence_uid ?? 'lic_fr'), 'fr', String(extra.period ?? '2026-Q3'), stream,
      gross, String(extra.currency ?? 'EUR'), extra.is_estimate ? 1 : 0,
      (extra.estimate_basis as string) ?? null, String(extra.reported_at ?? '2026-09-10T00:00:00Z'),
    );
  const rows = () => db.prepare('SELECT * FROM subsidiary_statements ORDER BY period, licence_uid').all() as any[];
  return { call, report, rows, db };
}

const draw = (body: Record<string, unknown>): [string, RequestInit] =>
  ['/statements/draw', { method: 'POST', body: JSON.stringify(body) }];

/* ------------------------------------------------------------------ *
 * The arithmetic, tested without a database                           *
 * ------------------------------------------------------------------ */

test('the share rounds once, at the end, and never floors', () => {
  // 3500 bps of 1_234_567 is 432_098.45. A floor loses a cent on this and on
  // every statement shaped like it, always against the same party.
  assert.equal(shareOf(1234567, 3500), 432098);
  // And the half that rounds UP, so the rule is round-half-away rather than
  // "happens to be down on the example I picked".
  assert.equal(shareOf(1000015, 5000), 500008);
  assert.equal(shareOf(0, 3500), 0, 'nothing billed is nothing owed');
  assert.equal(shareOf(1234567, 0), 0, 'a zero share owes nothing');
});

test('a stream in another currency is reported, never converted into the total', () => {
  const d = drawStatement([
    { stream: 'subscriptions', gross_cents: 100_000, currency: 'EUR', available: true },
    { stream: 'other', gross_cents: 50_000, currency: 'USD', available: true },
  ], 3500, 'EUR');

  assert.equal(d.gross_cents, 100_000, 'a USD stream was summed into a EUR statement');
  assert.deepEqual(d.other_currency, ['USD']);
  assert.equal(d.complete, false, 'a statement missing a currency it cannot add is not complete');
});

test('an unreported stream is counted, not zeroed, and makes the statement incomplete', () => {
  const d = drawStatement([
    { stream: 'subscriptions', gross_cents: null, currency: 'EUR', available: false, reason: 'no local ledger' },
    { stream: 'other', gross_cents: 400_000, currency: 'EUR', available: true },
  ], 3500, 'EUR');

  assert.equal(d.unreported, 1);
  assert.equal(d.gross_cents, 400_000, 'an unreported stream contributed to the gross');
  assert.equal(d.owed_cents, 140_000);
  assert.equal(d.complete, false);
});

test('an estimated stream is summed but the statement still says it is not invoiced', () => {
  const d = drawStatement([
    { stream: 'other', gross_cents: 400_000, currency: 'EUR', available: true, is_estimate: true },
  ], 3500, 'EUR');
  assert.equal(d.gross_cents, 400_000, 'an estimate the branch stands behind was dropped');
  assert.equal(d.estimated, 1);
  assert.equal(d.complete, false, 'a statement drawn over an estimate claims to be a total');
});

test('a period is a quarter or it is refused', () => {
  assert.ok(PERIOD_RE.test('2026-Q3'));
  for (const bad of ['2026-Q5', '2026-Q0', '2026-03', 'Q3', '26-Q1', '2026-q3', '2026-Q3 ']) {
    assert.equal(PERIOD_RE.test(bad), false, `${bad} was accepted as a period`);
  }
  assert.equal(quarterKey(new Date('2026-09-15T00:00:00Z')), '2026-Q3');
  assert.equal(quarterKey(new Date('2026-01-01T00:00:00Z')), '2026-Q1');
  assert.equal(quarterKey(new Date('2026-12-31T23:59:59Z')), '2026-Q4');
});

/* ------------------------------------------------------------------ *
 * The routes                                                          *
 * ------------------------------------------------------------------ */

test('drawing needs the elevation, not merely the admin role', async () => {
  const { call, rows } = statementsApp();
  const r = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }), PLAIN);
  assert.equal(r.status, 403);
  assert.equal(rows().length, 0, 'a refused draw still wrote a statement');
});

test('a draw stores the owed figure, the share it was drawn at, and the gross', async () => {
  const { call, report, rows } = statementsApp();
  report('other', 1_234_567);

  const r = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.gross_cents, 1_234_567);
  assert.equal(r.body.revenue_share_bps, 3500);
  assert.equal(r.body.owed_cents, 432_098);

  // STORED, not recomputed on read: a statement that kept only the inputs
  // would restate itself the moment the licence was re-termed.
  const [row] = rows();
  assert.equal(row.owed_cents, 432_098);
  assert.equal(row.revenue_share_bps, 3500);
  assert.equal(row.gross_cents, 1_234_567);
  assert.equal(row.status, 'draft');
  assert.equal(row.reports_as_of, '2026-09-10T00:00:00Z', 'the age of the evidence did not travel with the claim');
});

test('every stream appears on the statement, reported or not', async () => {
  const { call } = statementsApp();
  const r = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));

  assert.equal(r.status, 201);
  assert.deepEqual(
    r.body.streams.map((s: any) => s.stream),
    ['subscriptions', 'licence_fees', 'token_margin', 'other'],
    'a statement listed only the streams that arrived',
  );
  // With nothing reported at all, the owed figure is zero AND says why — which
  // is a different statement from "this subsidiary owes nothing".
  assert.equal(r.body.unreported, 4);
  assert.equal(r.body.complete, false);
  assert.match(String(r.body.note), /floor rather than a total/);
  for (const s of r.body.streams) {
    assert.equal(s.available, false);
    assert.ok(String(s.reason || '').length > 0, `${s.stream} is absent with no reason`);
  }
});

test('a licence with no agreed share refuses rather than drawing at 0%', async () => {
  const { call, rows } = statementsApp();
  const r = await call(...draw({ licence_uid: 'lic_untermed', period: '2026-Q3' }));

  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_revenue_share');
  assert.match(String(r.body.message), /step 4/, 'the refusal does not say where the rate is set');
  assert.equal(rows().length, 0, 'a statement was drawn at a rate nobody agreed');
});

test('a re-draw replaces a draft and refuses anything further', async () => {
  const { call, report, rows, db } = statementsApp();
  report('other', 100_000);
  const first = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));
  assert.equal(first.status, 201);

  // Still a draft: the branch corrected itself, so the draw is re-run.
  db.prepare('UPDATE subsidiary_usage_reports SET gross_cents = ? WHERE stream = ?').run(200_000, 'other');
  const second = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));
  assert.equal(second.status, 201);
  assert.equal(second.body.uid, first.body.uid, 'a re-draw made a second statement for one period');
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].gross_cents, 200_000);

  // Issued: somebody has seen this figure.
  await call(`/statements/${first.body.uid}`, { method: 'PATCH', body: JSON.stringify({ status: 'issued' }) });
  const third = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));
  assert.equal(third.status, 409);
  assert.equal(third.body.error, 'already_issued');
  assert.match(String(third.body.message), /restate/, 'the refusal does not say what re-drawing would do');
  assert.equal(rows()[0].gross_cents, 200_000, 'an issued statement was restated anyway');
});

test('the ledger lists per currency and never totals across them', async () => {
  const { call, report, db } = statementsApp();
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, revenue_share_bps, currency)
     VALUES (?,?,?,?,?,?)`,
  ).run('lic_uk', 'AXL-004', 'Axal VC UK Ltd', 'Axal VC UK', 3000, 'GBP');
  report('other', 100_000);
  // Reported in the licence's OWN currency. Reporting it in EUR would draw a
  // GBP statement of zero, which is the rule below rather than a bug — and a
  // fixture that did it by accident would assert nothing about the totals.
  report('other', 200_000, { licence_uid: 'lic_uk', currency: 'GBP' });
  await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));
  await call(...draw({ licence_uid: 'lic_uk', period: '2026-Q3' }));

  const r = await call('/statements');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, true);
  assert.equal(r.body.items.length, 2);
  assert.deepEqual(Object.keys(r.body.totals_by_currency).sort(), ['EUR', 'GBP']);
  assert.equal(r.body.totals_by_currency.EUR.owed, 35_000);
  assert.equal(r.body.totals_by_currency.GBP.owed, 60_000);
  assert.equal(r.body.total_owed_cents, undefined, 'a single cross-currency total appeared');

  // The licence's own name comes back, so a page need not render a uid — and
  // the uid is what the statement stores, so a rename cannot restate history.
  const fr = r.body.items.find((x: any) => x.licence_uid === 'lic_fr');
  assert.equal(fr.brand_name, 'Axal VC France');
  assert.equal(fr.licence_ref, 'AXL-001');
  // `streams_json` never reaches a caller as a string it has to parse.
  assert.ok(Array.isArray(fr.streams), 'the breakdown arrives as raw JSON text');
});

test('a stream reported in the wrong currency does not reach the owed figure', async () => {
  // The whole route, not just the pure function: a branch that reports EUR
  // against a GBP licence has said something the statement cannot use, and
  // converting it at whatever rate the day happens to carry would produce a
  // confident wrong number. It is reported unusable and owed stays at nothing.
  const { call, report, db } = statementsApp();
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, revenue_share_bps, currency)
     VALUES (?,?,?,?,?,?)`,
  ).run('lic_uk', 'AXL-004', 'Axal VC UK Ltd', 'Axal VC UK', 3000, 'GBP');
  report('other', 200_000, { licence_uid: 'lic_uk', currency: 'EUR' });

  const r = await call(...draw({ licence_uid: 'lic_uk', period: '2026-Q3' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.currency, 'GBP', 'the statement took the stream\'s currency instead of the licence\'s');
  assert.equal(r.body.gross_cents, 0, 'a EUR figure was counted as GBP');
  assert.equal(r.body.owed_cents, 0);
  assert.deepEqual(r.body.other_currency, ['EUR'], 'the unusable currency is not named on the statement');
  assert.equal(r.body.complete, false);
});

test('a period filter must be a period', async () => {
  const { call } = statementsApp();
  const r = await call('/statements?period=2026-13');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_period');
});

test('paid is recorded with who and when, and overpayment refuses', async () => {
  const { call, report, rows } = statementsApp();
  report('other', 100_000);
  const { body } = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));
  assert.equal(body.owed_cents, 35_000);

  const over = await call(`/statements/${body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ paid_cents: 40_000 }),
  });
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'over_payment');
  assert.equal(rows()[0].paid_cents, 0, 'an over-payment was recorded anyway');

  const ok = await call(`/statements/${body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ paid_cents: 35_000, paid_note: 'wire ref 88123' }),
  });
  assert.equal(ok.status, 200);
  const [row] = rows();
  assert.equal(row.paid_cents, 35_000);
  assert.equal(row.paid_note, 'wire ref 88123');
  assert.equal(row.paid_by_user_id, HOLDER, 'nothing records which operator entered the payment');
  assert.ok(row.paid_at, 'a payment was recorded with no time');
  assert.equal(ok.body.outstanding_cents, 0);
});

test('a dispute without a reason is refused', async () => {
  const { call, report, rows } = statementsApp();
  report('other', 100_000);
  const { body } = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));

  const bare = await call(`/statements/${body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ disputed_cents: 5_000 }),
  });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error, 'dispute_note_required');
  assert.equal(rows()[0].disputed_cents, 0);

  const withNote = await call(`/statements/${body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ disputed_cents: 5_000, dispute_note: 'Q3 seats were never delivered' }),
  });
  assert.equal(withNote.status, 200);
  assert.equal(rows()[0].disputed_cents, 5_000);
  assert.equal(rows()[0].dispute_note, 'Q3 seats were never delivered');
});

test('a patch that changes nothing is refused rather than silently succeeding', async () => {
  const { call, report } = statementsApp();
  report('other', 100_000);
  const { body } = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));

  const r = await call(`/statements/${body.uid}`, { method: 'PATCH', body: JSON.stringify({ nonsense: 1 }) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'nothing_to_update');
});

test('a status outside the four is refused, and refuses BEFORE the other fields are written', async () => {
  const { call, report, rows } = statementsApp();
  report('other', 100_000);
  const { body } = await call(...draw({ licence_uid: 'lic_fr', period: '2026-Q3' }));

  const r = await call(`/statements/${body.uid}`, {
    method: 'PATCH', body: JSON.stringify({ paid_cents: 1_000, paid_note: 'part', status: 'settled' }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_status');
  // THE HALF THAT MATTERS: the paid figure in the same request must not have
  // landed. Three statements are three chances to write half a change, which
  // is why the route validates everything before it prepares any of them.
  assert.equal(rows()[0].paid_cents, 0, 'a rejected request wrote half of itself');
  assert.equal(rows()[0].status, 'draft');
});

test('a statement that does not exist is 404, not a silent no-op', async () => {
  const { call } = statementsApp();
  const r = await call('/statements/lct_nope', { method: 'PATCH', body: JSON.stringify({ status: 'void' }) });
  assert.equal(r.status, 404);
});

/* ------------------------------------------------------------------ *
 * Promo ceilings                                                      *
 * ------------------------------------------------------------------ */

test('a ceiling is stored, and an unreported issued figure is null rather than zero', async () => {
  const { call } = statementsApp();
  const set = await call('/promo-ceilings/lic_fr', {
    method: 'PUT', body: JSON.stringify({ period: '2026-Q3', ceiling_cents: 500_000 }),
  });
  assert.equal(set.status, 200);
  assert.equal(set.body.ceiling_cents, 500_000);
  assert.equal(set.body.currency, 'EUR', 'the ceiling did not take the licence\'s own currency');
  // No branch is bound to this licence, so the push has not happened — and
  // that is reported as its own fact rather than as the write failing.
  assert.equal(set.body.pushed.ok, false);
  assert.match(String(set.body.pushed.reason), /No branch is bound/);

  const list = await call('/promo-ceilings');
  assert.equal(list.status, 200);
  const [row] = list.body.items;
  assert.equal(row.ceiling_cents, 500_000);
  assert.equal(row.issued_cents, null, 'an unreported issued figure came back as a number');
  assert.equal(row.issued_available, false);
  assert.equal(row.remaining_cents, null,
    'the whole ceiling was reported available on the word of a branch that has not spoken');
  assert.equal(row.brand_name, 'Axal VC France');
});

test('setting a ceiling twice for one period replaces it', async () => {
  const { call, db } = statementsApp();
  const put = (cents: number) => call('/promo-ceilings/lic_fr', {
    method: 'PUT', body: JSON.stringify({ period: '2026-Q3', ceiling_cents: cents }),
  });
  await put(500_000);
  await put(750_000);
  const rows = db.prepare('SELECT * FROM licence_promo_ceilings').all() as any[];
  assert.equal(rows.length, 1, 'a second ceiling row was written for one period');
  assert.equal(rows[0].ceiling_cents, 750_000);
});

test('a reported issued figure gives a remaining, and it is the branch that reports it', async () => {
  const { call, db } = statementsApp();
  await call('/promo-ceilings/lic_fr', {
    method: 'PUT', body: JSON.stringify({ period: '2026-Q3', ceiling_cents: 500_000 }),
  });
  // Written the way the branch's own report writes it, not by this route:
  // HQ cannot see a branch's codes and never computes this.
  db.prepare(
    'UPDATE licence_promo_ceilings SET issued_cents = ?, issued_reported_at = ? WHERE licence_uid = ?',
  ).run(120_000, '2026-09-14T00:00:00Z', 'lic_fr');

  const list = await call('/promo-ceilings');
  const [row] = list.body.items;
  assert.equal(row.issued_available, true);
  assert.equal(row.remaining_cents, 380_000);
});

test('a ceiling for an unknown licence is 404, and a bad period is 400', async () => {
  const { call } = statementsApp();
  const missing = await call('/promo-ceilings/lic_nope', {
    method: 'PUT', body: JSON.stringify({ period: '2026-Q3', ceiling_cents: 1 }),
  });
  assert.equal(missing.status, 404);

  const bad = await call('/promo-ceilings/lic_fr', {
    method: 'PUT', body: JSON.stringify({ period: 'whenever', ceiling_cents: 1 }),
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_period');
});

test('the ceiling routes need the elevation too', async () => {
  const { call, db } = statementsApp();
  const r = await call('/promo-ceilings/lic_fr', {
    method: 'PUT', body: JSON.stringify({ period: '2026-Q3', ceiling_cents: 1 }),
  }, PLAIN);
  assert.equal(r.status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM licence_promo_ceilings').get() as any).n, 0);

  const read = await call('/promo-ceilings', {}, PLAIN);
  assert.equal(read.status, 403);
});
