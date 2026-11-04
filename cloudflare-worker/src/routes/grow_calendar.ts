/** D4489 — venture-scoped calendar plans. Sending remains exclusively in Publish. */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { calendarDay } from '../services/growKpis';
import { Refused } from '../services/growWriters';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;
async function access(c: C, write = false) {
  const user = await requireAuth(c);
  const id = Number(c.req.query('project'));
  if (!Number.isSafeInteger(id) || id < 1) throw new Refused(400, 'project is required');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new Refused(404, 'Project not found');
  if (!await canAccessProject(c.env, user, p, { write })) throw new Refused(403, 'Forbidden');
  return { id, user };
}
function fail(c: C, e: unknown) {
  if (e instanceof Refused) return c.json({ detail: e.sentence }, e.status as 400);
  throw e;
}
export function plannedTime(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Refused(400, 'Time must be HH:MM or null');
  return v;
}
router.get('/', async (c) => {
  try {
    const { id } = await access(c);
    const from = calendarDay(c.req.query('from')); const to = calendarDay(c.req.query('to'));
    if (!from || !to || from > to) throw new Refused(400, 'A valid inclusive from and to date range is required');
    const channel = c.req.query('channel') || null; const campaign = c.req.query('campaign') || null;
    const rows = await c.env.DB.prepare(`SELECT i.*, g.uid AS channel_uid, g.name AS channel_name, g.kind AS channel_kind
      FROM content_calendar_items i LEFT JOIN growth_channels g ON g.id = i.channel_id AND g.project_id = i.project_id
      WHERE i.project_id = ? AND i.planned_on >= ? AND i.planned_on <= ?
      AND (? IS NULL OR g.uid = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM grow_campaign_items l JOIN grow_campaigns c ON c.id = l.campaign_id
        WHERE l.kind = 'content_item' AND l.ref_id = i.id AND c.project_id = i.project_id AND c.uid = ?))
      ORDER BY i.planned_on, i.planned_at_time, i.uid`).bind(id, from, to, channel, channel, campaign, campaign).all<Record<string, unknown>>();
    const links = await c.env.DB.prepare(`SELECT l.ref_id, c.uid, c.name, c.utm_campaign FROM grow_campaign_items l
      JOIN grow_campaigns c ON c.id = l.campaign_id WHERE c.project_id = ? AND l.kind = 'content_item' ORDER BY c.name, c.uid`).bind(id).all<{ ref_id: number; uid: string; name: string; utm_campaign: string | null }>();
    return c.json({ pieces: (rows.results || []).map((i) => ({ ...i, status: i.source === 'notion' ? 'planned' : i.status,
      campaigns: (links.results || []).filter((l) => l.ref_id === i.id).map(({ ref_id: _ref, ...v }) => v) })) });
  } catch (e) { return fail(c, e); }
});
router.put('/pieces/:uid/time', async (c) => {
  try {
    const { id, user } = await access(c, true);
    const b = await c.req.json().catch(() => ({})); const time = plannedTime(b.planned_at_time);
    const uid = c.req.param('uid');
    const item = await c.env.DB.prepare('SELECT id, source FROM content_calendar_items WHERE uid = ? AND project_id = ?').bind(uid, id).first<{ id: number; source: string }>();
    if (!item) throw new Refused(404, 'Piece not found');
    if (item.source === 'notion') throw new Refused(409, 'Edit this piece in Notion');
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE content_calendar_items SET planned_at_time = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?").bind(time, user.id, item.id, id),
      c.env.DB.prepare("INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, 'grow.distribution', ?, 'grow_content_time', 'Planned time changed', ?)").bind(id, user.id, uid, `user:${user.id}`),
    ]);
    return c.json({ uid, planned_at_time: time });
  } catch (e) { return fail(c, e); }
});
export const mount = { path: '/api/grow/calendar', router: router };
export default router;
