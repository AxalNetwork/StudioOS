/**
 * D4535 part 2 (#4535): the facts `validateWorkflow` checks a definition
 * against, read from D1 for one company the caller is already authorized for.
 *
 * READS ONLY. Nothing here writes, pins, grants, plans, admits or runs. It
 * builds the `ValidationContext` the validator takes (D4535 §4, "the context
 * is facts, not reads") through the gates that already exist, each called,
 * never copied:
 *   - a skill: `skillByUid`; the caller's read gate is the `readable` callback
 *     the route passes (team_skills.ts's rule); a version's suspension is
 *     `skillRunRefusal`, the run gate's own rule;
 *   - an agent: the one live agent of a role in the company
 *     (`idx_team_agents_live_role` allows one), its pins from
 *     `agent_skill_links`, and its tools from `grantsOf(tool_grants_json)`
 *     through `missingTools`, narrowed by `requireCapability` (D8070), as
 *     `attachCheck` does.
 *
 * Only company-scoped agents are read: the run scope here is a company, never
 * a project (a project run waits for the run slice). Every query binds the
 * company id the route resolved from the caller's own links.
 *
 * Not checked, because the facts do not exist yet: whether a pinned version is
 * QUALIFIED (#4533's release-evidence identity, D4535 §8) and per-skill typed
 * input contracts (§3). `content_hash` is null: a plan, which needs it, is not
 * made here.
 */
import type { Env } from '../../types';
import type { AgentFact, SkillFact, SkillVersionFact, ValidationContext, WorkflowDefinition } from './skillWorkflow';
import { grantsOf } from './agentTools';
import { missingTools } from './skills';
import { skillByUid, versionRoles, versionTools, type SkillRow } from './skillLinks';
import { skillRunRefusal } from './skillModeration';
import { requireCapability, toolCapability } from '../agentCapabilities';

/** The checks this context cannot answer yet, named in every validation reply. */
export const NOT_CHECKED = Object.freeze(['qualified_version', 'skill_input_contract'] as const);

type VersionRow = { version: number; roles_json: string; allowed_tools_json: string; output_kind: string };
type AgentRow = { id: number; uid: string; role_key: string; status: 'active' | 'paused' | 'removed'; model_id: string; tool_grants_json: string };

/** Every skill reference in a shape-checked definition: each node's skill and its fallback's. */
export function referencesOf(def: WorkflowDefinition): { skills: string[]; roles: string[] } {
  const skills = new Set<string>(); const roles = new Set<string>();
  for (const n of def.nodes) {
    skills.add(n.skill_uid); roles.add(n.role_key);
    if (n.failure.on_failure === 'fallback') { skills.add(n.failure.fallback.skill_uid); roles.add(n.failure.fallback.role_key); }
  }
  return { skills: [...skills].sort(), roles: [...roles].sort() };
}

const OUTPUT_KINDS = new Set(['draft', 'record_change', 'brief']);

/**
 * The context for `def` run in company `companyId`. `readable(s)` is the
 * caller's read gate on a skill; a skill it refuses is left out, so the
 * validator answers `skill_not_found`, exactly as for a skill that does not
 * exist or is another company's.
 */
export async function workflowContext(env: Env, companyId: number, def: WorkflowDefinition, readable: (s: SkillRow) => Promise<boolean>): Promise<ValidationContext> {
  const refs = referencesOf(def);
  const skills: Record<string, SkillFact> = {};
  const allTools = new Set<string>();
  for (const uid of refs.skills) {
    const s = await skillByUid(env, uid);
    if (!s) continue;
    const rows = ((await env.DB.prepare(
      'SELECT version, roles_json, allowed_tools_json, output_kind FROM agent_skill_versions WHERE skill_id = ? ORDER BY version',
    ).bind(s.id).all<VersionRow>()).results ?? []);
    const versions: SkillVersionFact[] = [];
    for (const v of rows) {
      const tools = versionTools(v);
      tools.forEach((t) => allTools.add(t));
      versions.push({
        version: Number(v.version), published: true, suspended: !!(await skillRunRefusal(env, s.id, Number(v.version))),
        roles: versionRoles(v), tools,
        output_kind: (OUTPUT_KINDS.has(v.output_kind) ? v.output_kind : 'record_change') as SkillVersionFact['output_kind'],
        content_hash: null,
      });
    }
    skills[uid] = { uid: s.uid, slug: s.slug, scope: s.scope, company_id: s.company_id, status: s.status, readable: await readable(s), versions };
  }

  const agents: Record<string, AgentFact> = {};
  for (const role of refs.roles) {
    const a = await env.DB.prepare(
      `SELECT id, uid, role_key, status, model_id, tool_grants_json FROM team_agents
        WHERE scope_kind = 'company' AND company_id = ? AND role_key = ? AND status <> 'removed'`,
    ).bind(companyId, role).first<AgentRow>();
    if (!a) continue;
    const links = ((await env.DB.prepare(
      'SELECT s.uid AS uid, l.version AS version FROM agent_skill_links l JOIN agent_skills s ON s.id = l.skill_id WHERE l.agent_id = ?',
    ).bind(a.id).all<{ uid: string; version: number }>()).results ?? []);
    const held = grantsOf(a.tool_grants_json);
    const grants: string[] = [];
    for (const tool of [...allTools].sort()) {
      if (missingTools([tool], held).length) continue;
      if (!(await requireCapability(env, { id: a.id }, toolCapability(tool))).ok) continue;
      grants.push(tool);
    }
    agents[role] = {
      uid: a.uid, role_key: a.role_key, company_id: companyId, status: a.status, grants,
      pins: Object.fromEntries(links.map((l) => [l.uid, Number(l.version)])), model: a.model_id ?? null,
    };
  }
  return { scope: { company_id: companyId, project_id: null }, skills, agents };
}
