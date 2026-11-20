/** D5829: venture-private Typeform review. GET never writes, support sessions are refused. */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { isSupportSession } from '../services/companyAccess';
import { projectEnabled } from '../integrations/companyScope';
import { WriterError } from '../services/validateWriters';
import { mapTypeformEvidence, prepareTypeformReviews, decideTypeformReview, typeformReviews } from '../services/typeform/review';
import { typeformReviewCounts } from '../services/typeform/reviewCounts';

const r = new Hono<{ Bindings: Env }>();
r.onError((e, c) => {
  if (!(e instanceof WriterError)) throw e;
  return c.json({ error: 'typeform_review_refused', detail: e.sentence }, e.status as 400);
});

async function scope(c: Context<{ Bindings: Env }>, raw: unknown) {
  const user = await requireAuth(c);
  if (await isSupportSession(c)) throw new WriterError(403, 'A support session cannot review survey answers');
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new WriterError(400, 'Choose a venture');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(pid).first<{ id: number; founder_id: number | null }>();
  if (!p || !(await canAccessProject(c.env, user, p, { write: true }))) throw new WriterError(404, 'Venture not found');
  const binding = await c.env.DB.prepare(`SELECT i.id FROM typeform_form_bindings b JOIN integrations i ON i.id = b.integration_id
    WHERE b.project_id = ? AND i.user_id = ? AND i.provider_key = 'typeform' AND i.status = 'active' AND b.access_state = 'ok'`)
    .bind(pid, user.id).first<{ id: number }>();
  if (!binding || !(await projectEnabled(c.env, binding.id, pid))) throw new WriterError(403, 'Your Typeform is not enabled for this venture');
  c.header('Cache-Control', 'no-store');
  return { projectId: pid, integrationId: Number(binding.id), userId: Number(user.id) };
}

r.get('/reviews', async c => c.json(await typeformReviews(c.env, await scope(c, c.req.query('project')))));
r.get('/form-counts', async c => {
  const s = await scope(c, c.req.query('project'));
  return c.json({ forms: await typeformReviewCounts(c.env, s.projectId, s.integrationId) });
});
r.put('/evidence-mapping', async c => {
  const b = await c.req.json(); const s = await scope(c, b?.project);
  return c.json({ mapping: await mapTypeformEvidence(c.env, s, b) });
});
r.post('/reviews/prepare', async c => {
  const b = await c.req.json();
  return c.json(await prepareTypeformReviews(c.env, await scope(c, b?.project)));
});
r.post('/reviews/:id/:action', async c => {
  const b = await c.req.json(); const s = await scope(c, b?.project);
  const id = Number(c.req.param('id')); const action = c.req.param('action');
  if (!Number.isSafeInteger(id) || id <= 0 || !['confirm', 'dismiss', 'unlink'].includes(action)) throw new WriterError(400, 'Choose a review action');
  return c.json(await decideTypeformReview(c.env, s, id, action as 'confirm' | 'dismiss' | 'unlink'));
});

export const mount: RouteMount = { path: '/api/typeform/validate', router: r };
export default r;
