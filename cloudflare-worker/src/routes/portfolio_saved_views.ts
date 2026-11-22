/** D6209: member-private Portfolio table settings; never an access grant or SQL predicate. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, canViewLpData, selectJwt } from '../auth';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
const router = new Hono<{ Bindings: Env }>();
class Refused extends Error { readonly status: 400 | 404 | 409; constructor(status: 400 | 404 | 409, message: string) { super(message); this.status = status; } }
export function portfolioViewSpec(page: unknown, raw: unknown) {
  if (!['overview', 'positions'].includes(String(page)) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Refused(400, 'Choose a Portfolio table and valid settings.');
  const value = raw as Record<string, unknown>;
  const allowed = page === 'overview' ? ['query', 'sector', 'stage', 'health', 'reporting', 'sort'] : ['query', 'filter', 'stage', 'as_of'];
  if (Object.keys(value).some(key => !allowed.includes(key)) || Object.values(value).some(v => typeof v !== 'string' || v.length > 200)) throw new Refused(400, 'The view settings are invalid.');
  // Stage/sector values survive retirement so applying a saved view can honestly return no matches.
  if (page === 'overview' && value.sort !== undefined && !['health', 'invested', 'multiple', 'updated'].includes(String(value.sort))) throw new Refused(400, 'Choose a recorded sort.');
  if (page === 'positions' && value.filter !== undefined && !['all', 'attention', 'marked', 'stage'].includes(String(value.filter))) throw new Refused(400, 'Choose a recorded filter.');
  if (value.as_of && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.as_of)) || !Number.isFinite(Date.parse(String(value.as_of) + 'T00:00:00Z')) || new Date(String(value.as_of) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.as_of)) throw new Refused(400, 'Choose a valid as-of date.');
  return JSON.stringify(value);
}
const nameOf = (raw: unknown) => { if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 100) throw new Refused(400, 'Give the view a name of at most 100 characters.'); return raw.trim(); };
const versionOf = (raw: unknown) => { if (!Number.isSafeInteger(raw) || Number(raw) < 1) throw new Refused(400, 'Refresh the view before changing it.'); return Number(raw); };
const pageOf = (raw: unknown) => { if (!['overview', 'positions'].includes(String(raw))) throw new Refused(400, 'Choose a Portfolio table.'); return String(raw); };
const shape = (row: any) => ({ uid: row.uid, page: row.page, name: row.name, spec: JSON.parse(row.spec_json), version: row.version, updated_at: row.updated_at });
function failure(c: any, error: any) {
  const status = error instanceof Refused ? error.status : AUTH_ERROR_STATUSES[error?.message];
  return c.json({ error: status ? error.message : 'Saved views are unreadable. Try again.' }, status || 503);
}
router.use('*', async (c, next) => {
  const user = await requireAuth(c);
  if (!canViewLpData(user) || (await selectJwt(c))?.payload.impersonated_by) return c.json({ error: 'Only this member can manage their Portfolio views.' }, 403);
  c.set('portfolioViewOwner' as never, Number(user.id) as never);
  c.header('Cache-Control', 'no-store');
  await next();
});
const owner = (c: any): number => c.get('portfolioViewOwner');
const idOf = (c: any) => { const id = c.req.param('uid'); if (!/^[a-f0-9]{32}$/.test(id)) throw new Refused(404, 'View not found.'); return id; };
router.get('/', async c => {
  try {
    const page = pageOf(c.req.query('page'));
    const result = await c.env.DB.prepare('SELECT uid,page,name,spec_json,version,updated_at FROM portfolio_saved_views WHERE owner_user_id=? AND page=? ORDER BY name,uid').bind(owner(c), page).all();
    if (result.success !== true) throw new Error('read');
    return c.json({ items: result.results.map(shape) });
  } catch (e) { return failure(c, e); }
});
router.post('/', async c => {
  try {
    const body = await c.req.json().catch(() => { throw new Refused(400, 'The view request is invalid.'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refused(400, 'The view request is invalid.');
    const page = pageOf(body.page), name = nameOf(body.name), spec = portfolioViewSpec(page, body.spec), uid = crypto.randomUUID().replaceAll('-', '');
    const result = await c.env.DB.prepare(`INSERT INTO portfolio_saved_views(uid,owner_user_id,page,name,spec_json)
      SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM portfolio_saved_views WHERE owner_user_id=? AND page=?)<100`).bind(uid, owner(c), page, name, spec, owner(c), page).run();
    if (!result.success) throw new Error('write');
    if (!result.meta.changes) throw new Refused(409, 'Remove a saved view before adding another.');
    return c.json({ uid, page, name, spec: JSON.parse(spec), version: 1 }, 201);
  } catch (e) { return failure(c, e); }
});
router.patch('/:uid', async c => {
  try {
    const id = idOf(c), body = await c.req.json().catch(() => { throw new Refused(400, 'The view request is invalid.'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refused(400, 'The view request is invalid.');
    const name = nameOf(body.name), version = versionOf(body.version);
    const result = await c.env.DB.prepare('UPDATE portfolio_saved_views SET name=?,version=version+1,updated_at=datetime(\'now\') WHERE uid=? AND owner_user_id=? AND version=?').bind(name, id, owner(c), version).run();
    if (!result.success) throw new Error('write');
    if (!result.meta.changes) throw new Refused(409, 'The view changed or is unavailable. Refresh and try again.');
    return c.json({ ok: true, version: version + 1 });
  } catch (e) { return failure(c, e); }
});
router.delete('/:uid', async c => {
  try {
    const id = idOf(c), raw = c.req.query('version');
    if (!/^[1-9]\d{0,14}$/.test(raw || '')) throw new Refused(400, 'Refresh the view before changing it.');
    const version = versionOf(Number(raw));
    const result = await c.env.DB.prepare('DELETE FROM portfolio_saved_views WHERE uid=? AND owner_user_id=? AND version=?').bind(id, owner(c), version).run();
    if (!result.success) throw new Error('write');
    if (!result.meta.changes) throw new Refused(409, 'The view changed or is unavailable. Refresh and try again.');
    return c.json({ ok: true });
  } catch (e) { return failure(c, e); }
});
export const mount = { path: '/api/portfolio-saved-views', router: router };
export default router;
