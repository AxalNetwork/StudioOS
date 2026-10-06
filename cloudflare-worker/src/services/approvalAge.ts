/**
 * D483 — HOW LONG A DECISION TAKES, READ ONCE FOR BOTH TIERS.
 *
 * A branch's Analytics page (S15, `routes/branch_insights.ts`) has timed its
 * referral decisions since D210. HQ's (H15) said "not recorded" for the same
 * figure, because each branch's queue lives on that branch's database and no
 * branch sent a decision time to HQ. Now each branch answers `approvalAges()`
 * over RPC (`rpc/branchOps.ts`) by calling the same read its own page uses,
 * so the figure HQ prints for a branch is the figure that branch prints.
 *
 * WHAT TRAVELS: durations only. Each referral decided in the window becomes
 * one number of hours. No submission id, account or name leaves the branch,
 * so HQ can take one median across branches without learning whose referral
 * any of the hours were.
 *
 * WHY THE MEDIAN ACROSS BRANCHES IS TAKEN FROM THE HOURS, NOT FROM THE
 * MEDIANS. A median of medians weighs a branch with two decisions the same as
 * one with two hundred. Pooling the durations gives every decision one vote.
 */
import type { Env } from '../types';
import { verdictSpans, type VerdictEventRow } from './referralSubmissions';
import { median } from './branchBenchmarks';

/** The window a decision age is measured over, in days. */
export const DECISION_WINDOW_DAYS = 30;

/**
 * The most durations one branch sends HQ. A month of referral decisions is far
 * below it; past it the list is cut and marked, and HQ takes no median across
 * branches, because a median over a cut list is a median of whichever rows
 * came first.
 */
export const DECISION_HOURS_CAP = 2000;

/**
 * The canvas's two approval queues no database can time, and why. Read by a
 * branch's own S15 and by HQ's H15, so both pages give one reason. Each is a
 * measurement of the store, not a gap in the page: the timestamp a decision age
 * would need is either rewritten on every move or overwritten by the next one.
 */
export const APPROVAL_AGE_NOT_RECORDED = [
  {
    key: 'lp_applications',
    label: 'LP applications',
    reason:
      '`reviewed_at` is rewritten on every status change — in review, needs follow-up, and a note '
      + 'saved without a change of status — and a decision can be reversed, so the column holds the '
      + 'last move, not the decision.',
  },
  {
    key: 'cohort_applications',
    label: 'Cohort applications',
    reason:
      '`decided_at` is overwritten when an application is decided again or rolled to the next '
      + 'cohort, and a rolled application starts a new row with a new `created_at`, so neither end '
      + 'of the interval survives a roll.',
  },
] as const;

/** `YYYY-MM-DD HH:MM:SS`, UTC — the form `CURRENT_TIMESTAMP` columns hold (D162). */
export function sqlStamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * A stamp in either form these tables hold: ISO with its zone (what a route
 * writes with `nowIso()`) or SQLite's `YYYY-MM-DD HH:MM:SS` (a column default),
 * which carries no zone and is UTC.
 */
export function utcMs(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  return s.includes('T') ? Date.parse(s) : Date.parse(`${s.replace(' ', 'T')}Z`);
}

export type Span = { from: number; to: number };

/** Each span's length in hours, dropping any that is not a real, non-negative length. */
export function spanHours(spans: readonly Span[]): number[] {
  return spans.map((s) => (s.to - s.from) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
}

/**
 * The median of some hours, to one decimal, or `null` for none. A median and
 * not a mean: one referral left for a month would move a mean by days and a
 * median by nothing, and both canvases label this a median.
 */
export function medianOfHours(hours: readonly number[]): number | null {
  const hs = hours.filter((h) => Number.isFinite(h) && h >= 0);
  return hs.length ? Math.round(median(hs) * 10) / 10 : null;
}

/** Median hours over some spans, or `null` for none. */
export function medianHours(spans: readonly Span[]): number | null {
  return medianOfHours(spanHours(spans));
}

/**
 * Every referral DECIDED in the window, as a span from submission to its first
 * verdict. Throws when the referral log cannot be read: the caller says so,
 * rather than reading a missing table as "nothing was decided".
 */
export async function referralDecisionSpans(env: Env, nowMs: number): Promise<Span[]> {
  const windowStartMs = nowMs - DECISION_WINDOW_DAYS * 86_400_000;
  const q = await env.DB.prepare(
    `SELECT s.id AS submission_id, s.created_at AS submitted_at,
            e.status AS event_status, e.created_at AS event_at
       FROM referral_submissions s
       JOIN referral_submission_events e ON e.submission_id = s.id
      WHERE s.id IN (SELECT submission_id FROM referral_submission_events WHERE created_at >= ?)`,
  ).bind(sqlStamp(windowStartMs)).all<VerdictEventRow>();
  // The earliest verdict per referral, then only those decided inside the
  // window: a referral decided last year and converted this week has an event
  // in the window and no decision in it.
  return [...verdictSpans(q.results || []).values()].filter((s) => s.to >= windowStartMs);
}

/** What one branch tells HQ about its referral queue. */
export type ReferralAges =
  | { available: true; median_hours: number | null; n: number; hours: number[]; truncated: boolean }
  | { available: false; unreadable: true; median_hours: null; n: 0; hours: []; truncated: false; reason: string };

/**
 * The referral queue's ages, for HQ. `median_hours` is computed exactly as the
 * branch's own page computes it, so the two cannot disagree; `hours` are the
 * same durations, rounded to a tenth and sorted, so they say nothing about
 * order of arrival.
 */
export async function referralAges(env: Env, nowMs: number): Promise<ReferralAges> {
  try {
    const spans = await referralDecisionSpans(env, nowMs);
    const hours = spanHours(spans).map((h) => Math.round(h * 10) / 10).sort((a, b) => a - b);
    return {
      available: true,
      median_hours: medianHours(spans),
      n: spans.length,
      hours: hours.slice(0, DECISION_HOURS_CAP),
      truncated: hours.length > DECISION_HOURS_CAP,
    };
  } catch (e) {
    return {
      available: false, unreadable: true, median_hours: null, n: 0, hours: [], truncated: false,
      reason: `The referral log could not be read: ${(e as Error)?.message || 'unknown'}.`,
    };
  }
}

/**
 * Escalations HQ answered in the window, timed on HQ's own record from the
 * raise reaching HQ to HQ's answer, grouped by the branch that raised them.
 * Throws when `hq_escalations` cannot be read (migration 259).
 */
export async function hqEscalationSpans(env: Env, nowMs: number): Promise<Map<string, Span[]>> {
  const windowStartMs = nowMs - DECISION_WINDOW_DAYS * 86_400_000;
  const q = await env.DB.prepare(
    `SELECT branch_code, created_at, answered_at FROM hq_escalations
      WHERE answered_at IS NOT NULL`,
  ).all<{ branch_code: string; created_at: string; answered_at: string }>();
  const out = new Map<string, Span[]>();
  for (const row of q.results || []) {
    const from = utcMs(row.created_at);
    const to = utcMs(row.answered_at);
    // Answered inside the window, and not before it was raised: an answer
    // stamped before its raise is corrupt, not fast.
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to < windowStartMs || to > nowMs) continue;
    const list = out.get(row.branch_code) || [];
    list.push({ from, to });
    out.set(row.branch_code, list);
  }
  return out;
}
