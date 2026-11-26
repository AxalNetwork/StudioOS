/**
 * D7709 (#7709): HQ-only bounded observation imports (Super Admin TOTP write bar, with a reason/audit)
 * and recent per-source run receipts. Mounts itself at /api/admin/market-observations. No member import door.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireHqAdmin, requireSuperAdminWriteBar } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { importerFor } from '../services/marketObservations/importers';
import { ImportRequestError, storedFailure } from '../services/marketObservations/write';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

const app = new Hono<{ Bindings: Env }>();
const REQUEST_WORDS: Record<string, string> = {
  invalid_parameters: 'Choose a range of one to ten years, from 1900 to 2100, and only known World Bank indicators.',
  invalid_cursor: 'The continuation does not match this import request.',
  invalid_cbp_parameters: 'Choose one reference year from 2018 to 2023, one to ten NAICS industries (2 to 6 digits, or all) and known County Business Patterns metrics.',
  source_disabled: 'This source is disabled. No import can run.',
  source_not_found: 'There is no such registered source.',
  unknown_importer: 'Choose a registered importer.',
};
app.post('/imports', async c => {
  const admin = await requireSuperAdminWriteBar(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return refuse(c, 400, { code: 'invalid_request', message: 'Supply an importer, its parameters and a reason.' });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500)
    return refuse(c, 400, { code: 'reason_required', message: 'Give a reason of 3 to 500 characters. It is recorded with the import.' });
  try {
    const importer = importerFor(body.importer);
    const params = importer.validate(body.params);
    // Record the actor and intent before any provider work or observation write.
    await logAdminAction(c.env, Number(admin.id), String(admin.email || ''), 'market_observation_import_requested', {
      importer: body.importer, source_id: importer.source_id, reason, params, has_cursor: body.cursor != null,
    });
    const result = await importer.run(c.env, params, body.cursor);
    await logAdminAction(c.env, Number(admin.id), String(admin.email || ''), 'market_observation_import', {
      importer: body.importer, source_id: importer.source_id, reason, params, run_id: result.run_id, status: result.status,
      rows_seen: result.rows_seen, rows_inserted: result.rows_inserted, rows_unchanged: result.rows_unchanged,
    });
    if (result.status !== 'succeeded') return refuse(c, 502, { code: 'import_incomplete',
      message: 'The import did not finish. Its run is recorded and can be retried.', extra: { result } });
    return c.json({ result }, 202);
  } catch (error) {
    if (error instanceof ImportRequestError) return refuse(c, error.status, { code: error.code,
      message: REQUEST_WORDS[error.code] ?? 'The import request is invalid.' });
    return refuse(c, 503, { code: 'import_unavailable', message: 'The import could not be completed. Read its run before retrying.', raw: error });
  }
});

export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;
app.get('/runs', async c => {
  await requireHqAdmin(c);
  const source = c.req.query('source') ?? 'world-bank', rawLimit = c.req.query('limit') ?? '20';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(source) || !/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100)
    return refuse(c, 400, { code: 'invalid_filter', message: 'Choose a source and a limit from 1 to 100.' });
  try {
    if (!await c.env.DB.prepare('SELECT id FROM research_market_sources WHERE id=?').bind(source).first())
      return refuse(c, 404, { code: 'source_not_found', message: 'There is no such registered source.' });
    const rows = await c.env.DB.prepare(`SELECT id,source_id,vintage,started_at,finished_at,status,rows_seen,rows_inserted,rows_unchanged,error
      FROM research_market_ingestion_runs WHERE source_id=? ORDER BY id DESC LIMIT ?`).bind(source, Number(rawLimit)).all<Record<string, unknown>>();
    const now = Date.now();
    return c.json({ source_id: source, limit: Number(rawLimit), items: (rows.results || []).map(r => {
      const started = Date.parse(String(r.started_at));
      const notFinished = r.status === 'running' ? !Number.isFinite(started) || now - started >= RUN_STALE_AFTER_MS : false;
      return { ...r, error: storedFailure(r.error), not_finished: notFinished,
        rows_seen: r.status === 'running' ? null : r.rows_seen,
        rows_inserted: r.status === 'running' ? null : r.rows_inserted,
        rows_unchanged: r.status === 'running' ? null : r.rows_unchanged,
        status_label: notFinished ? 'Not finished' : r.status === 'running' ? 'Running' : r.status };
    }) });
  } catch (error) {
    return refuse(c, 503, { code: 'runs_unavailable', message: 'Import runs could not be read.', raw: error });
  }
});
export default app;
export const mount: RouteMount = { path: '/api/admin/market-observations', router: app };
