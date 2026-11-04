/** D4490 — Ads are plans and recorded monthly spend; no platform actions. */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { getCurrentUser } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { isTeamViewer } from '../services/mercury/growFeeds';
import { Refused } from '../services/growWriters';
import { utmSource } from '../services/growCycle';

const router = new Hono<{ Bindings: Env }>();
type Month = { month: string; spend_cents: number; source: 'manual' | 'mercury' };
export function mergeMonths(manual: { month: string; spend_cents: number }[], mercury: { period: string; amount_cents: number | null }[]): Month[] {
  const months = new Map<string, Month>();
  for (const row of manual) months.set(row.month, { ...row, source: 'manual' });
  for (const row of mercury) if (row.amount_cents != null) months.set(row.period, { month: row.period, spend_cents: row.amount_cents, source: 'mercury' });
  return [...months.values()].sort((a,b) => a.month.localeCompare(b.month));
}
export function costPerLead(spend: number | null, leads: number | null) {
  return spend == null || leads == null || leads <= 0 ? null : Math.round(spend / leads);
}
export async function readAds(env: Env, user: User, pid: number, uid: string, now = new Date()) {
  const project = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(pid).first<{ id: number; founder_id: number | null }>();
  if (!project) throw new Refused(404, 'Project not found');
  if (!await canAccessProject(env, user, project)) throw new Refused(403, 'Forbidden');
  const campaign = await env.DB.prepare('SELECT id, uid, name, status, budget_cents, starts_on, ends_on, segment_id FROM grow_campaigns WHERE uid = ? AND project_id = ? AND archived_at IS NULL').bind(uid,pid).first<{ id:number; uid:string; name:string; status:string; budget_cents:number|null; starts_on:string|null; ends_on:string|null; segment_id:number|null }>();
  if (!campaign) throw new Refused(404, 'Not found');
  const canWrite = await canAccessProject(env, user, project, { write: true });
  const team = await isTeamViewer(env,user,pid);
  const segment = campaign.segment_id == null ? null : await env.DB.prepare('SELECT name FROM customer_segments WHERE id = ? AND project_id = ?').bind(campaign.segment_id,pid).first<{ name:string }>();
  const links = await env.DB.prepare('SELECT g.id, g.uid, g.name, g.utm_source, l.planned_budget_cents, l.budget_type, l.starts_on, l.ends_on FROM grow_campaign_channels l JOIN growth_channels g ON g.id = l.channel_id WHERE l.campaign_id = ? AND g.project_id = ?').bind(campaign.id,pid).all<{id:number;uid:string;name:string;utm_source:string;planned_budget_cents:number|null;budget_type:string|null;starts_on:string|null;ends_on:string|null}>();
  const since = new Date(now.getTime()-7*86400000).toISOString();
  let counts: Map<string,number> | null = new Map();
  try {
    const contacts = await env.DB.prepare("SELECT utm_json FROM contacts WHERE project_id = ? AND audience = 'customer' AND julianday(created_at) >= julianday(?) AND julianday(created_at) <= julianday(?)").bind(pid,since,now.toISOString()).all<{utm_json:string|null}>();
    for (const row of contacts.results ?? []) { const source=utmSource(row.utm_json); if(source) counts.set(source,(counts.get(source) ?? 0)+1); }
  } catch { counts = null; }
  const channels = await Promise.all((links.results ?? []).filter(g => g.budget_type != null || /^(google|google_ads|google_search|youtube|meta|facebook|instagram|x|twitter|linkedin_ads)$/.test(g.utm_source)).map(async g => {
    let months: Month[] = []; let reason: string | null = 'Not recorded: no complete campaign date window';
    if(campaign.starts_on && campaign.ends_on) {
      try {
        const start=campaign.starts_on.slice(0,7), end=campaign.ends_on.slice(0,7);
        const manual=await env.DB.prepare('SELECT month, spend_cents FROM channel_spend WHERE channel_id = ? AND month >= ? AND month <= ?').bind(g.id,start,end).all<{month:string;spend_cents:number}>();
        const mercury=team ? await env.DB.prepare("SELECT period, amount_cents FROM mercury_grow_facts WHERE project_id = ? AND module = 'distribution' AND kind = 'channel_spend' AND subject = ? AND period >= ? AND period <= ?").bind(pid,g.uid,start,end).all<{period:string;amount_cents:number|null}>() : {results:[]};
        months=mergeMonths(manual.results ?? [],mercury.results ?? []);
        reason=months.length ? null : 'Not recorded: no spend entered for these months';
      } catch { reason='Unreadable: monthly spend could not be read'; }
    }
    const total=months.length && !reason ? months.reduce((s,m)=>s+m.spend_cents,0) : null;
    const leads=counts && g.utm_source ? counts.get(g.utm_source) ?? 0 : null;
    const daily=g.budget_type==='daily';
    // Monthly facts cannot establish seven-day spend or whether a daily limit was reached.
    return { ...g, id:undefined, months, spend_cents:total, spend_reason:reason, leads, leads_source:'Contacts · UTM source', leads_reason:counts ? null : 'Unreadable: contacts could not be read', clicks:null,
      seven_day_spend_cents:null, cost_per_lead_cents:costPerLead(null,leads), cost_per_lead_reason:'Not recorded: spend is monthly; seven-day spend is not recorded',
      budget_reached: !daily && total != null && g.planned_budget_cents != null && total >= g.planned_budget_cents,
      budget_reached_reason: daily ? 'Not recorded: daily spend is not recorded' : null };
  }));
  return { campaign:{...campaign,id:undefined,segment_id:undefined}, targeting:segment?.name ?? null, can_write:canWrite && campaign.status!=='ended', channels, period:{since,until:now.toISOString()}, mercury_visible:team };
}
router.get('/', async c => {
  const user=await getCurrentUser(c); if(!user) return c.json({detail:'Unauthorized'},401);
  try {
    const pid=Number(c.req.query('project')), uid=c.req.query('campaign');
    if(!Number.isSafeInteger(pid)||pid<1||!uid) throw new Refused(400,'project and campaign are required');
    return c.json(await readAds(c.env,user,pid,uid));
  } catch(e) {
    if(e instanceof Refused) return c.json({detail:e.sentence},e.status as 400);
    return c.json({detail:'Unreadable: ads could not be read'},503);
  }
});
export const mount = { path: '/api/grow/ads', router: router };
export default router;
