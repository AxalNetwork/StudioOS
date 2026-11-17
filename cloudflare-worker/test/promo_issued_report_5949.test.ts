/**
 * D5949 (#5949): a branch reports what it has issued and spent against its
 * promo ceiling to HQ on the daily run; HQ's copy carries the branch's own
 * as-of time and an explicit state, and never decides a checkout.
 *
 * Two in-memory SQLite databases built from the baseline and every migration:
 * one is the branch, one is HQ. The branch's HQ binding calls HQ's real
 * `reportPromoIssued`. Every licence, code and secret is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/promo_issued_report_5949.test.ts
 */
import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminStatements from '../src/routes/admin_statements.ts';
import { reportPromoIssued } from '../src/rpc/hqOps.ts';
import {
  collectPromoIssued, promoIssuedState, pushPromoIssuedReport, PROMO_ISSUED_STALE_MS,
} from '../src/services/promoIssuedReport.ts';
import { quarterKey } from '../src/services/statements.ts';
import { RPC_SURFACE } from '../src/services/topology.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SECRET = 'synthetic-promo-report-secret';
const NOW = new Date('2026-11-15T09:00:00.000Z');
const PERIOD = quarterKey(NOW); // 2026-Q4
const PREVIOUS = '2026-Q3';
// The reads judge "stale" and "this quarter" against the wall clock, so the
// clock is pinned to NOW: these assertions must not expire 48 hours after NOW.
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
afterEach(() => mock.timers.reset());
const SUPER = 1;
const LICENCE = 'lic_aa';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const fresh = () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* schema-only ordering */ } }
  return db;
};

async function hq() {
  const db = fresh();
  db.prepare("INSERT INTO users (id, uid, role, name, email, is_active, email_verified) VALUES (?, 'u1', 'admin', 'Sam Super', 'sam@example.test', 1, 1)").run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, 'totp-1', 'totp', 'totp')").run(SUPER);
  db.prepare("INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (1, ?, 'SYN-1', 'Synthetic entity', 'Synthetic studio', 'active')").run(LICENCE);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SECRET)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status, rpc_secret_hash) VALUES (?, 'aa', 'synthetic.invalid', 'synthetic', 'synthetic', 'live', ?)").run(LICENCE, hash);
  db.prepare("INSERT INTO licence_promo_ceilings (licence_uid, period, ceiling_cents, currency) VALUES (?, ?, 100000, 'EUR')").run(LICENCE, PERIOD);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}

function branch(hqEnv: any, { period = PERIOD, currency = 'EUR' } = {}, binding?: any) {
  const db = fresh();
  db.prepare("INSERT INTO branch_promo_ceiling (id, period, ceiling_cents, currency, issued_cents, pushed_at) VALUES (1, ?, 100000, ?, 0, '2026-10-01T00:00:00.000Z')").run(period, currency);
  const r = db.prepare(`INSERT INTO promo_ceiling_reservations (ref, period, currency, amount_cents, promo_id, state, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'promo_SYN', ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`);
  r.run('c1', period, currency, 3000, 'committed', '2026-11-01T00:30:00.000Z');
  r.run('c2', period, currency, 2000, 'committed', '2026-11-01T00:30:00.000Z');
  r.run('h1', period, currency, 700, 'reserved', '2026-11-15T09:20:00.000Z'); // live at NOW
  r.run('h2', period, currency, 900, 'reserved', '2026-11-15T08:00:00.000Z'); // expired at NOW
  r.run('x1', period, currency, 5000, 'released', '2026-11-01T00:30:00.000Z');
  r.run('o1', period, 'USD', 4000, 'committed', '2026-11-01T00:30:00.000Z'); // another currency
  return {
    db,
    env: {
      DB: d1Over(db), BRANCH_CODE: 'aa', RPC_SECRET: SECRET,
      HQ: binding ?? { reportPromoIssued: (code: string, s: string, rep: any) => reportPromoIssued(hqEnv, code, s, rep, NOW) },
    } as any,
  };
}

const app = new Hono<any>();
app.route('/api/admin', adminStatements);
async function ceilings(env: any) {
  const token = await new SignJWT({ user_id: SUPER, role: 'admin', jti: 'totp-1' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request('/api/admin/promo-ceilings', { headers: { Authorization: `Bearer ${token}` } }, env));
  return { status: res.status, body: await res.json() as any };
}
const row = (db: DatabaseSync, period = PERIOD) => db.prepare('SELECT * FROM licence_promo_ceilings WHERE licence_uid = ? AND period = ?').get(LICENCE, period) as any;
const quiet = async <T>(f: () => Promise<T>) => {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { [console.warn, console.error] = saved; }
};

test('the branch counts issued (committed + live holds) and spent (committed) for the ceiling it holds', async () => {
  const h = await hq();
  const b = branch(h.env);
  assert.deepEqual(await collectPromoIssued(b.env, NOW), {
    period: PERIOD, currency: 'EUR', issued_cents: 5700, spent_cents: 5000, reported_at: NOW.toISOString(),
  });
  b.db.exec('DELETE FROM branch_promo_ceiling');
  assert.equal(await collectPromoIssued(b.env, NOW), null, 'no ceiling copy, nothing to report against');
  const none = await pushPromoIssuedReport(b.env, NOW);
  assert.deepEqual([none.sent, /holds no promo ceiling/.test(String(none.reason))], [false, true]);
});

test('after a branch run, HQ\'s row holds the branch\'s figures, currency and own as-of time; the read says reported', async () => {
  const h = await hq();
  const b = branch(h.env);
  const before = (await ceilings(h.env)).body.items[0];
  assert.deepEqual([before.issued_cents, before.remaining_cents, before.issued_state, before.issued_available], [null, null, 'not_reported', false],
    'unreported is NULL, never 0, and leaves nothing remaining');
  const pushed = await pushPromoIssuedReport(b.env, NOW);
  assert.deepEqual(pushed, { sent: true, outcome: 'written', period: PERIOD });
  const r = row(h.db);
  assert.deepEqual([r.issued_cents, r.spent_cents, r.issued_currency, r.issued_reported_at], [5700, 5000, 'EUR', NOW.toISOString()]);
  const item = (await ceilings(h.env)).body.items[0];
  assert.deepEqual([item.issued_state, item.issued_state_reason, item.remaining_cents, item.spent_cents, item.issued_available],
    ['reported', null, 94300, 5000, true]);
});

test('a report for a period HQ has no ceiling for is recorded, not written into another row', async () => {
  const h = await hq();
  const b = branch(h.env, { period: PREVIOUS });
  const pushed = await pushPromoIssuedReport(b.env, NOW);
  assert.deepEqual([pushed.sent, pushed.outcome], [true, 'no_ceiling']);
  assert.equal(row(h.db).issued_cents, null, 'the current ceiling is untouched');
  const rec = h.db.prepare('SELECT period, outcome, issued_cents, spent_cents FROM licence_promo_issued_reports WHERE licence_uid = ?').get(LICENCE) as any;
  assert.deepEqual({ ...rec }, { period: PREVIOUS, outcome: 'no_ceiling', issued_cents: 5700, spent_cents: 5000 });
  const item = (await ceilings(h.env)).body.items[0];
  assert.equal(item.issued_state, 'mismatch');
  assert.match(item.issued_state_reason, /latest report is for 2026-Q3, not 2026-Q4/);
  assert.equal(item.remaining_cents, null);
});

test('a report in another currency is recorded as a mismatch and not written; so is a ceiling HQ later moved', async () => {
  const h = await hq();
  const usd = branch(h.env, { currency: 'USD' });
  const pushed = await pushPromoIssuedReport(usd.env, NOW);
  assert.deepEqual([pushed.sent, pushed.outcome], [true, 'currency_mismatch']);
  assert.equal(row(h.db).issued_cents, null);
  let item = (await ceilings(h.env)).body.items[0];
  assert.deepEqual([item.issued_state, item.remaining_cents], ['mismatch', null]);
  assert.match(item.issued_state_reason, /latest report for 2026-Q4 is in USD; this ceiling is in EUR/);
  // A matching report lands; then HQ moves the ceiling to GBP: the EUR figure no longer applies.
  const eur = branch(h.env);
  assert.equal((await pushPromoIssuedReport(eur.env, new Date(NOW.getTime() + 1000))).outcome, 'written');
  h.db.exec("UPDATE licence_promo_ceilings SET currency = 'GBP'");
  item = (await ceilings(h.env)).body.items[0];
  assert.deepEqual([item.issued_state, item.remaining_cents, item.issued_available], ['mismatch', null, false]);
});

test('states are distinct: stale after 48 hours in the current period; a closed period\'s figure is final; unreadable is not "not reported"', () => {
  const base = { period: PERIOD, currency: 'EUR', issued_cents: 10, issued_currency: 'EUR' };
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(promoIssuedState({ ...base, issued_reported_at: ago(PROMO_ISSUED_STALE_MS - 60_000) }, undefined, NOW).state, 'reported');
  assert.equal(promoIssuedState({ ...base, issued_reported_at: ago(PROMO_ISSUED_STALE_MS + 60_000) }, undefined, NOW).state, 'stale');
  assert.equal(promoIssuedState({ ...base, period: PREVIOUS, issued_reported_at: ago(90 * 86_400_000) }, undefined, NOW).state, 'reported');
  assert.equal(promoIssuedState({ ...base, issued_reported_at: 'garbled' }, undefined, NOW).state, 'stale');
  const unreported = { ...base, issued_cents: null, issued_currency: null, issued_reported_at: null };
  assert.equal(promoIssuedState(unreported, undefined, NOW).state, 'not_reported');
  assert.equal(promoIssuedState(unreported, 'unreadable', NOW).state, 'unreadable');
  // A figure already held stays usable when the reports cannot be read.
  assert.equal(promoIssuedState({ ...base, issued_reported_at: ago(1000) }, 'unreadable', NOW).state, 'reported');
});

test('the HQ read: reports table unreadable names unreadable; ceilings table unreadable says so', async () => {
  const h = await hq();
  h.db.exec('DROP TABLE licence_promo_issued_reports');
  const item = (await ceilings(h.env)).body.items[0];
  assert.deepEqual([item.issued_state, item.remaining_cents], ['unreadable', null]);
  h.db.exec('DROP TABLE licence_promo_ceilings');
  const down = (await ceilings(h.env)).body;
  assert.deepEqual([down.available, down.items], [false, []]);
});

test('a caller without the branch secret is refused before any write; a malformed report too', async () => {
  const h = await hq();
  const rep = { period: PERIOD, currency: 'EUR', issued_cents: 1, spent_cents: 1, reported_at: NOW.toISOString() };
  await assert.rejects(reportPromoIssued(h.env, 'aa', 'wrong-secret', rep, NOW), /wrong secret/);
  await assert.rejects(reportPromoIssued(h.env, 'aa', '', rep, NOW), /no secret/);
  await assert.rejects(reportPromoIssued(h.env, 'zz', SECRET, rep, NOW), /not a provisioned branch/);
  for (const bad of [
    { ...rep, spent_cents: 2 }, { ...rep, issued_cents: -1 }, { ...rep, issued_cents: 1.5 }, { ...rep, currency: 'eur' },
    { ...rep, period: '2026-11' }, { ...rep, reported_at: '2026-11-15 09:00:00' },
    { ...rep, reported_at: new Date(NOW.getTime() + 3_600_000).toISOString() }, { ...rep, licence_uid: 'lic_other' },
  ]) await assert.rejects(reportPromoIssued(h.env, 'aa', SECRET, bad as any, NOW), /not one HQ reads/, JSON.stringify(bad));
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM licence_promo_issued_reports').get()!.n, 0);
  assert.equal(row(h.db).issued_cents, null);
});

test('an older report than the one held changes nothing', async () => {
  const h = await hq();
  const later = { period: PERIOD, currency: 'EUR', issued_cents: 900, spent_cents: 800, reported_at: NOW.toISOString() };
  assert.equal((await reportPromoIssued(h.env, 'aa', SECRET, later, NOW)).written, true);
  const older = { ...later, issued_cents: 100, spent_cents: 100, reported_at: new Date(NOW.getTime() - 3_600_000).toISOString() };
  assert.equal((await reportPromoIssued(h.env, 'aa', SECRET, older, NOW)).written, false);
  assert.deepEqual([row(h.db).issued_cents, row(h.db).issued_reported_at], [900, NOW.toISOString()]);
  assert.equal((h.db.prepare('SELECT issued_cents FROM licence_promo_issued_reports').get() as any).issued_cents, 900);
});

test('a failed push never throws: HQ refusing, timing out, unbound, or no secret', async () => {
  const h = await hq();
  const refusing = branch(h.env, {}, { reportPromoIssued: async () => { throw new Error('rpc: aa presented the wrong secret'); } });
  const r1 = await quiet(() => pushPromoIssuedReport(refusing.env, NOW));
  assert.deepEqual([r1.sent, /did not accept the 2026-Q4 promo report: rpc: aa presented the wrong secret/.test(String(r1.reason))], [false, true]);
  const slow = branch(h.env, {}, { reportPromoIssued: () => new Promise(() => {}) });
  const r2 = await pushPromoIssuedReport(slow.env, NOW, 5);
  assert.deepEqual([r2.sent, /did not answer/.test(String(r2.reason))], [false, true]);
  const junk = branch(h.env, {}, { reportPromoIssued: async () => ({ ok: true }) });
  assert.equal((await pushPromoIssuedReport(junk.env, NOW)).sent, false);
  const b = branch(h.env);
  assert.equal((await pushPromoIssuedReport({ ...b.env, RPC_SECRET: '' }, NOW)).sent, false);
  assert.equal((await pushPromoIssuedReport({ ...b.env, HQ: undefined }, NOW)).sent, false);
  assert.equal((await pushPromoIssuedReport({ DB: h.env.DB } as any, NOW)).sent, false, 'HQ reports to nobody');
  assert.equal((await pushPromoIssuedReport({ ...b.env, BRANCH_CODE: 'NOT A CODE!' }, NOW)).sent, false, 'even a malformed code does not throw');
  b.db.exec('DROP TABLE promo_ceiling_reservations');
  assert.equal((await pushPromoIssuedReport(b.env, NOW)).sent, false);
});

test('the branch ledger stays the enforcement source; the method is declared and the 05:10 run calls it on a branch only', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const f of ['../src/services/promoRedemption.ts', '../src/services/promoRenewal.ts', '../src/services/orders.ts']) {
    assert.doesNotMatch(read(f), /licence_promo_ceilings|licence_promo_issued_reports/, `${f} never reads HQ's reported copy`);
  }
  assert.ok(RPC_SURFACE.branchCallsHq.methods.some((m) => m.name === 'reportPromoIssued' && m.called && m.authenticated));
  const cron = read('../src/index.ts');
  const at = cron.indexOf("import('./services/promoIssuedReport')");
  assert.ok(at > 0);
  const gate = cron.lastIndexOf('if (', at);
  assert.match(cron.slice(gate, at), /^if \(!hqCadences && now\.getUTCHours\(\) === 5 && now\.getUTCMinutes\(\) === 10\)/);
});
