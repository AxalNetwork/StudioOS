/** D4422 (#4422): real SQLite policy inheritance, permissions, audited saves and use-time revocation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { agentRun } from '../src/services/agents/agentRun.ts';
import { agentMcpRefusal, allowlistRefusal, readAllowlists } from '../src/services/agents/allowlists.ts';
import { readTools } from '../src/services/agents/agentTools.ts';
import { callTool, serveMcp } from '../src/mcp/server.ts';
import { METERING_POLICY } from '../src/services/metering.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const MIGRATION = sql('migrations/712_team_agents.sql');

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CAP = 5_000_000;
// People: the company's editor, a plain member, a stranger, an editor on a free plan,
// a project's owner (founder 200), a project advisor, HQ's admin.
const EDITOR = 10, MEMBER = 11, STRANGER = 12, FREE_EDITOR = 13, PROJECT_OWNER = 15, ADVISOR = 16, ADMIN = 1;
const IN_CO = 7, ALONE = 8;

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'integrations', 'activity_logs', 'project_members'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(MIGRATION);
  db.exec(sql('migrations/202611041438_team_allowlists.sql'));
  db.exec(sql('migrations/202611021724_team_agents_persona.sql')); // D4117: persona_key
  // #3846: migration 727's task_id and run_key, which an agent's proposal names.
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
  user.run(ADMIN, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', null, 'free');
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100, 'growth');
  user.run(MEMBER, 'u-member', 'member@example.test', 'Max Member', 'founder', 101, 'growth');
  user.run(STRANGER, 'u-stranger', 'stranger@example.test', 'Sam Stranger', 'founder', 102, 'growth');
  user.run(FREE_EDITOR, 'u-free', 'free@example.test', 'Fay Free', 'founder', 103, 'free');
  user.run(PROJECT_OWNER, 'u-powner', 'powner@example.test', 'Pat Owner', 'founder', 200, 'growth');
  user.run(ADVISOR, 'u-advisor', 'advisor@example.test', 'Al Advisor', 'founder', 104, 'growth');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')").run();
  const link = db.prepare("INSERT INTO user_company_links (uid, user_id, company_id, role_in_company) VALUES (?, ?, 1, ?)");
  link.run('l1', EDITOR, 'Founder'); link.run('l2', MEMBER, 'Member'); link.run('l3', FREE_EDITOR, 'Owner');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 200, ?)").run(IN_CO, 'p7', 'Rocket', 1);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, 200, NULL)").run(ALONE, 'p8', 'Solo');
  const env: any = { DB, JWT_SECRET: 'd1496-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/teams', teamAgents);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/teams${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const cfo = (over: Record<string, unknown> = {}) => ({ role_key: 'cfo', first_name: 'Carla', last_name: 'Cash', model_id: MODEL, monthly_cap_microusd: CAP, ...over });
const CO = '/company/co-uid-1';

const SRV = 'c'.repeat(32), THEIRS = 'd'.repeat(32), DOWN = 'e'.repeat(32);
/** A custom MCP connection as D852 stores it: approved read tools pinned, a drifted one, and a mail send tool (a write),
 * also left in `approved` (the overlap `customProvider` guards), so the write is refused by name, not by luck. */
function server(w: W, owner: number, uid: string, o: { status?: string; approved?: Record<string, string>; drift?: string[] } = {}) {
  const cfg = { pattern: 'mcp', url: `https://${uid.slice(0, 4)}.example/mcp`, hosts: [`${uid.slice(0, 4)}.example`], accepted_scopes: [],
    approved: o.approved ?? { read_ledger: 'f'.repeat(64), old_report: 'f'.repeat(64), send_mail: 'f'.repeat(64) }, drift: (o.drift ?? ['old_report']).map((tool) => ({ tool, why: 'changed' })),
    mail_send: { tool: 'send_mail', pin: 'f'.repeat(64) } };
  w.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, display_name, status, auth_type, config_json, capabilities_json, scopes_json)
    VALUES (?, ?, ?, ?, ?, 'mcp_oauth', ?, '[]', '[]')`).run(uid, owner, `custom:${uid}`, `Ledger ${uid.slice(0, 2)}`, o.status ?? 'active', JSON.stringify(cfg));
}
const DEFAULT = { model_ids: null, tool_grants: null };
const SCOPE: any = { kind: 'company', id: 1, uid: 'co-uid-1', name: 'Acme' };
const G = { integration_uid: SRV, tool: 'read_ledger' };
const PUT = (w: W, lists: unknown, who = EDITOR, path = CO) => call(w, who, 'PUT', `${path}/allowlists`, lists);
const row = (w: W, uid: string): any => w.db.prepare('SELECT * FROM team_agents WHERE uid = ?').get(uid);
async function add(w: W, body: any = cfo(), path = CO, who = EDITOR) {
  const r = await call(w, who, 'POST', `${path}/agents`, body);
  assert.equal(r.status, 201, r.text);
  return row(w, r.body.agent.uid);
}
const RUN = { module: 'cap-table', option: 'draft:raise/capital', prompt: 'Draft a runway note using the recorded figures.' };

// Every denial is paired with the same accepted request after changing only its gate.
test('defaults, explicit empty lists, reset, valid offer, audit actor/time and atomic audit failure', async () => {
  const w = world();
  const initial = await call(w, MEMBER, 'GET', `${CO}/allowlists`);
  assert.equal(initial.status, 200, initial.text);
  assert.deepEqual([initial.body.model_ids, initial.body.tool_grants, initial.body.can_manage, initial.body.inherited], [null, null, false, false]);
  assert.ok(initial.body.models.some((m: any) => m.id === MODEL && !m.plan_locked));
  assert.equal((await PUT(w, { model_ids: [], tool_grants: [] })).status, 200);
  const denied = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo());
  assert.deepEqual([denied.status, denied.body.error], [403, 'model_not_allowed']);
  const audit: any = w.db.prepare("SELECT * FROM activity_logs WHERE action = 'team_allowlists_changed'").get();
  assert.equal(audit.user_id, EDITOR);
  assert.ok(audit.created_at);
  assert.deepEqual(JSON.parse(audit.details), { scope: 'company', scope_id: 1, model_ids: [], tool_grants: [] });
  assert.equal((await PUT(w, DEFAULT)).status, 200);
  assert.ok((await add(w)).id);
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: ['not-a-plan-model'] })).status, 403);
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: [MODEL] }, FREE_EDITOR)).status, 403);
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: [MODEL] })).status, 200);
  w.db.exec('DROP TABLE activity_logs');
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: [] })).status, 500);
  assert.deepEqual(await readAllowlists(w.env, SCOPE), { ...DEFAULT, model_ids: [MODEL] });
});

test('company manage gate, inherited project policy, standalone isolation and no cross-company access', async () => {
  const w = world();
  assert.equal((await PUT(w, DEFAULT, MEMBER)).status, 403);
  assert.equal((await PUT(w, DEFAULT, STRANGER)).status, 403);
  assert.equal((await call(w, STRANGER, 'GET', `${CO}/allowlists`)).status, 403);
  assert.equal((await PUT(w, DEFAULT, PROJECT_OWNER, `/project/${IN_CO}`)).status, 403);
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: [] })).status, 200);
  const inherited = await call(w, PROJECT_OWNER, 'GET', `/project/${IN_CO}/allowlists`);
  assert.equal(inherited.status, 200, inherited.text);
  assert.deepEqual([inherited.body.inherited, inherited.body.can_manage, inherited.body.scope.id, inherited.body.model_ids], [true, false, 'co-uid-1', []]);
  const denied = await call(w, PROJECT_OWNER, 'POST', `/project/${IN_CO}/agents`, cfo());
  assert.deepEqual([denied.status, denied.body.error], [403, 'model_not_allowed']);
  assert.equal((await PUT(w, DEFAULT, EDITOR, `/project/${IN_CO}`)).status, 200);
  assert.ok((await add(w, cfo(), `/project/${IN_CO}`, PROJECT_OWNER)).id);
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: [] }, PROJECT_OWNER, `/project/${ALONE}`)).status, 200);
  assert.equal((await call(w, EDITOR, 'GET', `${CO}/allowlists`)).body.model_ids, null);
  assert.deepEqual((await call(w, PROJECT_OWNER, 'GET', `/project/${ALONE}/allowlists`)).body.model_ids, []);
});

test('model or granted tool revoked after add refuses quotes and runs before any provider call', async () => {
  const w = world();
  w.env.CUSTOM_MCP_ENABLED = 'true'; server(w, EDITOR, SRV);
  let calls = 0; w.env.AI = { run: async () => { calls += 1; throw new Error('unexpected provider'); } };
  const a = await add(w, cfo({ tool_grants: [G] }));
  assert.equal((await PUT(w, { model_ids: [MODEL], tool_grants: [G] })).status, 200);
  assert.equal(await allowlistRefusal(w.env, SCOPE, MODEL, [G]), null);
  assert.equal((await PUT(w, { ...DEFAULT, model_ids: [] })).status, 200);
  const quote = await call(w, EDITOR, 'GET', `/agents/${a.uid}/run/quote?module=${RUN.module}&option=${RUN.option}`);
  assert.deepEqual([quote.status, quote.body.error], [403, 'model_not_allowed']);
  const denied = await agentRun(w.env, { agent: a, ...RUN });
  assert.deepEqual([denied.ok, !denied.ok && denied.code], [false, 'model_not_allowed']);
  assert.equal((await PUT(w, { ...DEFAULT, tool_grants: [] })).status, 200);
  const toolDenied = await agentRun(w.env, { agent: a, ...RUN });
  assert.deepEqual([toolDenied.ok, !toolDenied.ok && toolDenied.code], [false, 'tool_not_allowed']);
  assert.equal(calls, 0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_usage_logs').get().n, 0);
  assert.equal((await PUT(w, DEFAULT)).status, 200);
  assert.equal(await allowlistRefusal(w.env, SCOPE, MODEL, [G]), null);
});

test('only connected team read tools can be selected; sponsor grants still gate add and MCP use', async () => {
  const w = world(); w.env.CUSTOM_MCP_ENABLED = 'true';
  server(w, EDITOR, SRV); server(w, STRANGER, THEIRS);
  const get = await call(w, EDITOR, 'GET', `${CO}/allowlists`);
  assert.deepEqual(get.body.servers.map((s: any) => [s.integration_uid, s.tools.map((t: any) => t.name)]), [[SRV, ['read_ledger']]]);
  const reader = await call(w, MEMBER, 'GET', `${CO}/allowlists`);
  assert.deepEqual(reader.body.servers, [], 'readers do not receive other members’ private connection catalogues');
  for (const g of [{ ...G, integration_uid: THEIRS }, { ...G, tool: 'send_mail' }, { ...G, tool: 'old_report' }]) {
    assert.equal((await PUT(w, { ...DEFAULT, tool_grants: [g] })).status, 403);
  }
  assert.equal((await PUT(w, { ...DEFAULT, tool_grants: [] })).status, 200);
  const denied = await call(w, EDITOR, 'POST', `${CO}/agents`, cfo({ tool_grants: [G] }));
  assert.deepEqual([denied.status, denied.body.error], [403, 'tool_not_allowed']);
  assert.equal((await PUT(w, { ...DEFAULT, tool_grants: [G] })).status, 200);
  const a = await add(w, cfo({ tool_grants: [G] }));
  const context = { agent_uid: a.uid, integration_uid: SRV };
  assert.equal(await agentMcpRefusal(w.env, EDITOR, context, G.tool), null);
  assert.equal((await agentMcpRefusal(w.env, STRANGER, context, G.tool))?.code, 'agent_context_invalid');
  assert.equal((await agentMcpRefusal(w.env, EDITOR, context, 'send_mail'))?.code, 'tool_not_granted');
  let calls = 0;
  const deps: any = { metered: async (_e: any, _p: any, fn: any) => ({ value: await fn() }), call: async (_e: any, _r: any, _t: any, _a: any, d: any) => { calls += 1; assert.deepEqual(d.agentContext, context); return { data: { total: 42 } }; } };
  const reads = [{ ...G, arguments: {} }];
  assert.equal((await readTools(w.env, a, reads, 'read-1', deps)).ok, true);
  assert.equal(calls, 1);
  await PUT(w, { ...DEFAULT, tool_grants: [] });
  const stop: any = await readTools(w.env, a, reads, 'read-2', deps);
  assert.deepEqual([stop.ok, stop.code, calls], [false, 'tool_not_allowed', 1]);
  // This is the /mcp tool callback too, before scopes, metering and the handler.
  let ran = false;
  const tool: any = { name: G.tool, requiredScope: 'test:read', company: false, run: async () => { ran = true; return {}; } };
  const props: any = { userId: EDITOR, clientId: 'test', companies: [], grantedAt: Math.floor(Date.now() / 1000) };
  const result = await callTool(w.env, props, null, tool, {}, ['test:read'], METERING_POLICY, context);
  assert.equal(JSON.parse(result.content[0].text).code, 'tool_not_allowed');
  assert.equal(ran, false);
  const malformed = await serveMcp(new Request('https://example.test/mcp', { headers: { 'X-Axal-Agent': a.uid } }), w.env, props, null, []);
  assert.equal(malformed.status, 400);
  // The same member call is unaffected by an agent-only list.
  const member = await callTool(w.env, props, null, tool, {}, ['test:read'], METERING_POLICY);
  assert.equal(member.isError, undefined);
  assert.equal(ran, true);
  ran = false;
  await PUT(w, DEFAULT);
  assert.equal(await agentMcpRefusal(w.env, EDITOR, context, G.tool), null);
  const allowed = await callTool(w.env, props, null, tool, {}, ['test:read'], METERING_POLICY, context);
  assert.equal(allowed.isError, undefined);
  assert.equal(ran, true);
  ran = false;
  const write = await callTool(w.env, props, null, { ...tool, readOnly: false }, {}, ['test:read'], METERING_POLICY, context);
  assert.equal(JSON.parse(write.content[0].text).code, 'tool_not_allowed');
  assert.equal(ran, false);
});

test('malformed/unreadable policies refuse; no row and pre-migration databases retain defaults', async () => {
  const w = world();
  for (const body of [{}, { model_ids: 'all', tool_grants: null }, { model_ids: null, tool_grants: [{}] }]) assert.equal((await PUT(w, body)).status, 400);
  assert.equal(await allowlistRefusal(w.env, SCOPE, MODEL, [G]), null);
  await PUT(w, { ...DEFAULT, model_ids: [MODEL] });
  w.db.prepare("UPDATE team_allowlists SET model_ids_json = '[1]'").run();
  assert.equal((await allowlistRefusal(w.env, SCOPE, MODEL, []))?.code, 'allowlists_unreadable');
  const broken = { ...w.env, DB: { prepare() { throw new Error('database unavailable'); } } };
  assert.equal(await readAllowlists(broken, SCOPE), null);
  w.db.exec('DROP TABLE team_allowlists');
  assert.deepEqual(await readAllowlists(w.env, SCOPE), DEFAULT);
});

test('company denial cannot be bypassed by the platform fallback; permitted fallback and plan defaults still run', async () => {
  __resetForTest();
  const w = world();
  w.db.exec(AI_BUDGET_MIGRATION + sql('migrations/465_ai_rail_preferences.sql') + sql('migrations/510_member_ai_pauses.sql')
    + sql('migrations/525_ai_reservation_idempotency.sql') + sql('migrations/632_ai_hold_context.sql')
    + sql('migrations/202611022046_ai_admin_audit.sql') + sql('migrations/202611022114_ai_agent_policy.sql'));
  w.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:growth',0,0,1)").run();
  w.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,50000000)').run(EDITOR);
  const calls: string[] = [];
  w.env.AI = withGuard({ run: async (model: string) => { calls.push(model); return { response: 'A runway note for review.', usage: { prompt_tokens: 40, completion_tokens: 10 } }; } });
  const original = '@cf/openai/gpt-oss-120b';
  const a = await add(w, cfo({ model_id: original }));
  w.db.exec(`CREATE TABLE agent_skill_links (agent_id INTEGER, skill_id INTEGER);
    CREATE TABLE agent_skill_tags (skill_id INTEGER, taxonomy_skill_slug TEXT);
    CREATE TABLE skills (slug TEXT, category_slug TEXT);
    INSERT INTO agent_skill_tags VALUES (1, 'finance'); INSERT INTO skills VALUES ('finance', 'finance_ops')`);
  w.db.prepare('INSERT INTO agent_skill_links VALUES (?, 1)').run(a.id);
  w.db.prepare('UPDATE ai_agent_policy SET area_models_json = ? WHERE id = 1').run(JSON.stringify({ finance_ops: { suggested: [original, MODEL], default: MODEL } }));
  w.db.prepare('INSERT INTO ai_model_locks (model, reason, locked_by) VALUES (?, ?, 1)').run(original, 'Test lock');
  const step = { module: 'use-of-funds', option: 'draft:raise/use-of-funds-runway', prompt: 'Draft the runway note.' };
  await PUT(w, { ...DEFAULT, model_ids: [MODEL] });
  let denied: any = await agentRun(w.env, { agent: a, ...step });
  assert.equal(denied.code, 'model_not_allowed', 'original model denial is checked before fallback');
  await PUT(w, { ...DEFAULT, model_ids: [original] });
  denied = await agentRun(w.env, { agent: a, ...step });
  assert.equal(denied.code, 'model_not_allowed', 'fallback model must also be allowed');
  assert.deepEqual(calls, []);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n, 0);
  await PUT(w, { ...DEFAULT, model_ids: [original, MODEL] });
  const allowed = await agentRun(w.env, { agent: a, ...step });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.deepEqual(calls, [MODEL]);
  w.db.prepare("UPDATE users SET subscription_tier = 'free' WHERE id = ?").run(EDITOR);
  const plan: any = await agentRun(w.env, { agent: a, ...step });
  assert.equal(plan.code, 'plan_required');
  assert.deepEqual(calls, [MODEL], 'saved lists cannot exceed the sponsor’s current plan');
});

test('/mcp HTTP context reaches the tool gate; member calls and allowed agent calls retain normal permissions', async () => {
  const w = world(); w.env.CUSTOM_MCP_ENABLED = 'true';
  const g = { integration_uid: SRV, tool: 'list_connections' };
  server(w, EDITOR, SRV, { approved: { list_connections: 'f'.repeat(64) }, drift: [] });
  const a = await add(w, cfo({ tool_grants: [g] }));
  const props: any = { userId: EDITOR, clientId: 'test', companies: [], grantedAt: Math.floor(Date.now() / 1000) };
  const request = async (agent: string | null) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };
    if (agent) Object.assign(headers, { 'X-Axal-Agent': agent, 'X-Axal-Integration': SRV });
    const response = await serveMcp(new Request('https://example.test/mcp', { method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: g.tool, arguments: {} } }) }), w.env, props, null, ['connectors:read']);
    assert.equal(response.status, 200);
    const body: any = await response.json();
    return JSON.parse(body.result.content[0].text);
  };
  await PUT(w, { ...DEFAULT, tool_grants: [] });
  assert.equal((await request(a.uid)).code, 'tool_not_allowed');
  assert.deepEqual(await request(null), { companies: [] });
  assert.equal((await request('not-this-agent')).code, 'agent_context_invalid');
  await PUT(w, { ...DEFAULT, tool_grants: [g] });
  assert.deepEqual(await request(a.uid), { companies: [] });
});
