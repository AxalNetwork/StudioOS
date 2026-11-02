/**
 * D4162 (#4162, H4 of #4137): HQ's AI policy and the kill switch. The real
 * migrated schema, both agent runtimes (`do` and `sdk`) from the engine's
 * fixture, and the mounted policy and platform-status routers.
 *
 *   · the kill switch refuses every admission path on both runtimes (a
 *     person's start, the sweep, `after`, a duty) with 403 platform_paused,
 *     and an open proposal stays decidable;
 *   · pausing needs a reason and PAUSE typed; resuming needs a reason;
 *   · every write needs a reason and writes H5's audit row, before and after;
 *   · a write tool is never allowed; area models are checked; caps keep the
 *     default under the maximum;
 *   · Super Admin only; the team banner reads for any member, with no email.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, AGENT, MEMBER, PROJECT, SPONSOR, world, type World } from './_agent_engine_fixture.ts';
import policyRoutes from '../src/routes/admin_ai_agents_policy.ts';
import platformStatusRoutes from '../src/routes/team_platform_status.ts';
import { decideRail } from '../src/services/railProposals.ts';
import { isReadTool, modelUnder, emptyPolicy, platformPaused } from '../src/services/agents/aiPolicy.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const MODEL_A = '@cf/openai/gpt-oss-120b';
const MODEL_B = '@cf/zai-org/glm-4.7-flash';
const P = { kind: 'project' as const, id: PROJECT };

function app(w: World) {
  w.db.exec(`INSERT OR IGNORE INTO super_admins (user_id) VALUES (${ADMIN})`);
  const a = new Hono<any>().route('/api/admin/ai-agents/policy', policyRoutes).route('/api/teams/platform-status', platformStatusRoutes);
  a.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return a;
}
async function call(w: World, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET))}`;
  const res = await app(w).request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
const audits = (w: World) => w.db.prepare('SELECT admin_user_id, action, area, subject, before_json, after_json, reason FROM ai_admin_audit ORDER BY id').all() as any[];
const POLICY = '/api/admin/ai-agents/policy';

// ─────────────────────────────────────────────────────────── the kill switch

for (const runtime of ['do', 'sdk'] as const) {
  test(`${runtime}: while the kill switch is on, every admission path is refused 403 platform_paused; resumed, the run is admitted`, async () => {
    const w = world({ runtime });
    try {
      w.agent(AGENT); w.task(200, AGENT);
      const on = await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Model provider incident', confirm: 'PAUSE' });
      assert.equal(on.status, 200, on.text);
      assert.equal(await platformPaused(w.env), true);
      for (const source of ['person', 'sweep', 'after', 'duty'] as const) {
        const r = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: source === 'person' ? SPONSOR : null, source });
        assert.deepEqual(!r.ok && [r.status, r.code], [403, 'platform_paused'], `${runtime} ${source}`);
      }
      assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n, 0, 'no run row was written');
      const off = await call(w, ADMIN, 'POST', `${POLICY}/resume`, { reason: 'Provider recovered' });
      assert.equal(off.status, 200, off.text);
      const r = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.equal(r.ok, true, JSON.stringify(r));
    } finally { w.close(); }
  });
}

test('an open proposal stays decidable while agents are paused', async () => {
  const w = world();
  try {
    w.agent(AGENT);
    w.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, kind, payload_json, agent_id)
      VALUES ('prop-open-4162', ?, 'build/plan', 'draft:build/plan', 'draft', '{"text":"A plan"}', ?)`).run(SPONSOR, AGENT);
    await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Model provider incident', confirm: 'PAUSE' });
    const decided = await decideRail(w.env, SPONSOR, 'prop-open-4162', 'accept');
    assert.equal(decided?.status, 'accepted');
  } finally { w.close(); }
});

test('pausing needs a reason and PAUSE typed; resuming needs a reason; each writes the audit with the admin, before and after', async () => {
  const w = world();
  try {
    app(w);
    assert.deepEqual([(await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Incident', confirm: 'pause' })).body.error], ['confirm_required'], 'PAUSE, exactly');
    assert.deepEqual([(await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Incident' })).body.error], ['confirm_required']);
    assert.deepEqual([(await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: '  ', confirm: 'PAUSE' })).body.error], ['reason_required']);
    assert.equal(await platformPaused(w.env), false, 'nothing was paused');
    assert.equal(audits(w).length, 0, 'and nothing was audited');
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Model provider incident', confirm: 'PAUSE' })).status, 200);
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Again', confirm: 'PAUSE' })).status, 409);
    assert.deepEqual([(await call(w, ADMIN, 'POST', `${POLICY}/resume`, {})).body.error], ['reason_required']);
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/resume`, { reason: 'Provider recovered' })).status, 200);
    const rows = audits(w);
    assert.deepEqual(rows.map((r) => [r.admin_user_id, r.action, r.area, r.subject, r.reason]),
      [[ADMIN, 'policy.pause', 'policy', 'platform', 'Model provider incident'], [ADMIN, 'policy.resume', 'policy', 'platform', 'Provider recovered']]);
    assert.deepEqual(JSON.parse(rows[0].before_json), { paused: false });
    assert.deepEqual(JSON.parse(rows[0].after_json), { paused: true });
  } finally { w.close(); }
});

test('the team banner: any signed-in member reads { paused, since, by_name }, the admin by name and never by email', async () => {
  const w = world();
  try {
    assert.equal((await call(w, null, 'GET', '/api/teams/platform-status')).status, 401);
    assert.deepEqual((await call(w, MEMBER, 'GET', '/api/teams/platform-status')).body, { paused: false, since: null, by_name: null });
    await call(w, ADMIN, 'POST', `${POLICY}/pause`, { reason: 'Model provider incident', confirm: 'PAUSE' });
    const r = await call(w, MEMBER, 'GET', '/api/teams/platform-status');
    assert.equal(r.body.paused, true);
    assert.equal(r.body.by_name, 'Ada Admin');
    assert.match(r.body.since, /^\d{4}-\d{2}-\d{2} /);
    assert.doesNotMatch(r.text, /@example\.test/, 'no email');
    assert.doesNotMatch(r.text, /incident/i, 'the reason stays HQ\'s');
  } finally { w.close(); }
});

// ─────────────────────────────────────────────────────────── the policy

test('Super Admin only: a founder and a plain admin are refused on every policy route, and signed out is 401', async () => {
  const w = world();
  try {
    w.db.exec("INSERT INTO users (id, uid, email, name, role, is_active) VALUES (2, 'u-plain', 'plain@example.test', 'Pia Plain', 'admin', 1)");
    const routes: Array<[string, string, unknown]> = [
      ['GET', POLICY, undefined],
      ['PUT', `${POLICY}/models`, { areas: {}, reason: 'x' }],
      ['POST', `${POLICY}/locks`, { model: MODEL_A, reason: 'x' }],
      ['DELETE', `${POLICY}/locks/${encodeURIComponent(MODEL_A)}`, { reason: 'x' }],
      ['PUT', `${POLICY}/caps`, { reason: 'x' }],
      ['PUT', `${POLICY}/tools`, { tools: [], reason: 'x' }],
      ['POST', `${POLICY}/pause`, { reason: 'x', confirm: 'PAUSE' }],
      ['POST', `${POLICY}/resume`, { reason: 'x' }],
    ];
    for (const [m, p, b] of routes) {
      assert.equal((await call(w, null, m, p, b)).status, 401, `${m} ${p}: signed out`);
      assert.equal((await call(w, SPONSOR, m, p, b)).status, 403, `${m} ${p}: a founder`);
      assert.equal((await call(w, 2, m, p, b)).status, 403, `${m} ${p}: an admin who is not a Super Admin`);
    }
    assert.equal(await platformPaused(w.env), false);
    assert.equal(audits(w).length, 0);
  } finally { w.close(); }
});

test('models, locks, caps and tools: each checked, each with a reason, each audited before and after; a write tool is never allowed', async () => {
  const w = world();
  try {
    app(w);
    const bad = await call(w, ADMIN, 'PUT', `${POLICY}/models`, { areas: { finance_ops: { suggested: [MODEL_A, MODEL_B, MODEL_A] } }, reason: 'Set' });
    assert.equal(bad.body.error, 'invalid_models', 'the same model twice');
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/models`, { areas: { astrology: { suggested: [MODEL_A] } }, reason: 'Set' })).body.error, 'invalid_area');
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/models`, { areas: { finance_ops: { suggested: [MODEL_A] } } })).body.error, 'reason_required');
    const set = await call(w, ADMIN, 'PUT', `${POLICY}/models`, { areas: { finance_ops: { suggested: [MODEL_A, MODEL_B], default: MODEL_B } }, reason: 'Finance runs on the smaller model' });
    assert.equal(set.status, 200, set.text);
    assert.deepEqual(set.body.policy.area_models, { finance_ops: { suggested: [MODEL_A, MODEL_B], default: MODEL_B } });

    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/locks`, { model: 'no/such-model', reason: 'x' })).body.error, 'unknown_model');
    const lock = await call(w, ADMIN, 'POST', `${POLICY}/locks`, { model: MODEL_A, reason: 'Pricing changed' });
    assert.equal(lock.status, 201);
    assert.deepEqual(lock.body.policy.locks.map((l: any) => [l.model, l.reason, l.locked_by.name]), [[MODEL_A, 'Pricing changed', 'Ada Admin']]);
    assert.match(lock.body.policy.locks[0].locked_at, /^\d{4}-/);
    // The swap at run time: a locked model fails over to its area's default; with that locked too, nothing runs.
    assert.deepEqual(modelUnder(lock.body.policy, MODEL_A, 'finance_ops'), { model: MODEL_B, swapped: true });
    assert.equal(modelUnder(lock.body.policy, MODEL_A, null), null);
    assert.deepEqual(modelUnder(emptyPolicy(), MODEL_A, null), { model: MODEL_A, swapped: false });
    assert.equal((await call(w, ADMIN, 'DELETE', `${POLICY}/locks/${encodeURIComponent(MODEL_A)}`, { reason: 'Pricing fixed' })).status, 200);

    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/caps`, { default_team_cap_microusd: 9_000_000, max_team_cap_microusd: 5_000_000, reason: 'Caps' })).body.error, 'default_over_max');
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/caps`, { per_run_ceiling_microusd: 0, reason: 'Caps' })).body.error, 'invalid_cap');
    const caps = await call(w, ADMIN, 'PUT', `${POLICY}/caps`, { platform_budget_microusd: 500_000_000, default_team_cap_microusd: 5_000_000, max_team_cap_microusd: 20_000_000, per_run_ceiling_microusd: 250_000, reason: 'Platform budget for November' });
    assert.equal(caps.status, 200, caps.text);
    assert.deepEqual([caps.body.policy.platform_budget_microusd, caps.body.policy.per_run_ceiling_microusd], [500_000_000, 250_000]);

    const write = await call(w, ADMIN, 'PUT', `${POLICY}/tools`, { tools: ['hubspot.read_contacts', 'hubspot.create_contact'], reason: 'Tools' });
    assert.deepEqual([write.status, write.body.error], [422, 'write_tool']);
    assert.match(write.body.message, /hubspot\.create_contact/);
    assert.deepEqual([isReadTool('hubspot.read_contacts'), isReadTool('gmail.send_message'), isReadTool('notion.update_page'), isReadTool('drive.list_files')], [true, false, false, true]);
    const tools = await call(w, ADMIN, 'PUT', `${POLICY}/tools`, { tools: ['notion.search_pages', 'hubspot.read_contacts'], reason: 'The read tools skills may ask for' });
    assert.deepEqual(tools.body.policy.read_tools, ['hubspot.read_contacts', 'notion.search_pages']);

    const g = await call(w, ADMIN, 'GET', POLICY);
    assert.equal(g.body.guardrails.length, 3);
    assert.ok(g.body.guardrails.every((x: any) => x.violations_30d === null && x.recorded === false && x.check), 'a count no check records is null, never 0');
    assert.doesNotMatch(g.text, /@example\.test/);

    assert.deepEqual(audits(w).map((r) => r.action), ['policy.models', 'policy.lock', 'policy.unlock', 'policy.caps', 'policy.tools']);
    const capsRow = audits(w).find((r) => r.action === 'policy.caps');
    assert.equal(JSON.parse(capsRow.before_json).platform_budget_microusd, null);
    assert.equal(JSON.parse(capsRow.after_json).platform_budget_microusd, 500_000_000);
  } finally { w.close(); }
});
