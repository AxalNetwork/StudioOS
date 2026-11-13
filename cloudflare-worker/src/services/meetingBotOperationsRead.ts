/** D886 B10: the canonical B1 read. No link, roster, transcript or event payload is selected. */
import type { Env } from '../types';
import { BOT_HEARTBEAT_MS } from './meetingBots';
import { branchOf } from '../util/branch';
import { meetingBotOperations, projectBotOperationsRun, type BotOperationsRun, type BotPlatform, type BotStatus } from './meetingBotOperations';
import { RUNTIME_ACTION, runtimeErrorCode, runtimeStage, runtimeVersion } from './meetingBotStartup';

const DAY = 86_400_000;
const PAGE = 500;
type RunReading = {
  uid: string; platform: BotPlatform; status: BotStatus; failure_code: string | null;
  created_at: number; started_at: number | null; ended_at: number | null; heartbeat_at: number | null;
  billed_bot_minutes: number | null; recorded_minutes: number | null; audio_charged_microusd: number | null;
  ledger_status: string | null; actual_included_microusd: number | null; actual_topup_microusd: number | null;
};

export async function readMeetingBotOperations(env: Env, now = Date.now()) {
  const unavailable = (state: 'not_recorded' | 'unreadable') => meetingBotOperations({ state }, now);
  if (branchOf(env)) return unavailable('not_recorded');
  try {
    const exists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meeting_bots'").first();
    if (!exists) return unavailable('not_recorded');
    const runs: BotOperationsRun[] = [];
    let cursor = '';
    // Keyset pages, never a LIMIT silently treated as the entire cohort. Old
    // active runs and recently ended old runs must still reach alert policy.
    for (;;) {
      const result = await env.DB.prepare(`WITH session_run_counts AS (SELECT session_id,COUNT(*) AS runs FROM meeting_bots GROUP BY session_id)
        SELECT b.uid,b.platform,b.status,b.failure_code,b.created_at,b.started_at,b.ended_at,b.heartbeat_at,b.minutes AS billed_bot_minutes,
        CASE WHEN sc.runs=1 THEN
          (SELECT audio_minutes FROM interview_session_receipts a WHERE a.session_id=b.session_id AND a.kind='final' AND a.outcome='ok'
            AND a.created_at>=datetime(b.created_at/1000,'unixepoch') ORDER BY a.id DESC LIMIT 1) ELSE NULL END AS recorded_minutes,
        CASE WHEN sc.runs=1 THEN
          (SELECT CASE WHEN COUNT(*)>0 AND SUM(CASE WHEN l.charged_microusd IS NOT NULL AND (
              (l.charged_microusd=0 AND l.reservation_uid IS NULL) OR
              (sr.status IN ('settled','refunded') AND sr.actual_included_microusd+sr.actual_topup_microusd>=l.charged_microusd)) THEN 1 ELSE 0 END)=COUNT(*)
            AND COUNT(sr.uid)=COUNT(DISTINCT sr.uid) THEN SUM(CASE WHEN l.reservation_uid IS NULL THEN l.charged_microusd ELSE sr.actual_included_microusd+sr.actual_topup_microusd END) ELSE NULL END
          FROM ai_usage_logs l LEFT JOIN ai_budget_reservations sr ON sr.uid=l.reservation_uid AND sr.user_id=b.user_id
          WHERE l.user_id=b.user_id AND l.task='transcribe' AND l.record_ref='session:' || b.session_id
            AND l.created_at>=datetime(b.created_at/1000,'unixepoch')) ELSE NULL END AS audio_charged_microusd,
        CASE WHEN COUNT(r.uid)>0 AND SUM(CASE WHEN r.status IN ('settled','refunded') AND r.actual_included_microusd IS NOT NULL AND r.actual_topup_microusd IS NOT NULL THEN 1 ELSE 0 END)=COUNT(r.uid)
          THEN 'settled' ELSE NULL END AS ledger_status,
        SUM(r.actual_included_microusd) AS actual_included_microusd,SUM(r.actual_topup_microusd) AS actual_topup_microusd
        FROM meeting_bots b JOIN session_run_counts sc ON sc.session_id=b.session_id LEFT JOIN ai_budget_reservations r ON r.user_id=b.user_id AND substr(r.idempotency_key,1,length(b.uid)+13)='meeting-bot:' || b.uid || ':'
        WHERE b.uid > ? AND (b.created_at >= ? OR b.ended_at >= ? OR b.status NOT IN ('done','failed','stopped'))
        GROUP BY b.uid ORDER BY b.uid LIMIT ?`).bind(cursor, now - 30 * DAY, now - 7 * DAY, PAGE).all<RunReading>();
      if ((result.success as unknown) === false || !Array.isArray(result.results)) return unavailable('unreadable');
      for (const row of result.results) {
        // Canonical receipts and settled aiRouter reservations identify STT.
        // A reused session cannot attribute its audio to one run safely.
        // Supplier cost has no measured store; quoted rates stay separate.
        runs.push({ ...projectBotOperationsRun(row, {
          recorded_minutes: row.recorded_minutes, provider_cost_microusd: null,
          reservation: row.ledger_status === null ? null : { status: row.ledger_status,
            actual_included_microusd: row.actual_included_microusd, actual_topup_microusd: row.actual_topup_microusd },
        }, 2 * BOT_HEARTBEAT_MS), billed_bot_minutes: row.billed_bot_minutes, audio_charged_microusd: row.audio_charged_microusd });
      }
      if (result.results.length < PAGE) break;
      const next = result.results.at(-1)!.uid;
      if (next <= cursor) return unavailable('unreadable');
      cursor = next;
    }
    return meetingBotOperations({ state: 'ok', runs }, now);
  } catch { return unavailable('unreadable'); }
}

export function meetingBotPricePolicy() {
  return {
    state: 'ceiling' as const,
    bot_per_minute_microusd: 2790,
    supplier_per_minute_microusd: 2231.6,
    target_markup_bps: 2500,
    target_gross_margin_bps: 2000,
    note: 'Canary ceiling from D886. Measured supplier cost is not recorded here. Transcription is billed separately through AI tokens.',
    audio_note: 'Audio uses successful final transcription receipts; its AI-token charge uses settled aiRouter reservations. Missing or ambiguous attribution remains Not recorded.',
  };
}

/** D5153: how many failed runs HQ lists, newest first, from the last 30 days. */
export const RECENT_FAILED_RUNS = 20;
const CODE = /^[a-z_]{1,40}$/;
const DETAIL = /^[a-z_]{1,40}(@[a-z_]{1,40}(:[a-z_]{1,20})?)?$/;
const PLATFORMS = new Set(['zoom', 'google_meet', 'teams']);
type FailedRow = {
  uid: string; platform: string; status: string; failure_code: string | null; failure_detail: string | null;
  created_at: number; started_at: number | null; ended_at: number | null;
  runtime_stage?: string | null; runtime_error_code?: string | null; runtime_version?: string | null;
  runtime_start_ms?: number | null; runtime_callback_seen_at?: number | null;
};
const iso = (ms: number | null) => typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

/** HQ's next step for one failed run, from its codes alone. */
export function recentRunAction(run: { runtime_error_code: string | null; callback_received: boolean | null; failure_code: string | null; failure_detail: string | null }) {
  const code = runtimeErrorCode(run.runtime_error_code);
  if (code) return RUNTIME_ACTION[code];
  if (run.callback_received === null) return 'Startup facts are not recorded for this run (it predates D5153). Run the staged diagnostic against a meeting you host.';
  if (!run.callback_received) return 'The runtime never reported back and no startup code was recorded (an older meeting-bot host). Redeploy the meeting-bot Worker, then run the staged diagnostic.';
  if (run.failure_detail) return 'The runtime reached the meeting provider. Read the failure detail, then run the staged diagnostic for a screenshot of where it stopped.';
  return 'The runtime reached the meeting provider but recorded no detail. Run the staged diagnostic against a meeting you host.';
}

/**
 * D5153 (#5153): the most recent failed runs, one row each, for HQ · Meeting bots.
 * Codes, stages, versions and times only: never the link (encrypted or not),
 * names, roster, transcript, event payloads or provider text. A database
 * before migration 202611090953 still answers, with the startup facts null
 * and `callback_received: null` ("not recorded"), never false.
 */
export async function readRecentBotFailures(env: Env, now = Date.now()) {
  if (branchOf(env)) return { state: 'not_recorded' as const, runs: [] };
  const since = now - 30 * DAY;
  let rows: FailedRow[]; let startup = true;
  try {
    const exists = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meeting_bots'").first();
    if (!exists) return { state: 'not_recorded' as const, runs: [] };
    try {
      rows = (await env.DB.prepare(`SELECT uid, platform, status, failure_code, failure_detail, created_at, started_at, ended_at,
        runtime_stage, runtime_error_code, runtime_version, runtime_start_ms, runtime_callback_seen_at
        FROM meeting_bots WHERE status = 'failed' AND created_at >= ? ORDER BY created_at DESC, uid DESC LIMIT ?`)
        .bind(since, RECENT_FAILED_RUNS).all<FailedRow>()).results ?? [];
    } catch (e) {
      if (!/no such column/i.test(String((e as Error)?.message ?? e))) throw e;
      // Before migration 202611090953: the same runs, without startup facts.
      startup = false;
      rows = (await env.DB.prepare(`SELECT uid, platform, status, failure_code, failure_detail, created_at, started_at, ended_at
        FROM meeting_bots WHERE status = 'failed' AND created_at >= ? ORDER BY created_at DESC, uid DESC LIMIT ?`)
        .bind(since, RECENT_FAILED_RUNS).all<FailedRow>()).results ?? [];
    }
  } catch { return { state: 'unreadable' as const, runs: [] }; }
  return { state: 'ok' as const, runs: rows.filter((r) => PLATFORMS.has(r.platform)).map((r) => {
    const failure_detail = typeof r.failure_detail === 'string' && DETAIL.test(r.failure_detail) ? r.failure_detail : null;
    const callback_received = startup ? r.runtime_callback_seen_at !== null && r.runtime_callback_seen_at !== undefined : null;
    const runtime_error_code = startup ? runtimeErrorCode(r.runtime_error_code) : null;
    const failure_code = typeof r.failure_code === 'string' && CODE.test(r.failure_code) ? r.failure_code : null;
    const from = r.started_at ?? r.created_at;
    return {
      uid: r.uid, platform: r.platform as BotPlatform, status: r.status as BotStatus, failure_code, failure_detail,
      runtime_stage: startup ? runtimeStage(r.runtime_stage) : null, runtime_error_code,
      runtime_version: startup ? runtimeVersion(r.runtime_version) : null,
      runtime_start_ms: startup && typeof r.runtime_start_ms === 'number' && Number.isSafeInteger(r.runtime_start_ms) && r.runtime_start_ms >= 0 ? r.runtime_start_ms : null,
      callback_received,
      created_at: iso(r.created_at), started_at: iso(r.started_at), ended_at: iso(r.ended_at),
      elapsed_ms: typeof r.ended_at === 'number' && typeof from === 'number' && r.ended_at >= from ? r.ended_at - from : null,
      action: recentRunAction({ runtime_error_code, callback_received, failure_code, failure_detail }),
    };
  }) };
}
