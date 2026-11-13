/** D4486 (#4486) — gated venture channels and read-only connection cards at /api/grow/channels. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { channelConnections, channelReadings } from '../services/growChannels';

const router = new Hono<{ Bindings: Env }>();
router.get('/', async (c) => {
  let user;
  try { user = await requireAuth(c); } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  const pid = Number(c.req.query('project'));
  if (!Number.isSafeInteger(pid) || pid <= 0) return c.json({ detail: 'project is required', field: 'project' }, 400);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(pid).first<{ id: number; founder_id: number | null }>();
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  if (!await canAccessProject(c.env, user, project, { write: false })) return c.json({ detail: 'Forbidden' }, 403);
  try {
    const support = !!(await selectJwt(c))?.payload.impersonated_by;
    const [data, connections, can_write] = await Promise.all([
      channelReadings(c.env, pid), channelConnections(c.env, user, pid, support),
      canAccessProject(c.env, user, project, { write: true }),
    ]);
    return c.json({ ...data, connections, can_write });
  } catch { return c.json({ detail: 'Channel details are unreadable. Try again.' }, 503); }
});
export const mount = { path: '/api/grow/channels', router: router };
export default router;
