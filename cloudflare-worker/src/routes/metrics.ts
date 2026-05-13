/**
 * Task #3 (DF) — `/api/metrics/*` namespace.
 *
 * The original metrics endpoints live under `/api/progress/metrics/*` (see
 * `routes/progress.ts`); this router exposes the same handlers under the
 * shorter `/api/metrics/*` path so callers don't have to know about the
 * progress-suite history. Both prefixes are kept; the shared handlers
 * (and the lazy `ensureMetricsSnapshotsSchema()` schema bootstrap) live in
 * `progress.ts` to avoid duplication.
 *
 * Routes:
 *   GET    /:projectId               — list snapshots (`{items, snapshots}`)
 *   POST   /:projectId               — create snapshot
 *   PUT    /snapshot/:id             — patch snapshot
 *   DELETE /snapshot/:id             — delete snapshot
 *   GET    /:projectId/series        — `{series:[{date,value}]}` for charts
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import progress from './progress';

const metrics = new Hono<{ Bindings: Env }>();

// Reuse the progress router's handlers via internal sub-requests so the
// validation/auth/schema-ensure logic stays in one place.
async function relay(c: any, path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = path;
  const headers = new Headers(c.req.raw.headers);
  const req = new Request(url.toString(), {
    method: init?.method || c.req.method,
    headers,
    body: ['GET', 'HEAD'].includes((init?.method || c.req.method).toUpperCase())
      ? undefined
      : await c.req.raw.clone().arrayBuffer(),
  });
  return progress.fetch(req, c.env, c.executionCtx);
}

metrics.get('/:projectId', (c) => relay(c, `/metrics/${c.req.param('projectId')}`));
metrics.post('/:projectId', (c) => relay(c, `/metrics/${c.req.param('projectId')}`));
metrics.post('/:projectId/import-stripe', (c) =>
  relay(c, `/metrics/${c.req.param('projectId')}/import-stripe`));
metrics.get('/:projectId/series', (c) => {
  const qs = new URL(c.req.url).search;
  return relay(c, `/metrics/${c.req.param('projectId')}/series${qs}`);
});
metrics.put('/snapshot/:id', (c) => relay(c, `/metrics/snapshot/${c.req.param('id')}`));
metrics.delete('/snapshot/:id', (c) => relay(c, `/metrics/${c.req.param('id')}`));

export default metrics;
