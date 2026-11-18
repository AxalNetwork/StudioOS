/**
 * D4631 part 4 (#4631) — the deal-room cap and the Free-tier deal projection follow the held Investor licence and
 * that licence's own plan, whatever the primary role (the owner's answer A, matching #4472's). Deal staff and the
 * venture's own founder keep their projections.
 *
 * Real routers behind the production investor plan gate, on real SQLite, with synthetic users only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_investor_tiering_4631.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import deals from '../src/routes/deals.ts';
import { requireInvestorTierExcept } from '../src/middleware/requireInvestorTier.ts';

const SECRET = 'x'.repeat(64);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
const LICENCES = readFileSync(new URL('../sql/migrations/202611041822_account_licences.sql', import.meta.url), 'utf8');

// Single-licence investors; founders, an advisor and a partner who also hold Investor; the venture's own founder
// holding Investor; staff without it; a founder whose Investor licence is revoked.
const SINGLE_FREE = 1, SINGLE_PAID = 2, COMBO_FREE = 3, COMBO_PAID = 4, COMBO_LAPSED = 5, OWNER_INV = 6;
const ADMIN = 7, PARTNER_INV = 8, ADVISOR_INV = 9, PARTNER = 10, COMBO_REVOKED = 11, ADVISOR = 12;
const USERS: Array<[number, string, number | null, string, string, string | null]> = [
  // id, primary role, founder_id, investor_tier, investor_subscription_status, investor_trial_ends_at
  [SINGLE_FREE, 'investor', null, 'free', 'free', null],
  [SINGLE_PAID, 'investor', null, 'professional', 'active', null],
  [COMBO_FREE, 'founder', 60, 'free', 'free', null], // the Investor licence with no plan of its own: Free
  [COMBO_PAID, 'founder', 61, 'professional', 'active', null],
  [COMBO_LAPSED, 'founder', 62, 'professional', 'trialing', '2020-01-01 00:00:00'], // a trial that has ended
  [OWNER_INV, 'founder', 50, 'free', 'free', null],
  [ADMIN, 'admin', null, 'free', 'free', null],
  [PARTNER_INV, 'partner', null, 'free', 'free', null],
  [ADVISOR_INV, 'advisor', null, 'free', 'free', null],
  [PARTNER, 'partner', null, 'free', 'free', null],
  [COMBO_REVOKED, 'founder', 63, 'professional', 'active', null],
  [ADVISOR, 'advisor', null, 'free', 'free', null],
];

function fixture() {
  const { DB, db } = makeD1('');
  for (const name of ['users', 'founders', 'projects', 'partners', 'deals', 'deal_invitations', 'commitments', 'investor_dealroom_members', 'user_company_links', 'company_profiles', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  }
  db.exec(readFileSync(new URL('../sql/migrations/599_deal_currency.sql', import.meta.url), 'utf8'));
  // The active-firm check reads migration 597's archive column.
  db.exec(readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8'));
  db.exec(LICENCES);
  const u = db.prepare(`INSERT INTO users(id,email,name,role,founder_id,is_active,investor_tier,investor_subscription_status,investor_trial_ends_at)
    VALUES(?,?,?,?,?,1,?,?,?)`);
  for (const [id, role, fid, tier, status, trial] of USERS) u.run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role, fid, tier, status, trial);
  const l = db.prepare(`INSERT INTO account_licences (user_id, licence, source) VALUES (?, 'investor', 'test')`);
  // The admin retained Investor from an earlier primary (D4472's appointment); the admin is never capped.
  for (const id of [COMBO_FREE, COMBO_PAID, COMBO_LAPSED, OWNER_INV, PARTNER_INV, ADVISOR_INV, COMBO_REVOKED, ADMIN]) l.run(id);
  db.exec(`UPDATE account_licences SET revoked_at = '2026-11-10 10:00:00' WHERE user_id = ${COMBO_REVOKED}`);
  db.exec(`INSERT INTO founders(id,name,email) VALUES(50,'Synthetic owner','synthetic6@example.test');
    INSERT INTO projects(id,name,sector,founder_id) VALUES(10,'Synthetic venture','Synthetic sector',50);
    INSERT INTO deals(id,project_id,status,notes,description,target_raise,minimum_check,valuation_cap,closing_deadline,instrument)
      VALUES(100,10,'active','PRIVATE STUDIO NOTE','PRIVATE DESCRIPTION',100000,1000,500000,'2026-12-01','SAFE'),
            (101,10,'active',NULL,NULL,50000,NULL,NULL,NULL,'SAFE'),(102,10,'active',NULL,NULL,50000,NULL,NULL,NULL,'SAFE');`);
  const inv = db.prepare(`INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES(100,?,'invited')`);
  for (const id of [SINGLE_FREE, SINGLE_PAID, COMBO_FREE, COMBO_PAID, COMBO_LAPSED, COMBO_REVOKED, ADVISOR_INV]) inv.run(id);
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono(); const gate = requireInvestorTierExcept('professional');
  app.use('/api/deals', gate); app.use('/api/deals/*', gate);
  app.route('/api/deals', deals);
  app.onError((e, c) => e instanceof Response ? e : c.json({ error: e.message === 'Unauthorized' ? 'Unauthorized' : 'fixture_error' }, e.message === 'Unauthorized' ? 401 : 500));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number, method: string, path: string, company?: number) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (company) headers['X-Company-Id'] = String(company);
  // The fixture leaves out tables auth hydrates optionally; their read warnings are not under test.
  const saved = console.warn; console.warn = () => {};
  try {
    const res = await f.app.request('/api' + path, { method, headers }, f.env).catch((e) => { if (e instanceof Response) return e; throw e; });
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  } finally { console.warn = saved; }
}
const rooms = (f: F, who: number) => (f.db.prepare('SELECT count(*) n FROM investor_dealroom_members WHERE investor_user_id = ?').get(who) as any).n;

test('D4631 p4 · a founder holding Investor on Free reads the deal exactly as a Free single-licence investor', async () => {
  const f = fixture();
  const single = await call(f, SINGLE_FREE, 'GET', '/deals/100');
  const combo = await call(f, COMBO_FREE, 'GET', '/deals/100');
  assert.equal(single.status, 200); assert.equal(combo.status, 200);
  assert.equal(combo.body.plan_limited, true);
  assert.deepEqual(combo.body, single.body, 'the same fields and values');
  for (const name of ['description', 'minimum_check', 'valuation_cap', 'notes', 'project_id', 'founder_user_id']) assert.equal(name in combo.body, false, name);
});

test('D4631 p4 · on a paid Investor plan the combined account reads the full investor projection, as a paid investor does', async () => {
  const f = fixture();
  const single = await call(f, SINGLE_PAID, 'GET', '/deals/100');
  const combo = await call(f, COMBO_PAID, 'GET', '/deals/100');
  assert.equal(combo.status, 200);
  assert.equal(combo.body.plan_limited, undefined);
  assert.equal(combo.body.description, 'PRIVATE DESCRIPTION');
  assert.equal(combo.body.notes, undefined, 'no studio note for an investor reader');
  assert.deepEqual(combo.body, single.body);
});

test('D4631 p4 · an ended trial reads Free; a revoked Investor licence falls back to the primary role and is refused', async () => {
  const f = fixture();
  const lapsed = await call(f, COMBO_LAPSED, 'GET', '/deals/100');
  assert.equal(lapsed.status, 200);
  assert.deepEqual(lapsed.body, (await call(f, SINGLE_FREE, 'GET', '/deals/100')).body);
  assert.equal((await call(f, COMBO_REVOKED, 'GET', '/deals/100')).status, 403);
  const quota = await call(f, COMBO_REVOKED, 'GET', '/deals/dealroom/quota');
  assert.equal(quota.status, 403); assert.equal(quota.body.error, 'investor_only');
  assert.equal((await call(f, COMBO_REVOKED, 'POST', '/deals/101/dealroom/join')).status, 403);
  assert.equal(rooms(f, COMBO_REVOKED), 0, 'a refused join writes nothing');
  // Revoking the grant of a Free combined account removes the investor reading entirely.
  f.db.exec(`UPDATE account_licences SET revoked_at = '2026-11-10 10:00:00' WHERE user_id = ${COMBO_FREE}`);
  assert.equal((await call(f, COMBO_FREE, 'GET', '/deals/100')).status, 403);
});

test('D4631 p4 · staff and the venture\'s own founder keep their projections whatever Investor plan they hold', async () => {
  const f = fixture();
  const owner = await call(f, OWNER_INV, 'GET', '/deals/100');
  assert.equal(owner.status, 200);
  assert.equal(owner.body.plan_limited, undefined, 'the owner reads their own deal as its owner');
  assert.equal(owner.body.description, 'PRIVATE DESCRIPTION');
  assert.equal(owner.body.notes, undefined, 'no studio note for the owner');
  for (const who of [PARTNER_INV, ADMIN]) {
    const staff = await call(f, who, 'GET', '/deals/100');
    assert.equal(staff.status, 200, String(who));
    assert.equal(staff.body.plan_limited, undefined, String(who));
    assert.equal(staff.body.notes, 'PRIVATE STUDIO NOTE', String(who));
  }
  // An advisor primary who holds Investor and is invited reads this deal as an investor, on that plan.
  const advisor = await call(f, ADVISOR_INV, 'GET', '/deals/100');
  assert.equal(advisor.body.plan_limited, true);
});

test('D4631 p4 · the deal-room cap follows the Investor plan for anyone who holds Investor', async () => {
  const f = fixture();
  const single = await call(f, SINGLE_FREE, 'GET', '/deals/dealroom/quota');
  for (const who of [COMBO_FREE, ADVISOR_INV, PARTNER_INV]) {
    const q = await call(f, who, 'GET', '/deals/dealroom/quota');
    assert.equal(q.status, 200, String(who));
    assert.deepEqual(q.body, single.body, `user ${who} reads the Free cap`);
  }
  assert.equal(single.body.cap, 1); assert.equal(single.body.tier, 'free');
  for (const who of [COMBO_FREE, ADVISOR_INV]) {
    assert.equal((await call(f, who, 'POST', '/deals/101/dealroom/join')).status, 200, String(who));
    const over = await call(f, who, 'POST', '/deals/102/dealroom/join');
    assert.equal(over.status, 402, String(who)); assert.equal(over.body.code, 'quota_dealrooms_exhausted');
    assert.equal(rooms(f, who), 1, `user ${who} holds one room`);
  }
  const paid = await call(f, COMBO_PAID, 'GET', '/deals/dealroom/quota');
  assert.equal(paid.body.cap, 5); assert.equal(paid.body.tier, 'professional');
});

test('D4631 p4 · the quota names the rooms of the firm a combined account acts for, as the join and the list do', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO user_company_links(uid, user_id, company_id) VALUES ('link-a', ${COMBO_PAID}, 900), ('link-b', ${COMBO_PAID}, 901)`);
  assert.equal((await call(f, COMBO_PAID, 'POST', '/deals/101/dealroom/join', 901)).status, 200);
  const other = await call(f, COMBO_PAID, 'GET', '/deals/dealroom/quota', 900);
  assert.deepEqual(other.body.member_deal_ids, [], 'the room requested for another firm is not this firm\'s');
  assert.equal(other.body.used, 1, 'the allowance still counts every firm');
  assert.deepEqual((await call(f, COMBO_PAID, 'GET', '/deals/dealroom/quota', 901)).body.member_deal_ids, [101]);
});

test('D4631 p4 · two joins at once cannot both take the one Free room of an advisor who holds Investor', async () => {
  const f = fixture();
  // Hold both requests at the allowance read until each has made it, so both reach the write having read 0 rooms.
  const real = f.env.DB; let arrived = 0; let release!: () => void; const both = new Promise<void>((r) => { release = r; });
  f.env.DB = { ...real, prepare(sql: string) {
    const stmt = real.prepare(sql);
    if (!/^SELECT COUNT\(\*\) AS n FROM investor_dealroom_members WHERE investor_user_id = \?$/.test(sql.trim())) return stmt;
    return { bind: (...a: unknown[]) => { const b = stmt.bind(...a); return { ...b, first: async (col?: string) => {
      const row = await b.first(col); if (++arrived === 2) release(); await both; return row; } }; } };
  } };
  const results = await Promise.all([101, 102].map((deal) => call(f, ADVISOR_INV, 'POST', `/deals/${deal}/dealroom/join`)));
  assert.ok(arrived >= 2, 'both requests read the allowance before either wrote');
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 402]);
  assert.equal(rooms(f, ADVISOR_INV), 1, 'the allowance is checked in the write itself');
});

test('D4631 p4 · staff and bypass primaries without Investor stay uncapped', async () => {
  const f = fixture();
  for (const who of [ADMIN, PARTNER, ADVISOR]) {
    const q = await call(f, who, 'GET', '/deals/dealroom/quota');
    assert.equal(q.status, 200, String(who));
    assert.equal(q.body.unlimited, true, String(who));
    for (const deal of [101, 102]) assert.equal((await call(f, who, 'POST', `/deals/${deal}/dealroom/join`)).status, 200, `${who} ${deal}`);
    assert.equal(rooms(f, who), 2);
  }
});
