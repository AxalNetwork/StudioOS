/**
 * D691 (S19-A, #1697) — Grow's KPIs: where a typed one is kept, and how each
 * is read (decision 4). Revenue and traction's list, its record (#1698), the
 * daily step (#1698) and Build's roadmap KPI list (#1695) read through here,
 * so every surface agrees on a KPI's value and its key.
 *
 *   key               a hand entry writes                the value read
 *   mrr               project_metrics.mrr               Stripe's row from the last 35 days, else the latest hand entry
 *   paying_accounts   project_metrics.paying_accounts   the latest row
 *   new_mrr           refused (the revenue ledger)      movements computed from the ledger when read (D664)
 *   expansion_mrr     refused (the revenue ledger)      movements computed from the ledger when read (D664)
 *   churn             project_metrics.monthly_churn_pct the ledger's churned MRR once it has two billings,
 *                                                       else the latest churn rate, Stripe first
 *   net_burn          project_metrics.net_burn          the latest row
 *   runway            refused (cash and burn)           runwayMonths(latest cash_balance, latest net_burn)
 *   custom-<uid>      custom_kpi_values                 the latest value
 *
 * A hand entry is `source = 'manual'`, one KPI per call, and a second entry
 * for the same KPI on the same day updates that day's manual row. A typed
 * figure is never stored under a connected source's name. MRR and Burn are US
 * dollars, as `project_metrics` keeps them (REAL, migration 249); a custom
 * money KPI is stored as whole cents.
 */
import type { Env } from '../types';
import { billingPeriods, computeMovements, movementGap, readRecurring } from './revenueMovements';
import { runwayMonths } from './saasMetrics';
import { notify } from './notify';

export class KpiRefused extends Error {
  status: number; sentence: string; field: string | null;
  constructor(status: number, sentence: string, field: string | null = null) { super(sentence); this.status = status; this.sentence = sentence; this.field = field; }
}

export const KPI_KEYS = ['mrr', 'paying_accounts', 'new_mrr', 'expansion_mrr', 'churn', 'net_burn', 'runway'] as const;
export type KpiKey = typeof KPI_KEYS[number];

export const KPI_LABEL: Record<KpiKey, string> = {
  mrr: 'MRR', paying_accounts: 'Customers', new_mrr: 'New MRR', expansion_mrr: 'Expansion MRR',
  churn: 'Churn', net_burn: 'Burn', runway: 'Runway',
};

/**
 * The statement a hand entry runs, one literal per KPI, so a request never
 * names a column: today's manual row for that day, or a new one.
 */
const TYPED_UPSERT = {
  mrr: `INSERT INTO project_metrics (project_id, snapshot_date, mrr, notes, source, created_by) VALUES (?, ?, ?, ?, 'manual', ?)
    ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET mrr = excluded.mrr, notes = COALESCE(excluded.notes, notes)`,
  paying_accounts: `INSERT INTO project_metrics (project_id, snapshot_date, paying_accounts, notes, source, created_by) VALUES (?, ?, ?, ?, 'manual', ?)
    ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET paying_accounts = excluded.paying_accounts, notes = COALESCE(excluded.notes, notes)`,
  churn: `INSERT INTO project_metrics (project_id, snapshot_date, monthly_churn_pct, notes, source, created_by) VALUES (?, ?, ?, ?, 'manual', ?)
    ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET monthly_churn_pct = excluded.monthly_churn_pct, notes = COALESCE(excluded.notes, notes)`,
  net_burn: `INSERT INTO project_metrics (project_id, snapshot_date, net_burn, notes, source, created_by) VALUES (?, ?, ?, ?, 'manual', ?)
    ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET net_burn = excluded.net_burn, notes = COALESCE(excluded.notes, notes)`,
} as const;
type TypedKey = keyof typeof TYPED_UPSERT;

const REFUSED: Partial<Record<KpiKey, string>> = {
  new_mrr: 'New MRR is worked out from the revenue ledger.',
  expansion_mrr: 'Expansion MRR is worked out from the revenue ledger.',
  runway: 'Runway is worked out from cash and burn.',
};

export const CUSTOM_UNITS = ['count', 'pct', 'money'] as const;
export const CUSTOM_PREFIX = 'custom-';
const STRIPE_WINDOW_DAYS = 35;
const DAY = 86_400_000;

export type KpiRow = {
  id: string;
  kpi: string;
  value: number | null;
  unit: string | null;
  change_30d: number | null;
  source: string | null;
  as_of: string | null;
  period: string | null;
  reason: string | null;
};

type Metric = {
  snapshot_date: string; source: string | null; mrr: number | null; paying_accounts: number | null;
  monthly_churn_pct: number | null; net_burn: number | null; cash_balance: number | null;
};
type MetricCol = 'mrr' | 'paying_accounts' | 'monthly_churn_pct' | 'net_burn' | 'cash_balance';

export type CustomKpi = { id: number; uid: string; label: string; unit: typeof CUSTOM_UNITS[number]; currency: string | null };

/** A real `YYYY-MM-DD` day, or null. */
export function calendarDay(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

const sourceOf = (s: string | null) => (s && s.trim() ? s.trim() : 'manual');
const isStripe = (m: Metric) => sourceOf(m.source) === 'stripe';

async function readMetrics(env: Env, projectId: number): Promise<Metric[]> {
  const r = await env.DB.prepare(
    `SELECT snapshot_date, source, mrr, paying_accounts, monthly_churn_pct, net_burn, cash_balance
       FROM project_metrics WHERE project_id = ? ORDER BY snapshot_date, id`,
  ).bind(projectId).all<Metric>();
  return r.results || [];
}

export async function customKpis(env: Env, projectId: number): Promise<CustomKpi[]> {
  const r = await env.DB.prepare('SELECT id, uid, label, unit, currency FROM custom_kpis WHERE project_id = ? ORDER BY lower(label), id')
    .bind(projectId).all<CustomKpi>();
  return r.results || [];
}

/** Every KPI key the venture has: the seven, then each custom KPI's `custom-<uid>`. */
export async function kpiKeys(env: Env, projectId: number): Promise<string[]> {
  return [...KPI_KEYS, ...(await customKpis(env, projectId)).map((k) => `${CUSTOM_PREFIX}${k.uid}`)];
}

/** Whether `key` is one of the venture's KPIs; another venture's `custom-<uid>` is not. */
export async function isKpiKey(env: Env, projectId: number, key: string): Promise<boolean> {
  if ((KPI_KEYS as readonly string[]).includes(key)) return true;
  if (!key.startsWith(CUSTOM_PREFIX)) return false;
  return !!await env.DB.prepare('SELECT 1 FROM custom_kpis WHERE uid = ? AND project_id = ?').bind(key.slice(CUSTOM_PREFIX.length), projectId).first();
}

const notRecorded = (id: string, kpi: string, reason = 'Not recorded'): KpiRow =>
  ({ id, kpi, value: null, unit: null, change_30d: null, source: null, as_of: null, period: null, reason });

/**
 * The latest value of a column in `rows`, and its change against the value ~30
 * days before it in `history` (every row, whatever its source, as before D691).
 */
function latest(id: string, kpi: string, rows: Metric[], col: MetricCol, unit: string, history: Metric[] = rows): KpiRow {
  const have = rows.filter((r) => typeof r[col] === 'number');
  const last = have[have.length - 1];
  if (!last) return notRecorded(id, kpi);
  const cutoff = new Date(Date.parse(last.snapshot_date) - 30 * DAY).toISOString().slice(0, 10);
  const before = [...history.filter((r) => typeof r[col] === 'number')].reverse().find((r) => r.snapshot_date <= cutoff);
  return { id, kpi, value: last[col] as number, unit, change_30d: before ? (last[col] as number) - (before[col] as number) : null,
    source: sourceOf(last.source), as_of: last.snapshot_date, period: last.snapshot_date.slice(0, 7), reason: null };
}

/** Stripe's rows when one is from the last 35 days, else the hand entries (decision 4). */
function connectedFirst(rows: Metric[], col: MetricCol, now: number): Metric[] {
  const since = new Date(now - STRIPE_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const stripe = rows.filter((r) => isStripe(r) && typeof r[col] === 'number');
  return stripe.some((r) => r.snapshot_date >= since) ? stripe : rows.filter((r) => !isStripe(r));
}

/** Revenue and traction's rows, in the list's order: the seven, then each custom KPI. */
export async function kpiRows(env: Env, projectId: number, now: number): Promise<KpiRow[]> {
  const metrics = await readMetrics(env, projectId);
  const ledger = await readRecurring(env, projectId);
  const twoBillings = billingPeriods(ledger) >= 2;
  // D664 (#1753): movements are computed from the ledger when read, never read
  // from revenue_movements, which is empty for a ledger older than 443.
  const mv = computeMovements(ledger);
  const latestMonth = mv.length ? mv[mv.length - 1].month : null;
  const at = (kind: string) => mv.find((m) => m.month === latestMonth && m.kind === kind) ?? null;
  const gap = movementGap(ledger);
  const movement = (key: 'new_mrr' | 'expansion_mrr' | 'churn', kind: 'new' | 'expansion' | 'churned'): KpiRow => {
    if (!twoBillings) return notRecorded(key, KPI_LABEL[key], 'Needs 2 billings');
    if (gap) return notRecorded(key, KPI_LABEL[key], gap);
    const m = at(kind);
    if (!m) {
      return notRecorded(key, KPI_LABEL[key], at('unsplit') ? 'Not recorded: the ledger cannot tell new from expansion for this month' : 'Not recorded');
    }
    return { id: key, kpi: KPI_LABEL[key], value: m.amount_cents, unit: 'usd_cents', change_30d: null,
      source: `Revenue ledger · ${m.source}`, as_of: m.as_of, period: m.month, reason: null };
  };

  let churn: KpiRow;
  if (twoBillings) churn = movement('churn', 'churned');
  else {
    const rate = latest('churn', KPI_LABEL.churn, connectedFirst(metrics, 'monthly_churn_pct', now), 'monthly_churn_pct', 'pct', metrics);
    churn = rate.value == null ? notRecorded('churn', KPI_LABEL.churn, 'Needs 2 billings') : rate;
  }

  const cash = latest('runway', KPI_LABEL.runway, metrics, 'cash_balance', 'usd');
  const burn = latest('net_burn', KPI_LABEL.net_burn, metrics, 'net_burn', 'usd');
  let runway: KpiRow;
  if (cash.value == null || burn.value == null) runway = notRecorded('runway', KPI_LABEL.runway, 'Not recorded: needs cash and burn');
  else {
    const months = runwayMonths(cash.value, burn.value);
    const asOf = [cash.as_of!, burn.as_of!].sort()[0];
    runway = months == null
      ? notRecorded('runway', KPI_LABEL.runway, 'Not recorded: burn is zero or negative')
      : { id: 'runway', kpi: KPI_LABEL.runway, value: months, unit: 'months', change_30d: null,
          source: 'Derived from cash and burn', as_of: asOf, period: asOf.slice(0, 7), reason: null };
  }

  const custom = await customKpis(env, projectId);
  const values = custom.length ? await env.DB.prepare(
    `SELECT v.kpi_id, v.as_of, v.value, v.value_cents, v.source FROM custom_kpi_values v
       JOIN custom_kpis k ON k.id = v.kpi_id WHERE k.project_id = ? ORDER BY v.as_of, v.id`,
  ).bind(projectId).all<{ kpi_id: number; as_of: string; value: number | null; value_cents: number | null; source: string }>() : { results: [] };
  const customRows = custom.map((k): KpiRow => {
    const id = `${CUSTOM_PREFIX}${k.uid}`;
    const have = (values.results || []).filter((v) => v.kpi_id === k.id);
    const last = have[have.length - 1];
    if (!last) return notRecorded(id, k.label, 'Not recorded: no value entered yet');
    const val = (v: typeof last) => (k.unit === 'money' ? v.value_cents : v.value) as number;
    const cutoff = new Date(Date.parse(last.as_of) - 30 * DAY).toISOString().slice(0, 10);
    const before = [...have].reverse().find((v) => v.as_of <= cutoff);
    return { id, kpi: k.label, value: val(last), unit: k.unit === 'money' ? 'usd_cents' : k.unit,
      change_30d: before ? val(last) - val(before) : null, source: sourceOf(last.source), as_of: last.as_of, period: last.as_of.slice(0, 7), reason: null };
  });

  return [
    latest('mrr', KPI_LABEL.mrr, connectedFirst(metrics, 'mrr', now), 'mrr', 'usd', metrics),
    latest('paying_accounts', KPI_LABEL.paying_accounts, metrics, 'paying_accounts', 'count'),
    movement('new_mrr', 'new'),
    movement('expansion_mrr', 'expansion'),
    churn,
    burn,
    runway,
    ...customRows,
  ];
}

export type KpiEntry = { kpi?: unknown; value?: unknown; as_of?: unknown; note?: unknown; label?: unknown; unit?: unknown };
export type KpiWritten = { id: string; as_of: string; value: number; unit: string; source: 'manual'; created_kpi: boolean };

function number(v: unknown, field = 'value'): number {
  if (v == null || v === '' || typeof v === 'object' || typeof v === 'boolean') throw new KpiRefused(400, 'value is a number', field);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new KpiRefused(400, 'value is a number', field);
  return n;
}

function checkUnit(n: number, unit: 'count' | 'pct' | 'money' | 'usd'): number {
  if (unit === 'count') {
    if (!Number.isInteger(n) || n < 0) throw new KpiRefused(400, 'A count is a whole number, 0 or more', 'value');
  } else if (unit === 'pct') {
    if (n < 0 || n > 100) throw new KpiRefused(400, 'A percentage is from 0 to 100', 'value');
  }
  return n;
}

/**
 * `POST /api/cycles/grow/kpis`'s write, through `ensureProjectMetricsSchema`
 * first (the route calls it). Refuses what the platform works out itself, a
 * missing or unreal date and another venture's custom KPI (404).
 */
export async function enterKpi(env: Env, projectId: number, userId: number, b: KpiEntry): Promise<KpiWritten> {
  const asOf = calendarDay(b.as_of);
  if (!asOf) {
    throw new KpiRefused(400, b.as_of == null || b.as_of === '' ? 'Choose the date this figure describes.' : 'as_of must be a real date written YYYY-MM-DD', 'as_of');
  }
  const key = String(b.kpi ?? '').trim();
  if (!key) throw new KpiRefused(400, 'kpi is required', 'kpi');
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
  if (REFUSED[key as KpiKey]) throw new KpiRefused(400, REFUSED[key as KpiKey]!, 'kpi');

  if (key in TYPED_UPSERT) {
    const k = key as TypedKey;
    const unit = k === 'paying_accounts' ? 'count' : k === 'churn' ? 'pct' : 'usd';
    let value = checkUnit(number(b.value), unit);
    if (k === 'mrr' && value < 0) throw new KpiRefused(400, 'MRR is 0 or more', 'value');
    if (k === 'paying_accounts') value = Math.trunc(value);
    await env.DB.prepare(TYPED_UPSERT[k]).bind(projectId, asOf, value, note, userId).run();
    // Runway is worked out from burn, so a burn entry can cross a Runway alert too.
    await alertsAfterWrite(env, projectId, k);
    if (k === 'net_burn') await alertsAfterWrite(env, projectId, 'runway');
    return { id: k, as_of: asOf, value, unit, source: 'manual', created_kpi: false };
  }

  let kpi: CustomKpi | null = null;
  let created = false;
  if (key === 'custom') {
    const label = typeof b.label === 'string' ? b.label.trim().slice(0, 80) : '';
    if (!label) throw new KpiRefused(400, 'A custom KPI has a name', 'label');
    const unitRaw = b.unit == null || b.unit === '' ? 'count' : String(b.unit);
    if (!(CUSTOM_UNITS as readonly string[]).includes(unitRaw)) throw new KpiRefused(400, `unit must be one of ${CUSTOM_UNITS.join(', ')}`, 'unit');
    kpi = await env.DB.prepare('SELECT id, uid, label, unit, currency FROM custom_kpis WHERE project_id = ? AND lower(label) = lower(?)')
      .bind(projectId, label).first<CustomKpi>();
    if (!kpi) {
      const uid = crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('INSERT INTO custom_kpis (uid, project_id, label, unit, currency, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(uid, projectId, label, unitRaw, unitRaw === 'money' ? 'usd' : null, userId).run();
      kpi = await env.DB.prepare('SELECT id, uid, label, unit, currency FROM custom_kpis WHERE uid = ?').bind(uid).first<CustomKpi>();
      created = true;
    }
  } else if (key.startsWith(CUSTOM_PREFIX)) {
    kpi = await env.DB.prepare('SELECT id, uid, label, unit, currency FROM custom_kpis WHERE uid = ? AND project_id = ?')
      .bind(key.slice(CUSTOM_PREFIX.length), projectId).first<CustomKpi>();
    if (!kpi) throw new KpiRefused(404, 'Not found', 'kpi');
  } else {
    throw new KpiRefused(400, `kpi must be one of ${[...KPI_KEYS, 'custom'].join(', ')}, or a custom KPI's key`, 'kpi');
  }

  const value = checkUnit(number(b.value), kpi!.unit);
  const money = kpi!.unit === 'money';
  await env.DB.prepare(
    `INSERT INTO custom_kpi_values (uid, kpi_id, as_of, value, value_cents, source, note, created_by)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
     ON CONFLICT(kpi_id, as_of, source) DO UPDATE SET value = excluded.value, value_cents = excluded.value_cents,
       note = COALESCE(excluded.note, note), updated_at = datetime('now')`,
  ).bind(crypto.randomUUID().replace(/-/g, ''), kpi!.id, asOf, money ? null : value, money ? Math.round(value * 100) : null, note, userId).run();
  await alertsAfterWrite(env, projectId, `${CUSTOM_PREFIX}${kpi!.uid}`);
  return { id: `${CUSTOM_PREFIX}${kpi!.uid}`, as_of: asOf, value, unit: kpi!.unit, source: 'manual', created_kpi: created };
}

// ── Alerts (#1698, decision 3) ──────────────────────────────────────────────
//
// An alert is crossed when its KPI's value (or its change over 30 days, in
// percent) is past the threshold. A crossing notifies the alert's creator once,
// in the app, and stamps `last_crossed_at`; crossing back clears the stamp,
// which re-arms the alert. A KPI write checks at once; the daily step
// (`growDaily.ts`) catches Stripe and CSV imports within a day.

export type KpiAlert = {
  id: number; uid: string; kpi_key: string; measure: string; op: string;
  threshold: number | null; threshold_cents: number | null; created_by: number | null; last_crossed_at: string | null;
};

/** What an alert compares, in its own unit; null when the KPI has nothing to compare. */
export function alertValue(row: KpiRow, a: Pick<KpiAlert, 'measure' | 'threshold_cents'>): number | null {
  if (row.value == null) return null;
  if (a.measure === 'change_30d_pct') {
    if (row.change_30d == null) return null;
    const before = row.value - row.change_30d;
    return before === 0 ? null : (row.change_30d / Math.abs(before)) * 100;
  }
  if (a.threshold_cents != null) {
    // MRR and Burn are kept in dollars; the ledger's movements and a custom money KPI in cents.
    return row.unit === 'usd' ? Math.round(row.value * 100) : row.unit === 'usd_cents' ? row.value : null;
  }
  return row.value;
}

export const alertThreshold = (a: Pick<KpiAlert, 'threshold' | 'threshold_cents'>): number => Number(a.threshold_cents ?? a.threshold);
export const alertCrossed = (value: number, a: Pick<KpiAlert, 'op' | 'threshold' | 'threshold_cents'>): boolean =>
  a.op === 'below' ? value < alertThreshold(a) : value > alertThreshold(a);

/** "Growth below 4%", "MRR below $5,000", as the record and the notification say it. */
export function alertText(kpi: string, a: Pick<KpiAlert, 'measure' | 'op' | 'threshold' | 'threshold_cents'>): string {
  const t = a.threshold_cents != null
    ? `$${(Number(a.threshold_cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : a.measure === 'change_30d_pct' ? `${Number(a.threshold)}%` : String(Number(a.threshold));
  return `${a.measure === 'change_30d_pct' ? `${kpi} growth` : kpi} ${a.op} ${t}`;
}

/** Check the venture's alerts (or those on `only`), notify each new crossing once and re-arm the cleared. */
export async function checkKpiAlerts(env: Env, projectId: number, now: number, only?: string[]): Promise<{ notified: number; cleared: number }> {
  const res = await env.DB.prepare(
    `SELECT id, uid, kpi_key, measure, op, threshold, threshold_cents, created_by, last_crossed_at
       FROM kpi_alerts WHERE project_id = ? ORDER BY id`,
  ).bind(projectId).all<KpiAlert>();
  const alerts = (res.results || []).filter((a) => !only || only.includes(a.kpi_key));
  if (!alerts.length) return { notified: 0, cleared: 0 };
  const rows = new Map((await kpiRows(env, projectId, now)).map((r) => [r.id, r]));
  let notified = 0; let cleared = 0;
  const at = new Date(now).toISOString();
  for (const a of alerts) {
    const row = rows.get(a.kpi_key);
    const value = row ? alertValue(row, a) : null;
    if (row == null || value == null) continue;
    if (alertCrossed(value, a)) {
      if (a.last_crossed_at) continue;
      // Claim the crossing first, so two runs never notify it twice.
      const claim = await env.DB.prepare('UPDATE kpi_alerts SET last_crossed_at = ?, updated_at = ? WHERE id = ? AND last_crossed_at IS NULL')
        .bind(at, at, a.id).run();
      if (!claim.meta?.changes || a.created_by == null) continue;
      await notify(env, {
        userId: Number(a.created_by), type: 'grow_kpi_alert', title: `Alert: ${alertText(row.kpi, a)}`,
        body: `${row.kpi} crossed the alert you set${row.as_of ? `, as of ${row.as_of}` : ''}.`,
        link: `/grow/revenue-and-traction/${a.kpi_key}?project_id=${projectId}`,
        payload: { project_id: projectId, kpi: a.kpi_key, alert: a.uid }, channels: ['in_app'], category: 'proactive_nudges',
      });
      notified += 1;
    } else if (a.last_crossed_at) {
      await env.DB.prepare('UPDATE kpi_alerts SET last_crossed_at = NULL, updated_at = ? WHERE id = ?').bind(at, a.id).run();
      cleared += 1;
    }
  }
  return { notified, cleared };
}

/** Best effort: an alert that cannot be checked never fails the write that triggered it. */
async function alertsAfterWrite(env: Env, projectId: number, key: string): Promise<void> {
  try { await checkKpiAlerts(env, projectId, Date.now(), [key]); } catch (e) {
    console.warn('[growKpis] alert check failed', (e as Error).message);
  }
}
