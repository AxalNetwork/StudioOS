/**
 * The Stripe webhook's deliveries, read from the request log (`activity_logs`).
 *
 * One reader for both pages that draw them: HQ · Platform's P3 (D213,
 * `routes/admin_platform.ts`) and the Payments page's PAY5 (D1011,
 * `routes/admin_payments.ts`). Before D1011 the block lived inside the
 * Platform route; it moved here unchanged and gained `hours`.
 *
 *   last        the newest delivery: status, latency and time, or null
 *   deliveries  how many in the last 24 hours, and how many were not 2xx
 *   hours       D1011, PAY5: 24 clock hours in hourly buckets, oldest
 *               first, ending with the (partial) hour the read is made in. An hour in which the request log holds no row at all
 *               is null ("not logged"), never 0: the log was silent, so how
 *               many deliveries came is unknown. An hour the log did write
 *               in, with no delivery, is 0.
 *
 * Unreadable is its own state: a log that does not answer is
 * `available: false` with the reason, never a count of zero.
 */
import type { Env } from '../types';

/**
 * The path Stripe delivers to. `billing` is mounted at /api/billing in
 * index.ts and its handler is `/stripe/webhook` in routes/billing.ts; a test
 * reads both files and holds this equal, so a moved route cannot leave P3
 * counting a path nothing is served at.
 */
export const STRIPE_WEBHOOK_PATH = '/api/billing/stripe/webhook';

/** P3's webhook window, and PAY5's number of hourly buckets. */
export const WEBHOOK_WINDOW_HOURS = 24;

export const WEBHOOK_BASIS =
  'Read from the request log: the time this Worker took to handle each delivery, not the round '
  + 'trip Stripe measures. A delivery refused for rate is not logged, and nothing turns a failed '
  + 'delivery into an incident.';

export const WEBHOOK_HOURS_BASIS =
  'An hour shows no figure when the request log holds nothing at all for it: the log was silent, '
  + 'so how many deliveries came is unknown.';

export type WebhookHour = { hour: string; deliveries: number | null; not_2xx: number | null };

export type WebhookDeliveries =
  | {
      available: true;
      window_hours: number;
      last: { status_code: number | null; latency_ms: number | null; at: string } | null;
      deliveries: number;
      not_2xx: number;
      hours: WebhookHour[];
      basis: string;
      hours_basis: string;
    }
  | { available: false; window_hours: number; reason: string };

/**
 * A count read back from SQL, or a throw, so a value that is not a number
 * fails the block instead of reading as a measured zero. `null` is refused
 * before `Number()` sees it, because `Number(null)` is 0.
 */
function countOf(value: unknown, what: string): number {
  const n = value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} unreadable`);
  return n;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `2026-10-24 21` — an hour as SQLite's strftime('%Y-%m-%d %H') writes it. */
const sqlHour = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}`;

/** The window's hours, oldest first, ending with the hour `now` is in. */
export function webhookHourStarts(now: Date): Date[] {
  const top = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  return Array.from({ length: WEBHOOK_WINDOW_HOURS }, (_, i) => new Date(top - (WEBHOOK_WINDOW_HOURS - 1 - i) * 3_600_000));
}

/** The deliveries block. Never throws: an unreadable log is `available: false`. */
export async function readWebhookDeliveries(env: Env, now: Date = new Date()): Promise<WebhookDeliveries> {
  try {
    // The last delivery rides idx_activity_endpoint and the rowid within it.
    const last = await env.DB.prepare(
      `SELECT status_code, latency_ms, created_at FROM activity_logs
        WHERE endpoint = ? ORDER BY id DESC LIMIT 1`,
    ).bind(STRIPE_WEBHOOK_PATH).first<{ status_code: number | null; latency_ms: number | null; created_at: string }>();
    // datetime() on both sides: `created_at` is written by datetime('now').
    // A row with no recorded status is a delivery, not a refusal: only a
    // status that was written and is outside 2xx counts as not-2xx.
    const day = await env.DB.prepare(
      `SELECT COUNT(*) AS deliveries,
              COALESCE(SUM(CASE WHEN status_code IS NOT NULL
                                 AND (status_code < 200 OR status_code >= 300) THEN 1 ELSE 0 END), 0) AS refused
         FROM activity_logs
        WHERE endpoint = ?
          AND datetime(created_at) > datetime('now', ?)`,
    ).bind(STRIPE_WEBHOOK_PATH, `-${WEBHOOK_WINDOW_HOURS} hours`).first<{ deliveries: number; refused: number }>();

    // PAY5: every request-log row in the window, by hour. `logged` says the
    // log wrote in that hour at all; the other two are the webhook's own.
    const starts = webhookHourStarts(now);
    const rows = (await env.DB.prepare(
      `SELECT strftime('%Y-%m-%d %H', datetime(created_at)) AS hour,
              COUNT(*) AS logged,
              COALESCE(SUM(CASE WHEN endpoint = ? THEN 1 ELSE 0 END), 0) AS deliveries,
              COALESCE(SUM(CASE WHEN endpoint = ? AND status_code IS NOT NULL
                                 AND (status_code < 200 OR status_code >= 300) THEN 1 ELSE 0 END), 0) AS refused
         FROM activity_logs
        WHERE endpoint IS NOT NULL
          AND datetime(created_at) >= datetime(?)
        GROUP BY hour`,
    ).bind(STRIPE_WEBHOOK_PATH, STRIPE_WEBHOOK_PATH, `${sqlHour(starts[0])}:00:00`)
      .all<{ hour: string; logged: number; deliveries: number; refused: number }>()).results ?? [];
    const byHour = new Map(rows.map((r) => [String(r.hour), r]));
    const hours: WebhookHour[] = starts.map((d) => {
      const r = byHour.get(sqlHour(d));
      const logged = r ? countOf(r.logged, 'logged row count') : 0;
      return {
        hour: d.toISOString(),
        deliveries: logged > 0 ? countOf(r!.deliveries, 'hourly delivery count') : null,
        not_2xx: logged > 0 ? countOf(r!.refused, 'hourly non-2xx count') : null,
      };
    });

    return {
      available: true,
      window_hours: WEBHOOK_WINDOW_HOURS,
      last: last
        ? {
            status_code: last.status_code == null ? null : Number(last.status_code),
            latency_ms: last.latency_ms == null ? null : Number(last.latency_ms),
            at: String(last.created_at),
          }
        : null,
      deliveries: countOf(day?.deliveries, 'webhook delivery count'),
      not_2xx: countOf(day?.refused, 'webhook non-2xx count'),
      hours,
      basis: WEBHOOK_BASIS,
      hours_basis: WEBHOOK_HOURS_BASIS,
    };
  } catch {
    return {
      available: false,
      window_hours: WEBHOOK_WINDOW_HOURS,
      reason: 'The request log could not be read, so the webhook\'s deliveries are unknown rather than none.',
    };
  }
}
