/**
 * D1040 (#2888) — HQ's approvals inbox: every waiting item, oldest first, with
 * its assignee, and assignment and history on HQ. Mounted at
 * /api/admin/approvals.
 *
 *   GET  /?page=                               the inbox: 25 a page, an exact total, `unreadable`, the tiles
 *   GET  /history?lane=&item_id=               an item's assignment events
 *   POST /assignments                          { assignee_user_id, items: [{ lane, item_id }] }
 *
 * The branch board's reads and write (D130, D470) without `requireBranchTier`,
 * on `requireAdmin`; the board itself is `approvalBoard`, shared, not copied.
 * Like the branch board, it reads and never decides (`decides: false`).
 *
 * A lane marked `scope: 'hq'` (part 3's HQ lanes) is a Super Admin's: an
 * admin without the elevation neither reads it nor assigns or reads history
 * on it (`sourcesFor`). On a branch nobody holds the elevation: auth's
 * `hydrateSuperAdmin` clears it there.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireBranchNotSuspended } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { sourcesFor } from '../services/approvalSources';
import { inboxSources } from '../services/hqApprovalSources';
import {
  INBOX_LANE_CAP, assignFromBody, assignmentHistory, hqInbox, readHistoryQuery,
} from '../services/approvalAssignments';

const r = new Hono<{ Bindings: Env }>();

async function reader(c: Context<{ Bindings: Env }>) {
  const admin = await requireAdmin(c);
  // D1041: HQ's own lanes ride the list; `sourcesFor` keeps them a Super Admin's.
  return { admin, sources: sourcesFor(isSuperAdmin(admin as any), inboxSources()) };
}

r.get('/', async (c) => {
  try {
    const { admin, sources } = await reader(c);
    const raw = c.req.query('page');
    const page = raw == null || raw === '' ? 1 : Number(raw);
    if (!Number.isSafeInteger(page) || page < 1) {
      return refuse(c, 400, { code: 'bad_page', message: 'page is a whole number of at least 1.', audience: 'member' });
    }
    return c.json(await hqInbox(c.env, { page, callerId: Number(admin.id), sources }));
  } catch (e) { return mapError(c, e); }
});

r.get('/history', async (c) => {
  try {
    const { sources } = await reader(c);
    const q = readHistoryQuery(String(c.req.query('lane') || ''), c.req.query('item_id'), sources);
    if (!q.ok) return refuse(c, q.status, { code: q.code, message: q.message, audience: 'member' });
    return c.json(await assignmentHistory(c.env, q.lane, q.itemId));
  } catch (e) { return mapError(c, e); }
});

r.post('/assignments', async (c) => {
  try {
    const { admin, sources } = await reader(c);
    await requireBranchNotSuspended(c);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    // Any item the inbox can show can be assigned: the board is read to the inbox's own cap.
    const result = await assignFromBody(c.env, admin, body, { sources, boardLimit: INBOX_LANE_CAP });
    if (!result.ok) return refuse(c, result.status, { code: result.code, message: result.message, audience: 'member' });
    return c.json({ assigned: result.assigned });
  } catch (e) { return mapError(c, e); }
});

export default r;
