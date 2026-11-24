/**
 * D7820 (#7820): admin routes over the Research › Companies review ledger (D7819), mounted at
 * /api/research/company-reviews (no `before`: research.ts has no catch-all or middleware under that path). Admin only on every route; each write goes through the
 * admin audit trail with a count and a batch reference, never a uid list. Service: `services/researchCompanyReview.ts`.
 *
 *   POST /                 place, change or clear (status `admitted`) a status for one uid or up to 200, all or nothing:
 *                          { uids, status, reason_code, proof_url (https), admin_note?, next_action?, next_review_on?,
 *                            withdrawn_on?, run_reference? }. An unknown uid is refused by name and nothing changes.
 *   POST /checks           record a check: { uid, kind, outcome, what_changed?, proof_url, checked_at? }
 *   GET  /                 current held, excluded and withdrawn records, paged (?status=&page=&page_size=)
 *   GET  /:uid/history     one uid's history and checks
 *
 * No route registers a run: `run_reference` is text only.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { mapError } from './_t13t14t15_helpers';
import {
  ReviewInputError, applyReviews, listHolds, parseCheck, parseReview, recordCheck, reviewHistory,
} from '../services/researchCompanyReview';

const r = new Hono<{ Bindings: Env }>();

const refused = (c: any, e: unknown) => {
  if (e instanceof ReviewInputError) return c.json({ error: e.code, detail: e.detail, ...e.extra }, e.code === 'unknown_uids' ? 404 : 400);
  return mapError(c, e);
};
const batchReference = (run: string | null) => run || `batch-${crypto.randomUUID()}`;

r.post('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const input = parseReview(await c.req.json().catch(() => ({})));
    const out = await applyReviews(c.env, input, Number(user.id));
    const batch = batchReference(input.run_reference);
    await logAdminAction(c.env, Number(user.id), String(user.email || ''), 'research_company_review_set',
      { count: out.count, status: out.status, reason_code: input.reason_code, batch_reference: batch });
    return c.json({ ok: true, ...out, batch_reference: batch });
  } catch (e) { return refused(c, e); }
});

r.post('/checks', async (c) => {
  try {
    const user = await requireAdmin(c);
    const input = parseCheck(await c.req.json().catch(() => ({})));
    const out = await recordCheck(c.env, input);
    await logAdminAction(c.env, Number(user.id), String(user.email || ''), 'research_company_check_recorded',
      { count: 1, kind: input.kind, outcome: input.outcome, batch_reference: batchReference(null) });
    return c.json({ ok: true, ...out }, 201);
  } catch (e) { return refused(c, e); }
});

r.get('/', async (c) => {
  try {
    await requireAdmin(c);
    c.header('Cache-Control', 'no-store');
    return c.json(await listHolds(c.env, { status: c.req.query('status') || null, page: Number(c.req.query('page')), page_size: Number(c.req.query('page_size')) }));
  } catch (e) { return refused(c, e); }
});

r.get('/:uid/history', async (c) => {
  try {
    await requireAdmin(c);
    c.header('Cache-Control', 'no-store');
    return c.json(await reviewHistory(c.env, c.req.param('uid')));
  } catch (e) { return refused(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/research/company-reviews', router: r };
