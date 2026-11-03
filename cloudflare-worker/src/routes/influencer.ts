/**
 * D4289 P1 (#4290) — the member's side of the Influencer program, mounted at
 * /api/influencer. The rules are `services/influencers.ts`.
 *
 *   POST /api/influencer/apply   { channels: [{ kind, url, audience? }], regions, topics, why,
 *                                  consent_version, consent: { disclosure, no_deal_promotion, no_self_referral } }
 *                                → 201 { application } (200 when it answers HQ's question)
 *                                  409 already_influencer · application_open · reapply_later (with reapply_after)
 *   GET  /api/influencer/me      → { membership | null, application | null, reapply_after, consent_version }
 *   GET  /api/influencer/tiers   → { tiers: [{ tier, label, percentage_bps, duration_invoices, currency }] }
 *                                  public: the /influencers page's tier table reads the settings
 *                                  the Super Admin keeps (D4289 §1.7), never typed rates.
 *
 * D4289 P2 (#4291), the influencer's own handle and links (services/influencerHandles.ts):
 *   GET  /api/influencer/me/handle         → { handle, url, line, next_change_at, status }
 *   PUT  /api/influencer/me/handle         { handle?, line? } → the same; 409 handle_change_too_soon (with
 *                                          next_change_at), handle_taken; 400 handle_invalid, handle_reserved
 *   GET  /api/influencer/me/links          → { handle, links: [{ uid, channel, utm_campaign, url }] }
 *   POST /api/influencer/me/links          { channel, utm_campaign? } → 201 { link }; 409 channel_taken, links_full
 *   DELETE /api/influencer/me/links/:uid   → 204 (archived, never deleted)
 *
 * The program runs at HQ: on a branch, applying is refused 409 `hq_program`.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { branchOf } from '../util/branch';
import { InfluencerRefusal, applyAsInfluencer, influencerMe, tierDefaults } from '../services/influencers';
import { HandleRefusal, addLink, archiveLink, handleView, listLinks, memberByUser, setHandle } from '../services/influencerHandles';

const r = new Hono<{ Bindings: Env }>();

function answer(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof InfluencerRefusal || e instanceof HandleRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  console.error('[influencer] read or write failed', (e as Error)?.message);
  return refuse(c, 503, { code: 'influencer_unreadable', message: 'Your influencer application could not be read or saved. Nothing was changed; try again.' });
}

r.post('/apply', async (c) => {
  const user = await requireAuth(c);
  if (branchOf(c.env)) return refuse(c, 409, { code: 'hq_program', message: 'The Influencer program runs at Axal HQ. Apply on axal.vc.' });
  const b = await c.req.json().catch(() => null);
  try {
    const application = await applyAsInfluencer(c.env, Number(user.id), b);
    return c.json({ application }, application.status === 'applied' && application.created_at === application.updated_at ? 201 : 200);
  } catch (e) { return answer(c, e); }
});

r.get('/me', async (c) => {
  const user = await requireAuth(c);
  try { return c.json(await influencerMe(c.env, Number(user.id))); } catch (e) { return answer(c, e); }
});

r.get('/tiers', async (c) => {
  try {
    const tiers = await tierDefaults(c.env);
    return c.json({ tiers: tiers.map(({ tier, label, percentage_bps, duration_invoices, currency }) => ({ tier, label, percentage_bps, duration_invoices, currency })) });
  } catch (e) {
    console.error('[influencer] tier defaults unreadable', (e as Error)?.message);
    return refuse(c, 503, { code: 'tiers_unreadable', message: 'The tiers could not be read. That is not the same as having none.' });
  }
});

r.get('/me/handle', async (c) => {
  const user = await requireAuth(c);
  try {
    const m = await memberByUser(c.env, Number(user.id));
    if (!m) return refuse(c, 404, { code: 'not_influencer', message: 'Only an Axal influencer has a handle.' });
    return c.json(handleView(m, Date.now()));
  } catch (e) { return answer(c, e); }
});

r.put('/me/handle', async (c) => {
  const user = await requireAuth(c);
  const b = await c.req.json().catch(() => null);
  try { return c.json(await setHandle(c.env, Number(user.id), b)); } catch (e) { return answer(c, e); }
});

r.get('/me/links', async (c) => {
  const user = await requireAuth(c);
  try { return c.json(await listLinks(c.env, Number(user.id))); } catch (e) { return answer(c, e); }
});

r.post('/me/links', async (c) => {
  const user = await requireAuth(c);
  const b = await c.req.json().catch(() => null);
  try { return c.json({ link: await addLink(c.env, Number(user.id), b) }, 201); } catch (e) { return answer(c, e); }
});

r.delete('/me/links/:uid', async (c) => {
  const user = await requireAuth(c);
  try { await archiveLink(c.env, Number(user.id), c.req.param('uid')); return c.body(null, 204); } catch (e) { return answer(c, e); }
});

export const mount: RouteMount = { path: '/api/influencer', router: r };
export default r;
