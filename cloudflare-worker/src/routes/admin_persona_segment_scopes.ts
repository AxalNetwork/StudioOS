/** D4438 (#4438) — SEG7's Super Admin scope/overview and waiting suggestions, over existing stores. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { checkedScope, scopedSegmentOverview, segmentScopes, SegmentScopeError } from '../services/personaSegmentScopes';
import { listSuggestions } from '../services/segmentSuggestions';
const router = new Hono<{ Bindings: Env }>();
const scopeRefusal = (c: any, e: SegmentScopeError) => e.status === 404
  ? refuse(c, 404, { code: 'scope_not_found', message: 'That studio scope is not recorded.' })
  : refuse(c, 503, { code: 'unreadable', message: 'Could not be read. This is not a claim that there are none.' });
router.get('/', async (c) => {
  try { await requireSuperAdmin(c); return c.json(await segmentScopes(c.env)); } catch (e) { return mapError(c, e); }
});
router.get('/overview', async (c) => {
  try { await requireSuperAdmin(c); return c.json(await scopedSegmentOverview(c.env, c.req.query('scope'))); }
  catch (e) { if (e instanceof SegmentScopeError) return scopeRefusal(c, e); return mapError(c, e); }
});
router.get('/suggestions', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    const { scope } = await checkedScope(c.env, c.req.query('scope'));
    const read = await listSuggestions(c.env, { id: Number(user.id), superAdmin: true }, 'open', scope.code === '*' ? null : scope.code);
    return c.json({ ...read, selected_scope: scope.code });
  } catch (e) { if (e instanceof SegmentScopeError) return scopeRefusal(c, e); if (e instanceof Error && ['Unauthorized', 'Admin required', 'Super admin required', 'HQ only'].includes(e.message)) return mapError(c, e); return refuse(c, 503, { code: 'unreadable', message: 'Could not be read. This is not a claim that there are none.' }); }
});
export const mount = { path: '/api/admin/persona-segment-scopes', router: router };
export default router;
