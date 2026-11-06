/**
 * D4160 (#4160, H2 of #4137) — HQ › AI agents › Skills library › From Axal:
 * the lifecycle of Axal's own skills. Mounts itself at
 * `/api/admin/ai-agents/skills`. Super Admin only.
 *
 *   GET  /                           the library: [Row], with status, version, agents pinned, pass rate, last eval
 *   GET  /library                    D4225: the "From Axal" library files, each with its area, level, check and whether it is in the store
 *   POST /library/seed               D4225: { reason } — every library skill not in the store becomes a draft with its golden cases
 *   GET  /:uid                       one skill: its draft, status, review, golden cases and results, versions, retirement
 *   GET  /:uid/diff?from=vN&to=draft|vM   the frontmatter fields that changed and the steps, kept, added and removed
 *   POST /:uid/review                { reviewer_uid }   ask a named Super Admin to review the current draft
 *   POST /:uid/review/approve        { comment? }       the named reviewer approves; never the draft's author
 *   POST /:uid/review/request-changes { comment }       the named reviewer sends it back
 *   PUT  /:uid/cases                 { cases: [{ uid?, name, input, expect }], reason }   the skill's golden cases
 *   POST /:uid/evals                 { models? }        run every live case on each model, through `run()`, charged to HQ
 *   POST /evals/published            { models?, uid? }  D1612 part D (#3954): every published Axal skill's golden cases (its
 *                                    starter case and HQ's live ones) on its CURRENT version; a case that passed and now
 *                                    fails is a regression, told to HQ once → { skills, results, regressions }
 *                                    D4668 (#4668): without `uid`, a CAMPAIGN — the first press starts one (its manifest:
 *                                    every eligible published skill at its current version) and runs its first batch of at
 *                                    most 20; `{ campaign: uid }` runs the next batch. → { skills, results, regressions,
 *                                    evaluated, campaign: { uid, status, total, done, skipped, pending, results, … } }
 *                                    400 models_fixed · 404 campaign_not_found · 409 campaign_busy, campaign_cancelled, models_unavailable
 *   GET  /evals/published/campaigns/:uid         D4668: a campaign's progress → { campaign }
 *   POST /evals/published/campaigns/:uid/cancel  D4668: final; what it ran stays → { campaign }; 409 campaign_complete
 *   POST /:uid/retire                { replacement_uid, reason }  → { pinned_agents }
 *   POST /bulk                       { action: publish | retire | evals, uids, reason, replacement_uid?, models? }
 *                                    each item done or refused on its own: { results: [{ uid, ok, code?, message? }] }
 *
 * Creating and editing a draft stay `routes/team_skills.ts`'s (`POST /skills`,
 * `PATCH /skills/:uid`), and so does the single publish (`POST
 * /skills/:uid/publish`); all three refuse a write-capable tool (400
 * `tool_not_read_only`, `{ tool }`), and publish refuses an HQ draft with no
 * approval (409 `needs_approval`) or below 9 of 10 golden-case runs (409
 * `golden_cases_failing`). See `services/agents/skillLifecycle.ts`.
 *
 * Every change writes the admin audit row (`logAdminAction`) with the reason,
 * and the state before and after. A person is `{ uid, name }`, never an email.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { isSuperAdmin, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { notify } from '../services/notify';
import { newUid } from './_t13t14t15_helpers';
import { agentModels } from './team_agents';
import { skillByUid, taxonomyMaps, versionOf, type SkillRow, type VersionRow } from '../services/agents/skillLinks';
import { draftParts, draftPartsOf, publishDraft } from '../services/agents/skillPublish';
import { pinTokenMap } from '../services/agents/runCost';
import {
  CASES_MAX, PASS_BAR, approvalFor, checkCase, diffParts, draftHash, evalSummary, lifecycleStatus, meetsBar, openReview, pinnedAgents, runCase,
  type CaseExpect, type CaseInput, type DraftParts, type ReviewRow,
} from '../services/agents/skillLifecycle';
import { RADAR_AXES } from '../services/skillsTaxonomySchema';
import { campaignProgress, cancelCampaign, continueCampaign, evaluatePublished, startCampaign } from '../services/agents/skillEval';
import { areaOf, checkLibrary, nameOfSlug, readLibrarySkill, seedLibrary } from '../services/agents/skillLibrarySeed';
import type { OutputKind, Tag } from '../services/agents/skills';

type C = Context<{ Bindings: Env }>;
const adminHqSkills = new Hono<{ Bindings: Env }>();

export const REASON_MIN = 10;
export const REASON_MAX = 500;
const BULK_MAX = 50;
const MODELS_MAX = 5;
const LEVELS = ['aware', 'working', 'proficient', 'advanced', 'expert'];

const parse = <T>(json: string | null | undefined, fallback: T): T => { try { const v = JSON.parse(json ?? ''); return v ?? fallback; } catch { return fallback; } };
const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) => refuse(c, status, { code, message, extra });
const noSkill = (c: C) => say(c, 404, 'not_found', 'There is no such Axal skill.');
const body = async (c: C): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; };

function reasonOf(raw: unknown): string | null {
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return reason.length >= REASON_MIN && reason.length <= REASON_MAX ? reason : null;
}
const refuseReason = (c: C) => say(c, 400, 'reason_required', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters. It is recorded with the change.`);

async function hqSkill(env: Env, uid: unknown): Promise<SkillRow | null> {
  const s = await skillByUid(env, uid);
  return s && s.scope === 'hq' ? s : null;
}

type Person = { uid: string; name: string | null } | null;
async function personOf(env: Env, id: number | null | undefined): Promise<Person> {
  if (id == null) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(id).first<{ uid: string; name: string | null }>();
  return u ? { uid: u.uid, name: u.name } : null;
}

async function audit(env: Env, admin: User, action: string, s: Pick<SkillRow, 'uid' | 'name'>, reason: string | null, before: unknown, after: unknown, extra: Record<string, unknown> = {}) {
  await logAdminAction(env, admin.id, admin.email, action, { skill_uid: s.uid, skill_name: s.name, reason, before, after, ...extra });
}

const versionParts = (v: VersionRow): DraftParts => ({
  name: v.name, purpose: v.purpose, steps: parse(v.steps_json, []), tools: parse(v.allowed_tools_json, []), output_kind: v.output_kind as OutputKind,
  tags: parse(v.taxonomy_json, []), roles: parse(v.roles_json, []),
});

function areaAndLevel(p: DraftParts, category: ReadonlyMap<string, string>) {
  const axis = p.tags.map((t) => RADAR_AXES.find((a) => a.slug === category.get(t.slug))).find(Boolean);
  const level = p.tags.reduce<string | null>((best, t) => (best == null || LEVELS.indexOf(t.level) > LEVELS.indexOf(best) ? t.level : best), null);
  return { area: axis ? { slug: axis.slug, label: axis.label } : null, level };
}

async function reviewDto(env: Env, r: ReviewRow | null, hash: string) {
  if (!r) return null;
  return {
    status: r.status, current: r.draft_hash === hash, comment: r.comment, requested_at: r.requested_at, decided_at: r.decided_at,
    requested_by: await personOf(env, r.requested_by), reviewer: await personOf(env, r.reviewer_id),
  };
}

// ── The library ─────────────────────────────────────────────────────────────

type LibraryRow = SkillRow & {
  tags_json: string; role_keys_json: string; open_hash: string | null; agents: number; live_cases: number;
};

adminHqSkills.get('/', async (c) => {
  await requireSuperAdmin(c);
  const pageRaw = c.req.query('page');
  const page = pageRaw == null ? null : Number(pageRaw);
  if (page != null && (!Number.isSafeInteger(page) || page < 1)) return c.json({ detail: 'Invalid page' }, 400);

  const env = c.env;
  // Read the ordered draft inputs together so their hashes match the detail route.
  const [result, tax] = await Promise.all([
    env.DB.prepare(`SELECT s.*,
      (SELECT json_group_array(json_object('slug', t.taxonomy_skill_slug, 'level', t.level))
        FROM (SELECT taxonomy_skill_slug, level FROM agent_skill_tags WHERE skill_id = s.id ORDER BY rowid) t) AS tags_json,
      (SELECT json_group_array(r.role_key)
        FROM (SELECT role_key FROM agent_skill_roles WHERE skill_id = s.id ORDER BY rowid) r) AS role_keys_json,
      (SELECT draft_hash FROM agent_skill_reviews WHERE skill_id = s.id AND status = 'requested') AS open_hash,
      (SELECT COUNT(*) FROM agent_skill_links l JOIN team_agents a ON a.id = l.agent_id
        WHERE l.skill_id = s.id AND a.status <> 'removed') AS agents,
      (SELECT COUNT(*) FROM agent_skill_cases WHERE skill_id = s.id AND removed_at IS NULL) AS live_cases
    FROM agent_skills s WHERE s.scope = 'hq' ORDER BY s.name, s.id LIMIT ? OFFSET ?`)
      .bind(page == null ? -1 : 10, page == null ? 0 : (page - 1) * 10).all<LibraryRow>(),
    taxonomyMaps(env),
  ]);
  const rows = result.results ?? [];
  const drafts = await Promise.all(rows.map(async (row) => {
    const draft = draftParts(row, parse<Tag[]>(row.tags_json, []), parse<string[]>(row.role_keys_json, []));
    return { row, draft, hash: await draftHash(draft) };
  }));

  // Only the latest result per case/model counts. A model run solely on a
  // removed case still counts towards the denominator, as on the detail page.
  const [evalResult, tokens] = await Promise.all([
    env.DB.prepare(`WITH latest AS (
        SELECT MAX(r.id) AS id
        FROM json_each(?) j JOIN agent_skill_eval_results r
          ON r.skill_id = CAST(j.key AS INTEGER) AND r.draft_hash = j.value
        GROUP BY r.skill_id, r.case_id, r.model_id
      )
      SELECT r.skill_id, COUNT(DISTINCT r.model_id) AS models,
        SUM(CASE WHEN k.id IS NOT NULL AND r.result = 'pass' THEN 1 ELSE 0 END) AS pass,
        MAX(r.run_at) AS last_run
      FROM latest JOIN agent_skill_eval_results r ON r.id = latest.id
      LEFT JOIN agent_skill_cases k ON k.id = r.case_id AND k.skill_id = r.skill_id AND k.removed_at IS NULL
      GROUP BY r.skill_id`).bind(JSON.stringify(Object.fromEntries(drafts.map(({ row, hash }) => [row.id, hash]))))
      .all<{ skill_id: number; models: number; pass: number; last_run: string }>(),
    pinTokenMap(env, rows.filter((s) => s.current_version).map((s) => ({ skill_id: s.id, version: s.current_version }))),
  ]);
  const evals = new Map((evalResult.results ?? []).map((r) => [r.skill_id, r]));
  const skills = drafts.map(({ row, draft, hash }) => {
    const summary = evals.get(row.id);
    const pass = summary?.pass ?? 0;
    const total = row.live_cases * (summary?.models ?? 0);
    return {
      uid: row.uid, name: draft.name, ...areaAndLevel(draft, tax.category),
      status: lifecycleStatus(row.status, row.open_hash ? { draft_hash: row.open_hash } : null, hash),
      version: row.current_version || null, agents: row.agents,
      tokens_per_run: tokens.get(`${row.id}:${row.current_version}`) ?? null,
      golden: { pass, total, meets_bar: meetsBar(pass, total) }, last_eval: summary?.last_run ?? null,
    };
  });
  return c.json({ skills, pass_bar: PASS_BAR, next_page: page != null && rows.length === 10 ? page + 1 : null });
});

// D4225 (#4225): the "From Axal" library. Before `/:uid`, so `library` is never read as a skill uid.
adminHqSkills.get('/library', async (c) => {
  await requireSuperAdmin(c);
  const tax = await taxonomyMaps(c.env);
  const present = new Map(((await c.env.DB.prepare("SELECT slug, status FROM agent_skills WHERE scope = 'hq' AND company_id IS NULL").all<{ slug: string; status: string }>()).results ?? []).map((r) => [r.slug, r.status]));
  const skills = checkLibrary(new Set(tax.category.keys())).map((x) => {
    const raw = readLibrarySkill(x.entry.skill_md);
    const tags = (raw?.tags as Array<{ slug: string; level: string }> | undefined) ?? [];
    const { area, level } = areaOf(tags, (s) => tax.category.get(s) ?? null);
    return {
      slug: x.entry.slug, name: nameOfSlug(x.entry.slug), area, level, cases: x.entry.cases.length,
      check: x.ok ? { ok: true } : { ok: false, code: x.code, message: x.message },
      in_store: present.get(x.entry.slug) ?? null,
    };
  });
  return c.json({ skills });
});

adminHqSkills.post('/library/seed', async (c) => {
  const admin = await requireSuperAdmin(c);
  const b = await body(c);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) return say(c, 400, 'reason_required', 'Say why the library is being seeded.');
  const lines = await seedLibrary(c.env, Number(admin.id), reason.slice(0, 500));
  return c.json({ seeded: lines, created: lines.filter((l) => l.outcome === 'created').length, refused: lines.filter((l) => l.outcome === 'refused').length });
});

adminHqSkills.get('/:uid', async (c) => {
  await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  const d = await draftPartsOf(c.env, s);
  const hash = await draftHash(d);
  const open = await openReview(c.env, s.id);
  const history = (await c.env.DB.prepare('SELECT * FROM agent_skill_reviews WHERE skill_id = ? ORDER BY id DESC LIMIT 20').bind(s.id).all<ReviewRow>()).results ?? [];
  const versions = (await c.env.DB.prepare('SELECT version, published_at, published_by FROM agent_skill_versions WHERE skill_id = ? ORDER BY version DESC')
    .bind(s.id).all<{ version: number; published_at: string; published_by: number }>()).results ?? [];
  const cases = (await c.env.DB.prepare('SELECT uid, name, input_json, expect_json FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
    .bind(s.id).all<{ uid: string; name: string; input_json: string; expect_json: string }>()).results ?? [];
  const retired = await c.env.DB.prepare(`SELECT r.reason, r.pinned_agents, r.retired_at, r.retired_by, s.uid AS replacement_uid, s.name AS replacement_name
      FROM agent_skill_retirements r JOIN agent_skills s ON s.id = r.replacement_skill_id WHERE r.skill_id = ?`).bind(s.id)
    .first<{ reason: string; pinned_agents: number; retired_at: string; retired_by: number; replacement_uid: string; replacement_name: string }>();
  const tax = await taxonomyMaps(c.env);
  return c.json({
    skill: {
      uid: s.uid, ...d, ...areaAndLevel(d, tax.category),
      status: lifecycleStatus(s.status, open, hash), version: s.current_version || null, draft_hash: hash,
      agents: await pinnedAgents(c.env, s.id), author: await personOf(c.env, s.created_by), updated_by: await personOf(c.env, s.updated_by),
    },
    review: { open: await reviewDto(c.env, open, hash), approved: !!(await approvalFor(c.env, s.id, hash)), history: await Promise.all(history.map((r) => reviewDto(c.env, r, hash))) },
    cases: cases.map((k) => ({ uid: k.uid, name: k.name, input: parse(k.input_json, {}), expect: parse(k.expect_json, {}) })),
    evals: { ...(await evalSummary(c.env, s.id, hash)), pass_bar: PASS_BAR },
    versions: await Promise.all(versions.map(async (v) => ({ version: v.version, published_at: v.published_at, by: await personOf(c.env, v.published_by) }))),
    retired: retired ? {
      reason: retired.reason, pinned_agents: retired.pinned_agents, at: retired.retired_at, by: await personOf(c.env, retired.retired_by),
      replacement: { uid: retired.replacement_uid, name: retired.replacement_name },
    } : null,
  });
});

adminHqSkills.get('/:uid/diff', async (c) => {
  await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  const side = async (raw: string | undefined, fallback: string): Promise<DraftParts | null> => {
    const v = (raw ?? fallback).trim();
    if (v === 'draft') return draftPartsOf(c.env, s);
    const m = /^v([1-9][0-9]{0,5})$/.exec(v);
    const row = m ? await versionOf(c.env, s.id, Number(m[1])) : null;
    return row ? versionParts(row) : null;
  };
  const fromDefault = s.current_version > 0 ? `v${s.current_version}` : 'draft';
  const from = await side(c.req.query('from'), fromDefault);
  const to = await side(c.req.query('to'), 'draft');
  if (!from || !to) return say(c, 400, 'version_unknown', 'Compare a published version (v1, v2, …) or the draft.');
  return c.json({ from: c.req.query('from') ?? fromDefault, to: c.req.query('to') ?? 'draft', ...diffParts(from, to) });
});

// ── Review ──────────────────────────────────────────────────────────────────

adminHqSkills.post('/:uid/review', async (c) => {
  const admin = await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  if (s.status === 'retired') return say(c, 409, 'retired', 'A retired skill is not reviewed.');
  const b = await body(c);
  const reviewer = typeof b.reviewer_uid === 'string'
    ? await c.env.DB.prepare('SELECT id, uid, name, role, (SELECT 1 FROM super_admins sa WHERE sa.user_id = users.id) AS is_super_admin FROM users WHERE uid = ?')
      .bind(b.reviewer_uid).first<{ id: number; uid: string; name: string | null; role: string; is_super_admin: number | null }>()
    : null;
  if (!reviewer || !isSuperAdmin(reviewer as any)) return say(c, 422, 'reviewer_invalid', 'Name a Super Admin to review the draft.');
  // The author is never their own reviewer: not who asks, not who last wrote the draft.
  if (reviewer.id === admin.id || reviewer.id === s.updated_by) return say(c, 422, 'reviewer_is_author', 'A second Super Admin reviews the draft, not its author.');
  const hash = await draftHash(await draftPartsOf(c.env, s));
  const open = await openReview(c.env, s.id);
  if (open && open.draft_hash === hash) return say(c, 409, 'review_open', 'A review of this draft is already open.');
  const done = await c.env.DB.batch([
    // A review left open on an older text is withdrawn: it was asked about another draft.
    ...(open ? [c.env.DB.prepare("UPDATE agent_skill_reviews SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'requested'").bind(open.id)] : []),
    c.env.DB.prepare('INSERT INTO agent_skill_reviews (skill_id, draft_hash, requested_by, reviewer_id) VALUES (?, ?, ?, ?)').bind(s.id, hash, admin.id, reviewer.id),
  ]).catch(() => null);
  if (!done) return say(c, 409, 'review_conflict', 'Someone asked for a review of this skill just now. Reload it.');
  await audit(c.env, admin, 'agent_skill_review_requested', s, null, { status: lifecycleStatus(s.status, open, hash) }, { status: 'in_review' }, { reviewer: { uid: reviewer.uid, name: reviewer.name } });
  await notify(c.env, { userId: reviewer.id, type: 'agent_skill_review_requested', title: `Review the Axal skill "${s.name}"`, body: null, link: null, payload: { skill_uid: s.uid }, channels: ['in_app'] });
  return c.json({ status: 'in_review', review: await reviewDto(c.env, await openReview(c.env, s.id), hash) }, 201);
});

async function decide(c: C, decision: 'approved' | 'changes_requested') {
  const admin = await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  const b = await body(c);
  const comment = typeof b.comment === 'string' ? b.comment.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
  if (decision === 'changes_requested' && comment.length < REASON_MIN) return say(c, 400, 'comment_required', `Say what to change, in at least ${REASON_MIN} characters.`);
  const hash = await draftHash(await draftPartsOf(c.env, s));
  const open = await openReview(c.env, s.id);
  if (!open) return say(c, 409, 'no_review', 'No review of this skill is open.');
  if (open.draft_hash !== hash) return say(c, 409, 'review_stale', 'The draft changed after the review was asked for. Request a new review.');
  // No self-approval: the author (who asked, or who last wrote the draft) never decides.
  if (admin.id === open.requested_by || admin.id === s.updated_by) return say(c, 403, 'self_approval', 'The draft\'s author cannot approve it. A second Super Admin does.');
  if (admin.id !== open.reviewer_id) return say(c, 403, 'not_reviewer', 'Only the Super Admin asked to review this draft decides it.');
  const res = await c.env.DB.prepare("UPDATE agent_skill_reviews SET status = ?, comment = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'requested'")
    .bind(decision, comment || null, open.id).run();
  if (Number(res.meta?.changes ?? 0) !== 1) return say(c, 409, 'review_conflict', 'This review was decided just now. Reload it.');
  await audit(c.env, admin, decision === 'approved' ? 'agent_skill_review_approved' : 'agent_skill_review_changes_requested', s, comment || null,
    { status: 'in_review' }, { status: 'draft', review: decision });
  await notify(c.env, {
    userId: open.requested_by, type: `agent_skill_review_${decision}`, channels: ['in_app'], link: null, payload: { skill_uid: s.uid },
    title: decision === 'approved' ? `"${s.name}" was approved and can be published` : `Changes were asked for on "${s.name}"`, body: comment || null,
  });
  return c.json({ status: 'draft', review: await reviewDto(c.env, await c.env.DB.prepare('SELECT * FROM agent_skill_reviews WHERE id = ?').bind(open.id).first<ReviewRow>(), hash) });
}
adminHqSkills.post('/:uid/review/approve', (c) => decide(c, 'approved'));
adminHqSkills.post('/:uid/review/request-changes', (c) => decide(c, 'changes_requested'));

// ── Golden cases ────────────────────────────────────────────────────────────

adminHqSkills.put('/:uid/cases', async (c) => {
  const admin = await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  const b = await body(c);
  const reason = reasonOf(b.reason);
  if (!reason) return refuseReason(c);
  if (!Array.isArray(b.cases) || b.cases.length > CASES_MAX) return say(c, 400, 'cases_invalid', `Send the skill's golden cases as a list of up to ${CASES_MAX}.`);
  const live = (await c.env.DB.prepare('SELECT id, uid FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL').bind(s.id).all<{ id: number; uid: string }>()).results ?? [];
  const keep = new Set<string>();
  const stmts = [];
  for (const [i, raw] of b.cases.entries()) {
    const checked = checkCase(raw);
    if (!checked.ok) return say(c, 400, checked.code, checked.message, { index: i });
    const existing = typeof raw.uid === 'string' ? live.find((l) => l.uid === raw.uid) : null;
    // A case is never edited in place: its results belong to its text. A changed case is a new one.
    if (existing) { keep.add(existing.uid); continue; }
    stmts.push(c.env.DB.prepare('INSERT INTO agent_skill_cases (uid, skill_id, name, input_json, expect_json, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newUid(), s.id, checked.name, JSON.stringify(checked.input), JSON.stringify(checked.expect), admin.id));
  }
  const removed = live.filter((l) => !keep.has(l.uid));
  stmts.push(...removed.map((l) => c.env.DB.prepare('UPDATE agent_skill_cases SET removed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(l.id)));
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env, admin, 'agent_skill_cases_set', s, reason, { cases: live.length }, { cases: keep.size + (stmts.length - removed.length) });
  const hash = await draftHash(await draftPartsOf(c.env, s));
  return c.json({ evals: { ...(await evalSummary(c.env, s.id, hash)), pass_bar: PASS_BAR } });
});

/** The models an eval runs on: those asked for, else every model agents may run on today. */
function evalModels(env: Env, admin: User, asked: unknown): { ok: true; models: string[] } | { ok: false; message: string } {
  const allowed = agentModels(env, admin).filter((m) => !m.plan_locked).map((m) => m.id);
  if (asked == null) return allowed.length ? { ok: true, models: allowed.slice(0, MODELS_MAX) } : { ok: false, message: 'No model is offered to agents right now.' };
  if (!Array.isArray(asked) || !asked.length || asked.length > MODELS_MAX || asked.some((m) => typeof m !== 'string' || !allowed.includes(m))) {
    return { ok: false, message: `Choose 1 to ${MODELS_MAX} of the models agents may run on.` };
  }
  return { ok: true, models: [...new Set(asked as string[])] };
}

async function runEvals(env: Env, admin: User, s: SkillRow, models: string[]) {
  const d = await draftPartsOf(env, s);
  const hash = await draftHash(d);
  const cases = (await env.DB.prepare('SELECT id, input_json, expect_json FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
    .bind(s.id).all<{ id: number; input_json: string; expect_json: string }>()).results ?? [];
  for (const k of cases) {
    for (const model of models) {
      const r = await runCase(env, d, parse<CaseInput>(k.input_json, { records: {} }), parse<CaseExpect>(k.expect_json, null as any), model, admin.id);
      await env.DB.prepare(`INSERT INTO agent_skill_eval_results (case_id, skill_id, draft_hash, model_id, result, detail, usage_log_id, run_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(k.id, s.id, hash, model, r.result, r.detail, r.usage_log_id, admin.id).run();
    }
  }
  return { cases: cases.length, summary: await evalSummary(env, s.id, hash) };
}

adminHqSkills.post('/:uid/evals', async (c) => {
  const admin = await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  const m = evalModels(c.env, admin, (await body(c)).models);
  if (!m.ok) return say(c, 400, 'models_invalid', m.message);
  const done = await runEvals(c.env, admin, s, m.models);
  if (!done.cases) return say(c, 409, 'no_cases', 'This skill has no golden cases yet. Add one, then run the evals.');
  await audit(c.env, admin, 'agent_skill_evals_run', s, null, null, { pass: done.summary.pass, total: done.summary.total }, { models: m.models });
  return c.json({ evals: { ...done.summary, pass_bar: PASS_BAR } });
});

// D1612 part D (#3954): the published versions' golden cases, for the evaluation board.
adminHqSkills.post('/evals/published', async (c) => {
  const admin = await requireSuperAdmin(c);
  const b = await body(c);
  const m = evalModels(c.env, admin, b.models);
  if (!m.ok) return say(c, 400, 'models_invalid', m.message);
  let only: number | null = null;
  if (b.uid != null) {
    const s = await hqSkill(c.env, b.uid);
    if (!s) return noSkill(c);
    if (s.status !== 'published') return say(c, 409, 'not_published', 'Only a published Axal skill has a version to evaluate.');
    only = s.id;
  }
  if (only != null) {
    const done = await evaluatePublished(c.env, admin.id, m.models, {}, only);
    await logAdminAction(c.env, admin.id, admin.email, 'agent_skill_published_evals_run', {
      skill_uid: String(b.uid), models: m.models, skills: done.skills, results: done.results, regressions: done.regressions.length,
    });
    return c.json(done);
  }
  // D4668 (#4668): every published skill, a campaign batch at a time. With no `campaign`, a new one starts.
  let uid = b.campaign;
  if (uid == null) {
    uid = newUid();
    await startCampaign(c.env, admin.id, m.models, uid as string);
  } else if (b.models != null) {
    return say(c, 400, 'models_fixed', 'A campaign runs on the models it started with. Leave out models to continue it.');
  }
  return campaignBatch(c, admin, uid);
});

async function campaignBatch(c: Context<{ Bindings: Env }>, admin: User, uid: unknown) {
  const camp = await campaignProgress(c.env, uid);
  if (camp && camp.status === 'running') {
    // The models are checked again at each press: one withdrawn since the start stops the campaign until it is cancelled.
    const m = evalModels(c.env, admin, camp.models);
    if (!m.ok) return say(c, 409, 'models_unavailable', 'A model this campaign runs on is no longer available. Cancel it and start a new one.');
  }
  const done = await continueCampaign(c.env, admin.id, uid, new Date());
  if (!done.ok) return refuse(c, done.status as 404 | 409, { code: done.code, message: done.message, extra: done.campaign ? { campaign: done.campaign } : undefined });
  await logAdminAction(c.env, admin.id, admin.email, 'agent_skill_published_evals_run', {
    campaign_uid: done.campaign.uid, models: done.campaign.models, skills: done.skills, results: done.results, regressions: done.regressions.length,
    status: done.campaign.status, pending: done.campaign.pending,
  });
  const { ok: _ok, ...out } = done;
  return c.json(out);
}

adminHqSkills.get('/evals/published/campaigns/:uid', async (c) => {
  await requireSuperAdmin(c);
  const camp = await campaignProgress(c.env, c.req.param('uid'));
  if (!camp) return say(c, 404, 'campaign_not_found', 'There is no such evaluation campaign.');
  return c.json({ campaign: camp });
});

adminHqSkills.post('/evals/published/campaigns/:uid/cancel', async (c) => {
  const admin = await requireSuperAdmin(c);
  const done = await cancelCampaign(c.env, admin.id, c.req.param('uid'), new Date());
  if (!done.ok) return refuse(c, done.status as 404 | 409, { code: done.code, message: done.message, extra: done.campaign ? { campaign: done.campaign } : undefined });
  await logAdminAction(c.env, admin.id, admin.email, 'agent_skill_published_evals_cancelled', { campaign_uid: done.campaign.uid, done: done.campaign.done, pending: done.campaign.pending });
  return c.json(done);
});

// ── Retire ──────────────────────────────────────────────────────────────────

type Outcome = { ok: true; [k: string]: unknown } | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

async function retire(env: Env, admin: User, s: SkillRow, replacementUid: unknown, reason: string): Promise<Outcome> {
  if (s.status === 'retired') return { ok: false, status: 409, code: 'retired', message: 'This skill is already retired.' };
  const repl = await hqSkill(env, replacementUid);
  if (!repl) return { ok: false, status: 422, code: 'replacement_required', message: 'Name the Axal skill that replaces this one.' };
  if (repl.id === s.id) return { ok: false, status: 422, code: 'replacement_invalid', message: 'A skill cannot replace itself.' };
  if (repl.status !== 'published' || repl.current_version < 1) return { ok: false, status: 422, code: 'replacement_invalid', message: 'The replacement must be a published Axal skill.' };
  const pinned = await pinnedAgents(env, s.id);
  const open = await openReview(env, s.id);
  const done = await env.DB.batch([
    env.DB.prepare(`UPDATE agent_skills SET status = 'retired', updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'retired'`).bind(admin.id, s.id),
    env.DB.prepare('INSERT INTO agent_skill_retirements (skill_id, replacement_skill_id, reason, pinned_agents, retired_by) VALUES (?, ?, ?, ?, ?)')
      .bind(s.id, repl.id, reason, pinned, admin.id),
    ...(open ? [env.DB.prepare("UPDATE agent_skill_reviews SET status = 'withdrawn', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'requested'").bind(open.id)] : []),
  ]).catch(() => null);
  if (!done || Number(done[0]?.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, code: 'retire_conflict', message: 'This skill was retired just now. Reload it.' };
  await audit(env, admin, 'agent_skill_retired', s, reason, { status: s.status }, { status: 'retired' }, { replacement: { uid: repl.uid, name: repl.name }, pinned_agents: pinned });
  // Pinned agents keep their version until their team moves; the skill leaves the library for new assignments.
  return { ok: true, pinned_agents: pinned, replacement: { uid: repl.uid, name: repl.name } };
}

adminHqSkills.post('/:uid/retire', async (c) => {
  const admin = await requireSuperAdmin(c);
  const s = await hqSkill(c.env, c.req.param('uid'));
  if (!s) return noSkill(c);
  const b = await body(c);
  const reason = reasonOf(b.reason);
  if (!reason) return refuseReason(c);
  const r = await retire(c.env, admin, s, b.replacement_uid, reason);
  if (!r.ok) return say(c, r.status, r.code, r.message, r.extra);
  return c.json({ status: 'retired', pinned_agents: r.pinned_agents, replacement: r.replacement });
});

// ── Bulk ────────────────────────────────────────────────────────────────────

adminHqSkills.post('/bulk', async (c) => {
  const admin = await requireSuperAdmin(c);
  const b = await body(c);
  if (!['publish', 'retire', 'evals'].includes(b.action)) return say(c, 400, 'action_invalid', 'Choose Publish, Retire or Re-run evals.');
  const reason = reasonOf(b.reason);
  if (!reason) return refuseReason(c);
  const uids = Array.isArray(b.uids) ? [...new Set(b.uids.filter((u: unknown) => typeof u === 'string'))] as string[] : [];
  if (!uids.length || uids.length > BULK_MAX) return say(c, 400, 'uids_invalid', `Choose between 1 and ${BULK_MAX} skills.`);
  const models = b.action === 'evals' ? evalModels(c.env, admin, b.models) : null;
  if (models && !models.ok) return say(c, 400, 'models_invalid', models.message);
  // Each item is done or refused on its own; one refusal never refuses the list.
  const results = [];
  for (const uid of uids) {
    const s = await hqSkill(c.env, uid);
    if (!s) { results.push({ uid, ok: false, code: 'not_found', message: 'There is no such Axal skill.' }); continue; }
    if (b.action === 'publish') {
      const r = await publishDraft(c.env, s, admin, reason);
      results.push(r.ok ? { uid, ok: true, version: r.version } : { uid, ok: false, code: r.code, message: r.message, ...(r.extra ?? {}) });
    } else if (b.action === 'retire') {
      const r = await retire(c.env, admin, s, b.replacement_uid, reason);
      results.push(r.ok ? { uid, ok: true, pinned_agents: r.pinned_agents } : { uid, ok: false, code: r.code, message: r.message });
    } else {
      const r = await runEvals(c.env, admin, s, (models as { ok: true; models: string[] }).models);
      if (!r.cases) { results.push({ uid, ok: false, code: 'no_cases', message: 'This skill has no golden cases yet.' }); continue; }
      await audit(c.env, admin, 'agent_skill_evals_run', s, reason, null, { pass: r.summary.pass, total: r.summary.total });
      results.push({ uid, ok: true, pass: r.summary.pass, total: r.summary.total, meets_bar: r.summary.meets_bar });
    }
  }
  return c.json({ action: b.action, results });
});

export default adminHqSkills;
export const mount: RouteMount = { path: '/api/admin/ai-agents/skills', router: adminHqSkills };
