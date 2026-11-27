/**
 * #8516 (D8516) — the operator's hand on the e-sign effect record: one retry of
 * one `esign_effects` row, for a Super Admin (the same gate as the staged
 * countersign, the narrowest admin gate the e-sign routes use). The tick
 * retries pending and failed records on its own up to the attempt cap
 * (services/esignEffects.ts); this runs one more attempt by hand, past the
 * cap, and changes nothing on a record that is already `done`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import esign from './esign';
import type { RouteMount } from '../util/routeRegistry';

const effects = new Hono<{ Bindings: Env }>();

effects.onError((error, c) => {
  const status = AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c, status, { code: status === 401 ? 'unauthorized' : 'forbidden', message: 'Only a Super Admin can retry a signing effect.' });
  return refuse(c, 503, { code: 'esign_effect_unavailable', message: 'The effect could not be retried just now. Please try again.', raw: error });
});

// POST /api/legal/esign/effects/:id/retry — one attempt now.
effects.post('/:id/retry', async (c) => {
  await requireSuperAdmin(c);
  const raw = c.req.param('id');
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return refuse(c, 404, { code: 'effect_not_found', message: 'That signing effect was not found.' });
  const { runEffect } = await import('../services/esignEffects');
  const out = await runEffect(c.env, Number(raw), c.env.APP_URL || 'https://axal.vc', { force: true });
  if (out.state === 'missing') return refuse(c, 404, { code: 'effect_not_found', message: 'That signing effect was not found.' });
  return c.json({ id: Number(raw), ran: out.ran, state: out.state, attempts: out.attempts, last_error_class: out.error_class });
});

export const mount: RouteMount = { path: '/api/legal/esign/effects', router: effects, before: [esign] };
export default effects;
