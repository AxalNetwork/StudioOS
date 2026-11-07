/**
 * #4707 — HQ licence routes: licence history, a page at a time (D4707). Mounted by `admin_licences.ts` at
 * `/api/admin/licences`, in the order the routes were declared before the split;
 * moved unchanged, with their original comments.
 */
import { Hono } from 'hono';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { byUid } from '../services/licenceLedgerCore';
import type { Env } from '../types';
import {
  EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX, type LicenceEventItem, type LicenceEventsPage,
} from '../services/licenceContracts';

// #4707 — the page limit is the contract's; re-exported for the callers that read it here.
export { EVENTS_PAGE_MAX };

const r = new Hono<{ Bindings: Env }>();

/**
 * D4707 — GET /api/admin/licences/:uid/events?before=<id>&limit=<n>
 *
 * The licence's history, newest first, a page at a time (keyset on `id`, so a
 * row written while someone pages is never skipped or shown twice). Each row
 * names its ACTOR (`actor_user_id` joined to the account's name; an account
 * since deleted reads as unknown, not as nobody), carries the structured
 * `before` and `after` the write recorded, and its `outcome`. A row written
 * before D4707, or by a path that records none of these, says so with
 * `recorded: false` rather than an empty change.
 *
 * `next_before` is the cursor for the next page, or null at the start of the
 * history: the page is never silently capped.
 */
export const parseJson = (raw: unknown): { ok: boolean; value: unknown } => {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(String(raw)) }; } catch { return { ok: false, value: null }; }
};

r.get('/:uid/events', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const limitRaw = Number(c.req.query('limit') || EVENTS_PAGE_DEFAULT);
    const limit = Number.isInteger(limitRaw) ? Math.min(EVENTS_PAGE_MAX, Math.max(1, limitRaw)) : EVENTS_PAGE_DEFAULT;
    const beforeRaw = c.req.query('before');
    const before = beforeRaw === undefined || beforeRaw === '' ? null : Number(beforeRaw);
    if (before !== null && (!Number.isInteger(before) || before < 1)) {
      return c.json({ error: 'bad_cursor', message: 'before is the id of the oldest row already shown.' }, 400);
    }
    const q = await c.env.DB.prepare(
      `SELECT e.id, e.event, e.note, e.detail_json, e.before_json, e.after_json, e.outcome, e.created_at,
              e.actor_user_id, u.name AS actor_name, u.email AS actor_email
         FROM licence_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.licence_id = ? AND (? IS NULL OR e.id < ?)
        ORDER BY e.id DESC LIMIT ?`,
    ).bind(licence.id, before, before, limit + 1).all<any>();
    const rows = (q.results || []) as any[];
    const page = rows.slice(0, limit);
    const items = page.map((e): LicenceEventItem => {
      const detail = parseJson(e.detail_json);
      const b = parseJson(e.before_json);
      const a = parseJson(e.after_json);
      const recorded = e.before_json !== null || e.after_json !== null;
      return {
        id: e.id,
        event: e.event,
        note: e.note ?? null,
        created_at: e.created_at,
        actor: e.actor_user_id === null || e.actor_user_id === undefined
          ? { state: 'none' }
          : (e.actor_name || e.actor_email
            ? { state: 'known', id: e.actor_user_id, name: e.actor_name || e.actor_email }
            : { state: 'unknown', id: e.actor_user_id }),
        change: !recorded
          ? { recorded: false }
          : (b.ok && a.ok ? { recorded: true, before: b.value, after: a.value } : { recorded: true, readable: false }),
        detail: detail.ok ? detail.value : null,
        outcome: e.outcome ?? null,
      };
    });
    return c.json({
      items,
      next_before: rows.length > limit && page.length ? page[page.length - 1].id : null,
    } satisfies LicenceEventsPage);
  } catch (e) { return mapError(c, e); }
});

export default r;
