/**
 * D5842 (#5842) — preview and recheck one founder-selected Search Console aggregate as Raise evidence, read from
 * D5840's stored rows by `services/raiseSearchConsoleEvidence.ts`, and (part 2) pin it to a claim as a Private item,
 * re-review it after a correction or withdraw it (`services/raiseSearchConsoleSelections.ts`). No route calls Google.
 *
 *   GET /api/cycles/raise/evidence/search-console/preview?project=&site_url=&week_start=&metric=&search_type=web
 *       → { preview: { state, reason, candidate, window, metric, coverage } }
 *   GET /api/cycles/raise/evidence/search-console/recheck?project=&source_ref=&snapshot_hash=&revision_key=
 *       → { recheck: { state, reason, requires_review, stale, original, revised, corrected_days, ... } }
 *   GET  /api/cycles/raise/evidence/search-console/selections?project=
 *       → { selections: [{ uid, status, aggregate, source: { state, original, revised, ... }, item, claim }] }
 *   POST /api/cycles/raise/evidence/search-console/selections?project=
 *       { site_url, week_start, metric, search_type, snapshot_hash, claim_id } → 201 { selection, repeated: false },
 *       or 200 { selection, repeated: true } when the same aggregate is already pinned to that claim
 *   POST /api/cycles/raise/evidence/search-console/selections/:uid/review?project=   { snapshot_hash, claim_id? } → 201
 *   POST /api/cycles/raise/evidence/search-console/selections/:uid/withdraw?project=  → 200
 *
 * Sharing beyond Private stays on the existing evidence item route (`PATCH /api/cycles/raise/evidence/items/:id`).
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
import { RaiseEvidenceError } from '../services/raiseEvidence';
import {
  SearchConsoleSelectionError, pinSearchConsoleAggregate, readSearchConsoleSelections, reviewSearchConsoleSelection, withdrawSearchConsoleSelection,
} from '../services/raiseSearchConsoleSelections';
import {
  SearchConsoleEvidenceRefusal, parseSearchConsoleReference, parseSearchConsoleSelection,
  previewSearchConsoleEvidence, recheckSearchConsoleEvidence,
} from '../services/raiseSearchConsoleEvidence';

const evidence = new Hono<{ Bindings: Env }>();

function failure(c: any, e: unknown) {
  if (e instanceof SearchConsoleEvidenceRefusal || e instanceof SearchConsoleSelectionError) return c.json({ error: e.code, message: e.sentence }, e.status);
  return evidenceFailure(c, e);
}
async function json(c: any): Promise<unknown> {
  return c.req.json().catch(() => { throw new RaiseEvidenceError('invalid', 400); });
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

evidence.get('/evidence/search-console/selections', async (c) => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await readSearchConsoleSelections(ctx)); }
  catch (e) { return failure(c, e); }
});
evidence.post('/evidence/search-console/selections', async (c) => {
  try {
    const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    const out = await pinSearchConsoleAggregate(ctx, await json(c));
    return c.json(out, out.repeated ? 200 : 201);
  } catch (e) { return failure(c, e); }
});
evidence.post('/evidence/search-console/selections/:uid/review', async (c) => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await reviewSearchConsoleSelection(ctx, c.req.param('uid'), await json(c)), 201); }
  catch (e) { return failure(c, e); }
});
evidence.post('/evidence/search-console/selections/:uid/withdraw', async (c) => {
  try { const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx; return c.json(await withdrawSearchConsoleSelection(ctx, c.req.param('uid'))); }
  catch (e) { return failure(c, e); }
});

export default evidence;

export const mount: RouteMount = { path: '/api/cycles/raise', router: evidence };
