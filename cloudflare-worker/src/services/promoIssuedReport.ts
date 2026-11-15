/**
 * D5949 (#5949): a branch reports what it has issued and spent against its
 * promo ceiling to HQ, on the daily 05:10 run, beside its usage report.
 *
 * THE BRANCH LEDGER STAYS THE ENFORCEMENT SOURCE. A checkout is allowed or
 * refused by `canRedeemPromo` (promoRedemption.ts) against the branch's own
 * `branch_promo_ceiling` and `promo_ceiling_reservations`. HQ's copy
 * (`licence_promo_ceilings.issued_cents`) is a dated report of that ledger for
 * HQ's Revenue page and is never read by a checkout.
 *
 * WHAT IS SENT, for the period and currency of the ceiling the branch holds:
 *   issued_cents  committed plus live holds: the branch's own `issued_cents`
 *                 rule (`syncIssued`), recomputed at send time
 *   spent_cents   committed only
 *   reported_at   the branch's own as-of time
 *
 * A branch holding no ceiling copy sends nothing: there is no period or
 * currency to report against, and HQ's row stays "not reported".
 *
 * A FAILED PUSH NEVER THROWS, as `pushUsageReport`: the result is a sentence.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { withDeadline, DeadlineExceeded } from '../util/deadline';
import { quarterKey } from './statements';

export const PROMO_ISSUED_DEADLINE_MS = 5000;
/**
 * The current period's figure is stale once older than this: the report runs
 * daily, so 48 hours is two missed runs. A closed period's last report is its
 * final figure and is never stale.
 */
export const PROMO_ISSUED_STALE_MS = 48 * 3600_000;

export type PromoIssuedReport = {
  period: string;
  currency: string;
  issued_cents: number;
  spent_cents: number;
  reported_at: string;
};

/** How HQ filed a report (`licence_promo_issued_reports.outcome`). */
export type PromoIssuedOutcome = 'written' | 'no_ceiling' | 'currency_mismatch';

type HqPromoReport = {
  reportPromoIssued?: (callerCode: string, secret: string, report: PromoIssuedReport) => Promise<unknown>;
};

/** Why this deployment cannot report, or null when it can. */
export function promoIssuedRefusal(env: Env): string | null {
  if (!branchOf(env)) return 'HQ holds the ceilings itself; only a branch reports what it has issued against one.';
  if (!String(env.RPC_SECRET ?? '').trim()) {
    return 'No promo report was sent: this branch has no RPC_SECRET, and HQ accepts the report only when it carries it.';
  }
  const hq = (env as { HQ?: HqPromoReport }).HQ;
  if (!hq || typeof hq.reportPromoIssued !== 'function') {
    return 'No promo report was sent: this deployment has no HQ service binding.';
  }
  return null;
}

/**
 * The branch's figures for the ceiling it holds, or null when it holds none.
 * Read from the reservation ledger, the same predicate `syncIssued` keeps.
 */
export async function collectPromoIssued(env: Env, now: Date = new Date()): Promise<PromoIssuedReport | null> {
  const ceiling = await env.DB.prepare('SELECT period, currency FROM branch_promo_ceiling WHERE id = 1')
    .first<{ period: string; currency: string }>();
  if (!ceiling) return null;
  const nowIso = now.toISOString();
  const currency = String(ceiling.currency || '').toUpperCase();
  const sums = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN state = 'committed' OR (state = 'reserved' AND expires_at > ?) THEN amount_cents END), 0) AS issued,
       COALESCE(SUM(CASE WHEN state = 'committed' THEN amount_cents END), 0) AS spent
     FROM promo_ceiling_reservations WHERE period = ? AND currency = ?`,
  ).bind(nowIso, ceiling.period, currency).first<{ issued: number; spent: number }>();
  return {
    period: String(ceiling.period),
    currency,
    issued_cents: Number(sums?.issued ?? 0),
    spent_cents: Number(sums?.spent ?? 0),
    reported_at: nowIso,
  };
}

export type PromoIssuedPush = { sent: boolean; outcome?: PromoIssuedOutcome; period?: string; reason?: string };

/** Send the branch's figures to HQ once. Never throws. */
export async function pushPromoIssuedReport(
  env: Env, now: Date = new Date(), deadlineMs: number = PROMO_ISSUED_DEADLINE_MS,
): Promise<PromoIssuedPush> {
  let refused: string | null;
  try { refused = promoIssuedRefusal(env); } catch (e) { return { sent: false, reason: (e as Error).message }; }
  if (refused) return { sent: false, reason: refused };
  let report: PromoIssuedReport | null;
  try {
    report = await collectPromoIssued(env, now);
  } catch (e) {
    return { sent: false, reason: `This branch could not read its promo ledger: ${(e as Error).message}` };
  }
  if (!report) {
    return { sent: false, reason: 'This branch holds no promo ceiling from HQ, so there is nothing to report against.' };
  }
  // A local alias, as `pushUsageReport` does, so the RPC surface harvest sees the call.
  const hq = (env as { HQ?: HqPromoReport }).HQ as Required<HqPromoReport>;
  try {
    const answer = await withDeadline(
      hq.reportPromoIssued(branchOf(env)!, String(env.RPC_SECRET).trim(), report), deadlineMs, 'promo-issued-report',
    ) as { ok?: unknown; outcome?: unknown } | null;
    const outcome = answer && answer.ok === true && typeof answer.outcome === 'string' ? answer.outcome as PromoIssuedOutcome : null;
    if (!outcome) return { sent: false, period: report.period, reason: 'HQ answered the promo report with something that is not a receipt.' };
    return { sent: true, outcome, period: report.period };
  } catch (e) {
    return {
      sent: false, period: report.period,
      reason: e instanceof DeadlineExceeded
        ? `HQ did not answer the ${report.period} promo report within ${deadlineMs / 1000} seconds.`
        : `HQ did not accept the ${report.period} promo report: ${(e as Error).message}`,
    };
  }
}

// ─────────────────────────────────────────────────────────── HQ's read

/** The state of HQ's copy of one ceiling row's issued figure. */
export type PromoIssuedState = 'reported' | 'not_reported' | 'stale' | 'unreadable' | 'mismatch';

export type CeilingRowFacts = {
  period: string;
  currency: string;
  issued_cents: number | null;
  issued_currency: string | null;
  issued_reported_at: string | null;
};
export type LatestReport = { period: string; currency: string; reported_at: string; outcome: string };

/**
 * One ceiling row's issued state. `latest` is the licence's latest report
 * (`undefined` when there is none, `'unreadable'` when the reports table could
 * not be read).
 *
 *   mismatch      the figure, or the latest report for this row's period, is in
 *                 another currency; or the current period has no figure and the
 *                 branch's latest report is for another period
 *   not_reported  no figure, and nothing says why
 *   unreadable    no figure, and the reports could not be read to say why
 *   stale         the current period's figure is older than PROMO_ISSUED_STALE_MS
 *   reported      otherwise
 */
export function promoIssuedState(
  row: CeilingRowFacts, latest: LatestReport | undefined | 'unreadable', now: Date = new Date(),
): { state: PromoIssuedState; reason: string | null } {
  const currency = String(row.currency || '').toUpperCase();
  const current = row.period === quarterKey(now);
  const known = latest && latest !== 'unreadable' ? latest : null;
  if (row.issued_cents !== null && row.issued_currency && row.issued_currency.toUpperCase() !== currency) {
    return { state: 'mismatch', reason: `The branch reported in ${row.issued_currency.toUpperCase()}; this ceiling is in ${currency}.` };
  }
  if (known && known.period === row.period && known.currency.toUpperCase() !== currency) {
    return { state: 'mismatch', reason: `The branch's latest report for ${row.period} is in ${known.currency.toUpperCase()}; this ceiling is in ${currency}.` };
  }
  if (row.issued_cents === null) {
    if (current && known && known.period !== row.period) {
      return { state: 'mismatch', reason: `The branch's latest report is for ${known.period}, not ${row.period}: it may not hold this ceiling yet.` };
    }
    if (latest === 'unreadable') return { state: 'unreadable', reason: 'The branch reports could not be read, so whether this branch has reported is not known.' };
    return { state: 'not_reported', reason: 'The branch has not reported what it has issued against this ceiling.' };
  }
  const at = Date.parse(String(row.issued_reported_at ?? ''));
  if (current && (!Number.isFinite(at) || now.getTime() - at > PROMO_ISSUED_STALE_MS)) {
    return { state: 'stale', reason: 'The branch\'s last report is more than 48 hours old.' };
  }
  return { state: 'reported', reason: null };
}
