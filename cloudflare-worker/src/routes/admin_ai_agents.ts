/**
 * D4163 (#4163, H5 of #4137) — HQ › AI agents: Overview, Runs, Spend and
 * Audit, mounted at `/api/admin/ai-agents`. Super Admin only (`requireSuperAdmin`).
 *
 *   GET /overview                    SA0: the KPI tiles, Needs attention, spend by area (30 days)
 *   GET /runs?agent=&skill=&area=&team=company:<id>|project:<id>&status=&from=&to=&cursor=
 *                                    SA7: the run log, newest first, 50 a page
 *   GET /runs/:uid                   SA7: one run — steps, inputs as references, output, cost against the hold, errors
 *   GET /spend?by=agent|skill|company|model
 *                                    SA7b: this month against the platform budget, the projection, the teams at their cap
 *   GET /audit?admin=&action=&area=&from=&to=&cursor=
 *                                    SA8: every admin action on the panel, newest first
 *   GET /audit.csv                   SA8: the same, as CSV (at most 5,000 rows)
 *
 * Read-only. The audit is written by H1–H4 through `recordAiAdminAction`
 * (`services/agents/adminAudit.ts`); there is no route that updates or
 * deletes it. A figure with no data is `null` ("Not recorded"), never 0, and no
 * answer or CSV carries an email.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { overview, runDetail, runFiltersOf, runLog, spend, SPEND_BY, type SpendBy } from '../services/agents/adminReads';
import { AUDIT_CSV_MAX, auditCsv, auditFiltersOf, readAudit } from '../services/agents/adminAudit';

const r = new Hono<{ Bindings: Env }>();

r.get('/overview', async (c) => {
  await requireSuperAdmin(c);
  return c.json(await overview(c.env));
});

r.get('/runs', async (c) => {
  await requireSuperAdmin(c);
  const f = runFiltersOf(c.req.query());
  if ('error' in f) return refuse(c, 400, { code: 'invalid_filter', message: `The ${f.error} filter is not one this log reads.`, extra: { filter: f.error } });
  return c.json(await runLog(c.env, f));
});

r.get('/runs/:uid', async (c) => {
  await requireSuperAdmin(c);
  const uid = c.req.param('uid');
  if (!/^[0-9A-Za-z-]{8,64}$/.test(uid)) return refuse(c, 404, { code: 'not_found', message: 'No such run.' });
  const run = await runDetail(c.env, uid);
  if (!run) return refuse(c, 404, { code: 'not_found', message: 'No such run.' });
  return c.json({ run });
});

r.get('/spend', async (c) => {
  await requireSuperAdmin(c);
  const by = (c.req.query('by') || 'agent') as SpendBy;
  if (!(SPEND_BY as readonly string[]).includes(by)) return refuse(c, 400, { code: 'invalid_by', message: 'Spend reads by agent, skill, company or model.' });
  return c.json(await spend(c.env, by));
});

r.get('/audit', async (c) => {
  await requireSuperAdmin(c);
  const f = auditFiltersOf(c.req.query());
  if ('error' in f) return refuse(c, 400, { code: 'invalid_filter', message: `The ${f.error} filter is not one this audit reads.`, extra: { filter: f.error } });
  return c.json(await readAudit(c.env, f));
});

r.get('/audit.csv', async (c) => {
  await requireSuperAdmin(c);
  const f = auditFiltersOf(c.req.query());
  if ('error' in f) return refuse(c, 400, { code: 'invalid_filter', message: `The ${f.error} filter is not one this audit reads.`, extra: { filter: f.error } });
  const { rows } = await readAudit(c.env, { ...f, before: null }, AUDIT_CSV_MAX);
  return new Response(auditCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ai-agents-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
});

export const mount: RouteMount = { path: '/api/admin/ai-agents', router: r };
export default r;
