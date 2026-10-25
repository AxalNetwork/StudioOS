/**
 * D1040 (#2888) — HQ's approvals inbox: every waiting item, oldest first, with
 * its assignee, and assignment and history on HQ. Mounted at
 * /api/admin/approvals.
 *
 *   GET  /?page=                               the inbox: 25 a page, an exact total, `unreadable`, the tiles
 *        &q=&lane=&group=&age=&assigned=&sort= D1132: search, filters and sort, each lane's age-band split
 *   GET  /items/:lane/:id                      D1132: one waiting item, its lane and its history
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
  INBOX_LANE_CAP, assignFromBody, assignmentHistory, hqInbox, inboxItem, readHistoryQuery,
} from '../services/approvalAssignments';
import { parseInboxQuery } from '../services/approvalInbox';

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
    const query = parseInboxQuery((k) => c.req.query(k), sources);
    if (typeof query === 'string') {
      return refuse(c, 400, { code: 'bad_filter', message: `The ${query} filter is not one this inbox reads.`, audience: 'member' });
    }
    const inbox = await hqInbox(c.env, { page, callerId: Number(admin.id), sources, query });
    if ('refused' in inbox && inbox.refused) {
      return refuse(c, inbox.refused.status, { code: inbox.refused.code, message: inbox.refused.message, audience: 'member' });
    }
    return c.json(inbox);
  } catch (e) { return mapError(c, e); }
});

// D1132: one item, for `/admin/approvals/[id]`. A lane the reader cannot see,
// and an item no longer waiting, are both 404: neither says what HQ holds.
r.get('/items/:lane/:id', async (c) => {
  try {
    const { sources } = await reader(c);
    const q = readHistoryQuery(c.req.param('lane'), c.req.param('id'), sources);
    if (!q.ok) return refuse(c, 404, { code: 'item_not_found', message: 'That item is not on this inbox.', audience: 'member' });
    const found = await inboxItem(c.env, { lane: q.lane, itemId: q.itemId, sources });
    if (found === 'unreadable') {
      return refuse(c, 503, { code: 'lane_unreadable', message: 'This lane could not be read, so the item is not shown. Try again in a moment.', audience: 'member' });
    }
    if (!found) {
      return refuse(c, 404, { code: 'item_not_waiting', message: 'This item is not waiting any more: it was decided, withdrawn or moved.', audience: 'member' });
    }
    return c.json(found);
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
