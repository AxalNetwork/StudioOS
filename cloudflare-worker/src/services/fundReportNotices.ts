/** Publish an issued period's in-app notices with an atomic, durable delivery receipt (D6255), and record delivery per LP (D6240). */
import type { Env } from '../types';

type Receipt = {
  period_id: number;
  status: 'complete' | 'failed';
  delivered_count: number | null;
  unlinked_count: number | null;
  delivered_at: string | null;
};
/**
 * D6240: one issued period's per-LP rows, counted. `delivered` is the LPs the
 * period was made available to (those who opened it included); `total` is
 * every LP row recorded at issue, including those with no account and those
 * whose notice failed. A period with no rows was issued before rows were
 * written and reads `not_recorded`, never 0 of m.
 */
export type LpDeliveryCounts =
  | { state: 'recorded'; delivered: number; total: number; opened: number; failed: number; no_account: number }
  | { state: 'not_recorded' | 'unreadable'; delivered: null; total: null; opened: null; failed: null; no_account: null };
export type FundReportDelivery = {
  delivery_status: 'not_sent' | 'sent' | 'partial' | 'failed' | 'unreadable';
  delivered_count: number | null;
  undelivered_count: number | null;
  lps_notified_at: string | null;
  lp_delivery: LpDeliveryCounts;
};
const LP_STATES = ['not_sent', 'made_available', 'opened', 'failed'] as const;
export type LpDeliveryState = typeof LP_STATES[number];
type LpCountRow = { period_id: number; total: number; delivered: number; opened: number; failed: number; no_account: number };
const unknownCounts = (state: 'not_recorded' | 'unreadable'): LpDeliveryCounts =>
  ({ state, delivered: null, total: null, opened: null, failed: null, no_account: null });

function shapeDelivery(receipt?: Receipt): Omit<FundReportDelivery, 'lp_delivery'> {
  const delivered = receipt?.delivered_count ?? null;
  const unlinked = receipt?.unlinked_count ?? null;
  const status = receipt?.status === 'failed' ? 'failed'
    : delivered && unlinked ? 'partial'
    : delivered ? 'sent'
    : 'not_sent';
  return {
    delivery_status: status, delivered_count: delivered,
    undelivered_count: unlinked, lps_notified_at: receipt?.delivered_at ?? null,
  };
}

/**
 * D6240: the period's rows when it has any. With none, a complete D6255
 * receipt that counted no LP at all makes 0 of 0 true; anything else is a
 * period issued before rows were written, and reads Not recorded.
 */
function shapeLpCounts(row: LpCountRow | undefined, receipt: Receipt | undefined): LpDeliveryCounts {
  if (row && Number(row.total) > 0) {
    return { state: 'recorded', delivered: Number(row.delivered), total: Number(row.total), opened: Number(row.opened),
      failed: Number(row.failed), no_account: Number(row.no_account) };
  }
  if (receipt?.status === 'complete' && receipt.delivered_count === 0 && receipt.unlinked_count === 0) {
    return { state: 'recorded', delivered: 0, total: 0, opened: 0, failed: 0, no_account: 0 };
  }
  return unknownCounts('not_recorded');
}

/** Read outcomes only for period IDs already scoped and authorized by the caller. */
export async function withFundReportDelivery<T extends { id: number; status: string }>(env: Env, periods: T[]) {
  const ids = periods.filter(period => period.status === 'issued').map(period => period.id);
  if (!ids.length) return periods;
  let receipts: Map<number, Receipt> | null = null;
  let counts: Map<number, LpCountRow> | null = null;
  try {
    const rows = await env.DB.prepare(
      `SELECT period_id, status, delivered_count, unlinked_count, delivered_at
         FROM fund_report_notice_delivery
        WHERE period_id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(ids)).all<Receipt>();
    if (rows.success) receipts = new Map(rows.results.map(receipt => [receipt.period_id, receipt]));
  } catch {
    // A receipt read failure leaves the issued report readable.
  }
  try {
    const rows = await env.DB.prepare(
      `SELECT period_id, COUNT(*) AS total,
              SUM(CASE WHEN state IN ('made_available', 'opened') THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN state = 'opened' THEN 1 ELSE 0 END) AS opened,
              SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN state = 'not_sent' THEN 1 ELSE 0 END) AS no_account
         FROM fund_report_lp_delivery
        WHERE period_id IN (SELECT value FROM json_each(?))
        GROUP BY period_id`,
    ).bind(JSON.stringify(ids)).all<LpCountRow>();
    if (rows.success) counts = new Map(rows.results.map(row => [Number(row.period_id), row]));
  } catch {
    // As above: the counts read Unreadable and the report stays readable.
  }
  // A period with no rows needs its receipt to tell 0 of 0 from Not recorded, so an unreadable receipt leaves it Unreadable.
  const lpCounts = (id: number) => !counts || (!receipts && !counts.has(id))
    ? unknownCounts('unreadable') : shapeLpCounts(counts.get(id), receipts?.get(id));
  return periods.map(period => period.status !== 'issued' ? period : {
    ...period,
    ...(receipts ? shapeDelivery(receipts.get(period.id)) : { ...shapeDelivery(), delivery_status: 'unreadable' as const }),
    lp_delivery: lpCounts(period.id),
  });
}

export type LpDeliveryRow = {
  lp_id: number; name: string | null; lp_removed: boolean; state: LpDeliveryState;
  made_available_at: string | null; opened_at: string | null;
};
/**
 * D6240: each LP of one issued period, for a caller `requireFundGp` already
 * admitted. No rows reads Not recorded; a failed read reads Unreadable. Only a
 * name travels: the LP register already shows the GP each LP's contact details.
 */
export async function readLpDeliveries(env: Env, periodId: number) {
  try {
    const rows = await env.DB.prepare(
      `SELECT d.lp_id, d.state, d.made_available_at, d.opened_at, lp.id IS NULL AS lp_removed,
              COALESCE(lp.name, u.name, lp.email, u.email) AS name
         FROM fund_report_lp_delivery d
         LEFT JOIN limited_partners lp ON lp.id = d.lp_id
         LEFT JOIN users u ON u.id = lp.user_id
        WHERE d.period_id = ?
        ORDER BY CASE d.state WHEN 'failed' THEN 0 WHEN 'not_sent' THEN 1 WHEN 'made_available' THEN 2 ELSE 3 END, d.lp_id`,
    ).bind(periodId).all<any>();
    if (rows.success !== true || !Array.isArray(rows.results)) throw new Error('LP delivery unreadable');
    const items: LpDeliveryRow[] = rows.results.map(row => {
      if (!LP_STATES.includes(row.state)) throw new Error('LP delivery unreadable');
      return { lp_id: Number(row.lp_id), name: row.name ?? null, lp_removed: Boolean(row.lp_removed), state: row.state,
        made_available_at: row.made_available_at ?? null, opened_at: row.opened_at ?? null };
    });
    return items.length
      ? { lp_deliveries: items, lp_deliveries_reason: null }
      : { lp_deliveries: null, lp_deliveries_reason: 'Not recorded: this period was issued before delivery was recorded for each LP.' };
  } catch {
    return { lp_deliveries: null, lp_deliveries_reason: 'Unreadable: the per-LP delivery could not be read.' };
  }
}

/**
 * D6240: an LP's linked account read the issued report. Only rows the notice
 * reached move, and only once: the first opening is the one kept. A failed
 * write never blocks the report.
 */
export async function recordFundReportOpened(env: Env, periodId: number, userId: number) {
  try {
    await env.DB.prepare(
      `UPDATE fund_report_lp_delivery SET state = 'opened', opened_at = ?
        WHERE period_id = ? AND user_id = ? AND state = 'made_available'`,
    ).bind(new Date().toISOString(), periodId, userId).run();
  } catch {
    console.warn('[fund-report-notices] opened receipt unavailable');
  }
}

/**
 * Run only after the period's issue transaction commits. The existing inbox
 * insert and its receipt commit together, so a retry cannot duplicate messages
 * even after an LP dismisses one. Committed and active LPs use the same status
 * gate as report-pack eligibility. Only linked active accounts can be reached.
 */
export async function sendFundReportNotices(env: Env, fundId: number, periodId: number) {
  const href = `/funds/${fundId}/reporting/${periodId}`;
  const at = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO notifications_inbox (user_id, type, title, body, link, channel, category, cta_url)
         SELECT DISTINCT u.id, 'fund_report_issued', 'Fund report available',
                'The fund issued a reporting period. Open the report to read it.', ?, 'in_app', 'portfolio', ?
           FROM fund_report_periods p
           JOIN limited_partners lp ON lp.fund_id = p.fund_id AND lp.status IN ('committed', 'active')
           JOIN users u ON u.id = lp.user_id AND u.is_active = 1
          WHERE p.id = ? AND p.fund_id = ? AND p.status = 'issued'
            AND NOT EXISTS (SELECT 1 FROM fund_report_notice_delivery d WHERE d.period_id = p.id AND d.status = 'complete')`,
      ).bind(href, href, periodId, fundId),
      // D6240: one row per LP, in the notices' transaction. It runs before the
      // receipt below, under the same "no complete receipt" guard, so a retry
      // after a failure rewrites that failure's rows and nothing else.
      env.DB.prepare(
        `INSERT INTO fund_report_lp_delivery (period_id, lp_id, user_id, state, recorded_at, made_available_at, opened_at)
         SELECT p.id, lp.id, u.id, CASE WHEN u.id IS NULL THEN 'not_sent' ELSE 'made_available' END, ?,
                CASE WHEN u.id IS NULL THEN NULL ELSE ? END, NULL
           FROM fund_report_periods p
           JOIN limited_partners lp ON lp.fund_id = p.fund_id AND lp.status IN ('committed', 'active')
           LEFT JOIN users u ON u.id = lp.user_id AND u.is_active = 1
          WHERE p.id = ? AND p.fund_id = ? AND p.status = 'issued'
            AND NOT EXISTS (SELECT 1 FROM fund_report_notice_delivery d WHERE d.period_id = p.id AND d.status = 'complete')
         ON CONFLICT(period_id, lp_id) DO UPDATE SET user_id = excluded.user_id, state = excluded.state,
              recorded_at = excluded.recorded_at, made_available_at = excluded.made_available_at, opened_at = NULL
         WHERE fund_report_lp_delivery.state IN ('failed', 'not_sent')`,
      ).bind(at, at, periodId, fundId),
      env.DB.prepare(
        `INSERT INTO fund_report_notice_delivery (period_id, status, delivered_count, unlinked_count, delivered_at)
         SELECT p.id, 'complete', COUNT(DISTINCT u.id),
                COUNT(CASE WHEN u.id IS NULL THEN lp.id END),
                CASE WHEN COUNT(u.id) > 0 THEN ? END
           FROM fund_report_periods p
           LEFT JOIN limited_partners lp ON lp.fund_id = p.fund_id AND lp.status IN ('committed', 'active')
           LEFT JOIN users u ON u.id = lp.user_id AND u.is_active = 1
          WHERE p.id = ? AND p.fund_id = ? AND p.status = 'issued'
          GROUP BY p.id
         ON CONFLICT(period_id) DO UPDATE SET status = excluded.status, delivered_count = excluded.delivered_count,
              unlinked_count = excluded.unlinked_count, delivered_at = excluded.delivered_at
         WHERE fund_report_notice_delivery.status = 'failed'`,
      ).bind(at, periodId, fundId),
    ]);
    if (results.some(result => !result.success)) throw new Error('Notice transaction failed');
  } catch {
    try {
      await env.DB.prepare(
        `INSERT INTO fund_report_notice_delivery (period_id, status)
         SELECT id, 'failed' FROM fund_report_periods WHERE id = ? AND fund_id = ? AND status = 'issued'
         ON CONFLICT DO NOTHING`,
      ).bind(periodId, fundId).run();
    } catch {
      console.warn('[fund-report-notices] delivery receipt unavailable');
    }
    // D6240: each LP the notice would have reached reads failed; an LP with no account reads not sent.
    try {
      await env.DB.prepare(
        `INSERT INTO fund_report_lp_delivery (period_id, lp_id, user_id, state, recorded_at)
         SELECT p.id, lp.id, u.id, CASE WHEN u.id IS NULL THEN 'not_sent' ELSE 'failed' END, ?
           FROM fund_report_periods p
           JOIN limited_partners lp ON lp.fund_id = p.fund_id AND lp.status IN ('committed', 'active')
           LEFT JOIN users u ON u.id = lp.user_id AND u.is_active = 1
          WHERE p.id = ? AND p.fund_id = ? AND p.status = 'issued'
            AND NOT EXISTS (SELECT 1 FROM fund_report_notice_delivery d WHERE d.period_id = p.id AND d.status = 'complete')
         ON CONFLICT(period_id, lp_id) DO NOTHING`,
      ).bind(at, periodId, fundId).run();
    } catch {
      console.warn('[fund-report-notices] per-LP delivery unavailable');
    }
  }
}
