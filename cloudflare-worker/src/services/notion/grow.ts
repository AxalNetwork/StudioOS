/**
 * D1090 (#2955, #2405 part 6) — what a founder's Notion lands in Grow. Both
 * land as facts through the ledger (D1086): a re-sync updates only a row its
 * own ledger links, so a typed row is never edited, and a row the founder
 * deleted stays deleted.
 *
 *   - DISTRIBUTION. A content-calendar database: each row is one planned piece
 *     in `content_calendar_items` (migration 587, `source = 'notion'`): title,
 *     date → `planned_on`, status, a link, and the channel matched to one of
 *     the venture's `growth_channels` by name (case-insensitive), else none.
 *     Never a channel made up. A plan, never a record of what was sent.
 *   - PRODUCT IMPROVEMENT. A feedback database: each row is one
 *     `product_feedback` row through `addFeedback`: text → `body`, theme,
 *     status, and `source` from its mapped column or the founder's default
 *     (a row with neither is skipped by `mapRow`). A name or an email is
 *     written only when the founder mapped a column for it.
 *
 * On an update only the fields the founder mapped are written. Registered on
 * import (`routes/notion.ts`). Logs hold ids and counts only.
 */
import type { Env, User } from '../../types';
import { CONTENT_STATUS, FEEDBACK_SOURCES, FEEDBACK_STATUS, addFeedback } from '../growWriters';
import { registerFactWriter, type FactItem } from './sync';

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const has = (item: FactItem, k: string) => Object.prototype.hasOwnProperty.call(item.values, k);
const oneOf = (v: unknown, list: readonly string[]) => (typeof v === 'string' && list.includes(v) ? v : null);
/** A full day only: a month alone is not a plan's date. */
const dayOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
/** A web link, or nothing: a cell that is not one is left empty, never refused mid-sync. */
function linkOf(v: unknown): string | null {
  const u = text(v, 2000);
  if (!u) return null;
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null; } catch { return null; }
}
const emailOf = (v: unknown) => { const e = text(v, 200)?.toLowerCase() ?? null; return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null; };
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- Distribution

/** The venture's channel of that name, case-insensitive; none when no channel has it. */
export async function channelByName(env: Env, projectId: number, name: unknown): Promise<number | null> {
  const n = text(name, 120);
  if (!n) return null;
  const row = await env.DB.prepare('SELECT id FROM growth_channels WHERE project_id = ? AND lower(trim(name)) = lower(?) ORDER BY id LIMIT 1')
    .bind(projectId, n).first<{ id: number }>();
  return row ? Number(row.id) : null;
}

registerFactWriter({
  module: 'distribution',
  localTable: 'content_calendar_items',
  async write(env, ctx, item, existingId) {
    const v = item.values;
    const title = text(v.title, 200) ?? 'Untitled';
    if (existingId) {
      const now = await env.DB.prepare('SELECT channel_id, planned_on, status, url FROM content_calendar_items WHERE id = ? AND project_id = ?')
        .bind(existingId, ctx.projectId).first<{ channel_id: number | null; planned_on: string | null; status: string; url: string | null }>();
      if (!now) return existingId;
      await env.DB.prepare('UPDATE content_calendar_items SET title = ?, planned_on = ?, status = ?, channel_id = ?, url = ?, updated_by = ?, updated_at = ? WHERE id = ? AND project_id = ?')
        .bind(title, has(item, 'planned_on') ? dayOf(v.planned_on) : now.planned_on,
          has(item, 'status') ? oneOf(v.status, CONTENT_STATUS) ?? now.status : now.status,
          has(item, 'channel') ? await channelByName(env, ctx.projectId, v.channel) : now.channel_id,
          has(item, 'url') ? linkOf(v.url) : now.url, ctx.userId, nowIso(), existingId, ctx.projectId).run();
      return existingId;
    }
    const uid = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO content_calendar_items (uid, project_id, channel_id, title, planned_on, status, url, source, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'notion', ?, ?)`,
    ).bind(uid, ctx.projectId, await channelByName(env, ctx.projectId, v.channel), title, dayOf(v.planned_on),
      oneOf(v.status, CONTENT_STATUS) ?? 'idea', linkOf(v.url), ctx.userId, ctx.userId).run();
    const row = await env.DB.prepare('SELECT id FROM content_calendar_items WHERE uid = ?').bind(uid).first<{ id: number }>();
    return Number(row!.id);
  },
  async alive(env, projectId, id) {
    return !!(await env.DB.prepare('SELECT 1 FROM content_calendar_items WHERE id = ? AND project_id = ?').bind(id, projectId).first());
  },
  async remove(env, projectId, id) {
    const r = await env.DB.prepare('DELETE FROM content_calendar_items WHERE id = ? AND project_id = ?').bind(id, projectId).run();
    return !!r.meta?.changes;
  },
  async view(env, projectId, ids) {
    const rows = (await env.DB.prepare(
      `SELECT i.id, i.title, i.planned_on, i.status, i.url, g.name AS channel FROM content_calendar_items i
         LEFT JOIN growth_channels g ON g.id = i.channel_id
        WHERE i.project_id = ? AND i.id IN (SELECT value FROM json_each(?))`,
    ).bind(projectId, JSON.stringify(ids)).all<{ id: number; title: string; planned_on: string | null; status: string; url: string | null; channel: string | null }>()).results || [];
    return new Map(rows.map((r) => [Number(r.id), { title: r.title, planned_on: r.planned_on, status: r.status, channel: r.channel, url: r.url }]));
  },
});

// ---------------------------------------------------------------- Product improvement

registerFactWriter({
  module: 'product_improvement',
  localTable: 'product_feedback',
  async write(env, ctx, item, existingId) {
    const v = item.values;
    const body = text(v.body, 4000) ?? '';
    const source = oneOf(v.source, FEEDBACK_SOURCES);
    if (existingId) {
      const now = await env.DB.prepare('SELECT body, source, theme, status, from_name, from_email FROM product_feedback WHERE id = ? AND project_id = ?')
        .bind(existingId, ctx.projectId).first<{ body: string; source: string; theme: string | null; status: string; from_name: string | null; from_email: string | null }>();
      if (!now) return existingId;
      const status = has(item, 'status') ? oneOf(v.status, FEEDBACK_STATUS) ?? now.status : now.status;
      await env.DB.prepare(
        `UPDATE product_feedback SET body = ?, source = ?, theme = ?, status = ?, from_name = ?, from_email = ?,
           shipped_on = CASE WHEN ? = 'shipped' AND status <> 'shipped' THEN ? ELSE shipped_on END, updated_by = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`,
      ).bind(body || now.body, source ?? now.source, has(item, 'theme') ? text(v.theme, 80) : now.theme, status,
        has(item, 'from_name') ? text(v.from_name, 200) : now.from_name, has(item, 'from_email') ? emailOf(v.from_email) : now.from_email,
        status, nowIso().slice(0, 10), ctx.userId, nowIso(), existingId, ctx.projectId).run();
      return existingId;
    }
    // A name or an email reaches the record only when the founder mapped a column for it: `mapRow` carries mapped fields only.
    const out = await addFeedback(env, ctx.projectId, { id: ctx.userId } as User, {
      body, source, theme: text(v.theme, 80), status: oneOf(v.status, FEEDBACK_STATUS), from_name: text(v.from_name, 200), from_email: emailOf(v.from_email),
    });
    const row = await env.DB.prepare('SELECT id FROM product_feedback WHERE uid = ?').bind(out.uid).first<{ id: number }>();
    return Number(row!.id);
  },
  async alive(env, projectId, id) {
    return !!(await env.DB.prepare('SELECT 1 FROM product_feedback WHERE id = ? AND project_id = ?').bind(id, projectId).first());
  },
  async remove(env, projectId, id) {
    const r = await env.DB.prepare('DELETE FROM product_feedback WHERE id = ? AND project_id = ?').bind(id, projectId).run();
    return !!r.meta?.changes;
  },
  async view(env, projectId, ids) {
    // The feedback, never who gave it: From Notion shows the row, the record keeps the name.
    const rows = (await env.DB.prepare('SELECT id, body, theme, status, source FROM product_feedback WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(projectId, JSON.stringify(ids)).all<{ id: number; body: string; theme: string | null; status: string; source: string }>()).results || [];
    return new Map(rows.map((r) => [Number(r.id), { body: r.body, theme: r.theme, status: r.status, source: r.source }]));
  },
});
