/** Publish an issued period's in-app notices with an atomic, durable delivery receipt (D6255). */
import type { Env } from '../types';

type Receipt = {
  period_id: number;
  status: 'complete' | 'failed';
  delivered_count: number | null;
  unlinked_count: number | null;
  delivered_at: string | null;
};
export type FundReportDelivery = {
  delivery_status: 'not_sent' | 'sent' | 'partial' | 'failed' | 'unreadable';
  delivered_count: number | null;
  undelivered_count: number | null;
  lps_notified_at: string | null;
};

function shapeDelivery(receipt?: Receipt): FundReportDelivery {
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

/** Read outcomes only for period IDs already scoped and authorized by the caller. */
export async function withFundReportDelivery<T extends { id: number; status: string }>(env: Env, periods: T[]) {
  const ids = periods.filter(period => period.status === 'issued').map(period => period.id);
  if (!ids.length) return periods;
  let receipts: Map<number, Receipt> | null = null;
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
  return periods.map(period => period.status !== 'issued' ? period : {
    ...period,
    ...(receipts ? shapeDelivery(receipts.get(period.id)) : { ...shapeDelivery(), delivery_status: 'unreadable' as const }),
  });
}

/**
 * Run only after the period's issue transaction commits. The existing inbox
 * insert and its receipt commit together, so a retry cannot duplicate messages
 * even after an LP dismisses one. Committed and active LPs use the same status
 * gate as report-pack eligibility. Only linked active accounts can be reached.
 */
export async function sendFundReportNotices(env: Env, fundId: number, periodId: number) {
  const href = `/funds/${fundId}/reporting/${periodId}`;
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
      ).bind(new Date().toISOString(), periodId, fundId),
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
  }
}
