/**
 * D4289 P1 (#4290) — HQ's side of the Influencer program, mounted at
 * /api/admin/influencers. An HQ admin (`requireHqAdmin`; a branch is refused).
 * The rules are `services/influencers.ts`.
 *
 *   GET   /?status=active|paused|ended|all&limit=   D4298 (#4298): the Influencers table (services/influencers.ts
 *         `listInfluencers`): each membership with its person, handle, sign-ups, and commission per
 *         currency for the Super Admin only (an admin reads `hq_reads`) → { influencers, counts }
 *   GET   /applications?status=applied|more_requested|admitted|declined|withdrawn|open|all&limit=
 *         → { applications: [{ …, applicant: { user_id, name, role } }], counts: { applied, more_requested } }
 *   POST  /applications/:uid/decision  { admit: tier } | { decline: reason } | { more: question }
 *         → { application, membership | null, terms_uid? }
 *   PATCH /:uid  { tier?, status?: active|paused|ended, reason }  → { membership, events }
 *   GET   /tier-defaults                → { tiers }  (Settings; new terms copy them)
 *   GET   /flags?outcome=held|refused|cleared|upheld|all&limit=   D4289 P2 (#4291): the flagged sign-ups
 *         (self-referral, loops, a handle's daily cap) → { flags }
 *   POST  /flags/:uid/decision  { decision: clear|uphold, reason }  a held sign-up: clear makes its
 *         attribution active, uphold refuses it → { flag }
 *   PUT   /tier-defaults/:tier  { percentage_bps?, duration_invoices?, offer_budget_cents?, currency? }
 *         the Super Admin only, behind the write bar → { tier }
 *
 * Every write is in the admin audit (`logAdminAction`) and tells the member
 * (`notify`, in-app and email), after it is saved: a notice that fails never
 * undoes the decision.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { isSuperAdmin, requireHqAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { notify } from '../services/notify';
import { decideFlag, listFlags } from '../services/referrals/handleAttribution';
import {
  APPLICATION_FILTERS, REASON_MAX, REASON_MIN, INFLUENCER_ACTIONS, InfluencerRefusal, TIER_LABEL, changeInfluencer, decideApplication, isTier,
  MEMBER_FILTERS, listApplications, listInfluencers, readChange, readDecision, tierDefaults, writeTierDefault,
} from '../services/influencers';

const r = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

function answer(c: Ctx, e: unknown) {
  if (e instanceof InfluencerRefusal) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: e.extra });
  console.error('[admin_influencers] read or write failed', (e as Error)?.message);
  return refuse(c, 503, { code: 'influencers_unreadable', message: 'The Influencer program could not be read or saved. Read it again before retrying.' });
}

/** Tell the member, after the write. A notice that fails is logged, never thrown. */
async function tell(env: Env, userId: number, type: string, title: string, body: string, link: string) {
  try { await notify(env, { userId, type, title, body, link, channels: ['in_app', 'email'] }); }
  catch (e) { console.error('[admin_influencers] notice failed', (e as Error)?.message); }
}

r.get('/', async (c) => {
  const admin = await requireHqAdmin(c);
  const raw = c.req.query('status') || 'all';
  if (!(MEMBER_FILTERS as readonly string[]).includes(raw)) {
    return refuse(c, 400, { code: 'invalid_status', message: 'Filter by active, paused, ended or all.' });
  }
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
  try { return c.json(await listInfluencers(c.env, raw as typeof MEMBER_FILTERS[number], isSuperAdmin(admin), limit)); } catch (e) { return answer(c, e); }
});

r.get('/applications', async (c) => {
  await requireHqAdmin(c);
  const status = (c.req.query('status') || 'open') as typeof APPLICATION_FILTERS[number];
  if (!(APPLICATION_FILTERS as readonly string[]).includes(status)) {
    return refuse(c, 400, { code: 'invalid_status', message: `status is one of ${APPLICATION_FILTERS.join(', ')}.` });
  }
  const raw = c.req.query('limit');
  const limit = raw == null || raw === '' ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return refuse(c, 400, { code: 'invalid_limit', message: 'limit is from 1 to 200.' });
  try { return c.json(await listApplications(c.env, status, limit)); } catch (e) { return answer(c, e); }
});

r.post('/applications/:uid/decision', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null);
  try {
    const decision = readDecision(b);
    const out = await decideApplication(c.env, Number(admin.id), c.req.param('uid'), decision);
    const userId = Number((await c.env.DB.prepare('SELECT user_id FROM influencer_applications WHERE uid = ?').bind(c.req.param('uid')).first<{ user_id: number }>())?.user_id);
    const action = decision.kind === 'admit' ? INFLUENCER_ACTIONS.admitted : decision.kind === 'decline' ? INFLUENCER_ACTIONS.declined : INFLUENCER_ACTIONS.more;
    await logAdminAction(c.env, Number(admin.id), admin.email, action, {
      program_key: 'influencer', application_uid: c.req.param('uid'), target_user_id: userId,
      ...(decision.kind === 'admit' ? { tier: decision.tier, terms_uid: out.terms_uid } : {}),
      ...(decision.kind === 'decline' ? { reason: decision.reason } : {}),
      ...(decision.kind === 'more' ? { question: decision.question } : {}),
    });
    if (decision.kind === 'admit') {
      await tell(c.env, userId, 'influencer_admitted', 'You are an Axal influencer',
        `HQ admitted you as ${TIER_LABEL[decision.tier]}. Your terms are being prepared for you to sign, and Investor Pro is yours while you are active.`, '/influencer');
    } else if (decision.kind === 'decline') {
      await tell(c.env, userId, 'influencer_declined', 'Your influencer application',
        `HQ declined your application. Reason: ${decision.reason} You can apply again after 90 days.`, '/referrals');
    } else {
      await tell(c.env, userId, 'influencer_more_requested', 'HQ asked about your influencer application',
        `HQ asked: ${decision.question} Answer by updating your application.`, '/referrals');
    }
    return c.json(out);
  } catch (e) { return answer(c, e); }
});

const FLAG_OUTCOMES = ['held', 'refused', 'cleared', 'upheld', 'all'] as const;

r.get('/flags', async (c) => {
  await requireHqAdmin(c);
  const outcome = c.req.query('outcome') || 'held';
  if (!(FLAG_OUTCOMES as readonly string[]).includes(outcome)) return refuse(c, 400, { code: 'invalid_outcome', message: `outcome is one of ${FLAG_OUTCOMES.join(', ')}.` });
  const raw = c.req.query('limit');
  const limit = raw == null || raw === '' ? 100 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return refuse(c, 400, { code: 'invalid_limit', message: 'limit is from 1 to 200.' });
  try { return c.json(await listFlags(c.env, outcome, limit)); } catch (e) { return answer(c, e); }
});

r.post('/flags/:uid/decision', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null) as any;
  const decision = b?.decision;
  if (decision !== 'clear' && decision !== 'uphold') return refuse(c, 400, { code: 'invalid_decision', message: 'decision is clear or uphold.' });
  const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return refuse(c, 400, { code: 'reason_required', message: `A decision needs a reason of ${REASON_MIN} to ${REASON_MAX} characters.` });
  try {
    const out = await decideFlag(c.env, Number(admin.id), c.req.param('uid'), decision, reason);
    if (out.status !== 200) return refuse(c, out.status, { code: out.code, message: out.sentence });
    await logAdminAction(c.env, Number(admin.id), admin.email, INFLUENCER_ACTIONS.flag, { program_key: 'influencer', flag_uid: c.req.param('uid'), decision, reason });
    return c.json({ flag: out.flag });
  } catch (e) { return answer(c, e); }
});

r.get('/tier-defaults', async (c) => {
  await requireHqAdmin(c);
  try { return c.json({ tiers: await tierDefaults(c.env) }); } catch (e) { return answer(c, e); }
});

r.put('/tier-defaults/:tier', async (c) => {
  const admin = await requireHqAdmin(c);
  // The rates are money: the Super Admin's, and the bar first (O-MONEY A).
  if (!isSuperAdmin(admin)) return refuse(c, 403, { code: 'super_admin_required', message: 'Only the Super Admin changes the tier defaults.' });
  await requireSuperAdminWriteBar(c);
  const tier = c.req.param('tier');
  if (!isTier(tier)) return refuse(c, 404, { code: 'tier_not_found', message: 'That tier has no defaults.' });
  const b = await c.req.json().catch(() => null);
  try {
    const out = await writeTierDefault(c.env, tier, b, Number(admin.id));
    await logAdminAction(c.env, Number(admin.id), admin.email, INFLUENCER_ACTIONS.defaults, { program_key: 'influencer', tier, before: out.before, after: out.after });
    return c.json({ tier: out.after });
  } catch (e) { return answer(c, e); }
});

r.patch('/:uid', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null);
  try {
    const change = readChange(b);
    const out = await changeInfluencer(c.env, Number(admin.id), c.req.param('uid'), change);
    const userId = Number((await c.env.DB.prepare('SELECT user_id FROM influencers WHERE uid = ?').bind(c.req.param('uid')).first<{ user_id: number }>())?.user_id);
    for (const ev of out.events) {
      const action = ev === 'handle_taken_down' ? INFLUENCER_ACTIONS.takedown : ev === 'tier_changed' ? INFLUENCER_ACTIONS.tier
        : ev === 'paused' ? INFLUENCER_ACTIONS.paused : ev === 'resumed' ? INFLUENCER_ACTIONS.resumed : INFLUENCER_ACTIONS.ended;
      await logAdminAction(c.env, Number(admin.id), admin.email, action, {
        program_key: 'influencer', influencer_uid: c.req.param('uid'), target_user_id: userId, before: out.before,
        after: { tier: out.membership.tier, status: out.membership.status }, reason: change.reason,
      });
    }
    const m = out.membership;
    const what = out.events.includes('ended') ? 'HQ ended your influencer membership.'
      : out.events.includes('handle_taken_down') && out.events.length === 1 ? 'HQ took your handle down. Choose a new one in your Influencer section.'
      : out.events.includes('paused') ? 'HQ paused your influencer membership. Your link does not earn while paused.'
        : out.events.includes('resumed') ? 'HQ resumed your influencer membership.'
          : `HQ changed your tier to ${m.tier_label}.`;
    await tell(c.env, userId, 'influencer_changed', 'Your influencer membership changed', `${what} Reason: ${change.reason}`, '/influencer');
    return c.json(out);
  } catch (e) { return answer(c, e); }
});

export const mount: RouteMount = { path: '/api/admin/influencers', router: r };
export default r;
