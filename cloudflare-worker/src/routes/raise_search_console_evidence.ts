/**
 * D5842 (#5842) — preview and recheck one founder-selected Search Console aggregate as Raise evidence, read from
 * D5840's stored rows by `services/raiseSearchConsoleEvidence.ts`. Neither route calls Google or writes anything.
 *
 *   GET /api/cycles/raise/evidence/search-console/preview?project=&site_url=&week_start=&metric=&search_type=web
 *       → { preview: { state, reason, candidate, window, metric, coverage } }
 *   GET /api/cycles/raise/evidence/search-console/recheck?project=&source_ref=&snapshot_hash=&revision_key=
 *       → { recheck: { state, reason, requires_review, stale, original, revised, corrected_days, ... } }
 *
 * WHO. The venture's founders, through the Evidence gate (`evidenceScope(c, true)` in `cycle_raise.ts`): an admin,
 * an investor, a teammate who is not a founder and a support session are refused as on every evidence decision.
 * Both answer 503 `search_console_unavailable` until the owner's approval flag (`GOOGLE_SEARCH_CONSOLE_APPROVED`).
 *
 * Mounted by the route registry (#4105) under the Raise cycle's prefix; it names no path that router serves.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { evidenceFailure, evidenceScope } from './cycle_raise';
import {
  SearchConsoleEvidenceRefusal, parseSearchConsoleReference, parseSearchConsoleSelection,
  previewSearchConsoleEvidence, recheckSearchConsoleEvidence,
} from '../services/raiseSearchConsoleEvidence';

const evidence = new Hono<{ Bindings: Env }>();

function failure(c: any, e: unknown) {
  if (e instanceof SearchConsoleEvidenceRefusal) return c.json({ error: e.code, message: e.sentence }, e.status);
  return evidenceFailure(c, e);
}

evidence.get('/evidence/search-console/preview', async (c) => {
  try {
    const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    const q = c.req.query();
    const selection = parseSearchConsoleSelection({ site_url: q.site_url, week_start: q.week_start, metric: q.metric, search_type: q.search_type });
    return c.json({ preview: await previewSearchConsoleEvidence(ctx, selection) });
  } catch (e) { return failure(c, e); }
});

evidence.get('/evidence/search-console/recheck', async (c) => {
  try {
    const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    const q = c.req.query();
    const ref = parseSearchConsoleReference({ source_ref: q.source_ref, snapshot_hash: q.snapshot_hash, revision_key: q.revision_key });
    return c.json({ recheck: await recheckSearchConsoleEvidence(ctx, ref) });
  } catch (e) { return failure(c, e); }
});

export default evidence;

export const mount: RouteMount = { path: '/api/cycles/raise', router: evidence };
