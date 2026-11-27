/**
 * D1232 (#3240) — KYC & KYB part 4, mounted on `/api/kyc` ahead of `kyc.ts`
 * (whose `/admin/:userId` would otherwise read these words as an account id).
 *
 *   GET  /admin/renewals?filter=all|soon|expired&q=&page=      KYC9   requireAdmin, logged kyc_renewals_access
 *   GET  /admin/periods                                         KYC17c requireAdmin
 *   PUT  /admin/periods        { periods: { kyc_v1?, kyb_v1?, accreditation_v1? } }
 *                                                               KYC17c requireSuperAdmin + step-up, logged kyc_periods_changed
 *   GET  /admin/audit?from=&to=&action=&admin=&case=&q=&page=   KYC10  requireAdmin, logged kyc_audit_access
 *   POST /admin/audit/export   { from, to, reason }             KYC17d requireSuperAdmin, logged in admin_audit_log
 *
 * Each read answers this deployment's own accounts (a studio is its own
 * database, D106). The export is HQ's: a branch administrator, and a plain
 * Admin at HQ, are refused before anything is read. Its file holds names and
 * actions, never a document, a shown value or a typed reason
 * (`services/kycGovernance.ts`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireStepUp, requireSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { hashEmail } from '../util/hashEmail';
import { mapError } from './_t13t14t15_helpers';
import {
  AuditQueryError, EXPORT_REASON_MAX, EXPORT_REASON_MIN, PeriodInputError, auditCsv, auditWindow, kycAudit,
  kycAuditRows, kycPeriodsRead, kycPeriodsWrite, kycRenewals, parsePeriods, type RenewalFilter,
} from '../services/kycGovernance';

const r = new Hono<{ Bindings: Env }>();

const posInt = (raw: string | undefined) => (raw && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null);

async function logRead(env: Env, action: string, details: string, user: { id: number; email: string }) {
  await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind(action, details, await hashEmail(user.email), user.id).run();
}

r.get('/admin/renewals', async (c) => {
  try {
    const user = await requireAdmin(c);
    const filter = (c.req.query('filter') || 'all') as RenewalFilter;
    if (!['all', 'soon', 'expired'].includes(filter)) return c.json({ code: 'bad_filter', detail: 'filter must be all, soon or expired.' }, 400);
    const page = c.req.query('page') ? posInt(c.req.query('page')) : 1;
    if (page == null) return c.json({ code: 'bad_page', detail: 'page must be a positive whole number.' }, 400);
    let out;
    try { out = await kycRenewals(c.env, { filter, q: c.req.query('q') || '', page }); }
    catch { return c.json({ state: 'unreadable', detail: 'The renewals could not be read. Try again.' }, 503); }
    await logRead(c.env, 'kyc_renewals_access', `KYC renewals read count=${out.counts.all}`, user as any);
    return c.json(out);
  } catch (e) { return mapError(c, e); }
});

r.get('/admin/periods', async (c) => {
  try {
    const user = await requireAdmin(c);
    let periods;
    try { periods = await kycPeriodsRead(c.env); }
    catch { return c.json({ state: 'unreadable', detail: 'How long checks last could not be read. Try again.' }, 503); }
    return c.json({ periods, can_change: !branchOf(c.env) && isSuperAdmin(user as any) });
  } catch (e) { return mapError(c, e); }
});

r.put('/admin/periods', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    await requireStepUp(c);
    let asked;
    try { asked = parsePeriods(await c.req.json().catch(() => null)); }
    catch (e) { if (e instanceof PeriodInputError) return c.json({ code: 'bad_periods', detail: e.sentence }, 400); throw e; }
    let changes;
    try { changes = await kycPeriodsWrite(c.env, Number(user.id), await hashEmail(user.email), asked); }
    catch { return c.json({ state: 'unwritten', detail: 'The periods could not be saved. Nothing changed. Try again.' }, 503); }
    return c.json({ changes, periods: await kycPeriodsRead(c.env) });
  } catch (e) { return mapError(c, e); }
});

r.get('/admin/audit', async (c) => {
  try {
    const user = await requireAdmin(c);
    const q = (k: string) => c.req.query(k);
    const admin = q('admin') ? posInt(q('admin')) : null;
    const caseId = q('case') ? posInt(q('case')) : null;
    const page = q('page') ? posInt(q('page')) : 1;
    if ((q('admin') && admin == null) || (q('case') && caseId == null) || page == null) {
      return c.json({ code: 'bad_query', detail: 'admin, case and page are positive whole numbers.' }, 400);
    }
    let out;
    try { out = await kycAudit(c.env, { from: q('from'), to: q('to'), action: q('action') || undefined, admin, caseId, q: q('q') || '', page }); }
    catch (e) {
      if (e instanceof AuditQueryError) return c.json({ code: 'bad_query', detail: e.sentence }, 400);
      return c.json({ state: 'unreadable', detail: 'The audit record could not be read. Try again.' }, 503);
    }
    await logRead(c.env, 'kyc_audit_access', `KYC audit read count=${out.total}`, user as any);
    return c.json(out);
  } catch (e) { return mapError(c, e); }
});

r.post('/admin/audit/export', async (c) => {
  try {
    const user = await requireSuperAdmin(c);
    const b = (await c.req.json().catch(() => null)) || {};
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (reason.length < EXPORT_REASON_MIN || reason.length > EXPORT_REASON_MAX) {
      return c.json({ code: 'reason_required', detail: `Say why, in ${EXPORT_REASON_MIN} to ${EXPORT_REASON_MAX} characters. The reason is recorded with the export.` }, 400);
    }
    if (typeof b.from !== 'string' || typeof b.to !== 'string') return c.json({ code: 'bad_query', detail: 'Choose the dates to export.' }, 400);
    let rows;
    try { rows = await kycAuditRows(c.env, auditWindow(b.from, b.to)); }
    catch (e) {
      if (e instanceof AuditQueryError) return c.json({ code: 'bad_query', detail: e.sentence }, 400);
      return c.json({ state: 'unreadable', detail: 'The audit record could not be read, so nothing was exported. Try again.' }, 503);
    }
    // The record of the export is written before the file leaves: an export
    // that cannot be recorded is not made.
    try {
      await c.env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, actor) VALUES (?, 'kyc_audit_export', 'kyc_audit', 'csv', ?, ?)`,
      ).bind(Number(user.id), JSON.stringify({ from: b.from, to: b.to, reason, rows: rows.length }), await hashEmail(user.email)).run();
    } catch {
      return c.json({ state: 'unrecorded', detail: 'The export could not be recorded, so it was not made. Try again.' }, 503);
    }
    return c.json({ filename: `kyc-audit_${b.from}_${b.to}.csv`, rows: rows.length, csv: auditCsv(rows) });
  } catch (e) { return mapError(c, e); }
});

export default r;
