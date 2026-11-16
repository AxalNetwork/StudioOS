// #6252 (D6252): the fund brief and the letter opening. GP gate, sources, refusals before the model, nothing written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import router, { FUND_DRAFT_DEPS, FUND_DRAFT_SENTENCES, mount } from '../src/routes/fund_drafts.ts';
import funds from '../src/routes/funds.ts';
import { BRIEF_INSTRUCTION, LETTER_INSTRUCTION, briefMaterial, letterMaterial } from '../src/services/fundDrafts.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const tables = ['users', 'vc_funds', 'limited_partners', 'portfolio_positions', 'legal_documents', 'fund_report_periods', 'activity_logs', 'user_company_links', 'fund_distributions'];
const schema = tables.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + `CREATE TABLE IF NOT EXISTS company_profiles (id INTEGER PRIMARY KEY, archived_at TEXT);
     CREATE TABLE IF NOT EXISTS fund_capital_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, fund_id INTEGER NOT NULL, call_number INTEGER NOT NULL,
       amount_cents INTEGER NOT NULL, purpose TEXT, due_date TEXT, residual_cents INTEGER NOT NULL DEFAULT 0, line_count INTEGER NOT NULL DEFAULT 1,
       issued_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));`;
const secret = 'd6252-local-fixture-signing-secret';

async function fixture() {
  const { DB, db } = makeD1(schema);
  const insert = db.prepare("INSERT INTO users(id,name,email,role,investor_tier,investor_subscription_status) VALUES(?,?,?,?,?,'active')");
  for (const [uid, name, role, tier] of [[1, 'Admin', 'admin', 'free'], [2, 'GP', 'investor', 'institutional'], [3, 'LP', 'investor', 'free'], [4, 'Other', 'investor', 'institutional']]) insert.run(uid, name, `${name}@example.test`, role, tier);
  db.exec(`INSERT INTO vc_funds(id,name,gp_user_id,gp_name,gp_entity,fund_size_cents,fund_admin,status,vintage_year) VALUES
     (10,'Fund A',2,'Recorded GP','GP entity',1000000000,'Recorded administrator','investing',2026);
   INSERT INTO vc_funds(id,name,gp_user_id,status) VALUES(20,'Fund B',4,'');
   INSERT INTO limited_partners(fund_id,user_id,email,commitment_amount) VALUES(10,3,'lp@example.test',50000);
   INSERT INTO fund_report_periods(id,fund_id,period,period_start,period_end,notes,status) VALUES
     (100,10,'Q2 2026','2026-04-01','2026-06-30','{}','draft'),
     (101,10,'Q1 2026','2026-01-01','2026-03-31','{}','issued'),
     (102,10,'Q3 2026','','','{}','draft'),
     (103,10,'Q4 2026','2026-10-01','2026-12-31','{}','draft');
   INSERT INTO fund_capital_calls(fund_id,call_number,amount_cents,purpose,due_date,created_at) VALUES
     (10,1,25000000,'Seed follow-ons','2026-05-30','2026-05-02 10:00:00'),
     (10,2,999,'Outside the period',NULL,'2026-07-02 10:00:00');
   INSERT INTO fund_distributions(fund_id,lp_id,amount_cents,distribution_type,status,distributed_at) VALUES
     (10,1,1000000,'exit_proceeds','paid','2026-06-15'),(10,2,500000,'exit_proceeds','paid','2026-06-15'),
     (10,1,777,'exit_proceeds','pending','2026-06-16');`);
  const env = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development' } as any;
  const calls: any[] = [];
  FUND_DRAFT_DEPS.run = (async (_env: any, opts: any) => { calls.push(opts); return { ok: true, output: 'Fund A is investing [1].', usage: { model: 'test-model', est_cost_usd: 0.002 } }; }) as any;
  async function request(path: string, user = 2, body: any = { page: '/funds/10' }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (user) headers.Authorization = `Bearer ${await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret))}`;
    const response = await router.request(path, { method: 'POST', headers, body: JSON.stringify(body) }, env);
    return { status: response.status, body: await response.json() as any };
  }
  const writes = () => db.prepare('SELECT (SELECT COUNT(*) FROM activity_logs) AS logs, (SELECT group_concat(notes) FROM fund_report_periods) AS notes').get();
  return { db, env, calls, request, writes };
}

test('D6252 mounts at /api/funds ahead of funds.ts', () => {
  assert.equal(mount.path, '/api/funds');
  assert.deepEqual(mount.before, [funds]);
});

test('D6252 fund brief: the GP gets a draft whose sources are the recorded facts, and nothing is written', async () => {
  const f = await fixture();
  const before = f.writes();
  const r = await f.request('/10/drafts/brief');
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.kind, 'fund_brief');
  assert.equal(r.body.draft.stored, false);
  assert.equal(r.body.draft.body, 'Fund A is investing [1].');
  const labels = r.body.draft.sources.map((s: any) => s.label);
  assert.ok(labels.includes('Status: investing'));
  assert.ok(labels.includes('Target size (USD): $10,000,000.00'));
  assert.ok(labels.includes('Fund administrator: Recorded administrator'));
  assert.ok(!labels.some((l: string) => /Auditor/.test(l)), 'an unrecorded provider is not a source');
  assert.deepEqual(r.body.draft.sources.map((s: any) => s.n), labels.map((_: any, i: number) => i + 1));
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].text.startsWith(BRIEF_INSTRUCTION));
  assert.equal(f.calls[0].userId, 2);
  assert.equal(f.calls[0].rail.option, 'draft:fund-brief');
  assert.equal(f.calls[0].surface, '/funds/10');
  assert.deepEqual(f.writes(), before);
});

test('D6252 the GP gate: an LP (below the tier, so 402 first), another GP and the anonymous are refused before any model call', async () => {
  const f = await fixture();
  const statuses = [];
  for (const [path, user] of [['/10/drafts/brief', 3], ['/10/drafts/brief', 4], ['/10/drafts/brief', 0], ['/10x/drafts/brief', 2],
    ['/10/report-periods/100/drafts/letter', 3], ['/20/report-periods/100/drafts/letter', 2]] as const) statuses.push((await f.request(path, user)).status);
  assert.deepEqual(statuses, [402, 404, 401, 404, 402, 404]);
  f.db.exec("UPDATE users SET investor_tier='institutional' WHERE id=3");
  assert.equal((await f.request('/10/drafts/brief', 3)).status, 404, 'an LP at the tier is still not the GP');
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/10/drafts/brief', 1)).status, 200, 'an admin operates every fund');
});

test('D6252 a fund with nothing recorded beyond its name is refused before the model', async () => {
  const f = await fixture();
  const r = await f.request('/20/drafts/brief', 4);
  assert.equal(r.status, 409);
  assert.equal(r.body.message, FUND_DRAFT_SENTENCES.brief_nothing);
  assert.equal(f.calls.length, 0);
});

test('D6252 letter opening: the period\'s calls and paid distributions are its sources; nothing is written', async () => {
  const f = await fixture();
  const before = f.writes();
  const r = await f.request('/10/report-periods/100/drafts/letter');
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.kind, 'letter_opening');
  assert.deepEqual(r.body.draft.sources.map((s: any) => [s.n, s.kind, s.label, s.date]), [
    [1, 'capital_call', 'Capital call 1', '2026-05-02'],
    [2, 'distribution', 'Distribution (exit proceeds)', '2026-06-15'],
  ]);
  const text = f.calls[0].text;
  assert.ok(text.startsWith(LETTER_INSTRUCTION));
  assert.match(text, /\[1\] Capital call 1, recorded 2026-05-02: \$250,000\.00, due 2026-05-30, for Seed follow-ons/);
  assert.match(text, /\[2\] Distribution, exit proceeds, paid 2026-06-15: \$15,000\.00 across 2 LPs/);
  assert.doesNotMatch(text, /Outside the period|\$7\.77/, 'outside the period, or not paid, is not material');
  assert.equal(f.calls[0].rail.option, 'draft:letter-opening');
  assert.equal(f.calls[0].rail.record, 'fund_report_period:100');
  assert.deepEqual(f.writes(), before, 'the period is not saved, let alone issued');
});

test('D6252 letter refusals: issued, no dates, no movements, unknown period; none reaches the model', async () => {
  const f = await fixture();
  const issued = await f.request('/10/report-periods/101/drafts/letter');
  assert.deepEqual([issued.status, issued.body.message], [409, FUND_DRAFT_SENTENCES.letter_issued]);
  const undated = await f.request('/10/report-periods/102/drafts/letter');
  assert.deepEqual([undated.status, undated.body.message], [409, FUND_DRAFT_SENTENCES.letter_dates]);
  const empty = await f.request('/10/report-periods/103/drafts/letter');
  assert.deepEqual([empty.status, empty.body.message], [409, FUND_DRAFT_SENTENCES.letter_nothing]);
  assert.equal((await f.request('/10/report-periods/999/drafts/letter')).status, 404);
  assert.equal(f.calls.length, 0);
});

test('D6252 AI off and an exhausted budget answer in their own words, and nothing is drafted', async () => {
  const f = await fixture();
  FUND_DRAFT_DEPS.run = (async () => ({ ok: false, refusal: 'assist_off' })) as any;
  const off = await f.request('/10/drafts/brief');
  assert.equal(off.status, 403);
  assert.equal(off.body.error, 'assist_off');
  FUND_DRAFT_DEPS.run = (async () => ({ ok: false, refusal: 'budget_user_month' })) as any;
  const spent = await f.request('/10/report-periods/100/drafts/letter');
  assert.equal(spent.status, 402);
  assert.equal(spent.body.error, 'budget_user_month');
  assert.ok(String(spent.body.message).length > 10);
  FUND_DRAFT_DEPS.run = (async () => ({ ok: true, output: '   ' })) as any;
  const blank = await f.request('/10/drafts/brief');
  assert.deepEqual([blank.status, blank.body.message], [503, FUND_DRAFT_SENTENCES.unavailable]);
  FUND_DRAFT_DEPS.run = (async () => { throw new Error('provider down'); }) as any;
  assert.equal((await f.request('/10/drafts/brief')).status, 503);
});

test('D6252 the builders: no fact or no dated movement is null; the letter keeps the skill\'s rules', () => {
  assert.equal(briefMaterial({ fund: { id: 1, name: 'Empty', providers: {}, gp: {} }, totals: {} }), null);
  assert.equal(briefMaterial(null), null);
  assert.equal(letterMaterial({ period: 'Q', period_start: null, period_end: '2026-01-01' }, [], []), null);
  assert.equal(letterMaterial({ period: 'Q', period_start: '2026-01-01', period_end: '2026-03-31' }, [], []), null);
  const q1 = { period: 'Q1', period_start: '2026-01-01', period_end: '2026-03-31' };
  const call = (n: number, at: string) => ({ id: n, call_number: n, amount_cents: 100, purpose: null, due_date: null, created_at: at });
  assert.equal(letterMaterial(q1, [call(1, '2026-04-01 00:00:00')], []), null, 'a call after the end is outside');
  assert.deepEqual(letterMaterial(q1, [call(1, '2025-12-31 23:00:00'), call(2, '2026-03-31 12:00:00')], [])?.sources.map((s) => s.label), ['Capital call 2'], 'the end date is inclusive');
  const skill = readFileSync(new URL('../src/services/agents/skills/lp-quarterly-letter-draft.md', import.meta.url), 'utf8');
  assert.match(skill, /Never project returns/);
  assert.match(LETTER_INSTRUCTION, /Never project returns/);
  assert.match(LETTER_INSTRUCTION, /Not recorded/);
  for (const s of [BRIEF_INSTRUCTION, LETTER_INSTRUCTION, ...Object.values(FUND_DRAFT_SENTENCES)]) assert.doesNotMatch(s, /recommend|advice/i);
});
