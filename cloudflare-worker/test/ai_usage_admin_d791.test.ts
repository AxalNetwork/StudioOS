// D791 (#2216) part 1 — HQ › AI usage: the platform's AI use, the flags, Pause
// AI, a member's own cap, the member search and one member's detail. Real
// SQLite with migrations 419, 430, 486, 493, 505, 508 and 510
// (`_ai_budget_fixture.mjs`); Workers AI is a stub, and each case says what it
// pins. A member is `{ id, name, email }` here: the owner's ruling of
// 2026-10-20 (S1 on #2227).
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_usage_admin_d791.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import route from '../src/routes/admin_ai_usage.ts';
import { AI_USAGE_FLAGS, SEARCH_MAX, aiUsageFlags, emailPrefixPattern, platformAiUsage, rangeBounds } from '../src/services/aiUsageAdmin.ts';
import { AI_PAUSED_MESSAGE, reserveAiBudget, resolveAiCaps } from '../src/services/aiBudget.ts';
import { run, __resetForTest, budgetRefusalMessage } from '../src/services/aiRouter.ts';
import { refuseRun } from '../src/util/railContext.ts';

const M508 = readFileSync(new URL('../sql/migrations/508_member_ai_spend_limits.sql', import.meta.url), 'utf8');
const M510 = readFileSync(new URL('../sql/migrations/510_member_ai_pauses.sql', import.meta.url), 'utf8');
const SUPER = 1, MEMBER = 2, INVESTOR = 3, ADMIN = 101;
const SECRET = 'd791-fixture-only-secret';
const L70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const L8 = '@cf/meta/llama-3.1-8b-instruct-fp8';
const NOW = new Date('2026-10-20T12:00:00Z');
const at = (msBefore: number) => new Date(NOW.getTime() - msBefore).toISOString().slice(0, 19).replace('T', ' ');
const H = 3_600_000, D = 24 * H;

function world() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(M508);
  f.db.exec(M510);
  f.db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT; ALTER TABLE users ADD COLUMN created_at TEXT;
    ALTER TABLE activity_logs ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-10-20 11:00:00';
    UPDATE users SET created_at = '2026-01-01 00:00:00';
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT, assurance_level TEXT,
      revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now')));`);
  f.db.prepare('INSERT INTO users(id,email,name,role,created_at) VALUES(?,?,?,?,?)').run(ADMIN, 'admin@example.test', 'Admin', 'admin', '2026-01-01 00:00:00');
  f.db.prepare("UPDATE users SET display_name = 'Mia Member' WHERE id = ?").run(MEMBER);
  // A fresh TOTP session for each reader who should pass the step-up, and an old one for user 4.
  for (const id of [SUPER, ADMIN, MEMBER]) f.db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level) VALUES(?,?,'totp','totp')").run(id, `j${id}`);
  f.db.prepare("UPDATE users SET is_super_admin = 1 WHERE id = 4").run();
  f.db.exec('INSERT INTO super_admins VALUES(4)');
  f.db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level,created_at) VALUES(4,'j4','totp','totp','2020-01-01 00:00:00')").run();
  const env = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const log = (o: { user?: number | null; model?: string; at?: string; cost?: number; charged?: number | null; refusal?: string | null; guardFor?: number | null }) =>
    Number(f.db.prepare(`INSERT INTO ai_usage_logs(user_id,task,model,created_at,est_cost_usd,charged_microusd,refusal,guard_for) VALUES(?,?,?,?,?,?,?,?)`)
      .run(o.user === undefined ? MEMBER : o.user, 'paraphrase', o.model ?? L70, o.at ?? at(H), o.cost ?? 0,
        o.charged === undefined ? 0 : o.charged, o.refusal ?? null, o.guardFor ?? null).lastInsertRowid);
  return { f, env, log };
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/admin/ai-usage', route);
  return a;
}
async function call(w: any, user: number | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user !== null) {
    const jwt = await new SignJWT({ user_id: user, jti: `j${user}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    headers.Authorization = `Bearer ${jwt}`;
  }
  const r = await app().request(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const REASON = 'Spending far past the plan in one afternoon.';
const MIA = { id: MEMBER, name: 'Mia Member', email: 'member@example.test' };
const INV = { id: INVESTOR, name: 'Investor', email: 'investor@example.test' };
const OWNER = { id: SUPER, name: 'Owner', email: 'owner@example.test' };
const logs = (db: any, action: string) => db.prepare('SELECT * FROM activity_logs WHERE action = ? ORDER BY id').all(action);

// 1 ───────────────────────────────────────────────────────────────────────────
test('the totals: runs, cost, charged and margin by day, model, role and plan, guard rows not runs, NULL charges never zero', async () => {
  // Mutations checked: a guard row counted as a run; a NULL charge counted as zero cost in the margin;
  // a row outside the range summed; the system row given a member's role.
  const w = world();
  try {
    const run1 = w.log({ cost: 0.002, charged: 2500, at: at(H) });
    w.log({ model: '@cf/meta/llama-guard-3-8b', cost: 0.0001, charged: 125, guardFor: run1, at: at(H) });
    w.log({ user: INVESTOR, model: L8, cost: 0.001, charged: 1250, at: at(2 * D) });
    w.log({ cost: 0.004, charged: null, at: at(2 * D) });                  // held for review: not recorded
    w.log({ refusal: 'budget_user_month', at: at(2 * D) });                 // refused: no run, no money
    w.log({ user: null, model: L8, cost: 0.003, charged: 0, at: at(H) });   // a system run
    w.log({ cost: 9, charged: 9_000_000, at: at(40 * D) });                 // outside 30d
    const u = await platformAiUsage(w.env, '30d', NOW);
    assert.deepEqual(u.totals, { runs: 4, refused: 1, cost_microusd: 10_100, charged_microusd: 3_875, margin_microusd: 3_875 - 6_100, not_recorded: 1 });
    assert.deepEqual(u.by_day.map((d: any) => [d.day, d.runs, d.charged_microusd]), [['2026-10-18', 2, 1250], ['2026-10-20', 2, 2625]]);
    assert.deepEqual(u.by_model.map((m: any) => [m.model, m.runs, m.charged_microusd]),
      [[L70, 2, 2500], [L8, 2, 1250], ['@cf/meta/llama-guard-3-8b', 0, 125]]);
    assert.deepEqual(u.by_role.map((r: any) => [r.role, r.runs, r.charged_microusd]), [['founder', 2, 2625], ['investor', 1, 1250], ['system', 1, 0]]);
    assert.deepEqual(u.by_plan.map((p: any) => [p.plan, p.charged_microusd]), [['founder:free', 2625], ['investor:free', 1250], ['system', 0]]);
    assert.deepEqual(u.top_charged, [
      { member: MIA, runs: 2, refused: 1, cost_microusd: 6_100, charged_microusd: 2_625, margin_microusd: 2_625 - 2_100, not_recorded: 1, topups_microusd: 0 },
      { member: INV, runs: 1, refused: 0, cost_microusd: 1_000, charged_microusd: 1_250, margin_microusd: 250, not_recorded: 0, topups_microusd: 0 },
    ]);
    // The ranges.
    assert.deepEqual(rangeBounds('7d', NOW), { from: '2026-10-14 00:00:00', to: '2026-10-21 00:00:00' });
    assert.deepEqual(rangeBounds('mtd', NOW), { from: '2026-10-01 00:00:00', to: '2026-10-21 00:00:00' });
    assert.equal(rangeBounds('1y', NOW), null);
  } finally { w.f.db.close(); }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('top 20 by velocity: today over the 7-day daily average, the average counted as at least $1', async () => {
  // Mutations checked: the ratio inverted; the floor dropped (thirty first-day dimes outrank a 10× member); more than 20 returned.
  const w = world();
  try {
    w.log({ user: 5, charged: 7_000_000, at: at(3 * D) }); w.log({ user: 5, charged: 3_000_000, at: at(H) });    // $1 a day → $3: 3×
    w.log({ user: 6, charged: 14_000_000, at: at(3 * D) }); w.log({ user: 6, charged: 20_000_000, at: at(H) });  // $2 a day → $20: 10×
    w.log({ user: 7, charged: 4_000_000, at: at(H) });                                                         // first day, $4 over the $1 floor: 4×
    w.log({ user: 8, charged: 9_000_000, at: at(3 * D) });                                                     // nothing today: not listed
    for (let id = 10; id < 40; id += 1) w.log({ user: id, charged: 100_000, at: at(H) });                     // thirty first-day dimes
    const v = (await platformAiUsage(w.env, '7d', NOW)).top_velocity;
    assert.equal(v.length, 20);
    assert.deepEqual(v.slice(0, 3).map((x: any) => [x.member.id, x.ratio, x.today_microusd, x.daily_average_microusd]),
      [[6, 10, 20_000_000, 2_000_000], [7, 4, 4_000_000, 0], [5, 3, 3_000_000, 1_000_000]]);
    assert.ok(!v.some((x: any) => x.member.id === 8));
    assert.equal(v[3].ratio, 0.1);
  } finally { w.f.db.close(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('each flag at its threshold, and one below it, says why and since when', async () => {
  // Mutations checked, each alone: every threshold off by one; the spike's minimum dropped; the refusals'
  // window widened; the refund's percent compared with >=; new_heavy's account age or window ignored.
  const w = world();
  const { f, log } = w;
  try {
    // spike: 7-day average $1; today $5.000001 is > 5×, $5 is not. With no history, $5 is, $4.999999 is not.
    log({ user: 10, charged: 7_000_000, at: at(2 * D) }); log({ user: 10, charged: 5_000_001, at: at(H) });
    log({ user: 11, charged: 7_000_000, at: at(2 * D) }); log({ user: 11, charged: 5_000_000, at: at(H) });
    log({ user: 12, charged: 5_000_000, at: at(H) });
    log({ user: 13, charged: 4_999_999, at: at(H) });
    // refusals: 20 in 24 hours; 19; and 20 with one just outside the window.
    for (let i = 0; i < 20; i += 1) log({ user: 20, refusal: 'budget_user_month', at: at(H + i) });
    for (let i = 0; i < 19; i += 1) log({ user: 21, refusal: 'budget_user_month', at: at(H) });
    for (let i = 0; i < 19; i += 1) log({ user: 22, refusal: 'budget_user_month', at: at(H) });
    log({ user: 22, refusal: 'budget_user_month', at: at(D + 60_000) });
    // held: 3 runs in review; 2.
    const hold = (user: number, n: number) => f.db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,recorded_cost_microusd,expires_at)
      VALUES(?,?,?,?,1000,0,'review',2000,'2026-10-20 00:00:00')`).run(`r${user}-${n}`, user, '2026-10-19', '2026-10');
    for (let i = 0; i < 3; i += 1) hold(30, i);
    for (let i = 0; i < 2; i += 1) hold(31, i);
    // refund_after_spend: 81% of the refunded share already spent; 80% is not more than 80%.
    const reverse = (user: number, kind: string, delta: number, shortfall: number) => f.db.prepare(`INSERT INTO ai_credit_ledger(user_id,kind,delta_microusd,source_ref,shortfall_microusd,actor,created_at)
      VALUES(?,?,?,?,?,'payment_webhook',?)`).run(user, kind, delta, `rf:${user}:${kind}`, shortfall, at(3 * D));
    reverse(40, 'refund', -19, 81);
    reverse(41, 'dispute', -20, 80);
    // new_heavy: 3 days old, topped up, charged $20.000001 within 24 hours of it; $20; and an 8-day-old account.
    const fresh = (user: number, ageDays: number, charged: number) => {
      f.db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(at(ageDays * D), user);
      f.db.prepare(`INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,credited_at)
        VALUES(?,?,?,'price_fixture',25000000,2500,'usd',?)`).run(`pi_${user}`, `o${user}`, user, at(2 * D));
      log({ user, charged, at: at(2 * D - H) });
    };
    fresh(50, 3, 20_000_001);
    fresh(51, 3, 20_000_000);
    fresh(52, 8, 30_000_000);
    // …and $30 charged more than 24 hours after the top-up.
    f.db.prepare('UPDATE users SET created_at = ? WHERE id = 53').run(at(3 * D));
    f.db.prepare(`INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,credited_at)
      VALUES('pi_53','o53',53,'price_fixture',25000000,2500,'usd',?)`).run(at(2 * D + 13 * H));
    log({ user: 53, charged: 30_000_000, at: at(D + 2 * H) });  // yesterday, 35 hours after the top-up

    const flags = await aiUsageFlags(w.env, NOW);
    const raised = flags.map((x: any) => `${x.flag}:${x.member.id}`).sort();
    assert.deepEqual(raised, ['held:30', 'new_heavy:50', 'refund_after_spend:40', 'refusals:20', 'spike:10', 'spike:12'].sort());
    const by = (flag: string) => flags.find((x: any) => x.flag === flag)!;
    assert.equal(by('spike').why, 'Charged $5.00 today, 5.0× the 7-day daily average of $1.00.');
    assert.equal(by('spike').since, '2026-10-20 00:00:00');
    assert.equal(flags.find((x: any) => x.flag === 'spike' && x.member.id === 12)!.why, 'Charged $5.00 today, with nothing charged in the 7 days before.');
    assert.equal(by('refusals').why, '20 refused runs in the last 24 hours.');
    assert.equal(by('refusals').since, at(H + 19));
    assert.equal(by('held').why, '3 runs held for review.');
    assert.equal(by('refund_after_spend').why, 'A refund or dispute of a token pack after 81% of it was spent.');
    assert.equal(by('refund_after_spend').since, at(3 * D));
    assert.equal(by('new_heavy').why, 'Account 3 days old; charged $20.00 within 24 hours of its first top-up.');
    assert.equal(by('new_heavy').since, at(2 * D));
    // The thresholds are one block, returned with the read.
    assert.deepEqual(AI_USAGE_FLAGS, {
      spikeMultiple: 5, spikeMinMicrousd: 5_000_000, spikeAverageDays: 7, refusalsMin: 20, refusalsHours: 24, heldMin: 3,
      refundSpentPercent: 80, refundWindowDays: 30, newAccountDays: 7, newHeavyMicrousd: 20_000_000, newHeavyHours: 24,
    });
  } finally { w.f.db.close(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('Pause AI: the hold refuses ai_paused (403) and charges nothing; the member is told once; each action is audited; unpausing restores runs', async () => {
  // Mutations checked: the hold's pause check dropped; the notice sent on every
  // press; the audit line written when nothing changed; the unpause leaving the row.
  const w = world();
  const calls: string[] = [];
  const ai = withGuard({ run: async (model: string) => { calls.push(model); return { response: 'answer', usage: { prompt_tokens: 10, completion_tokens: 5 } }; } });
  const env = { ...w.env, AI: ai };
  w.f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,5000000)').run(MEMBER);
  try {
    const p = await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'POST', body: { reason: REASON } });
    assert.equal(p.status, 200);
    assert.deepEqual(p.body, { ok: true, member_id: MEMBER, paused: true });
    const again = await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'POST', body: { reason: REASON } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_paused');
    const paused = logs(w.f.db, 'ai_member_paused');
    assert.equal(paused.length, 1, 'a second press was audited as a pause');
    assert.deepEqual(JSON.parse(paused[0].details), { member_id: MEMBER, actor_id: SUPER, reason: REASON });
    assert.equal(paused[0].actor, String(SUPER));
    const notes = w.f.db.prepare("SELECT * FROM notifications_inbox WHERE user_id = ? AND type = 'ai_paused'").all(MEMBER);
    assert.equal(notes.length, 1, 'the member was not told exactly once');
    assert.equal(notes[0].body, AI_PAUSED_MESSAGE);
    assert.equal(AI_PAUSED_MESSAGE, 'AI is paused on this account. Contact support.');

    // The hold: refused, nothing held, nothing taken from the balance.
    assert.deepEqual(await reserveAiBudget(env, MEMBER, 1000), { ok: false, refusal: 'ai_paused' });
    assert.equal(w.f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0);
    assert.equal(w.f.db.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').get(MEMBER).balance_microusd, 5_000_000);
    // A run: refused before any model, the guard included; its row records the refusal and no charge.
    const r = await run(env, { task: 'advisor_turn', userId: MEMBER, text: 'hello' });
    assert.equal(r.ok, false);
    assert.equal(r.refusal, 'ai_paused');
    assert.equal(r.error, AI_PAUSED_MESSAGE);
    assert.deepEqual(calls, []);
    const row = w.f.db.prepare('SELECT refusal, charged_microusd, est_cost_usd FROM ai_usage_logs ORDER BY id DESC LIMIT 1').get();
    assert.deepEqual({ ...row }, { refusal: 'ai_paused', charged_microusd: 0, est_cost_usd: 0 });
    assert.equal(budgetRefusalMessage('ai_paused'), AI_PAUSED_MESSAGE);
    // A member's press answers 403 in the pause's words.
    const h = new Hono();
    h.get('/x', (c) => refuseRun(c, { refusal: 'ai_paused' })!);
    const res = await h.request('/x');
    assert.equal(res.status, 403);
    assert.equal((await res.json() as any).error, 'ai_paused');
    // Another member is untouched.
    assert.equal((await run(env, { task: 'advisor_turn', userId: INVESTOR, text: 'hello' })).refusal === 'ai_paused', false);

    // Unpause: audited with both reasons, and runs again.
    const u = await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'DELETE', body: { reason: 'Spoke to the member; usage explained.' } });
    assert.equal(u.status, 200);
    const unpaused = logs(w.f.db, 'ai_member_unpaused');
    assert.equal(unpaused.length, 1);
    const { paused_at, ...rest } = JSON.parse(unpaused[0].details);
    assert.deepEqual(rest, { member_id: MEMBER, actor_id: SUPER, reason: 'Spoke to the member; usage explained.', paused_reason: REASON, paused_by: SUPER });
    assert.match(paused_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(w.f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_pauses').get().n, 0);
    const back = await run(env, { task: 'advisor_turn', userId: MEMBER, text: 'hello' });
    assert.equal(back.ok, true, 'unpausing did not restore runs');
    const twice = await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'DELETE', body: { reason: 'Spoke to the member; usage explained.' } });
    assert.equal(twice.status, 404);
    assert.equal(logs(w.f.db, 'ai_member_unpaused').length, 1, 'an unpause of nothing was audited');
    // The read lists who is paused, by id and name.
    await call(w, SUPER, `/api/admin/ai-usage/members/${INVESTOR}/pause`, { method: 'POST', body: { reason: REASON } });
    const read = await call(w, SUPER, '/api/admin/ai-usage?range=7d');
    assert.deepEqual(read.body.paused.map((x: any) => [x.member, x.reason, x.paused_by]),
      [[INV, REASON, OWNER]]);
  } finally { w.f.db.close(); }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('a member\'s cap: the lower of it and the licence\'s wins, a higher one changes nothing, null clears it; each is audited', async () => {
  // Mutations checked: the member's cap always winning; the licence's always winning; the clear leaving the row; no audit.
  const w = world();
  try {
    assert.equal((await resolveAiCaps(w.env, MEMBER)).monthly_microusd, 50_000_000, 'the fixture plan\'s allowance');
    const set = async (usd: number | null) => call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/cap`, { method: 'PUT', body: { monthly_usd: usd, reason: REASON } });
    assert.equal((await set(10)).status, 200);
    let caps = await resolveAiCaps(w.env, MEMBER);
    assert.equal(caps.monthly_microusd, 10_000_000);
    assert.equal(caps.daily_microusd, 10_000_000, 'a member has no day cap: the day reads the month');
    assert.equal((caps as any).member_cap_microusd, 10_000_000);
    assert.equal((await set(100)).status, 200);
    caps = await resolveAiCaps(w.env, MEMBER);
    assert.equal(caps.monthly_microusd, 50_000_000, 'a cap above the licence\'s raised it');
    assert.equal((await set(null)).status, 200);
    caps = await resolveAiCaps(w.env, MEMBER);
    assert.equal(caps.monthly_microusd, 50_000_000);
    assert.equal('member_cap_microusd' in caps, false);
    assert.deepEqual(logs(w.f.db, 'ai_member_cap_set').map((l: any) => [JSON.parse(l.details).before_microusd, JSON.parse(l.details).after_microusd]),
      [[null, 10_000_000], [10_000_000, 100_000_000]]);
    const cleared = logs(w.f.db, 'ai_member_cap_cleared');
    assert.equal(cleared.length, 1);
    assert.deepEqual(JSON.parse(cleared[0].details), { member_id: MEMBER, actor_id: SUPER, reason: REASON, before_microusd: 100_000_000, after_microusd: null });
    // The admin licence's typed cap narrows the same way.
    w.f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('admin',5000000,50000000,1)").run();
    await call(w, SUPER, `/api/admin/ai-usage/members/${ADMIN}/cap`, { method: 'PUT', body: { monthly_usd: 12.5, reason: REASON } });
    assert.equal((await resolveAiCaps(w.env, ADMIN)).monthly_microusd, 12_500_000);
    // And a cap the hold reads: a $1 cap refuses a $2 quote.
    await set(1);
    assert.deepEqual(await reserveAiBudget(w.env, MEMBER, 2_000_000), { ok: false, refusal: 'budget_user_month' });
    // Bounds and the reason.
    for (const body of [{ monthly_usd: -1, reason: REASON }, { monthly_usd: 100_001, reason: REASON }, { monthly_usd: '5', reason: REASON }]) {
      assert.equal((await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/cap`, { method: 'PUT', body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/cap`, { method: 'PUT', body: { monthly_usd: 5, reason: 'short' } })).status, 400);
  } finally { w.f.db.close(); }
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('a non-Super Admin gets 403 on every route; a Super Admin without a recent step-up too; nothing changes', async () => {
  // Mutations checked: the step-up dropped from the gate; requireSuperAdmin swapped for requireAdmin;
  // the gate dropped from the search, and from the member detail.
  const w = world();
  try {
    const routes: [string, string, unknown][] = [
      ['GET', '/api/admin/ai-usage?range=30d', undefined],
      ['GET', '/api/admin/ai-usage/members?q=member&range=30d', undefined],
      ['GET', `/api/admin/ai-usage/members?q=${MEMBER}`, undefined],
      ['GET', `/api/admin/ai-usage/members/${MEMBER}?range=7d`, undefined],
      ['POST', `/api/admin/ai-usage/members/${MEMBER}/pause`, { reason: REASON }],
      ['DELETE', `/api/admin/ai-usage/members/${MEMBER}/pause`, { reason: REASON }],
      ['PUT', `/api/admin/ai-usage/members/${MEMBER}/cap`, { monthly_usd: 1, reason: REASON }],
    ];
    for (const [method, path, body] of routes) {
      for (const user of [ADMIN, MEMBER]) {
        const r = await call(w, user, path, { method, body });
        assert.equal(r.status, 403, `${method} ${path} as ${user}`);
      }
      const stale = await call(w, 4, path, { method, body });
      assert.equal(stale.status, 403, `${method} ${path} without a recent step-up`);
      assert.equal(stale.body.detail, 'step_up_required');
      assert.equal((await call(w, null, path, { method, body })).status, 401);
    }
    assert.equal(w.f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_pauses').get().n, 0);
    assert.equal(w.f.db.prepare('SELECT COUNT(*) AS n FROM member_ai_caps').get().n, 0);
    assert.equal(w.f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'ai_member_%'").get().n, 0);
  } finally { w.f.db.close(); }
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('every member object names id, name and email; no prompt or output in any answer; bad input is refused', async (t) => {
  // Mutations checked: u.email dropped from a member; a velocity, flag or caps member built without the email.
  // The route reads the clock and this test's runs are dated from NOW, so the
  // clock is NOW: on the real one, "today" stopped holding them on 2026-10-21.
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = world();
  try {
    w.log({ charged: 6_000_000, at: at(H) });
    w.log({ user: INVESTOR, refusal: 'guard_blocked', at: at(H) });
    await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'POST', body: { reason: REASON } });
    await call(w, SUPER, `/api/admin/ai-usage/members/${INVESTOR}/cap`, { method: 'PUT', body: { monthly_usd: 3, reason: REASON } });
    const r = await call(w, SUPER, '/api/admin/ai-usage?range=mtd');
    assert.equal(r.status, 200);
    const b = r.body;
    assert.deepEqual(b.top_charged.map((t: any) => t.member), [MIA, INV]);
    assert.deepEqual(b.top_velocity.map((t: any) => t.member), [MIA]);
    assert.deepEqual(b.flags.find((x: any) => x.flag === 'spike').member, MIA);
    assert.deepEqual(b.paused.map((x: any) => [x.member, x.paused_by]), [[MIA, OWNER]]);
    assert.deepEqual(b.caps.map((x: any) => [x.member, x.set_by]), [[INV, OWNER]]);
    assert.doesNotMatch(JSON.stringify(b), /"prompt"|"output"|"messages"|"response"/);
    // The audit lines keep the user id, never the email.
    assert.doesNotMatch(JSON.stringify(w.f.db.prepare("SELECT * FROM activity_logs WHERE action LIKE 'ai_member_%'").all()), /@example\.test/);
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage?range=1y')).status, 400);
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage/members/999999/pause', { method: 'POST', body: { reason: REASON } })).status, 404);
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage/members/abc/pause', { method: 'POST', body: { reason: REASON } })).status, 404);
    assert.equal((await call(w, SUPER, `/api/admin/ai-usage/members/${INVESTOR}/pause`, { method: 'POST', body: {} })).status, 400);
  } finally { w.f.db.close(); }
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('the member search: an exact id, or a case-insensitive email prefix, at most 50 rows, with the top members\' sums', async () => {
  // Mutations checked: the id matched as a prefix; the email compared case-sensitively; `_` or `%` in the query
  // left as wildcards; the 50 cap dropped; the topups summed outside the range; an empty query searched.
  const w = world();
  try {
    w.log({ cost: 0.002, charged: 2500, at: at(H) });
    w.log({ user: 20, cost: 0.001, charged: 900, at: at(H) });
    w.log({ user: 20, cost: 0.001, charged: 700_000, at: at(40 * D) });  // outside 30d
    const topup = (user: number, n: number, credit: number, when: string) => w.f.db.prepare(`INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,credited_at)
      VALUES(?,?,?,'price_fixture',?,500,'usd',?)`).run(`pi_s${user}_${n}`, `os${user}_${n}`, user, credit, when);
    topup(MEMBER, 1, 5_000_000, at(2 * D));
    topup(MEMBER, 2, 9_000_000, at(40 * D));                               // outside 30d
    const top = (await platformAiUsage(w.env, '30d', new Date())).top_charged.find((t: any) => t.member.id === MEMBER);

    // By id: that member alone, never member 20 for "2".
    const byId = await call(w, SUPER, `/api/admin/ai-usage/members?q=${MEMBER}&range=30d`);
    assert.equal(byId.status, 200);
    assert.deepEqual(byId.body.members, [top]);
    assert.equal(byId.body.members[0].topups_microusd, 5_000_000);
    // A member with no runs reads zeros, not nothing.
    assert.deepEqual((await call(w, SUPER, '/api/admin/ai-usage/members?q=77')).body.members,
      [{ member: { id: 77, name: 'Member 77', email: 'member77@example.test' }, runs: 0, refused: 0, cost_microusd: 0, charged_microusd: 0,
        margin_microusd: 0, not_recorded: 0, topups_microusd: 0 }]);
    assert.deepEqual((await call(w, SUPER, '/api/admin/ai-usage/members?q=999999')).body.members, []);

    // By email prefix, any case.
    const byEmail = await call(w, SUPER, '/api/admin/ai-usage/members?q=MEMBER2&range=30d');
    assert.deepEqual(byEmail.body.members.map((m: any) => m.member.email),
      ['member20@example.test', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `member2${n}@example.test`)]);
    assert.equal(byEmail.body.members[0].charged_microusd, 900);
    assert.deepEqual((await call(w, SUPER, '/api/admin/ai-usage/members?q=Member@Example.TEST')).body.members.map((m: any) => m.member), [MIA]);
    // A stored email in mixed case is found by its lower-case prefix.
    w.f.db.prepare("UPDATE users SET email = 'Casey.Q@Example.TEST' WHERE id = 60").run();
    assert.deepEqual((await call(w, SUPER, '/api/admin/ai-usage/members?q=casey.q@')).body.members.map((m: any) => m.member.id), [60]);
    // `_` and `%` are themselves, not wildcards.
    assert.deepEqual((await call(w, SUPER, '/api/admin/ai-usage/members?q=member_')).body.members, []);
    assert.deepEqual((await call(w, SUPER, '/api/admin/ai-usage/members?q=%25')).body.members, []);
    assert.equal(emailPrefixPattern(' A_b%c\\ '), 'a\\_b\\%c\\\\%');
    // At most 50: "member" matches 98 accounts.
    const many = await call(w, SUPER, '/api/admin/ai-usage/members?q=member');
    assert.equal(SEARCH_MAX, 50);
    assert.equal(many.body.members.length, 50);
    const emails = many.body.members.map((m: any) => m.member.email);
    assert.deepEqual(emails, [...emails].sort());
    // Bad input.
    for (const q of ['', '%20%20', 'x'.repeat(255)]) {
      assert.equal((await call(w, SUPER, `/api/admin/ai-usage/members?q=${q}`)).status, 400, `q=${q.slice(0, 10)}`);
    }
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage/members?range=30d')).status, 400);
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage/members?q=member&range=1y')).status, 400);
  } finally { w.f.db.close(); }
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('one member: by model and by day, the same totals as their top-members row, balance, allowance, spend limit, pause and cap with history', async () => {
  // Mutations checked: the detail summing outside the range, or another member's rows; the history missing an action
  // or another member's line; the balance read as zero when unreadable; the cap or pause left out.
  const w = world();
  try {
    w.log({ cost: 0.002, charged: 2500, at: at(H) });
    w.log({ model: L8, cost: 0.001, charged: 1000, at: at(2 * D) });
    w.log({ model: L8, cost: 0.004, charged: null, at: at(2 * D) });
    w.log({ refusal: 'budget_user_month', at: at(2 * D) });
    w.log({ cost: 9, charged: 9_000_000, at: at(10 * D) });                 // outside 7d
    w.log({ user: INVESTOR, cost: 1, charged: 1_000_000, at: at(H) });      // another member
    w.f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,4200000)').run(MEMBER);
    w.f.db.prepare('INSERT INTO member_ai_spend_limits(user_id,monthly_limit_microusd) VALUES(?,30000000)').run(MEMBER);
    await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/cap`, { method: 'PUT', body: { monthly_usd: 10, reason: REASON } });
    await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'POST', body: { reason: REASON } });
    await call(w, SUPER, `/api/admin/ai-usage/members/${INVESTOR}/pause`, { method: 'POST', body: { reason: REASON } });

    const r = await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}?range=7d`);
    assert.equal(r.status, 200);
    const d = r.body;
    assert.deepEqual(d.member, MIA);
    const top = (await call(w, SUPER, '/api/admin/ai-usage?range=7d')).body.top_charged.find((t: any) => t.member.id === MEMBER);
    const { member: _m, ...topSums } = top;
    assert.deepEqual(d.totals, topSums, 'the detail\'s totals are not the top-members row');
    assert.deepEqual(d.totals, { runs: 3, refused: 1, cost_microusd: 7_000, charged_microusd: 3_500, margin_microusd: 500, not_recorded: 1, topups_microusd: 0 });
    assert.deepEqual(d.by_model.map((m: any) => [m.model, m.runs, m.cost_microusd, m.charged_microusd, m.not_recorded]),
      [[L70, 1, 2_000, 2_500, 0], [L8, 2, 5_000, 1_000, 1]]);
    assert.deepEqual(d.by_day.map((x: any) => [x.day, x.runs, x.charged_microusd]), [['2026-10-18', 2, 1_000], [at(H).slice(0, 10), 1, 2_500]].sort());
    assert.deepEqual(d.balance, { state: 'ok', balance_microusd: 4_200_000 });
    assert.equal(d.allowance.state, 'ok');
    assert.equal(d.allowance.monthly_microusd, 10_000_000);
    assert.equal(d.allowance.member_cap_microusd, 10_000_000);
    assert.equal(d.spend_limit.state, 'ok');
    assert.equal(d.spend_limit.limit_microusd, 30_000_000);
    assert.deepEqual([d.pause.reason, d.pause.paused_by], [REASON, OWNER]);
    assert.deepEqual([d.cap.monthly_microusd, d.cap.set_by], [10_000_000, OWNER]);
    assert.deepEqual(d.history.map((h: any) => [h.action, h.actor_id, h.details.reason]),
      [['ai_member_paused', SUPER, REASON], ['ai_member_cap_set', SUPER, REASON]]);
    assert.equal(d.history[0].at, '2026-10-20 11:00:00');
    assert.doesNotMatch(JSON.stringify(d), /"prompt"|"output"|"messages"|"response"/);

    // A store that cannot be read says so, never zero.
    w.f.db.exec('DROP TABLE ai_topup_accounts');
    assert.deepEqual((await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}?range=7d`)).body.balance, { state: 'unreadable' });
    // Unpaused, uncapped: null, and the history keeps both.
    await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/pause`, { method: 'DELETE', body: { reason: REASON } });
    await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}/cap`, { method: 'PUT', body: { monthly_usd: null, reason: REASON } });
    const after = (await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}`)).body;
    assert.equal(after.pause, null);
    assert.equal(after.cap, null);
    assert.deepEqual(after.history.map((h: any) => h.action), ['ai_member_cap_cleared', 'ai_member_unpaused', 'ai_member_paused', 'ai_member_cap_set']);
    // Unknown, malformed, a bad range.
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage/members/999999')).status, 404);
    assert.equal((await call(w, SUPER, '/api/admin/ai-usage/members/abc')).status, 404);
    assert.equal((await call(w, SUPER, `/api/admin/ai-usage/members/${MEMBER}?range=1y`)).status, 400);
  } finally { w.f.db.close(); }
});
