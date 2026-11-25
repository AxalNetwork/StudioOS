/** Formation catalogue submissions, counsel's country-scoped queue and second-person publication (D6700). */
import { Hono, type Context } from 'hono';
import { requireAuth, requireHqAuthoring, requireStepUp, requireSuperAdminWriteBar } from '../auth';
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { adminAuditStatement } from '../services/adminAudit';
import { sha256Hex, versionContent } from '../services/formationCatalogueEdit';
import { candidate, decide, publish, reviewRuleSet, submissionPlan, submit } from '../services/formationPublish';
import { ensureAdminAuditLogTable } from './admin';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();
const positiveId = (value: string) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const versionMissing = (c: Ctx) => refuse(c, 404, { code: 'version_not_found', message: 'That catalogue version is unavailable.' });
const stale = (c: Ctx) => refuse(c, 409, { code: 'submission_changed', message: 'Read the current catalogue submission before continuing.' });
const bodyOf = async (c: Ctx) => await c.req.json<Record<string, unknown>>().catch(() => null);
function reasonOf(c: Ctx, value: unknown) {
  return typeof value === 'string' && value.trim() && value.trim().length <= 500 ? value.trim()
    : refuse(c, 400, { code: 'reason_required', message: 'Give a reason of 1 to 500 characters.' });
}

r.get('/versions/:version', async c => {
  await requireHqAuthoring(c);
  const v = await candidate(c.env, positiveId(c.req.param('version')));
  if (!v) return versionMissing(c);
  const plan = v.status === 'draft' ? await submissionPlan(c.env, v) : null;
  const reviews = (await c.env.DB.prepare(`SELECT r.id, r.jurisdiction, r.reviewer_id, r.decision, r.decided_at,
    EXISTS (SELECT 1 FROM formation_counsel_admissions a JOIN counsel_members cm ON cm.user_id = a.user_id
      WHERE a.user_id = r.reviewer_id AND a.country = r.jurisdiction) AS admitted
    FROM formation_reviews r WHERE r.version_id = ? AND r.review_round = ? ORDER BY r.jurisdiction`)
    .bind(v.id, v.review_round).all()).results;
  return c.json({ version: v.version, status: v.status, last_editor_id: v.editor_id, review_round: v.review_round,
    content_sha256: plan?.content_sha256 ?? v.review_content_sha256, review_rules_sha256: plan?.review_rules_sha256 ?? v.review_rules_sha256,
    required_countries: plan?.required_countries ?? JSON.parse(v.review_countries ?? '[]'), reviews });
});

r.post('/versions/:version/submit', async c => {
  const user = await requireHqAuthoring(c);
  const body = await bodyOf(c);
  const reason = reasonOf(c, body?.reason);
  if (reason instanceof Response) return reason;
  const v = await candidate(c.env, positiveId(c.req.param('version')));
  if (!v) return versionMissing(c);
  if (v.status !== 'draft') return stale(c);
  if (!v.editor_id) return refuse(c, 409, { code: 'editor_unknown', message: 'The last editor must be recorded before submission.' });
  const plan = await submissionPlan(c.env, v);
  if (!plan || body?.content_sha256 !== plan.content_sha256) return stale(c);
  const assigned = body?.reviewers;
  const reviewers: Record<string, number> = {};
  for (const country of plan.required_countries) {
    const id = assigned && typeof assigned === 'object' ? (assigned as Record<string, unknown>)[country] : null;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
      return refuse(c, 422, { code: 'reviewer_required', message: `Choose admitted counsel for ${country}.` });
    }
    reviewers[country] = id;
  }
  await ensureAdminAuditLogTable(c.env);
  try {
    const round = await submit(c.env, v, plan, reviewers, Number(user.id), reason);
    return round ? c.json({ version: v.version, review_round: round, ...plan }, 201) : stale(c);
  } catch (e) {
    if (String(e).includes('admitted counsel required')) return refuse(c, 422, { code: 'admission_required', message: 'Each assigned reviewer needs admission in that country.' });
    throw e;
  }
});

r.post('/versions/:version/withdraw', async c => {
  const user = await requireHqAuthoring(c);
  const body = await bodyOf(c);
  const reason = reasonOf(c, body?.reason);
  if (reason instanceof Response) return reason;
  const version = positiveId(c.req.param('version'));
  if (typeof body?.review_round !== 'string') return stale(c);
  await ensureAdminAuditLogTable(c.env);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE formation_catalogue_versions SET status = 'draft', review_round = NULL, review_base_id = NULL,
      review_editor_id = NULL, review_content_sha256 = NULL, review_rules_sha256 = NULL, review_countries = NULL
      WHERE version = ? AND status = 'in_review' AND review_round = ?
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND lower(u.role) = 'admin' AND u.is_active = 1)`).bind(version, body.review_round, Number(user.id)),
    adminAuditStatement(c.env, Number(user.id), 'formation_catalogue_withdrawn', { version, round: body.review_round, reason }, { onlyIfChanged: true }),
  ]);
  return results[0].meta.changes ? c.json({ version, status: 'draft' }) : stale(c);
});

r.post('/versions/:version/publish', async c => {
  await requireHqAuthoring(c);
  const user = await requireSuperAdminWriteBar(c);
  const body = await bodyOf(c);
  const reason = reasonOf(c, body?.reason);
  if (reason instanceof Response) return reason;
  const v = await candidate(c.env, positiveId(c.req.param('version')));
  if (!v) return versionMissing(c);
  if (typeof body?.review_round !== 'string' || body.review_round !== v.review_round || v.status !== 'in_review') return stale(c);
  if (Number(user.id) === v.editor_id) return refuse(c, 403, { code: 'second_person_required', message: 'A different Super Admin must publish this editor’s changes.' });
  await ensureAdminAuditLogTable(c.env);
  const ok = await publish(c.env, v, body.review_round, Number(user.id), reason);
  return ok ? c.json({ version: v.version, status: 'published', content_sha256: v.review_content_sha256 })
    : refuse(c, 409, { code: 'publication_blocked', message: 'The submission needs a current base and an admitted approval for each required country.' });
});

r.get('/admissions', async c => {
  await requireHqAuthoring(c);
  const rows = await c.env.DB.prepare(`SELECT a.user_id, a.country FROM formation_counsel_admissions a
    JOIN counsel_members cm ON cm.user_id = a.user_id ORDER BY a.country, a.user_id`).all();
  return c.json({ admissions: rows.results });
});

r.post('/admissions', async c => {
  await requireHqAuthoring(c);
  const admin = await requireSuperAdminWriteBar(c);
  const body = await bodyOf(c);
  const reason = reasonOf(c, body?.reason);
  if (reason instanceof Response) return reason;
  const userId = body?.user_id;
  const country = body?.country;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId < 1
      || typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)
      || (body?.action !== 'grant' && body?.action !== 'revoke')) {
    return refuse(c, 422, { code: 'invalid_admission', message: 'Name the counsel member, country code and grant or revoke action.' });
  }
  const db = c.env.DB;
  const actor = Number(admin.id);
  await ensureAdminAuditLogTable(c.env);
  const result = await db.batch([
    body.action === 'grant'
      ? db.prepare(`INSERT OR IGNORE INTO formation_counsel_admissions (user_id, country, granted_by)
          SELECT user_id, ?, ? FROM counsel_members WHERE user_id = ? AND EXISTS
            (SELECT 1 FROM super_admins sa JOIN users u ON u.id = sa.user_id WHERE sa.user_id = ? AND lower(u.role) = 'admin' AND u.is_active = 1)`).bind(country, actor, userId, actor)
      : db.prepare(`DELETE FROM formation_counsel_admissions WHERE user_id = ? AND country = ? AND EXISTS
          (SELECT 1 FROM super_admins sa JOIN users u ON u.id = sa.user_id WHERE sa.user_id = ? AND lower(u.role) = 'admin' AND u.is_active = 1)`).bind(userId, country, actor),
    adminAuditStatement(c.env, actor, 'formation_counsel_admission_changed', {
      target_user_id: userId, country, action: body.action, reason,
    }, { onlyIfChanged: true }),
  ]);
  return result[0].meta.changes ? c.json({ user_id: userId, country, action: body.action })
    : refuse(c, 409, { code: 'admission_unchanged', message: 'The counsel roster or current admission does not allow this change.' });
});

async function counsel(c: Ctx) {
  const user = await requireAuth(c);
  if (branchOf(c.env) || !await c.env.DB.prepare('SELECT 1 FROM counsel_members WHERE user_id = ?').bind(user.id).first()) {
    return refuse(c, 403, { code: 'counsel_only', message: 'The formation review queue is for HQ counsel.' });
  }
  return Number(user.id);
}

r.get('/assigned', async c => {
  const actor = await counsel(c);
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare(`SELECT r.id, v.version, r.object_kind, r.object_ref, r.jurisdiction, r.content_sha256, r.decision, r.decided_at
    FROM formation_reviews r JOIN formation_catalogue_versions v ON v.id = r.version_id AND v.review_round = r.review_round
    JOIN formation_counsel_admissions a ON a.user_id = r.reviewer_id AND a.country = r.jurisdiction
    WHERE r.reviewer_id = ? AND v.status = 'in_review' ORDER BY r.id`).bind(actor).all();
  return c.json({ reviews: rows.results });
});

r.get('/assigned/:id', async c => {
  const actor = await counsel(c);
  if (actor instanceof Response) return actor;
  const assignedReview = c.env.DB.prepare(`SELECT r.id, r.version_id, r.jurisdiction, r.content_sha256, r.decision
    FROM formation_reviews r JOIN formation_catalogue_versions v ON v.id = r.version_id AND v.review_round = r.review_round
    JOIN formation_counsel_admissions a ON a.user_id = r.reviewer_id AND a.country = r.jurisdiction
    WHERE r.id = ? AND r.reviewer_id = ? AND v.status = 'in_review'`).bind(positiveId(c.req.param('id')), actor);
  const review = await assignedReview.first<{ id: number; version_id: number; jurisdiction: string; content_sha256: string; decision: string | null }>();
  if (!review) return refuse(c, 404, { code: 'review_not_found', message: 'That review is unavailable.' });
  const content = await versionContent(c.env, review.version_id);
  if (await sha256Hex(reviewRuleSet(content)) !== review.content_sha256 || !await assignedReview.first()) return stale(c);
  return c.json({ review, rules: content.rules, scenarios: content.scenarios,
    forms: content.forms.filter(f => f.offer_mode === 'orderable' && f.country === review.jurisdiction) });
});

r.post('/assigned/:id/decision', async c => {
  const actor = await counsel(c);
  if (actor instanceof Response) return actor;
  await requireStepUp(c);
  const body = await bodyOf(c);
  if ((body?.decision !== 'approved' && body?.decision !== 'not_approved') || typeof body.content_sha256 !== 'string') {
    return refuse(c, 422, { code: 'decision_required', message: 'Give a decision and the reviewed rule-set hash.' });
  }
  await ensureAdminAuditLogTable(c.env);
  const ok = await decide(c.env, positiveId(c.req.param('id')), actor, body.content_sha256, body.decision);
  return ok ? c.json({ decision: body.decision }) : refuse(c, 409, { code: 'decision_unavailable', message: 'This decision needs a current, pending review assigned to you in your admitted jurisdiction.' });
});

export const mount: RouteMount = { path: '/api/admin/formation/reviews', router: r };
export default r;
