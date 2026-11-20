/** D7845 (#7845): owner-private atomic fund shortlist saves and request reconciliation. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import research from './research';
import clientPrep from './research_client_prep';
import { FundShortlistError, readFundShortlistSave, saveFundShortlist } from '../services/researchMyFunds';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
const shortlist = new Hono<{ Bindings: Env }>();
function failure(c: Parameters<typeof refuse>[0], error: unknown) {
  if (error instanceof FundShortlistError) return refuse(c, error.status, { code: error.code, message: error.sentence, extra: error.extra });
  return refuse(c, 503, { code: 'save_outcome_unknown', message: 'The save outcome could not be read. Check the request id before trying again.', raw: error });
}
shortlist.post('/', async c => {
  const user = await requireAuth(c); // Same gate as POST /api/research/funds; owner comes only from auth.
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = await saveFundShortlist(c.env, user.id, body?.catalogue_ids, body?.request_id);
    return c.json(result, result.repeat ? 200 : 201);
  } catch (error) { return failure(c, error); }
});
shortlist.get('/requests/:requestId', async c => {
  const user = await requireAuth(c);
  try { return c.json(await readFundShortlistSave(c.env, user.id, c.req.param('requestId'))); }
  catch (error) { return failure(c, error); }
});
export const mount: RouteMount = { path: '/api/research/fund-shortlist', router: shortlist, before: [clientPrep, research] };
export default shortlist;
