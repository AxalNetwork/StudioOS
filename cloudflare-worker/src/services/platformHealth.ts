/**
 * D4854 (#4854) — HQ · Platform's health: one state, and the incidents the platform detects for itself.
 *
 * The page had observations (cron rows, a dead-letter count, a webhook's day, a traffic split) and one incident
 * figure: the PUBLISHED status-page incidents, which a person enters by hand. Nothing turned a failing signal into
 * an incident, and an unreadable telemetry store sat beside healthy-looking figures without lowering anything.
 *
 * DETECTED, NOT STORED. Every incident here is derived on read from the signal that raises it, keyed by that signal
 * (`cron:<trigger>`, `webhook:failures`, `dlq:backlog`, `telemetry:…`). So the same failure is one incident however
 * many times the page loads (deduplicated by key), and it clears when the signal recovers: the next read finds
 * nothing to raise. No table is written and none is created. `since` is when the signal began, from its own rows,
 * where they say; `observed_at` is this read.
 *
 * PUBLISHED IS KEPT APART. The status-page count is carried as `published`, labelled manual, and never folded into
 * the detected list or the state.
 *
 * MISSING IS NOT HEALTHY. Telemetry that is not configured, or does not answer, is itself an incident and lowers the
 * state. A signal whose source could not be read is listed under `unknown` with its reason, and the state is never
 * `healthy` while one is. The order is critical > degraded > unknown > healthy.
 *
 * EVERY INCIDENT SAYS WHERE TO GO: a console in the app where one exists, and always a runbook section in
 * `documentation/operations/PLATFORM_OBSERVABILITY.md` §7.
 *
 * NOT DETECTED HERE, AND SAID SO (`not_detected`): only reasons that are true on this deployment (D5370). The
 * meeting bot's staged diagnostics are an owner's on-demand check kept in R2 with no index, so they are not read;
 * the bot itself is, unless it is off here or this is a branch.
 *
 * D5370 (#5370) added two signals. The MEETING BOT (`meetingBotHealth.ts`): its latest start failed, or failed
 * several times in a row, or its readiness preflight failed; a failed check and a report that never arrived are
 * different incidents (D4857). BRANCH HEALTH: not the fan-out (D110 keeps that in Deployments), but the last result
 * Deployments stored on `licence_deployments` (D452). A branch whose last check said not ok is an incident; one not
 * checked for BRANCH_CHECK_STALE_HOURS is a low note, because only opening Deployments refreshes it.
 *
 * Coordinates with D4559 (`platformCapacity.ts`): capacity thresholds stay there; this file reads no D1 size or
 * queue metric and adds no second observability store.
 */
import type { Env } from '../types';
import { CRON_TRIGGERS, FAILED_STATUSES } from '../util/cronHistory';
import { probeTelemetry, TELEMETRY_PROBE_HOURS } from './analyticsReports';
import { STRIPE_WEBHOOK_PATH } from './stripeWebhookDeliveries';
import { BOT_START_FAILURE_STREAK, PREFLIGHT_CODES, type MeetingBotHealth } from './meetingBotHealth';
import { branchOf } from '../util/branch';

// ── Thresholds ─────────────────────────────────────────────────────────────

/** A trigger whose latest runs failed this many times in a row is high, not medium. */
export const CRON_FAILURE_STREAK = 3;
/** How many recent runs per trigger are read to measure a streak. */
export const CRON_STREAK_READ = 5;
/** Webhook deliveries refused in a row: high at this many, critical at the second. */
export const WEBHOOK_FAILURE_STREAK = 3;
export const WEBHOOK_FAILURE_CRITICAL = 10;
/** How many recent deliveries are read to measure a streak. */
export const WEBHOOK_STREAK_READ = 25;
/** No delivery for this long, while Stripe is configured, is noted as silence. A quiet store can be legitimate. */
export const WEBHOOK_SILENCE_HOURS = 72;
/** Dead letters waiting: medium from one, high from this many. */
export const DLQ_HIGH = 100;
/** Every metered API request writes a row, so an hour with none while the read answers is stale telemetry. */
export const TELEMETRY_STALE_MINUTES = 60;
/** Where the last successful telemetry read is kept, so an outage can say when it last worked. */
export const TELEMETRY_LAST_OK_KEY = 'health:telemetry:last_ok';
/** A live branch whose stored health check is older than this is noted (low): nobody has opened Deployments since. */
export const BRANCH_CHECK_STALE_HOURS = 24;
/** The provisioning states in which a branch is expected to answer (migration 258). */
export const LIVE_BRANCH_STATES = ['worker_live', 'hostname_active', 'linked'] as const;

/** Repo-relative, as `frontend/src/lib/integrationKeys.js`'s guides are: the page adds where the repository is read. */
const RUNBOOK = 'documentation/operations/PLATFORM_OBSERVABILITY.md';
export const REMEDIATION = {
  cron: { surface: null, runbook: { label: 'Runbook: a scheduled job is failing or late', doc: `${RUNBOOK}#71-a-scheduled-job-is-failing-or-late` } },
  webhook: {
    surface: { label: 'Payments › Stripe connection', href: '/admin/platform/payments/stripe' },
    runbook: { label: 'Runbook: the Stripe webhook is refusing or silent', doc: `${RUNBOOK}#72-the-stripe-webhook-is-refusing-or-silent` },
  },
  dlq: { surface: null, runbook: { label: 'Runbook: dead letters are waiting', doc: `${RUNBOOK}#73-dead-letters-are-waiting` } },
  telemetry: {
    surface: { label: 'Topology › This deployment', href: '/admin/platform/topology' },
    runbook: { label: 'Runbook: telemetry cannot be read', doc: `${RUNBOOK}#74-telemetry-cannot-be-read` },
  },
  meeting_bot: {
    surface: { label: 'Platform › Meeting bots', href: '/admin/platform/meeting-bots' },
    runbook: { label: 'Runbook: the meeting bot is not starting', doc: `${RUNBOOK}#75-the-meeting-bot-is-not-starting` },
  },
  branch: {
    surface: { label: 'Platform › Deployments', href: '/admin/platform' },
    runbook: { label: 'Runbook: a branch is unhealthy or unchecked', doc: `${RUNBOOK}#76-a-branch-is-unhealthy-or-unchecked` },
  },
} as const;

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
export type HealthState = 'critical' | 'degraded' | 'unknown' | 'healthy';

export type DetectedIncident = {
  key: string;
  kind: keyof typeof REMEDIATION;
  severity: Severity;
  title: string;
  detail: string;
  /** When the signal began, from its own rows; null when they do not say. */
  since: string | null;
  observed_at: string;
  remediation: { surface: { label: string; href: string } | null; runbook: { label: string; doc: string } };
};

// ── Signals ────────────────────────────────────────────────────────────────

const sqlStamp = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
const msOf = (s: string | null | undefined) => (s ? Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`) : NaN);

export type CronStreak = { trigger_name: string; consecutive_failures: number; first_failed_at: string | null; last_ok_at: string | null };

/** The latest few runs of each declared trigger, newest first: how many failed in a row, and since when. */
export async function readCronStreaks(env: Env, now: Date = new Date()) {
  try {
    const ceiling = sqlStamp(new Date(now.getTime() + 60_000));
    const lists = await Promise.all(CRON_TRIGGERS.map((t) => env.DB.prepare(
      `SELECT status, datetime(started_at) AS started_at FROM cron_run_history
        WHERE trigger_name = ? AND datetime(started_at) <= datetime(?)
        ORDER BY started_at DESC LIMIT ?`,
    ).bind(t.expr, ceiling, CRON_STREAK_READ).all<{ status: string | null; started_at: string | null }>()));
    const streaks: CronStreak[] = CRON_TRIGGERS.map((t, i) => {
      const rows = lists[i].results || [];
      let n = 0;
      while (n < rows.length && FAILED_STATUSES.has(String(rows[n].status || ''))) n += 1;
      return {
        trigger_name: t.expr,
        consecutive_failures: n,
        first_failed_at: n > 0 ? rows[n - 1].started_at : null,
        last_ok_at: n < rows.length ? rows[n].started_at : null,
      };
    });
    return { available: true as const, read_per_trigger: CRON_STREAK_READ, streaks };
  } catch {
    return { available: false as const, reason: 'The recent runs of each scheduled job could not be read, so a repeated failure cannot be measured.' };
  }
}

const refused = (code: number | null) => code !== null && (code < 200 || code >= 300);

/** The webhook's recent deliveries, newest first: the refusal streak, and the last success and failure ever logged. */
export async function readWebhookHealth(env: Env) {
  try {
    const [recent, lastOk, lastBad] = await Promise.all([
      env.DB.prepare(
        `SELECT status_code, datetime(created_at) AS at FROM activity_logs WHERE endpoint = ? ORDER BY id DESC LIMIT ?`,
      ).bind(STRIPE_WEBHOOK_PATH, WEBHOOK_STREAK_READ).all<{ status_code: number | null; at: string | null }>(),
      env.DB.prepare(
        `SELECT MAX(datetime(created_at)) AS at FROM activity_logs WHERE endpoint = ? AND status_code >= 200 AND status_code < 300`,
      ).bind(STRIPE_WEBHOOK_PATH).first<{ at: string | null }>(),
      env.DB.prepare(
        `SELECT MAX(datetime(created_at)) AS at FROM activity_logs WHERE endpoint = ? AND status_code IS NOT NULL AND (status_code < 200 OR status_code >= 300)`,
      ).bind(STRIPE_WEBHOOK_PATH).first<{ at: string | null }>(),
    ]);
    const rows = recent.results || [];
    let n = 0;
    while (n < rows.length && refused(rows[n].status_code ?? null)) n += 1;
    return {
      available: true as const,
      consecutive_failures: n,
      /** True when every delivery read was refused, so the streak may be longer than counted. */
      streak_at_least: n === rows.length && n > 0 && rows.length === WEBHOOK_STREAK_READ,
      streak_started_at: n > 0 ? rows[n - 1].at : null,
      last_delivery_at: rows[0]?.at ?? null,
      last_success_at: lastOk?.at ?? null,
      last_failure_at: lastBad?.at ?? null,
    };
  } catch {
    return { available: false as const, reason: 'The request log could not be read, so a run of refused webhook deliveries cannot be measured.' };
  }
}

export type TelemetryHealth = {
  status: 'healthy' | 'stale' | 'unavailable' | 'not_configured';
  /** The write binding: every Worker can write the dataset with no credential. */
  binding_present: boolean;
  /** The two secrets the SQL read needs are set here (HQ only). */
  read_configured: boolean;
  answered: boolean;
  last_event_at: string | null;
  events_in_window: number | null;
  window_hours: number;
  last_successful_read_at: string | null;
  checked_at: string;
  coverage: string;
  reason: string | null;
};

const TELEMETRY_COVERAGE = 'HQ reads the shared dataset for every branch; a branch never reads it (D230). Only HTTP request rows are counted.';

/**
 * Analytics Engine's health as a signal of its own. A successful read is remembered in KV (one small value, so an
 * outage can say when telemetry last worked); a KV failure leaves that time unknown and changes nothing else.
 */
export async function readTelemetryHealth(env: Env, now: Date = new Date()): Promise<TelemetryHealth> {
  const base = {
    binding_present: !!env.ANALYTICS,
    window_hours: TELEMETRY_PROBE_HOURS,
    checked_at: now.toISOString(),
    coverage: TELEMETRY_COVERAGE,
  };
  const probe = await probeTelemetry(env, now);
  let lastOk: string | null = null;
  if (probe.answered) {
    lastOk = now.toISOString();
    try { await env.RATE_LIMITS.put(TELEMETRY_LAST_OK_KEY, lastOk); } catch { /* the time is a convenience, not the signal */ }
  } else {
    try { lastOk = (await env.RATE_LIMITS.get(TELEMETRY_LAST_OK_KEY)) || null; } catch { lastOk = null; }
  }
  if (!probe.readable) {
    return {
      ...base, status: 'not_configured', read_configured: false, answered: false, last_event_at: null, events_in_window: null,
      last_successful_read_at: lastOk,
      reason: 'The Analytics Engine read is not configured here (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AE_API_TOKEN), so traffic, latency and errors are unknown, not zero.',
    };
  }
  if (!probe.answered) {
    return {
      ...base, status: 'unavailable', read_configured: true, answered: false, last_event_at: null, events_in_window: null,
      last_successful_read_at: lastOk,
      reason: 'Analytics Engine did not answer the read, so traffic, latency and errors are unknown, not zero.',
    };
  }
  const age = now.getTime() - msOf(probe.last_event_at);
  const stale = probe.last_event_at === null || !(age <= TELEMETRY_STALE_MINUTES * 60_000);
  return {
    ...base,
    status: stale ? 'stale' : 'healthy',
    read_configured: true,
    answered: true,
    last_event_at: probe.last_event_at,
    events_in_window: probe.events_in_window,
    last_successful_read_at: lastOk,
    reason: stale
      ? `Analytics Engine answered, but holds no request row in the last ${TELEMETRY_STALE_MINUTES} minutes; every metered request writes one, so the writes may be failing.`
      : null,
  };
}

// ── Detection ──────────────────────────────────────────────────────────────

type JobsBlock = { available?: boolean; reason?: string; triggers?: { name: string; trigger_name: string; state: string; expected_at: string | null; last_started_at: string | null; error: string | null }[] } | null | undefined;
type CronBlock = { available?: boolean; reason?: string; streaks?: CronStreak[] } | null | undefined;
export type BranchCheck = { code: string; status: string; last_health_at: string | null; last_health_ok: number | null };
export type BranchHealth = { available: false; reason: string } | { available: true; applies: false; reason: string } | { available: true; applies: true; branches: BranchCheck[] };

/**
 * D5370: each live branch's LAST STORED health check (D452), never a fresh fan-out (D110). Deployments writes it when
 * a branch answers, so an unreachable branch keeps its old time and shows up as unchecked.
 */
export async function readBranchHealth(env: Env): Promise<BranchHealth> {
  if (branchOf(env)) return { available: true, applies: false, reason: 'A branch has no branches; HQ checks them.' };
  try {
    const rows = (await env.DB.prepare(`SELECT code, status, last_health_at, last_health_ok FROM licence_deployments
      WHERE status IN (?, ?, ?) ORDER BY code LIMIT 500`).bind(...LIVE_BRANCH_STATES).all<BranchCheck>()).results ?? [];
    return { available: true, applies: true, branches: rows };
  } catch (e) {
    if (/no such table/i.test(String((e as Error)?.message ?? e))) return { available: false, reason: 'The deployments registry is not on this database (migration 258).' };
    throw e;
  }
}

type DlqBlock = { available?: boolean; reason?: string; total?: number | null } | null | undefined;
type WebhookBlock = Awaited<ReturnType<typeof readWebhookHealth>> | { available: false; reason: string } | null | undefined;
type IncidentBlock = { available?: boolean; reason?: string; count?: number | null; window_days?: number } | null | undefined;

export type HealthInput = {
  jobs: JobsBlock;
  cron: CronBlock;
  dlq: DlqBlock;
  webhook: WebhookBlock;
  telemetry: TelemetryHealth | { status?: undefined; available: false; reason: string } | null | undefined;
  published: IncidentBlock;
  /** D5370: the meeting bot's start outcomes, and each live branch's last stored check. */
  meeting_bot: MeetingBotHealth | null | undefined;
  branches: BranchHealth | null | undefined;
  /** Whether Stripe is set up here at all, so a silent webhook is worth noting. */
  stripe_configured: boolean;
  now: Date;
};

const inc = (i: Omit<DetectedIncident, 'remediation'>): DetectedIncident => ({ ...i, remediation: REMEDIATION[i.kind] });

/** The detected incidents for one read, one per key, most severe first. Pure: the same signals give the same list. */
export function detectIncidents(input: HealthInput): { incidents: DetectedIncident[]; unknown: { signal: string; reason: string }[] } {
  const observed = input.now.toISOString();
  const found = new Map<string, DetectedIncident>();
  const unknown: { signal: string; reason: string }[] = [];
  const add = (i: DetectedIncident) => {
    const had = found.get(i.key);
    if (!had || SEVERITY_ORDER.indexOf(i.severity) < SEVERITY_ORDER.indexOf(had.severity)) found.set(i.key, i);
  };

  // Scheduled jobs: the latest run failed, or the expected run never came.
  const jobs = input.jobs;
  if (!jobs || jobs.available === false) unknown.push({ signal: 'Scheduled jobs', reason: jobs?.reason || 'The scheduled-run history was not reported.' });
  else {
    const streaks = new Map((input.cron?.available !== false ? input.cron?.streaks ?? [] : []).map((s) => [s.trigger_name, s]));
    if (input.cron?.available === false) unknown.push({ signal: 'Repeated job failures', reason: input.cron.reason || 'Not reported.' });
    for (const t of jobs.triggers ?? []) {
      if (t.state === 'failed') {
        const s = streaks.get(t.trigger_name);
        // The latest run failed, so the streak is at least one even if the streak read raced it.
        const n = Math.max(1, s?.consecutive_failures ?? 1);
        add(inc({
          key: `cron:${t.trigger_name}`, kind: 'cron', severity: n >= CRON_FAILURE_STREAK ? 'high' : 'medium',
          title: `${t.name} failed${n > 1 ? ` ${n} runs in a row` : ''}`,
          detail: t.error ? `Latest error: ${String(t.error).slice(0, 200)}` : 'The latest run recorded a failure.',
          since: s?.first_failed_at ?? t.last_started_at ?? null, observed_at: observed,
        }));
      } else if (t.state === 'stale') {
        add(inc({
          key: `cron:${t.trigger_name}`, kind: 'cron', severity: 'high', title: `${t.name} did not run when expected`,
          detail: `A run was due by ${t.expected_at ?? 'its schedule'} and none was recorded.`,
          since: t.expected_at ?? null, observed_at: observed,
        }));
      }
    }
  }

  // Stripe webhook: a run of refused deliveries, or a long silence.
  const wh = input.webhook;
  if (!wh || wh.available === false) unknown.push({ signal: 'Stripe webhook', reason: (wh as { reason?: string } | null)?.reason || 'The webhook deliveries were not reported.' });
  else {
    const n = wh.consecutive_failures;
    if (n >= WEBHOOK_FAILURE_STREAK) {
      add(inc({
        key: 'webhook:failures', kind: 'webhook', severity: n >= WEBHOOK_FAILURE_CRITICAL ? 'critical' : 'high',
        title: `The Stripe webhook refused ${wh.streak_at_least ? `at least ${n}` : n} deliveries in a row`,
        detail: `Last success ${wh.last_success_at ?? 'not recorded'}. Stripe retries a refused event, but payments and renewals are not being recorded while this lasts.`,
        since: wh.streak_started_at, observed_at: observed,
      }));
    } else if (input.stripe_configured) {
      const last = msOf(wh.last_delivery_at);
      const silentFor = Number.isNaN(last) ? Infinity : input.now.getTime() - last;
      if (silentFor > WEBHOOK_SILENCE_HOURS * 3_600_000) {
        add(inc({
          key: 'webhook:silence', kind: 'webhook', severity: 'low',
          title: wh.last_delivery_at ? `No Stripe webhook delivery in ${WEBHOOK_SILENCE_HOURS} hours` : 'No Stripe webhook delivery has ever been logged',
          detail: 'A quiet store can be legitimate; an endpoint that is not registered, or a signing secret that changed, looks the same.',
          since: wh.last_delivery_at, observed_at: observed,
        }));
      }
    }
  }

  // Dead letters waiting.
  const dlq = input.dlq;
  if (!dlq || dlq.available === false) unknown.push({ signal: 'Dead letters', reason: dlq?.reason || 'The dead-letter backlog was not reported.' });
  else if (typeof dlq.total === 'number' && dlq.total > 0) {
    add(inc({
      key: 'dlq:backlog', kind: 'dlq', severity: dlq.total >= DLQ_HIGH ? 'high' : 'medium',
      title: `${dlq.total} dead ${dlq.total === 1 ? 'letter is' : 'letters are'} waiting`,
      detail: 'A message that exhausted its retries. Growth over time is not stored, so this is the backlog now.',
      since: null, observed_at: observed,
    }));
  } else if (dlq.total === null || dlq.total === undefined) unknown.push({ signal: 'Dead letters', reason: 'The backlog count could not be read.' });

  // Telemetry itself.
  const tel = input.telemetry;
  if (!tel || !tel.status) {
    add(inc({ key: 'telemetry:unavailable', kind: 'telemetry', severity: 'high', title: 'Telemetry health was not reported', detail: (tel as { reason?: string } | null)?.reason || 'The probe did not answer.', since: null, observed_at: observed }));
  } else if (tel.status === 'not_configured' || tel.status === 'unavailable') {
    add(inc({
      key: 'telemetry:unavailable', kind: 'telemetry', severity: 'high',
      title: tel.status === 'not_configured' ? 'Telemetry cannot be read: the read is not configured' : 'Telemetry cannot be read: Analytics Engine did not answer',
      detail: `${tel.reason ?? ''} Last successful read ${tel.last_successful_read_at ?? 'not recorded'}.`.trim(),
      since: tel.last_successful_read_at, observed_at: observed,
    }));
  } else if (tel.status === 'stale') {
    add(inc({ key: 'telemetry:stale', kind: 'telemetry', severity: 'medium', title: 'Telemetry is stale', detail: tel.reason ?? '', since: tel.last_event_at, observed_at: observed }));
  }

  // D5370 — the meeting bot's starts. A failed check and a report that never arrived are different incidents.
  const bot = input.meeting_bot;
  if (!bot || bot.available === false) unknown.push({ signal: 'Meeting bot starts', reason: (bot as { reason?: string } | null)?.reason || 'The meeting bot\'s start outcomes were not reported.' });
  else if (bot.applies && bot.latest && bot.latest.outcome !== 'started') {
    const n = bot.consecutive_failures;
    const many = n >= BOT_START_FAILURE_STREAK;
    const inRow = n > 1 ? ` ${bot.streak_at_least ? `at least ${n}` : n} times in a row` : '';
    if (bot.latest.outcome === 'check_failed') {
      const preflight = !!bot.latest.code && PREFLIGHT_CODES.has(bot.latest.code);
      add(inc({
        key: 'meeting_bot:start_failed', kind: 'meeting_bot', severity: many || preflight ? 'high' : 'medium',
        title: preflight ? `The meeting bot's readiness preflight failed${inRow}` : `The meeting bot failed to start${inRow}`,
        detail: `Latest: ${bot.latest.code} at ${bot.latest.stage ?? 'an unrecorded stage'}, ${bot.latest.at}. The meeting provider was not contacted.`,
        since: bot.streak_started_at, observed_at: observed,
      }));
    } else {
      add(inc({
        key: 'meeting_bot:unreported', kind: 'meeting_bot', severity: many ? 'high' : 'medium',
        title: `A meeting bot start never reported back${inRow}`,
        detail: `Latest: ${bot.latest.failure_code ?? 'failed'} at ${bot.latest.at}, with no startup code and no callback from the runtime. This is a missing report, not a failed check.`,
        since: bot.streak_started_at, observed_at: observed,
      }));
    }
  }

  // D5370 — each live branch's last stored check (D452); the fan-out stays in Deployments (D110).
  const br = input.branches;
  if (!br || br.available === false) unknown.push({ signal: 'Branch health', reason: (br as { reason?: string } | null)?.reason || 'The deployments registry was not reported.' });
  else if (br.applies) {
    for (const b of br.branches) {
      const at = msOf(b.last_health_at);
      if (b.last_health_ok === 0) {
        add(inc({
          key: `branch:${b.code}`, kind: 'branch', severity: 'medium', title: `Branch ${b.code} reported unhealthy at its last check`,
          detail: `Checked ${b.last_health_at ?? 'at an unrecorded time'} by Deployments. Open Deployments to ask it again.`,
          since: b.last_health_at, observed_at: observed,
        }));
      } else if (Number.isNaN(at) || input.now.getTime() - at > BRANCH_CHECK_STALE_HOURS * 3_600_000) {
        add(inc({
          key: `branch:${b.code}`, kind: 'branch', severity: 'low',
          title: b.last_health_at ? `Branch ${b.code} has not been checked in ${BRANCH_CHECK_STALE_HOURS} hours` : `Branch ${b.code} has never answered a health check`,
          detail: 'Only Deployments asks a branch, and it stores the answer only when the branch replies. A branch that is down looks the same as one nobody checked.',
          since: b.last_health_at, observed_at: observed,
        }));
      }
    }
  }

  const incidents = [...found.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.key.localeCompare(b.key));
  return { incidents, unknown };
}

/** One state for the platform: critical > degraded > unknown > healthy. Low-severity notes do not degrade it. */
export function healthStateOf(incidents: DetectedIncident[], unknown: unknown[]): HealthState {
  if (incidents.some((i) => i.severity === 'critical')) return 'critical';
  if (incidents.some((i) => i.severity === 'high' || i.severity === 'medium')) return 'degraded';
  if (unknown.length > 0) return 'unknown';
  return 'healthy';
}

/** Always true on main: the diagnostic is an owner's on-demand check, kept in R2 per run with no index (#3708). */
export const NOT_DETECTED = [
  { signal: 'Meeting bot staged diagnostics', reason: 'A diagnostic is a check the owner starts, kept per run in R2 with no index, so it is not read here. Its Not recorded stages show on Meeting bots.' },
];

/** What is not detected on this read: the fixed list, plus any signal that does not apply here, with its own reason. */
export function notDetected(input: Pick<HealthInput, 'meeting_bot' | 'branches'>) {
  const out: { signal: string; reason: string }[] = [...NOT_DETECTED];
  if (input.meeting_bot && input.meeting_bot.available && !input.meeting_bot.applies) out.push({ signal: 'Meeting bot starts', reason: input.meeting_bot.reason });
  if (input.branches && input.branches.available && !input.branches.applies) out.push({ signal: 'Branch health', reason: input.branches.reason });
  return out;
}

export const PUBLISHED_NOTE = 'Published incidents are entered by hand on the status page. They are counted here apart from what the platform detects, and never raise or clear its state.';

/** The health block: state, detected incidents, what could not be judged, the published count kept apart, and telemetry. */
export function buildHealth(input: HealthInput) {
  const { incidents, unknown } = detectIncidents(input);
  const published = input.published;
  return {
    state: healthStateOf(incidents, unknown),
    observed_at: input.now.toISOString(),
    detected: incidents,
    unknown,
    not_detected: notDetected(input),
    published: published && published.available !== false
      ? { available: true as const, count: published.count ?? null, window_days: published.window_days ?? null, manual: true as const, note: PUBLISHED_NOTE }
      : { available: false as const, reason: published?.reason || 'The published incident count was not reported.', manual: true as const, note: PUBLISHED_NOTE },
    telemetry: input.telemetry && (input.telemetry as TelemetryHealth).status ? input.telemetry : null,
    /** The webhook's streak and last success and failure, for the Payments panel's health row. */
    webhook: input.webhook ?? null,
    thresholds: {
      cron_failure_streak: CRON_FAILURE_STREAK, webhook_failure_streak: WEBHOOK_FAILURE_STREAK, webhook_failure_critical: WEBHOOK_FAILURE_CRITICAL,
      webhook_silence_hours: WEBHOOK_SILENCE_HOURS, dlq_high: DLQ_HIGH, telemetry_stale_minutes: TELEMETRY_STALE_MINUTES,
      bot_start_failure_streak: BOT_START_FAILURE_STREAK, branch_check_stale_hours: BRANCH_CHECK_STALE_HOURS,
    },
  };
}
