/**
 * D4155 K5 (#4192) — HQ › Decks › Stage norms: HQ's norms, the platform
 * defaults the deck critic cites after a venture's own (D1589). Mounts itself
 * at `/api/admin/deck-stage-norms`, behind `requireHqAdmin` (an HQ Admin or
 * the Super Admin; a branch's admin is refused).
 *
 *   GET  /?stage=&status=     → { stage, norms: [HqNorm] }, active first
 *   POST /                    { stage, metric, range: { low, high, unit }, source, last_reviewed?, reason } → 201 { norm }
 *   PUT  /:uid                the same fields, merged over the row; { reason } → { norm }
 *   POST /:uid/retire         { reason } → { norm }; the critic stops citing it at once
 *   GET  /projects/:id        → { project, norms: [ProjectNorm], last_changed }: a venture's own norms, read-only
 *
 * HqNorm: `{ uid, stage, metric, range: { low, high, unit }, source,
 * last_reviewed, status: 'active' | 'retired', updated_by, retired_by,
 * retired_reason, retired_at, citation }`. A person is `{ uid, name }`, never
 * an email.
 *
 * `source` is required (400 `source_missing`), and so is a reason of ten
 * characters or more on every write (400 `reason_required`). Each write is one
 * admin audit row with the norm before and after. A retired norm is kept, so
 * the page can say who retired it and why, and cannot be edited (409
 * `norm_retired`).
 *
 * A venture's own norms are its founders' (D1589). This router has no write
 * for them, and `deck_stage_norms.ts` refuses an admin's write (403
 * `hq_read_only`).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { logAdminAction } from '../services/adminAudit';
import { STAGES, type Stage } from '../services/decks/stageNorms';
import {
  HQ_NORM_STATUSES, checkHqNorm, hqNormByUid, listHqNorms, projectNormsForHq, type HqNorm, type HqNormStatus,
} from '../services/decks/hqStageNorms';

type C = Context<{ Bindings: Env }>;
const adminDeckStageNorms = new Hono<{ Bindings: Env }>();

export const REASON_MIN = 10;
export const REASON_MAX = 500;
const today = () => new Date().toISOString().slice(0, 10);
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const say = (c: C, status: number, code: string, message: string) => refuse(c, status, { code, message });
const body = async (c: C): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; };

export function reasonOf(raw: unknown): string | null {
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return reason.length >= REASON_MIN && reason.length <= REASON_MAX ? reason : null;
}
const refuseReason = (c: C) => say(c, 400, 'reason_required', `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters. It is recorded with the change.`);
const noNorm = (c: C) => say(c, 404, 'not_found', 'There is no such HQ stage norm.');

/** What the audit row keeps of a norm: its fields, not its derived citation. */
const kept = (n: HqNorm | null) => (n ? { stage: n.stage, metric: n.metric, range: n.range, source: n.source, last_reviewed: n.last_reviewed, status: n.status } : null);
async function audit(env: Env, admin: User, action: string, uid: string, reason: string, before: HqNorm | null, after: HqNorm | null) {
  await logAdminAction(env, Number(admin.id), String(admin.email || ''), action, { norm_uid: uid, reason, before: kept(before), after: kept(after) });
}

adminDeckStageNorms.get('/', async (c) => {
  await requireHqAdmin(c);
  const stage = c.req.query('stage') || '';
  if (stage && !(STAGES as readonly string[]).includes(stage)) return say(c, 400, 'stage_invalid', 'Choose a stage: Pre-seed, Seed, Series A or Series B+.');
  const status = c.req.query('status') || '';
  if (status && !(HQ_NORM_STATUSES as readonly string[]).includes(status)) return say(c, 400, 'status_invalid', 'Choose active or retired.');
  const norms = await listHqNorms(c.env, (stage || undefined) as Stage | undefined, (status || undefined) as HqNormStatus | undefined);
  return c.json({ stage: stage || null, norms });
});

adminDeckStageNorms.get('/projects/:id', async (c) => {
  await requireHqAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return say(c, 404, 'not_found', 'There is no such venture.');
  const project = await c.env.DB.prepare('SELECT id, name FROM projects WHERE id = ?').bind(id).first<{ id: number; name: string | null }>();
  if (!project) return say(c, 404, 'not_found', 'There is no such venture.');
  const norms = await projectNormsForHq(c.env, id);
  const last = norms.reduce<typeof norms[number] | null>((a, n) => (!a || String(n.updated_at) > String(a.updated_at) ? n : a), null);
  return c.json({
    project: { id: project.id, name: project.name }, read_only: true, norms,
    last_changed: last ? { at: last.updated_at, by: last.set_by } : null,
  });
});

adminDeckStageNorms.post('/', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  const checked = checkHqNorm(b, today());
  if (!checked.ok) return say(c, 400, checked.code, checked.message);
  const reason = reasonOf(b.reason);
  if (!reason) return refuseReason(c);
  const n = checked.norm, uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO hq_stage_norms (uid, stage, metric, range_low, range_high, range_unit, source, last_reviewed, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, n.stage, n.metric, n.range_low, n.range_high, n.range_unit, n.source, n.last_reviewed, admin.id, admin.id).run();
  const after = (await hqNormByUid(c.env, uid))!.dto;
  await audit(c.env, admin, 'deck_stage_norm_added', uid, reason, null, after);
  return c.json({ norm: after }, 201);
});

adminDeckStageNorms.put('/:uid', async (c) => {
  const admin = await requireHqAdmin(c);
  const found = await hqNormByUid(c.env, c.req.param('uid'));
  if (!found) return noNorm(c);
  if (found.row.status === 'retired') return say(c, 409, 'norm_retired', 'A retired norm is kept as it was. Add a new one instead.');
  const b = await body(c);
  const has = (k: string) => k in b;
  const r = found.dto;
  const checked = checkHqNorm({
    stage: has('stage') ? b.stage : r.stage,
    metric: has('metric') ? b.metric : r.metric,
    range: has('range') ? b.range : r.range,
    source: has('source') ? b.source : r.source,
    // An edit is a review: the day moves to today unless one is given.
    last_reviewed: has('last_reviewed') ? b.last_reviewed : null,
  }, today());
  if (!checked.ok) return say(c, 400, checked.code, checked.message);
  const reason = reasonOf(b.reason);
  if (!reason) return refuseReason(c);
  const n = checked.norm;
  await c.env.DB.prepare(
    `UPDATE hq_stage_norms SET stage = ?, metric = ?, range_low = ?, range_high = ?, range_unit = ?, source = ?, last_reviewed = ?,
       updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'`,
  ).bind(n.stage, n.metric, n.range_low, n.range_high, n.range_unit, n.source, n.last_reviewed, admin.id, found.row.id).run();
  const after = (await hqNormByUid(c.env, r.uid))!.dto;
  await audit(c.env, admin, 'deck_stage_norm_edited', r.uid, reason, r, after);
  return c.json({ norm: after });
});

adminDeckStageNorms.post('/:uid/retire', async (c) => {
  const admin = await requireHqAdmin(c);
  const found = await hqNormByUid(c.env, c.req.param('uid'));
  if (!found) return noNorm(c);
  if (found.row.status === 'retired') return say(c, 409, 'already_retired', 'This norm is already retired.');
  const reason = reasonOf((await body(c)).reason);
  if (!reason) return refuseReason(c);
  await c.env.DB.prepare(
    `UPDATE hq_stage_norms SET status = 'retired', retired_by = ?, retired_reason = ?, retired_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'`,
  ).bind(admin.id, reason, found.row.id).run();
  const after = (await hqNormByUid(c.env, found.dto.uid))!.dto;
  await audit(c.env, admin, 'deck_stage_norm_retired', found.dto.uid, reason, found.dto, after);
  return c.json({ norm: after });
});

export default adminDeckStageNorms;

export const mount: RouteMount = { path: '/api/admin/deck-stage-norms', router: adminDeckStageNorms };
