/** D4424: closed inbound tool/role mapping and live outside-assistant company policy, distinct from outbound custom MCP grants. */
import type { Env, User } from '../../types';
import type { GrantProps } from '../../mcp/grants';
import { ToolRefused } from '../../mcp/grants';
import { outsideAgentForGrant, OutsideAssistantRefused } from './outsideAssistant';
import { effectiveAllowlistScope } from './allowlists';
import { bookRows, scopeOfAgent, type AgentRow, type Scope } from './teams';
import { optionsIn, roleOf, type Rules } from './catalogue';
import { checkRules } from './rulebook';

/** A newly registered tool has no implicit agent permission. No direct write is mapped. */
export const OUTSIDE_READS: Readonly<Record<string, string>> = Object.freeze({
  list_companies: 'project.summary',
  get_validate_context: 'validate.records',
  get_interview_guide: 'validate.records',
  get_build_progress: 'build.records',
  list_channel_chats: 'validate.records',
  get_session_insights: 'validate.records',
  list_meetings: 'validate.records',
  get_meeting_transcript: 'validate.records',
  'decks.read_outline': 'raise.records',
  'raise.prospect_brief': 'network.relationships',
  'raise.qa_prep': 'raise.records',
});
export const OUTSIDE_PROPOSE = 'team.propose';
export const OUTSIDE_TOOLS = Object.freeze([...Object.keys(OUTSIDE_READS), OUTSIDE_PROPOSE]);
export type OutsidePrincipal = { agent: AgentRow; scope: Extract<Scope, { kind: 'company' }>; user: User; props: GrantProps; rules: Rules; allowedTools: string[] | null };

/** Only a verified Team binding translates Team read permission into the mapped ordinary read tools. */
export function outsideEffectiveScopes(scope: readonly string[]): string[] {
  return [
    ...(scope.includes('team:read') ? ['validate:read', 'build:read', 'raise:read', 'connectors:read', 'mail:read'] : []),
    ...(scope.includes('team:propose') ? ['team:propose'] : []),
  ];
}

/** Only verified encrypted props select an outside identity. Headers/arguments never do. */
export async function outsidePrincipal(env: Env, props: GrantProps, grantId: string | null): Promise<OutsidePrincipal | null> {
  if (props.outsideBindingUid === undefined) return null;
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 AND deletion_requested_at IS NULL')
    .bind(props.userId).first<User>();
  if (!user) throw new ToolRefused('This connected app no longer has an active account.', 'connection_revoked');
  try {
    const agent = await outsideAgentForGrant(env, user, { bindingUid: props.outsideBindingUid, clientId: props.clientId, grantId, keyUid: props.keyUid });
    const scope = await scopeOfAgent(env, agent);
    if (!scope || scope.kind !== 'company') throw new ToolRefused('This outside assistant’s company is no longer available.', 'connection_revoked');
    // Preserve the original project allow-list, narrowed to projects STILL under this company.
    const rows = await env.DB.prepare('SELECT id FROM projects WHERE company_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))')
      .bind(scope.id, JSON.stringify(props.companies)).all<{ id: number }>();
    const allowedTools = await outsideToolPolicy(env, scope);
    if (allowedTools === undefined) throw new ToolRefused('The team’s allowed tools could not be read, so this connection cannot run.', 'unavailable');
    const [top] = await bookRows(env, scope, agent.role_key);
    let raw: unknown;
    try { raw = top ? JSON.parse(top.rules_json) : roleOf(agent.role_key)?.default_rules; }
    catch { throw new ToolRefused('This role’s rule book could not be read.', 'unavailable'); }
    const checked = checkRules(raw);
    if (!checked.ok) throw new ToolRefused('This role’s rule book could not be verified.', 'unavailable');
    return { agent, scope, user, rules: checked.rules, allowedTools, props: { ...props, companies: (rows.results ?? []).map(r => r.id) } };
  } catch (e) {
    if (e instanceof OutsideAssistantRefused) throw new ToolRefused(e.message, e.code);
    throw e;
  }
}

/** Null is the explicit/default policy, undefined is unreadable and never grants access. */
export async function outsideToolPolicy(env: Env, scope: Scope): Promise<string[] | null | undefined> {
  const parent = await effectiveAllowlistScope(env, scope);
  if (!parent) return undefined;
  try {
    const r = await env.DB.prepare('SELECT axal_tools_json FROM team_allowlists WHERE scope_kind = ? AND scope_id = ?')
      .bind(parent.kind, parent.id).first<{ axal_tools_json: string | null }>();
    if (!r || r.axal_tools_json === null) return null;
    const v: unknown = JSON.parse(r.axal_tools_json);
    return Array.isArray(v) && v.every(t => typeof t === 'string' && OUTSIDE_TOOLS.includes(t)) ? v : undefined;
  } catch { return undefined; }
}

export async function outsideToolAllowed(_env: Env, p: OutsidePrincipal, name: string, scope: string, readOnly?: boolean): Promise<boolean> {
  if (name !== OUTSIDE_PROPOSE && (readOnly === false || scope.endsWith(':write') || !OUTSIDE_READS[name])) return false;
  if (p.allowedTools !== null && !p.allowedTools.includes(name)) return false;
  return name === OUTSIDE_PROPOSE ? outsideProposalChoices(p).length > 0 : p.rules.reads.includes(OUTSIDE_READS[name]);
}

/** Closed capability keys for the tool schema, not company-authored instructions. */
export function outsideProposalChoices(p: OutsidePrincipal) {
  return p.rules.works_in.map(module => ({ module, options: optionsIn(module).filter(option => p.rules.may_propose.includes(option)) }))
    .filter(choice => choice.options.length > 0);
}

/** Only this column changes; saving older model/custom-tool settings cannot erase this policy. */
export async function saveOutsideToolPolicy(env: Env, scope: Scope, actor: number, tools: string[] | null): Promise<void> {
  const parent = await effectiveAllowlistScope(env, scope);
  if (!parent) throw new ToolRefused('This team’s policy could not be read.', 'unavailable');
  const value = tools === null ? null : JSON.stringify([...new Set(tools)].sort());
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO team_allowlists(scope_kind, scope_id, axal_tools_json, updated_by) VALUES(?, ?, ?, ?)
      ON CONFLICT(scope_kind, scope_id) DO UPDATE SET axal_tools_json=excluded.axal_tools_json, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`)
      .bind(parent.kind, parent.id, value, actor),
    env.DB.prepare("INSERT INTO activity_logs(user_id, action, details) VALUES(?, 'team_outside_tools_changed', ?)")
      .bind(actor, JSON.stringify({ scope: parent.kind, scope_id: parent.id, tools: tools === null ? null : [...new Set(tools)].sort() })),
  ]);
}
