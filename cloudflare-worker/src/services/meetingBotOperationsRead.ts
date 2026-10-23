/** D886 B10: the canonical B1 read. No link, roster, transcript or event payload is selected. */
import type { Env } from '../types';
import { BOT_HEARTBEAT_MS } from './meetingBots';
import { branchOf } from '../util/branch';
import { meetingBotOperations, projectBotOperationsRun, type BotOperationsRun, type BotPlatform, type BotStatus } from './meetingBotOperations';

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
              (sr.status IN ('settled','refunded') AND sr.actual_included_microusd+sr.actual_topup_microusd=l.charged_microusd)) THEN 1 ELSE 0 END)=COUNT(*)
            AND COUNT(sr.uid)=COUNT(DISTINCT sr.uid) THEN SUM(l.charged_microusd) ELSE NULL END
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
