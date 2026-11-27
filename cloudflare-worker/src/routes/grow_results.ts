/**
 * D4491 (#4491) — Distribution Results at /api/grow/results: read-only attribution from
 * campaign and channel to lead, demo and customer, and per-channel spend with its source.
 * Campaign figures reuse the shared campaign read (services/growCampaigns.ts); nothing here
 * writes revenue, MRR or project_metrics.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { Refused } from '../services/growWriters';
import { campaigns, channelSpend, isCustomer, isDemo, reportingWindow, type ReportingWindow } from '../services/growCampaigns';
import { utmSource } from '../services/growCycle';

type Counts = { leads: number; demos: number; customers: number };
type SourceRow = Counts & { key: string; name: string; channel_uid: string | null; utm_source: string | null; figure_source: 'attributed' | 'manual' };
type SpendSource = 'mercury' | 'manual' | 'mixed' | null;
const LIFETIME = { start: '0000-00', end: '9999-12' };
const sourcesOf = (s: SpendSource): ('mercury' | 'manual')[] => (s === 'mixed' ? ['mercury', 'manual'] : s ? [s] : []);

/** Venture gate, the same reader gate as /api/cycles/grow/campaigns. */
async function venture(env: Env, user: Awaited<ReturnType<typeof requireAuth>>, raw: unknown): Promise<number> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Refused(400, 'project is required', 'project');
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new Refused(404, 'Project not found');
  if (!(await canAccessProject(env, user, p, { write: false }))) throw new Refused(403, 'Forbidden');
  return p.id;
}

type CampaignRead = Awaited<ReturnType<typeof campaigns>>['campaigns'][number];
/** Campaign totals from the shared read: spend is the recorded channel-months, never an invented zero. */
function campaignResult(c: CampaignRead) {
  const tagged = !!c.utm_campaign;
  const countReason = tagged ? c.leads_reason : 'Not recorded: no UTM tag';
  let spend_cents: number | null = null; let spend_reason: string | null; let spend_source: SpendSource = null;
  const unreadable = c.channels.find((g) => g.spend_reason?.startsWith('Unreadable'));
  const recorded = c.channels.filter((g) => g.spend_cents != null);
  if (!c.channels.length) spend_reason = 'Not recorded: no channel linked';
  else if (unreadable) spend_reason = unreadable.spend_reason;
  else if (!c.starts_on || !c.ends_on) spend_reason = 'Not recorded: no campaign dates entered';
  else if (!recorded.length) spend_reason = c.channels.every((g) => /no months in this window/.test(g.spend_reason ?? '')) ? 'Not recorded: no campaign months in this window' : 'Not recorded: no spend entered';
  else {
    spend_cents = recorded.reduce((sum, g) => sum + g.spend_cents!, 0); spend_reason = null;
    const kinds = new Set(recorded.flatMap((g) => sourcesOf(g.spend_source)));
    spend_source = kinds.size > 1 ? 'mixed' : [...kinds][0] ?? null;
  }
  const leads = tagged ? c.leads : null;
  let cost_per_lead_cents: number | null = null; let cost_per_lead_reason: string | null;
  if (leads == null) cost_per_lead_reason = countReason ?? 'Not recorded: no leads counted';
  else if (spend_cents == null) cost_per_lead_reason = spend_reason;
  else if (leads === 0) cost_per_lead_reason = 'Not recorded: no leads counted';
  else { cost_per_lead_cents = Math.round(spend_cents / leads); cost_per_lead_reason = null; }
  return {
    uid: c.uid, name: c.name, status: c.status, utm_campaign: c.utm_campaign, starts_on: c.starts_on, ends_on: c.ends_on,
    leads, leads_reason: leads == null ? countReason : null,
    demos: tagged ? c.demos : null, demos_reason: tagged && c.demos != null ? null : countReason,
    customers: tagged ? c.customers : null, customers_reason: tagged && c.customers != null ? null : countReason,
    leads_source: 'attributed' as const,
    spend_cents, spend_reason, spend_source, spend_sources: sourcesOf(spend_source),
    cost_per_lead_cents, cost_per_lead_reason, cost_per_lead_sources: [...sourcesOf(spend_source), 'attributed'],
  };
}

/** Per utm_source counts, mapped to the venture's channels; hand-added contacts are their own manual row. */
async function sourceResults(env: Env, pid: number, window: ReportingWindow | null, channels: { uid: string; name: string; utm_source: string }[]) {
  const rows = window
    ? await env.DB.prepare('SELECT utm_json, status, source FROM contacts WHERE project_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?').bind(pid, window.from, window.to).all<{ utm_json: string | null; status: string; source: string | null }>()
    : await env.DB.prepare('SELECT utm_json, status, source FROM contacts WHERE project_id = ?').bind(pid).all<{ utm_json: string | null; status: string; source: string | null }>();
  const tally = new Map<string, Counts>(); const manual: Counts = { leads: 0, demos: 0, customers: 0 };
  const add = (t: Counts, status: string) => { t.leads++; if (isDemo(status)) t.demos++; if (isCustomer(status)) t.customers++; };
  for (const row of rows.results ?? []) {
    if (row.utm_json != null) {
      // Malformed or untagged attribution is skipped, the same parser as the campaign read.
      const src = utmSource(row.utm_json);
      if (!src) continue;
      const t = tally.get(src) ?? { leads: 0, demos: 0, customers: 0 }; add(t, row.status); tally.set(src, t);
    } else if (row.source === 'manual') add(manual, row.status);
  }
  const known = new Set(channels.map((g) => g.utm_source));
  const zero = (): Counts => ({ leads: 0, demos: 0, customers: 0 });
  const out: SourceRow[] = channels.map((g) => ({ key: `channel:${g.uid}`, name: g.name, channel_uid: g.uid, utm_source: g.utm_source, ...(tally.get(g.utm_source) ?? zero()), figure_source: 'attributed' }));
  for (const [src, t] of [...tally].sort(([a], [b]) => a.localeCompare(b))) if (!known.has(src)) out.push({ key: `utm:${src}`, name: src, channel_uid: null, utm_source: src, ...t, figure_source: 'attributed' });
  if (manual.leads) out.push({ key: 'manual', name: 'Added by hand', channel_uid: null, utm_source: null, ...manual, figure_source: 'manual' });
  return out;
}

/** Per-channel spend over the window's months (lifetime when absent), Mercury first. */
async function channelResults(env: Env, pid: number, window: ReportingWindow | null, channels: { id: number; uid: string; name: string }[]) {
  const start = window ? window.from.slice(0, 7) : LIFETIME.start; const end = window ? window.to.slice(0, 7) : LIFETIME.end;
  return Promise.all(channels.map(async (g) => {
    try {
      const read = await channelSpend(env, pid, g, start, end);
      return { uid: g.uid, name: g.name, spend_cents: read.spend_cents, spend_reason: read.spend_cents == null ? 'Not recorded: no spend entered' : null, spend_source: read.spend_source, spend_sources: sourcesOf(read.spend_source) };
    } catch { return { uid: g.uid, name: g.name, spend_cents: null, spend_reason: 'Unreadable: channel spend could not be read', spend_source: null, spend_sources: [] }; }
  }));
}

const router = new Hono<{ Bindings: Env }>();
router.get('/', async (c) => {
  let user;
  try { user = await requireAuth(c); } catch { return c.json({ detail: 'Unauthorized' }, 401); }
  try {
    const pid = await venture(c.env, user, c.req.query('project'));
    const window = reportingWindow(c.req.query('from'), c.req.query('to'));
    const read = await campaigns(c.env, pid, window ?? {});
    const scope = window
      ? { kind: 'window' as const, label: `${window.from} to ${window.to}: contacts created in these days; spend in these months` }
      : { kind: 'lifetime' as const, label: 'Lifetime: every tagged contact; spend over each campaign’s own months' };
    let channels: { id: number; uid: string; name: string; utm_source: string }[] | null = null;
    try { channels = (await c.env.DB.prepare('SELECT id, uid, name, utm_source FROM growth_channels WHERE project_id = ? ORDER BY name, uid').bind(pid).all<{ id: number; uid: string; name: string; utm_source: string }>()).results ?? []; }
    catch { channels = null; }
    let sources: SourceRow[] | null = null; let sources_reason: string | null = null;
    try { sources = channels ? await sourceResults(c.env, pid, window, channels) : null; if (!channels) sources_reason = 'Unreadable: channels could not be read'; }
    catch { sources = null; sources_reason = 'Unreadable: contacts could not be read'; }
    const spend = channels ? await channelResults(c.env, pid, window, channels) : null;
    return c.json({
      window, scope,
      campaigns: read.campaigns.map(campaignResult),
      sources, sources_reason,
      channels: spend, channels_reason: channels ? null : 'Unreadable: channels could not be read',
    });
  } catch (e) {
    if (e instanceof Refused) return c.json({ detail: e.sentence, ...(e.field ? { field: e.field } : {}) }, e.status as 400);
    return c.json({ detail: 'Results are unreadable. Try again.' }, 503);
  }
});
export const mount = { path: '/api/grow/results', router: router };
export default router;
