// D4424 (#4424): real SQLite identity/lifecycle boundaries; transport/consent wiring is a separate integration step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys, tableFromBaseline, addColumnsFrom } from './_baseline.mjs';
import { reserveOutsideAssistant, completeOutsideBinding, outsideAgentForGrant, revokeOutsideBinding } from '../src/services/agents/outsideAssistant.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const baseline = sql('schema_baseline.sql');
function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects']
    .map(t => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
    + 'CREATE TABLE ai_usage_logs (id INTEGER PRIMARY KEY, created_at TEXT);' + sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(sql('migrations/202611021724_team_agents_persona.sql'));
  db.exec(sql('migrations/202611041609_outside_assistant_bindings.sql'));
  db.exec(`INSERT INTO users(id,uid,email,name,role,subscription_tier,subscription_status) VALUES
    (1,'editor','editor@example.test','Editor','founder','growth','active'),
    (2,'member','member@example.test','Member','founder','growth','active'),
    (3,'stranger','stranger@example.test','Stranger','founder','growth','active');
    INSERT INTO company_profiles(id,uid,company_name) VALUES(11,'company-a','Company A'),(12,'company-b','Company B');
    INSERT INTO user_company_links(uid,user_id,company_id,role_in_company) VALUES
    ('owner',1,11,'Owner'),('member-link',2,11,'Member');
    INSERT INTO projects(id,uid,name,company_id) VALUES(11,'project-11','Unrelated project',12);`);
  const user: any = db.prepare('SELECT * FROM users WHERE id=1').get();
  const env: any = { DB, TEAM_AGENTS_ENABLED: 'true' };
  return { db, env, user };
}
const input = { companyUid: 'company-a', roleKey: 'cto', clientId: 'registered-client', clientName: 'Connected assistant' };
const rejected = (code: string) => (e: any) => { assert.equal(e.code, code); return true; };
async function connected(w: ReturnType<typeof world>) {
  const ids = await reserveOutsideAssistant(w.env, w.user, input);
  await completeOutsideBinding(w.env, w.user, { ...ids, clientId: input.clientId, grantId: 'provider-grant' });
  return { ...ids, clientId: input.clientId, grantId: 'provider-grant' };
}

test('reserves a distinct persona-free agent, inactive until the actual provider grant is bound', async () => {
  const w = world(); const ids = await reserveOutsideAssistant(w.env, w.user, input);
  const a: any = w.db.prepare('SELECT * FROM team_agents').get();
  assert.equal(a.source, 'mcp_client'); assert.equal(a.model_id, 'external'); assert.equal(a.persona_key, null);
  assert.equal(a.first_name, input.clientName); assert.equal(a.sponsor_user_id, 1); assert.equal(a.company_id, 11);
  assert.equal(a.status, 'paused'); assert.equal(a.paused_reason, 'awaiting_connection');
  await assert.rejects(outsideAgentForGrant(w.env, w.user, { ...ids, clientId: input.clientId, grantId: 'guessed' }), rejected('connection_revoked'));
  await completeOutsideBinding(w.env, w.user, { ...ids, clientId: input.clientId, grantId: 'provider-grant' });
  assert.equal((await outsideAgentForGrant(w.env, w.user, { ...ids, clientId: input.clientId, grantId: 'provider-grant' })).uid, ids.agentUid);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM team_agent_events').get().n, 1);
  w.db.close();
});

test('real company manage gate, flag, plan and role are checked before any row is created', async () => {
  const w = world();
  for (const id of [2, 3]) {
    await assert.rejects(reserveOutsideAssistant(w.env, w.db.prepare('SELECT * FROM users WHERE id=?').get(id) as any, input), rejected('not_manager'));
  }
  // A projects.id matching a company id must never confer that company's authority.
  await assert.rejects(reserveOutsideAssistant(w.env, w.user, { ...input, companyUid: 'company-b' }), rejected('not_manager'));
  await assert.rejects(reserveOutsideAssistant(w.env, w.user, { ...input, roleKey: 'made-up' }), rejected('invalid_role'));
  await assert.rejects(reserveOutsideAssistant({ ...w.env, TEAM_AGENTS_ENABLED: 'false' }, w.user, input), rejected('team_agents_off'));
  await assert.rejects(reserveOutsideAssistant(w.env, { ...w.user, subscription_tier: 'free' }, input), rejected('plan_required'));
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM team_agents').get().n, 0); w.db.close();
});

test('one live role remains unique, including pending connections, without partial binding or audit rows', async () => {
  const w = world(); await reserveOutsideAssistant(w.env, w.user, input);
  await assert.rejects(reserveOutsideAssistant(w.env, w.user, input), rejected('role_taken'));
  for (const t of ['team_agents', 'team_agent_mcp_bindings', 'team_agent_events']) assert.equal(w.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 1);
  w.db.close();
});

test('cannot complete another sponsor/client connection, or activate after company authority is lost', async () => {
  const w = world(); const ids = await reserveOutsideAssistant(w.env, w.user, input);
  const body = { ...ids, clientId: input.clientId, grantId: 'provider-grant' };
  await assert.rejects(completeOutsideBinding(w.env, { ...w.user, id: 2 }, body), rejected('connection_not_pending'));
  await assert.rejects(completeOutsideBinding(w.env, w.user, { ...body, clientId: 'impostor' }), rejected('connection_not_pending'));
  await assert.rejects(completeOutsideBinding(w.env, w.user, { ...body, grantId: '' }), rejected('invalid_connection'));
  w.db.exec('DELETE FROM user_company_links WHERE user_id=1');
  await assert.rejects(completeOutsideBinding(w.env, w.user, body), rejected('not_manager'));
  assert.equal(w.db.prepare('SELECT state FROM team_agent_mcp_bindings').get().state, 'pending'); w.db.close();
});

test('each request checks exact sponsor, client, provider grant and rejects API-key substitution', async () => {
  const w = world(); const principal = await connected(w);
  for (const patch of [{ clientId: 'impostor' }, { grantId: 'different-grant' }, { bindingUid: 'a'.repeat(32) }]) {
    await assert.rejects(outsideAgentForGrant(w.env, w.user, { ...principal, ...patch }), rejected('connection_revoked'));
  }
  await assert.rejects(outsideAgentForGrant(w.env, { ...w.user, id: 2 }, principal), rejected('connection_revoked'));
  await assert.rejects(outsideAgentForGrant(w.env, w.user, { ...principal, keyUid: 'key' }), rejected('invalid_connection'));
  await assert.rejects(outsideAgentForGrant(w.env, w.user, { ...principal, grantId: null }), rejected('invalid_connection'));
  w.db.close();
});

test('live status, source, sponsor, feature flag, plan and company authority are rechecked', async () => {
  const w = world(); const p = await connected(w);
  for (const change of ["status='paused'", "source='platform'", 'sponsor_user_id=2']) {
    w.db.exec(`UPDATE team_agents SET ${change}`);
    await assert.rejects(outsideAgentForGrant(w.env, w.user, p), rejected('agent_unavailable'));
    w.db.exec("UPDATE team_agents SET status='active',source='mcp_client',sponsor_user_id=1");
  }
  await assert.rejects(outsideAgentForGrant({ ...w.env, TEAM_AGENTS_ENABLED: 'false' }, w.user, p), rejected('team_agents_off'));
  await assert.rejects(outsideAgentForGrant(w.env, { ...w.user, subscription_tier: 'free' }, p), rejected('plan_required'));
  w.db.exec('DELETE FROM user_company_links WHERE user_id=1');
  await assert.rejects(outsideAgentForGrant(w.env, w.user, p), rejected('agent_unavailable')); w.db.close();
});

test('revocation closes D1 first, withdraws only pending proposals and retries provider failure safely', async () => {
  const w = world(); const p = await connected(w);
  const a: any = w.db.prepare('SELECT id FROM team_agents').get();
  w.db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,kind,payload_json,status,agent_id)
    VALUES(?,1,'Founder · Build','draft:build/plan','draft','{}',?,?)`).run('open', 'proposed', a.id);
  w.db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,kind,payload_json,status,agent_id)
    VALUES('closed',1,'Founder · Build','draft:build/plan','draft','{}','accepted',?)`).run(a.id);
  const calls: string[][] = [];
  await assert.rejects(revokeOutsideBinding(w.env, w.user, p.bindingUid, async (g, u) => {
    calls.push([g,u]);
    assert.equal(w.db.prepare('SELECT status FROM team_agents').get().status, 'removed');
    assert.equal(w.db.prepare('SELECT state FROM team_agent_mcp_bindings').get().state, 'revoked');
    throw new Error('provider unavailable');
  }), /provider unavailable/);
  await assert.rejects(outsideAgentForGrant(w.env, w.user, p), rejected('connection_revoked'));
  await assert.rejects(completeOutsideBinding(w.env, w.user, p), rejected('connection_not_pending'));
  await revokeOutsideBinding(w.env, w.user, p.bindingUid, async (g,u) => { calls.push([g,u]); });
  assert.deepEqual(calls, [['provider-grant','1'], ['provider-grant','1']]);
  assert.equal(w.db.prepare("SELECT status FROM ai_rail_proposals WHERE uid='open'").get().status, 'withdrawn');
  assert.equal(w.db.prepare("SELECT status FROM ai_rail_proposals WHERE uid='closed'").get().status, 'accepted');
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM team_agent_events WHERE kind='removed'").get().n, 1);
  w.db.close();
});

test('a stranger cannot revoke; sponsor can cancel pending consent even with the feature off and no plan/access', async () => {
  const w = world(); const p = await reserveOutsideAssistant(w.env, w.user, input);
  let calls = 0; const provider = async () => { calls++; };
  await assert.rejects(revokeOutsideBinding(w.env, { ...w.user, id: 3 }, p.bindingUid, provider), rejected('not_manager'));
  w.db.exec('DELETE FROM user_company_links WHERE user_id=1');
  await revokeOutsideBinding({ ...w.env, TEAM_AGENTS_ENABLED: 'false' }, { ...w.user, subscription_tier: 'free' }, p.bindingUid, provider);
  assert.equal(calls, 0); assert.equal(w.db.prepare('SELECT status FROM team_agents').get().status, 'removed'); w.db.close();
});

test('migration preserves platform defaults and only a company manager may remove another sponsor’s agent', async () => {
  const w = world();
  w.db.exec(`INSERT INTO team_agents(uid,scope_kind,company_id,role_key,model_id,sponsor_user_id,monthly_cap_microusd,created_by)
    VALUES('old-agent','company',11,'cfo','platform-model',1,1000,1);`);
  assert.equal(w.db.prepare("SELECT source FROM team_agents WHERE uid='old-agent'").get().source, 'platform');
  const p = await connected(w);
  w.db.exec("UPDATE user_company_links SET role_in_company='Admin' WHERE user_id=2 AND company_id=11");
  let called: string[] | null = null;
  await revokeOutsideBinding(w.env, { ...w.user, id: 2 }, p.bindingUid, async (g,u) => { called = [g,u]; });
  assert.deepEqual(called, ['provider-grant','1']);
  assert.equal(w.db.prepare("SELECT status FROM team_agents WHERE uid='old-agent'").get().status, 'active');
  assert.equal(w.db.prepare("SELECT actor_user_id FROM team_agent_events WHERE kind='removed'").get().actor_user_id, 2);
  // Removal frees only the removed role and a new connection has a new identity.
  const next = await reserveOutsideAssistant(w.env, w.user, input);
  assert.notEqual(next.bindingUid, p.bindingUid); assert.notEqual(next.agentUid, p.agentUid); w.db.close();
});

test('a binding failure rolls back its agent and audit rather than reserving a stranded role', async () => {
  const w = world();
  w.db.exec("CREATE TRIGGER reject_binding BEFORE INSERT ON team_agent_mcp_bindings BEGIN SELECT RAISE(ABORT,'binding unavailable'); END;");
  await assert.rejects(reserveOutsideAssistant(w.env, w.user, input), /binding unavailable/);
  for (const t of ['team_agents', 'team_agent_mcp_bindings', 'team_agent_events']) assert.equal(w.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0);
  w.db.close();
});
