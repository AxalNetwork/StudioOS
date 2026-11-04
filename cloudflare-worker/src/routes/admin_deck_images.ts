/**
 * #4375 (D4375) — HQ takes down one deck image, mounted at /api/admin/deck-images.
 *
 *   POST /api/admin/deck-images/:uid/takedown   { reason }
 *        → { image: { uid, project_id, taken_down_at, reason, r2_deleted } }
 *          400 reason_required (under 10 characters) | reason_too_long | invalid_reason
 *          404 not_found ; 409 already_taken_down ; 403 for anyone but an HQ admin
 *
 * An HQ administrator (`requireHqAdmin`: an admin or a super admin, never on a
 * branch deployment) is the only caller. The R2 object goes, the row is marked
 * with who, when and why, every card naming the image shows "Image removed by
 * Axal HQ" (the file route answers the placeholder), the founders are told in
 * their inbox, and the admin audit log keeps it (`services/decks/imageTakedown.ts`).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireHqAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { takeDownImage, TakedownRefusal } from '../services/decks/imageTakedown';

const r = new Hono<{ Bindings: Env }>();

r.post('/:uid/takedown', async (c) => {
  const actor = (await requireHqAdmin(c)) as User;
  const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
  try {
    return c.json({ image: await takeDownImage(c.env, actor, c.req.param('uid'), body?.reason) });
  } catch (e) {
    if (e instanceof TakedownRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence });
    throw e;
  }
});

export const mount: RouteMount = { path: '/api/admin/deck-images', router: r };
export default r;
