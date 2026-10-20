/**
 * A branch reports its own quarter to HQ every morning (D266).
 *
 * `reportUsage` was the statement ledger's only designed input and nothing
 * called it, so `subsidiary_usage_reports` was never written and every
 * statement HQ drew said the branch "has not reported". That sentence was
 * true, and it was the wrong one: a branch CAN say what it measured — which
 * today is that every stream is unmeasured (`branchRevenueSummary` in
 * rpc/branchOps.ts says why, stream by stream). This module is the call.
 *
 * WHAT CHANGES FOR HQ. A statement for a branch that has reported reads
 * "reported, unmeasurable" instead of "not reported". That is a truer state,
 * not a fuller one: no figure appears, and none is invented. The token
 * stream's COST travels in `estimate_basis`, which HQ already stores and
 * already refuses to sum as revenue.
 *
 * WHAT DOES NOT TRAVEL, stated so nobody looks for it. Each stream's `reason`
 * sentence is sent and dropped: migration 260 has no column for it, and HQ's
 * statement draw writes its own reason for a reported NULL stream from the
 * stored `estimate_basis`, or a generic "reported as unmeasurable".
 *
 * TWO QUARTERS, NOT ONE. A run on 1 October reports Q4, which has barely
 * started, and Q3, which has just closed — so the last figure a quarter gets
 * is the one reported after it ends. `reportUsage` upserts on
 * (licence_uid, period, stream), so re-reporting a quarter replaces its rows
 * rather than adding to them.
 *
 * THE ORDER IS THE POLICY, as in `pullLicenceCopy` (routes/licence.ts), and
 * for the same reasons: only a branch reports; no `RPC_SECRET` refuses before
 * anything, because HQ refuses a report that does not carry it; no HQ
 * binding, likewise. Only then is HQ called, under a deadline, once per
 * quarter.
 *
 * A FAILED PUSH NEVER THROWS. It runs from the scheduled handler, and a throw
 * there would cost only its own block — but the result is also what a test
 * reads, and a refusal is a sentence, not an exception. The one throw left is
 * `branchOf`'s on a malformed BRANCH_CODE, which is deliberate everywhere
 * (util/branch.ts).
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { withDeadline, DeadlineExceeded } from '../util/deadline';
import { branchRevenueSummary } from '../rpc/branchOps';
import type { UsageFigure } from '../rpc/hqOps';
import { quarterKey } from './statements';

/** How long HQ gets to answer one quarter's report. */
export const USAGE_REPORT_DEADLINE_MS = 5000;

export type UsagePeriodOutcome = {
  period: string;
  sent: boolean;
  streams?: number;
  reason?: string;
};

export type UsagePushResult = {
  sent: boolean;
  reason?: string;
  periods: UsagePeriodOutcome[];
};

/**
 * The previous quarter and the current one, oldest first. The previous is the
 * day before the current quarter's first day, so 1 January reports the year
 * before's Q4 rather than a Q0.
 */
export function reportPeriods(now: Date): [string, string] {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3);
  const previous = new Date(Date.UTC(y, q * 3, 1) - 24 * 3600 * 1000);
  return [quarterKey(previous), quarterKey(now)];
}

type HqReport = {
  reportUsage?: (
    callerCode: string, rpcSecret: string, period: string, figures: UsageFigure[],
  ) => Promise<unknown>;
};

export async function pushUsageReport(
  env: Env, now: Date = new Date(), deadlineMs: number = USAGE_REPORT_DEADLINE_MS,
): Promise<UsagePushResult> {
  const code = branchOf(env);
  if (!code) {
    return {
      sent: false, periods: [],
      reason: 'HQ keeps the statements ledger itself; only a branch reports its usage to it.',
    };
  }
  const secret = String(env.RPC_SECRET ?? '').trim();
  if (!secret) {
    return {
      sent: false, periods: [],
      reason:
        'No report was sent: this branch has no RPC_SECRET, and HQ accepts a usage report only '
        + 'when it carries it. branch-provision.yml sets it — re-run it for this code, or set the '
        + 'secret the provisioning run generated.',
    };
  }
  // A LOCAL ALIAS, NOT `env.HQ.reportUsage(…)` INLINE. The call harvest in
  // scripts/lib/rpcSurface.mjs recognises this form, which is how the RPC
  // surface table (services/topology.ts) and its guard know `reportUsage` has
  // a caller at all.
  const hq = (env as { HQ?: HqReport }).HQ;
  if (!hq || typeof hq.reportUsage !== 'function') {
    return {
      sent: false, periods: [],
      reason:
        'No report was sent: this deployment has no HQ service binding, so it cannot report its '
        + 'usage. HQ\'s statements go on saying this branch has not reported.',
    };
  }

  const periods: UsagePeriodOutcome[] = [];
  for (const period of reportPeriods(now)) {
    let figures: UsageFigure[];
    try {
      const summary = await branchRevenueSummary(env, period);
      figures = summary.streams.map((s) => ({
        stream: s.stream,
        gross_cents: s.gross_cents,
        currency: s.currency,
        available: s.available,
        ...(s.is_estimate ? { is_estimate: true } : {}),
        ...(s.estimate_basis ? { estimate_basis: s.estimate_basis } : {}),
        ...(s.reason ? { reason: s.reason } : {}),
      }));
    } catch (e) {
      periods.push({
        period, sent: false,
        reason: `This branch could not assemble its report for ${period}: ${(e as Error).message}`,
      });
      continue;
    }
    try {
      const answer = await withDeadline(
        hq.reportUsage(code, secret, period, figures), deadlineMs, 'usage-report',
      );
      const streams = answer && typeof answer === 'object'
        ? Number((answer as { streams?: unknown }).streams)
        : NaN;
      periods.push({
        period, sent: true,
        ...(Number.isFinite(streams) ? { streams } : {}),
      });
    } catch (e) {
      periods.push({
        period, sent: false,
        reason: e instanceof DeadlineExceeded
          ? `HQ did not answer the ${period} report within ${deadlineMs / 1000} seconds.`
          : `HQ did not accept the ${period} report: ${(e as Error).message}`,
      });
    }
  }

  const sent = periods.length > 0 && periods.every((p) => p.sent);
  return sent ? { sent, periods } : { sent, periods, reason: periods.find((p) => !p.sent)?.reason };
}

/** D808 — how often an Administrator's Send now may call HQ: once per five minutes, as a licence pull. */
export const SEND_NOW_WINDOW_SECONDS = 300;
const SEND_NOW_KV_DEADLINE_MS = 2_000;
const sendNowKey = (code: string) => `usage_send_now:${code}`;

export type SendNowResult = UsagePushResult & { called: boolean; retry_after?: string };

/**
 * D808 — the Administrator's Send now: the same push the 05:10 run makes
 * (`pushUsageReport`), on demand, at most once per `SEND_NOW_WINDOW_SECONDS`
 * per branch through `RATE_LIMITS`. A missing or unreadable throttle store
 * refuses, as the licence pull does: an unlimited button is two calls to HQ
 * per press. The window is recorded before HQ is called, so a slow push cannot
 * be pressed twice.
 */
export async function sendUsageReportNow(env: Env, now: Date = new Date()): Promise<SendNowResult> {
  const code = branchOf(env);
  if (!code) return { called: false, sent: false, periods: [], reason: 'HQ keeps the statements ledger itself; only a branch sends its usage report.' };
  const kv = env.RATE_LIMITS;
  if (!kv) {
    return {
      called: false, sent: false, periods: [],
      reason: 'No report was sent: the store that limits how often this branch may call HQ (RATE_LIMITS) is not bound here.',
    };
  }
  let prior: string | null;
  try {
    prior = await withDeadline(kv.get(sendNowKey(code)), SEND_NOW_KV_DEADLINE_MS, 'usage-send-now-get');
  } catch (e) {
    console.warn('[usage] send-now throttle unreadable', (e as Error).message);
    return {
      called: false, sent: false, periods: [],
      reason: 'No report was sent: the record of the last Send now could not be read, so the presses cannot be limited. Try again in a moment.',
    };
  }
  if (prior) {
    let until: string | undefined;
    try { const v = JSON.parse(prior); if (typeof v?.until === 'string') until = v.until; } catch { /* still "wait" */ }
    return {
      called: false, sent: false, periods: [],
      reason: `A report was sent in the last ${SEND_NOW_WINDOW_SECONDS / 60} minutes. This branch sends one at most every ${SEND_NOW_WINDOW_SECONDS / 60} minutes; the daily report also runs at 05:10 UTC.`,
      ...(until ? { retry_after: until } : {}),
    };
  }
  const until = new Date(now.getTime() + SEND_NOW_WINDOW_SECONDS * 1000).toISOString();
  try {
    await withDeadline(
      kv.put(sendNowKey(code), JSON.stringify({ at: now.toISOString(), until }), { expirationTtl: SEND_NOW_WINDOW_SECONDS }),
      SEND_NOW_KV_DEADLINE_MS, 'usage-send-now-put',
    );
  } catch (e) {
    console.warn('[usage] send-now throttle unwritable', (e as Error).message);
    return {
      called: false, sent: false, periods: [],
      reason: 'No report was sent: the press could not be recorded, so it cannot be limited. Try again in a moment.',
    };
  }
  const r = await pushUsageReport(env, now);
  return { ...r, called: true };
}
