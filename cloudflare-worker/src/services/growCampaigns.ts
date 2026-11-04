/** D4447 (#4447, carrying #3722's D1481) — campaign plans and venture-scoped links; never sends, posts or spends. */
import type { Env, User } from '../types';
import { Refused } from './growWriters';
import { calendarDay } from './growKpis';

type Body = Record<string, unknown>;
type Campaign = { id: number; uid: string; project_id: number; name: string; goal: string; status: string; starts_on: string | null; ends_on: string | null; budget_cents: number | null; utm_campaign: string | null; segment_id: number | null; archived_at: string | null };
type Statement = ReturnType<Env['DB']['prepare']>;
const goals = ['awareness', 'signups', 'demos', 'sales'];
const transitions: Record<string, string[]> = { draft: ['active'], active: ['paused', 'ended'], paused: ['active'], ended: [] };
const fields = ['name', 'goal', 'status', 'starts_on', 'ends_on', 'budget_cents', 'utm_campaign', 'segment_id'] as const;
const present = (b: Body, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const missing = (field?: string): never => { throw new Refused(404, 'Not found', field); };
function money(v: unknown, field: string): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Refused(400, `${field} must be whole cents, 0 or more, or null`, field);
  return v;
}
async function owned(env: Env, pid: number, uid: string): Promise<Campaign> {
  const row = await env.DB.prepare('SELECT * FROM grow_campaigns WHERE uid = ? AND project_id = ?').bind(uid, pid).first<Campaign>();
  return row ?? missing();
}
function editable(c: Campaign) { if (c.archived_at) throw new Refused(409, 'Archived campaigns cannot be changed'); }
async function channel(env: Env, pid: number, uid: unknown): Promise<number> {
  if (typeof uid !== 'string') return missing('channel_uids');
  const row = await env.DB.prepare('SELECT id FROM growth_channels WHERE uid = ? AND project_id = ?').bind(uid, pid).first<{ id: number }>();
  return row?.id ?? missing('channel_uids');
}
async function values(env: Env, pid: number, b: Body, old?: Campaign): Promise<Body> {
  const out: Body = {};
  for (const k of fields) {
    if (!present(b, k) && old) continue;
    const v = b[k];
    if (k === 'name') {
      if (typeof v !== 'string' || !v.trim() || v.trim().length > 120) throw new Refused(400, 'name must have 1 to 120 characters', k);
      out[k] = v.trim();
    } else if (k === 'goal') {
      if (typeof v !== 'string' || !goals.includes(v)) throw new Refused(400, `goal must be one of ${goals.join(', ')}`, k);
      out[k] = v;
    } else if (k === 'status') {
      if (!old) {
        if (present(b, k)) throw new Refused(400, 'New campaigns start as draft', k);
        out[k] = 'draft';
      } else {
        if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(transitions, v)) throw new Refused(400, 'Invalid campaign status', k);
        if (v !== old.status && !transitions[old.status].includes(v)) throw new Refused(409, 'This campaign status transition is not allowed', k);
        out[k] = v;
      }
    } else if (k === 'starts_on' || k === 'ends_on') {
      if (v == null) out[k] = null;
      else { const day = calendarDay(v); if (!day) throw new Refused(400, `${k} must be a real YYYY-MM-DD date or null`, k); out[k] = day; }
    } else if (k === 'budget_cents') out[k] = money(v === undefined ? null : v, k);
    else if (k === 'utm_campaign') {
      if (v == null) out[k] = null;
      else {
        if (typeof v !== 'string' || !v.trim() || v.trim().length > 80) throw new Refused(400, 'utm_campaign must have 1 to 80 characters or null', k);
        out[k] = v.trim().toLowerCase();
      }
    } else if (k === 'segment_id') {
      if (v == null) out[k] = null;
      else {
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return missing(k);
        const row = await env.DB.prepare('SELECT id FROM customer_segments WHERE id = ? AND project_id = ?').bind(v, pid).first();
        if (!row) return missing(k);
        out[k] = v;
      }
    }
  }
  const merged = { ...old, ...out };
  if (merged.starts_on && merged.ends_on && String(merged.ends_on) < String(merged.starts_on)) throw new Refused(400, 'ends_on cannot be before starts_on', 'ends_on');
  return out;
}
function audit(env: Env, pid: number, user: User, uid: string, action: string) {
  // Same cycle-activity fields, conditional on the immediately preceding mutation
  // in this atomic batch. A stale edit or missing link must not claim a change.
  return env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0')
    .bind(pid, user.id, 'grow.distribution', uid, action, 'Campaign plan changed', `user:${user.id}`);
}
async function uniqueWrite(env: Env, statements: Statement[]) {
  try { return await env.DB.batch(statements); }
  catch (e) {
    if (/UNIQUE constraint failed: grow_campaigns.project_id, grow_campaigns.utm_campaign/i.test(String(e))) throw new Refused(409, 'This UTM campaign tag is already used by this venture', 'utm_campaign');
    throw e;
  }
}
/** The optional figures fail independently; missing values remain null, including explicitly recorded zero spend. */
async function readCampaign(env: Env, c: Campaign) {
  const segment = c.segment_id == null ? null : await env.DB.prepare('SELECT id, name FROM customer_segments WHERE id = ? AND project_id = ?').bind(c.segment_id, c.project_id).first();
  const links = await env.DB.prepare('SELECT g.id, g.uid, g.name, l.planned_budget_cents FROM grow_campaign_channels l JOIN growth_channels g ON g.id = l.channel_id WHERE l.campaign_id = ? AND g.project_id = ? ORDER BY g.name, g.uid').bind(c.id, c.project_id).all<{ id: number; uid: string; name: string; planned_budget_cents: number | null }>();
  const channels = await Promise.all((links.results ?? []).map(async (g) => {
    let spend_cents: number | null = null;
    let spend_reason: string | null = 'Not recorded: this campaign has no complete date window';
    if (c.starts_on && c.ends_on) {
      try {
        const row = await env.DB.prepare('SELECT SUM(spend_cents) AS total FROM channel_spend WHERE channel_id = ? AND month >= ? AND month <= ?').bind(g.id, c.starts_on.slice(0, 7), c.ends_on.slice(0, 7)).first<{ total: number | null }>();
        spend_cents = row?.total ?? null;
        spend_reason = spend_cents == null ? 'Not recorded: no spend entered for these months' : null;
      } catch { spend_reason = 'Unreadable: channel spend could not be read'; }
    }
    return { uid: g.uid, name: g.name, planned_budget_cents: g.planned_budget_cents, planned_budget_reason: g.planned_budget_cents == null ? 'Not recorded: no channel budget entered' : null, spend_cents, spend_reason };
  }));
  let leads: number | null = null;
  let leads_reason: string | null = 'Not recorded: this campaign has no UTM campaign tag';
  if (c.utm_campaign) {
    try {
      const contacts = await env.DB.prepare('SELECT utm_json FROM contacts WHERE project_id = ? AND utm_json IS NOT NULL').bind(c.project_id).all<{ utm_json: string }>();
      leads = 0;
      for (const row of contacts.results ?? []) {
        try { const v = JSON.parse(row.utm_json)?.utm_campaign; if (typeof v === 'string' && v.trim().toLowerCase() === c.utm_campaign) leads++; } catch { /* Same parser as utmSource: malformed attribution is not a match. */ }
      }
      leads_reason = null;
    } catch { leads = null; leads_reason = 'Unreadable: campaign leads could not be read'; }
  }
  const counts = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM grow_campaign_items i JOIN content_calendar_items t ON t.id = i.ref_id WHERE i.campaign_id = ? AND i.kind = 'content_item' AND t.project_id = ?) AS content,
    (SELECT COUNT(*) FROM grow_campaign_items i JOIN publish_drafts t ON t.id = i.ref_id WHERE i.campaign_id = ? AND i.kind = 'publish_draft' AND t.project_id = ?) AS drafts`).bind(c.id, c.project_id, c.id, c.project_id).first<{ content: number; drafts: number }>();
  return { uid: c.uid, name: c.name, goal: c.goal, status: c.status, starts_on: c.starts_on, ends_on: c.ends_on, budget_cents: c.budget_cents,
    budget_reason: c.budget_cents == null ? 'Not recorded: no campaign budget entered' : null, utm_campaign: c.utm_campaign, segment, channels, items: counts, leads, leads_reason };
}
export async function campaigns(env: Env, pid: number) {
  const rows = await env.DB.prepare('SELECT * FROM grow_campaigns WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC, id DESC').bind(pid).all<Campaign>();
  return { campaigns: await Promise.all((rows.results ?? []).map((c) => readCampaign(env, c))) };
}
const response = async (env: Env, pid: number, uid: string) => ({ campaign: await readCampaign(env, await owned(env, pid, uid)) });
export async function createCampaign(env: Env, pid: number, user: User, b: Body) {
  const v = await values(env, pid, b);
  const ids = await channelIds(env, pid, b);
  const uid = crypto.randomUUID().replace(/-/g, '');
  const statements = [env.DB.prepare('INSERT INTO grow_campaigns (uid, project_id, name, goal, status, starts_on, ends_on, budget_cents, utm_campaign, segment_id, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(uid, pid, ...fields.map((k) => v[k]), user.id, user.id)];
  for (const id of ids ?? []) statements.push(env.DB.prepare('INSERT INTO grow_campaign_channels (campaign_id, channel_id) SELECT id, ? FROM grow_campaigns WHERE uid = ? AND project_id = ?').bind(id, uid, pid));
  await uniqueWrite(env, [...statements, audit(env, pid, user, uid, 'grow_campaign_created')]);
  return response(env, pid, uid);
}
async function channelIds(env: Env, pid: number, b: Body): Promise<number[] | null> {
  if (!present(b, 'channel_uids')) return null;
  if (!Array.isArray(b.channel_uids) || b.channel_uids.length > 100) throw new Refused(400, 'channel_uids must be an array of at most 100 channel uids', 'channel_uids');
  return [...new Set(await Promise.all(b.channel_uids.map((uid) => channel(env, pid, uid))))];
}
export async function updateCampaign(env: Env, pid: number, user: User, uid: string, b: Body) {
  const old = await owned(env, pid, uid); editable(old);
  const v = await values(env, pid, b, old);
  const ids = await channelIds(env, pid, b);
  // Every statement uses the same snapshot in one atomic batch. Concurrent edits
  // cannot overwrite dates/status or leave a partial replacement of the links.
  const keys = fields.filter((k) => present(v, k));
  const guard = 'id = ? AND project_id = ? AND archived_at IS NULL AND name IS ? AND goal IS ? AND status IS ? AND starts_on IS ? AND ends_on IS ? AND budget_cents IS ? AND utm_campaign IS ? AND segment_id IS ?';
  const args = [old.id, pid, ...fields.map((k) => old[k])];
  const statements: Statement[] = [];
  if (ids !== null) {
    statements.push(env.DB.prepare(`DELETE FROM grow_campaign_channels WHERE campaign_id IN (SELECT id FROM grow_campaigns WHERE ${guard}) AND channel_id NOT IN (SELECT value FROM json_each(?))`).bind(...args, JSON.stringify(ids)));
    for (const id of ids) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO grow_campaign_channels (campaign_id, channel_id) SELECT id, ? FROM grow_campaigns WHERE ${guard}`).bind(id, ...args));
  }
  statements.push(env.DB.prepare(`UPDATE grow_campaigns SET ${keys.map((k) => `${k} = ?, `).join('')}updated_by = ?, updated_at = datetime('now') WHERE ${guard}`).bind(...keys.map((k) => v[k]), user.id, ...args));
  const result = await uniqueWrite(env, [...statements, audit(env, pid, user, uid, 'grow_campaign_updated')]);
  if (!result[statements.length - 1].meta.changes) throw new Refused(409, 'Campaign changed; read it again before editing');
  return response(env, pid, uid);
}
export async function campaignChannel(env: Env, pid: number, user: User, uid: string, channelUid: string, b: Body, remove = false) {
  const c = await owned(env, pid, uid); editable(c);
  const id = await channel(env, pid, channelUid);
  const stmt = remove
    ? env.DB.prepare('DELETE FROM grow_campaign_channels WHERE campaign_id = ? AND channel_id = ? AND EXISTS (SELECT 1 FROM grow_campaigns WHERE id = ? AND archived_at IS NULL)').bind(c.id, id, c.id)
    : env.DB.prepare('INSERT INTO grow_campaign_channels (campaign_id, channel_id, planned_budget_cents) SELECT id, ?, ? FROM grow_campaigns WHERE id = ? AND archived_at IS NULL ON CONFLICT(campaign_id, channel_id) DO UPDATE SET planned_budget_cents = excluded.planned_budget_cents').bind(id, money(b.planned_budget_cents, 'planned_budget_cents'), c.id);
  const result = await env.DB.batch([stmt, audit(env, pid, user, uid, 'grow_campaign_channel_changed')]);
  if (!result[0].meta.changes) { editable(await owned(env, pid, uid)); return missing(); }
  return response(env, pid, uid);
}
export async function campaignItem(env: Env, pid: number, user: User, uid: string, kind: unknown, itemUid: unknown, remove = false) {
  const c = await owned(env, pid, uid); editable(c);
  if (kind !== 'content_item' && kind !== 'publish_draft') {
    if (remove) return missing();
    throw new Refused(400, 'kind must be content_item or publish_draft', 'kind');
  }
  const sql = kind === 'content_item' ? 'SELECT id FROM content_calendar_items WHERE uid = ? AND project_id = ?' : 'SELECT id FROM publish_drafts WHERE uid = ? AND project_id = ?';
  if (typeof itemUid !== 'string') return missing('uid');
  const item = await env.DB.prepare(sql).bind(itemUid, pid).first<{ id: number }>();
  if (!item) return missing('uid');
  const stmt = remove
    ? env.DB.prepare('DELETE FROM grow_campaign_items WHERE campaign_id = ? AND kind = ? AND ref_id = ? AND EXISTS (SELECT 1 FROM grow_campaigns WHERE id = ? AND archived_at IS NULL)').bind(c.id, kind, item.id, c.id)
    : env.DB.prepare('INSERT INTO grow_campaign_items (campaign_id, kind, ref_id) SELECT id, ?, ? FROM grow_campaigns WHERE id = ? AND archived_at IS NULL ON CONFLICT DO NOTHING').bind(kind, item.id, c.id);
  const result = await env.DB.batch([stmt, audit(env, pid, user, uid, 'grow_campaign_item_changed')]);
  editable(await owned(env, pid, uid));
  if (remove && !result[0].meta.changes) return missing();
  return response(env, pid, uid);
}
export async function archiveCampaign(env: Env, pid: number, user: User, uid: string) {
  const c = await owned(env, pid, uid); editable(c);
  const result = await env.DB.batch([env.DB.prepare("UPDATE grow_campaigns SET archived_at = datetime('now'), updated_at = datetime('now'), updated_by = ? WHERE id = ? AND archived_at IS NULL").bind(user.id, c.id), audit(env, pid, user, uid, 'grow_campaign_archived')]);
  if (!result[0].meta.changes) throw new Refused(409, 'Archived campaigns cannot be changed');
  return { ok: true };
}
