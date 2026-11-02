/**
 * D4161 (#4161, H3 of #4137) — HQ › AI agents › Skills library › Company
 * skills: a Super Admin reads, flags and suspends the skills companies wrote,
 * and never writes one. Mounts itself at `/api/admin/ai-agents/company-skills`.
 *
 *   GET  /?status=published|in_review|flagged|suspended&q=&page=
 *        every `scope = 'company'` skill across companies, 25 a page:
 *        { skills: [Row], page, per_page, total }
 *   GET  /:uid          the SKILL.md, read-only, the open flag or suspension, and its history
 *   POST /:uid/flag     { reason }  the skill keeps running; the company's editors are told why
 *   POST /:uid/suspend  { reason }  the run gate refuses it at once; the editors are told why
 *   POST /:uid/clear    { reason }  lifts the open flag or suspension; the editors are told
 *
 * A Row is { uid, name, company: { uid, name }, project: null, author: { uid, name } | null,
 * area: { slug, label } | null, tools, status, version }. Company skills belong to
 * the whole company (migration 759 has no project column), so `project` is
 * null. `status` is `suspended` or `flagged` while one is open, else the
 * skill's own (`draft`, `published`, `retired`); `in_review` is HQ's review
 * state (H2) and no company skill is ever in it. `version` is null before the
 * first publish, never 0.
 *
 * GATES. Super Admin only (`requireSuperAdmin`, 403 otherwise). Every action
 * takes a reason of 10 to 500 characters (400 `reason_required`) and writes
 * the admin audit row (`services/adminAudit.ts`) with it, the skill and the
 * status before and after. A person is `{ uid, name }`, never an email.
 *
 * NO WRITE PATH TO A COMPANY'S SKILL. Nothing here touches `agent_skills`,
 * `agent_skill_versions`, `agent_skill_tags` or `agent_skill_roles`; the only
 * table written is `agent_skill_moderation` (migration 202611022055). And
 * `routes/team_skills.ts` refuses a Super Admin who is not the company's own
 * editor (`canEditAsMember`). When the company publishes a new version, that
 * version starts clean; see `services/agents/skillModeration.ts` for the gate.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { notify } from '../services/notify';
import { toSkillMd, type OutputKind, type Tag } from '../services/agents/skills';
import { skillByUid, taxonomyMaps, versionOf, type SkillRow } from '../services/agents/skillLinks';
import { companyEditorIds, openModeration, type ModerationAction, type ModerationRow } from '../services/agents/skillModeration';
import { RADAR_AXES } from '../services/skillsTaxonomySchema';

type C = Context<{ Bindings: Env }>;

const adminCompanySkills = new Hono<{ Bindings: Env }>();

export const PER_PAGE = 25;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
const STATUSES = ['published', 'in_review', 'flagged', 'suspended'] as const;

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
const say = (c: C, status: number, code: string, message: string) => refuse(c, status, { code, message });
const noSkill = (c: C) => say(c, 404, 'not_found', 'There is no such company skill.');

function reasonOf(body: unknown): string | null {
  const raw = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : null;
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return reason.length >= REASON_MIN && reason.length <= REASON_MAX ? reason : null;
}
const refuseReason = (c: C) => say(c, 400, 'reason_required', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters. The company's editors see it, and it is recorded.`);

/** The effective status: an open suspension or flag, else the skill's own. */
const statusOf = (s: Pick<SkillRow, 'status'>, open: Pick<ModerationRow, 'action'> | null) =>
  open?.action === 'suspend' ? 'suspended' : open?.action === 'flag' ? 'flagged' : s.status;

type Parts = { name: string; purpose: string; steps: string[]; tools: string[]; output_kind: OutputKind; tags: Tag[]; roles: string[] };

/** What HQ reads: the published version, or the draft before the first publish. */
async function shownParts(env: Env, s: SkillRow): Promise<Parts> {
  const v = s.current_version > 0 ? await versionOf(env, s.id, s.current_version) : null;
  if (v) {
    return { name: v.name, purpose: v.purpose, steps: parse(v.steps_json, []), tools: parse(v.allowed_tools_json, []),
      output_kind: v.output_kind as OutputKind, tags: parse(v.taxonomy_json, []), roles: parse(v.roles_json, []) };
  }
  const tags = ((await env.DB.prepare('SELECT taxonomy_skill_slug AS slug, level FROM agent_skill_tags WHERE skill_id = ? ORDER BY rowid').bind(s.id).all<Tag>()).results ?? []);
  const roles = ((await env.DB.prepare('SELECT role_key FROM agent_skill_roles WHERE skill_id = ? ORDER BY rowid').bind(s.id).all<{ role_key: string }>()).results ?? []).map((r) => r.role_key);
  return { name: s.name, purpose: s.purpose, steps: parse(s.steps_json, []), tools: parse(s.allowed_tools_json, []), output_kind: s.output_kind as OutputKind, tags, roles };
}

/** A skill's area: the radar axis of its first taxonomy tag; null when it has none. */
function areaOf(tags: readonly Tag[], category: ReadonlyMap<string, string>) {
  for (const t of tags) {
    const axis = RADAR_AXES.find((a) => a.slug === category.get(t.slug));
    if (axis) return { slug: axis.slug, label: axis.label };
  }
  return null;
}

type ListRow = SkillRow & { company_uid: string; company_name: string; author_uid: string | null; author_name: string | null; effective: string };

adminCompanySkills.get('/', async (c) => {
  await requireSuperAdmin(c);
  const status = c.req.query('status') ?? '';
  if (status && !(STATUSES as readonly string[]).includes(status)) return say(c, 400, 'status_invalid', 'Filter by published, in review, flagged or suspended.');
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100);
  const pageRaw = c.req.query('page') ?? '1';
  if (!/^[1-9][0-9]{0,4}$/.test(pageRaw)) return say(c, 400, 'page_invalid', 'Pages are numbered from 1.');
  const page = Number(pageRaw);
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  // Two literal queries over the same WHERE (no SQL text is interpolated): the count, then the page.
  const binds = [status, status, q, like, like];
  const total = Number((await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_skills s
       JOIN company_profiles co ON co.id = s.company_id
       LEFT JOIN agent_skill_moderation m ON m.skill_id = s.id AND m.cleared_at IS NULL
      WHERE s.scope = 'company'
        AND (? = '' OR (CASE m.action WHEN 'suspend' THEN 'suspended' WHEN 'flag' THEN 'flagged' ELSE s.status END) = ?)
        AND (? = '' OR lower(s.name) LIKE ? ESCAPE '\\' OR lower(co.company_name) LIKE ? ESCAPE '\\')`,
  ).bind(...binds).first<{ n: number }>())?.n ?? 0);
  const rows = ((await c.env.DB.prepare(
    `SELECT s.*, co.uid AS company_uid, co.company_name, u.uid AS author_uid, u.name AS author_name,
            CASE m.action WHEN 'suspend' THEN 'suspended' WHEN 'flag' THEN 'flagged' ELSE s.status END AS effective
       FROM agent_skills s
       JOIN company_profiles co ON co.id = s.company_id
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN agent_skill_moderation m ON m.skill_id = s.id AND m.cleared_at IS NULL
      WHERE s.scope = 'company'
        AND (? = '' OR (CASE m.action WHEN 'suspend' THEN 'suspended' WHEN 'flag' THEN 'flagged' ELSE s.status END) = ?)
        AND (? = '' OR lower(s.name) LIKE ? ESCAPE '\\' OR lower(co.company_name) LIKE ? ESCAPE '\\')
      ORDER BY CASE m.action WHEN 'suspend' THEN 0 WHEN 'flag' THEN 1 ELSE 2 END, s.updated_at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
  ).bind(...binds, PER_PAGE, (page - 1) * PER_PAGE).all<ListRow>()).results ?? []);
  const tax = await taxonomyMaps(c.env);
  const skills = [];
  for (const s of rows) {
    const p = await shownParts(c.env, s);
    skills.push({
      uid: s.uid, name: p.name,
      company: { uid: s.company_uid, name: s.company_name },
      project: null,
      author: s.author_uid ? { uid: s.author_uid, name: s.author_name } : null,
      area: areaOf(p.tags, tax.category),
      tools: p.tools,
      status: s.effective,
      version: s.current_version || null,
    });
  }
  return c.json({ skills, page, per_page: PER_PAGE, total });
});

type Person = { uid: string; name: string | null } | null;
async function personOf(env: Env, id: number | null): Promise<Person> {
  if (id == null) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(id).first<{ uid: string; name: string | null }>();
  return u ? { uid: u.uid, name: u.name } : null;
}

async function moderationDto(env: Env, m: ModerationRow) {
  return {
    action: m.action, reason: m.reason, version: m.version || null, by: await personOf(env, m.created_by), at: m.created_at,
    cleared: m.cleared_at ? { at: m.cleared_at, how: m.cleared_how, reason: m.clear_reason, by: await personOf(env, m.cleared_by) } : null,
  };
}

async function companySkill(c: C): Promise<(SkillRow & { company_uid: string; company_name: string }) | null> {
  const s = await skillByUid(c.env, c.req.param('uid'));
  if (!s || s.scope !== 'company' || s.company_id == null) return null;
  const co = await c.env.DB.prepare('SELECT uid, company_name FROM company_profiles WHERE id = ?').bind(s.company_id).first<{ uid: string; company_name: string }>();
  return co ? { ...s, company_uid: co.uid, company_name: co.company_name } : null;
}

adminCompanySkills.get('/:uid', async (c) => {
  await requireSuperAdmin(c);
  const s = await companySkill(c);
  if (!s) return noSkill(c);
  const p = await shownParts(c.env, s);
  const current = s.current_version > 0 ? await versionOf(c.env, s.id, s.current_version) : null;
  const tax = await taxonomyMaps(c.env);
  const open = await openModeration(c.env, s.id);
  const history = ((await c.env.DB.prepare('SELECT * FROM agent_skill_moderation WHERE skill_id = ? ORDER BY id DESC LIMIT 50').bind(s.id).all<ModerationRow>()).results ?? []);
  return c.json({
    skill: {
      uid: s.uid, name: p.name, purpose: p.purpose, steps: p.steps, tools: p.tools, output_kind: p.output_kind,
      company: { uid: s.company_uid, name: s.company_name }, project: null,
      author: await personOf(c.env, s.created_by),
      area: areaOf(p.tags, tax.category),
      status: statusOf(s, open), version: s.current_version || null,
      // Read-only: the published SKILL.md, or the draft's before the first publish.
      skill_md: current?.skill_md ?? toSkillMd(p, 0),
      read_only: true,
    },
    moderation: open ? await moderationDto(c.env, open) : null,
    history: await Promise.all(history.map((m) => moderationDto(c.env, m))),
  });
});

const WORDS: Record<ModerationAction | 'clear', { title: (n: string) => string; type: string; audit: string }> = {
  flag: { title: (n) => `HQ flagged your skill "${n}". It keeps running.`, type: 'agent_skill_flagged', audit: 'agent_skill_flagged' },
  suspend: { title: (n) => `HQ suspended your skill "${n}". Agents stopped using it.`, type: 'agent_skill_suspended', audit: 'agent_skill_suspended' },
  clear: { title: (n) => `HQ lifted its flag or suspension on your skill "${n}".`, type: 'agent_skill_moderation_cleared', audit: 'agent_skill_moderation_cleared' },
};

/** Tell the company's editors, in their inbox, with the reason. Best-effort: the action has happened. */
async function tellEditors(env: Env, s: SkillRow & { company_uid: string; company_name: string }, kind: ModerationAction | 'clear', reason: string) {
  for (const userId of await companyEditorIds(env, s.company_id!)) {
    await notify(env, {
      userId, type: WORDS[kind].type, title: WORDS[kind].title(s.name), body: reason,
      link: `/account/companies/${encodeURIComponent(s.company_uid)}/settings/team?tab=skills&skill=${s.uid}`, payload: { skill_uid: s.uid, action: kind, reason }, channels: ['in_app'],
    });
  }
}

async function audit(env: Env, admin: User, kind: ModerationAction | 'clear', s: SkillRow & { company_uid: string }, reason: string, before: string, after: string) {
  await logAdminAction(env, admin.id, admin.email, WORDS[kind].audit, {
    skill_uid: s.uid, skill_name: s.name, company_uid: s.company_uid, reason, before: { status: before }, after: { status: after },
  });
}

async function act(c: C, kind: ModerationAction) {
  const admin = await requireSuperAdmin(c);
  const s = await companySkill(c);
  if (!s) return noSkill(c);
  const reason = reasonOf(await c.req.json().catch(() => null));
  if (!reason) return refuseReason(c);
  const open = await openModeration(c.env, s.id);
  if (open?.action === 'suspend') return say(c, 409, 'already_suspended', 'This skill is already suspended. Lift the suspension first to flag it instead.');
  if (open?.action === 'flag' && kind === 'flag') return say(c, 409, 'already_flagged', 'This skill is already flagged.');
  const before = statusOf(s, open);
  // A suspension replaces an open flag: the flag closes with the suspension's reason.
  const stmts = [
    ...(open ? [c.env.DB.prepare(`UPDATE agent_skill_moderation SET cleared_at = CURRENT_TIMESTAMP, cleared_by = ?, cleared_how = 'hq', clear_reason = ?
        WHERE id = ? AND cleared_at IS NULL`).bind(admin.id, reason, open.id)] : []),
    c.env.DB.prepare('INSERT INTO agent_skill_moderation (skill_id, action, version, reason, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(s.id, kind, s.current_version, reason, admin.id),
  ];
  const done = await c.env.DB.batch(stmts).catch(() => null);
  if (!done) return say(c, 409, 'moderation_conflict', 'Someone changed this skill\'s moderation just now. Reload it and try again.');
  const after = kind === 'suspend' ? 'suspended' : 'flagged';
  await audit(c.env, admin, kind, s, reason, before, after);
  await tellEditors(c.env, s, kind, reason);
  const now = await openModeration(c.env, s.id);
  return c.json({ status: after, moderation: now ? await moderationDto(c.env, now) : null });
}

adminCompanySkills.post('/:uid/flag', (c) => act(c, 'flag'));
adminCompanySkills.post('/:uid/suspend', (c) => act(c, 'suspend'));

adminCompanySkills.post('/:uid/clear', async (c) => {
  const admin = await requireSuperAdmin(c);
  const s = await companySkill(c);
  if (!s) return noSkill(c);
  const reason = reasonOf(await c.req.json().catch(() => null));
  if (!reason) return refuseReason(c);
  const open = await openModeration(c.env, s.id);
  if (!open) return say(c, 409, 'nothing_to_clear', 'This skill is neither flagged nor suspended.');
  const res = await c.env.DB.prepare(`UPDATE agent_skill_moderation SET cleared_at = CURRENT_TIMESTAMP, cleared_by = ?, cleared_how = 'hq', clear_reason = ?
      WHERE id = ? AND cleared_at IS NULL`).bind(admin.id, reason, open.id).run();
  if (Number(res.meta?.changes ?? 0) !== 1) return say(c, 409, 'moderation_conflict', 'Someone changed this skill\'s moderation just now. Reload it and try again.');
  await audit(c.env, admin, 'clear', s, reason, statusOf(s, open), s.status);
  await tellEditors(c.env, s, 'clear', reason);
  return c.json({ status: s.status, moderation: null });
});

export default adminCompanySkills;
export const mount: RouteMount = { path: '/api/admin/ai-agents/company-skills', router: adminCompanySkills };
