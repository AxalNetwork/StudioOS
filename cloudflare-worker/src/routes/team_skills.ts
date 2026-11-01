/**
 * D1612 (#3951, part A of #3945) — the agent skill library. Mounted at
 * `/api/teams`, beside `team_agents.ts`, behind the same
 * `TEAM_AGENTS_ENABLED` switch (404 `team_agents_off`).
 *
 *   GET  /skills?company=<uid>&role=&category=&q=&sort=popular|new|az
 *        the library: the roles with their skill and agent counts, "From
 *        Axal", and the company's own skills when `company` is the caller's
 *   GET  /skills/:uid                    one skill: its SKILL.md, versions and the agents using it
 *   POST /skills                         a new draft { scope, company?, ...fields } or { scope, company?, skill_md }
 *   PATCH /skills/:uid                   edit the draft, or retire it
 *   POST /skills/:uid/publish            a new immutable version
 *
 * A2 (#3956): an agent's skills, assigning a skill, the radar, coverage.
 *   GET  /agents/:uid/skills             { can_manage, skills, radar: { axes } | null, values: null }
 *   PUT  /agents/:uid/skills             { skills: [{ uid, version? }] }: set the whole list, gated; the same shape
 *   GET  /agents/:uid/skills/available   the role's published skills, most used first, each with `blocked`
 *   GET  /skills/:uid/agents             the agents using a skill that the caller can see, with their scope
 *   GET  /skills/:uid/assignable         the skill's role's agents the caller can manage: assigned, blocked, skill_count
 *   POST /skills/:uid/assign             { agent_uids }: pins the current version; partial, { added, refused }
 *   GET  /:scope/:id/coverage            per axis, the team's people's highest level and its agents'
 *
 * GATES.
 *  - Read: an HQ skill is readable by every member; a company skill only by
 *    that company's members (`user_company_links`) and HQ's admins. A draft
 *    is seen only by those who may write it.
 *  - Write: an HQ skill by a Super Admin only; a company skill by that
 *    company's editors (`canEdit`).
 *  - An agent's skills: changed only by those who manage the agent's company
 *    or project (`services/agents/teams.ts`'s `canManage`, called, never copied).
 *  - Attach (`services/agents/skillLinks.ts`'s `attachCheck`): readable from
 *    the agent's company (404 `not_found`), a published version (422
 *    `version_not_published`), not retired (409 `skill_retired`; one already
 *    pinned stays), of the agent's role (422 `role_mismatch`), and its tools in
 *    the agent's `tool_grants_json` (422 `tool_not_approved`, `{ tool }`).
 *    Changing an agent's skills is 403 `not_manager` for anyone else.
 *
 * A person is `{ uid, name }`, never an email. Nothing here runs a model.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { activeCompanyFor } from '../middleware/activeCompany';
import { canEdit } from '../services/companyAccess';
import { isAdmin, newUid } from './_t13t14t15_helpers';
import { ROLES, roleOf } from '../services/agents/catalogue';
import { RADAR_AXES } from '../services/skillsTaxonomySchema';
import {
  OUTPUT_LABELS, SKILL_MESSAGES, checkDraft, parseSkillMd, toSkillMd,
  type OutputKind, type SkillDraft, type Tag,
} from '../services/agents/skills';
import { teamAgentsEnabled } from './team_agents';
import { grantsOf } from '../services/agents/agentTools';
import { agentByUid, canManage, canRead, loadScope, scopeCols, scopeOfAgent, type AgentRow } from '../services/agents/teams';
import {
  ATTACH_STATUS, agentCompanyId, agentValues, attachCheck, axesOf, checkSkillList, linkStatement, peopleAxes, teamUserIds, toolLabel, versionTags,
  type AttachCode, type Blocked,
} from '../services/agents/skillLinks';

type C = Context<{ Bindings: Env }>;
type SkillRow = {
  id: number; uid: string; scope: 'hq' | 'company'; company_id: number | null; slug: string; name: string; purpose: string;
  steps_json: string; allowed_tools_json: string; output_kind: OutputKind; status: 'draft' | 'published' | 'retired';
  current_version: number; created_by: number; updated_by: number | null; created_at: string; updated_at: string;
};
type VersionRow = {
  skill_id: number; version: number; skill_md: string; name: string; purpose: string; steps_json: string;
  allowed_tools_json: string; output_kind: OutputKind; taxonomy_json: string; roles_json: string; published_at: string; published_by: number;
};

const router = new Hono<{ Bindings: Env }>();

router.use('*', async (c, next) => {
  if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
  await next();
});

const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) => refuse(c, status, { code, message, extra });
const noSkill = (c: C) => say(c, 404, 'not_found', 'There is no such skill.');
const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
const all = async <T>(env: Env, sql: string, ...binds: unknown[]) => ((await env.DB.prepare(sql).bind(...binds).all<T>()).results ?? []) as T[];

// ── Reference data ──────────────────────────────────────────────────────────

type Taxonomy = { slugs: Set<string>; category: Map<string, string>; label: Map<string, string> };
async function taxonomy(env: Env): Promise<Taxonomy> {
  const rows = await all<{ slug: string; category_slug: string; label: string }>(env, 'SELECT slug, category_slug, label FROM skills WHERE is_active = 1');
  return { slugs: new Set(rows.map((r) => r.slug)), category: new Map(rows.map((r) => [r.slug, r.category_slug])), label: new Map(rows.map((r) => [r.slug, r.label])) };
}
const ROLE_KEYS = new Set(ROLES.map((r) => r.key));

async function companyByUid(env: Env, uid: string | undefined) {
  if (!uid) return null;
  return env.DB.prepare('SELECT id, uid, company_name, archived_at FROM company_profiles WHERE uid = ?').bind(uid)
    .first<{ id: number; uid: string; company_name: string; archived_at: string | null }>();
}
async function isMember(env: Env, companyId: number, user: User): Promise<boolean> {
  if (isAdmin(user)) return true;
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(companyId, user.id).first());
}
async function mayWrite(env: Env, s: Pick<SkillRow, 'scope' | 'company_id'>, user: User): Promise<boolean> {
  if (s.scope === 'hq') return isSuperAdmin(user as any);
  return s.company_id != null && canEdit(env, { id: s.company_id }, user);
}
async function mayRead(env: Env, s: SkillRow, user: User): Promise<boolean> {
  if (!(s.scope === 'hq' || (s.company_id != null && await isMember(env, s.company_id, user)))) return false;
  return s.current_version > 0 || mayWrite(env, s, user);
}

async function skillByUid(env: Env, uid: string): Promise<SkillRow | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM agent_skills WHERE uid = ?').bind(uid).first<SkillRow>();
}

// ── Shapes ──────────────────────────────────────────────────────────────────

type Parts = { name: string; purpose: string; steps: string[]; tools: string[]; output_kind: OutputKind; tags: Tag[]; roles: string[] };

async function draftParts(env: Env, s: SkillRow): Promise<Parts> {
  const tags = await all<{ taxonomy_skill_slug: string; level: Tag['level'] }>(env, 'SELECT taxonomy_skill_slug, level FROM agent_skill_tags WHERE skill_id = ? ORDER BY rowid', s.id);
  const roles = await all<{ role_key: string }>(env, 'SELECT role_key FROM agent_skill_roles WHERE skill_id = ? ORDER BY rowid', s.id);
  return {
    name: s.name, purpose: s.purpose, steps: parse(s.steps_json, []), tools: parse(s.allowed_tools_json, []), output_kind: s.output_kind,
    tags: tags.map((t) => ({ slug: t.taxonomy_skill_slug, level: t.level })), roles: roles.map((r) => r.role_key),
  };
}
const versionParts = (v: VersionRow): Parts => ({
  name: v.name, purpose: v.purpose, steps: parse(v.steps_json, []), tools: parse(v.allowed_tools_json, []), output_kind: v.output_kind,
  tags: parse(v.taxonomy_json, []), roles: parse(v.roles_json, []),
});
async function versionOf(env: Env, skillId: number, version: number): Promise<VersionRow | null> {
  return env.DB.prepare('SELECT * FROM agent_skill_versions WHERE skill_id = ? AND version = ?').bind(skillId, version).first<VersionRow>();
}

async function usedBy(env: Env, skillId: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
    WHERE l.skill_id = ? AND a.status <> 'removed'`).bind(skillId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

function partsDto(p: Parts, tax: Taxonomy) {
  return {
    name: p.name, purpose: p.purpose, steps: p.steps, tools: p.tools, output_kind: p.output_kind, output_label: OUTPUT_LABELS[p.output_kind] ?? null,
    roles: p.roles.map((k) => ({ key: k, label: roleOf(k)?.name ?? k })),
    tags: p.tags.map((t) => ({ slug: t.slug, label: tax.label.get(t.slug) ?? t.slug, category: tax.category.get(t.slug) ?? null, level: t.level })),
  };
}

/** A library card: readers see the published version; a writer also sees the draft. */
async function cardOf(env: Env, s: SkillRow, user: User, tax: Taxonomy, authorName: string) {
  const writer = await mayWrite(env, s, user);
  const current = s.current_version > 0 ? await versionOf(env, s.id, s.current_version) : null;
  const shown = current ? versionParts(current) : await draftParts(env, s);
  return {
    uid: s.uid, scope: s.scope, slug: s.slug, status: s.status, version: s.current_version || null,
    author: s.scope === 'hq' ? 'Axal' : authorName,
    ...partsDto(shown, tax),
    used_by: await usedBy(env, s.id),
    updated_at: s.updated_at,
    can_write: writer,
    ...(writer ? { draft: partsDto(await draftParts(env, s), tax) } : {}),
  };
}

// ── The library ─────────────────────────────────────────────────────────────

router.get('/skills', async (c) => {
  const user = await requireAuth(c);
  const tax = await taxonomy(c.env);
  const companyUid = c.req.query('company');
  const company = companyUid ? await companyByUid(c.env, companyUid) : null;
  if (companyUid && (!company || company.archived_at || !(await isMember(c.env, company.id, user)))) return say(c, 404, 'not_found', 'There is no such company.');
  const role = c.req.query('role');
  if (role && !ROLE_KEYS.has(role)) return say(c, 400, 'role_unknown', SKILL_MESSAGES.role_unknown);
  const category = c.req.query('category');
  if (category && !RADAR_AXES.some((a) => a.slug === category)) return say(c, 400, 'category_unknown', 'Choose one of the 8 skill categories.');
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100);
  const sort = c.req.query('sort') ?? 'popular';
  if (!['popular', 'new', 'az'].includes(sort)) return say(c, 400, 'sort_invalid', 'Sort by popular, new or A–Z.');

  const rows = await all<SkillRow>(c.env, `SELECT * FROM agent_skills WHERE scope = 'hq' OR (scope = 'company' AND company_id = ?) ORDER BY id`, company?.id ?? -1);
  const cards: Array<Awaited<ReturnType<typeof cardOf>>> = [];
  for (const s of rows) {
    if (!(await mayRead(c.env, s, user))) continue;
    if (s.status === 'retired' && !(await mayWrite(c.env, s, user))) continue;
    cards.push(await cardOf(c.env, s, user, tax, company?.company_name ?? ''));
  }
  // The role grid counts every readable skill, before the filters narrow the list.
  const agentCounts = company
    ? await all<{ role_key: string; n: number }>(c.env, `SELECT a.role_key, COUNT(*) AS n FROM team_agents a LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.status <> 'removed' AND (a.company_id = ? OR p.company_id = ?) GROUP BY a.role_key`, company.id, company.id)
    : [];
  const roles = ROLES.map((r) => ({
    key: r.key, label: r.name,
    skills: cards.filter((k) => k.roles.some((x) => x.key === r.key)).length,
    agents: company ? Number(agentCounts.find((a) => a.role_key === r.key)?.n ?? 0) : null,
  }));
  let list = cards.filter((k) => (!role || k.roles.some((x) => x.key === role))
    && (!category || k.tags.some((t) => t.category === category))
    && (!q || `${k.name} ${k.purpose}`.toLowerCase().includes(q)));
  list = sort === 'az' ? list.sort((a, b) => a.name.localeCompare(b.name))
    : sort === 'new' ? list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      : list.sort((a, b) => b.used_by - a.used_by || a.name.localeCompare(b.name));
  return c.json({
    roles,
    hq: list.filter((k) => k.scope === 'hq'),
    company: company ? { uid: company.uid, name: company.company_name, skills: list.filter((k) => k.scope === 'company'), can_write: await canEdit(c.env, { id: company.id }, user) } : null,
    can_write_hq: isSuperAdmin(user as any),
  });
});

router.get('/skills/:uid', async (c) => {
  const user = await requireAuth(c);
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || !(await mayRead(c.env, s, user))) return noSkill(c);
  const tax = await taxonomy(c.env);
  const company = s.company_id != null ? await c.env.DB.prepare('SELECT uid, company_name FROM company_profiles WHERE id = ?').bind(s.company_id).first<{ uid: string; company_name: string }>() : null;
  const card = await cardOf(c.env, s, user, tax, company?.company_name ?? '');
  const current = s.current_version > 0 ? await versionOf(c.env, s.id, s.current_version) : null;
  const versions = await all<{ version: number; published_at: string; by_uid: string | null; by_name: string | null }>(c.env,
    `SELECT v.version, v.published_at, u.uid AS by_uid, u.name AS by_name FROM agent_skill_versions v LEFT JOIN users u ON u.id = v.published_by
      WHERE v.skill_id = ? ORDER BY v.version DESC`, s.id);
  // The agents using it that the caller can see, grouped by company, with projects under each.
  const links = await all<AgentRow & { pinned: number }>(c.env,
    `SELECT a.*, l.version AS pinned FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
      WHERE l.skill_id = ? AND a.status <> 'removed' ORDER BY a.id LIMIT 200`, s.id);
  type Group = { company: { uid: string; name: string } | null; agents: unknown[]; projects: Array<{ id: number; name: string; agents: unknown[] }> };
  const groups = new Map<string, Group>();
  for (const a of links) {
    const scope = await scopeOfAgent(c.env, a);
    if (!scope || !(await canRead(c.env, scope, user))) continue;
    const companyRow = scope.kind === 'company' ? { uid: scope.uid, name: scope.name }
      : scope.company_id != null ? await c.env.DB.prepare('SELECT uid, company_name AS name FROM company_profiles WHERE id = ?').bind(scope.company_id).first<{ uid: string; name: string }>() : null;
    const key = companyRow?.uid ?? '';
    const g = groups.get(key) ?? { company: companyRow ?? null, agents: [], projects: [] };
    const agent = { uid: a.uid, role_key: a.role_key, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || null, version: a.pinned, update_available: a.pinned < s.current_version };
    if (scope.kind === 'company') g.agents.push(agent);
    else {
      let p = g.projects.find((x) => x.id === scope.id);
      if (!p) { p = { id: scope.id, name: scope.name, agents: [] }; g.projects.push(p); }
      p.agents.push(agent);
    }
    groups.set(key, g);
  }
  return c.json({
    skill: { ...card, skill_md: current?.skill_md ?? null },
    versions: versions.map((v) => ({ version: v.version, published_at: v.published_at, by: v.by_uid ? { uid: v.by_uid, name: v.by_name } : null })),
    agents: [...groups.values()],
  });
});

// ── Writing a skill ─────────────────────────────────────────────────────────

async function readBody(c: C): Promise<Record<string, any> | null> {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

function writeDraftStatements(env: Env, skillId: number, d: SkillDraft) {
  return [
    env.DB.prepare('DELETE FROM agent_skill_tags WHERE skill_id = ?').bind(skillId),
    ...d.tags.map((t) => env.DB.prepare('INSERT INTO agent_skill_tags (skill_id, taxonomy_skill_slug, level) VALUES (?, ?, ?)').bind(skillId, t.slug, t.level)),
    env.DB.prepare('DELETE FROM agent_skill_roles WHERE skill_id = ?').bind(skillId),
    ...d.roles.map((r) => env.DB.prepare('INSERT INTO agent_skill_roles (skill_id, role_key) VALUES (?, ?)').bind(skillId, r)),
  ];
}

router.post('/skills', async (c) => {
  const user = await requireAuth(c);
  const b = await readBody(c);
  if (!b) return say(c, 400, 'body_invalid', 'Send the skill as a JSON object.');
  if (b.scope !== 'hq' && b.scope !== 'company') return say(c, 400, 'scope_invalid', 'Say whether this is an Axal skill or your company\'s.');
  let companyId: number | null = null;
  if (b.scope === 'company') {
    const company = await companyByUid(c.env, typeof b.company === 'string' ? b.company : undefined);
    if (!company || company.archived_at || !(await isMember(c.env, company.id, user))) return say(c, 404, 'not_found', 'There is no such company.');
    companyId = company.id;
  }
  if (!(await mayWrite(c.env, { scope: b.scope, company_id: companyId }, user))) {
    return say(c, 403, 'not_editor', b.scope === 'hq' ? 'Only a Super Admin writes Axal\'s skills.' : 'Only the company\'s editors write its skills.');
  }
  // A pasted SKILL.md is untrusted data: it lands as a draft, checked like any other.
  let fields: unknown = b;
  if (b.skill_md !== undefined) {
    const parsed = parseSkillMd(b.skill_md);
    if (!parsed) return say(c, 400, 'skill_md_invalid', SKILL_MESSAGES.skill_md_invalid);
    fields = parsed;
  }
  const checked = checkDraft(fields, { taxonomy: (await taxonomy(c.env)).slugs, roleKeys: ROLE_KEYS });
  if (!checked.ok) return say(c, 400, checked.code, checked.message);
  const d = checked.draft;
  const clash = await c.env.DB.prepare('SELECT 1 AS ok FROM agent_skills WHERE scope = ? AND IFNULL(company_id, 0) = ? AND slug = ?')
    .bind(b.scope, companyId ?? 0, d.slug).first();
  if (clash) return say(c, 409, 'slug_taken', 'A skill with this short name already exists here. Choose another name.');
  const uid = newUid();
  const inserted = await c.env.DB.prepare(
    `INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, steps_json, allowed_tools_json, output_kind, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(uid, b.scope, companyId, d.slug, d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind, user.id, user.id).first<{ id: number }>();
  await c.env.DB.batch(writeDraftStatements(c.env, Number(inserted!.id), d));
  const s = (await skillByUid(c.env, uid))!;
  const tax = await taxonomy(c.env);
  return c.json({ skill: await cardOf(c.env, s, user, tax, '') }, 201);
});

router.patch('/skills/:uid', async (c) => {
  const user = await requireAuth(c);
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || !(await mayRead(c.env, s, user))) return noSkill(c);
  if (!(await mayWrite(c.env, s, user))) return say(c, 403, 'not_editor', 'Only this skill\'s editors can change it.');
  const b = await readBody(c);
  if (!b) return say(c, 400, 'body_invalid', 'Send the changes as a JSON object.');
  if (b.status !== undefined) {
    if (b.status !== 'retired') return say(c, 400, 'status_invalid', 'A skill can be retired here; publishing makes a new version.');
    await c.env.DB.prepare(`UPDATE agent_skills SET status = 'retired', updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(user.id, s.id).run();
  } else {
    const cur = await draftParts(c.env, s);
    const has = (k: string) => k in b;
    const merged = {
      slug: s.slug, name: has('name') ? b.name : cur.name, purpose: has('purpose') ? b.purpose : cur.purpose,
      steps: has('steps') ? b.steps : cur.steps, tools: has('tools') ? b.tools : cur.tools,
      output_kind: has('output_kind') ? b.output_kind : cur.output_kind, tags: has('tags') ? b.tags : cur.tags, roles: has('roles') ? b.roles : cur.roles,
    };
    const checked = checkDraft(merged, { taxonomy: (await taxonomy(c.env)).slugs, roleKeys: ROLE_KEYS });
    if (!checked.ok) return say(c, 400, checked.code, checked.message);
    const d = checked.draft;
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE agent_skills SET name = ?, purpose = ?, steps_json = ?, allowed_tools_json = ?, output_kind = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind, user.id, s.id),
      ...writeDraftStatements(c.env, s.id, d),
    ]);
  }
  const tax = await taxonomy(c.env);
  return c.json({ skill: await cardOf(c.env, (await skillByUid(c.env, s.uid))!, user, tax, '') });
});

router.post('/skills/:uid/publish', async (c) => {
  const user = await requireAuth(c);
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || !(await mayRead(c.env, s, user))) return noSkill(c);
  if (!(await mayWrite(c.env, s, user))) return say(c, 403, 'not_editor', 'Only this skill\'s editors can publish it.');
  if (s.status === 'retired') return say(c, 409, 'retired', 'A retired skill cannot be published again.');
  const d = await draftParts(c.env, s);
  const checked = checkDraft({ ...d, slug: s.slug }, { taxonomy: (await taxonomy(c.env)).slugs, roleKeys: ROLE_KEYS });
  if (!checked.ok) return say(c, 400, checked.code, checked.message);
  const version = s.current_version + 1;
  const md = toSkillMd(checked.draft, version);
  // The version row and the pointer land together, or neither does; the
  // `current_version = ?` guard refuses a concurrent publish of the same number.
  const res = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE agent_skills SET status = 'published', current_version = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND current_version = ?`).bind(version, user.id, s.id, s.current_version),
    c.env.DB.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.id, version, md, d.name, d.purpose, JSON.stringify(d.steps), JSON.stringify(d.tools), d.output_kind,
      JSON.stringify(checked.draft.tags), JSON.stringify(checked.draft.roles), user.id),
  ]).catch(() => null);
  if (!res || Number(res[0]?.meta?.changes ?? 0) !== 1) return say(c, 409, 'publish_conflict', 'This skill was published by someone else just now. Reload it and try again.');
  const tax = await taxonomy(c.env);
  return c.json({ skill: { ...(await cardOf(c.env, (await skillByUid(c.env, s.uid))!, user, tax, '')), skill_md: md } });
});

// ── An agent's skills (A2, #3956) ───────────────────────────────────────────

const agentName = (a: Pick<AgentRow, 'first_name' | 'last_name' | 'role_key'>) => [a.first_name, a.last_name].filter(Boolean).join(' ') || roleOf(a.role_key)?.name || a.role_key;

/** Where an agent works, as the screens group it: `{ kind, company_name, project_name }`. */
async function scopeLine(env: Env, a: AgentRow) {
  if (a.scope_kind === 'company') {
    const co = await env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?').bind(a.company_id).first<{ company_name: string }>();
    return { kind: 'company' as const, company_name: co?.company_name ?? null, project_name: null };
  }
  const p = await env.DB.prepare('SELECT p.name, c.company_name FROM projects p LEFT JOIN company_profiles c ON c.id = p.company_id WHERE p.id = ?')
    .bind(a.project_id).first<{ name: string; company_name: string | null }>();
  return { kind: 'project' as const, company_name: p?.company_name ?? null, project_name: p?.name ?? null };
}

const refusalWords: Record<AttachCode, string> = {
  not_found: 'There is no such skill.',
  version_not_published: 'Only a published version can be pinned.',
  skill_retired: 'This skill is retired and cannot be added again. An agent that has it keeps it at its pinned version.',
  role_mismatch: 'An agent can only be given skills of its own role.',
  tool_not_approved: 'That skill needs a read tool its sponsor has not approved.',
};
const refuseBlocked = (c: C, b: Blocked, extra: Record<string, unknown> = {}) =>
  say(c, ATTACH_STATUS[b.code], b.code, b.code === 'tool_not_approved' && b.tool ? `That skill needs the ${b.tool.label} read tool, which its sponsor has not approved.` : refusalWords[b.code],
    { ...(b.tool ? { tool: b.tool } : {}), ...extra });

async function agentSkillsDto(env: Env, a: AgentRow) {
  const tax = await taxonomy(env);
  const links = await all<SkillRow & { pinned: number }>(env,
    'SELECT s.*, l.version AS pinned FROM agent_skill_links l JOIN agent_skills s ON s.id = l.skill_id WHERE l.agent_id = ? ORDER BY l.id', a.id);
  const granted = new Set(grantsOf(a.tool_grants_json).map((g) => g.tool));
  const skills = [];
  const tags: Tag[] = [];
  for (const s of links) {
    const v = await versionOf(env, s.id, s.pinned);
    if (!v) continue;
    const p = versionParts(v);
    tags.push(...p.tags);
    skills.push({
      uid: s.uid, scope: s.scope, name: p.name, purpose: p.purpose, steps: p.steps, status: s.status,
      pinned_version: s.pinned, current_version: s.current_version,
      update_available: s.status !== 'retired' && s.pinned < s.current_version,
      tools: p.tools.map((k) => ({ key: k, label: toolLabel(k), approved: granted.has(k) })),
      taxonomy: p.tags.map((t) => ({ slug: t.slug, label: tax.label.get(t.slug) ?? t.slug, level: t.level })),
    });
  }
  return {
    agent: { uid: a.uid, role_key: a.role_key },
    skills,
    // No skills: no radar ("Not recorded"), never eight zeros.
    radar: skills.length ? { axes: axesOf(tags, tax.category) } : null,
    values: await agentValues(env, a),
  };
}

/** The agent and its scope, when the caller can read its team. */
async function readableAgent(c: C, user: User) {
  const a = await agentByUid(c.env, c.req.param('uid') ?? '');
  const scope = a && await scopeOfAgent(c.env, a);
  if (!a || !scope || !(await canRead(c.env, scope, user))) return null;
  return { a, scope };
}

router.get('/agents/:uid/skills/available', async (c) => {
  const user = await requireAuth(c);
  const got = await readableAgent(c, user);
  if (!got) return say(c, 404, 'not_found', 'There is no such agent.');
  const { a } = got;
  const tax = await taxonomy(c.env);
  const companyId = await agentCompanyId(c.env, a);
  const rows = await all<SkillRow>(c.env,
    `SELECT s.* FROM agent_skills s WHERE s.status = 'published' AND s.current_version > 0
       AND (s.scope = 'hq' OR (s.scope = 'company' AND s.company_id = ?)) ORDER BY s.id`, companyId ?? -1);
  const pinned = new Map((await all<{ skill_id: number; version: number }>(c.env, 'SELECT skill_id, version FROM agent_skill_links WHERE agent_id = ?', a.id)).map((l) => [l.skill_id, l.version]));
  const out = [];
  for (const s of rows) {
    const blocked = await attachCheck(c.env, a, s, s.current_version, pinned.get(s.id) ?? null);
    // Only the agent's own role's skills are offered; a tool it lacks is shown, blocked.
    if (blocked && blocked.code !== 'tool_not_approved') continue;
    const card = await cardOf(c.env, s, user, tax, '');
    out.push({ ...card, assigned: pinned.has(s.id), pinned_version: pinned.get(s.id) ?? null, blocked: blocked ? { code: blocked.code, tool: blocked.tool ?? null } : null });
  }
  out.sort((x, y) => y.used_by - x.used_by || x.name.localeCompare(y.name));
  return c.json({ skills: out });
});

router.get('/agents/:uid/skills', async (c) => {
  const user = await requireAuth(c);
  const got = await readableAgent(c, user);
  if (!got) return say(c, 404, 'not_found', 'There is no such agent.');
  return c.json({ can_manage: await canManage(c.env, got.scope, user), ...(await agentSkillsDto(c.env, got.a)) });
});

router.put('/agents/:uid/skills', async (c) => {
  const user = await requireAuth(c);
  const got = await readableAgent(c, user);
  if (!got) return say(c, 404, 'not_found', 'There is no such agent.');
  const { a, scope } = got;
  if (!(await canManage(c.env, scope, user))) return say(c, 403, 'not_manager', 'Only the team\'s editors can change an agent\'s skills.');
  if (a.status === 'removed') return say(c, 409, 'agent_removed', 'This agent was removed.');
  const b = await readBody(c);
  if (!b || !Array.isArray(b.skills) || b.skills.length > 40) return say(c, 400, 'body_invalid', 'Send the agent\'s skills as a list of up to 40.');
  const checked = await checkSkillList(c.env, a, b.skills, (sk) => mayRead(c.env, sk as SkillRow, user));
  if (!checked.ok) return refuseBlocked(c, checked.blocked, { skill_uid: checked.skill_uid });
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM agent_skill_links WHERE agent_id = ? AND skill_id NOT IN (SELECT value FROM json_each(?))').bind(a.id, JSON.stringify(checked.wanted.map((w) => w.s.id))),
    ...checked.wanted.map((w) => linkStatement(c.env, a.id, w.s.id, w.version, user.id)),
  ]);
  return c.json({ can_manage: true, ...(await agentSkillsDto(c.env, a)) });
});

router.get('/skills/:uid/agents', async (c) => {
  const user = await requireAuth(c);
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || !(await mayRead(c.env, s, user))) return noSkill(c);
  const links = await all<AgentRow & { pinned: number }>(c.env,
    `SELECT a.*, l.version AS pinned FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
      WHERE l.skill_id = ? AND a.status <> 'removed' ORDER BY a.id LIMIT 500`, s.id);
  const agents = [];
  for (const a of links) {
    const scope = await scopeOfAgent(c.env, a);
    // A member sees only the agents of the teams they can read: never another company's.
    if (!scope || !(await canRead(c.env, scope, user))) continue;
    agents.push({ uid: a.uid, name: agentName(a), role_key: a.role_key, pinned_version: a.pinned, scope: await scopeLine(c.env, a) });
  }
  agents.sort((x, y) => String(x.scope.company_name ?? '').localeCompare(String(y.scope.company_name ?? ''))
    || String(x.scope.project_name ?? '').localeCompare(String(y.scope.project_name ?? '')) || x.name.localeCompare(y.name));
  return c.json({ agents });
});

/**
 * The live agents the caller might manage: of their companies (and their projects), their own projects; every agent for HQ's admin.
 * With a company chosen in the switcher (`active`), only that company's agents and those on a project with no company, as every
 * founder-ownership read narrows (`projectInActiveCompany`); null means no company chosen.
 */
async function candidateAgents(env: Env, user: User, roles: string[], active: number | null): Promise<AgentRow[]> {
  if (!roles.length) return [];
  if (isAdmin(user)) {
    return all<AgentRow>(env, `SELECT * FROM team_agents WHERE status <> 'removed' AND role_key IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 500`, JSON.stringify(roles));
  }
  return all<AgentRow>(env,
    `SELECT a.* FROM team_agents a LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.status <> 'removed' AND a.role_key IN (SELECT value FROM json_each(?))
        AND (a.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?)
          OR p.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?)
          OR p.founder_id = ?)
        AND (? IS NULL OR COALESCE(a.company_id, p.company_id) IS NULL OR COALESCE(a.company_id, p.company_id) = ?)
      ORDER BY a.id LIMIT 500`, JSON.stringify(roles), user.id, user.id, user.founder_id ?? -1, active, active);
}

router.get('/skills/:uid/assignable', async (c) => {
  const user = await requireAuth(c);
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || !(await mayRead(c.env, s, user))) return noSkill(c);
  const current = s.current_version > 0 ? await versionOf(c.env, s.id, s.current_version) : null;
  const roles = current ? versionParts(current).roles : [];
  const agents = [];
  for (const a of await candidateAgents(c.env, user, roles, await activeCompanyFor(c, user))) {
    const scope = await scopeOfAgent(c.env, a);
    if (!scope || !(await canManage(c.env, scope, user))) continue;
    const pinned = await c.env.DB.prepare('SELECT version FROM agent_skill_links WHERE agent_id = ? AND skill_id = ?').bind(a.id, s.id).first<{ version: number }>();
    // A company skill is assignable only inside its company.
    if (s.scope === 'company' && s.company_id !== await agentCompanyId(c.env, a)) continue;
    const blocked = pinned ? null : await attachCheck(c.env, a, s, s.current_version);
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM agent_skill_links WHERE agent_id = ?').bind(a.id).first<{ n: number }>();
    agents.push({
      uid: a.uid, name: agentName(a), role_key: a.role_key, skill_count: Number(count?.n ?? 0), assigned: !!pinned,
      blocked: blocked ? { code: blocked.code, tool: blocked.tool ?? null } : null, scope: await scopeLine(c.env, a),
    });
  }
  return c.json({ agents });
});

router.post('/skills/:uid/assign', async (c) => {
  const user = await requireAuth(c);
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || !(await mayRead(c.env, s, user))) return noSkill(c);
  const b = await readBody(c);
  const list = Array.isArray(b?.agent_uids) ? b!.agent_uids : Array.isArray(b?.agents) ? b!.agents : null;
  if (!list || list.length < 1 || list.length > 100) return say(c, 400, 'body_invalid', 'Choose between 1 and 100 agents.');
  // Partial: each agent it can is written; each it cannot is named. One agent never refuses the call.
  const refused: Array<{ agent_uid: string; code: string; tool?: { key: string; label: string } }> = [];
  const targets: AgentRow[] = [];
  for (const uid of new Set(list.filter((x: unknown) => typeof x === 'string') as string[])) {
    const a = await agentByUid(c.env, uid);
    const scope = a && await scopeOfAgent(c.env, a);
    if (!a || !scope || a.status === 'removed' || !(await canRead(c.env, scope, user))) { refused.push({ agent_uid: uid, code: 'not_found' }); continue; }
    if (!(await canManage(c.env, scope, user))) { refused.push({ agent_uid: uid, code: 'not_manager' }); continue; }
    const pinned = await c.env.DB.prepare('SELECT version FROM agent_skill_links WHERE agent_id = ? AND skill_id = ?').bind(a.id, s.id).first<{ version: number }>();
    if (pinned) continue;
    const blocked = await attachCheck(c.env, a, s, s.current_version);
    if (blocked) { refused.push({ agent_uid: uid, code: blocked.code, ...(blocked.tool ? { tool: blocked.tool } : {}) }); continue; }
    targets.push(a);
  }
  const res = targets.length ? await c.env.DB.batch(targets.map((a) => c.env.DB.prepare(
    'INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, ?, ?, ?) ON CONFLICT (agent_id, skill_id) DO NOTHING',
  ).bind(a.id, s.id, s.current_version, user.id))) : [];
  const added = res.reduce((n, r) => n + Number(r?.meta?.changes ?? 0), 0);
  return c.json({ added, refused, used_by: await usedBy(c.env, s.id) });
});

// ── Team coverage (A2) ──────────────────────────────────────────────────────

router.get('/:scope/:id/coverage', async (c) => {
  const user = await requireAuth(c);
  const scope = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
  if (!scope) return say(c, 404, 'not_found', 'There is no such team.');
  if (!(await canRead(c.env, scope, user))) return say(c, 403, 'not_member', 'Only the team can see its coverage.');
  const [companyId, projectId] = scopeCols(scope);
  const tax = await taxonomy(c.env);
  const rows = await all<{ taxonomy_json: string }>(c.env,
    `SELECT v.taxonomy_json FROM team_agents a
       JOIN agent_skill_links l ON l.agent_id = a.id
       JOIN agent_skill_versions v ON v.skill_id = l.skill_id AND v.version = l.version
      WHERE a.status <> 'removed' AND a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?`,
    scope.kind, companyId ?? 0, projectId ?? 0);
  const agentAxes = axesOf(rows.flatMap((r) => versionTags(r)), tax.category);
  const people = await peopleAxes(c.env, await teamUserIds(c.env, scope.kind === 'company' ? { kind: 'company', id: scope.id } : { kind: 'project', id: scope.id, founder_id: scope.founder_id }));
  return c.json({
    axes: agentAxes.map((x) => ({ slug: x.slug, label: x.label, people_level: people.get(x.slug) ?? null, agent_level: x.level })),
  });
});

export default router;
