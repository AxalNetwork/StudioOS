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
 * first (`services/fundAdminLps.ts`). D1162 adds `?lp=<id>`, one LP's row for
 * FND6's drawer, and each row's booklet uid.
 *
 * `GET /activity` (D4812) is the Overview's Recent activity: the fund acts HQ
 * admins took, newest first, from `admin_audit_log` (`services/fundAdminActivity.ts`),
 * behind the same gate. `?fund=` keeps one fund; `?before=` pages back.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { fundAdminAccess, requireFundAdminReader } from '../services/fundAdminAccess';
import { AUDIT_UNAVAILABLE, fundAdminOverview } from '../services/fundAdminOverview';
import { fundAdminLps, parseLpQuery } from '../services/fundAdminLps';
import { fundAdminActivity, parseActivityQuery } from '../services/fundAdminActivity';

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

fundAdmin.get('/activity', async (c) => {
  await requireFundAdminReader(c);
  const query = parseActivityQuery((k) => c.req.query(k));
  if (typeof query === 'string') return c.json({ code: 'invalid_activity_query', detail: `The ${query} parameter is not valid.` }, 400);
  try {
    return c.json(await fundAdminActivity(c.env, query));
  } catch (e) {
    console.warn('[fund_admin] activity unreadable', (e as Error).message);
    return c.json({ code: 'fund_activity_unreadable', detail: 'Recent activity could not be read.' }, 503);
  }
});

export default fundAdmin;
