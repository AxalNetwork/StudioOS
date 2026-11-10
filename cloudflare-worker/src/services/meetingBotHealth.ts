/**
 * D5370 (#5370): the meeting bot's start outcomes, read for Platform health's detected incidents.
 *
 * The bot is deployed (#3588) and D5153 keeps each run's startup facts on its `meeting_bots` row. This reads the
 * latest few runs that reached a start outcome, newest first, and says how many failed to start in a row. It reads
 * only codes, stages and times: never a link, name, roster, transcript or provider text. It adds no store.
 *
 * Two kinds of start failure stay apart (D4857's rule): a FAILED CHECK, where the host or runtime answered with a
 * startup code from D5153's closed list, and a report that NEVER ARRIVED, where the run failed with
 * `runtime_unavailable` or `heartbeat_timeout`, the runtime never called back and no code was recorded (a host that
 * crashed mid-reply, or an older host). The readiness preflight is the host's `/healthz` wait, so a failed preflight
 * is one of its three codes (`PREFLIGHT_CODES`).
 *
 * Missing is never healthy: a database without the table or without D5153's columns answers `available: false`,
 * which Platform health lists as unknown. A deployment where the bot is off, or a branch (D886: HQ only), answers
 * `applies: false`, which Platform health lists as not detected, with that reason.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { botEnabled } from './meetingBots';
import { runtimeErrorCode, runtimeStage, type MeetingBotRuntimeStage, type RuntimeErrorCode } from './meetingBotStartup';

/** How many start outcomes are read, newest first. */
export const BOT_START_READ = 10;
/** Only runs created this recently count: an old failure says nothing about the bot now. */
export const BOT_START_WINDOW_HOURS = 7 * 24;
/** Failed starts in a row that make the incident high. */
export const BOT_START_FAILURE_STREAK = 3;
/** The startup codes the readiness preflight (port and `/healthz` wait) ends with. */
export const PREFLIGHT_CODES: ReadonlySet<RuntimeErrorCode> = new Set(['runtime_no_answer', 'runtime_process_exited', 'runtime_health_failed']);

export type StartOutcome = 'started' | 'check_failed' | 'unreported';
type Row = { status: string; failure_code: string | null; runtime_stage: string | null; runtime_error_code: string | null; runtime_callback_seen_at: number | null; created_at: number };

export type MeetingBotHealth =
  | { available: false; reason: string }
  | { available: true; applies: false; reason: string }
  | {
    available: true; applies: true;
    /** How many start outcomes were read (at most BOT_START_READ). */
    outcomes_read: number;
    window_hours: number;
    /** The newest outcome; null when no run reached one in the window. */
    latest: null | { outcome: StartOutcome; code: RuntimeErrorCode | null; stage: MeetingBotRuntimeStage | null; failure_code: string | null; at: string };
    /** Start failures in a row, newest first, of either kind. */
    consecutive_failures: number;
    /** True when every outcome read failed, so the streak may be longer than BOT_START_READ. */
    streak_at_least: boolean;
    /** When the oldest failure of the streak was created. */
    streak_started_at: string | null;
  };

const CODE = /^[a-z_]{1,40}$/;

/** A run's start outcome from its own codes; null for a run that has not reached one (still queued, or stopped first). */
export function startOutcome(r: Row): StartOutcome | null {
  if (r.status === 'queued') return null;
  const called = r.runtime_callback_seen_at !== null && r.runtime_callback_seen_at !== undefined;
  if (r.status === 'failed') {
    if (runtimeErrorCode(r.runtime_error_code)) return 'check_failed';
    if (!called && (r.failure_code === 'runtime_unavailable' || r.failure_code === 'heartbeat_timeout')) return 'unreported';
    // It failed after the runtime started (the provider refused, the host left): the start itself worked.
    return 'started';
  }
  if (r.status === 'stopped') return called || runtimeStage(r.runtime_stage) === 'runtime_command_accepted' ? 'started' : null;
  return 'started';
}

export async function readMeetingBotHealth(env: Env, now: Date = new Date()): Promise<MeetingBotHealth> {
  if (branchOf(env)) return { available: true, applies: false, reason: 'A branch runs no meeting bot; HQ does (D886).' };
  if (!botEnabled(env)) return { available: true, applies: false, reason: 'MEETING_BOT is off on this deployment, so no run starts.' };
  const exists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meeting_bots'").first();
  if (!exists) return { available: false, reason: 'The meeting_bots table is not on this database (migration 531).' };
  let rows: Row[];
  try {
    // Over-read: queued and early-stopped runs have no outcome and are skipped, so read a few more than kept.
    rows = (await env.DB.prepare(`SELECT status, failure_code, runtime_stage, runtime_error_code, runtime_callback_seen_at, created_at
      FROM meeting_bots WHERE created_at >= ? ORDER BY created_at DESC, uid DESC LIMIT ?`)
      .bind(now.getTime() - BOT_START_WINDOW_HOURS * 3_600_000, BOT_START_READ * 3).all<Row>()).results ?? [];
  } catch (e) {
    if (/no such column/i.test(String((e as Error)?.message ?? e))) {
      return { available: false, reason: 'The startup facts are not recorded on this database (migration 202611090953 is not applied).' };
    }
    throw e;
  }
  const outcomes = rows.map((r) => ({ r, o: startOutcome(r) })).filter((x): x is { r: Row; o: StartOutcome } => x.o !== null).slice(0, BOT_START_READ);
  let n = 0;
  while (n < outcomes.length && outcomes[n].o !== 'started') n += 1;
  const iso = (ms: number) => new Date(ms).toISOString();
  const first = outcomes[0];
  return {
    available: true, applies: true,
    outcomes_read: outcomes.length,
    window_hours: BOT_START_WINDOW_HOURS,
    latest: first ? {
      outcome: first.o,
      code: runtimeErrorCode(first.r.runtime_error_code),
      stage: runtimeStage(first.r.runtime_stage),
      failure_code: typeof first.r.failure_code === 'string' && CODE.test(first.r.failure_code) ? first.r.failure_code : null,
      at: iso(first.r.created_at),
    } : null,
    consecutive_failures: n,
    streak_at_least: n > 0 && n === outcomes.length && outcomes.length === BOT_START_READ,
    streak_started_at: n > 0 ? iso(outcomes[n - 1].r.created_at) : null,
  };
}
