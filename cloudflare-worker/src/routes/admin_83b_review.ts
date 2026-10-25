/**
 * D580 (#1207) — HQ's 83(b) operator review. Mounted at /api/admin/83b-review.
 * Every endpoint gates on requireAdmin, and every write is recorded through
 * logAdminAction with the acting admin.
 *
 *   GET  /?scope=lab|all            → startups with an 83(b) tracker (Lab ventures only for lab, D946), each with its
 *                                     operator, last review and next follow-up; and
 *                                     the active admins an operator is chosen from
 *   PUT  /projects/:id/operator     → { operator_user_id: number | null } — assign or unassign
 *   POST /projects/:id/reviews      → { outcome: complete|incomplete, note?, follow_up_date?, tracker_id? }
 *
 * Operator review is a check that the filing record is complete. It is not tax
 * or legal advice, and it does not gate graduation (the owner's answer 3A).
 * The founder's read is `GET /api/legal/83b/operator-review` (legal_83b.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { LAB_PARTICIPANT_IDS } from '../services/labParticipants';
import {
  assignOperator,
  projectById,
  readOperatorReview,
  recordReview,
} from '../services/section83bOperatorReview';

const r = new Hono<{ Bindings: Env }>();

const STARTUPS_WITH_TRACKERS =
  'SELECT p.id AS project_id, p.name AS project_name, COUNT(t.id) AS trackers '
  + 'FROM projects p JOIN section_83b_trackers t ON t.project_id = p.id '
  + 'GROUP BY p.id ORDER BY p.name';

/**
 * D946 (#2751) — SL10's "Lab ventures": only startups whose founder is a Lab
 * participant, by the participants read's own rule (`LAB_PARTICIPANT_IDS`).
 */
const LAB_STARTUPS_WITH_TRACKERS =
  'SELECT p.id AS project_id, p.name AS project_name, COUNT(t.id) AS trackers '
  + 'FROM projects p JOIN section_83b_trackers t ON t.project_id = p.id '
  + 'WHERE p.founder_id IN (SELECT lu.founder_id FROM users lu WHERE lu.id IN (' + LAB_PARTICIPANT_IDS + ')) '
  + 'GROUP BY p.id ORDER BY p.name';

const ACTIVE_ADMINS = "SELECT id, name, email FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY name, id";

r.get('/', async (c) => {
  await requireAdmin(c);
  const scope = c.req.query('scope') || 'all';
  if (scope !== 'all' && scope !== 'lab') return c.json({ error: 'bad_scope', code: 'bad_scope', detail: 'scope is lab or all.' }, 400);
  const startups = (await c.env.DB.prepare(scope === 'lab' ? LAB_STARTUPS_WITH_TRACKERS : STARTUPS_WITH_TRACKERS)
    .all<{ project_id: number; project_name: string; trackers: number }>()).results || [];
  const rows = [];
  for (const s of startups) {
    rows.push({ ...s, ...(await readOperatorReview(c.env, Number(s.project_id))) });
  }
  const admins = (await c.env.DB.prepare(ACTIVE_ADMINS).all<{ id: number; name: string | null; email: string }>()).results || [];
  return c.json({ startups: rows, operators: admins, scope });
});

r.put('/projects/:id/operator', async (c) => {
  const admin = await requireAdmin(c);
  const project = await projectById(c.env, Number(c.req.param('id')));
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { operator_user_id?: unknown };
  if (!('operator_user_id' in body)) return c.json({ error: 'operator_user_id_required' }, 400);
  const raw = body.operator_user_id;
  const operatorId = raw === null ? null : Number(raw);
  const out = await assignOperator(c.env, project.id, operatorId, admin.id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  await logAdminAction(c.env, admin.id, admin.email, 'section_83b_operator_assigned', {
    project_id: project.id,
    operator_user_id: out.value.operator_user_id,
  });
  return c.json({ ok: true, ...out.value, ...(await readOperatorReview(c.env, project.id)) });
});

r.post('/projects/:id/reviews', async (c) => {
  const admin = await requireAdmin(c);
  const project = await projectById(c.env, Number(c.req.param('id')));
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const out = await recordReview(c.env, project.id, body, admin.id);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  await logAdminAction(c.env, admin.id, admin.email, 'section_83b_operator_review_recorded', {
    project_id: project.id,
    review_uid: out.value.uid,
    operator_user_id: out.value.operator_user_id,
    outcome: out.value.outcome,
    follow_up_date: out.value.follow_up_date,
  });
  return c.json({ ok: true, review_uid: out.value.uid, ...(await readOperatorReview(c.env, project.id)) });
});

export default r;
