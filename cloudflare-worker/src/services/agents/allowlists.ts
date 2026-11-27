/** D4422 (#4422): inherited Team model/tool restrictions, checked at admission and again at use. */
import type { Env, User } from '../../types';
import { configOf, customMcpEnabled, grantableTools, isConnectionUid } from '../../integrations/customMcp';
import type { IntegrationRow } from '../../integrations/registry';
import { planOk } from './modelOffers';
import { canManage, agentByUid, loadScope, scopeOfAgent, type Scope } from './teams';
import type { ToolGrant } from './agentTools';

export type Allowlists = { model_ids: string[] | null; tool_grants: ToolGrant[] | null };
const defaults = (): Allowlists => ({ model_ids: null, tool_grants: null });
const key = (g: ToolGrant) => JSON.stringify([g.integration_uid, g.tool]);

/** Null means today's plan/sponsor defaults. Empty arrays deliberately allow nothing. */
export function parseAllowlists(v: unknown): Allowlists | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  if (b.model_ids !== null && (!Array.isArray(b.model_ids) || b.model_ids.length > 200 || b.model_ids.some((id) => typeof id !== 'string' || !id || id.length > 200))) return null;
  if (b.tool_grants !== null && (!Array.isArray(b.tool_grants) || b.tool_grants.length > 500 || b.tool_grants.some((g) => !g || typeof g !== 'object' || !isConnectionUid(g.integration_uid) || typeof g.tool !== 'string' || !/^[A-Za-z0-9_.\-/]{1,64}$/.test(g.tool)))) return null;
  return {
    model_ids: b.model_ids === null ? null : [...new Set(b.model_ids as string[])].sort(),
    tool_grants: b.tool_grants === null ? null : [...new Map((b.tool_grants as ToolGrant[]).map((g) => [key(g), { integration_uid: g.integration_uid, tool: g.tool }])).values()].sort((a, z) => key(a).localeCompare(key(z))),
  };
}

export async function effectiveAllowlistScope(env: Env, s: Scope): Promise<Scope | null> {
  if (s.kind === 'company' || s.company_id == null) return s;
  const row = await env.DB.prepare('SELECT uid FROM company_profiles WHERE id = ?').bind(s.company_id).first<{ uid: string }>();
  return row ? loadScope(env, 'company', row.uid) : null;
}

/** No row (or a pre-migration database) retains defaults; any other unreadable policy fails closed. */
export async function readAllowlists(env: Env, s: Scope): Promise<Allowlists | null> {
  try {
    const row = await env.DB.prepare('SELECT model_ids_json, tool_grants_json FROM team_allowlists WHERE scope_kind = ? AND scope_id = ?').bind(s.kind, s.id)
      .first<{ model_ids_json: string | null; tool_grants_json: string | null }>();
    return row ? parseAllowlists({ model_ids: row.model_ids_json === null ? null : JSON.parse(row.model_ids_json), tool_grants: row.tool_grants_json === null ? null : JSON.parse(row.tool_grants_json) }) : defaults();
  } catch (e) {
    return /no such table: team_allowlists\b/i.test(String((e as Error)?.message ?? e)) ? defaults() : null;
  }
}

/** Metadata only, never server URLs or credentials. A list cannot approve a new tool for its sponsor. */
export async function allowlistTools(env: Env, s: Scope) {
  if (!customMcpEnabled(env)) return [];
  const rows = s.kind === 'company'
    ? await env.DB.prepare(`SELECT i.* FROM integrations i WHERE i.provider_key LIKE 'custom:%' AND i.user_id IN
        (SELECT user_id FROM user_company_links WHERE company_id = ?) ORDER BY i.id`).bind(s.id).all<IntegrationRow>()
    : await env.DB.prepare(`SELECT i.* FROM integrations i WHERE i.provider_key LIKE 'custom:%' AND i.user_id IN
        (SELECT user_id FROM project_members WHERE project_id = ? AND status = 'accepted'
         UNION SELECT id FROM users WHERE role = 'founder' AND founder_id = ?) ORDER BY i.id`).bind(s.id, s.founder_id).all<IntegrationRow>();
  return (rows.results ?? []).flatMap((row) => {
    const offer = grantableTools(row);
    return configOf(row) && offer?.connected ? [{ integration_uid: row.provider_key.slice(7), name: row.display_name || 'MCP server', tools: offer.tools.map((name) => ({ name })) }] : [];
  });
}

/** The policy and its actor/time audit commit together; an audit failure rolls back the change. */
export async function saveAllowlists(env: Env, s: Scope, actor: number, lists: Allowlists): Promise<void> {
  const models = lists.model_ids === null ? null : JSON.stringify(lists.model_ids);
  const tools = lists.tool_grants === null ? null : JSON.stringify(lists.tool_grants);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO team_allowlists (scope_kind, scope_id, model_ids_json, tool_grants_json, updated_by)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope_kind, scope_id) DO UPDATE SET model_ids_json = excluded.model_ids_json,
      tool_grants_json = excluded.tool_grants_json, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`).bind(s.kind, s.id, models, tools, actor),
    env.DB.prepare(`INSERT INTO activity_logs (project_id, user_id, action, details) VALUES (?, ?, 'team_allowlists_changed', ?)`).bind(s.kind === 'project' ? s.id : null, actor, JSON.stringify({ scope: s.kind, scope_id: s.id, ...lists })),
  ]);
}

const refusal = (status: number, code: string, message: string) => ({ ok: false as const, status, code, message });
export async function allowlistRefusal(env: Env, s: Scope, model: string | null, tools: ToolGrant[]) {
  const parent = await effectiveAllowlistScope(env, s);
  const lists = parent ? await readAllowlists(env, parent) : null;
  if (!lists) return refusal(503, 'allowlists_unreadable', 'The team’s allowed models and tools could not be read, so the agent was not run.');
  if (model !== null && lists.model_ids !== null && !lists.model_ids.includes(model)) return refusal(403, 'model_not_allowed', 'This model is no longer allowed by the company or project. An editor must allow it before this agent can run.');
  if (lists.tool_grants !== null && tools.some((g) => !lists.tool_grants!.some((v) => key(v) === key(g)))) return refusal(403, 'tool_not_allowed', 'A tool this agent was given is no longer allowed by the company or project. An editor must allow it before this agent can run.');
  return null;
}

export type AgentMcpContext = { agent_uid: string; integration_uid: string };
/** Restrictive execution context only: it grants no OAuth scope, connection or project access. */
export async function agentMcpRefusal(env: Env, sponsor: number, context: AgentMcpContext, tool: string) {
  if (env.TEAM_AGENTS_ENABLED !== 'true') return refusal(403, 'team_agents_off', 'AI agents are switched off.');
  const a = await agentByUid(env, context.agent_uid);
  if (!a || a.status !== 'active' || a.sponsor_user_id !== sponsor) return refusal(403, 'agent_context_invalid', 'This MCP call does not belong to an active agent sponsored by this account.');
  const s = await scopeOfAgent(env, a);
  if (!s) return refusal(403, 'agent_context_invalid', 'This agent’s team is no longer available.');
  const sponsorUser = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(sponsor).first<User>();
  if (!sponsorUser || !(await canManage(env, s, sponsorUser))) return refusal(403, 'sponsor_lost_access', 'This agent’s sponsor can no longer manage its team.');
  if (!planOk(sponsorUser)) return refusal(403, 'plan_required', 'Agents come with a paid Founder plan.');
  let grants: ToolGrant[];
  try { grants = JSON.parse(a.tool_grants_json); } catch { grants = []; }
  if (!Array.isArray(grants) || !grants.some((g) => g && typeof g === 'object' && g.integration_uid === context.integration_uid && g.tool === tool)) return refusal(403, 'tool_not_granted', 'This agent was not given that tool.');
  return allowlistRefusal(env, s, a.model_id, [{ integration_uid: context.integration_uid, tool }]);
}
