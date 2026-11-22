/**
 * D8070 (#8070): capability RBAC for agents, on the real migrated schema.
 *
 *   · the catalogue the migration seeds is the service's, and the five reserved names are never grantable:
 *     refused at check time enforced or not, refused by the grant route, left out of every wildcard;
 *   · each guarded call site refuses with the capability's code once HQ enforces: run admission (both
 *     runtimes), the compute request, the publisher, a skill's tool at attach;
 *   · the matrix routes are Super Admin only, take a reason, write the audit row, and bump the sponsor's
 *     authz revision on every grant and revoke;
 *   · a schema without the migration reads as not enforced; any other read failure refuses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { grantWriteBar } from './_write_bar_session.mjs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { ADMIN, AGENT, MEMBER, PROJECT, SPONSOR, hex, world, type World } from './_agent_engine_fixture.ts';
import { computeWorld } from './_compute_world_4557.ts';
import policyRoutes from '../src/routes/admin_ai_agents_policy.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  CAPABILITY_CATALOGUE, MODULE_CAPABILITY, RESERVED_CAPABILITIES, capabilityOf, expandCapabilities, moduleCapability,
  readCapabilityPolicy, requireCapability, toolCapability,
} from '../src/services/agentCapabilities.ts';
import { MODULES } from '../src/services/agents/catalogue.ts';
import { createComputeRequest } from '../src/services/agents/computeBridge.ts';
import { executeAgentPublication } from '../src/services/agents/agentPublisherBroker.ts';
import { attachCheck } from '../src/services/agents/skillLinks.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const POLICY = '/api/admin/ai-agents/policy';
const RESERVED = ['code.merge', 'deploy.production', 'cloud.write', 'finance.execute', 'email.send'];

// The shared template copies DDL only, so the migration's seed rows are put back here from the file itself.
const MIGRATION = readFileSync(new URL('../sql/migrations/202611211833_8070_agent_capabilities.sql', import.meta.url), 'utf8');
const SEED = /INSERT OR IGNORE INTO capability_catalog[\s\S]*?;\n/.exec(MIGRATION)![0];
function seeded<T extends World>(w: T): T {
  w.db.exec(SEED);
  w.db.exec('INSERT OR IGNORE INTO ai_agent_policy (id) VALUES (1)');
  return w;
}
const enforce = (w: World, on = true) => w.db.prepare('UPDATE ai_agent_policy SET capabilities_enforced = ? WHERE id = 1').run(on ? 1 : 0);
const grant = (w: World, agentId: number, name: string) => w.db.prepare(
  "INSERT INTO agent_capabilities (agent_id, capability, granted_by, grant_reason) VALUES (?, ?, ?, 'test')").run(agentId, name, ADMIN);
const revoke = (w: World, agentId: number, name: string) => w.db.prepare(
  "UPDATE agent_capabilities SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ?, revoke_reason = 'test' WHERE agent_id = ? AND capability = ? AND revoked_at IS NULL").run(ADMIN, agentId, name);
const revision = (w: World, member: number) => (w.db.prepare('SELECT revision FROM agent_authz_revisions WHERE member_id = ?').get(member) as any)?.revision ?? 1;

function app(w: World) {
  w.db.exec(`INSERT OR IGNORE INTO super_admins (user_id) VALUES (${ADMIN})`);
  grantWriteBar(w.db, ADMIN);
  const a = new Hono<any>().route(POLICY, policyRoutes);
  a.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return a;
}
async function call(w: World, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, ...(who === ADMIN ? { jti: `write-bar-${ADMIN}` } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const res = await app(w).request(path, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

// ── The catalogue and the reserved names ────────────────────────────────────────────────────────────────────────

test('the migration seeds exactly the service catalogue; the five reserved names are the only ungrantable ones', () => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  try {
    const rows = db.prepare('SELECT name, domain, action, grantable FROM capability_catalog ORDER BY name').all() as any[];
    assert.deepEqual(rows.map((r) => [r.name, r.domain, r.action, r.grantable === 1]),
      [...CAPABILITY_CATALOGUE].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.name, c.domain, c.action, c.grantable]));
    assert.deepEqual([...RESERVED_CAPABILITIES].sort(), [...RESERVED].sort());
    assert.deepEqual(rows.filter((r) => r.grantable === 0).map((r) => r.name).sort(), [...RESERVED].sort());
    const policy = db.prepare('SELECT capabilities_enforced, capability_ceiling_json FROM ai_agent_policy WHERE id = 1').get() as any;
    assert.deepEqual([policy.capabilities_enforced, policy.capability_ceiling_json], [0, null], 'the start: not enforced, every grantable name offered');
  } finally { db.close(); }
});

test('every task module maps to a grantable domain action, and tools map by connector', () => {
  for (const m of MODULES) {
    const name = moduleCapability(m.key);
    assert.ok(name && capabilityOf(name)?.grantable, `${m.key} → ${name}`);
  }
  assert.equal(Object.keys(MODULE_CAPABILITY).length, MODULES.length);
  assert.equal(moduleCapability('no-such-module'), null);
  assert.equal(moduleCapability('constructor'), null, 'an inherited key is not a module');
  assert.equal(toolCapability('hubspot.read_contacts'), 'relationships.read');
  assert.equal(toolCapability('mercury.list_accounts'), 'finance.read');
  assert.equal(toolCapability('notes.read'), null, 'a connector that declares no capability has none');
});

test('a reserved name is refused at check time whether or not HQ enforces, and no wildcard contains one', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT);
    for (const enforced of [false, true]) {
      enforce(w, enforced);
      for (const name of RESERVED) {
        const r = await requireCapability(w.env, { id: AGENT }, name);
        assert.deepEqual(!r.ok && [r.status, r.code, r.capability], [403, 'capability_ungrantable', name], `${name} enforced=${enforced}`);
      }
      const unknown = await requireCapability(w.env, { id: AGENT }, 'web.crawl');
      assert.equal(!unknown.ok && unknown.code, 'capability_unknown');
      const undeclared = await requireCapability(w.env, { id: AGENT }, null);
      assert.equal(undeclared.ok ? 'ok' : undeclared.code, enforced ? 'capability_unknown' : 'ok', 'an undeclared action waits for enforcement');
    }
    for (const name of RESERVED) assert.deepEqual(expandCapabilities([name]), { ok: false, code: 'capability_ungrantable', capability: name });
    assert.deepEqual(expandCapabilities(['email.*']), { ok: true, value: ['email.draft', 'email.read'] });
    assert.deepEqual(expandCapabilities(['code.*']), { ok: true, value: ['code.branch', 'code.commit', 'code.pr', 'code.read'] });
    assert.deepEqual(expandCapabilities(['research.*', 'company.read', 'fund.read', 'web.search', 'research.read']),
      { ok: true, value: ['company.read', 'fund.read', 'research.read', 'research.write', 'web.search'] });
    assert.equal((expandCapabilities(['nothing.*']) as any).code, 'capability_unknown');
  } finally { w.close(); }
});

test('the grant route refuses each reserved name 403 capability_ungrantable and writes nothing', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT);
    for (const name of RESERVED) {
      const r = await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: hex(AGENT, 'b'), capabilities: [name], reason: 'Try it' });
      assert.deepEqual([r.status, r.body.error], [403, 'capability_ungrantable'], name);
    }
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_capabilities').get() as any).n, 0);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_admin_audit').get() as any).n, 0);
    // The table refuses one too, whoever writes it: the name exists, but a CHECK of the route is the guard; the
    // catalogue's grantable = 0 is what every check reads.
    assert.equal(capabilityOf('email.send')?.grantable, false);
  } finally { w.close(); }
});

// ── Run admission ───────────────────────────────────────────────────────────────────────────────────────────────

for (const runtime of ['do', 'sdk'] as const) {
  test(`${runtime}: run admission needs the module's capability once HQ enforces`, async () => {
    const w = seeded(world({ runtime }));
    try {
      w.agent(AGENT); w.task(200, AGENT);
      enforce(w);
      const refused = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.deepEqual(!refused.ok && [refused.status, refused.code], [403, 'capability_missing']);
      assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_task_runs').get() as any).n, 0, 'no run row was written');
      // Outside the ceiling, a grant does not help.
      grant(w, AGENT, 'company.write');
      w.db.prepare(`UPDATE ai_agent_policy SET capability_ceiling_json = '["research.read"]' WHERE id = 1`).run();
      const capped = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'sweep' });
      assert.deepEqual(!capped.ok && [capped.status, capped.code], [403, 'capability_not_offered']);
      w.db.prepare('UPDATE ai_agent_policy SET capability_ceiling_json = NULL WHERE id = 1').run();
      const admitted = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
      assert.equal(admitted.ok, true, JSON.stringify(admitted));
    } finally { w.close(); }
  });
}

test('a revoked capability refuses the next run; not enforced, an agent with no grants still runs', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT); w.task(200, AGENT); w.task(201, AGENT);
    const free = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.equal(free.ok, true, 'until HQ enforces, agents already working keep working');
    w.db.prepare("UPDATE agent_task_runs SET status = 'done'").run();
    enforce(w); grant(w, AGENT, 'company.write'); revoke(w, AGENT, 'company.write');
    const r = await w.runtime.admit(P, { agentId: AGENT, taskId: 201, by: SPONSOR, source: 'person' });
    assert.deepEqual(!r.ok && r.code, 'capability_missing');
  } finally { w.close(); }
});

// ── Compute, publisher, skills ──────────────────────────────────────────────────────────────────────────────────

test('a compute request needs cloud.read once HQ enforces', async () => {
  const w = seeded(await computeWorld());
  try {
    enforce(w);
    const input = { workload: 'python', operation: 'sum', inputs: [{ name: 'values.json', bytes: 7 }] };
    const thrown = await createComputeRequest(w.env, w.user(), 201, input).then(() => null, (e) => e);
    assert.ok(thrown instanceof Response, 'refused with a response');
    assert.deepEqual([thrown.status, (await thrown.json()).code], [403, 'capability_missing']);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM agent_compute_requests').get() as any).n, 0);
    grant(w, AGENT, 'cloud.read');
    const ok = await createComputeRequest(w.env, w.user(), 201, input);
    assert.equal(ok.status, 'draft');
  } finally { w.close(); }
});

test('the publisher needs code.pr for the agent its provenance names, before anything is read or written', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT); enforce(w);
    const scope = { tenant_id: 1, company_id: 2, project_id: 3 };
    const intent: any = {
      version: 1, ...scope, installation_uid: 'f'.repeat(32), repository_full_name: 'venture/example', target_ref: 'refs/heads/main',
      base_sha: 'a'.repeat(40), patch_digest: 'sha256:' + 'e'.repeat(64), files: [{ path: 'src/x.ts', change: 'modified' }],
      provenance: { agent_id: `agent:${AGENT}`, task_id: 'task-1', run_uuid: '11111111-2222-4333-8444-555555555555', attempt: 1,
        image_digest: 'sha256:' + 'c'.repeat(64), evidence_digest: 'sha256:' + 'd'.repeat(64) },
      agent_checks: { tests: 'passed', scan: 'passed' }, idempotency_key: 'publish:task-1:1', summary: 'A change.',
    };
    let preflights = 0;
    const ports: any = { authorize: async () => true, preflight: async () => { preflights++; throw new Error('not reached'); },
      appJwt: async () => 'x', fetch: async () => { throw new Error('no network'); }, now: () => 0 };
    const r = await executeAgentPublication(w.env, scope, intent, 'b'.repeat(40), 'on', ports);
    assert.deepEqual(r, { ok: false, code: 'capability_missing', retryable: false, capability: 'code.pr' });
    const other = await executeAgentPublication(w.env, scope, { ...intent, provenance: { ...intent.provenance, agent_id: 'robot' } }, 'b'.repeat(40), 'on', ports);
    assert.equal((other as any).code, 'capability_missing', 'an agent the provenance does not name holds nothing');
    grant(w, AGENT, 'code.pr');
    const past = await executeAgentPublication(w.env, scope, intent, 'b'.repeat(40), 'on', ports);
    assert.notEqual((past as any).code, 'capability_missing', 'with code.pr the broker goes on to its next gate');
    assert.equal(preflights, 0);
  } finally { w.close(); }
});

test("a skill's tools each need their declared capability at attach once HQ enforces", async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT);
    const grants = [{ integration_uid: 'c'.repeat(32), tool: 'hubspot.read_contacts' }];
    w.db.prepare('UPDATE team_agents SET tool_grants_json = ? WHERE id = ?').run(JSON.stringify(grants), AGENT);
    w.db.prepare(`INSERT INTO agent_skills (id, uid, scope, slug, name, purpose, steps_json, allowed_tools_json, output_kind, status, current_version, created_by)
      VALUES (1, ?, 'hq', 'brief', 'Brief', 'Write the brief.', '["Read the contacts."]', '["hubspot.read_contacts"]', 'draft', 'published', 1, ?)`).run('a'.repeat(32), SPONSOR);
    w.db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
      VALUES (1, 1, '---', 'Brief', 'Write the brief.', '["Read."]', '["hubspot.read_contacts"]', 'draft', '[]', '["ceo"]', ?)`).run(SPONSOR);
    const a = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
    const skill = w.db.prepare('SELECT * FROM agent_skills WHERE id = 1').get() as any;
    assert.equal(await attachCheck(w.env, a, skill, 1, null), null, 'not enforced: attaches as before');
    enforce(w);
    assert.deepEqual(await attachCheck(w.env, a, skill, 1, null), { code: 'capability_missing',
      tool: { key: 'hubspot.read_contacts', label: 'hubspot.read_contacts' }, capability: { code: 'capability_missing', name: 'relationships.read' } });
    assert.equal((await attachCheck(w.env, { ...a, id: null }, skill, 1, null))?.code, 'capability_missing', 'an agent not yet added holds nothing');
    grant(w, AGENT, 'relationships.read');
    assert.equal(await attachCheck(w.env, a, skill, 1, null), null);
  } finally { w.close(); }
});

// ── The matrix routes ───────────────────────────────────────────────────────────────────────────────────────────

test('the matrix routes are Super Admin only', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT);
    for (const [method, path] of [['GET', '/capabilities'], ['POST', '/capabilities/grant'], ['POST', '/capabilities/revoke'],
      ['PUT', '/capabilities/ceiling'], ['PUT', '/capabilities/enforcement']] as const) {
      const r = await call(w, MEMBER, method, `${POLICY}${path}`, method === 'GET' ? undefined : { reason: 'x' });
      assert.equal(r.status, 403, `${method} ${path}`);
    }
  } finally { w.close(); }
});

test('a wildcard grant writes one row per name, its audit, and bumps the sponsor revision; a revoke does the same', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT);
    const uid = hex(AGENT, 'b');
    const before = revision(w, SPONSOR);
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: uid, capabilities: ['research.*'], reason: '' })).body.error, 'reason_required');
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: uid, capabilities: ['research.*'], reason: 'x'.repeat(201) })).body.error, 'reason_required');
    const g = await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: uid, capabilities: ['research.*', 'web.search'], reason: 'Market research agent' });
    assert.equal(g.status, 201, g.text);
    const live = w.db.prepare('SELECT capability, granted_by, grant_reason FROM agent_capabilities WHERE agent_id = ? AND revoked_at IS NULL ORDER BY capability').all(AGENT) as any[];
    assert.deepEqual(live.map((r) => [r.capability, r.granted_by, r.grant_reason]),
      [['research.read', ADMIN, 'Market research agent'], ['research.write', ADMIN, 'Market research agent'], ['web.search', ADMIN, 'Market research agent']]);
    assert.ok(revision(w, SPONSOR) > before, 'a grant bumps the sponsor');
    const audit = w.db.prepare('SELECT action, area, subject, before_json, after_json, reason FROM ai_admin_audit ORDER BY id').all() as any[];
    assert.deepEqual(audit.map((a) => [a.action, a.area, a.subject, JSON.parse(a.before_json), JSON.parse(a.after_json), a.reason]),
      [['policy.capability_grant', 'policy', `agent:${uid}`, [], ['research.read', 'research.write', 'web.search'], 'Market research agent']]);
    const cell = g.body.agents.find((x: any) => x.uid === uid).cells.find((x: any) => x.capability === 'web.search');
    assert.equal(cell.granted, true);
    // The same grant again changes nothing and writes no audit.
    await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: uid, capabilities: ['web.search'], reason: 'Again' });
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM ai_admin_audit').get() as any).n, 1);

    const mid = revision(w, SPONSOR);
    const r = await call(w, ADMIN, 'POST', `${POLICY}/capabilities/revoke`, { agent_uid: uid, capability: 'web.search', reason: 'Unused for 30 days' });
    assert.equal(r.status, 200, r.text);
    assert.ok(revision(w, SPONSOR) > mid, 'a revoke bumps the sponsor');
    const row = w.db.prepare("SELECT revoked_by, revoke_reason FROM agent_capabilities WHERE agent_id = ? AND capability = 'web.search'").get(AGENT) as any;
    assert.deepEqual([row.revoked_by, row.revoke_reason], [ADMIN, 'Unused for 30 days']);
    const revokedCell = r.body.agents.find((x: any) => x.uid === uid).cells.find((x: any) => x.capability === 'web.search');
    assert.deepEqual([revokedCell.granted, revokedCell.revoke_reason], [false, 'Unused for 30 days']);
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/capabilities/revoke`, { agent_uid: uid, capability: 'web.search', reason: 'Twice' })).body.error, 'not_granted');
    assert.equal((await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: hex(999, 'b'), capabilities: ['web.search'], reason: 'x' })).status, 404);
    const last = w.db.prepare('SELECT action, before_json, after_json FROM ai_admin_audit ORDER BY id DESC LIMIT 1').get() as any;
    assert.deepEqual([last.action, JSON.parse(last.before_json), JSON.parse(last.after_json)],
      ['policy.capability_revoke', ['research.read', 'research.write', 'web.search'], ['research.read', 'research.write']]);
  } finally { w.close(); }
});

test('the ceiling and the enforcement switch are audited; a grant outside the ceiling is refused', async () => {
  const w = seeded(world());
  try {
    w.agent(AGENT);
    const c = await call(w, ADMIN, 'PUT', `${POLICY}/capabilities/ceiling`, { capabilities: ['research.*'], reason: 'This month' });
    assert.equal(c.status, 200, c.text);
    assert.deepEqual(c.body.policy, { enforced: false, ceiling: ['research.read', 'research.write'] });
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/capabilities/ceiling`, { capabilities: ['email.send'], reason: 'x' })).body.error, 'capability_ungrantable');
    const out = await call(w, ADMIN, 'POST', `${POLICY}/capabilities/grant`, { agent_uid: hex(AGENT, 'b'), capabilities: ['web.search'], reason: 'x' });
    assert.deepEqual([out.status, out.body.error], [403, 'capability_not_offered']);
    const on = await call(w, ADMIN, 'PUT', `${POLICY}/capabilities/enforcement`, { enforced: true, reason: 'Sets granted' });
    assert.equal(on.status, 200, on.text);
    assert.equal((await readCapabilityPolicy(w.env))?.enforced, true);
    assert.equal((await call(w, ADMIN, 'PUT', `${POLICY}/capabilities/enforcement`, { enforced: true, reason: 'Again' })).status, 409);
    const audit = w.db.prepare('SELECT action, before_json, after_json FROM ai_admin_audit ORDER BY id').all() as any[];
    assert.deepEqual(audit.map((a) => [a.action, JSON.parse(a.before_json), JSON.parse(a.after_json)]), [
      ['policy.capability_ceiling', null, ['research.read', 'research.write']],
      ['policy.capability_enforcement', { enforced: false }, { enforced: true }],
    ]);
  } finally { w.close(); }
});

// ── Reading the policy ──────────────────────────────────────────────────────────────────────────────────────────

test('a schema without the migration reads as not enforced; any other failure refuses capability_unreadable', async () => {
  const failing = (message: string) => ({ DB: { prepare: () => ({ bind() { return this; }, first: async () => { throw new Error(message); } }) } }) as any;
  assert.deepEqual(await readCapabilityPolicy(failing('D1_ERROR: no such column: capabilities_enforced')), { enforced: false, ceiling: null });
  assert.deepEqual(await readCapabilityPolicy(failing('D1_ERROR: no such table: ai_agent_policy')), { enforced: false, ceiling: null });
  assert.equal(await readCapabilityPolicy(failing('D1_ERROR: network connection lost')), null);
  const r = await requireCapability(failing('D1_ERROR: network connection lost'), { id: 1 }, 'research.read');
  assert.deepEqual(!r.ok && [r.status, r.code], [503, 'capability_unreadable']);
});
