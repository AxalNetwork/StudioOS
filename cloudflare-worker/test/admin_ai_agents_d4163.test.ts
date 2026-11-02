/**
 * D4163 (#4163, H5 of #4137): HQ › AI agents' reads — Overview, Runs, one
 * run, Spend and the admin audit. Synthetic data on the real migrated schema
 * in memory, through the mounted router.
 *
 *   · Super Admin only: a founder and a plain admin are refused on every route;
 *   · "Not recorded" is null, never 0: an unrecorded charge, a rate with
 *     nothing to rate and the budget H4 has not set yet all read null;
 *   · no email in any answer or CSV, run inputs included;
 *   · the audit has no write route, and the table refuses an update;
 *   · the run log's status, outcome and filters; one run's inputs as references.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminAiAgents from '../src/routes/admin_ai_agents.ts';
import { auditCsv, auditProblem, recordAiAdminAction } from '../src/services/agents/adminAudit.ts';
import { outcomeOf, redactEmails, runStatusOf } from '../src/services/agents/adminReads.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-d4163-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const SUPER = 1, FOUNDER = 2, PLAIN_ADMIN = 3, OTHER_SUPER = 4;
const EMAILS = ['synthetic-super@example.invalid', 'synthetic-founder@example.invalid', 'synthetic-admin@example.invalid', 'synthetic-super-two@example.invalid'];
const now = new Date();
const sql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const daysAgo = (n: number) => sql(new Date(now.getTime() - n * 86_400_000));
const thisMonth = () => sql(new Date(Math.max(new Date(`${now.toISOString().slice(0, 7)}-01T00:00:00Z`).getTime() + 60_000, now.getTime() - 3_600_000)));

function fixture({ unrecorded = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const user = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  user.run(SUPER, EMAILS[0], 'Ada Super', 'admin');
  user.run(FOUNDER, EMAILS[1], 'Femi Founder', 'founder');
  user.run(PLAIN_ADMIN, EMAILS[2], 'Pat Admin', 'admin');
  user.run(OTHER_SUPER, EMAILS[3], 'Bo Second', 'admin');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(OTHER_SUPER);
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (10, 'co-10', 'Synthetic Co')");
  db.exec("INSERT INTO projects (id, name, company_id) VALUES (20, 'Synthetic Project', 10)");
  const agent = db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, project_id, role_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, status, paused_reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, '@cf/zai-org/glm-4.7-flash', ?, ?, ?, ?, ?)`);
  agent.run(100, 'agent-vesta-0001', 'project', null, 20, 'finance', 'Vesta', FOUNDER, 5_000_000, 'active', null, FOUNDER);
  agent.run(101, 'agent-orrin-0002', 'company', 10, null, 'product', 'Orrin', FOUNDER, 1_000, 'paused', 'cap', FOUNDER);
  db.exec(`INSERT INTO scope_tasks (id, uid, scope_kind, project_id, title, assignee_kind, assignee_agent_id) VALUES (500, 'task-0000-0500', 'project', 20, 'Draft the update', 'agent', 100)`);
  db.exec(`INSERT INTO scope_tasks (id, uid, scope_kind, company_id, title, assignee_kind, assignee_agent_id) VALUES (501, 'task-0000-0501', 'company', 10, 'Review the plan', 'agent', 101)`);
  const usage = db.prepare('INSERT INTO ai_usage_logs (id, user_id, task, model, prompt_tokens, completion_tokens, charged_microusd, agent_id, created_at, refusal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  usage.run(900, FOUNDER, 'rail_chat', '@cf/zai-org/glm-4.7-flash', 400, 100, 2_000, 100, thisMonth(), null);
  usage.run(901, FOUNDER, 'rail_chat', '@cf/zai-org/glm-4.7-flash', 300, 80, unrecorded ? null : 1_500, 101, thisMonth(), null);
  usage.run(902, FOUNDER, 'rail_chat', '@cf/meta/llama-4-scout-17b-16e-instruct', 0, 0, 0, 101, thisMonth(), 'all_models_failed');
  // The step summary and the proposal carry a member's email, as free text can; neither may reach HQ.
  const steps = JSON.stringify([{ name: 'load', status: 'done', at: daysAgo(1), summary: `Loaded the task for ${EMAILS[1]}` }, { name: 'run', status: 'done', at: daysAgo(1), summary: 'Drafted' }]);
  const run = db.prepare(`INSERT INTO agent_task_runs (id, uid, agent_id, task_id, attempt, status, steps_json, usage_log_id, proposal_uid, refusal, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
  run.run(1, 'run-0000-0001', 100, 500, 'done', steps, 900, 'prop-0000-0001', null, daysAgo(1));
  run.run(2, 'run-0000-0002', 101, 501, 'refused', '[]', 901, null, 'cap', daysAgo(2));
  db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, status, agent_id, decided_at)
    VALUES ('prop-0000-0001', ?, 'team', 'draft', 'draft', ?, 'edited', 100, ?)`).run(FOUNDER, JSON.stringify({ text: `Send to ${EMAILS[1]} on Friday` }), daysAgo(1));
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/admin/ai-agents', adminAiAgents);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function get(f: F, who: number | null, path: string, method = 'GET') {
  const res = await f.app.request(ORIGIN + '/api/admin/ai-agents' + path, { method, headers: who ? { Authorization: `Bearer ${await token(who)}` } : {} }, f.env);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, body, text, headers: res.headers };
}
const noEmail = (text: string, where: string) => {
  for (const e of EMAILS) assert.ok(!text.includes(e), `${where} carries ${e}`);
  assert.doesNotMatch(text, /@example\.invalid/, `${where} carries an email`);
};

const ROUTES = ['/overview', '/runs', '/runs/run-0000-0001', '/spend?by=agent', '/audit', '/audit.csv'];

test('Super Admin only: a founder, a plain admin and no one at all are refused on every route', async () => {
  const f = fixture();
  try {
    for (const p of ROUTES) {
      assert.equal((await get(f, null, p)).status, 401, `${p}: signed out`);
      assert.equal((await get(f, FOUNDER, p)).status, 403, `${p}: a founder`);
      assert.equal((await get(f, PLAIN_ADMIN, p)).status, 403, `${p}: an admin who is not a Super Admin`);
      assert.equal((await get(f, SUPER, p)).status, 200, `${p}: a Super Admin`);
    }
  } finally { f.close(); }
});

test('the audit has no write route: POST, PUT, PATCH and DELETE find nothing, and the table refuses an update or delete', async () => {
  const f = fixture();
  try {
    await recordAiAdminAction(f.env, { adminUserId: SUPER, action: 'policy.pause', area: 'policy', subject: 'platform', before: { paused: false }, after: { paused: true }, reason: 'Model provider incident' });
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const p of ['/audit', '/audit/1']) assert.equal((await get(f, SUPER, p, m)).status, 404, `${m} ${p}`);
    }
    assert.throws(() => f.db.prepare("UPDATE ai_admin_audit SET reason = 'changed' WHERE id = 1").run(), /append-only/);
    assert.throws(() => f.db.prepare('DELETE FROM ai_admin_audit WHERE id = 1').run(), /append-only/);
  } finally { f.close(); }
});

test('every audited action names its admin and carries a reason; the read and the CSV name people, never by email', async () => {
  assert.equal(auditProblem({ adminUserId: 1, action: 'persona.hide', area: 'roster', subject: 'persona:vesta', reason: '  ' }), 'a reason');
  assert.equal(auditProblem({ adminUserId: 1, action: 'persona.hide', area: 'nowhere' as any, subject: 'persona:vesta', reason: 'x' }), 'a panel area');
  assert.equal(auditProblem({ adminUserId: 1, action: 'persona.hide', area: 'roster', subject: 'persona:vesta', reason: 'Trademark check done' }), null);
  const f = fixture();
  try {
    await assert.rejects(() => recordAiAdminAction(f.env, { adminUserId: SUPER, action: 'policy.pause', area: 'policy', subject: 'platform', reason: '' }), /needs a reason/);
    await recordAiAdminAction(f.env, { adminUserId: SUPER, action: 'persona.hide', area: 'roster', subject: 'persona:vesta', before: { status: 'offered' }, after: { status: 'hidden' }, reason: 'Retiring the old avatar' });
    await recordAiAdminAction(f.env, { adminUserId: OTHER_SUPER, action: 'policy.pause', area: 'policy', subject: 'platform', before: { paused: false }, after: { paused: true }, reason: '=HYPERLINK("x") incident' });
    const all = await get(f, SUPER, '/audit');
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.rows.map((r: any) => [r.admin.name, r.action, r.area, r.reason.slice(0, 8)]), [['Bo Second', 'policy.pause', 'policy', '=HYPERLI'], ['Ada Super', 'persona.hide', 'roster', 'Retiring']]);
    assert.deepEqual(all.body.rows[1].before, { status: 'offered' });
    noEmail(all.text, 'the audit');
    const one = await get(f, SUPER, `/audit?area=roster&admin=${SUPER}`);
    assert.deepEqual(one.body.rows.map((r: any) => r.action), ['persona.hide']);
    assert.equal((await get(f, SUPER, '/audit?area=nowhere')).status, 400);
    const csv = await get(f, SUPER, '/audit.csv');
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(csv.text, /^When \(UTC\),Admin,Action,Area,Subject,Before,After,Reason\r\n/);
    assert.match(csv.text, /Bo Second,policy\.pause,policy,platform/);
    assert.match(csv.text, /"'=HYPERLINK\(""x""\) incident"/, 'a formula is written as text');
    noEmail(csv.text, 'the CSV');
    const page = await (async () => { const r = await get(f, SUPER, '/audit'); return r.body; })();
    assert.equal(page.next_cursor, null);
  } finally { f.close(); }
});

test('Not recorded is null, never 0: an unrecorded charge, a rate with nothing to rate and the budget H4 has not set', async () => {
  const f = fixture({ unrecorded: true });
  try {
    const o = (await get(f, SUPER, '/overview')).body;
    assert.equal(o.spend_month.spent_microusd, null, 'one agent call carries no recorded charge: the month is not a smaller number');
    assert.equal(o.spend_month.budget_microusd, null, 'H4 has set no budget yet');
    assert.equal(o.spend_month.share, null);
    assert.equal(o.agents_active, 1);
    assert.equal(o.runs.week, 2);
    assert.equal(o.proposals_accepted_pct, 100, 'an edit is an acceptance');
    assert.equal(o.runs_failed_pct, 0, 'two ended runs, none failed: a known 0');
    const golden = o.needs_attention.find((a: any) => a.kind === 'failing_golden_cases');
    assert.deepEqual([golden.available, golden.reason], [false, 'Not recorded'], 'H2 records golden cases; until then it says so');
    const s = (await get(f, SUPER, '/spend?by=model')).body;
    assert.equal(s.spent_microusd, null);
    assert.equal(s.projected_microusd, null);
    assert.equal(s.lines.find((l: any) => l.key === 'model:@cf/zai-org/glm-4.7-flash').spent_microusd, null);
    const runs = (await get(f, SUPER, '/runs')).body.runs;
    assert.equal(runs.find((r: any) => r.uid === 'run-0000-0002').cost_microusd, null);
  } finally { f.close(); }
  const empty = fixture();
  try {
    empty.db.exec('DELETE FROM ai_rail_proposals; DELETE FROM agent_task_runs;');
    const o = (await get(empty, SUPER, '/overview')).body;
    assert.equal(o.proposals_accepted_pct, null, 'no decision to rate');
    assert.equal(o.runs_failed_pct, null, 'no run ended');
    assert.equal(o.runs.week, 0, 'a count read from its table is a count');
  } finally { empty.close(); }
});

test('with H4\'s budget set, spend reads against it; the projection, the lines and the teams at their cap', async () => {
  const f = fixture();
  try {
    f.db.exec('INSERT INTO ai_agent_policy (id, platform_budget_microusd) VALUES (1, 500000000)');
    const o = (await get(f, SUPER, '/overview')).body;
    assert.deepEqual([o.spend_month.spent_microusd, o.spend_month.budget_microusd], [3_500, 500_000_000]);
    for (const by of ['agent', 'skill', 'company', 'model']) {
      const s = (await get(f, SUPER, `/spend?by=${by}`)).body;
      assert.equal(s.spent_microusd, 3_500, by);
      assert.equal(s.lines.reduce((x: number, l: any) => x + (l.spent_microusd ?? 0), 0), 3_500, `${by}: the lines add up`);
      assert.ok(s.projected_microusd >= 3_500, `${by}: the projection is at least what is spent`);
      noEmail(JSON.stringify(s), `spend by ${by}`);
    }
    const byAgent = (await get(f, SUPER, '/spend?by=agent')).body;
    assert.deepEqual(byAgent.lines.map((l: any) => [l.label, l.spent_microusd]), [['Vesta', 2_000], ['Orrin', 1_500]]);
    assert.deepEqual(byAgent.teams_at_cap.map((t: any) => [t.agent.name, t.team.company, t.cap_microusd]), [['Orrin', 'Synthetic Co', 1_000]]);
    const byCo = (await get(f, SUPER, '/spend?by=company')).body;
    assert.deepEqual(byCo.lines.map((l: any) => l.label), ['Synthetic Co'], 'a project team counts under its company');
    assert.equal((await get(f, SUPER, '/spend?by=planet')).status, 400);
  } finally { f.close(); }
});

test('the run log: persona names, teams as company › project, status and outcome, filters and pages; no email', async () => {
  assert.deepEqual(['done', 'refused', 'failed', 'step_lost', 'halted', 'running', 'cancelled'].map(runStatusOf), ['succeeded', 'refused', 'failed', 'failed', 'failed', 'running', 'cancelled']);
  assert.deepEqual(['accepted', 'edited', 'discarded', 'proposed', null].map(outcomeOf), ['accepted', 'accepted', 'rejected', 'pending', null]);
  const f = fixture();
  try {
    const r = await get(f, SUPER, '/runs');
    assert.equal(r.status, 200);
    const [a, b] = r.body.runs;
    assert.deepEqual([a.uid, a.agent.name, a.team.company, a.team.project, a.status, a.proposal_outcome, a.tokens, a.cost_microusd],
      ['run-0000-0002', 'Orrin', 'Synthetic Co', null, 'refused', null, 380, 1_500]);
    assert.deepEqual([b.agent.name, b.team.company, b.team.project, b.status, b.proposal_outcome, b.tokens], ['Vesta', 'Synthetic Co', 'Synthetic Project', 'succeeded', 'accepted', 500]);
    noEmail(r.text, 'the run log');
    assert.deepEqual((await get(f, SUPER, '/runs?status=succeeded')).body.runs.map((x: any) => x.uid), ['run-0000-0001']);
    assert.deepEqual((await get(f, SUPER, '/runs?agent=agent-orrin-0002')).body.runs.map((x: any) => x.uid), ['run-0000-0002']);
    assert.deepEqual((await get(f, SUPER, '/runs?team=project:20')).body.runs.map((x: any) => x.uid), ['run-0000-0001']);
    assert.equal((await get(f, SUPER, '/runs?status=maybe')).status, 400);
    assert.equal((await get(f, SUPER, '/runs?team=everyone')).status, 400);
  } finally { f.close(); }
});

test('one run: steps, inputs as record references, output, cost against the hold, errors — and no member email, even one typed into the text', async () => {
  const f = fixture();
  try {
    const r = await get(f, SUPER, '/runs/run-0000-0001');
    assert.equal(r.status, 200);
    const run = r.body.run;
    assert.deepEqual(run.inputs.map((i: any) => i.ref), ['task:task-0000-0500', 'project:20']);
    assert.ok(run.inputs.every((i: any) => /^[a-z]+:/.test(i.ref)), 'every input is a reference');
    assert.match(run.steps[0].summary, /Loaded the task for \[email removed\]/);
    assert.equal(run.output.payload.text, 'Send to [email removed] on Friday');
    assert.deepEqual(run.cost, { charged_microusd: 2_000, hold_microusd: null });
    noEmail(r.text, 'one run');
    const refused = (await get(f, SUPER, '/runs/run-0000-0002')).body.run;
    assert.deepEqual(refused.errors, [{ code: 'cap' }]);
    assert.equal((await get(f, SUPER, '/runs/no-such-run-0000')).status, 404);
  } finally { f.close(); }
});

test('redactEmails reaches every depth', () => {
  assert.deepEqual(redactEmails({ a: ['x synthetic@example.invalid y', { b: 'synthetic.two+tag@example.invalid' }], n: 3 }), { a: ['x [email removed] y', { b: '[email removed]' }], n: 3 });
  assert.match(auditCsv([]), /^When \(UTC\),Admin/);
});
