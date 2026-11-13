// D776 (#2093) PR 1 — `GET /api/ai-budget/runs`: a member's own runs this
// month, grouped by page, by option within a page, or by record, with what
// they were charged and the allowance and token split. Real SQLite with
// migrations 419, 430, 486 and 493 (`_ai_budget_fixture.mjs`). Each case names
// the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_consumption_d776.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import aiRoute from '../src/routes/ai.ts';
import { MAX_CONSUMPTION_ROWS, MAX_RUN_LINES, monthBounds } from '../src/services/aiConsumption.ts';
import { AI_MARKUP } from '../src/services/ai/pricing.ts';
import { railOptionRows, railRows } from '../src/services/ai/railMatrix.ts';

const ME = 2;
const OTHER = 3;
// PR 2: HQ's readers. 1 is the fixture's Super Admin; ADMIN is a plain HQ administrator, added by `world()`.
const SUPER = 1;
const ADMIN = 101;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error' }, 500);
  });
  a.route('/api/ai-budget', budgetRoute);
  a.route('/api/ai', aiRoute);
  return a;
}

function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd776-fixture-only-secret', ENVIRONMENT: 'development' } as any;
  let n = 0;
  /** A settled hold of `allowance` + `tokens` micro-USD for `user`. */
  const hold = (user: number, allowance: number, tokens: number, status: 'settled' | 'review' | 'pending' = 'settled') => {
    const uid = `res${++n}`;
    const settled = status === 'settled';
    f.db.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,settlement_uid,
        actual_included_microusd,actual_topup_microusd,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid, user, '2026-10-19', '2026-10', allowance + 1000, tokens + 1000, status, settled ? `set${n}` : null,
        settled ? allowance : null, settled ? tokens : null, '2026-10-20 00:00:00');
    return uid;
  };
  /** One log row. */
  const run = (o: { user?: number; page?: string | null; option?: string | null; record?: string | null; charged?: number | null;
    reservation?: string | null; guardFor?: number | null; at?: string }) => {
    const r = f.db.prepare(`INSERT INTO ai_usage_logs(user_id,task,model,created_at,charged_microusd,reservation_uid,rail_page,rail_option,record_ref,guard_for)
        VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(o.user ?? ME, 'paraphrase', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', o.at ?? '2026-10-12 10:00:00',
        o.charged === undefined ? 0 : o.charged, o.reservation ?? null, o.page === undefined ? null : o.page,
        o.option ?? null, o.record ?? null, o.guardFor ?? null);
    return Number(r.lastInsertRowid);
  };
  f.db.prepare('INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)').run(ADMIN, 'admin@example.test', 'Admin', 'admin');
  return { f, env, hold, run };
}

async function call(w: any, path: string, user: number | null) {
  const headers: Record<string, string> = {};
  if (user !== null) {
    const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(w.env.JWT_SECRET));
    headers.Authorization = `Bearer ${jwt}`;
  }
  const r = await app().request(path, { headers }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) };
}

const VR = 'founder.validate.customer-research';

// 1 ───────────────────────────────────────────────────────────────────────────
test('by page: each page\'s runs, charge and split, the member\'s own rows only, largest charge first', async () => {
  // Mutations checked: the user_id filter dropped; the join's user check dropped; ORDER BY reversed.
  const w = world();
  const a = w.run({ page: VR, option: 'fill:pain_tag', charged: 3000, reservation: w.hold(ME, 2000, 1000) });
  w.run({ page: VR, charged: 500, reservation: 'res1', guardFor: a }); // its guard check, in the same hold
  w.run({ page: VR, option: 'draft:research/ask', charged: 4000, reservation: w.hold(ME, 0, 4000) });
  w.run({ page: 'founder.build', charged: 9000, reservation: w.hold(ME, 9000, 0) });
  // Another member, on the same page and month, and holding a reservation uid the member's row could name.
  const theirs = w.hold(OTHER, 7_000_000, 7_000_000);
  w.run({ user: OTHER, page: VR, charged: 14_000_000, reservation: theirs });
  w.run({ page: VR, charged: 0, reservation: theirs }); // a row of mine naming their hold reads no split from it

  const r = await call(w, '/api/ai-budget/runs?group=page&month=2026-10', ME);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows, [
    { page: 'founder.build', runs: 1, charged_microusd: 9000, allowance_microusd: 9000, tokens_microusd: 0, not_recorded: 0 },
    { page: VR, runs: 3, charged_microusd: 7500, allowance_microusd: 2000, tokens_microusd: 5000, not_recorded: 0 },
  ]);
  assert.deepEqual(r.body.totals, { runs: 4, charged_microusd: 16500, allowance_microusd: 11000, tokens_microusd: 5000, not_recorded: 0 });
  assert.equal(r.body.truncated, false);
  assert.ok(!JSON.stringify(r.body).includes('14000000'), 'no other member\'s figure');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the guard\'s rows add their charge but not a run, and the hold\'s split is read once', async () => {
  // Mutation checked: the split summed over guard rows too (the hold counted twice).
  const w = world();
  const res = w.hold(ME, 600, 400);
  const id = w.run({ page: VR, charged: 800, reservation: res });
  w.run({ page: VR, charged: 100, reservation: res, guardFor: id });
  w.run({ page: VR, charged: 100, reservation: res, guardFor: id });
  const r = await call(w, '/api/ai-budget/runs?group=page&month=2026-10', ME);
  assert.deepEqual(r.body.rows, [{ page: VR, runs: 1, charged_microusd: 1000, allowance_microusd: 600, tokens_microusd: 400, not_recorded: 0 }]);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a NULL charge is "Not recorded", never a zero; a hold not yet settled adds no split', async () => {
  // Mutation checked: COALESCE'd charges reported as 0. (A review hold's actual amounts are NULL by 419's CHECK, so it adds no split.)
  const w = world();
  w.run({ page: null, charged: null }); // before migration 493
  w.run({ page: null, charged: null });
  w.run({ page: VR, charged: null, reservation: w.hold(ME, 0, 0, 'review') }); // held for a D640 review
  w.run({ page: VR, charged: 2000, reservation: w.hold(ME, 2000, 0) });
  const r = await call(w, '/api/ai-budget/runs?group=page&month=2026-10', ME);
  const byPage = Object.fromEntries(r.body.rows.map((x: any) => [x.page ?? '(none)', x]));
  assert.deepEqual(byPage['(none)'], { page: null, runs: 2, charged_microusd: null, allowance_microusd: 0, tokens_microusd: 0, not_recorded: 2 });
  assert.deepEqual(byPage[VR], { page: VR, runs: 2, charged_microusd: 2000, allowance_microusd: 2000, tokens_microusd: 0, not_recorded: 1 });
  assert.equal(r.body.totals.not_recorded, 3);
  assert.equal(r.body.totals.charged_microusd, 2000);
  const none = await call(world(), '/api/ai-budget/runs?month=2026-10', ME);
  assert.deepEqual(none.body.rows, []);
  assert.equal(none.body.totals.charged_microusd, null, 'nothing recorded is not a zero');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('by option within a page, and by record', async () => {
  // Mutation checked: option grouped without its page (two pages' "fill" merged).
  const w = world();
  w.run({ page: VR, option: 'fill:pain_tag', charged: 100, record: 'interview:7' });
  w.run({ page: VR, option: 'fill:pain_tag', charged: 200, record: 'interview:8' });
  w.run({ page: 'founder.build', option: 'fill:pain_tag', charged: 50, record: 'interview:7' });
  w.run({ page: VR, option: null, charged: 25 });
  const o = await call(w, '/api/ai-budget/runs?group=option&month=2026-10', ME);
  assert.deepEqual(o.body.rows.map((x: any) => [x.page, x.option, x.runs, x.charged_microusd]),
    [[VR, 'fill:pain_tag', 2, 300], ['founder.build', 'fill:pain_tag', 1, 50], [VR, null, 1, 25]]);
  const rec = await call(w, '/api/ai-budget/runs?group=record&month=2026-10', ME);
  assert.deepEqual(rec.body.rows.map((x: any) => [x.page, x.record, x.charged_microusd]),
    [[VR, 'interview:8', 200], [VR, 'interview:7', 100], ['founder.build', 'interview:7', 50], [VR, null, 25]]);
  assert.ok(!('option' in rec.body.rows[0]) && !('record' in o.body.rows[0]));
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the month is a UTC calendar month; the current month by default', async () => {
  // Mutations checked: the upper bound inclusive; the lower bound dropped.
  const w = world();
  w.run({ page: VR, charged: 1, at: '2026-09-30 23:59:59' });
  w.run({ page: VR, charged: 10, at: '2026-10-01 00:00:00' });
  w.run({ page: VR, charged: 100, at: '2026-10-31 23:59:59' });
  w.run({ page: VR, charged: 1000, at: '2026-11-01 00:00:00' });
  const oct = await call(w, '/api/ai-budget/runs?month=2026-10', ME);
  assert.equal(oct.body.totals.charged_microusd, 110);
  const dec = await call(w, '/api/ai-budget/runs?month=2026-12', ME);
  assert.equal(dec.body.totals.runs, 0);
  assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01 00:00:00', to: '2027-01-01 00:00:00' });
  const now = new Date();
  const current = await call(w, '/api/ai-budget/runs', ME);
  assert.equal(current.body.month, `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
  assert.equal(current.body.group, 'page');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('refusals: signed out 401, a bad group or month 400, an unreadable store 503 with no raw error', async () => {
  // Mutations checked: requireAuth dropped; the month check dropped.
  const w = world();
  assert.equal((await call(w, '/api/ai-budget/runs', null)).status, 401);
  for (const q of ['group=model', 'group=', 'month=2026-13', 'month=26-10', 'month=2026-10-01', 'month=1999-01']) {
    const r = await call(w, `/api/ai-budget/runs?${q}`, ME);
    assert.equal(r.status, 400, q);
  }
  w.f.db.exec('DROP TABLE ai_budget_reservations');
  const r = await call(w, '/api/ai-budget/runs?month=2026-10', ME);
  assert.equal(r.status, 503);
  assert.equal(r.body.code ?? r.body.error, 'ai_runs_unreadable');
  assert.ok(!/no such table|SQLITE/i.test(JSON.stringify(r.body)), 'no raw error reaches the member');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('at most 200 groups, the largest first, and truncated says there were more', async () => {
  // Mutation checked: the LIMIT's extra row not sliced off.
  const w = world();
  for (let i = 0; i < MAX_CONSUMPTION_ROWS + 3; i++) w.run({ page: `p${i}`, record: `r${i}`, charged: i + 1 });
  const r = await call(w, '/api/ai-budget/runs?group=record&month=2026-10', ME);
  assert.equal(r.body.rows.length, MAX_CONSUMPTION_ROWS);
  assert.equal(r.body.truncated, true);
  assert.equal(r.body.rows[0].charged_microusd, MAX_CONSUMPTION_ROWS + 3);
  assert.equal(r.body.totals.runs, MAX_CONSUMPTION_ROWS + 3, 'the totals count every run');
});

// ═════════════════════════════════════════════════════════════ PR 2: HQ's reads

const audits = (w: any, actor: number) =>
  w.f.db.prepare("SELECT details FROM activity_logs WHERE action='ai_member_runs_read' AND user_id=?").all(actor) as any[];

// 8 ───────────────────────────────────────────────────────────────────────────
test('HQ reads one member\'s month: by option within a page and each run, that member\'s rows only, audited', async () => {
  // Mutations checked: the user_id scope dropped from the run list; the audit line dropped; a run's charge read from another column.
  const w = world();
  const a = w.run({ page: VR, option: 'fill:pain_tag', charged: 3000, reservation: w.hold(ME, 2000, 1000), at: '2026-10-12 10:00:00' });
  w.run({ page: VR, option: 'fill:pain_tag', charged: 500, guardFor: a, at: '2026-10-12 10:00:01' });
  w.run({ page: 'founder.build', charged: null, at: '2026-10-14 09:00:00' });
  w.run({ user: OTHER, page: VR, option: 'fill:pain_tag', charged: 7_000_000, at: '2026-10-13 10:00:00' });
  w.f.db.prepare('UPDATE ai_usage_logs SET est_cost_usd = 0.0024 WHERE id = ?').run(a);
  for (const reader of [SUPER, ADMIN]) {
    const r = await call(w, `/api/ai-budget/members/${ME}/runs?month=2026-10`, reader);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.member_id, ME);
    assert.deepEqual(r.body.by_option.map((g: any) => [g.page, g.option, g.runs, g.charged_microusd]),
      [[VR, 'fill:pain_tag', 1, 3500], ['founder.build', null, 1, null]]);
    assert.equal(r.body.totals.charged_microusd, 3500);
    assert.deepEqual(r.body.runs.map((x: any) => [x.page, x.guard_for, x.charged_microusd]),
      [['founder.build', null, null], [VR, a, 500], [VR, null, 3000]], 'newest first, the guard check under its run');
    const first = r.body.runs.find((x: any) => x.id === a);
    assert.equal(first.cost_microusd, 2400);
    assert.equal(first.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    assert.ok(!JSON.stringify(r.body).includes('7000000'), 'another member\'s run never appears');
    assert.deepEqual(audits(w, reader).map((x) => JSON.parse(x.details)), [{ member_id: ME, month: '2026-10' }], 'each read is audited, with no figure');
  }
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('HQ\'s reads need an HQ Admin or Super Admin: a member 403, signed out 401, a branch 403; bad input 400, no member 404', async () => {
  // Mutations checked: requireAdmin dropped from either read; the branch refusal dropped; the month check dropped.
  const w = world();
  for (const path of [`/api/ai-budget/members/${ME}/runs`, '/api/ai/catalogue/hq']) {
    assert.equal((await call(w, path, null)).status, 401, path);
    assert.equal((await call(w, path, ME)).status, 403, path);
    assert.equal((await call(w, path, OTHER)).status, 403, path);
  }
  assert.equal((await call(w, `/api/ai-budget/members/${OTHER}/runs`, ME)).status, 403, 'a member never reads another member\'s month');
  assert.equal(audits(w, ME).length, 0);
  w.env.BRANCH_CODE = 'eu';
  assert.equal((await call(w, `/api/ai-budget/members/${ME}/runs`, ADMIN)).status, 403, 'a branch administrator is refused');
  assert.equal((await call(w, '/api/ai/catalogue/hq', ADMIN)).status, 403);
  delete w.env.BRANCH_CODE;
  assert.equal((await call(w, `/api/ai-budget/members/${ME}/runs?month=2026-13`, ADMIN)).status, 400);
  assert.equal((await call(w, '/api/ai-budget/members/9999/runs', ADMIN)).status, 404);
  assert.equal((await call(w, '/api/ai-budget/members/x/runs', ADMIN)).status, 404);
  w.f.db.exec('DROP TABLE ai_budget_reservations');
  const r = await call(w, `/api/ai-budget/members/${ME}/runs?month=2026-10`, ADMIN);
  assert.equal(r.status, 503);
  assert.ok(!/no such table|SQLITE/i.test(JSON.stringify(r.body)));
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('the run list stops at 100, newest first, and says when there were more', async () => {
  // Mutation checked: the LIMIT's extra row not sliced off.
  const w = world();
  for (let i = 0; i < MAX_RUN_LINES + 2; i++) w.run({ page: 'p', charged: i, at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')} 10:00:${String(i % 60).padStart(2, '0')}` });
  const r = await call(w, `/api/ai-budget/members/${ME}/runs?month=2026-10`, SUPER);
  assert.equal(r.body.runs.length, MAX_RUN_LINES);
  assert.equal(r.body.runs_truncated, true);
  assert.equal(r.body.totals.runs, MAX_RUN_LINES + 2);
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('models offered: the billing mode and who sets it, cost and billed per unit, paid-only, and the pages naming each model', async () => {
  // Mutations checked: billed at cost; the option rows left out of the pages; a model with no matrix row given a page.
  const w = world();
  const r = await call(w, '/api/ai/catalogue/hq', ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.billing, 'cost');
  assert.equal(r.body.set_by, 'AI_BILLING');
  assert.equal(r.body.markup, AI_MARKUP);
  assert.ok(r.body.models.length > 10);
  const llama = r.body.models.find((m: any) => m.id === '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  for (const [unit, cost] of Object.entries(llama.cost) as [string, number][]) {
    assert.ok(Math.abs(llama.billed[unit] - cost * AI_MARKUP) < 1e-6, `${unit} is billed at cost × ${AI_MARKUP}`);
  }
  assert.equal(typeof llama.paid_only, 'boolean');
  const expected = new Set([...railRows(), ...railOptionRows()].filter((row) => row.models.some((m) => m.id === llama.id)).map((row) => row.pageKey));
  assert.deepEqual(new Set(llama.pages), expected);
  assert.ok(llama.pages.length > 0);
  const optionOnly = railOptionRows().find((o) => !railRows().some((p) => p.pageKey === o.pageKey));
  if (optionOnly) {
    const m = r.body.models.find((x: any) => x.id === optionOnly.models[0]?.id);
    if (m) assert.ok(m.pages.includes(optionOnly.pageKey), 'an option row\'s page counts');
  }
  const named = new Set([...railRows(), ...railOptionRows()].flatMap((row) => row.models.map((m) => m.id)));
  const unnamed = r.body.models.find((m: any) => !named.has(m.id));
  assert.ok(unnamed, 'some offered model is on no row');
  assert.deepEqual(unnamed.pages, []);
});
