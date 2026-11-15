/**
 * D4636 part 5 (#4636) — the owner's decision of 2026-11-14: a founder who is
 * GP of record skips the Studio paywall (`requireTier('studio')` on
 * `/api/positions`), but only on the five position reads, and sees only their
 * own funds' companies there (`positionScope`, part 4). Writes, every other
 * paywalled path, a founder with no fund and a Studio founder are unchanged.
 *
 * Driven through the real Worker (`src/index.ts`), so the paywall loop over
 * STUDIO_PREFIXES runs before the routes. Real schema (`loadSchema`),
 * synthetic fixtures only:
 *   ADMIN    platform admin
 *   FGP      founder on the Free plan, GP of record of fund 30
 *   SGP      founder on the Raise + Grow (studio) plan, GP of record of fund 10
 *   FOUNDER  founder on the Free plan, no fund
 *   SFOUNDER founder on the studio plan, no fund
 *   NGP      partner (no investor licence), GP of record of fund 40
 *   HOLDER   investor with a confirmed commitment in venture 8
 *   OGP      role 'exploring' (no Founder licence, no bypass), GP of record of fund 50
 *
 * Venture 6 has a round from fund 30, venture 7 one from fund 10, venture 8 one
 * from fund 20 (held by HOLDER), venture 5 one from fund 40, venture 4 one
 * from fund 50.
 *
 * Each assertion that guards this part names the mutation checked against it
 * (`mutation:`); D4636-p5.md §3 records the results.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/fund_reads_d4636_p5.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import worker from '../src/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { memKV } from './_mem_kv.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4636-part5-0123456789';
const ADMIN = 1, FGP = 2, SGP = 3, FOUNDER = 4, SFOUNDER = 5, NGP = 6, HOLDER = 7, OGP = 8;
const AS_OF = '2026-11-12';
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, subscription_tier, subscription_status, investor_tier, investor_subscription_status)
    VALUES (?, ?, NULL, ?, ?, 1, ?, 'active', ?, 'active')`);
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example', 'free', 'free');
  u.run(FGP, 'founder', 'Fay', 'fay@fund.example', 'free', 'free');
  u.run(SGP, 'founder', 'Sam', 'sam@fund.example', 'studio', 'free');
  u.run(FOUNDER, 'founder', 'Fin', 'fin@startup.example', 'free', 'free');
  u.run(SFOUNDER, 'founder', 'Sol', 'sol@startup.example', 'studio', 'free');
  u.run(NGP, 'partner', 'Nia', 'nia@fund.example', 'free', 'free');
  u.run(HOLDER, 'investor', 'Hal', 'hal@angel.example', 'free', 'professional');
  u.run(OGP, 'exploring', 'Oli', 'oli@fund.example', 'free', 'free');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES
      (4, 'p4', 'Venture Four', 40), (5, 'p5', 'Venture Five', 50), (6, 'p6', 'Venture Six', 60), (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80);
    INSERT INTO vc_funds (id, name, gp_user_id) VALUES
      (10, 'Fund Ten', ${SGP}), (20, 'Fund Twenty', ${ADMIN}), (30, 'Fund Thirty', ${FGP}), (40, 'Fund Forty', ${NGP}), (50, 'Fund Fifty', ${OGP});
    INSERT INTO deals (id, project_id) VALUES (80, 8);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 80);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 80, ${HOLDER}, 1000, 'confirmed');
    INSERT INTO portfolio_positions (uid, fund_id, project_id, round_name, invested_amount, ownership_pct, position_date, created_by) VALUES
      ('pos4', 50, 4, 'Seed', 90, 1, '2026-01-04', ${ADMIN}),
      ('pos5', 40, 5, 'Seed', 100, 1, '2026-01-05', ${ADMIN}),
      ('pos6', 30, 6, 'Pre-seed', 600, 6, '2026-02-01', ${ADMIN}),
      ('pos7', 10, 7, 'Seed', 500, 5, '2026-01-10', ${ADMIN}),
      ('pos8', 20, 8, 'Seed', 800, 8, '2026-02-10', ${ADMIN});
    INSERT INTO portfolio_marks (uid, fund_id, project_id, as_of_date, fmv, basis) VALUES
      ('m6f30', 30, 6, '2026-06-30', 650, 'gp_estimate'),
      ('m7f10', 10, 7, '2026-06-30', 900, 'round_price'),
      ('m8f20', 20, 8, '2026-06-30', 400, 'gp_estimate');
    INSERT INTO portfolio_distributions (uid, fund_id, project_id, distribution_date, amount, kind) VALUES
      ('d6f30', 30, 6, '2026-07-01', 60, 'secondary'),
      ('d8f20', 20, 8, '2026-07-01', 50, 'secondary');
  `);
  return db;
}

function envOf(db: DatabaseSync) {
  return { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() } as any;
}

async function call(db: DatabaseSync, userId: number, path: string, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const s = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await worker.fetch(new Request(`https://axal.vc/api${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), envOf(db), ctx);
    const text = await res.text();
    let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally { [console.warn, console.error] = s; }
}

const pids = (items: any[]) => items.map((x) => Number(x.project_id)).sort();
const uids = (items: any[]) => items.map((x) => x.uid).sort();
const paywalled = (r: { status: number; body: any }) => r.status === 402 && r.body?.error === 'tier_required' && r.body?.required === 'studio';

const FIVE_READS = ['/positions', '/positions/marks', '/positions/analytics', `/positions/kpi-compliance?as_of=${AS_OF}`, '/positions/p6'];

// ── 1. A Free founder who runs a fund reaches the five reads ─────────────────

test('a Free founder who is GP of record passes the Studio paywall on all five position reads, scoped to their fund', async () => {
  const db = fixture();
  try {
    // mutation: no exemption (or the exemption off the list / detail pattern) answers 402 on these.
    for (const path of FIVE_READS) {
      const res = await call(db, FGP, path);
      assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body)}`);
    }
    const list = await call(db, FGP, '/positions');
    assert.deepEqual(pids(list.body.items), [6], 'fund 30\'s company only');
    assert.deepEqual(list.body.fund_scope.fund_ids, [30]);
    assert.deepEqual(uids((await call(db, FGP, '/positions/marks')).body.items), ['m6f30']);
    const analytics = await call(db, FGP, '/positions/analytics');
    assert.equal(analytics.body.position_count, 1);
    assert.equal(analytics.body.paid_in, 600);
    assert.equal(analytics.body.distributed, 60);
    assert.deepEqual(pids((await call(db, FGP, `/positions/kpi-compliance?as_of=${AS_OF}`)).body.companies), [6]);
    const detail = await call(db, FGP, '/positions/p6');
    assert.deepEqual(uids(detail.body.rounds), ['pos6']);
    assert.equal('created_by' in detail.body.rounds[0], false, 'the investor projection');

    // Past the paywall, the handlers' own scope still refuses other companies.
    assert.equal((await call(db, FGP, '/positions/p7')).status, 403, 'another GP\'s fund');
    assert.equal((await call(db, FGP, '/positions/p8')).status, 403, 'an investor\'s holding');
    assert.equal((await call(db, FGP, '/positions/nope')).status, 404);
  } finally { db.close(); }
});

// ── 2. The same founder: writes and every other paywalled path ──────────────

test('the same founder still hits the paywall on a positions write, another method and other paywalled routes', async () => {
  const db = fixture();
  try {
    // mutation: matching the exemption on path alone (any method) lets these through to the handler's 403.
    assert.ok(paywalled(await call(db, FGP, '/positions/p6/marks', 'POST', { as_of_date: '2026-09-30', fmv: 1, basis: 'cost' })), 'POST marks');
    assert.ok(paywalled(await call(db, FGP, '/positions/p6/distributions', 'POST', { distribution_date: '2026-09-30', amount: 1, kind: 'exit' })), 'POST distributions');
    assert.ok(paywalled(await call(db, FGP, '/positions', 'POST', { project_uid: 'p6', round_name: 'A', invested_amount: 1 })), 'POST position');
    assert.ok(paywalled(await call(db, FGP, '/positions/p6', 'PUT', { round_name: 'B' })), 'PUT position');
    // mutation: a path pattern that is not anchored at the end admits a deeper GET under the prefix.
    assert.ok(paywalled(await call(db, FGP, '/positions/p6/marks')), 'a GET two segments deep');
    // mutation: matching any Studio prefix admits these.
    for (const path of ['/capital', '/funds', '/portfolio', '/lp-reports', '/watchlist']) {
      assert.ok(paywalled(await call(db, FGP, path)), path);
    }
  } finally { db.close(); }
});

// ── 3. A Free founder with no fund: unchanged ────────────────────────────────

test('a Free founder with no fund still hits the paywall on all five reads', async () => {
  const db = fixture();
  try {
    // mutation: the exemption without the fund check (any founder on the five paths) answers 403 from the handler.
    for (const path of [...FIVE_READS, '/positions/nope']) {
      assert.ok(paywalled(await call(db, FOUNDER, path)), path);
    }
  } finally { db.close(); }
});

test('a founder who stops being GP of record hits the paywall again on the next read', async () => {
  const db = fixture();
  try {
    assert.equal((await call(db, FGP, '/positions')).status, 200);
    db.prepare('UPDATE vc_funds SET gp_user_id = ? WHERE id = 30').run(ADMIN);
    for (const path of FIVE_READS) assert.ok(paywalled(await call(db, FGP, path)), path);
  } finally { db.close(); }
});

// ── 4. Studio founders, a partner and an investor: unchanged ─────────────────

test('a Studio founder, a partner and an investor read and write exactly as before', async () => {
  const db = fixture();
  try {
    // A Studio founder who runs a fund: past the plan gate, scoped by the handlers; writes stay admin-only.
    const sgp = await call(db, SGP, '/positions');
    assert.equal(sgp.status, 200);
    assert.deepEqual(pids(sgp.body.items), [7]);
    const write = await call(db, SGP, '/positions/p7/marks', 'POST', { as_of_date: '2026-09-30', fmv: 1, basis: 'cost' });
    assert.equal(write.status, 403, 'past the paywall, refused by requireAdmin');
    assert.notEqual((await call(db, SGP, '/capital')).status, 402);

    // A Studio founder with no fund: past the paywall, 403 from positionScope.
    for (const path of FIVE_READS) assert.equal((await call(db, SFOUNDER, path)).status, 403, path);

    // A partner GP bypasses the plan gate by role, as before (part 4's scope applies).
    const ngp = await call(db, NGP, '/positions');
    assert.equal(ngp.status, 200);
    assert.deepEqual(pids(ngp.body.items), [5]);
    assert.notEqual((await call(db, NGP, '/capital')).status, 402);

    const holder = await call(db, HOLDER, '/positions');
    assert.equal(holder.status, 200);
    assert.deepEqual(pids(holder.body.items), [8]);
    assert.equal((await call(db, HOLDER, '/positions/p8')).status, 200);
    assert.equal((await call(db, HOLDER, '/positions/p6')).status, 403);

    const admin = await call(db, ADMIN, '/positions');
    assert.deepEqual(pids(admin.body.items), [4, 5, 6, 7, 8]);
  } finally { db.close(); }
});

test('a GP of record who does not hold Founder and does not bypass the gate is not exempted', async () => {
  const db = fixture();
  try {
    // mutation: dropping the Founder-licence check admits this caller to the five reads.
    for (const path of ['/positions', '/positions/marks', '/positions/p4']) {
      assert.ok(paywalled(await call(db, OGP, path)), path);
    }
  } finally { db.close(); }
});
