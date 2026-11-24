/**
 * D8259 (#8259, Build v2 BD28): "Not now" on a suggested filing of Company
 * creation. The suggestions are read with the module page
 * (`services/suggestedFilings.ts`, `facts.suggestions`); "Add to my filings"
 * opens the existing Add filing form, so the only write here is the dismissal.
 *
 *   POST /api/cycles/build/company-creation/suggested-filings/:key/dismiss?project=<id>
 *
 * The gate is Build's write gate (`canWrite`: the venture's founders, an
 * admin). The key must name a rule one of Axal's packs holds. A second "Not
 * now" changes nothing and says so (the table's UNIQUE key). The write and its
 * activity row go in one batch.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { canWrite } from './_founder_validate_helpers';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { isSuggestionKey } from '../services/suggestedFilings';
import { STANDARD_EVENTS } from './compliance';
import cycleBuildRoutes from './cycle_build';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

r.post('/:key/dismiss', async (c: C) => {
  const user = await requireAuth(c);
  const raw = c.req.query('project');
  if (!raw || !/^[1-9]\d{0,15}$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    return refuse(c, 400, { code: 'project_required', message: 'Name the venture this suggestion belongs to.' });
  }
  const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(Number(raw)).first<{ id: number; founder_id: number | null; company_id: number | null }>();
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'That venture was not found.' });
  if (!canWrite(project as any, user)) return refuse(c, 403, { code: 'forbidden', message: 'Only the venture’s founders can change its suggestions.' });
  const key = c.req.param('key');
  if (!isSuggestionKey(key)) return refuse(c, 404, { code: 'suggestion_not_found', message: 'That is not one of Axal’s suggested filings.' });
  const already = await c.env.DB.prepare('SELECT 1 AS ok FROM company_filing_suggestion_dismissals WHERE project_id = ? AND suggestion_key = ?')
    .bind(project.id, key).first();
  if (already) return c.json({ ok: true, key, already_dismissed: true });
  const [pack, rule] = key.split(':');
  const title = (STANDARD_EVENTS[pack] || []).find(spec => spec.event_type === rule)?.title ?? 'a suggested filing';
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO company_filing_suggestion_dismissals (project_id, suggestion_key, dismissed_by) VALUES (?, ?, ?) ON CONFLICT(project_id, suggestion_key) DO NOTHING')
      .bind(project.id, key, user.id),
    logCycleWriteStatement(c.env, { projectId: project.id, userId: user.id, cycle: 'build', module: 'company-creation', entityId: null,
      action: 'build_suggested_filing_dismissed', summary: `Suggested filing hidden: ${title}` }),
  ]);
  return c.json({ ok: true, key, already_dismissed: false });
});

export const mount: RouteMount = {
  path: '/api/cycles/build/company-creation/suggested-filings', router: r,
  // Ahead of Build's own router, which is mounted on the covering prefix.
  before: [cycleBuildRoutes],
};
export default r;
