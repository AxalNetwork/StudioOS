/**
 * D4559 (#4559) part 2 — platform capacity over time: a daily snapshot of the
 * readings `platformCapacity.ts` makes, a trend with a projected limit month
 * that states its window and confidence, and stored alert episodes that open
 * once, change severity in place, clear on recovery and can be muted.
 *
 * WHAT IS STORED. Only the deployment-wide metrics the capacity read returns
 * (`SNAPSHOT_KEY`): D1 size and its ratio to the limit, and each queue's
 * backlog and oldest age. Each row is a number, a unit, an availability and a
 * level. No member, company, tenant, file name, SQL or secret reaches either
 * table, and nothing here is tenant usage, so the HQ view leaks none.
 *
 * MISSING IS NOT ZERO, OVER TIME TOO. An unreadable day is stored as
 * `value: NULL, availability: 'unavailable'` and drawn as a gap; the
 * projection fits measured days only and says how many it had.
 *
 * ALERTS (`evaluateAlerts`, pure):
 *   - a warning or critical level opens one episode per (scope, metric), or
 *     changes the open episode's severity; a level that stays raised is the
 *     same episode on every sweep (the partial unique index holds this even
 *     if two sweeps race);
 *   - a MEASURED ok (including an empty queue) clears the open episode;
 *   - an UNREADABLE source neither clears a level episode nor opens one: an
 *     outage is not a recovery. A source that was measured in the last 48
 *     hours and has stopped answering opens an `unavailable` episode (a
 *     freshness gap); one never measured stays listed as unavailable only;
 *   - the thresholds' hysteresis comes from `levelFor`, fed the open
 *     episode's severity as the previous level, so a value at a boundary does
 *     not flap between open and clear.
 * ROUTING. Active HQ Super Admins, in-app, category `operations`, linking
 * HQ · Platform; a member can turn it off with
 * `notification_prefs.platform_capacity.in_app = false`. Each notification's
 * dedupe key is the episode and the severity, so one episode notifies once per
 * severity and once when it clears. A muted episode is still tracked and
 * cleared; it only stops notifying until `muted_until`.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { levelFor, readPlatformCapacity, type Level, type Metric } from './platformCapacity';

/** The metrics the snapshot keeps: the capacity read's own fixed keys, nothing else. */
export const SNAPSHOT_KEY = /^(d1\.size_bytes|d1\.size_ratio|queue\.(job|agent)\.(backlog_messages|backlog_bytes|oldest_age_seconds))$/;

/** Days of history the trend reads and the projection may fit. */
export const HISTORY_DAYS_DEFAULT = 90;
export const HISTORY_DAYS_MAX = 365;
/** Fewer measured days than this and no projection is stated. */
export const PROJECTION_MIN_POINTS = 7;
/** A projection further out than this is "beyond the horizon", with no month. */
export const PROJECTION_HORIZON_DAYS = 5 * 365;
/** A source last measured this recently that stops answering opens an `unavailable` episode. */
export const FRESHNESS_GAP_MS = 48 * 3_600_000;
/** The longest mute an operator may set. */
export const MUTE_MAX_HOURS = 7 * 24;

export type Severity = 'warning' | 'critical' | 'unavailable';
export type OpenAlert = { id: number; metric_key: string; severity: Severity; muted_until: string | null };
export type AlertAction =
  | { kind: 'open'; key: string; severity: Severity; value: number | null }
  | { kind: 'change'; id: number; key: string; from: Severity; severity: Severity; value: number | null }
  | { kind: 'touch'; id: number; key: string; value: number | null }
  | { kind: 'clear'; id: number; key: string; from: Severity; value: number | null };

const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/** A metric with thresholds is one an alert can be raised on. */
const alertable = (m: Metric) => m.thresholds !== null;

/**
 * What the sweep does to the stored episodes, given this reading. Pure: the
 * caller supplies the open episodes and, per metric, when it was last measured.
 */
export function evaluateAlerts(
  open: OpenAlert[], metrics: Metric[], lastMeasuredAt: Record<string, string | null>, now: Date,
): AlertAction[] {
  const out: AlertAction[] = [];
  const openBy = new Map(open.map((a) => [a.metric_key, a]));
  for (const m of metrics) {
    if (!alertable(m)) continue;
    const cur = openBy.get(m.key);
    // The level with hysteresis, the open episode's severity as the previous level.
    const prev: Level | undefined = cur && cur.severity !== 'unavailable' ? cur.severity : undefined;
    const level: Level = m.availability === 'measured' && m.thresholds ? levelFor(m.value, m.thresholds, prev) : m.level;
    if (level === 'warning' || level === 'critical') {
      if (!cur) out.push({ kind: 'open', key: m.key, severity: level, value: m.value });
      else if (cur.severity !== level) out.push({ kind: 'change', id: cur.id, key: m.key, from: cur.severity, severity: level, value: m.value });
      else out.push({ kind: 'touch', id: cur.id, key: m.key, value: m.value });
    } else if (level === 'ok') {
      // Measured ok, or an empty queue: a recovery.
      if (cur) out.push({ kind: 'clear', id: cur.id, key: m.key, from: cur.severity, value: m.value });
    } else {
      // Unknown. An outage holds whatever is open and never reads as recovery.
      if (cur) { out.push({ kind: 'touch', id: cur.id, key: m.key, value: null }); continue; }
      const last = lastMeasuredAt[m.key];
      const lastMs = last ? Date.parse(last) : NaN;
      if (Number.isFinite(lastMs) && now.getTime() - lastMs <= FRESHNESS_GAP_MS) {
        out.push({ kind: 'open', key: m.key, severity: 'unavailable', value: null });
      }
    }
  }
  return out;
}

export type Projection =
  | { state: 'insufficient'; points_used: number; window_days: number; basis: string }
  | { state: 'not_growing' | 'at_limit' | 'beyond_horizon'; points_used: number; window_days: number; from: string; to: string; growth_bytes_per_day: number; r2: number | null; basis: string }
  | { state: 'projected'; points_used: number; window_days: number; from: string; to: string; growth_bytes_per_day: number; r2: number | null; projected_month: string; confidence: 'low' | 'medium'; basis: string };

/**
 * When a byte series reaches `limitBytes`, by a straight line through its
 * measured days. Says the window, the points it used and a confidence, and
 * names a MONTH, not a day: a line through a few weeks of growth does not know
 * the day. Never more than `medium`: it is a trend, not a forecast.
 */
export function projectLimit(points: { day: string; value: number | null }[], limitBytes: number, windowDays: number): Projection {
  const measured = points
    .filter((p) => typeof p.value === 'number' && Number.isFinite(p.value))
    .map((p) => ({ t: Date.parse(`${p.day}T00:00:00Z`) / DAY_MS, v: p.value as number, day: p.day }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const n = measured.length;
  if (n < PROJECTION_MIN_POINTS || measured[n - 1].t - measured[0].t < PROJECTION_MIN_POINTS - 1) {
    return {
      state: 'insufficient', points_used: n, window_days: windowDays,
      basis: `${n} measured day${n === 1 ? '' : 's'} in the last ${windowDays}; a projection needs at least ${PROJECTION_MIN_POINTS} across a week.`,
    };
  }
  const mt = measured.reduce((a, p) => a + p.t, 0) / n;
  const mv = measured.reduce((a, p) => a + p.v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of measured) { sxy += (p.t - mt) * (p.v - mv); sxx += (p.t - mt) ** 2; syy += (p.v - mv) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : null;
  const first = measured[0], last = measured[n - 1];
  const fitted = mv + slope * (last.t - mt);
  const common = {
    points_used: n, window_days: windowDays, from: first.day, to: last.day,
    growth_bytes_per_day: Math.round(slope), r2: r2 === null ? null : Math.round(r2 * 100) / 100,
  };
  const lead = `A straight line through ${n} measured days (${first.day} to ${last.day})`;
  if (last.v >= limitBytes) return { state: 'at_limit', ...common, basis: `${lead}: the latest size is at or over the limit.` };
  if (slope <= 0) return { state: 'not_growing', ...common, basis: `${lead} does not grow, so there is no date to project.` };
  const daysLeft = (limitBytes - fitted) / slope;
  if (daysLeft > PROJECTION_HORIZON_DAYS) {
    return { state: 'beyond_horizon', ...common, basis: `${lead} reaches the limit more than five years out; no month is stated.` };
  }
  const at = new Date((last.t + Math.max(0, daysLeft)) * DAY_MS);
  const confidence = n >= 28 && r2 !== null && r2 >= 0.8 ? 'medium' : 'low';
  return {
    state: 'projected', ...common, projected_month: at.toISOString().slice(0, 7), confidence,
    basis: `${lead}${r2 === null ? '' : `, R² ${common.r2}`}. A trend of recent growth, not a forecast of future use; confidence is ${confidence}.`,
  };
}

/** The daily rows for one reading. Pure, so the privacy rule is testable on its output. */
export function snapshotRows(report: { observed_at: string; scope: string; metrics: Metric[] }) {
  const d = report.observed_at.slice(0, 10);
  return report.metrics
    .filter((m) => SNAPSHOT_KEY.test(m.key) && m.scope === 'deployment')
    .map((m) => ({
      scope: report.scope, day: d, metric_key: m.key,
      value: m.availability === 'measured' ? m.value : null,
      unit: m.unit, availability: m.availability, level: m.level, observed_at: report.observed_at,
    }));
}

async function writeSnapshot(env: Env, rows: ReturnType<typeof snapshotRows>) {
  if (!rows.length) return 0;
  const stmts = rows.map((r) => env.DB.prepare(
    `INSERT INTO platform_capacity_snapshots (scope, day, metric_key, value, unit, availability, level, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, day, metric_key) DO UPDATE SET
       value = excluded.value, unit = excluded.unit, availability = excluded.availability,
       level = excluded.level, observed_at = excluded.observed_at`,
  ).bind(r.scope, r.day, r.metric_key, r.value, r.unit, r.availability, r.level, r.observed_at));
  await env.DB.batch(stmts);
  return rows.length;
}

function severityLabel(s: Severity) {
  return s === 'critical' ? 'Critical' : s === 'warning' ? 'Warning' : 'Unavailable';
}

/** The in-app notification for one transition. Names the metric and its level; no tenant. */
export function alertNotice(a: AlertAction, label: string) {
  const title = a.kind === 'clear' ? `Cleared: ${label}` : `${severityLabel((a as any).severity)}: ${label}`;
  const body = a.kind === 'clear'
    ? `${label} is back within its threshold.`
    : (a as any).severity === 'unavailable'
      ? `${label} could not be read. It was readable in the last 48 hours.`
      : `${label} is at the ${(a as any).severity} level.`;
  return { title, body, link: '/admin/platform' };
}

async function notifySuperAdmins(env: Env, dedupe: string, notice: { title: string; body: string; link: string }, payload: unknown) {
  const recipients = await env.DB.prepare(
    `SELECT u.id, u.notification_prefs FROM super_admins s JOIN users u ON u.id = s.user_id
      WHERE u.is_active = 1 AND u.role = 'admin'`,
  ).all<{ id: number; notification_prefs: string | null }>();
  if (!Array.isArray(recipients.results)) throw new Error('platform_capacity_recipients_unreadable');
  let recorded = 0;
  for (const u of recipients.results) {
    let prefs: any = {};
    try { prefs = JSON.parse(u.notification_prefs || '{}'); } catch { /* default on */ }
    if (prefs?.platform_capacity?.in_app === false) continue;
    const token = crypto.randomUUID();
    // The unique (user_id, kind, dedupe_key) receipt elects one publisher; the
    // inbox row is written only under that receipt's token (D1 batch is one transaction).
    const res = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO notifications (user_id, kind, title, body, link, meta, dedupe_key)
        VALUES (?, 'platform_capacity', ?, ?, ?, ?, ?)`).bind(u.id, notice.title, notice.body, notice.link, token, dedupe),
      env.DB.prepare(`INSERT INTO notifications_inbox (user_id, type, title, body, link, payload, channel, category)
        SELECT ?, 'platform_capacity', ?, ?, ?, ?, 'in_app', 'operations' WHERE EXISTS
        (SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'platform_capacity' AND dedupe_key = ? AND meta = ?)`)
        .bind(u.id, notice.title, notice.body, notice.link, JSON.stringify(payload), u.id, dedupe, token),
    ]);
    recorded += res[1]?.meta?.changes ?? 0;
  }
  return recorded;
}

/**
 * The sweep: read capacity, keep today's snapshot when asked, then move the
 * alert episodes. HQ only; a branch Worker reads its own copy but alerts no one.
 */
export async function sweepPlatformCapacity(env: Env, now: Date = new Date(), opts: { snapshot?: boolean } = {}) {
  if (branchOf(env)) return { skipped: 'branch' as const };
  const report = await readPlatformCapacity(env, now);
  const written = opts.snapshot ? await writeSnapshot(env, snapshotRows(report)) : 0;

  const openRows = await env.DB.prepare(
    `SELECT id, metric_key, severity, muted_until FROM platform_capacity_alerts WHERE scope = ? AND state = 'open'`,
  ).bind(report.scope).all<OpenAlert>();
  const measuredRows = await env.DB.prepare(
    `SELECT metric_key, MAX(observed_at) AS at FROM platform_capacity_snapshots
      WHERE scope = ? AND availability = 'measured' GROUP BY metric_key`,
  ).bind(report.scope).all<{ metric_key: string; at: string }>();
  if (!Array.isArray(openRows.results) || !Array.isArray(measuredRows.results)) throw new Error('platform_capacity_alerts_unreadable');
  const lastMeasured: Record<string, string | null> = {};
  for (const r of measuredRows.results) lastMeasured[r.metric_key] = r.at;

  const actions = evaluateAlerts(openRows.results, report.metrics, lastMeasured, now);
  const at = now.toISOString();
  const labelOf = new Map(report.metrics.map((m) => [m.key, m.label]));
  const mutedOf = new Map(openRows.results.map((a) => [a.id, a.muted_until]));
  let notified = 0;
  for (const a of actions) {
    let id: number | null = null;
    if (a.kind === 'open') {
      const res = await env.DB.prepare(
        `INSERT OR IGNORE INTO platform_capacity_alerts (scope, metric_key, severity, state, opened_at, last_seen_at, last_value)
         VALUES (?, ?, ?, 'open', ?, ?, ?)`,
      ).bind(report.scope, a.key, a.severity, at, at, a.value).run();
      // Another sweep opened it first: that sweep owns the notice.
      if (!res.meta?.changes) continue;
      id = Number(res.meta.last_row_id);
    } else if (a.kind === 'change') {
      const res = await env.DB.prepare(
        `UPDATE platform_capacity_alerts SET severity = ?, last_seen_at = ?, last_value = ? WHERE id = ? AND state = 'open'`,
      ).bind(a.severity, at, a.value, a.id).run();
      if (!res.meta?.changes) continue;
      id = a.id;
    } else if (a.kind === 'touch') {
      await env.DB.prepare(
        `UPDATE platform_capacity_alerts SET last_seen_at = ?, last_value = COALESCE(?, last_value) WHERE id = ? AND state = 'open'`,
      ).bind(at, a.value, a.id).run();
      continue;
    } else {
      const res = await env.DB.prepare(
        `UPDATE platform_capacity_alerts SET state = 'cleared', cleared_at = ?, last_seen_at = ?, last_value = ? WHERE id = ? AND state = 'open'`,
      ).bind(at, at, a.value, a.id).run();
      if (!res.meta?.changes) continue;
      id = a.id;
    }
    const muted = id !== null ? mutedOf.get(id) : null;
    if (muted && Date.parse(muted) > now.getTime()) continue;
    const stage = a.kind === 'clear' ? 'cleared' : (a as any).severity;
    notified += await notifySuperAdmins(
      env, `platform-capacity:${report.scope}:${a.key}:${id}:${stage}`,
      alertNotice(a, labelOf.get(a.key) ?? a.key),
      { metric_key: a.key, stage, alert_id: id },
    );
  }
  return { level: report.level, snapshot_rows: written, actions: actions.filter((a) => a.kind !== 'touch').length, notified };
}

/** History for the trend view, with the D1 projection. An unreadable store says so; it is not an empty history. */
export async function readCapacityHistory(env: Env, scope: string, days: number, limitBytes: number, now: Date = new Date()) {
  const since = day(new Date(now.getTime() - (days - 1) * DAY_MS));
  let rows: any[];
  try {
    const res = await env.DB.prepare(
      `SELECT day, metric_key, value, unit, availability, level, observed_at FROM platform_capacity_snapshots
        WHERE scope = ? AND day >= ? ORDER BY metric_key, day`,
    ).bind(scope, since).all<any>();
    if (!Array.isArray(res.results)) throw new Error('unreadable');
    rows = res.results;
  } catch {
    return { state: 'unreadable' as const, reason: 'The capacity history could not be read.', window_days: days };
  }
  const series = new Map<string, { key: string; unit: string; points: any[]; last_measured_at: string | null }>();
  for (const r of rows) {
    if (!series.has(r.metric_key)) series.set(r.metric_key, { key: r.metric_key, unit: r.unit, points: [], last_measured_at: null });
    const s = series.get(r.metric_key)!;
    s.points.push({ day: r.day, value: r.value == null ? null : Number(r.value), availability: r.availability, level: r.level });
    if (r.availability === 'measured') s.last_measured_at = r.observed_at;
  }
  const d1 = series.get('d1.size_bytes');
  return {
    state: rows.length ? 'ok' as const : 'not_recorded' as const,
    window_days: days, from: since, to: day(now),
    series: [...series.values()],
    d1_projection: projectLimit(d1?.points ?? [], limitBytes, days),
  };
}

/** Open episodes and those cleared in the last 30 days. */
export async function readCapacityAlerts(env: Env, scope: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  try {
    const res = await env.DB.prepare(
      `SELECT id, metric_key, severity, state, opened_at, last_seen_at, last_value, cleared_at, muted_until, mute_reason
         FROM platform_capacity_alerts
        WHERE scope = ? AND (state = 'open' OR cleared_at >= ?)
        ORDER BY state = 'open' DESC, opened_at DESC LIMIT 200`,
    ).bind(scope, since).all<any>();
    if (!Array.isArray(res.results)) throw new Error('unreadable');
    const items = res.results.map((r: any) => ({
      ...r, last_value: r.last_value == null ? null : Number(r.last_value),
      muted: !!r.muted_until && Date.parse(r.muted_until) > now.getTime(),
    }));
    return { state: 'ok' as const, open: items.filter((a) => a.state === 'open'), cleared: items.filter((a) => a.state !== 'open') };
  } catch {
    return { state: 'unreadable' as const, reason: 'The capacity alerts could not be read.' };
  }
}

/** Mute an open episode for up to a week. It stays tracked and still clears. */
export async function muteCapacityAlert(env: Env, id: number, hours: number, reason: string, userId: number, now: Date = new Date()) {
  const until = new Date(now.getTime() + hours * 3_600_000).toISOString();
  const res = await env.DB.prepare(
    `UPDATE platform_capacity_alerts SET muted_until = ?, muted_by = ?, mute_reason = ? WHERE id = ? AND state = 'open'`,
  ).bind(until, userId, reason, id).run();
  return { changed: Number(res.meta?.changes ?? 0), muted_until: until };
}
