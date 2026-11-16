/**
 * D5580 part 4 (#5580): the WorkGraph snapshot routes. Mounted at
 * /api/admin/workgraph.
 *
 *   POST /snapshots   the hourly pr-overlap job posts its advisory snapshot.
 *                     No member session: the caller sends
 *                     `Authorization: Bearer <WORKGRAPH_INGEST_TOKEN>`, compared
 *                     in constant time. With the secret unset the route
 *                     refuses (503), so nothing is accepted until it is set.
 *   GET  /in-flight   the latest snapshot and its age, for the HQ WorkGraph
 *                     page. Super Admin only: it shows every slot's work.
 *
 * The snapshot is advice: nothing here blocks, labels or merges anything.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { constantTimeEqual } from '../rpc/secret';
import { MAX_BYTES, ingestSnapshot, latestSnapshot } from '../services/workgraphSnapshots';

const r = new Hono<{ Bindings: Env }>();

r.post('/snapshots', async (c) => {
  const secret = c.env.WORKGRAPH_INGEST_TOKEN;
  if (!secret) {
    return refuse(c, 503, { code: 'workgraph_ingest_not_configured', message: 'The WorkGraph ingest is not configured on this deployment.' });
  }
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !constantTimeEqual(token, secret)) {
    return refuse(c, 401, { code: 'workgraph_ingest_unauthorized', message: 'The ingest token is missing or wrong.' });
  }
  const declared = Number(c.req.header('Content-Length') || 0);
  if (declared > MAX_BYTES) {
    return refuse(c, 413, { code: 'snapshot_too_large', message: `A snapshot is at most ${MAX_BYTES} bytes.` });
  }
  const out = await ingestSnapshot(c.env, await c.req.text());
  if (!out.ok) return refuse(c, out.status, { code: out.code, message: out.message });
  return c.json(out);
});

r.get('/in-flight', async (c) => {
  await requireSuperAdmin(c);
  return c.json(await latestSnapshot(c.env));
});

export const mount: RouteMount = { path: '/api/admin/workgraph', router: r };
export default r;
