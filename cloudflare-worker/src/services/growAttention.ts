/** D4862 part 2: project-scoped focus evidence and the approved baseline action rules for Grow. */
import type { Ctx } from './growCycle';
import type { User } from '../types';
import type { Card, Figure } from './cycleCards';
import { isTeamViewer } from './mercury/teamViewer';

export type Evidence<T> = { state: 'recorded'; value: T } | { state: 'not_recorded' | 'unreadable'; value: null };
export interface FocusTarget { metric_key: string; label: string | null; target_value: number; direction: 'up' | 'down'; updated_at: string | null }
export interface FocusMeasurement { value: number; as_of: string; source: string | null }
export interface AttentionAction { key: string; label: string; why: string; href: string; area?: string; actionLabel?: string; priority?: number }
export interface GrowAttention {
  state: 'ready' | 'partial' | 'unreadable';
  writable: boolean;
  period: string;
  signals: Record<string, Evidence<number> | { state: 'restricted'; value: null }>;
  focus: Evidence<FocusTarget>;
  measurement: Evidence<FocusMeasurement>;
  primary: AttentionAction | null;
  items: AttentionAction[];
}
const METRICS = new Set(['mrr', 'arr', 'cac', 'ltv', 'monthly_churn_pct', 'active_users', 'new_users', 'net_burn', 'cash_balance', 'headcount', 'nrr_pct', 'paying_accounts']);
const missing = <T>(): Evidence<T> => ({ state: 'not_recorded', value: null });
const unreadable = <T>(): Evidence<T> => ({ state: 'unreadable', value: null });

/** Only known evidence chooses an action. A failed source never means setup is missing. */
export function baselineAction(projectId: number, focus: Evidence<FocusTarget>, measurement: Evidence<FocusMeasurement>, writable: boolean): AttentionAction | null {
  if (!writable || focus.state === 'unreadable' || measurement.state === 'unreadable') return null;
  const href = `/grow/focus?project_id=${projectId}`;
  if (focus.state === 'not_recorded') return { key: 'set_focus', label: 'Set focus metric', why: 'Choose the growth metric and its target in Focus.', href };
  if (measurement.state === 'not_recorded') return { key: 'record_metric', label: 'Record the first value', why: 'The focus metric has a target, but no value has been recorded for it.', href };
  return { key: 'review_growth', label: 'Review growth', why: 'Review the recorded focus metric against its target.', href };
}

/** Existing stores only; the caller has already enforced the venture read gate. No writes or global caches. */
export async function growAttention(x: Ctx, writable: boolean, options: { user?: Pick<User, 'id' | 'founder_id'>; cards?: Card[]; figures?: Figure[] } = {}): Promise<GrowAttention> {
  let focus: Evidence<FocusTarget>;
  let measurement: Evidence<FocusMeasurement> = missing();
  try {
    const row = await x.env.DB.prepare(
      `SELECT metric_key, label, target_value, direction, updated_at FROM metric_targets
       WHERE project_id = ? AND is_focus = 1 ORDER BY updated_at DESC, id DESC LIMIT 1`,
    ).bind(x.projectId).first<FocusTarget>();
    if (!row) focus = missing();
    else if (!METRICS.has(row.metric_key) || !Number.isFinite(row.target_value) || !['up', 'down'].includes(row.direction)) focus = unreadable();
    else focus = { state: 'recorded', value: row };
  } catch {
    console.warn('[growAttention] source unreadable', { source: 'focus' });
    focus = unreadable();
  }
  if (focus.state === 'recorded') {
    try {
      // CASE binds the selected key; no column name or request text enters SQL.
      // Find its latest value, even when a newer snapshot records a different metric.
      const row = await x.env.DB.prepare(
        `SELECT snapshot_date, source, value FROM (
           SELECT id, snapshot_date, source, CASE ?
             WHEN 'mrr' THEN mrr WHEN 'arr' THEN arr WHEN 'cac' THEN cac WHEN 'ltv' THEN ltv
             WHEN 'monthly_churn_pct' THEN monthly_churn_pct WHEN 'active_users' THEN active_users
             WHEN 'new_users' THEN new_users WHEN 'net_burn' THEN net_burn WHEN 'cash_balance' THEN cash_balance
             WHEN 'headcount' THEN headcount WHEN 'nrr_pct' THEN nrr_pct WHEN 'paying_accounts' THEN paying_accounts
           END AS value FROM project_metrics WHERE project_id = ?
         ) WHERE value IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
      ).bind(focus.value.metric_key, x.projectId).first<{ snapshot_date: string; source: string | null; value: number }>();
      measurement = !row ? missing() : typeof row.value === 'number' && Number.isFinite(row.value)
        ? { state: 'recorded', value: { value: row.value, as_of: row.snapshot_date, source: row.source } } : unreadable();
    } catch {
      console.warn('[growAttention] source unreadable', { source: 'measurement' });
      measurement = unreadable();
    }
  }
  const count = async (name: string, sql: string): Promise<Evidence<number>> => {
    try {
      const row = await x.env.DB.prepare(sql).bind(x.projectId).first<{ n: number }>();
      return row && typeof row.n === 'number' && Number.isInteger(row.n) && row.n >= 0
        ? { state: 'recorded', value: row.n } : unreadable();
    } catch {
      console.warn('[growAttention] source unreadable', { source: name });
      return unreadable();
    }
  };
  const proposals = async (): Promise<Evidence<number> | { state: 'restricted'; value: null }> => {
    try {
      if (!options.user || !(await isTeamViewer(x.env, options.user, x.projectId))) return { state: 'restricted', value: null };
      return count('partner_proposals', "SELECT COUNT(*) AS n FROM mercury_partner_proposals WHERE project_id = ? AND state = 'pending'");
    } catch {
      console.warn('[growAttention] source unreadable', { source: 'partner_proposals' });
      return unreadable();
    }
  };
  const [targets, kpis, channels, customers, partner_proposals, stalled_customers] = await Promise.all([
    count('targets', "SELECT COUNT(*) AS n FROM metric_targets WHERE project_id = ? AND metric_key IN ('mrr','arr','cac','ltv','monthly_churn_pct','active_users','new_users','net_burn','cash_balance','headcount','nrr_pct','paying_accounts')"),
    count('kpis', 'SELECT COUNT(*) AS n FROM project_metrics WHERE project_id = ?'),
    count('channels', 'SELECT COUNT(*) AS n FROM growth_channels WHERE project_id = ?'),
    count('customers', 'SELECT COUNT(*) AS n FROM waitlist_signups WHERE project_id = ?'),
    proposals(),
    // Match Customers' existing 14-day last-touch rule. Invalid stamps never count as stalled.
    (async (): Promise<Evidence<number>> => {
      try {
        const row = await x.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM (SELECT MAX(COALESCE(julianday(created_at),0),COALESCE(julianday(invited_at),0),
            COALESCE(julianday(followed_up_at),0),COALESCE(julianday(promoted_at),0)) AS touched
            FROM waitlist_signups WHERE project_id = ?) WHERE touched > 0 AND touched < julianday(?)`,
        ).bind(x.projectId, new Date(x.now - 14 * 86400000).toISOString()).first<{ n: number }>();
        return row && typeof row.n === 'number' && Number.isInteger(row.n) && row.n >= 0 ? { state: 'recorded', value: row.n } : unreadable();
      } catch {
        console.warn('[growAttention] source unreadable', { source: 'stalled_customers' });
        return unreadable();
      }
    })(),
  ]);
  const signals = { targets, kpis, channels, customers, partner_proposals, stalled_customers };
  const primary = baselineAction(x.projectId, focus, measurement, writable);
  const href = (path: string) => `${path}?project_id=${x.projectId}`;
  const items: AttentionAction[] = [];
  const add = (key: string, priority: number, label: string, why: string, path: string, area: string) => items.push({ key, priority, label, why, href: href(path), area });
  const critical = focus.state === 'unreadable' || measurement.state === 'unreadable';
  if (writable) {
    if (!critical) {
      if (focus.state === 'not_recorded') add('set_focus', 10, 'Choose your primary growth metric', 'Everything below is ranked against it.', '/grow/focus', 'Focus');
      if (targets.state === 'recorded' && targets.value === 0) add('set_target', 20, 'Set your growth target', 'A target turns the metric into a plan you can check.', '/grow/focus', 'Focus');
      if (kpis.state === 'recorded' && kpis.value === 0) add('record_kpi', 30, 'Record your first KPI', 'Enter a recorded value for your growth baseline.', '/grow/focus', 'Focus');
      else if (focus.state === 'recorded' && measurement.state === 'not_recorded') add('record_metric', 30, 'Record a value for the focus metric', 'Other KPI rows do not record this metric yet.', '/grow/focus', 'Focus');
    }
    if (focus.state === 'unreadable' || measurement.state === 'unreadable' || targets.state === 'unreadable' || kpis.state === 'unreadable') add('focus_unreadable', 40, 'Check the focus source', 'The focus or metric records could not be read. This does not mean they are empty.', '/grow/focus', 'Focus');
    for (const f of options.figures || []) {
      if (f.state === 'unreadable' && !items.some((i) => i.key === 'focus_unreadable')) add('focus_unreadable', 40, 'Check the KPI source', 'One or more growth figures could not be read.', '/grow/focus', 'Focus');
    }
    if (partner_proposals.state === 'recorded' && partner_proposals.value > 0) add('partner_proposal', 50, 'Review saved partner proposals', `${partner_proposals.value} pending proposal${partner_proposals.value === 1 ? '' : 's'} from Mercury.`, '/grow/partner-network', 'Partnerships');
    const team = options.cards?.find((c) => c.slug === 'team-expansion');
    const series = team?.series as { roles_by_stage?: Array<{ stage: string; count: number }> } | null;
    const offers = Array.isArray(series?.roles_by_stage) ? series.roles_by_stage.find((r) => r.stage === 'offer')?.count : null;
    if (typeof offers === 'number' && Number.isFinite(offers) && offers > 0) add('offers', 60, 'Review offers waiting on candidates', `${offers} application${offers === 1 ? '' : 's'} at the offer stage.`, '/grow/talent', 'Talent');
    if (stalled_customers.state === 'recorded' && stalled_customers.value > 0) add('stalled_customers', 70, 'Review stalled customer records', `${stalled_customers.value} record${stalled_customers.value === 1 ? '' : 's'} without an activity mark in 14 days.`, '/grow/customers', 'Customers');
    if (channels.state === 'recorded' && channels.value === 0) add('add_channel', 80, 'Add your first acquisition channel', 'Attribute sign-ups and spend to a recorded channel.', '/grow/distribution', 'Distribution');
    if (customers.state === 'recorded' && customers.value === 0) add('add_customer', 90, 'Add customer or prospect records', 'Bring your recorded discovery contacts into Grow.', '/grow/customers', 'Customers');
  }
  const actionLabels: Record<string, string> = { set_focus: 'Set focus metric', set_target: 'Set target', record_kpi: 'Enter a KPI', record_metric: 'Enter a KPI', focus_unreadable: 'Open Focus', partner_proposal: 'Review proposal', offers: 'Open roles', stalled_customers: 'Open customers', add_channel: 'Add channel', add_customer: 'Add customer' };
  for (const item of items) item.actionLabel = actionLabels[item.key];
  const partial = Object.values(signals).some((s) => s.state === 'unreadable');
  return { state: critical ? 'unreadable' : partial ? 'partial' : 'ready', writable, period: new Date(x.now).toISOString().slice(0,7), focus, measurement, signals, primary, items: items.sort((a,b) => (a.priority || 0) - (b.priority || 0)).slice(0,4) };
}

/** A failed action-permission read must not blank the existing overview or imply missing setup. */
export function unreadableGrowAttention(x: Ctx): GrowAttention {
  return { state: 'unreadable', writable: false, period: new Date(x.now).toISOString().slice(0,7), focus: unreadable(), measurement: unreadable(), signals: {}, primary: null, items: [] };
}
