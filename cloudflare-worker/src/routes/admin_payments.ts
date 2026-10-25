/**
 * D1011 (#2830, part 3 of Payments #2386) — the Payments page's own reads.
 * Mounted at /api/admin/payments BEFORE the catch-all /api/admin in index.ts.
 *
 * SUPER ADMIN ONLY: Payments is HQ's (D1008).
 *
 *   GET /change-log           PAY7: the catalogue's and Stripe's changes, newest first.
 *                             ?what=&who=&product=&from=&to=&limit=&offset=
 *   GET /change-log.csv       the same rows as a CSV, with ?reason= (10 to 500
 *                             characters) recorded in the audit log before the
 *                             file is sent; no record, no file. At most 5,000 rows; `X-Export-Capped`
 *                             says when it stopped there.
 *   GET /webhook-deliveries   PAY5: the webhook's 24-hour totals and its 24
 *                             hourly buckets (services/stripeWebhookDeliveries).
 *
 * The rows are the ones `routes/catalog.ts` and `routes/admin_stripe.ts`
 * already write (services/paymentsChangeLog). A read creates no table. A
 * database that does not answer is a 503 with a sentence, never an empty list.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import { refuse } from '../util/refusal';
import { csvResponse, stamp, toCsv } from '../services/csv';
import { ensureAdminAuditLogTable } from './admin';
import {
  CHANGE_KINDS,
  CHANGE_LOG_CSV_HEADER,
  CHANGE_LOG_EXPORT_ACTION,
  CHANGE_LOG_PAGE,
  CHANGE_LOG_PAGE_MAX,
  EXPORT_REASON_MAX,
  EXPORT_REASON_MIN,
  changeLogCsvRows,
  parseChangeLogFilters,
  readChangeLog,
  readChangeLogAdmins,
  readChangeLogForExport,
  type ChangeLogFilters,
} from '../services/paymentsChangeLog';
import { readWebhookDeliveries } from '../services/stripeWebhookDeliveries';

const r = new Hono<{ Bindings: Env }>();

const UNREADABLE = 'The change log could not be read. Nothing is shown rather than an empty log; try again in a moment.';

function filtersOf(c: any): ChangeLogFilters | Response {
  const parsed = parseChangeLogFilters((n) => c.req.query(n));
  return parsed.ok ? parsed.filters : c.json(parsed.refusal, 400);
}

// D1129: names and ids only, independent of the change-log page and filters.
r.get('/change-log/admins', async (c) => {
  await requireSuperAdmin(c);
  try { return c.json({ admins: await readChangeLogAdmins(c.env) }); }
  catch {
    return refuse(c, 503, { code: 'payment_admins_unreadable', message: 'The admin list could not be read. Try again.', audience: 'admin' });
  }
});

r.get('/change-log', async (c) => {
  await requireSuperAdmin(c);
  const f = filtersOf(c);
  if (f instanceof Response) return f;
  const limit = clampLimit(c.req.query('limit'), CHANGE_LOG_PAGE, CHANGE_LOG_PAGE_MAX);
  const offset = parseOffset(c.req.query('offset'));
  try {
    const { entries, total } = await readChangeLog(c.env, f, { limit, offset });
    return c.json({ entries, total, limit, offset, filters: f, kinds: CHANGE_KINDS });
  } catch {
    return refuse(c, 503, { code: 'change_log_unreadable', message: UNREADABLE, audience: 'admin' });
  }
});

r.get('/change-log.csv', async (c) => {
  const admin = await requireSuperAdmin(c);
  const f = filtersOf(c);
  if (f instanceof Response) return f;
  const reason = String(c.req.query('reason') ?? '').trim();
  if (reason.length < EXPORT_REASON_MIN || reason.length > EXPORT_REASON_MAX) {
    return c.json({
      error: 'reason_required',
      message: `Say why you are exporting the change log, in ${EXPORT_REASON_MIN} to ${EXPORT_REASON_MAX} characters.`,
    }, 400);
  }
  let out: Awaited<ReturnType<typeof readChangeLogForExport>>;
  try {
    out = await readChangeLogForExport(c.env, f);
  } catch {
    return refuse(c, 503, { code: 'change_log_unreadable', message: UNREADABLE, audience: 'admin' });
  }
  // The export is recorded, with its reason, before the file leaves. Unlike
  // `logAdminAction`, which never fails the act it records, this write fails
  // closed: an export whose reason was not kept is not sent.
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.prepare(
      'INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json) VALUES (?, ?, ?, ?, ?)',
    ).bind(admin.id, CHANGE_LOG_EXPORT_ACTION, 'billing', 'csv',
      JSON.stringify({ reason, filters: { ...f, q: undefined }, ...(f.q ? { search_applied: true } : {}), rows: out.entries.length, capped: out.capped })).run();
  } catch {
    return refuse(c, 503, { code: 'export_not_recorded', message: 'The export could not be recorded, so it was not sent. Try again in a moment.', audience: 'admin' });
  }
  return csvResponse(toCsv(CHANGE_LOG_CSV_HEADER, changeLogCsvRows(out.entries)), `payments-change-log-${stamp()}.csv`, {
    'X-Export-Rows': String(out.entries.length),
    'X-Export-Capped': out.capped ? '1' : '0',
  });
});

r.get('/webhook-deliveries', async (c) => {
  await requireSuperAdmin(c);
  const deliveries = await readWebhookDeliveries(c.env);
  if (!deliveries.available) {
    return refuse(c, 503, { code: 'webhook_deliveries_unreadable', message: deliveries.reason, audience: 'admin' });
  }
  return c.json(deliveries);
});

export default r;
