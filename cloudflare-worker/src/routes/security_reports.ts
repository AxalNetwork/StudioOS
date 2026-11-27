/**
 * D1075 (#2967) — Help's "Security" category: a member reports a security
 * issue in the app, and only HQ's Super Admins and the member read it
 * (`services/securityReports.ts` says why it is not a ticket row).
 *
 * `securityReports`, mounted at /api/help/security-reports (signed in):
 *   POST /      { affected, what_happened, how_to_reproduce? }
 *               files one; five per member per 24 hours; HQ only (a branch
 *               refuses with the other ways to report)
 *   GET  /mine  the member's own reports and where each stands
 *
 * `adminSecurityReports`, mounted at /api/admin/security/reports:
 *   GET   /?status=   every report, oldest open first (requireSuperAdmin)
 *   PATCH /:uid { status }   moves it on (requireSuperAdminWriteBar, audited
 *                     by uid and status, never its words)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { branchOf } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import { logAdminAction } from '../services/adminAudit';
import {
  SECURITY_REPORT_REFUSALS, SECURITY_REPORT_STATUSES, type SecurityReportRefusal, type SecurityReportStatus,
  allReports, fileReport, noticeSuperAdmins, parseReport, reportsOf, setStatus,
} from '../services/securityReports';

const refuse = (c: Context<{ Bindings: Env }>, code: SecurityReportRefusal, status = 400) =>
  c.json({ error: code, code, message: SECURITY_REPORT_REFUSALS[code] }, status as any);

export const securityReports = new Hono<{ Bindings: Env }>();

securityReports.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (branchOf(c.env)) return refuse(c, 'hq_only', 409);
    const parsed = parseReport(await c.req.json().catch(() => null));
    if (!parsed.ok) return refuse(c, parsed.code);
    const out = await fileReport(c.env, user.id, parsed.value);
    if (!out.ok) return refuse(c, out.code, 429);
    await noticeSuperAdmins(c.env, out.uid);
    return c.json({
      ok: true, uid: out.uid, status: 'open',
      message: 'Sent privately. Only the security team can read it. Critical reports are acknowledged within 4 business hours.',
    }, 201);
  } catch (e) { return mapError(c, e); }
});

securityReports.get('/mine', async (c) => {
  try {
    const user = await requireAuth(c);
    return c.json({ items: await reportsOf(c.env, user.id) });
  } catch (e) { return mapError(c, e); }
});

export const adminSecurityReports = new Hono<{ Bindings: Env }>();

const isStatus = (v: unknown): v is SecurityReportStatus => typeof v === 'string' && (SECURITY_REPORT_STATUSES as readonly string[]).includes(v);

adminSecurityReports.get('/', async (c) => {
  try {
    await requireSuperAdmin(c);
    const q = c.req.query('status');
    if (q && !isStatus(q)) return refuse(c, 'bad_status');
    return c.json(await allReports(c.env, q ? (q as SecurityReportStatus) : null));
  } catch (e) { return mapError(c, e); }
});

adminSecurityReports.patch('/:uid', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const raw = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!isStatus(raw?.status)) return refuse(c, 'bad_status');
    const uid = c.req.param('uid');
    if (!(await setStatus(c.env, uid, raw!.status as SecurityReportStatus, admin.id))) return refuse(c, 'not_found', 404);
    await logAdminAction(c.env, admin.id, admin.email, 'security_report.status_changed', { report: uid, status: raw!.status });
    return c.json({ ok: true, uid, status: raw!.status });
  } catch (e) { return mapError(c, e); }
});
