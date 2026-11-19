/**
 * #6629 (D6629): the deal summary PDF an investor downloads from the deal page, and whether they may.
 *
 *   GET /api/deals/:id/summary       whether this investor may download it now, and the stamp it would carry
 *   GET /api/deals/:id/summary/pdf   the file (`services/dealSummary.ts`), recorded as a download
 *
 * Both run the same gate, in this order, on every request (a direct request to the file is gated as the menu is):
 *   1. a signed-in account that is not a support session, holding the Investor licence (`deal_context`'s rule);
 *   2. the firm the deal is read for (`X-Company-Id`, or the only firm), and the deal visible to this investor for
 *      that firm: invited or committed there, on a venture not deleted. Another firm's invitation opens nothing;
 *   3. a paid Investor plan: a Free reader reads the deal's Free projection, which this file goes beyond;
 *   4. an active NDA with the venture.
 * Access is read at download time, never remembered from the availability read: an invitation withdrawn or an NDA
 * ended since then refuses the file. Every file sent writes one `data_room_access_log` row
 * (`download_deal_summary`, no file id), the row an evidence open writes; when it cannot be written, no file is sent.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { selectJwt, requireAuth } from '../auth';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import dealContext, { context } from './deal_context';
import { effectiveInvestorTier, investorUpsell } from '../middleware/requireInvestorTier';
import { hasActiveVentureNda } from '../services/dealAccess';
import { buildDealSummary, renderDealSummaryPdf, stampFor, summaryFilename } from '../services/dealSummary';
import { logScorecard } from '../services/ventureScoring/access';

const r = new Hono<{ Bindings: Env }>();

/** The one sentence for each refusal the gate can give; the availability read returns it beside the code. */
export const SUMMARY_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  support_session_refused: 'A support session cannot download an investor’s deal summary.',
  investor_only: 'The deal summary is for investors on this deal.',
  invalid_deal: 'This is not a deal address.',
  firm_required: 'Choose the firm this deal is for.',
  deal_not_found: 'This deal is not open to you for the firm you chose.',
  investor_tier_required: 'The deal summary comes with a paid Investor plan.',
  nda_required: 'Sign the NDA with this venture to download its summary.',
});
export const DOWNLOAD_ACTION = 'download_deal_summary';

// Sign-in and the support-session refusal run here, outside the routes' own error handling, so a signed-out
// request reaches the app's handler (401) rather than reading as an unreadable summary.
const signedIn = async (c: any, next: () => Promise<void>) => {
  c.header('Cache-Control', 'no-store');
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return c.json({ error: 'support_session_refused', message: SUMMARY_REFUSALS.support_session_refused }, 403);
  }
  await requireAuth(c);
  await next();
};
r.use('/:id/summary', signedIn);
r.use('/:id/summary/pdf', signedIn);

type Gate = { refused: Response; code: string } | { refused: null; x: { user: any; company: number | null; id: number; deal: any } };
async function gate(c: any): Promise<Gate> {
  const x: any = await context(c);
  if ('error' in x) {
    const res: Response = x.error;
    const code = String((await res.clone().json().catch(() => ({})) as any)?.error ?? 'refused');
    return { refused: res, code };
  }
  if (effectiveInvestorTier(x.user) === 'free') {
    return { refused: c.json({ ...investorUpsell('plus'), message: SUMMARY_REFUSALS.investor_tier_required }, 402), code: 'investor_tier_required' };
  }
  if (!(await hasActiveVentureNda(c.env, Number(x.deal.project_id), x.user.id))) {
    return { refused: c.json({ error: 'nda_required', message: SUMMARY_REFUSALS.nda_required }, 403), code: 'nda_required' };
  }
  return { refused: null, x };
}

r.get('/:id/summary', async (c) => {
  try {
    const g = await gate(c);
    if (g.refused) return c.json({ available: false, code: g.code, reason: SUMMARY_REFUSALS[g.code] ?? 'The deal summary is not available to you.' });
    return c.json({ available: true, format: 'pdf', stamp: await stampFor(c.env, g.x.user, g.x.company) });
  } catch (e) {
    return refuse(c, 503, { code: 'summary_unreadable', message: 'Whether you can download the deal summary could not be read. Try again.', raw: e });
  }
});

r.get('/:id/summary/pdf', async (c) => {
  let g: Gate;
  try { g = await gate(c); } catch (e) {
    return refuse(c, 503, { code: 'summary_unreadable', message: 'Your access to this deal could not be checked, so nothing was downloaded. Try again.', raw: e });
  }
  if (g.refused) return g.refused;
  const { x } = g;
  const preparedOn = new Date().toISOString().slice(0, 10);
  let bytes: Uint8Array;
  let scopes = 0;
  try {
    const summary = await buildDealSummary(c.env, x, { preparedOn });
    scopes = summary.blocks.find((b) => b.key === 'scorecard' && b.state === 'recorded')?.rows?.length ?? 0;
    bytes = await renderDealSummaryPdf(summary);
  } catch (e) {
    return refuse(c, 503, { code: 'summary_unreadable', message: 'The deal summary could not be made, so nothing was downloaded. Try again.', raw: e });
  }
  // The download is recorded before the file leaves, as an evidence open is: no record, no file.
  try {
    await c.env.DB.prepare('INSERT INTO data_room_access_log(project_id,file_id,user_id,action,created_at) VALUES(?,NULL,?,?,?)')
      .bind(Number(x.deal.project_id), x.user.id, DOWNLOAD_ACTION, new Date().toISOString()).run();
  } catch (e) {
    return refuse(c, 503, { code: 'summary_unrecorded', message: 'The download could not be recorded, so the summary was not sent. Try again.', raw: e });
  }
  if (scopes) await logScorecard(c.env, { projectId: Number(x.deal.project_id), userId: x.user.id, action: 'venture_score_read',
    details: { viewer: 'investor', scopes, deal_id: x.id, masked: true, surface: 'deal_summary_pdf' }, role: 'investor' });
  return new Response(bytes, { status: 200, headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${summaryFilename(x.id, preparedOn)}"`,
    'Cache-Control': 'no-store',
  } });
});

// Ahead of the deal-context router, whose `/:id/...` reads share this prefix.
export const mount: RouteMount = { path: '/api/deals', router: r, before: [dealContext] };
export default r;
