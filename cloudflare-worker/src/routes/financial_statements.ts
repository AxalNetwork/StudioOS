/**
 * D5836 (#5836, part 1): read a venture's accounting statements, over D5833's
 * store (services/financialStatements/store.ts), mounted at
 * /api/financial-statements. Read only: no connector, no write, no pin.
 *
 *   GET /:projectId                    the latest revision of each statement the venture holds
 *                                      (`?report=balance_sheet|profit_and_loss`), each with its
 *                                      revision count, lines, currency, basis and periods
 *   GET /:projectId/revisions/:uid     one exact revision, superseded or not, as a pin points at it
 *   GET /:projectId/pins               the venture's pins, each with the revision it points at and
 *                                      whether a later revision has superseded it
 *
 * WHO. Signed in, then the venture's write access (`canAccessProject` with
 * `write: true`): its founder, a team member or an admin. An advisor or an
 * investor on the venture gets the same 404 as a stranger, so no raw ledger
 * figure reaches them here (#5836: "no raw financial values may leak to an
 * investor or advisor"). The store checks project access again on every read.
 *
 * Every amount stays the store's exact text and minor units, and a line keeps
 * its state (value, zero, absent, unreadable): nothing is summed or rounded.
 * Pinning (a write) and sharing stay #5837's.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { canAccessProject } from '../services/projectAccess';
import { REPORTS, StatementRefusal, type Report } from '../services/financialStatements/contract';
import { readLatest, readPins, readRevision } from '../services/financialStatements/store';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

const UID = /^[0-9a-f-]{36}$/i;
const MESSAGES: Record<string, string> = {
  project_not_found: 'Not found.',
  snapshot_not_found: 'That statement revision is not on this venture.',
};
const notFound = (c: Ctx) => refuse(c, 404, { code: 'project_not_found', message: MESSAGES.project_not_found });

/** The venture, when the caller may read its ledger: write access, so never an advisor or an investor. */
async function venture(c: Ctx) {
  const user = await requireAuth(c);
  const id = Number(c.req.param('projectId'));
  if (!Number.isSafeInteger(id) || id <= 0) return { user, projectId: null };
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p || !(await canAccessProject(c.env, user, p, { write: true }))) return { user, projectId: null };
  return { user, projectId: id };
}

function fail(c: Ctx, e: unknown) {
  if (e instanceof StatementRefusal) {
    return refuse(c, e.status, { code: e.code, message: MESSAGES[e.code] || 'That statement could not be read.' });
  }
  return refuse(c, 503, { code: 'statements_unreadable', message: 'The statements could not be read. Try again in a moment.', raw: e });
}

r.get('/:projectId', async (c) => {
  const v = await venture(c);
  if (v.projectId == null) return notFound(c);
  const report = String(c.req.query('report') || '');
  if (report && !(REPORTS as readonly string[]).includes(report)) {
    return refuse(c, 400, { code: 'invalid_report', message: 'A report is balance_sheet or profit_and_loss.' });
  }
  c.header('Cache-Control', 'private, no-store');
  try {
    const items = await readLatest(c.env, { user: v.user, projectId: v.projectId }, report ? { report: report as Report } : {});
    return c.json({ items, read_at: new Date().toISOString() });
  } catch (e) { return fail(c, e); }
});

r.get('/:projectId/revisions/:uid', async (c) => {
  const v = await venture(c);
  if (v.projectId == null) return notFound(c);
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return refuse(c, 404, { code: 'snapshot_not_found', message: MESSAGES.snapshot_not_found });
  c.header('Cache-Control', 'private, no-store');
  try {
    return c.json({ item: await readRevision(c.env, { user: v.user, projectId: v.projectId }, uid) });
  } catch (e) { return fail(c, e); }
});

r.get('/:projectId/pins', async (c) => {
  const v = await venture(c);
  if (v.projectId == null) return notFound(c);
  c.header('Cache-Control', 'private, no-store');
  try {
    return c.json({ items: await readPins(c.env, { user: v.user, projectId: v.projectId }) });
  } catch (e) { return fail(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/financial-statements', router: r };
