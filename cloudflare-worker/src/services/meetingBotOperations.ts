/** D886 B10 (#2588): count-only operations projections and alert policy.
 *
 * B1 supplies the complete, scoped read. This module neither dispatches a bot
 * nor changes its state. Missing measurements stay null. Never spread a run
 * into a result: a control-plane row may also hold encrypted customer data.
 */
import type { NotifyArgs } from './notify';
import type { Env } from '../types';
import { branchOf } from '../util/branch';

export const BOT_PLATFORMS = ['zoom', 'google_meet', 'teams'] as const;
export const BOT_STATUSES = ['queued', 'joining', 'waiting_room', 'recording', 'processing', 'done', 'failed', 'stopped'] as const;
export type BotPlatform = typeof BOT_PLATFORMS[number];
export type BotStatus = typeof BOT_STATUSES[number];
const TERMINAL = new Set<BotStatus>(['done', 'failed', 'stopped']);
// B1 stops the recording runtime at processing; its assembly timeout is a
// different signal, so processing must not create a runtime-heartbeat alert.
const HEARTBEAT = new Set<BotStatus>(['joining', 'waiting_room', 'recording']);
const DAY = 86_400_000;

// An arbitrary provider error string can contain a URL or a person's name.
// Extend this vocabulary only with B1's documented content-free codes.
export const BOT_FAILURE_CODES = [
  'join_timeout', 'waiting_room_timeout', 'heartbeat_timeout', 'runtime_unavailable',
  'runtime_error', 'recording_failed', 'transcription_failed', 'consent_required',
  'admission_refused', 'meeting_ended', 'runtime_failed', 'notice_failed',
  'unsupported_platform', 'processing_failed', 'processing_timeout',
  'budget_refused', 'unsupported_link', 'unknown',
] as const;
export type BotFailureCode = typeof BOT_FAILURE_CODES[number];

/** Internal projection contract, not a new database schema. The B1 adapter
 * maps its canonical stores to these fields after checking read completeness.
 * UTC timestamps may be ISO or SQLite UTC (convert B1 epoch milliseconds in
 * its adapter). minutes is recorded audio duration, never B1's billed runtime
 * minutes. heartbeat_due_at includes B1's full heartbeat grace. Cost excludes markup; charged is
 * the settled AI-token ledger amount, never a reservation or estimate.
 */
export interface BotOperationsRun {
  platform: BotPlatform;
  status: BotStatus;
  created_at: string;
  ended_at: string | null;
  failure_code: string | null;
  minutes: number | null;
  runtime_seconds: number | null;
  provider_cost_microusd: number | null;
  charged_microusd: number | null;
  heartbeat_due_at: string | null;
}
export type OperationsRead =
  | { state: 'ok'; runs: readonly BotOperationsRun[] }
  | { state: 'not_recorded' | 'unreadable' };

export interface BotFinancials {
  terminal_runs: number;
  measured_runs: number;
  measured_cost_runs: number;
  measured_charge_runs: number;
  provider_cost_microusd: number | null;
  charged_microusd: number | null;
  runtime_seconds: number | null;
  cost_per_bot_hour_microusd: number | null;
  realised_margin_bps: number | null;
  target_markup_bps: 2500;
  target_gross_margin_bps: 2000;
}
export interface BotPeriod {
  from: string;
  to: string;
  runs: number;
  platforms: { platform: BotPlatform; statuses: Record<BotStatus, number>; runs: number }[];
  failures: { platform: BotPlatform; code: BotFailureCode; runs: number }[];
  recorded_minutes: number | null;
  measured_minutes_runs: number;
  financials: BotFinancials;
}
export type BotOperationsReport =
  | { state: 'ok'; as_of: string; today: BotPeriod; days7: BotPeriod; days30: BotPeriod; alerts: BotAlert[]; heartbeat_unknown_runs: number }
  | { state: 'not_recorded' | 'unreadable'; as_of: string; reason: string };

export type BotAlert =
  | { kind: 'failure_rate'; platform: BotPlatform; failed: number; completed: number; rate_bps: number }
  | { kind: 'missed_heartbeat'; platform: BotPlatform; runs: number }
  | { kind: 'low_margin'; provider_cost_microusd: number; charged_microusd: number; margin_bps: number | null };

const stamp = (raw: string | null): number => {
  if (!raw) return NaN;
  const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(utc)) return NaN;
  return Date.parse(utc);
};
const measured = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const money = (x: unknown): x is number => measured(x) && Number.isSafeInteger(x);
const total = (values: number[]): number | null => {
  const n = values.reduce((a, b) => a + b, 0);
  return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : null;
};
const inWindow = (raw: string | null, from: number, to: number) => { const n = stamp(raw); return n >= from && n <= to; };
const codeOf = (raw: string | null): BotFailureCode => BOT_FAILURE_CODES.includes(raw as BotFailureCode) ? raw as BotFailureCode : 'unknown';

/** B1's published epoch-ms control-plane projection. Deliberately excludes
 * its meeting URL, roster, quoted rate and billed-minutes field. The future
 * canonical reader supplies measured audio/cost and the linked ledger row;
 * this adapter never estimates missing readings from the price constant.
 */
export function projectBotOperationsRun(run: {
  platform: BotPlatform; status: BotStatus; failure_code: string | null;
  created_at: number; started_at: number | null; ended_at: number | null; heartbeat_at: number | null;
}, measurements: {
  recorded_minutes: number | null; provider_cost_microusd: number | null;
  reservation: { status: string; actual_included_microusd: number | null; actual_topup_microusd: number | null } | null;
}, heartbeatGraceMs: number): BotOperationsRun {
  const iso = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || !Number.isFinite(new Date(n).getTime())) throw new Error('meeting_bot_timestamp_unreadable');
    return new Date(n).toISOString();
  };
  if (!money(heartbeatGraceMs)) throw new Error('meeting_bot_heartbeat_policy_unreadable');
  const ledger = measurements.reservation;
  const charged = ledger && (ledger.status === 'settled' || ledger.status === 'refunded')
    && money(ledger.actual_included_microusd) && money(ledger.actual_topup_microusd)
    ? total([ledger.actual_included_microusd, ledger.actual_topup_microusd]) : null;
  // Validate both clock endpoints before deriving their duration.
  if (run.started_at !== null) iso(run.started_at);
  return {
    platform: run.platform, status: run.status, failure_code: run.failure_code,
    created_at: iso(run.created_at), ended_at: run.ended_at === null ? null : iso(run.ended_at),
    runtime_seconds: run.started_at !== null && run.ended_at !== null && run.ended_at >= run.started_at
      ? (run.ended_at - run.started_at) / 1000 : null,
    minutes: measured(measurements.recorded_minutes) ? measurements.recorded_minutes : null,
    provider_cost_microusd: money(measurements.provider_cost_microusd) ? measurements.provider_cost_microusd : null,
    charged_microusd: charged,
    heartbeat_due_at: run.heartbeat_at === null ? null : iso(run.heartbeat_at + heartbeatGraceMs),
  };
}

/** No partial-cohort margin: a missing bill must not make an alert look safe.
 * Runtime cost/hour uses runtime seconds, not recorded audio minutes.
 */
export function botFinancials(runs: readonly BotOperationsRun[]): BotFinancials {
  const ended = runs.filter(r => TERMINAL.has(r.status));
  const costs = ended.filter(r => money(r.provider_cost_microusd));
  const charges = ended.filter(r => money(r.charged_microusd));
  const paired = ended.filter(r => money(r.provider_cost_microusd) && money(r.charged_microusd));
  const cost = ended.length > 0 && costs.length === ended.length ? total(costs.map(r => r.provider_cost_microusd!)) : null;
  const charged = ended.length > 0 && charges.length === ended.length ? total(charges.map(r => r.charged_microusd!)) : null;
  const seconds = ended.length > 0 && ended.every(r => measured(r.runtime_seconds)) ? total(ended.map(r => r.runtime_seconds!)) : null;
  return {
    terminal_runs: ended.length, measured_runs: paired.length, measured_cost_runs: costs.length, measured_charge_runs: charges.length,
    provider_cost_microusd: cost, charged_microusd: charged, runtime_seconds: seconds,
    cost_per_bot_hour_microusd: cost !== null && seconds !== null && seconds > 0 ? cost * 3600 / seconds : null,
    realised_margin_bps: cost !== null && charged !== null && charged > 0 ? (charged - cost) / charged * 10_000 : null,
    target_markup_bps: 2500, target_gross_margin_bps: 2000,
  };
}

function period(runs: readonly BotOperationsRun[], from: number, to: number): BotPeriod {
  const cohort = runs.filter(r => inWindow(r.created_at, from, to));
  const failures: BotPeriod['failures'] = [];
  const platforms = BOT_PLATFORMS.map(platform => {
    const subset = cohort.filter(r => r.platform === platform);
    const statuses = Object.fromEntries(BOT_STATUSES.map(s => [s, subset.filter(r => r.status === s).length])) as Record<BotStatus, number>;
    for (const code of BOT_FAILURE_CODES) {
      const n = subset.filter(r => r.status === 'failed' && codeOf(r.failure_code) === code).length;
      if (n) failures.push({ platform, code, runs: n });
    }
    return { platform, statuses, runs: subset.length };
  });
  const minutes = cohort.filter(r => measured(r.minutes));
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), runs: cohort.length,
    platforms, failures, recorded_minutes: minutes.length === cohort.length ? total(minutes.map(r => r.minutes!)) : null,
    measured_minutes_runs: minutes.length, financials: botFinancials(cohort),
  };
}

/** Alert denominators: done+failed runs ended in the last 24 hours. User
 * stops and active runs cannot dilute failures. Margin uses all terminal runs
 * ended in 7 days, with complete measured cost and settled-charge coverage.
 */
export function evaluateBotAlerts(runs: readonly BotOperationsRun[], now: number): BotAlert[] {
  const alerts: BotAlert[] = [];
  for (const platform of BOT_PLATFORMS) {
    const subset = runs.filter(r => r.platform === platform);
    const completed = subset.filter(r => (r.status === 'done' || r.status === 'failed') && inWindow(r.ended_at, now - DAY, now));
    const failed = completed.filter(r => r.status === 'failed').length;
    if (completed.length && failed * 10 > completed.length * 3) {
      alerts.push({ kind: 'failure_rate', platform, failed, completed: completed.length, rate_bps: failed / completed.length * 10_000 });
    }
    const missed = subset.filter(r => HEARTBEAT.has(r.status) && stamp(r.heartbeat_due_at) < now).length;
    if (missed) alerts.push({ kind: 'missed_heartbeat', platform, runs: missed });
  }
  const financials = botFinancials(runs.filter(r => inWindow(r.ended_at, now - 7 * DAY, now)));
  const { provider_cost_microusd: cost, charged_microusd: charged } = financials;
  // BigInt keeps the strict 15% boundary correct for large ledger amounts.
  if (cost !== null && charged !== null && ((charged === 0 && cost > 0)
    || (charged > 0 && (BigInt(charged) - BigInt(cost)) * 100n < BigInt(charged) * 15n))) {
    alerts.push({ kind: 'low_margin', provider_cost_microusd: cost, charged_microusd: charged,
      margin_bps: financials.realised_margin_bps });
  }
  return alerts;
}

/** Reject malformed snapshots rather than silently producing incomplete
 * counts. A source must not mark a paginated/limited read complete.
 */
export function meetingBotOperations(read: OperationsRead, now = Date.now()): BotOperationsReport {
  if (!Number.isFinite(now)) throw new Error('invalid_operations_time');
  const asOf = new Date(now).toISOString();
  const unavailable = (state: 'not_recorded' | 'unreadable'): BotOperationsReport => ({ state, as_of: asOf,
    reason: state === 'not_recorded' ? 'Meeting bot operations are not recorded yet.' : 'Meeting bot operations could not be read completely.' });
  if (read.state !== 'ok') return unavailable(read.state);
  if (read.runs.some(r => !BOT_PLATFORMS.includes(r.platform) || !BOT_STATUSES.includes(r.status)
    || !Number.isFinite(stamp(r.created_at)) || stamp(r.created_at) > now
    || (r.ended_at !== null && (!Number.isFinite(stamp(r.ended_at)) || stamp(r.ended_at) > now || stamp(r.ended_at) < stamp(r.created_at))))) {
    return unavailable('unreadable');
  }
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
  return { state: 'ok', as_of: asOf,
    today: period(read.runs, day.getTime(), now), days7: period(read.runs, now - 7 * DAY, now), days30: period(read.runs, now - 30 * DAY, now),
    alerts: evaluateBotAlerts(read.runs, now),
    heartbeat_unknown_runs: read.runs.filter(r => HEARTBEAT.has(r.status) && !Number.isFinite(stamp(r.heartbeat_due_at))).length,
  };
}

/** Fixed sentences and allowlisted fields only. Delivery uses notify() and
 * its existing preferences; B1's coordinator must claim an alert episode
 * before calling it. This pure formatter neither chooses recipients nor
 * claims delivery or deduplication.
 */
export function botAlertNotification(userId: number, alert: BotAlert): NotifyArgs {
  const shared = { userId, type: 'meeting_bot_operations', channels: ['in_app'] as ['in_app'], category: 'operations', link: '/admin/platform/meeting-bots' };
  switch (alert.kind) {
    case 'failure_rate': return { ...shared, title: 'Meeting bot failures above 30%',
      body: `${alert.failed} of ${alert.completed} completed runs failed in the last 24 hours.`,
      payload: { kind: alert.kind, platform: alert.platform, failed: alert.failed, completed: alert.completed, rate_bps: alert.rate_bps } };
    case 'missed_heartbeat': return { ...shared, title: 'Meeting bot heartbeat missed',
      body: `${alert.runs} active runs missed their heartbeat deadline.`, payload: { kind: alert.kind, platform: alert.platform, runs: alert.runs } };
    case 'low_margin': return { ...shared, title: 'Meeting bot margin below 15%',
      body: 'Measured cost against settled AI tokens over seven days is below the margin threshold.',
      payload: { kind: alert.kind, provider_cost_microusd: alert.provider_cost_microusd, charged_microusd: alert.charged_microusd, margin_bps: alert.margin_bps } };
  }
}

/** The B1 coordinator calls this only after claiming the alert episode.
 * One existing inbox channel; only active HQ Super Admins, never every admin.
 * Return confirmed inbox count, without claiming email/push delivery. A failed
 * read throws so the coordinator can retry; delivery failures are counted as
 * not recorded and do not abort later recipients or request a whole-episode
 * retry that could duplicate earlier deliveries. No runtime dispatch or cron is
 * registered here while the B1 interface is unpublished.
 */
export async function sendMeetingBotAlert(
  env: Env, alert: BotAlert,
  publish?: (env: Env, args: NotifyArgs) => Promise<number | null>,
): Promise<{ recipients: number; recorded: number }> {
  if (branchOf(env)) return { recipients: 0, recorded: 0 };
  const result = await env.DB.prepare(`SELECT u.id FROM super_admins s JOIN users u ON u.id = s.user_id
    WHERE u.is_active = 1 AND u.role = 'admin'`).all<{ id: number }>();
  const success: unknown = result.success;
  if (success === false || !Array.isArray(result.results)) throw new Error('meeting_bot_recipients_unreadable');
  const send = publish ?? (await import('./notify')).notify;
  let recorded = 0;
  for (const row of result.results) {
    try {
      const id = await send(env, botAlertNotification(row.id, alert));
      if (id !== null) recorded++;
    } catch { /* A failed recipient must not prevent the remaining deliveries. */ }
  }
  return { recipients: result.results.length, recorded };
}
