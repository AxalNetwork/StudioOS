/**
 * D4729 (#4729) — paid features follow each licence's own plan (owner answer A on #4472).
 *
 * One case per licence and per mix:
 *   Founder; Founder granted to an Investor-primary member; Investor; Investor granted to a Founder-primary
 *   member; Investor granted to an Advisor- or Partner-primary member; Advisor and Partner plans; the cases that
 *   must not change (one licence, Partner or Advisor only, Admin, a grant never writes a plan row); the account
 *   read's `plan`; and refusal bodies that carry no exception text.
 * Synthetic data only: ids 9001 to 9016, emails at @example.test.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_plans_4729.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { requireTier, userMeetsTier, interviewCapRefusal } from '../src/middleware/requireTier.ts';
import { requireInvestorTier, userMeetsInvestorTier } from '../src/middleware/requireInvestorTier.ts';
import { licencePlanTier, licenceMeetsTier, ownLicenceMeets } from '../src/services/licencePlans.ts';
import accountLicences from '../src/routes/account_licences.ts';
import { callerHasFullLens } from '../src/util/marketIntelTier.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const DAY = 24 * 60 * 60 * 1000;
const future = new Date(Date.now() + 10 * DAY).toISOString();
const past = new Date(Date.now() - 10 * DAY).toISOString();

type U = { id: number; role: string; ft?: string; fs?: string; it?: string; is?: string; trial?: string | null; seat?: number | null; grants?: string[]; sub?: string };
const USERS: U[] = [
  { id: 9001, role: 'founder' },                                                  // Founder on Free
  { id: 9002, role: 'founder', ft: 'growth' },                                    // Founder on Validate + Build
  { id: 9003, role: 'investor', grants: ['founder'] },                            // Investor-primary, Founder granted, no Founder plan
  { id: 9004, role: 'investor', grants: ['founder'], ft: 'studio' },              // ... with a stored Founder plan
  { id: 9005, role: 'investor', it: 'professional', is: 'active' },               // Investor on Professional, one licence
  { id: 9006, role: 'founder', grants: ['investor'] },                            // Founder-primary, Investor granted, no Investor plan
  { id: 9007, role: 'founder', grants: ['investor'], it: 'institutional', is: 'active', ft: 'growth' }, // ... with Institutional stored
  { id: 9008, role: 'advisor', grants: ['investor'] },                            // Advisor-primary, Investor granted
  { id: 9009, role: 'partner', grants: ['investor'] },                            // Partner-primary, Investor granted
  { id: 9010, role: 'partner' },                                                  // Partner only
  { id: 9011, role: 'advisor', sub: 'advisor' },                                  // Advisor only, with an Advisor plan row
  { id: 9012, role: 'admin' },
  { id: 9013, role: 'investor', it: 'professional', is: 'trialing', trial: past },// an expired trial
  { id: 9014, role: 'investor', seat: 9005 },                                     // a seat of 9005's Professional plan
  { id: 9015, role: 'investor', it: 'free', is: 'free' },                         // Investor on Free
  { id: 9016, role: 'founder', grants: ['advisor', 'partner'] },                  // Founder-primary holding Advisor and Partner, no plans
];

function world() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  const ins = db.prepare(`INSERT INTO users (id, email, name, role, is_active, subscription_tier, subscription_status,
      investor_tier, investor_subscription_status, investor_trial_ends_at, investor_seat_primary_user_id)
    VALUES (?, ?, ?, ?, 1, ?, 'active', ?, ?, ?, ?)`);
  for (const u of USERS) ins.run(u.id, `u${u.id}@example.test`, `User ${u.id}`, u.role, u.ft ?? 'free', u.it ?? 'free', u.is ?? 'free', u.trial ?? null, u.seat ?? null);
  const grant = db.prepare(`INSERT INTO account_licences (user_id, licence, source, granted_by) VALUES (?, ?, 'admin', 9012)`);
  for (const u of USERS) for (const g of u.grants ?? []) grant.run(u.id, g);
  db.exec(`CREATE TABLE IF NOT EXISTS account_subscriptions (user_id INTEGER PRIMARY KEY, plan_group TEXT, plan TEXT, status TEXT NOT NULL DEFAULT 'free',
    subscription_id TEXT, period_end TEXT, trial_end TEXT, stripe_customer_id TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
  db.prepare(`INSERT INTO account_subscriptions (user_id, plan_group, plan, status, period_end) VALUES (9011, 'advisor', 'advisor_pro', 'active', ?)`).run(future);
  db.prepare(`INSERT INTO projects (id, name) VALUES (9001, 'Synthetic project')`).run();
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  const app = new Hono();
  app.onError((e, c) => (e instanceof Response ? e : c.json({ error: 'boom', detail: String((e as Error).message) }, 500)));
  app.use('/founder-growth', requireTier('growth'));
  app.get('/founder-growth', (c) => c.json({ ok: true }));
  app.use('/founder-studio', requireTier('studio'));
  app.get('/founder-studio', (c) => c.json({ ok: true }));
  for (const t of ['plus', 'professional', 'institutional'] as const) {
    app.use(`/investor-${t}`, requireInvestorTier(t));
    app.get(`/investor-${t}`, (c) => c.json({ ok: true }));
  }
  app.route('/api', accountLicences);
  return { db, env, app };
}
const ROLE: Record<number, string> = Object.fromEntries(USERS.map((u) => [u.id, u.role]));
async function call(w: ReturnType<typeof world>, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await w.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, w.env).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text };
}
const set = (w: ReturnType<typeof world>, id: number, col: string, value: string) => w.db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(value, id);
const row = (w: ReturnType<typeof world>, id: number) => w.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
async function withLicences(w: ReturnType<typeof world>, id: number) {
  const { heldLicences } = await import('../src/services/accountLicences.ts');
  const u = row(w, id);
  return { ...u, licences: await heldLicences(w.env.DB, u) };
}

test('Founder: Free is refused a growth gate (402 tier_required, plan founder:growth); on growth they pass; the interview cap applies', async () => {
  const w = world();
  const refused = await call(w, 9001, '/founder-growth');
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error, 'tier_required');
  assert.equal(refused.body.required, 'growth');
  assert.equal(refused.body.plan.plan_key, 'founder:growth');
  assert.equal((await call(w, 9002, '/founder-growth')).status, 200);
  assert.equal((await call(w, 9002, '/founder-studio')).status, 402, 'growth does not cover studio');
  for (let i = 0; i < 5; i++) w.db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (9001, ?)`).run(`Synthetic ${i}`);
  assert.equal((await interviewCapRefusal(w.env, 9001, 9001))?.error, 'tier_required');
  assert.equal(await interviewCapRefusal(w.env, 9002, 9001), null, 'a paid founder is not capped');
});

test('Founder granted to an Investor-primary member: refused growth and studio without a Founder plan, the cap applies; stored studio passes', async () => {
  const w = world();
  assert.equal((await call(w, 9003, '/founder-growth')).status, 402, 'the Investor-primary bypass no longer opens Founder gates');
  assert.equal((await call(w, 9003, '/founder-studio')).status, 402);
  assert.equal((await call(w, 9003, '/founder-studio')).body.plan.plan_key, 'founder:studio');
  for (let i = 0; i < 5; i++) w.db.prepare(`INSERT INTO discovery_interviews (project_id, interviewee_name) VALUES (9001, ?)`).run(`Synthetic ${i}`);
  assert.equal((await interviewCapRefusal(w.env, 9003, 9001))?.error, 'tier_required', 'the cap follows the held licence, not the primary role');
  assert.equal((await call(w, 9004, '/founder-growth')).status, 200);
  assert.equal((await call(w, 9004, '/founder-studio')).status, 200);
  assert.equal(await interviewCapRefusal(w.env, 9004, 9001), null);
});

test('Investor: Free is refused a professional gate (402 investor_tier_required); Professional passes; an expired trial reads Free; a seat reads its primary', async () => {
  const w = world();
  const refused = await call(w, 9015, '/investor-professional');
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error, 'investor_tier_required');
  assert.equal(refused.body.plan.plan_key, 'investor:professional');
  assert.equal((await call(w, 9005, '/investor-professional')).status, 200);
  assert.equal((await call(w, 9005, '/investor-institutional')).status, 402);
  assert.equal((await call(w, 9013, '/investor-professional')).status, 402, 'an expired trial reads Free');
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9013), 'investor'), 'free');
  set(w, 9013, 'investor_trial_ends_at', future);
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9013), 'investor'), 'professional', 'a live trial keeps its tier');
  // A seat reads its primary's plan, not the copy made when it was accepted.
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9014), 'investor'), 'professional');
  set(w, 9005, 'investor_tier', 'free');
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9014), 'investor'), 'free');
});

test('Investor granted to a Founder-primary member: refused plus, professional and institutional (and the Fund) without a plan; Institutional passes; Founder plan still unlocks Founder gates', async () => {
  const w = world();
  for (const t of ['plus', 'professional', 'institutional']) {
    const out = await call(w, 9006, `/investor-${t}`);
    assert.equal(out.status, 402, t);
    assert.equal(out.body.error, 'investor_tier_required', t);
  }
  assert.equal(userMeetsInvestorTier(await withLicences(w, 9006), 'professional'), false, 'the Fund route asks the same gate');
  for (const t of ['plus', 'professional', 'institutional']) assert.equal((await call(w, 9007, `/investor-${t}`)).status, 200, t);
  assert.equal((await call(w, 9007, '/founder-growth')).status, 200, 'their own Founder plan unlocks Founder gates');
  assert.equal((await call(w, 9007, '/founder-studio')).status, 402);
});

test('Investor granted to an Advisor- or Partner-primary member: refused Investor paid gates, and the licence keeps its own rights', async () => {
  const w = world();
  for (const id of [9008, 9009]) {
    for (const t of ['plus', 'professional', 'institutional']) assert.equal((await call(w, id, `/investor-${t}`)).status, 402, `${id} ${t}`);
    assert.equal(await licenceMeetsTier(w.env, await withLicences(w, id), 'investor', 'plus'), false);
  }
  // Advisor- and Partner-primary members who hold no Investor still pass Founder gates, as before.
  assert.equal((await call(w, 9008, '/founder-studio')).status, 200);
  assert.equal((await call(w, 9009, '/founder-studio')).status, 200);
});

test('Advisor and Partner: licencePlanTier reads account_subscriptions for the matching plan_group; a held licence with no row reads free; not held reads null', async () => {
  const w = world();
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9011), 'advisor'), 'pro');
  assert.equal(await licenceMeetsTier(w.env, await withLicences(w, 9011), 'advisor', 'pro'), true);
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9010), 'partner'), 'free', 'held, no row');
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9016), 'advisor'), 'free', 'granted, no plan of its own');
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9016), 'partner'), 'free');
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9011), 'partner'), null, 'not held');
  assert.equal(await licenceMeetsTier(w.env, await withLicences(w, 9011), 'partner', 'pro'), false);
  // The row names the advisor family: it never reads as a Partner plan.
  w.db.prepare(`INSERT INTO account_subscriptions (user_id, plan_group, plan, status, period_end) VALUES (9016, 'advisor', 'advisor_pro', 'cancelled', ?)`).run(future);
  assert.equal(await licencePlanTier(w.env, await withLicences(w, 9016), 'advisor'), 'free', 'a cancelled plan is not on');
});

test('unchanged: one licence, Partner or Advisor only, Admin, and a grant never writes a plan row', async () => {
  const w = world();
  assert.equal((await call(w, 9010, '/founder-studio')).status, 200, 'Partner only still passes Founder gates');
  assert.equal((await call(w, 9011, '/founder-studio')).status, 200, 'Advisor only still passes Founder gates');
  assert.equal((await call(w, 9010, '/investor-institutional')).status, 200);
  assert.equal((await call(w, 9012, '/founder-studio')).status, 200, 'Admin passes everything');
  assert.equal((await call(w, 9012, '/investor-institutional')).status, 200);
  assert.equal((await call(w, 9002, '/founder-growth')).status, 200, 'a Founder-only member sees no change');
  assert.equal((await call(w, 9005, '/investor-professional')).status, 200, 'an Investor-only member sees no change');
  assert.equal(userMeetsTier(row(w, 9001), 'free'), true);
  // Primary-only objects (no hydrated licences) read their role as the held licence.
  assert.equal(userMeetsTier({ id: 1, role: 'founder', subscription_tier: 'growth', subscription_status: 'active' } as any, 'growth'), true);
  assert.equal(ownLicenceMeets({ id: 1, role: 'investor', licences: ['investor'], investor_tier: 'plus', investor_subscription_status: 'active' } as any, 'investor', 'professional'), false);
  const plans = w.db.prepare('SELECT COUNT(*) AS n FROM account_subscriptions').get() as any;
  assert.equal(plans.n, 1, 'only the seeded row: reading and granting create none');
  for (const id of [9003, 9006, 9008, 9009]) assert.equal(row(w, id).subscription_tier === 'free' || id === 9004, true);
});

test('market intelligence full lens follows each held licence\'s plan', async () => {
  const w = world();
  assert.equal(callerHasFullLens(await withLicences(w, 9003)), false, 'an Investor-primary with a Founder grant and no plan');
  assert.equal(callerHasFullLens(await withLicences(w, 9004)), true, 'with a stored Founder plan');
  assert.equal(callerHasFullLens(await withLicences(w, 9005)), true);
  assert.equal(callerHasFullLens(await withLicences(w, 9015)), false);
  assert.equal(callerHasFullLens(await withLicences(w, 9006)), false);
  assert.equal(callerHasFullLens(await withLicences(w, 9007)), true);
  assert.equal(callerHasFullLens(await withLicences(w, 9010)), true, 'Partner bypass is unchanged');
});

test('GET /api/account/licences returns plan for each held licence; :free for a granted licence with no plan', async () => {
  const w = world();
  const mixed = await call(w, 9003, '/api/account/licences');
  assert.equal(mixed.status, 200, mixed.text);
  const byLicence = Object.fromEntries(mixed.body.held.map((h: any) => [h.licence, h.plan]));
  assert.deepEqual(byLicence.investor, { key: 'investor:free', name: 'Investor Basic' }, 'the primary on Free');
  assert.deepEqual(byLicence.founder, { key: 'founder:free', name: 'Free' }, 'granted, no plan of its own');
  const paid = await call(w, 9007, '/api/account/licences');
  const paidBy = Object.fromEntries(paid.body.held.map((h: any) => [h.licence, h.plan]));
  assert.deepEqual(paidBy.investor, { key: 'investor:institutional', name: 'Institutional' });
  assert.deepEqual(paidBy.founder, { key: 'founder:growth', name: 'Validate + Build' });
  const advisor = await call(w, 9011, '/api/account/licences');
  assert.deepEqual(advisor.body.held[0].plan, { key: 'advisor:pro', name: 'Advisor Pro' });
  const partner = await call(w, 9016, '/api/account/licences');
  const pBy = Object.fromEntries(partner.body.held.map((h: any) => [h.licence, h.plan]));
  assert.deepEqual(pBy.partner, { key: 'partner:free', name: 'Partner Basic' });
  assert.deepEqual(pBy.advisor, { key: 'advisor:free', name: 'Advisor Basic' });
});

test('no refusal body carries exception text', async () => {
  const w = world();
  for (const [who, path] of [[9001, '/founder-growth'], [9003, '/founder-studio'], [9006, '/investor-plus'], [9015, '/investor-professional']] as const) {
    const out = await call(w, who, path);
    assert.equal(out.status, 402, path);
    assert.deepEqual(Object.keys(out.body).sort(), ['checkout_path', 'error', 'message', 'plan', 'required'], 'the existing fixed shape');
    assert.doesNotMatch(out.text, /Error:|at \w+ \(|stack|SQLITE/i);
  }
});
