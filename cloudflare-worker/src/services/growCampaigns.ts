/** D4447 (#4447, carrying #3722's D1481) — campaign plans and venture-scoped links; never sends, posts or spends. */
import type { Env, User } from '../types';
import { Refused } from './growWriters';
import { calendarDay } from './growKpis';

type Body = Record<string, unknown>;
type Campaign = { id: number; uid: string; project_id: number; name: string; goal: string; status: string; starts_on: string | null; ends_on: string | null; budget_cents: number | null; utm_campaign: string | null; segment_id: number | null; audience_kind: string | null; created_by: number | null; created_at: string; archived_at: string | null };
type Statement = ReturnType<Env['DB']['prepare']>;
const goals = ['awareness', 'signups', 'demos', 'sales'];
const transitions: Record<string, string[]> = { draft: ['active'], active: ['paused', 'ended'], paused: ['active', 'ended'], ended: [] };
const fields = ['name', 'goal', 'status', 'starts_on', 'ends_on', 'budget_cents', 'utm_campaign', 'segment_id', 'audience_kind'] as const;
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
    } else if (k === 'audience_kind') {
      if (v != null && (typeof v !== 'string' || !['icp', 'segment', 'import', 'none'].includes(v))) throw new Refused(400, 'audience_kind must be icp, segment, import, none or null', k);
      out[k] = v ?? null;
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
  if (merged.audience_kind === 'none') out.segment_id = null;
  if (['icp', 'segment'].includes(String(merged.audience_kind)) && !merged.segment_id) throw new Refused(400, 'This audience kind needs a segment_id', 'segment_id');
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
/** D4491: a reporting window is both real YYYY-MM-DD days, from on or before to; absent means lifetime. */
export type ReportingWindow = { from: string; to: string };
export function reportingWindow(from: unknown, to: unknown): ReportingWindow | null {
  const given = (v: unknown) => v !== undefined && v !== null && v !== '';
  if (!given(from) && !given(to)) return null;
  if (!given(from) || !given(to)) throw new Refused(400, 'A reporting window needs both from and to', given(from) ? 'to' : 'from');
  const a = calendarDay(from); const b = calendarDay(to);
  if (!a) throw new Refused(400, 'from must be a real YYYY-MM-DD date', 'from');
  if (!b) throw new Refused(400, 'to must be a real YYYY-MM-DD date', 'to');
  if (a > b) throw new Refused(400, 'from cannot be after to', 'from');
  return { from: a, to: b };
}
/** Demos are qualified through active; customers are active (contacts.ts CONTACT_STATUSES). */
export const isDemo = (status: string) => status === 'qualified' || status === 'active';
export const isCustomer = (status: string) => status === 'active';
/**
 * D4483/D4491: recorded spend for one venture channel over [start, end] months. Mercury wins a
 * measured month that also has a manual row; a month with no rows is skipped, never zero.
 */
export async function channelSpend(env: Env, pid: number, g: { id: number; uid: string }, start: string, end: string) {
  const manual = await env.DB.prepare('SELECT month, spend_cents FROM channel_spend WHERE channel_id = ? AND month >= ? AND month <= ?').bind(g.id, start, end).all<{ month: string; spend_cents: number }>();
  const mercury = await env.DB.prepare("SELECT period, amount_cents FROM mercury_grow_facts WHERE project_id = ? AND module = 'distribution' AND kind = 'channel_spend' AND subject = ? AND period >= ? AND period <= ?").bind(pid, g.uid, start, end).all<{ period: string; amount_cents: number | null }>();
  const months = new Map<string, { spend_cents: number; source: 'mercury' | 'manual' }>();
  for (const m of manual.results ?? []) months.set(m.month, { spend_cents: m.spend_cents, source: 'manual' });
  // Mercury wins only a measured month; missing months are never invented as zero.
  for (const m of mercury.results ?? []) if (m.amount_cents != null) months.set(m.period, { spend_cents: m.amount_cents, source: 'mercury' });
  const spend_months: { month: string; spend_cents: number; source: 'mercury' | 'manual' }[] = [];
  for (const [month, value] of [...months].sort(([a], [b]) => a.localeCompare(b))) spend_months.push({ month, ...value });
  const spend_cents = spend_months.length ? spend_months.reduce((sum, m) => sum + m.spend_cents, 0) : null;
  const sources = new Set(spend_months.map((m) => m.source));
  const spend_source: 'mercury' | 'manual' | 'mixed' | null = sources.size > 1 ? 'mixed' : spend_months[0]?.source ?? null;
  return { spend_cents, spend_source, spend_months };
}
/** One attribution scan per venture/list request, using utmSource's permissive JSON parsing. */
async function campaignLeads(env: Env, pid: number, window: ReportingWindow | null = null): Promise<{ counts: Map<string, { leads: number; demos: number; customers: number }> | null; reason: string | null }> {
  try {
    // D4491: with a window, only contacts created inside [from, to] count; status stays current.
    const contacts = window
      ? await env.DB.prepare('SELECT utm_json, status FROM contacts WHERE project_id = ? AND utm_json IS NOT NULL AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?').bind(pid, window.from, window.to).all<{ utm_json: string; status: string }>()
      : await env.DB.prepare('SELECT utm_json, status FROM contacts WHERE project_id = ? AND utm_json IS NOT NULL').bind(pid).all<{ utm_json: string; status: string }>();
    const counts = new Map<string, { leads: number; demos: number; customers: number }>();
    for (const row of contacts.results ?? []) {
      try {
        const v = JSON.parse(row.utm_json)?.utm_campaign;
        if (typeof v === 'string' && v.trim()) {
          const tag = v.trim().toLowerCase();
          const totals = counts.get(tag) ?? { leads: 0, demos: 0, customers: 0 };
          totals.leads++;
          if (isDemo(row.status)) totals.demos++;
          if (isCustomer(row.status)) totals.customers++;
          counts.set(tag, totals);
        }
      } catch { /* Same parser as utmSource: malformed attribution is not a match. */ }
    }
    return { counts, reason: null };
  } catch { return { counts: null, reason: 'Unreadable: campaign leads could not be read' }; }
}

/** The optional figures fail independently; missing values remain null, including explicitly recorded zero spend. */
async function readCampaign(env: Env, c: Campaign, attribution?: Awaited<ReturnType<typeof campaignLeads>>, window: ReportingWindow | null = null) {
  const segment = c.segment_id == null ? null : await env.DB.prepare('SELECT id, name FROM customer_segments WHERE id = ? AND project_id = ?').bind(c.segment_id, c.project_id).first();
  const links = await env.DB.prepare('SELECT g.id, g.uid, g.name, l.planned_budget_cents, l.budget_type, l.starts_on, l.ends_on FROM grow_campaign_channels l JOIN growth_channels g ON g.id = l.channel_id WHERE l.campaign_id = ? AND g.project_id = ? ORDER BY g.name, g.uid').bind(c.id, c.project_id).all<{ id: number; uid: string; name: string; planned_budget_cents: number | null; budget_type: string | null; starts_on: string | null; ends_on: string | null }>();
  const channels = await Promise.all((links.results ?? []).map(async (g) => {
    let spend_cents: number | null = null;
    let spend_reason: string | null = 'Not recorded: this campaign has no complete date window';
    let spend_source: 'mercury' | 'manual' | 'mixed' | null = null;
    const spend_months: { month: string; spend_cents: number; source: 'mercury' | 'manual' }[] = [];
    if (c.starts_on && c.ends_on) {
      // D4491: a window narrows the campaign's own months to the months both share.
      const start = window && window.from.slice(0, 7) > c.starts_on.slice(0, 7) ? window.from.slice(0, 7) : c.starts_on.slice(0, 7);
      const end = window && window.to.slice(0, 7) < c.ends_on.slice(0, 7) ? window.to.slice(0, 7) : c.ends_on.slice(0, 7);
      if (start > end) spend_reason = 'Not recorded: this campaign has no months in this window';
      else try {
        const read = await channelSpend(env, c.project_id, g, start, end);
        spend_cents = read.spend_cents; spend_source = read.spend_source; spend_months.push(...read.spend_months);
        spend_reason = spend_cents == null ? 'Not recorded: no spend entered for these months' : null;
      } catch { spend_reason = 'Unreadable: channel spend could not be read'; }
    }
    return { uid: g.uid, name: g.name, planned_budget_cents: g.planned_budget_cents, budget_type: g.budget_type, starts_on: g.starts_on, ends_on: g.ends_on,
      planned_budget_reason: g.planned_budget_cents == null ? 'Not recorded: no channel budget entered' : null, spend_cents, spend_reason, spend_source, spend_months,
      budget_used_pct: spend_cents == null || g.planned_budget_cents == null || g.planned_budget_cents === 0 ? null : spend_cents / g.planned_budget_cents * 100 };
  }));
  let leads: number | null = null; let demos: number | null = null; let customers: number | null = null;
  let leads_reason: string | null = 'Not recorded: this campaign has no UTM campaign tag';
  if (c.utm_campaign) {
    const result = attribution ?? await campaignLeads(env, c.project_id, window);
    const totals = result.counts?.get(c.utm_campaign);
    leads = result.counts ? totals?.leads ?? 0 : null;
    demos = result.counts ? totals?.demos ?? 0 : null;
    customers = result.counts ? totals?.customers ?? 0 : null;
    leads_reason = result.reason;
  }
  const counts = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM grow_campaign_items i JOIN content_calendar_items t ON t.id = i.ref_id WHERE i.campaign_id = ? AND i.kind = 'content_item' AND t.project_id = ?) AS content,
    (SELECT COUNT(*) FROM grow_campaign_items i JOIN publish_drafts t ON t.id = i.ref_id WHERE i.campaign_id = ? AND i.kind = 'publish_draft' AND t.project_id = ?) AS drafts`).bind(c.id, c.project_id, c.id, c.project_id).first<{ content: number; drafts: number }>();
  return { uid: c.uid, name: c.name, goal: c.goal, status: c.status, starts_on: c.starts_on, ends_on: c.ends_on, budget_cents: c.budget_cents,
    audience_kind: c.audience_kind,
    budget_used_pct: c.budget_cents == null || c.budget_cents === 0 || !channels.length || channels.some((g) => g.spend_cents == null) ? null : channels.reduce((sum, g) => sum + g.spend_cents!, 0) / c.budget_cents * 100,
    demos, demos_reason: leads_reason, customers, customers_reason: leads_reason,
    budget_reason: c.budget_cents == null ? 'Not recorded: no campaign budget entered' : null, utm_campaign: c.utm_campaign, segment, channels, items: counts, leads, leads_reason };
}
/** D4491: `from`/`to` (YYYY-MM-DD, both or neither) narrow leads by contact created_at and spend by shared months. */
export async function campaigns(env: Env, pid: number, filters: { status?: string; q?: string; from?: unknown; to?: unknown } = {}) {
  const window = reportingWindow(filters.from, filters.to);
  if (filters.status && filters.status !== 'all' && !Object.prototype.hasOwnProperty.call(transitions, filters.status)) throw new Refused(400, 'Invalid campaign status', 'status');
  const totals = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM grow_campaigns WHERE project_id = ? AND archived_at IS NULL GROUP BY status').bind(pid).all<{ status: string; n: number }>();
  const counts: Record<string, number> = { all: 0, active: 0, draft: 0, paused: 0, ended: 0 };
  for (const row of totals.results ?? []) { counts[row.status] = row.n; counts.all += row.n; }
  const search = `%${(filters.q ?? '').replace(/[\\%_]/g, (v) => `\\${v}`)}%`;
  const rows = await env.DB.prepare("SELECT * FROM grow_campaigns WHERE project_id = ? AND archived_at IS NULL AND (? IS NULL OR status = ?) AND name LIKE ? ESCAPE '\\' COLLATE NOCASE ORDER BY created_at DESC, id DESC")
    .bind(pid, filters.status && filters.status !== 'all' ? filters.status : null, filters.status ?? null, search).all<Campaign>();
  const records = rows.results ?? [];
  const attribution = records.some((c) => c.utm_campaign) ? await campaignLeads(env, pid, window) : undefined;
  return { campaigns: await Promise.all(records.map((c) => readCampaign(env, c, attribution, window))), counts };
}
/** Detail projection has no email/id fallback for a missing creator name. */
export async function campaign(env: Env, pid: number, uid: string) {
  const c = await owned(env, pid, uid);
  if (c.archived_at) return missing();
  const creator = c.created_by == null ? null : await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(c.created_by).first<{ name: string | null }>();
  const content = await env.DB.prepare("SELECT t.uid, 'content_item' AS kind, t.title, t.status, g.uid AS channel_uid, g.name AS channel_name FROM grow_campaign_items i JOIN content_calendar_items t ON t.id = i.ref_id LEFT JOIN growth_channels g ON g.id = t.channel_id AND g.project_id = ? WHERE i.campaign_id = ? AND i.kind = 'content_item' AND t.project_id = ? ORDER BY t.id").bind(pid, c.id, pid).all();
  // Publish drafts have no title column. Read their recorded title/text, falling back to the linked calendar title only.
  const drafts = await env.DB.prepare("SELECT t.uid, 'publish_draft' AS kind, t.body_json, t.status, ci.title AS calendar_title, g.uid AS channel_uid, g.name AS channel_name FROM grow_campaign_items i JOIN publish_drafts t ON t.id = i.ref_id LEFT JOIN content_calendar_items ci ON ci.id = t.calendar_item_id AND ci.project_id = ? LEFT JOIN growth_channels g ON g.id = ci.channel_id AND g.project_id = ? WHERE i.campaign_id = ? AND i.kind = 'publish_draft' AND t.project_id = ? ORDER BY t.id").bind(pid, pid, c.id, pid).all<{ uid: string; kind: string; body_json: string; status: string; calendar_title: string | null; channel_uid: string | null; channel_name: string | null }>();
  const items = [...(content.results ?? []), ...(drafts.results ?? []).map(({ body_json, calendar_title, ...row }) => {
    let title: string | null = calendar_title;
    try { const body = JSON.parse(body_json); for (const value of [body.title, body.text]) if (typeof value === 'string' && value.trim()) { title = value; break; } } catch { /* Unreadable title stays null. */ }
    return { ...row, title };
  })].map(({ channel_uid, channel_name, ...row }) => ({ ...row, channel: channel_uid ? { uid: channel_uid, name: channel_name } : null }));
  return { campaign: { ...await readCampaign(env, c), created_by: creator?.name?.trim() || null, created_at: c.created_at, linked_items: items } };
}
export async function campaignCreatives(env: Env, pid: number, uid: string) {
  const c = await owned(env, pid, uid);
  const rows = await env.DB.prepare('SELECT uid, placement, field, text, updated_by, created_at, updated_at FROM grow_campaign_creatives WHERE campaign_id = ? ORDER BY placement, field').bind(c.id).all();
  return { creatives: rows.results ?? [] };
}
export async function putCampaignCreative(env: Env, pid: number, user: User, uid: string, placement: string, field: string, b: Body) {
  const c = await owned(env, pid, uid); editable(c);
  if (c.status === 'ended') throw new Refused(409, 'Ended campaigns cannot change creatives');
  if (!['google_search_text', 'youtube_16_9', 'meta_feed_4_5', 'x_promoted_post'].includes(placement)) throw new Refused(400, 'Invalid creative placement', 'placement');
  if (!['headline', 'body', 'script'].includes(field)) throw new Refused(400, 'Invalid creative field', 'field');
  if (typeof b.text !== 'string' || [...b.text].length > 2000) throw new Refused(400, 'Creative text must have at most 2000 characters', 'text');
  const result = await env.DB.batch([
    // Explicit insert/update targets keep the schema checker out of the parent SELECT.
    // Both statements and the audit remain one atomic, final-state-guarded save.
    env.DB.prepare("INSERT OR IGNORE INTO grow_campaign_creatives (uid, campaign_id, placement, field, text, updated_by) SELECT ?, id, ?, ?, ?, ? FROM grow_campaigns WHERE id = ? AND project_id = ? AND archived_at IS NULL AND status != 'ended'").bind(crypto.randomUUID().replace(/-/g, ''), placement, field, b.text, user.id, c.id, pid),
    env.DB.prepare("UPDATE grow_campaign_creatives SET text = ?, updated_by = ?, updated_at = datetime('now') WHERE campaign_id = ? AND placement = ? AND field = ? AND EXISTS (SELECT 1 FROM grow_campaigns WHERE id = ? AND project_id = ? AND archived_at IS NULL AND status != 'ended')").bind(b.text, user.id, c.id, placement, field, c.id, pid),
    audit(env, pid, user, uid, 'grow_campaign_creative_changed'),
  ]);
  if (!result[1].meta.changes) throw new Refused(409, 'Campaign changed; read it again before editing');
  return campaignCreatives(env, pid, uid);
}
const response = async (env: Env, pid: number, uid: string) => ({ campaign: await readCampaign(env, await owned(env, pid, uid)) });
export async function createCampaign(env: Env, pid: number, user: User, b: Body) {
  const v = await values(env, pid, b);
  const ids = await channelIds(env, pid, b);
  const uid = crypto.randomUUID().replace(/-/g, '');
  const statements = [env.DB.prepare('INSERT INTO grow_campaigns (uid, project_id, name, goal, status, starts_on, ends_on, budget_cents, utm_campaign, segment_id, audience_kind, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(uid, pid, ...fields.map((k) => v[k]), user.id, user.id)];
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
  const next = { ...old, ...v };
  const args = [old.id, pid, ...fields.map((k) => old[k])];
  const statements: Statement[] = [];
  if (ids !== null) {
    statements.push(env.DB.prepare('DELETE FROM grow_campaign_channels WHERE campaign_id IN (SELECT id FROM grow_campaigns WHERE id = ? AND project_id = ? AND archived_at IS NULL AND name IS ? AND goal IS ? AND status IS ? AND starts_on IS ? AND ends_on IS ? AND budget_cents IS ? AND utm_campaign IS ? AND segment_id IS ? AND audience_kind IS ?) AND channel_id NOT IN (SELECT value FROM json_each(?))').bind(...args, JSON.stringify(ids)));
    for (const id of ids) statements.push(env.DB.prepare('INSERT OR IGNORE INTO grow_campaign_channels (campaign_id, channel_id) SELECT id, ? FROM grow_campaigns WHERE id = ? AND project_id = ? AND archived_at IS NULL AND name IS ? AND goal IS ? AND status IS ? AND starts_on IS ? AND ends_on IS ? AND budget_cents IS ? AND utm_campaign IS ? AND segment_id IS ? AND audience_kind IS ?').bind(id, ...args));
  }
  statements.push(env.DB.prepare("UPDATE grow_campaigns SET name = ?, goal = ?, status = ?, starts_on = ?, ends_on = ?, budget_cents = ?, utm_campaign = ?, segment_id = ?, audience_kind = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND archived_at IS NULL AND name IS ? AND goal IS ? AND status IS ? AND starts_on IS ? AND ends_on IS ? AND budget_cents IS ? AND utm_campaign IS ? AND segment_id IS ? AND audience_kind IS ?").bind(...fields.map((k) => next[k]), user.id, ...args));
  const result = await uniqueWrite(env, [...statements, audit(env, pid, user, uid, 'grow_campaign_updated')]);
  if (!result[statements.length - 1].meta.changes) throw new Refused(409, 'Campaign changed; read it again before editing');
  return response(env, pid, uid);
}
export async function campaignChannel(env: Env, pid: number, user: User, uid: string, channelUid: string, b: Body, remove = false) {
  const c = await owned(env, pid, uid); editable(c);
  const id = await channel(env, pid, channelUid);
  const budget = remove ? null : money(b.planned_budget_cents, 'planned_budget_cents');
  const budgetType = b.budget_type ?? null;
  if (!remove && budgetType !== null && budgetType !== 'daily' && budgetType !== 'lifetime') throw new Refused(400, 'budget_type must be daily, lifetime or null', 'budget_type');
  const dates: Record<string, string | null> = {};
  for (const key of ['starts_on', 'ends_on']) {
    const value = b[key];
    dates[key] = value == null ? null : calendarDay(value);
    if (!remove && value != null && !dates[key]) throw new Refused(400, `${key} must be a real YYYY-MM-DD date or null`, key);
  }
  if (!remove && dates.starts_on && dates.ends_on && dates.ends_on < dates.starts_on) throw new Refused(400, 'ends_on cannot be before starts_on', 'ends_on');
  // Insert/link and budget update share one batch. Explicit statement targets
  // also let the column checker distinguish the link table from its parent.
  const statements = remove
    ? [env.DB.prepare('DELETE FROM grow_campaign_channels WHERE campaign_id = ? AND channel_id = ? AND EXISTS (SELECT 1 FROM grow_campaigns WHERE id = ? AND archived_at IS NULL)').bind(c.id, id, c.id)]
    : [
      env.DB.prepare('INSERT OR IGNORE INTO grow_campaign_channels (campaign_id, channel_id) SELECT id, ? FROM grow_campaigns WHERE id = ? AND archived_at IS NULL').bind(id, c.id),
      env.DB.prepare('UPDATE grow_campaign_channels SET planned_budget_cents = ?, budget_type = ?, starts_on = ?, ends_on = ? WHERE campaign_id = ? AND channel_id = ? AND EXISTS (SELECT 1 FROM grow_campaigns WHERE id = ? AND archived_at IS NULL)').bind(budget, budgetType, dates.starts_on, dates.ends_on, c.id, id, c.id),
    ];
  const result = await env.DB.batch([...statements, audit(env, pid, user, uid, 'grow_campaign_channel_changed')]);
  if (!result[statements.length - 1].meta.changes) { editable(await owned(env, pid, uid)); return missing(); }
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
