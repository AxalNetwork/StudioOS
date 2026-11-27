/**
 * D579 (#1206) — a startup's EIN. Mounted at /api/company-ein.
 *
 *   GET /:projectId          → { recorded, last4, masked, recorded_at, can_edit }
 *   GET /:projectId?full=1   → the same, plus `ein` (the number) for a founder or
 *                              company editor filling their own edit field
 *   PUT /:projectId          → { ein: 'NN-NNNNNNN' } — a founder, company editor or admin
 *
 * Readers and writers: the startup's founder and company editors, and admins
 * (the owner's answer 2A). An admin reads the last four digits only. Anyone
 * else gets 404, as for a startup that does not exist. A refused write answers
 * `ein_invalid` and never echoes what was sent. An admin write is recorded
 * through logAdminAction with the project and never the number. Storing a
 * valid EIN marks the owner's `ein_received` (services/einMilestone.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { einAccess, einProject, readEin, writeEin } from '../services/companyEin';
import { markEinReceived } from '../services/einMilestone';

const r = new Hono<{ Bindings: Env }>();

r.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  const project = await einProject(c.env, Number(c.req.param('projectId')));
  const access = project ? await einAccess(c.env, user, project) : null;
  if (!project || !access) return c.json({ error: 'not_found' }, 404);
  const full = access === 'founder' && c.req.query('full') === '1';
  return c.json({ ...(await readEin(c.env, project.id, full)), can_edit: true });
});

r.put('/:projectId', async (c) => {
  const user = await requireAuth(c);
  const project = await einProject(c.env, Number(c.req.param('projectId')));
  const access = project ? await einAccess(c.env, user, project) : null;
  if (!project || !access) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { ein?: unknown };
  const out = await writeEin(c.env, project.id, body.ein, user.id);
  if (!out.ok) return c.json({ error: out.error }, 400);
  if (access === 'admin') {
    await logAdminAction(c.env, user.id, user.email, 'company_ein_recorded', { project_id: project.id });
  }
  const milestone = await markEinReceived(c.env, project);
  return c.json({ ok: true, ...(await readEin(c.env, project.id)), can_edit: true, milestone });
});

export default r;
