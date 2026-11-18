/**
 * D6693 (#6693, plan key C3 of #6680): HQ pauses or resumes one entity form of
 * the formation catalogue, mounted at /api/admin/formation/catalogue.
 *
 *   POST /forms/:key/pause    { reason }   the form stops being orderable
 *   POST /forms/:key/resume   { reason }   it is orderable again if every other gate passes
 *
 * Super Admin only, past the write bar, as the partner registry (D6692). A
 * reason is required and kept on the switch; each change is logged in
 * admin_audit_log. It takes effect on the next read: nothing is cached
 * (`services/formationGates.ts`, gate `not_paused`).
 *
 * The form need not be in the current version: a pause outlives a new
 * catalogue version until it is resumed. Editing and publishing the catalogue
 * are #6699 and #6700.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { isSuperAdmin, requireHqAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

export const REASON_MAX = 500;
const FORM_KEY = /^[a-z0-9_]{1,64}$/;

async function superAdminWrite(c: Ctx, admin: User): Promise<Response | null> {
  if (!isSuperAdmin(admin)) return refuse(c, 403, { code: 'super_admin_required', message: 'Only the Super Admin pauses or resumes a form.' });
  await requireSuperAdminWriteBar(c);
  return null;
}

async function setPaused(c: Ctx, paused: boolean) {
  const admin = await requireHqAdmin(c);
  const denied = await superAdminWrite(c, admin);
  if (denied) return denied;
  const key = String(c.req.param('key') ?? '');
  if (!FORM_KEY.test(key)) return refuse(c, 400, { code: 'invalid_form_key', message: 'A form key is lower-case letters, digits and underscores.' });
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return refuse(c, 400, { code: 'reason_required', message: `Say why the form is ${paused ? 'paused' : 'resumed'}. Nothing was changed.` });
  if (reason.length > REASON_MAX) return refuse(c, 400, { code: 'reason_too_long', message: `The reason is at most ${REASON_MAX} characters. Nothing was changed.` });
  const known = await c.env.DB.prepare('SELECT 1 FROM formation_entity_forms WHERE form_key = ? LIMIT 1').bind(key).first();
  if (!known) return refuse(c, 404, { code: 'form_not_found', message: 'No catalogue version has a form with that key.' });
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await c.env.DB.prepare(
    `INSERT INTO formation_form_switches (form_key, paused, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(form_key) DO UPDATE SET paused = excluded.paused, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
  ).bind(key, paused ? 1 : 0, reason, Number(admin.id), now).run();
  await logAdminAction(c.env, Number(admin.id), admin.email || '', paused ? 'formation_form_paused' : 'formation_form_resumed', { form_key: key, reason });
  return c.json({ ok: true, form_key: key, paused, reason, changed_at: now });
}

r.post('/forms/:key/pause', (c) => setPaused(c, true));
r.post('/forms/:key/resume', (c) => setPaused(c, false));

export const mount: RouteMount = { path: '/api/admin/formation/catalogue', router: r };
export default r;
