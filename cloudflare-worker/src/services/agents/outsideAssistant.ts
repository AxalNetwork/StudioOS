/** D4424 (#4424): isolated outside-assistant identity and revocation primitives; no route enables them yet. */
import type { Env, User } from '../../types';
import { userMeetsTier } from '../../middleware/requireTier';
import { isAdmin } from '../../routes/_t13t14t15_helpers';
import { roleOf } from './catalogue';
import { canManage, loadScope, scopeOfAgent, type AgentRow } from './teams';

/** Existing positive cap constraint only; never display or charge this as a budget. */
const EXTERNAL_CAP_SENTINEL = 1;
const UID = /^[a-f0-9]{32}$/;
type OutsideRow = AgentRow & { source: 'mcp_client' | 'platform' };
type Binding = { uid: string; agent_id: number; sponsor_user_id: number; client_id: string; grant_id: string | null; state: 'pending' | 'active' | 'revoked' };

export class OutsideAssistantRefused extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const refuse = (code: string, message: string): never => { throw new OutsideAssistantRefused(code, message); };
const enabled = (env: Env) => { if (env.TEAM_AGENTS_ENABLED !== 'true') refuse('team_agents_off', 'AI agents are not switched on for this team.'); };
const plan = (user: User) => {
  if (!isAdmin(user) && !(user.role === 'founder' && userMeetsTier(user, 'growth'))) {
    refuse('plan_required', 'Agents come with a paid Founder plan.');
  }
};
const bindingByUid = (env: Env, uid: string) => UID.test(uid)
  ? env.DB.prepare('SELECT * FROM team_agent_mcp_bindings WHERE uid = ?').bind(uid).first<Binding>()
  : Promise.resolve(null);

/** Trusted consent handler only. Reserve the role before authorization; pending records cannot call tools. */
export async function reserveOutsideAssistant(env: Env, user: User, input: {
  companyUid: string; roleKey: string; clientId: string; clientName: string;
}): Promise<{ bindingUid: string; agentUid: string }> {
  enabled(env); plan(user);
  const scope = await loadScope(env, 'company', input.companyUid);
  if (!scope || !(await canManage(env, scope, user))) refuse('not_manager', 'Only this company’s editors can connect an outside assistant.');
  if (!roleOf(input.roleKey)) refuse('invalid_role', 'Choose one of the team’s roles.');
  const name = typeof input.clientName === 'string' ? input.clientName.trim() : '';
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) refuse('invalid_name', 'The connected app needs a name of up to 40 characters.');
  if (!input.clientId || input.clientId.length > 2048) refuse('invalid_client', 'This connected app is not available.');
  const agentUid = crypto.randomUUID().replaceAll('-', '');
  const bindingUid = crypto.randomUUID().replaceAll('-', '');
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO team_agents
        (uid, scope_kind, company_id, role_key, persona_key, first_name, model_id, sponsor_user_id,
         monthly_cap_microusd, status, paused_reason, created_by, source)
        VALUES (?, 'company', ?, ?, NULL, ?, 'external', ?, ?, 'paused', 'awaiting_connection', ?, 'mcp_client')`)
        .bind(agentUid, scope!.id, input.roleKey, name, user.id, EXTERNAL_CAP_SENTINEL, user.id),
      env.DB.prepare(`INSERT INTO team_agent_mcp_bindings (uid, agent_id, sponsor_user_id, client_id)
        SELECT ?, id, ?, ? FROM team_agents WHERE uid = ?`)
        .bind(bindingUid, user.id, input.clientId, agentUid),
      env.DB.prepare(`INSERT INTO team_agent_events (agent_id, actor_user_id, kind, detail_json)
        SELECT id, ?, 'added', ? FROM team_agents WHERE uid = ?`)
        .bind(user.id, JSON.stringify({ source: 'mcp_client', connection: 'pending' }), agentUid),
    ]);
  } catch (e) {
    if (/UNIQUE.*team_agents/i.test(String((e as Error).message))) refuse('role_taken', 'This team already has an agent in that role.');
    throw e;
  }
  return { bindingUid, agentUid };
}

/** Resolve the provider's actual grant by trusted consent metadata, never from browser/tool arguments. */
export async function completeOutsideBinding(env: Env, user: User, input: { bindingUid: string; clientId: string; grantId: string }): Promise<void> {
  enabled(env); plan(user);
  const b = await bindingByUid(env, input.bindingUid);
  if (!b || b.state !== 'pending' || b.sponsor_user_id !== user.id || b.client_id !== input.clientId) {
    refuse('connection_not_pending', 'This connection is no longer waiting for approval.');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.grantId)) refuse('invalid_connection', 'This connection could not be verified.');
  const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(b!.agent_id).first<OutsideRow>();
  const s = a && await scopeOfAgent(env, a);
  if (!a || a.source !== 'mcp_client' || a.status !== 'paused' || a.paused_reason !== 'awaiting_connection'
      || !s || !(await canManage(env, s, user))) refuse('not_manager', 'This company connection is no longer available.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE team_agent_mcp_bindings SET grant_id = ?, state = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE uid = ? AND state = 'pending'`).bind(input.grantId, b!.uid),
    env.DB.prepare(`UPDATE team_agents SET status = 'active', paused_reason = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'paused' AND paused_reason = 'awaiting_connection'
        AND EXISTS (SELECT 1 FROM team_agent_mcp_bindings WHERE uid = ? AND state = 'active')`).bind(a!.id, b!.uid),
  ]);
}

/** Before each call, after grantUser. The principal comes from verified encrypted props, not tool arguments. */
export async function outsideAgentForGrant(env: Env, user: User, input: {
  bindingUid: string; clientId: string; grantId: string | null; keyUid?: string;
}): Promise<OutsideRow> {
  enabled(env); plan(user);
  if (input.keyUid || !input.grantId) refuse('invalid_connection', 'Use the connected outside assistant.');
  const b = await bindingByUid(env, input.bindingUid);
  if (!b || b.state !== 'active' || b.sponsor_user_id !== user.id || b.client_id !== input.clientId || b.grant_id !== input.grantId) {
    refuse('connection_revoked', 'This outside assistant connection is no longer active.');
  }
  const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(b!.agent_id).first<OutsideRow>();
  const s = a && await scopeOfAgent(env, a);
  if (!a || a.source !== 'mcp_client' || a.sponsor_user_id !== user.id || a.status !== 'active'
      || !s || !(await canManage(env, s, user))) refuse('agent_unavailable', 'This outside assistant no longer has access to the team.');
  return a!;
}

/** Invalidate D1 before the provider; repeat calls retry provider failure without restoring access. */
export async function revokeOutsideBinding(env: Env, user: User, bindingUid: string,
  revokeGrant: (grantId: string, userId: string) => Promise<void>): Promise<void> {
  // Revocation deliberately works with the feature off or sponsor plan/access lost.
  const b = await bindingByUid(env, bindingUid);
  if (!b) refuse('not_found', 'There is no such connected app.');
  const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(b!.agent_id).first<OutsideRow>();
  const s = a && await scopeOfAgent(env, a);
  if (b!.sponsor_user_id !== user.id && !(s && await canManage(env, s, user))) refuse('not_manager', 'Only its sponsor or a team editor can remove this connected app.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE team_agent_mcp_bindings SET state = 'revoked', revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP WHERE uid = ?`).bind(b!.uid),
    env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP
      WHERE agent_id = ? AND status = 'proposed'`).bind(b!.agent_id),
    env.DB.prepare(`INSERT INTO team_agent_events (agent_id, actor_user_id, kind, detail_json)
      SELECT id, ?, 'removed', '{"source":"mcp_client"}' FROM team_agents WHERE id = ? AND status <> 'removed'`).bind(user.id, b!.agent_id),
    env.DB.prepare(`UPDATE team_agents SET status = 'removed', paused_reason = NULL,
      removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(b!.agent_id),
  ]);
  if (b!.grant_id) await revokeGrant(b!.grant_id, String(b!.sponsor_user_id));
}
