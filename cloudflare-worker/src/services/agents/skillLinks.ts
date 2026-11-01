/**
 * D1612 part A2 (#3956, of #3945) — an agent's skills: whether an agent may be
 * given a skill version, its radar from those skills, and a team's coverage.
 * Shared by `routes/team_skills.ts` and the add-agent route
 * (`routes/team_agents.ts`), so the gates are written once.
 *
 * THE ATTACH GATE (`attachCheck`), in order, each a code the page words:
 *   not_found              the skill is another company's, or a draft nobody published
 *   version_not_published  the version asked for was never published
 *   skill_retired          409: a retired skill is not added again (one already pinned stays)
 *   role_mismatch          the skill does not list the agent's role
 *   tool_not_approved      a tool the skill uses is not in the agent's grants
 *                          (`tool_grants_json`, #3844), named as `{ key, label }`
 *
 * THE RADAR. Each of the 8 /studio axes takes the highest tag level among the
 * agent's pinned versions. An axis no tag reaches is `level: null`; an agent
 * with no skills has `radar: null`, which the page draws as "Not recorded",
 * never zeros.
 *
 * Values are not scored from behaviour. Rule books have no values section yet,
 * so `values` is null until the company can set one.
 */
import type { Env } from '../../types';
import { RADAR_AXES } from '../skillsTaxonomySchema';
import { roleOf } from './catalogue';
import { grantsOf } from './agentTools';
import { missingTools, type Tag } from './skills';
import type { AgentRow } from './teams';

const LEVEL: Record<string, number> = { aware: 1, working: 2, proficient: 3, advanced: 4, expert: 5 };

export type SkillRow = {
  id: number; uid: string; scope: 'hq' | 'company'; company_id: number | null; slug: string; name: string; purpose: string;
  steps_json: string; allowed_tools_json: string; output_kind: string; status: 'draft' | 'published' | 'retired';
  current_version: number; created_by: number; updated_by: number | null; created_at: string; updated_at: string;
};
export type VersionRow = {
  skill_id: number; version: number; skill_md: string; name: string; purpose: string; steps_json: string;
  allowed_tools_json: string; output_kind: string; taxonomy_json: string; roles_json: string; published_at: string; published_by: number;
};
export type AttachCode = 'not_found' | 'version_not_published' | 'skill_retired' | 'role_mismatch' | 'tool_not_approved';
export type Blocked = { code: AttachCode; tool?: { key: string; label: string } };
export type Axis = { slug: string; label: string; level: number | null };

/** The status each code answers with when a write is refused. */
export const ATTACH_STATUS: Record<AttachCode, number> = {
  not_found: 404, version_not_published: 422, skill_retired: 409, role_mismatch: 422, tool_not_approved: 422,
};

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };

export const toolLabel = (key: string) => key;
export const versionTags = (v: Pick<VersionRow, 'taxonomy_json'>): Tag[] => parse<Tag[]>(v.taxonomy_json, []);
export const versionRoles = (v: Pick<VersionRow, 'roles_json'>): string[] => parse<string[]>(v.roles_json, []);
export const versionTools = (v: Pick<VersionRow, 'allowed_tools_json'>): string[] => parse<string[]>(v.allowed_tools_json, []);

export async function skillByUid(env: Env, uid: unknown): Promise<SkillRow | null> {
  if (typeof uid !== 'string' || !/^[a-f0-9]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM agent_skills WHERE uid = ?').bind(uid).first<SkillRow>();
}

export async function versionOf(env: Env, skillId: number, version: number): Promise<VersionRow | null> {
  return env.DB.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ? AND version = ?').bind(skillId, version).first<VersionRow>();
}

/** The company an agent's skills may come from: its own, or its project's. */
export async function agentCompanyId(env: Env, a: Pick<AgentRow, 'scope_kind' | 'company_id' | 'project_id'>): Promise<number | null> {
  if (a.scope_kind === 'company') return a.company_id;
  const p = await env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(a.project_id).first<{ company_id: number | null }>();
  return p?.company_id ?? null;
}

type AgentPart = Pick<AgentRow, 'scope_kind' | 'company_id' | 'project_id' | 'role_key' | 'tool_grants_json'>;

/**
 * Why `a` may not be given `s` at `version`; null when it may. `pinned` is the
 * version the agent already has: keeping it is never refused, so a retired
 * skill stays pinned and readable.
 */
export async function attachCheck(env: Env, a: AgentPart, s: SkillRow, version: number, pinned: number | null = null): Promise<Blocked | null> {
  if (s.scope === 'company' && s.company_id !== await agentCompanyId(env, a)) return { code: 'not_found' };
  if (!Number.isSafeInteger(version) || version < 1 || version > s.current_version) return { code: 'version_not_published' };
  const v = await versionOf(env, s.id, version);
  if (!v) return { code: 'version_not_published' };
  if (pinned === version) return null;
  if (s.status === 'retired') return { code: 'skill_retired' };
  if (!versionRoles(v).includes(a.role_key)) return { code: 'role_mismatch' };
  const missing = missingTools(versionTools(v), grantsOf(a.tool_grants_json));
  if (missing.length) return { code: 'tool_not_approved', tool: { key: missing[0], label: toolLabel(missing[0]) } };
  return null;
}

/**
 * A whole list of `{ uid, version? }` for one agent, gated: the first skill
 * that may not be pinned refuses the list. A version left out keeps the
 * pinned one, else the current one. `readable` is the caller's read gate on
 * the skill; the add-agent route (no agent yet, `id: null`) passes the same.
 */
export async function checkSkillList(env: Env, a: AgentPart & { id: number | null }, items: unknown[], readable: (s: SkillRow) => Promise<boolean>):
  Promise<{ ok: true; wanted: Array<{ s: SkillRow; version: number }> } | { ok: false; blocked: Blocked; skill_uid: string }> {
  const wanted: Array<{ s: SkillRow; version: number }> = [];
  for (const item of items) {
    const uid = typeof item === 'string' ? item : (item as any)?.uid;
    const s = await skillByUid(env, uid);
    if (!s || !(await readable(s))) return { ok: false, blocked: { code: 'not_found' }, skill_uid: String(uid ?? '').slice(0, 64) };
    if (wanted.some((w) => w.s.id === s.id)) continue;
    const existing = a.id != null ? await env.DB.prepare('SELECT version FROM agent_skill_links WHERE agent_id = ? AND skill_id = ?').bind(a.id, s.id).first<{ version: number }>() : null;
    const asked = item && typeof item === 'object' && (item as any).version != null ? Number((item as any).version) : null;
    const version = asked ?? existing?.version ?? s.current_version;
    const blocked = await attachCheck(env, a, s, version, existing?.version ?? null);
    if (blocked) return { ok: false, blocked, skill_uid: s.uid };
    wanted.push({ s, version });
  }
  return { ok: true, wanted };
}

/** The taxonomy's slug → axis and slug → label maps. */
export async function taxonomyMaps(env: Env): Promise<{ category: Map<string, string>; label: Map<string, string> }> {
  const rows = (await env.DB.prepare('SELECT slug, category_slug, label FROM skills WHERE is_active = 1').all<{ slug: string; category_slug: string; label: string }>()).results ?? [];
  return { category: new Map(rows.map((r) => [r.slug, r.category_slug])), label: new Map(rows.map((r) => [r.slug, r.label])) };
}

/** Each axis's highest level over `tags`; an axis no tag reaches is null. */
export function axesOf(tags: readonly Tag[], category: ReadonlyMap<string, string>): Axis[] {
  const best = new Map<string, number>();
  for (const t of tags) {
    const axis = category.get(t.slug);
    const n = LEVEL[t.level];
    if (axis && n && n > (best.get(axis) ?? 0)) best.set(axis, n);
  }
  return RADAR_AXES.map((x) => ({ slug: x.slug, label: x.label, level: best.get(x.slug) ?? null }));
}

/** The agent's pinned versions' tags, or null when it has no skills (the radar is then null, never zeros). */
export async function agentTags(env: Env, agentId: number): Promise<Tag[] | null> {
  const rows = (await env.DB.prepare(
    `SELECT v.taxonomy_json FROM agent_skill_links l JOIN agent_skill_versions v ON v.skill_id = l.skill_id AND v.version = l.version
      WHERE l.agent_id = ?`,
  ).bind(agentId).all<{ taxonomy_json: string }>()).results ?? [];
  if (!rows.length) return null;
  return rows.flatMap((r) => versionTags(r));
}

/** An agent's radar: `{ axes }`, or null with no skills. */
export async function agentRadar(env: Env, agentId: number, maps?: { category: Map<string, string> }): Promise<{ axes: Axis[] } | null> {
  const tags = await agentTags(env, agentId);
  if (!tags) return null;
  return { axes: axesOf(tags, (maps ?? await taxonomyMaps(env)).category) };
}

/** The agent's values. Rule books carry no values section yet, so none are set (null, never a score). */
export async function agentValues(_env: Env, _a: Pick<AgentRow, 'role_key'>): Promise<null> {
  return null;
}

export const roleLabel = (key: string) => roleOf(key)?.name ?? key;

/** The insert or re-pin of one link. */
export function linkStatement(env: Env, agentId: number, skillId: number, version: number, by: number) {
  return env.DB.prepare(
    `INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (agent_id, skill_id) DO UPDATE SET version = excluded.version, linked_by = excluded.linked_by, linked_at = CURRENT_TIMESTAMP
     WHERE agent_skill_links.version <> excluded.version`,
  ).bind(agentId, skillId, version, by);
}

/** Who is on a team, for coverage: a company's linked members; a project's founder and its accepted members. */
export async function teamUserIds(env: Env, scope: { kind: 'company'; id: number } | { kind: 'project'; id: number; founder_id: number | null }): Promise<number[]> {
  if (scope.kind === 'company') {
    const r = await env.DB.prepare('SELECT user_id FROM user_company_links WHERE company_id = ?').bind(scope.id).all<{ user_id: number }>();
    return [...new Set((r.results ?? []).map((x) => Number(x.user_id)))];
  }
  const ids = new Set<number>();
  if (scope.founder_id != null) {
    const f = await env.DB.prepare("SELECT id FROM users WHERE founder_id = ? AND role = 'founder'").bind(scope.founder_id).all<{ id: number }>();
    for (const x of f.results ?? []) ids.add(Number(x.id));
  }
  const m = await env.DB.prepare("SELECT user_id FROM project_members WHERE project_id = ? AND status = 'accepted'").bind(scope.id).all<{ user_id: number }>();
  for (const x of m.results ?? []) ids.add(Number(x.user_id));
  return [...ids];
}

/** Each axis's highest self-rated level among `userIds` (`user_skills`, 1–5; 0 is no level). */
export async function peopleAxes(env: Env, userIds: number[]): Promise<Map<string, number>> {
  const best = new Map<string, number>();
  if (!userIds.length) return best;
  const r = await env.DB.prepare(
    `SELECT s.category_slug AS axis, MAX(us.self_level) AS level FROM user_skills us JOIN skills s ON s.id = us.skill_id
      WHERE us.user_id IN (SELECT value FROM json_each(?)) AND us.self_level > 0 GROUP BY s.category_slug`,
  ).bind(JSON.stringify(userIds)).all<{ axis: string; level: number }>();
  for (const x of r.results ?? []) best.set(x.axis, Number(x.level));
  return best;
}
