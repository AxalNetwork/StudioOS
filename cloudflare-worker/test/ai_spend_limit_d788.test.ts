/**
 * D788 (#2213) — a member's monthly AI spend limit: the store, the routes, the
 * refusal at the hold, and the 50/80/100% notices.
 *
 * The real budget (migrations 419, 430, 486, 505, 508 over SQLite) and the real
 * routes. Every fixture member has a $50-a-month plan allowance
 * (`_ai_budget_fixture.mjs`), so runs here are paid from the allowance and the
 * limit is what refuses them. No network: the mailer is stubbed over fetch.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_spend_limit_d788.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { loadAiBudget, reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { budgetRefusalMessage } from '../src/services/aiRouter.ts';
import { noteSpendThresholds, parseSpendLimit, readSpendLimit, resetsOn, writeSpendLimit } from '../src/services/aiSpendLimit.ts';
import budgetRoute from '../src/routes/ai_budget.ts';

const JWT_SECRET = 'd788-fixture-only-signing-secret';
const OCT = new Date('2026-10-07T12:00:00Z');
const MEMBER = 2;
const ALL_ON = { 50: true, 80: true, 100: true } as const;

function fixture() {
  const f = aiBudgetFixture();
  f.db.exec(tableFromBaseline(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'), 'user_sessions'));
  const s = f.db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now', ?))");
  s.run(MEMBER, 'totp-fresh', 'totp', '+0 seconds');
  s.run(MEMBER, 'totp-stale', 'totp', '-2 days');
  s.run(MEMBER, 'password-fresh', 'password', '+0 seconds');
  const env = { DB: f.DB, JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { ...f, env };
}
const holds = (db: any) => db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n;
const limitOf = (env: any, usd: number | null, notify: any = ALL_ON) =>
  writeSpendLimit(env, MEMBER, usd === null ? null : Math.round(usd * 1_000_000), notify);
async function spend(env: any, micro: number, now = OCT) {
  const h = await reserveAiBudget(env, MEMBER, micro, now);
  if (!h.ok) throw new Error(`refused: ${h.refusal}`);
  await settleAiReservation(env, h.reservation, micro);
}
async function call(env: any, method: string, path: string, jti: string | null, body?: unknown) {
  const jwt = await new SignJWT({ user_id: MEMBER, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return budgetRoute.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}

// ------------------------------------------------------------------ the hold

test('no limit: a hold passes as it did, and removing a limit restores that', async () => {
  const f = fixture();
  try {
    const one = await reserveAiBudget(f.env, MEMBER, 2_000_000, OCT);
    assert.equal(one.ok, true);
    await limitOf(f.env, 1);
    const refused = await reserveAiBudget(f.env, MEMBER, 2_000_000, OCT);
    assert.equal(refused.ok, false);
    await limitOf(f.env, null);
    assert.equal((await reserveAiBudget(f.env, MEMBER, 2_000_000, OCT)).ok, true, 'removing the limit restores today’s behaviour');
  } finally { f.db.close(); }
});

test('a limit just below a run’s estimate refuses it with spend_limit, and nothing is held or charged', async () => {
  const f = fixture();
  try {
    await limitOf(f.env, 0.5);
    const before = await loadAiBudget(f.env, MEMBER, OCT);
    const r = await reserveAiBudget(f.env, MEMBER, 500_001, OCT);
    assert.deepEqual(r, { ok: false, refusal: 'spend_limit', limit_microusd: 500_000, resets_on: '2026-11-01' });
    assert.equal(holds(f.db), 0, 'a hold was placed');
    const after = await loadAiBudget(f.env, MEMBER, OCT);
    assert.equal(after.month_spend_microusd, before.month_spend_microusd);
    assert.equal(after.balance_microusd, before.balance_microusd);
    // The member's words: the limit and the reset date.
    assert.equal(budgetRefusalMessage('spend_limit', r as any),
      'This run would pass your monthly AI spend limit of $0.50. Raise it on Usage › Limits, or wait until 1 November 2026.');
    // At the limit exactly, it passes.
    assert.equal((await reserveAiBudget(f.env, MEMBER, 500_000, OCT)).ok, true);
  } finally { f.db.close(); }
});

test('the limit counts what this month’s runs were charged, the allowance included, and the holds still open', async () => {
  const f = fixture();
  try {
    await limitOf(f.env, 1);
    await spend(f.env, 600_000);
    // Paid from the plan's allowance, and still counted.
    assert.equal((await reserveAiBudget(f.env, MEMBER, 400_001, OCT)).ok, false);
    const open = await reserveAiBudget(f.env, MEMBER, 300_000, OCT);
    assert.equal(open.ok, true);
    // The open hold counts at what it holds.
    const next = await reserveAiBudget(f.env, MEMBER, 100_001, OCT);
    assert.equal(next.ok, false);
    // A refunded hold counts at what it charged: nothing.
    if (!open.ok) throw new Error('unreachable');
    await settleAiReservation(f.env, open.reservation, 0, true);
    assert.equal((await reserveAiBudget(f.env, MEMBER, 400_000, OCT)).ok, true);
  } finally { f.db.close(); }
});

test('two holds racing under a limit that fits one: exactly one passes', async () => {
  const f = fixture();
  try {
    await limitOf(f.env, 1);
    const both = await Promise.all([reserveAiBudget(f.env, MEMBER, 700_000, OCT), reserveAiBudget(f.env, MEMBER, 700_000, OCT)]);
    assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
    assert.equal(both.find((r) => !r.ok)!.refusal, 'spend_limit');
    assert.equal(holds(f.db), 1);
  } finally { f.db.close(); }
});

test('the limit is per UTC month: October’s charge does not count in November', async () => {
  const f = fixture();
  try {
    await limitOf(f.env, 1);
    const lastSecond = new Date('2026-10-31T23:59:59Z');
    await spend(f.env, 900_000, lastSecond);
    assert.equal((await reserveAiBudget(f.env, MEMBER, 200_000, lastSecond)).ok, false);
    const firstSecond = new Date('2026-11-01T00:00:00Z');
    assert.equal((await reserveAiBudget(f.env, MEMBER, 900_000, firstSecond)).ok, true);
    assert.equal(resetsOn(lastSecond), '2026-11-01');
    assert.equal(resetsOn(new Date('2026-12-15T00:00:00Z')), '2027-01-01');
    const nov = await readSpendLimit(f.env, MEMBER, firstSecond);
    assert.deepEqual([nov.month, nov.charged_microusd, nov.resets_on], ['2026-11', 900_000, '2026-12-01']);
  } finally { f.db.close(); }
});

// ------------------------------------------------------------------ the routes

test('GET /limit reads the limit, this month’s charge, the share used and the allowance', async () => {
  const f = fixture();
  try {
    const none = await (await call(f.env, 'GET', '/limit', null)).json() as any;
    assert.equal(none.limit_microusd, null);
    assert.equal(none.share_used, null);
    assert.equal(none.allowance.monthly_microusd, 50_000_000);
    await limitOf(f.env, 4);
    await spend(f.env, 1_000_000, new Date());
    const set = await (await call(f.env, 'GET', '/limit', null)).json() as any;
    assert.deepEqual([set.limit_microusd, set.charged_microusd, set.share_used], [4_000_000, 1_000_000, 25]);
    assert.deepEqual(set.notify, { 50: true, 80: true, 100: true });
  } finally { f.db.close(); }
});

test('PUT /limit needs a recent sign-in, refuses a bad amount by field, and null removes the limit', async () => {
  const f = fixture();
  try {
    // A recent sign-in, as billing asks: no session, a stale one, or a password one is refused.
    assert.equal((await call(f.env, 'PUT', '/limit', null, { monthly_limit_usd: 5 })).status, 403);
    const stale = await call(f.env, 'PUT', '/limit', 'totp-stale', { monthly_limit_usd: 5 });
    assert.equal(stale.status, 403);
    assert.equal((await stale.json() as any).code, 'step_up_required');
    assert.equal((await call(f.env, 'PUT', '/limit', 'password-fresh', { monthly_limit_usd: 5 })).status, 403);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_spend_limits').get().n, 0, 'a refused PUT wrote');

    for (const [body, field] of [
      [{ monthly_limit_usd: -1 }, 'monthly_limit_usd'],
      [{ monthly_limit_usd: 1.234 }, 'monthly_limit_usd'],
      [{ monthly_limit_usd: 100_000.01 }, 'monthly_limit_usd'],
      [{ monthly_limit_usd: '5' }, 'monthly_limit_usd'],
      [{}, 'monthly_limit_usd'],
      [{ monthly_limit_usd: 5, notify: { 60: true } }, 'notify.60'],
      [{ monthly_limit_usd: 5, notify: { 50: 'yes' } }, 'notify.50'],
    ] as const) {
      const r = await call(f.env, 'PUT', '/limit', 'totp-fresh', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal((await r.json() as any).field, field, JSON.stringify(body));
    }
    const ok = await call(f.env, 'PUT', '/limit', 'totp-fresh', { monthly_limit_usd: 100_000, notify: { 80: false } });
    assert.equal(ok.status, 200);
    const body = await ok.json() as any;
    assert.deepEqual([body.limit_microusd, body.notify], [100_000_000_000, { 50: true, 80: false, 100: true }]);
    const cents = await call(f.env, 'PUT', '/limit', 'totp-fresh', { monthly_limit_usd: 12.5 });
    assert.equal((await cents.json() as any).limit_microusd, 12_500_000);
    const removed = await call(f.env, 'PUT', '/limit', 'totp-fresh', { monthly_limit_usd: null });
    assert.equal((await removed.json() as any).limit_microusd, null);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_spend_limits').get().n, 0);
  } finally { f.db.close(); }
});

test('parseSpendLimit takes dollars to micro-USD exactly', () => {
  assert.deepEqual(parseSpendLimit({ monthly_limit_usd: 0 }), { ok: true, limit_microusd: 0, notify: ALL_ON });
  assert.equal((parseSpendLimit({ monthly_limit_usd: 0.07 }) as any).limit_microusd, 70_000);
  assert.equal((parseSpendLimit({ monthly_limit_usd: 99_999.99 }) as any).limit_microusd, 99_999_990_000);
  assert.equal(parseSpendLimit(null).ok, false);
});

// ------------------------------------------------------------------ notices

/** A sent message as text: its encoded subject and its base64 parts decoded. */
function readable(mime: string): string {
  const utf8 = (b64: string) => decodeURIComponent(escape(atob(b64)));
  const subject = mime.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => utf8(b));
  const parts = mime.split(/\r\n\r\n/).slice(1).map((chunk) => chunk.split(/\r\n--/)[0].replace(/\r\n/g, ''))
    .filter((c) => /^[A-Za-z0-9+/=]+$/.test(c)).map(utf8);
  return [subject, ...parts].join('\n');
}
function mailer() {
  const sent: string[] = [];
  const saved = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    if (u.startsWith('https://gmail.googleapis.com/')) {
      const raw = JSON.parse(String(init.body)).raw.replace(/-/g, '+').replace(/_/g, '/');
      sent.push(readable(decodeURIComponent(escape(atob(raw)))));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = saved; } };
}
const mailEnv = (env: any) => ({ ...env, GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
// `notify` creates the inbox on its first write, so before any notice there is no table and no row.
const notices = (db: any) => (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'notifications_inbox'").get()
  ? db.prepare("SELECT title, body, payload FROM notifications_inbox WHERE type = 'ai_spend_limit' ORDER BY id").all() : []);
const ledger = (db: any) => db.prepare('SELECT month, threshold FROM member_ai_spend_notices ORDER BY month, threshold').all().map((r: any) => `${r.month}:${r.threshold}`);

test('each notice fires once a month as a settled run passes 50, 80 and 100%, in the app and by email', async () => {
  const f = fixture();
  const mail = mailer();
  const env = mailEnv(f.env);
  try {
    await limitOf(env, 1);
    await spend(env, 400_000);
    assert.equal(notices(f.db).length, 0, 'a notice below 50%');
    await spend(env, 150_000); // 55%
    await spend(env, 50_000); // 60%: 50% again, no second notice
    await spend(env, 250_000); // 85%
    await spend(env, 150_000); // 100%
    assert.deepEqual(ledger(f.db), ['2026-10:50', '2026-10:80', '2026-10:100']);
    const rows = notices(f.db);
    assert.deepEqual(rows.map((r: any) => JSON.parse(r.payload).threshold), [50, 80, 100]);
    assert.equal(rows[2].title, 'You have reached your monthly AI spend limit of $1.00');
    assert.equal(rows[0].body, '$0.55 of $1.00 charged this month. The limit resets on 1 November 2026.');
    // One email each, naming the amount and the reset date, and never the run.
    assert.equal(mail.sent.length, 3);
    assert.match(mail.sent[0], /used 50% of your monthly AI spend limit of \$1\.00/);
    assert.match(mail.sent[0], /resets on 1 November 2026/);
    for (const m of mail.sent) assert.doesNotMatch(m, /prompt|output|reservation|task/i);
    // A settlement that passes nothing new sends nothing.
    await limitOf(env, 2);
    await spend(env, 10_000);
    assert.equal(notices(f.db).length, 3);
  } finally { mail.restore(); f.db.close(); }
});

test('a notice switched off is not sent or recorded, and a jump past two sends the higher one', async () => {
  const f = fixture();
  try {
    await limitOf(f.env, 1, { 50: true, 80: false, 100: true });
    await spend(f.env, 900_000); // 50 and 80 at once; 80 is off
    assert.deepEqual(ledger(f.db), ['2026-10:50']);
    assert.deepEqual(notices(f.db).map((r: any) => JSON.parse(r.payload).threshold), [50]);
    await spend(f.env, 100_000); // 100%
    assert.deepEqual(ledger(f.db), ['2026-10:50', '2026-10:100']);
    // All on, from 0 to 90% in one run: one notice, the higher one; 50 is recorded unsent.
    const g = fixture();
    try {
      await limitOf(g.env, 1);
      await spend(g.env, 900_000);
      assert.deepEqual(ledger(g.db), ['2026-10:50', '2026-10:80']);
      assert.deepEqual(notices(g.db).map((r: any) => JSON.parse(r.payload).threshold), [80]);
    } finally { g.db.close(); }
  } finally { f.db.close(); }
});

test('a notice reads settled runs only: a hold still open does not send one', async () => {
  const f = fixture();
  try {
    await limitOf(f.env, 1);
    const open = await reserveAiBudget(f.env, MEMBER, 600_000, OCT);
    assert.equal(open.ok, true);
    await spend(f.env, 100_000); // settled: 10%; with the open hold, 70%
    assert.deepEqual(ledger(f.db), []);
    assert.equal(notices(f.db).length, 0);
    if (!open.ok) throw new Error('unreachable');
    await settleAiReservation(f.env, open.reservation, 600_000); // settled: 70%
    assert.deepEqual(ledger(f.db), ['2026-10:50']);
  } finally { f.db.close(); }
});

test('the next month starts its notices again, and no limit sends none', async () => {
  const f = fixture();
  try {
    await spend(f.env, 900_000);
    assert.equal(await noteSpendThresholds(f.env, MEMBER, '2026-10'), null);
    await limitOf(f.env, 1);
    await spend(f.env, 100_000, new Date('2026-10-31T23:00:00Z'));
    await spend(f.env, 600_000, new Date('2026-11-02T00:00:00Z'));
    assert.deepEqual(ledger(f.db), ['2026-10:50', '2026-10:80', '2026-10:100', '2026-11:50']);
  } finally { f.db.close(); }
});

test('a member route answers spend_limit with 402 in the run’s own words; without them, the reset date', async () => {
  const { Hono } = await import('hono');
  const { refuseRun } = await import('../src/util/railContext.ts');
  const app = new Hono();
  const words = budgetRefusalMessage('spend_limit', { limit_microusd: 25_000_000, resets_on: '2026-11-01' });
  assert.equal(words, 'This run would pass your monthly AI spend limit of $25.00. Raise it on Usage › Limits, or wait until 1 November 2026.');
  app.get('/', (c) => refuseRun(c, { refusal: 'spend_limit', error: words })!);
  const r = await app.request('/');
  assert.equal(r.status, 402);
  const body = await r.json() as any;
  assert.equal(body.error, 'spend_limit');
  assert.equal(body.message, words);
  assert.equal(budgetRefusalMessage('spend_limit', null).startsWith('This run would pass your monthly AI spend limit. Raise it on Usage › Limits, or wait until 1 '), true);
});
