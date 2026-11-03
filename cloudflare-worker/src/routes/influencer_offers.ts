/**
 * D4293 (#4293, D4289 P4 of #4289) — influencer offers. Two routers:
 *
 *   HQ, mounted at `/api/admin/influencers` (Super Admin; writes take the write bar,
 *   as Promos does, and each is audited with a reason):
 *     GET   /:uid/offers                the influencer's offers, as their own read shows them
 *     POST  /:uid/offers                { promo_id, budget_cents, currency, featured?, reason } link a Promos code
 *     PATCH /:uid/offers/:offerUid      { status?, budget_cents?, featured?, reason } pause, resume, end, re-budget
 *
 *   The influencer, mounted at `/api/influencer/me/offers`:
 *     GET   /                           IN3: plans, discount, who it is for, uses, discount given, remaining budget, end date, status
 *     POST  /request                    { message } "Ask HQ for an offer"; HQ is notified
 *
 * `:uid` is the influencer's account uid (`users.uid`). P1 (#4290) owns the
 * rest of both prefixes; these paths are this part's only. The rules live in
 * `services/influencerOffers.ts`.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { changeOffer, linkOffer, offersRead, readLinkInput, requestOffer } from '../services/influencerOffers';

type Ctx = Context<{ Bindings: Env }>;
const UID = /^[A-Za-z0-9_-]{1,64}$/;
const REASON_MIN = 10;

async function body(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {};
  } catch { return {}; }
}

/** The influencer's account by uid: a member HQ has made a referral partner (P1 adds the influencers segment). */
async function influencerByUid(env: Env, uid: string): Promise<number | null> {
  if (!UID.test(uid)) return null;
  const row = await env.DB.prepare('SELECT u.id FROM users u JOIN referral_partners p ON p.user_id = u.id WHERE u.uid = ?').bind(uid).first<{ id: number }>();
  return row ? Number(row.id) : null;
}
const notInfluencer = (c: Ctx) => refuse(c, 404, { code: 'influencer_not_found', message: 'There is no influencer with that account.' });
const reasonOf = (b: Record<string, unknown>) => (typeof b.reason === 'string' ? b.reason.trim() : '');
const needsReason = (c: Ctx) => refuse(c, 400, { code: 'reason_required', message: `Say why, in at least ${REASON_MIN} characters.` });

const admin = new Hono<{ Bindings: Env }>();

admin.get('/:uid/offers', async (c) => {
  await requireSuperAdmin(c);
  const id = await influencerByUid(c.env, c.req.param('uid'));
  if (!id) return notInfluencer(c);
  return c.json(await offersRead(c.env, id));
});

admin.post('/:uid/offers', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = await influencerByUid(c.env, c.req.param('uid'));
  if (!id) return notInfluencer(c);
  const b = await body(c);
  const reason = reasonOf(b);
  if (reason.length < REASON_MIN) return needsReason(c);
  const input = readLinkInput(b);
  if ('code' in input) return refuse(c, input.status, { code: input.code, message: input.message });
  const r = await linkOffer(c.env, actor.id, id, input);
  if ('code' in r) return refuse(c, r.status, { code: r.code, message: r.message });
  await logAdminAction(c.env, actor.id, actor.email, 'influencer_offer_linked', {
    target_user_id: id, offer_uid: r.offer.uid, promo_id: r.offer.promo_id, budget_cents: r.offer.budget_cents, currency: r.offer.currency, featured: r.offer.featured === 1, reason,
  });
  return c.json({ offer: r.offer }, 201);
});

admin.patch('/:uid/offers/:offerUid', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  const id = await influencerByUid(c.env, c.req.param('uid'));
  if (!id) return notInfluencer(c);
  const offerUid = c.req.param('offerUid');
  if (!UID.test(offerUid)) return refuse(c, 404, { code: 'offer_not_found', message: 'That offer is not this influencer’s.' });
  const b = await body(c);
  const reason = reasonOf(b);
  if (reason.length < REASON_MIN) return needsReason(c);
  const r = await changeOffer(c.env, id, offerUid, b);
  if ('code' in r) return refuse(c, r.status, { code: r.code, message: r.message });
  await logAdminAction(c.env, actor.id, actor.email, 'influencer_offer_changed', {
    target_user_id: id, offer_uid: offerUid,
    before: { status: r.before.status, budget_cents: r.before.budget_cents, featured: r.before.featured === 1 },
    after: { status: r.offer.status, budget_cents: r.offer.budget_cents, featured: r.offer.featured === 1 },
    reason,
  });
  return c.json({ offer: r.offer });
});

const mine = new Hono<{ Bindings: Env }>();

mine.get('/', async (c) => {
  const user = await requireAuth(c);
  return c.json(await offersRead(c.env, user.id));
});

mine.post('/request', async (c) => {
  const user = await requireAuth(c);
  const partner = await c.env.DB.prepare('SELECT 1 FROM referral_partners WHERE user_id = ?').bind(user.id).first();
  if (!partner) return refuse(c, 403, { code: 'not_influencer', message: 'Only an admitted influencer can ask HQ for an offer.' });
  const b = await body(c);
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > 2000) return refuse(c, 400, { code: 'message_required', message: 'Say what offer you would like, in up to 2,000 characters.' });
  return c.json(await requestOffer(c.env, user.id, message), 201);
});

export const mount: RouteMount[] = [
  { path: '/api/admin/influencers', router: admin },
  { path: '/api/influencer/me/offers', router: mine },
];
