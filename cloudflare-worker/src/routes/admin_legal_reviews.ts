/**
 * D4811 (#4811) part 16 — the legal-review record (board CT-08) and the
 * counsel role, over migration 202611092245. HQ only (`requireHqAuthoring`);
 * a confidential governance record is the Super Admin's alone, as on
 * `admin_governance.ts`. Rules in `services/legalReview.ts`.
 *
 *   GET    /api/admin/legal-reviews?kind=template|governance&ref=<slug|uid>
 *            → { object: { kind, ref, title, version, sha256 } | null, reviews: [...], counsel: [...], viewer: { counsel, super_admin } }
 *   POST   /api/admin/legal-reviews { kind, ref, reviewer_id, review_type, jurisdiction, due_on? } → { review }   any HQ admin; binds the current version's hash
 *   POST   /api/admin/legal-reviews/:id/decision { decision, findings?, required_changes?, sources?, next_review_on? } → { review }
 *            the assigned counsel only, once, against the version still current, after a recent step-up
 *   GET    /api/admin/legal-reviews/counsel → { counsel: [{ user_id, name, email_hint, firm, granted_at }] }
 *   POST   /api/admin/legal-reviews/counsel { user_id, firm? } → { counsel }   Super Admin only
 *   DELETE /api/admin/legal-reviews/counsel/:userId → { ok }                  Super Admin only; past reviews keep their reviewer
 *
 * Every write is recorded with `logAdminAction` (ids, kinds, versions and the
 * decision; never the findings' text).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireHqAuthoring, requireStepUp } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { readDoc, readVersions } from '../services/governance';
import { sha256Hex } from '../services/pdf';
import { decisionOf, requestOf, reviewState } from '../services/legalReview';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

const reviews = new Hono<{ Bindings: Env }>();
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const KINDS = ['template', 'governance'] as const;
type Kind = typeof KINDS[number];

async function hq(c: any) {
  const user = await requireHqAuthoring(c);
  return { user, superAdmin: isSuperAdmin(user as any) };
}
const audit = (c: any, user: any, action: string, details: Record<string, unknown>) =>
  logAdminAction(c.env, Number(user.id), String(user.email ?? ''), action, details);
const isCounsel = async (env: Env, userId: number) =>
  !!(await env.DB.prepare('SELECT 1 AS ok FROM counsel_members WHERE user_id = ?').bind(userId).first());

/** The object a review is of, at its current version, or null when it is not there for this viewer. */
async function objectOf(env: Env, kind: Kind, ref: string, superAdmin: boolean): Promise<{ kind: Kind; ref: string; title: string; version: number | null; sha256: string | null } | null> {
  if (kind === 'template') {
    const t = await env.DB.prepare('SELECT slug, title, version, body_md FROM legal_templates WHERE slug = ? AND is_active = 1').bind(ref).first<any>();
    if (!t) return null;
    const body = String(t.body_md ?? '');
    return { kind, ref: t.slug, title: t.title, version: body.trim() ? Number(t.version) : null, sha256: body.trim() ? await sha256Hex(body) : null };
  }
  const doc = await readDoc(env, ref);
  if (!doc || (Number(doc.confidential) === 1 && !superAdmin)) return null;
  const latest = (await readVersions(env, doc.uid))[0] ?? null;
  return { kind, ref: doc.uid, title: doc.title, version: latest ? Number(latest.version) : null, sha256: latest ? latest.file_sha256 : null };
}

function view(r: any, currentSha: string | null) {
  return {
    id: Number(r.id), kind: r.object_kind, ref: r.object_ref, version: Number(r.version), version_sha256: r.version_sha256,
    review_type: r.review_type, jurisdiction: r.jurisdiction, due_on: r.due_on ?? null,
    reviewer: { id: Number(r.reviewer_id), name: r.reviewer_name ?? null, firm: r.reviewer_firm ?? null },
    requested_by: Number(r.requested_by), requested_at: r.requested_at,
    decision: r.decision ?? null, findings: r.findings ?? null, required_changes: r.required_changes ?? null, sources: r.sources ?? null,
    next_review_on: r.next_review_on ?? null, decided_by: r.decided_by == null ? null : Number(r.decided_by), decided_at: r.decided_at ?? null,
    state: reviewState(r, currentSha),
  };
}
const SELECT = `SELECT r.*, u.name AS reviewer_name, cm.firm AS reviewer_firm FROM legal_reviews r
  LEFT JOIN users u ON u.id = r.reviewer_id LEFT JOIN counsel_members cm ON cm.user_id = r.reviewer_id`;

async function counselList(env: Env) {
  const rows = (await env.DB.prepare(`SELECT cm.user_id, cm.firm, cm.granted_at, u.name, u.email FROM counsel_members cm
    LEFT JOIN users u ON u.id = cm.user_id ORDER BY u.name COLLATE NOCASE, cm.user_id`).all<any>()).results || [];
  return rows.map((r) => ({ user_id: Number(r.user_id), name: r.name ?? null, email_hint: r.email ? String(r.email).replace(/^(.).*(@.*)$/, '$1…$2') : null, firm: r.firm ?? null, granted_at: r.granted_at }));
}

reviews.get('/counsel', async (c) => {
  await hq(c);
  return c.json({ counsel: await counselList(c.env) });
});

reviews.post('/counsel', async (c) => {
  const { user, superAdmin } = await hq(c);
  if (!superAdmin) return refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin grants the counsel role. Nothing was changed.' });
  const b = await c.req.json().catch(() => ({} as any));
  const id = Number(b?.user_id);
  if (!Number.isSafeInteger(id) || id <= 0) return refuse(c, 422, { code: 'user_required', message: 'Choose the person to hold the counsel role. Nothing was changed.' });
  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').bind(id).first();
  if (!target) return refuse(c, 404, { code: 'user_not_found', message: 'That account is not available. Nothing was changed.' });
  const firm = typeof b?.firm === 'string' && b.firm.trim() ? b.firm.trim().slice(0, 200) : null;
  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO counsel_members (user_id, firm, granted_by) VALUES (?, ?, ?)').bind(id, firm, Number(user.id)).run();
  if (!(res.meta?.changes ?? 0)) return refuse(c, 409, { code: 'already_counsel', message: 'That person already holds the counsel role. Nothing was changed.' });
  await audit(c, user, 'counsel_granted', { user_id: id });
  return c.json({ counsel: await counselList(c.env) }, 201);
});

reviews.delete('/counsel/:userId', async (c) => {
  const { user, superAdmin } = await hq(c);
  if (!superAdmin) return refuse(c, 403, { code: 'super_admin_only', message: 'Only the Super Admin removes the counsel role. Nothing was changed.' });
  const id = Number(c.req.param('userId'));
  const res = await c.env.DB.prepare('DELETE FROM counsel_members WHERE user_id = ?').bind(id).run();
  if (!(res.meta?.changes ?? 0)) return refuse(c, 404, { code: 'not_counsel', message: 'That person does not hold the counsel role. Nothing was changed.' });
  await audit(c, user, 'counsel_revoked', { user_id: id });
  return c.json({ ok: true });
});

reviews.get('/', async (c) => {
  const { user, superAdmin } = await hq(c);
  const kind = c.req.query('kind') as Kind;
  const ref = String(c.req.query('ref') || '');
  if (!(KINDS as readonly string[]).includes(kind) || !ref) return refuse(c, 422, { code: 'object_required', message: 'Name the template or governance record.' });
  const object = await objectOf(c.env, kind, ref, superAdmin);
  if (!object) return refuse(c, 404, { code: 'object_not_found', message: 'That template or record is not available.' });
  const rows = (await c.env.DB.prepare(`${SELECT} WHERE r.object_kind = ? AND r.object_ref = ? ORDER BY r.id DESC`).bind(kind, object.ref).all<any>()).results || [];
  return c.json({ object, reviews: rows.map((r) => view(r, object.sha256)), counsel: await counselList(c.env),
    viewer: { id: Number(user.id), counsel: await isCounsel(c.env, Number(user.id)), super_admin: superAdmin } });
});

reviews.post('/', async (c) => {
  const { user, superAdmin } = await hq(c);
  const b = await c.req.json().catch(() => ({} as any));
  const kind = b?.kind as Kind;
  if (!(KINDS as readonly string[]).includes(kind) || typeof b?.ref !== 'string' || !b.ref) return refuse(c, 422, { code: 'object_required', message: 'Name the template or governance record. Nothing was requested.' });
  const object = await objectOf(c.env, kind, b.ref, superAdmin);
  if (!object) return refuse(c, 404, { code: 'object_not_found', message: 'That template or record is not available. Nothing was requested.' });
  if (object.version == null || object.sha256 == null) return refuse(c, 409, { code: 'nothing_to_review', message: 'There is no version to review yet: upload or write it first. Nothing was requested.' });
  const reviewerId = Number(b?.reviewer_id);
  const req = requestOf(b, Number.isSafeInteger(reviewerId) && reviewerId > 0 ? await isCounsel(c.env, reviewerId) : false);
  if (!req.ok) return refuse(c, req.refusal.status, { code: req.refusal.code, message: req.refusal.message });
  const ins = await c.env.DB.prepare(`INSERT INTO legal_reviews (object_kind, object_ref, version, version_sha256, review_type, jurisdiction, reviewer_id, due_on, requested_by, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(kind, object.ref, object.version, object.sha256, req.value.review_type, req.value.jurisdiction,
    req.value.reviewer_id, req.value.due_on, Number(user.id), now()).run();
  const id = Number(ins.meta?.last_row_id);
  await audit(c, user, 'legal_review_requested', { review_id: id, kind, ref: object.ref, version: object.version, reviewer_id: req.value.reviewer_id, review_type: req.value.review_type });
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<any>();
  return c.json({ review: view(row, object.sha256) }, 201);
});

reviews.post('/:id/decision', async (c) => {
  const { user, superAdmin } = await hq(c);
  const id = Number(c.req.param('id'));
  const row = Number.isSafeInteger(id) ? await c.env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<any>() : null;
  if (!row) return refuse(c, 404, { code: 'review_not_found', message: 'That review is not available.' });
  if (!(await isCounsel(c.env, Number(user.id)))) return refuse(c, 403, { code: 'counsel_only', message: 'Only counsel records a legal-review decision. Nothing was recorded.' });
  const object = await objectOf(c.env, row.object_kind, row.object_ref, superAdmin);
  if (!object) return refuse(c, 404, { code: 'object_not_found', message: 'That template or record is not available. Nothing was recorded.' });
  const b = await c.req.json().catch(() => ({} as any));
  const d = decisionOf(b, row, Number(user.id), object.sha256);
  if (!d.ok) return refuse(c, d.refusal.status, { code: d.refusal.code, message: d.refusal.message });
  // An approval is high-impact: the counsel confirms who they are, after every form check.
  await requireStepUp(c);
  const res = await c.env.DB.prepare(`UPDATE legal_reviews SET decision = ?, findings = ?, required_changes = ?, sources = ?, next_review_on = ?, decided_by = ?, decided_at = ?
    WHERE id = ? AND decision IS NULL`).bind(d.value.decision, d.value.findings, d.value.required_changes, d.value.sources, d.value.next_review_on, Number(user.id), now(), id).run();
  if (!(res.meta?.changes ?? 0)) return refuse(c, 409, { code: 'already_decided', message: 'This review already has its decision. Nothing was changed.' });
  await audit(c, user, 'legal_review_decided', { review_id: id, kind: row.object_kind, ref: row.object_ref, version: Number(row.version), decision: d.value.decision });
  const saved = await c.env.DB.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first<any>();
  return c.json({ review: view(saved, object.sha256) });
});

export default reviews;
export const mount: RouteMount = { path: '/api/admin/legal-reviews', router: reviews };
