/**
 * D5837 (#5837): the founder pins one line of one exact ledger statement revision to a Raise claim, as Private
 * evidence (`services/raiseLedgerEvidence.ts`), mounted at /api/raise-ledger-evidence.
 *
 *   GET  /?project=                          the founder's selections (each fact kept, its source now: current,
 *                                            corrected, access_revoked or deleted) and the lines that may be chosen
 *   POST /selections?project=                pin { snapshot_uid, source_key, amount, currency, basis, observed_on, claim_id }
 *   POST /selections/:uid/review?project=    re-review a corrected figure onto the latest revision (a new Private item)
 *   POST /selections/:uid/withdraw?project=  withdraw: unpinned, Private, out of every claim
 *
 * WHO. Signed in, not a support session, in the venture's company, and the venture's founder (D1263's evidence
 * gate, `raiseEvidenceContext`). Every read and write is the founder's: an admin, a co-founder member, an advisor,
 * an investor or a stranger is refused, so no statement line reaches them here. Sharing beyond Private stays on the
 * existing evidence routes (`PATCH /api/cycles/raise/evidence/items/:id`).
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { isSupportSession } from '../integrations/providers/mercury';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { RaiseEvidenceError, raiseEvidenceContext, type RaiseEvidenceContext } from '../services/raiseEvidence';
import { LedgerEvidenceError, pinLedgerFact, readLedgerEvidence, reviewLedgerFact, withdrawLedgerFact } from '../services/raiseLedgerEvidence';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

async function founder(c: Ctx): Promise<RaiseEvidenceContext | Response> {
  c.header('Cache-Control', 'private, no-store');
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to continue.' }); }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return refuse(c, 400, { code: 'project_required', message: 'Choose a venture first.' });
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'Ledger evidence is unavailable in a support session.' });
  const company = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  if (c.req.header(ACTIVE_COMPANY_HEADER) && company == null) return refuse(c, 403, { code: 'company_selection_refused', message: 'Switch to this venture’s company first.' });
  const ctx = await raiseEvidenceContext(c.env, user, Number(raw), company);
  if (!ctx.founder) throw new LedgerEvidenceError('forbidden', 403);
  return ctx;
}

function failure(c: Ctx, e: unknown) {
  if (e instanceof LedgerEvidenceError) return refuse(c, e.status, { code: e.code, message: e.sentence });
  // An unknown venture and one the caller may not open answer alike.
  if (e instanceof RaiseEvidenceError) return e.code === 'not_found' || e.code === 'forbidden'
    ? refuse(c, 404, { code: 'not_found', message: 'That venture is not available.' })
    : refuse(c, e.status, { code: e.code, message: e.sentence });
  return refuse(c, 503, { code: 'unreadable', message: 'The ledger evidence could not be read or saved. Nothing was saved; try again.', raw: e });
}
async function json(c: Ctx): Promise<unknown> {
  return c.req.json().catch(() => { throw new LedgerEvidenceError('invalid', 400); });
}

r.get('/', async (c) => {
  try { const ctx = await founder(c); if (ctx instanceof Response) return ctx; return c.json(await readLedgerEvidence(ctx)); }
  catch (e) { return failure(c, e); }
});
r.post('/selections', async (c) => {
  try { const ctx = await founder(c); if (ctx instanceof Response) return ctx; return c.json(await pinLedgerFact(ctx, await json(c)), 201); }
  catch (e) { return failure(c, e); }
});
r.post('/selections/:uid/review', async (c) => {
  try { const ctx = await founder(c); if (ctx instanceof Response) return ctx; return c.json(await reviewLedgerFact(ctx, c.req.param('uid'), await json(c)), 201); }
  catch (e) { return failure(c, e); }
});
r.post('/selections/:uid/withdraw', async (c) => {
  try { const ctx = await founder(c); if (ctx instanceof Response) return ctx; return c.json(await withdrawLedgerFact(ctx, c.req.param('uid'))); }
  catch (e) { return failure(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/raise-ledger-evidence', router: r };
