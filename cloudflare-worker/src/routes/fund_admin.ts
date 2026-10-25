/**
 * D714 (#1779) — the fund administration console's Worker routes, mounted at
 * `/api/fund-admin`.
 *
 * `GET /access` answers which fund acts this admin may take, straight from
 * `FUND_ACTS` (`services/fundAdminAccess.ts`): `requireAdmin`, HQ only, never
 * a support session. The screens draw their controls from it; the Worker
 * still decides each act on its own route.
 *
 * `GET /overview` (decision 9) is the console's first screen, read from the
 * stores only, behind the same gate, with #1775's read-audit row written
 * before any figure (`services/fundAdminOverview.ts`).
 *
 * `GET /lps` (D1158) is FND5: every LP of every administered fund, filtered,
 * searched, sorted and paged on the Worker, behind the same gate, audited
 * first (`services/fundAdminLps.ts`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { fundAdminAccess, requireFundAdminReader } from '../services/fundAdminAccess';
import { AUDIT_UNAVAILABLE, fundAdminOverview } from '../services/fundAdminOverview';
import { fundAdminLps, parseLpQuery } from '../services/fundAdminLps';

const fundAdmin = new Hono<{ Bindings: Env }>();

fundAdmin.get('/access', async (c) => c.json(await fundAdminAccess(c)));

fundAdmin.get('/overview', async (c) => {
  const user = await requireFundAdminReader(c);
  const overview = await fundAdminOverview(c.env, user, new Date().toISOString().slice(0, 10));
  if (!overview) return c.json(AUDIT_UNAVAILABLE, 503);
  return c.json(overview);
});

fundAdmin.get('/lps', async (c) => {
  const user = await requireFundAdminReader(c);
  const query = parseLpQuery((k) => c.req.query(k));
  if (typeof query === 'string') return c.json({ code: 'invalid_lp_query', detail: `The ${query} filter is not valid.` }, 400);
  const roster = await fundAdminLps(c.env, user, query, new Date().toISOString().slice(0, 10));
  if (!roster) return c.json(AUDIT_UNAVAILABLE, 503);
  if (roster === 'fund_not_administered') return c.json({ code: 'fund_not_administered', detail: 'This fund is not administered here.' }, 404);
  return c.json(roster);
});

export default fundAdmin;
