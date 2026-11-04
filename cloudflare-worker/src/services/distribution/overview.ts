/** D4485 (#4485): venture-scoped Distribution overview reads, preserving missing and unreadable figures. */
import type { Env } from '../../types';
import { campaigns } from '../growCampaigns';
import { Refused } from '../growWriters';
import { calendarDay } from '../growKpis';

type Source = 'connector' | 'mercury' | 'manual';
type Metric = { value: number | null; reason: string | null; sources: Source[] };
type SpendMonth = { month: string; spend_cents: number; source: 'mercury' | 'manual' };
type CampaignView = {
  uid: string; name: string; status: string; budget_cents: number | null;
  channels: { uid: string; spend_cents: number | null; spend_reason: string | null; spend_months?: SpendMonth[] }[];
};
type CampaignReader = (env: Env, projectId: number) => Promise<{ campaigns: CampaignView[] }>;
const unavailable = (reason: string): Metric => ({ value: null, reason, sources: [] });
const noReach = 'Not recorded: no connected ad or social account reports it';
const unreadable = (what: string) => `Unreadable: ${what} could not be read`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.valueOf() + n * 86400_000);
function isoWeek(d: Date) {
  const thursday = addDays(d, 3 - (d.getUTCDay() + 6) % 7);
  const year = thursday.getUTCFullYear();
  const first = new Date(`${year}-01-04T00:00:00Z`);
  const monday = addDays(first, -(first.getUTCDay() + 6) % 7);
  return `${year}-W${String(1 + Math.floor((d.valueOf() - monday.valueOf()) / (7 * 86400_000))).padStart(2, '0')}`;
}
/** ISO week or any real day in it; UTC Monday inclusive, following Monday exclusive. */
export function overviewWeek(value?: string, now = new Date()) {
  let date: Date;
  if (value === undefined) date = new Date(`${day(now)}T00:00:00Z`);
  else if (calendarDay(value)) date = new Date(`${value}T00:00:00Z`);
  else if (/^[1-9][0-9]{3}-W[0-9]{2}$/.test(value)) {
    const jan4 = new Date(`${value.slice(0, 4)}-01-04T00:00:00Z`);
    date = addDays(jan4, -(jan4.getUTCDay() + 6) % 7 + (Number(value.slice(6)) - 1) * 7);
    if (isoWeek(date) !== value) throw new Refused(400, 'week must name a real ISO week or calendar day', 'week');
  } else throw new Refused(400, 'week must name a real ISO week or calendar day', 'week');
  const start = addDays(date, -(date.getUTCDay() + 6) % 7);
  return { key: isoWeek(start), from: day(start), until: day(addDays(start, 7)) };
}

/** #4483's per-channel/month read is authoritative; a shared channel is never counted twice. */
export function overviewSpend(active: CampaignView[], month?: string) {
  if (!active.length) return { ...unavailable('Not recorded: no active campaigns'), budget_cents: null };
  const months = new Map<string, SpendMonth>();
  for (const campaign of active) {
    if (!campaign.channels.length) return { ...unavailable('Not recorded: an active campaign has no recorded channel spend'), budget_cents: budget(active) };
    for (const channel of campaign.channels) {
      const records = channel.spend_months?.filter((m) => month === undefined || m.month === month);
      if (channel.spend_cents === null || !records?.length) {
        return { ...unavailable(channel.spend_reason ?? (month ? 'Not recorded: current-month spend is not recorded for every active channel' : 'Not recorded: campaign spend provenance is not available')), budget_cents: budget(active) };
      }
      for (const month of records) {
        const key = `${channel.uid}:${month.month}`;
        const old = months.get(key);
        if (!old || month.source === 'mercury') months.set(key, month);
      }
    }
  }
  return { value: [...months.values()].reduce((sum, m) => sum + m.spend_cents, 0), reason: null,
    sources: [...new Set([...months.values()].map((m) => m.source))] as Source[], budget_cents: budget(active) };
}
function budget(active: CampaignView[]) { return active.some((c) => c.budget_cents === null) ? null : active.reduce((sum, c) => sum + c.budget_cents!, 0); }

/** Called only after the existing Grow project read gate; no request-controlled id is interpolated. */
export async function distributionOverview(env: Env, projectId: number, options: { week?: string; now?: Date; readCampaigns?: CampaignReader; userId?: number; canWrite?: boolean; canAddProspects?: boolean } = {}) {
  const now = options.now ?? new Date();
  const range = overviewWeek(options.week, now);
  const month = `${day(now).slice(0, 7)}-01`;
  const next = new Date(`${month}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const until = day(next);
  async function count(what: string, sql: string, args: (string | number)[]): Promise<Metric> {
    try {
      const row = await env.DB.prepare(sql).bind(...args).first<{ n: number }>();
      if (!row || !Number.isSafeInteger(row.n)) throw new Error('Unreadable count');
      return { value: row.n, reason: null, sources: ['connector'] };
    } catch { return unavailable(unreadable(what)); }
  }
  const leads = await count('campaign leads', `SELECT COUNT(*) AS n FROM contacts c
    WHERE c.project_id = ? AND datetime(c.created_at) >= datetime(?) AND datetime(c.created_at) < datetime(?)
      AND json_type(CASE WHEN json_valid(c.utm_json) THEN c.utm_json ELSE '{}' END, '$.utm_campaign') = 'text'
      AND EXISTS (SELECT 1 FROM grow_campaigns g WHERE g.project_id = ? AND g.archived_at IS NULL
        AND lower(trim(g.utm_campaign)) = lower(trim(json_extract(CASE WHEN json_valid(c.utm_json) THEN c.utm_json ELSE '{}' END, '$.utm_campaign'))))`,
  [projectId, month, until, projectId]);
  const replies = await count('contact replies', `SELECT COUNT(*) AS n FROM contact_replies r JOIN contacts c ON c.id = r.contact_id
    WHERE c.project_id = ? AND r.direction = 'inbound' AND datetime(r.created_at) >= datetime(?) AND datetime(r.created_at) < datetime(?)`, [projectId, month, until]);
  let active: CampaignView[] | null = null;
  let total: number | null = null;
  let campaignReason: string | null = null;
  try {
    const records = (await (options.readCampaigns ?? campaigns)(env, projectId)).campaigns;
    total = records.length;
    active = records.filter((c) => c.status === 'active');
  }
  catch { campaignReason = unreadable('campaigns'); }
  const spend = active === null ? { ...unavailable(campaignReason!), budget_cents: null } : overviewSpend(active);
  const costSpend = active === null ? spend : overviewSpend(active, month.slice(0, 7));
  const cost: Metric = costSpend.value === null || leads.value === null || leads.value === 0
    ? unavailable(costSpend.reason ?? leads.reason ?? 'Not recorded: no attributed leads to divide spend by')
    : { value: costSpend.value / leads.value, reason: null, sources: [...new Set([...costSpend.sources, ...leads.sources])] };
  let week: { key: string; from: string; until: string; items: unknown[] | null; reason: string | null };
  try {
    const rows = await env.DB.prepare(`SELECT i.uid, i.title, i.planned_on, i.status, g.uid AS channel_uid, g.name AS channel
      FROM content_calendar_items i LEFT JOIN growth_channels g ON g.id = i.channel_id AND g.project_id = i.project_id
      WHERE i.project_id = ? AND date(i.planned_on) >= date(?) AND date(i.planned_on) < date(?) AND i.status IN ('planned', 'scheduled')
      ORDER BY i.planned_on, i.id`).bind(projectId, range.from, range.until).all();
    week = { ...range, items: rows.results ?? [], reason: null };
  } catch { week = { ...range, items: null, reason: unreadable('this week’s calendar') }; }
  let updateAsks: { items: unknown[] | null; reason: string | null; can_add: boolean } = {
    items: null, reason: 'Not recorded: update-ask identities are available only to venture writers', can_add: false,
  };
  if (options.canWrite) {
    try {
      const rows = await env.DB.prepare(`SELECT r.uid, r.name, r.email, r.message, a.text AS ask_text
        FROM update_ask_replies r JOIN update_asks a ON a.id = r.ask_id JOIN portfolio_updates u ON u.id = a.update_id
        WHERE u.project_id = ? AND a.kind = 'customer'
          AND u.id = (SELECT id FROM portfolio_updates WHERE project_id = ? AND (sent_at IS NOT NULL OR status = 'submitted') ORDER BY created_at DESC, id DESC LIMIT 1)
        ORDER BY r.id DESC LIMIT 50`).bind(projectId, projectId).all();
      updateAsks = { items: rows.results ?? [], reason: null, can_add: options.canAddProspects === true };
    } catch { updateAsks = { items: null, reason: unreadable('update-ask replies'), can_add: false }; }
  }
  const channels: { items: { name: string; status: string }[] | null; reason: string | null } = {
    items: null, reason: 'Not recorded: no signed-in connection owner is available',
  };
  if (options.userId) {
    try {
      // Marketing apps are not offered yet. A LinkedIn profile sign-in is not an ad grant.
      const link = await env.DB.prepare(`SELECT status, last_error FROM integrations
        WHERE user_id = ? AND provider_key = 'whatsapp_link' ORDER BY id DESC LIMIT 1`).bind(options.userId).first<{ status: string; last_error: string | null }>();
      channels.items = ['LinkedIn ads', 'X', 'Meta ads', 'Google Ads', 'Newsletter · Resend'].map((name) => ({ name, status: 'Not offered yet' }));
      channels.items.push({ name: 'WhatsApp capture', status: !link ? 'Not connected' : link.last_error || link.status === 'error' ? 'Reconnect' : link.status === 'active' ? 'Connected' : link.status === 'paused' ? 'Paused' : 'Not connected' });
      channels.reason = null;
    } catch { channels.reason = unreadable('connected channels'); }
  }
  return { month: month.slice(0, 7), update_asks: updateAsks, channels, kpis: { reach: unavailable(noReach), clicks: unavailable(noReach), leads, replies, cost_per_lead: cost, spend_vs_budget: spend },
    campaigns: { items: active, total, reason: campaignReason }, week };
}
