import { acceptedOfferPeople, offerBetweenTies } from '../services/networkIntroOffers';
import { selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import { notify } from '../services/notify';
import { holdsLicence } from '../services/accountLicences';
import { askDestination, propositionDestination } from '../services/introDestination';
import { askRecipient, decideAsk, withdrawAsk, type AskDecision } from '../services/introAskDecisions';
/**
 * Task #6 (W-1) — Investor introduction requests with quarterly quota.
 *
 *   POST /api/introductions/request   — investor → founder. Decrements
 *                                       investor_quota_intros_used; returns
 *                                       402 with code:'quota_intros_exhausted'
 *                                       when at cap.
 *   GET  /api/introductions/quota     — caller's current usage / cap.
 *   GET  /api/introductions/          — caller's intro history, each ask's
 *                                       target named only where visible (D6260).
 *
 * D6261 (#6261), the owner's choice A — an ask can be answered:
 *
 *   POST /api/introductions/asks/:uid/withdraw         investor withdraws an
 *                                       unanswered ask; a slot spent this
 *                                       quarter is returned.
 *   GET  /api/introductions/asks/received              asks addressed to the
 *                                       caller as founder.
 *   POST /api/introductions/asks/received/:uid/accept  founder accepts.
 *   POST /api/introductions/asks/received/:uid/decline founder declines.
 *
 * Every write is a click by the person it belongs to, and each in-app notice
 * goes out only after one (the investor's Send ask, the founder's answer).
 * The statuses and their rules are in services/introAskDecisions.ts.
 *
 * The 3-way Founder/Investor/Axal NDA flow is owned by /api/trust/intro/*
 * (T3 Trust Center). An accepted ask carries `nda_founder_user_id`, and the
 * investor's Asked view starts that step with POST /api/trust/intro/request.
 * Acceptance is not an NDA signature and not a delivered introduction.
 *
 * ── Network Introductions (all user types) ─────────────────────────────────
 * The curated warm-intro surface under Network. Every authenticated user
 * (founder / investor / partner / advisor / …) receives matched propositions
 * and spends INTRODUCTION CREDITS to accept them. Backed by
 * services/introductions.ts (schema, credit ledger, scoring):
 *
 *   GET  /api/introductions/propositions           list (+ lazy generate/expire)
 *   POST /api/introductions/propositions/:uid/accept   spends 1 credit (402 when out)
 *   POST /api/introductions/propositions/:uid/decline  free
 *   GET  /api/introductions/credits                 balance breakdown
 *   GET  /api/introductions/credits/history         append-only ledger
 *   GET  /api/introductions/packs                   { packs: [], on_sale: false }: packs are retired (D755)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import type { User } from '../types';
import {
  ensureInvestorPaywallSchema,
  getIntroQuotaState,
  effectiveInvestorTier,
  nextInvestorTier,
  type InvestorUser,
} from '../middleware/requireInvestorTier';
import {
  ensureIntroNetworkSchema,
  getIntroCreditState,
  generateIntroPropositions,
  acceptIntroProposition,
} from '../services/introductions';
import { hashEmail } from '../util/hashEmail';
import { askTargets, type AskRow } from '../services/introAskTargets';

const introductions = new Hono<{ Bindings: Env }>();

introductions.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureInvestorPaywallSchema(c.env);
  await next();
});

// D6637: member offers reuse the two existing proposition response rows.
introductions.get('/offer-candidates',async c=>{
 const user=await requireAuth(c);
 if((await selectJwt(c))?.payload.impersonated_by)return refuse(c,403,{code:'support_session_refused',message:'A support session cannot choose a member’s introduction.'});
 const after=Number(c.req.query('after')||0);
 if(!Number.isSafeInteger(after)||after<0)return refuse(c,400,{code:'invalid_cursor',message:'Choose a valid accepted-tie page.'});
 try{return c.json(await acceptedOfferPeople(c.env,user.id,{after}));}catch{return refuse(c,503,{code:'ties_unreadable',message:'Your accepted ties could not be read. Try again.'});}
});
introductions.post('/offers',async c=>{
 const user=await requireAuth(c);
 if((await selectJwt(c))?.payload.impersonated_by)return refuse(c,403,{code:'support_session_refused',message:'A support session cannot offer a member’s introduction.'});
 const data=await c.req.json().catch(()=>null);
 const first=data?.first_user_id,second=data?.second_user_id;
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(second)||first<1||second<1||first===second||first===user.id||second===user.id)
   return refuse(c,400,{code:'invalid_pair',message:'Choose two different people from your accepted ties.'});
 try{
  await ensureIntroNetworkSchema(c.env);
  const candidates=await acceptedOfferPeople(c.env,user.id,{targets:[first,second]});
  if(!candidates.people.some(p=>p.id===first)||!candidates.people.some(p=>p.id===second))
    return refuse(c,403,{code:'accepted_ties_required',message:'Both people must be your accepted ties.'});
  let made:Awaited<ReturnType<typeof offerBetweenTies>>=null;
  try{made=await offerBetweenTies(c.env,user.id,first,second);}catch(e){if(!/UNIQUE|constraint/i.test(String(e)))throw e;}
  if(!made)return refuse(c,409,{code:'offer_unavailable',message:'These people already have an open proposition, or their tie status changed. Reload and try again.'});
  for(const [target,uid] of [[first,made.first_uid],[second,made.second_uid]] as const)try{await notify(c.env,{userId:target,type:'intro_proposition',category:'network',title:'An introduction was offered to you',body:'Review the proposition and choose whether to accept or decline.',link:propositionDestination(uid),payload:{proposition_uid:uid},channels:['in_app']});}catch{/* The recorded proposition remains in their list. */}
  return c.json({offered:true},201);
 }catch{return refuse(c,503,{code:'offer_failed',message:'The introduction could not be offered. Try again.'});}
});

introductions.get('/quota', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (!holdsLicence(user, 'investor') && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const state = await getIntroQuotaState(c.env, user.id);
  return c.json({
    tier: state.tier,
    quarter: state.quarter,
    used: state.used,
    cap: state.cap,
    remaining: Math.max(0, state.cap - state.used),
  });
});

introductions.get('/', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (!holdsLicence(user, 'investor') && user.role !== 'admin') {
    return c.json({ error: 'investor_only' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT uid, investor_user_id, founder_user_id, founder_id, project_id,
            message, status, quarter, created_at, decided_at, recipient_user_id
     FROM investor_introductions
     WHERE investor_user_id = ?
     ORDER BY created_at DESC LIMIT 200`
  ).bind(user.id).all<AskRow & Record<string, unknown>>();
  // D6261: the founder's account id is returned only once they accepted,
  // because the NDA step needs it; `answerable` says whether anyone can answer.
  const asks = (rows.results || []).map(({ recipient_user_id, ...a }) => ({
    ...a,
    answerable: recipient_user_id != null,
    nda_founder_user_id: a.status === 'accepted' && recipient_user_id != null ? Number(recipient_user_id) : null,
  }));
  // D6260: each ask names its target only when the caller may already see
  // that founder or project (D702's rules, services/introAskTargets.ts);
  // otherwise `target.available` is false and no name is sent.
  const named = await askTargets(c.env, user, asks);
  return c.json({
    introductions: asks.map((a, i) => ({ ...a, target: named.unreadable ? null : named.targets[i] })),
    ...(named.unreadable ? { targets_unreadable: true } : {}),
  });
});

introductions.post('/request', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (!holdsLicence(user, 'investor')) {
    return c.json({ error: 'investor_only' }, 403);
  }

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const founderUserId = body.founder_user_id != null ? Number(body.founder_user_id) : null;
  const founderId = body.founder_id != null ? Number(body.founder_id) : null;
  const projectId = body.project_id != null ? Number(body.project_id) : null;
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : null;

  if (!founderUserId && !founderId && !projectId) {
    return c.json({ error: 'target_required', message: 'Provide founder_user_id, founder_id, or project_id' }, 400);
  }

  // D6260 (#6260), the owner's choice B: refuse a target the investor could
  // not see, before any slot is spent. D702 counts an investor's own ask row
  // as reach, so an ask to a hidden founder or venture would otherwise make
  // it findable. The check is the Asked view's own join (D702's two rules),
  // run on each id the ask would store, since each id is reach on its own. A
  // hidden target and an unknown id get the same answer, so the refusal does
  // not say whether one exists.
  const named: AskRow[] = [
    ...(founderUserId ? [{ founder_user_id: founderUserId }] : []),
    ...(projectId ? [{ project_id: projectId }] : []),
    ...(founderId ? [{ founder_id: founderId }] : []),
  ];
  const reach = await askTargets(c.env, user, named);
  if (reach.unreadable) {
    return c.json({
      error: 'target_unreadable',
      message: 'Whether you can reach this founder or venture could not be read. No ask was sent and none was used. Try again.',
    }, 503);
  }
  if (!reach.targets.every((t) => t.available)) {
    return c.json({
      error: 'target_not_available',
      message: 'This founder or venture is not available to you. No ask was sent and none was used.',
    }, 404);
  }

  // D6261: the founder who may answer the ask, resolved before any slot is
  // spent. An ask to one's own founder account is refused here.
  let recipient: number | null;
  try {
    recipient = await askRecipient(c.env, { founder_user_id: founderUserId, founder_id: founderId, project_id: projectId });
  } catch (e) {
    console.error('[introductions] ask recipient unreadable', (e as Error).message);
    return c.json({
      error: 'target_unreadable',
      message: 'Whether you can reach this founder or venture could not be read. No ask was sent and none was used. Try again.',
    }, 503);
  }
  if (recipient === user.id) {
    return c.json({
      error: 'cannot_ask_self',
      message: 'You cannot ask for an introduction to yourself. No ask was sent and none was used.',
    }, 400);
  }

  // Quota check — paywall gate. Free investors get 3/quarter, Plus 10 (D1334), Pro 25, Inst 100.
  const state = await getIntroQuotaState(c.env, user.id);
  if (state.used >= state.cap) {
    return c.json(
      {
        error: 'quota_exceeded',
        code: 'quota_intros_exhausted',
        message: `You have used all ${state.cap} introductions for ${state.quarter}.`,
        used: state.used,
        cap: state.cap,
        tier: state.tier,
        upgrade_to: nextInvestorTier(state.tier),
        checkout_path: '/api/billing/investor/checkout',
      },
      402,
    );
  }

  // Atomic reserve-then-insert: bump counter first; if insert fails we
  // accept the (rare) wasted slot rather than risk double-spend on race.
  await c.env.DB.prepare(
    `UPDATE users SET investor_quota_intros_used = investor_quota_intros_used + 1
     WHERE id = ? AND investor_quota_intros_quarter = ?`
  ).bind(user.id, state.quarter).run();

  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO investor_introductions
       (uid, investor_user_id, founder_user_id, founder_id, project_id,
        message, status, quarter, recipient_user_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(uid, user.id, founderUserId, founderId, projectId, message, state.quarter, recipient).run();

  // D6261: the founder is told, in app, because the investor just clicked
  // Send ask. A failed notice does not undo the ask: it is in their list.
  // The 3-way NDA envelope (POST /api/trust/intro/request) is not minted
  // here. It comes after the founder accepts, when the investor starts it.
  let founderNotified = false;
  if (recipient !== null) {
    try {
      await notify(c.env, {
        userId: recipient,
        type: 'intro_ask',
        category: 'network',
        title: 'An investor asked for an introduction',
        body: `${user.name || 'An investor'} asked to be introduced to you. Accept or decline in Network, Introductions.`,
        link: askDestination(uid),
        payload: { ask_uid: uid },
        channels: ['in_app'],
      });
      founderNotified = true;
    } catch (e) {
      console.error('[introductions] founder ask notice failed', (e as Error).message);
    }
  }

  return c.json({
    ok: true,
    uid,
    used: state.used + 1,
    cap: state.cap,
    remaining: state.cap - state.used - 1,
    tier: effectiveInvestorTier(user),
    answerable: recipient !== null,
    founder_notified: founderNotified,
  });
});

// ── D6261: withdraw, and the founder's answer ───────────────────────────────

const ASK_UID = /^[A-Za-z0-9-]{1,64}$/;
const askNotFound = (c: any) => refuse(c, 404, { code: 'ask_not_found', message: 'That introduction ask is not here. Reload your list.' });
const askAnswered = (c: any, status?: string) => refuse(c, 409, {
  code: 'ask_already_answered',
  message: `That ask is no longer pending${status ? ` (it is ${status})` : ''}. Reload your list.`,
});
async function supportSession(c: any): Promise<boolean> {
  return Boolean((await selectJwt(c))?.payload.impersonated_by);
}

// POST /asks/:uid/withdraw — the investor's own pending ask only.
introductions.post('/asks/:uid/withdraw', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  if (await supportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot withdraw a member’s ask.' });
  const uid = c.req.param('uid');
  if (!ASK_UID.test(uid)) return askNotFound(c);
  const state = await getIntroQuotaState(c.env, user.id);
  const moved = await withdrawAsk(c.env, uid, user.id, state.quarter);
  if (!moved.ok) return moved.reason === 'not_found' ? askNotFound(c) : askAnswered(c, moved.status);
  const used = moved.slotReturned ? Math.max(0, state.used - 1) : state.used;
  return c.json({
    ok: true,
    uid,
    status: 'withdrawn',
    slot_returned: Boolean(moved.slotReturned),
    used,
    cap: state.cap,
    remaining: Math.max(0, state.cap - used),
    quarter: state.quarter,
    tier: state.tier,
  });
});

// GET /asks/received — the asks addressed to the caller as founder, newest first.
introductions.get('/asks/received', async (c) => {
  const user = (await requireAuth(c)) as User;
  const rows = await c.env.DB.prepare(
    `SELECT a.uid, a.message, a.status, a.quarter, a.created_at, a.decided_at,
            COALESCE(u.display_name, u.name) AS investor_name, u.headline AS investor_headline
       FROM investor_introductions a
       LEFT JOIN users u ON u.id = a.investor_user_id
      WHERE a.recipient_user_id = ?
      ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
  ).bind(user.id).all();
  return c.json({ asks: rows.results || [] });
});

async function answer(c: any, decision: AskDecision) {
  const user = (await requireAuth(c)) as User;
  if (await supportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot answer a member’s ask.' });
  if (!holdsLicence(user, 'founder')) return askNotFound(c);
  const uid = c.req.param('uid');
  if (!ASK_UID.test(uid)) return askNotFound(c);
  const moved = await decideAsk(c.env, uid, user.id, decision);
  if (!moved.ok) return moved.reason === 'not_found' ? askNotFound(c) : askAnswered(c, moved.status);
  if (moved.investorUserId) {
    try {
      await notify(c.env, {
        userId: moved.investorUserId,
        type: 'intro_ask_answered',
        category: 'network',
        title: decision === 'accepted' ? 'Your introduction ask was accepted' : 'Your introduction ask was declined',
        body: decision === 'accepted'
          ? `${user.name || 'The founder'} accepted your ask. Next is the mutual NDA, which you start from Network, Introductions. Nothing is signed yet.`
          : `${user.name || 'The founder'} declined your ask. The slot it used stays spent.`,
        link: askDestination(uid),
        payload: { ask_uid: uid, status: decision },
        channels: ['in_app'],
      });
    } catch (e) {
      console.error('[introductions] investor answer notice failed', (e as Error).message);
    }
  }
  return c.json({ ok: true, uid, status: decision });
}
introductions.post('/asks/received/:uid/accept', (c) => answer(c, 'accepted'));
introductions.post('/asks/received/:uid/decline', (c) => answer(c, 'declined'));

// ────────────────────────────────────────────────────────────────────────────
// Network Introductions — curated warm-intro propositions for ALL user types.
// Credits: one accepted introduction consumes one credit; declines are free.
// Buckets (allowance / referral-earned / purchased) live in
// intro_credit_ledger; see services/introductions.ts for the math.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Target-profile projection joined onto each proposition row.
 *
 * ══ THE COUNTERPART'S CONSENT WAS ALWAYS STORED AND NEVER RETURNED ═════════
 *
 * `generateIntroPropositions` writes a MIRROR row for every proposition —
 * `source = 'reciprocal'`, owned by the counterpart, pointing back at this user
 * — so the other side's decision has been in `intro_propositions` since
 * migration 150. The response returned only the caller's own `status`, and the
 * whole double-opt-in was therefore invisible: a page could say "you accepted"
 * and could not say whether anything had come of it. That is why
 * `network/introductions` sat in `profile_zone_filters.test.mjs`'s `excluded`
 * set, why the `pn2` artboard's `At a gate` tile had nothing to count, and why
 * its `Consent record` column could only ever have shown half a record.
 *
 * WHAT IS RETURNED IS THE CONSENT STATE AND ITS DATE, AND NOTHING ELSE. Not
 * the counterpart's score, not their breakdown, not the reasons the engine gave
 * them — those are their record. "They have agreed", "they have not answered",
 * "they declined", and when. That is precisely what a gate needs to be shown as
 * a gate rather than a warning, and it is a fact about the caller's own
 * introduction as much as about the other person.
 */
const PROPOSITION_SELECT = `
  SELECT p.uid, p.status, p.score, p.breakdown_json, p.source,
         p.expires_at, p.responded_at, p.created_at,
         (SELECT m.status FROM intro_propositions m
           WHERE m.user_id = p.target_user_id AND m.target_user_id = p.user_id
             AND ((p.source<>'offered' AND m.source<>'offered') OR (p.source='offered' AND m.source='offered'
               AND CASE WHEN json_valid(m.breakdown_json) THEN json_extract(m.breakdown_json,'$.offer_uid') END
                 = CASE WHEN json_valid(p.breakdown_json) THEN json_extract(p.breakdown_json,'$.offer_uid') END))
           ORDER BY m.id DESC LIMIT 1) AS counterpart_status,
         (SELECT m.responded_at FROM intro_propositions m
           WHERE m.user_id = p.target_user_id AND m.target_user_id = p.user_id
             AND ((p.source<>'offered' AND m.source<>'offered') OR (p.source='offered' AND m.source='offered'
               AND CASE WHEN json_valid(m.breakdown_json) THEN json_extract(m.breakdown_json,'$.offer_uid') END
                 = CASE WHEN json_valid(p.breakdown_json) THEN json_extract(p.breakdown_json,'$.offer_uid') END))
           ORDER BY m.id DESC LIMIT 1) AS counterpart_responded_at,
         t.kind AS terms_kind, t.fee_bps AS terms_fee_bps,
         t.made_at AS terms_made_at, t.outcome AS terms_outcome,
         u.uid AS target_uid, COALESCE(u.display_name, u.name) AS target_name,
         u.role AS target_role, u.headline AS target_headline,
         u.country AS target_country,
         CASE WHEN u.headshot_r2_key IS NOT NULL
              THEN '/api/settings/headshot/' || u.uid ELSE NULL END AS target_headshot_url,
         (SELECT persona_id FROM user_personas up
           WHERE up.user_id = u.id AND up.is_primary = 1 LIMIT 1) AS target_persona
    FROM intro_propositions p
    JOIN users u ON u.id = p.target_user_id
    LEFT JOIN intro_terms t ON t.proposition_uid = p.uid AND t.owner_user_id = p.user_id`;

function propositionDto(r: any) {
  let breakdown: any = null;
  try { breakdown = r.breakdown_json ? JSON.parse(r.breakdown_json) : null; } catch { /* keep null */ }
  return {
    uid: r.uid,
    status: r.status,
    score: r.source==='offered'?null:Math.round(Number(r.score) || 0),
    source: r.source,
    expires_at: r.expires_at,
    responded_at: r.responded_at,
    created_at: r.created_at,
    // NULL MEANS THERE IS NO MIRROR ROW, WHICH IS NOT THE SAME AS "PENDING".
    // A hand-curated (`source = 'admin'`) proposition has no counterpart row at
    // all, so the other side has never been asked — a page that rendered that
    // as "not yet answered" would be reporting a question nobody put.
    counterpart_status: r.counterpart_status ?? null,
    counterpart_responded_at: r.counterpart_responded_at ?? null,
    // The firm's own record of what this introduction is and what came of it,
    // or null. Never the counterpart's — `owner_user_id = p.user_id` in the
    // join above is what keeps one side's fee off the other side's screen.
    terms: r.terms_kind
      ? {
        kind: r.terms_kind,
        fee_bps: r.terms_fee_bps ?? null,
        made_at: r.terms_made_at ?? null,
        outcome: r.terms_outcome ?? null,
      }
      : null,
    breakdown: r.source==='offered'?null:breakdown,
    target: {
      uid: r.target_uid,
      name: r.target_name,
      role: r.target_role,
      headline: r.target_headline || null,
      country: r.target_country || null,
      headshot_url: r.target_headshot_url || null,
      persona: r.target_persona || null,
      profile_path: r.target_uid ? `/u/${r.target_uid}` : null,
    },
  };
}

// GET /propositions?status=pending|accepted|declined|expired&refresh=1
// Lazily expires stale rows and tops the list up from the matching engine
// when the user has fewer than 3 live propositions (or asks to refresh).
introductions.get('/propositions', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);

  // Lazy expiry — declining nothing, spending nothing.
  try {
    await c.env.DB.prepare(
      `UPDATE intro_propositions SET status = 'expired'
        WHERE user_id = ? AND status = 'pending'
          AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`,
    ).bind(user.id).run();
  } catch { /* best-effort */ }

  const wantRefresh = c.req.query('refresh') === '1';
  let generated = 0;
  try {
    const pendingRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM intro_propositions WHERE user_id = ? AND status = 'pending'`,
    ).bind(user.id).first<{ n: number }>();
    const pending = Number(pendingRow?.n || 0);
    if (wantRefresh || pending < 3) {
      generated = await generateIntroPropositions(c.env, user as any, { max: 5 });
    }
  } catch (e) {
    console.warn('[introductions] generation failed:', (e as Error).message);
  }

  const status = (c.req.query('status') || '').trim().toLowerCase();
  const wheres = ['p.user_id = ?'];
  const binds: unknown[] = [user.id];
  if (['pending', 'accepted', 'declined', 'expired'].includes(status)) {
    wheres.push('p.status = ?');
    binds.push(status);
  }
  const tail = `WHERE ${wheres.join(' AND ')}
      ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.score DESC, p.created_at DESC
      LIMIT 200`;
  let rows: { results?: unknown[] };
  try {
    rows = await c.env.DB.prepare(`${PROPOSITION_SELECT} ${tail}`).bind(...binds).all();
  } catch {
    // Older/dev DBs may lack the lazily-added identity columns
    // (display_name / headline / headshot_r2_key) or user_personas — degrade
    // to the guaranteed columns rather than 500ing the page.
    rows = await c.env.DB.prepare(
      `SELECT p.uid, p.status, p.score, p.breakdown_json, p.source,
              p.expires_at, p.responded_at, p.created_at,
              (SELECT m.status FROM intro_propositions m
                WHERE m.user_id = p.target_user_id AND m.target_user_id = p.user_id
             AND ((p.source<>'offered' AND m.source<>'offered') OR (p.source='offered' AND m.source='offered'
               AND CASE WHEN json_valid(m.breakdown_json) THEN json_extract(m.breakdown_json,'$.offer_uid') END
                 = CASE WHEN json_valid(p.breakdown_json) THEN json_extract(p.breakdown_json,'$.offer_uid') END))
                ORDER BY m.id DESC LIMIT 1) AS counterpart_status,
              (SELECT m.responded_at FROM intro_propositions m
                WHERE m.user_id = p.target_user_id AND m.target_user_id = p.user_id
             AND ((p.source<>'offered' AND m.source<>'offered') OR (p.source='offered' AND m.source='offered'
               AND CASE WHEN json_valid(m.breakdown_json) THEN json_extract(m.breakdown_json,'$.offer_uid') END
                 = CASE WHEN json_valid(p.breakdown_json) THEN json_extract(p.breakdown_json,'$.offer_uid') END))
                ORDER BY m.id DESC LIMIT 1) AS counterpart_responded_at,
              t.kind AS terms_kind, t.fee_bps AS terms_fee_bps,
              t.made_at AS terms_made_at, t.outcome AS terms_outcome,
              u.uid AS target_uid, u.name AS target_name, u.role AS target_role,
              NULL AS target_headline, NULL AS target_country,
              NULL AS target_headshot_url, NULL AS target_persona
         FROM intro_propositions p
         JOIN users u ON u.id = p.target_user_id
         LEFT JOIN intro_terms t ON t.proposition_uid = p.uid AND t.owner_user_id = p.user_id ${tail}`,
    ).bind(...binds).all();
  }

  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({
    propositions: (rows.results || []).map(propositionDto),
    credits,
    generated,
  });
});

// POST /propositions/:uid/accept — spends exactly one credit, atomically
// (D4606: `acceptIntroProposition`). The debit guards the chosen bucket's own
// balance, the row still being pending, and this uid never having been spent;
// a debit that loses a race is retried with a fresh bucket. Failures say why:
// 402 no_credits, 409 already_responded, 409 credit_conflict (retry, nothing spent).
introductions.post('/propositions/:uid/accept', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const uid = String(c.req.param('uid') || '').trim();
  if (!uid) return c.json({ error: 'uid_required' }, 400);

  const outcome = await acceptIntroProposition(c.env, user as any, uid);
  if (!outcome.ok) {
    if (outcome.error === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (outcome.error === 'already_responded') {
      return c.json({ error: 'already_responded', status: outcome.proposition_status }, 409);
    }
    if (outcome.error === 'credit_conflict') {
      c.header('Retry-After', '1');
      return c.json({
        error: 'credit_conflict', retryable: true,
        message: 'Another request changed your credits at the same moment. Nothing was spent. Try again.',
      }, 409);
    }
    return c.json(
      {
        error: 'no_credits',
        code: 'intro_credits_exhausted',
        message: 'You are out of introduction credits for now.',
        credits: outcome.credits,
        // D755 — packs are retired, so none is offered (#2079 removed the branch).
        refer_path: '/account/referrals',
      },
      402,
    );
  }
  const bucket = outcome.bucket;
  const prop = { target_user_id: Number(outcome.target_user_id) };

  // Audit trail (append-only, mirrors the products/redeem pattern).
  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       VALUES ('intro_accepted', ?, ?, ?)`,
    ).bind(
      JSON.stringify({ proposition_uid: uid, target_user_id: prop.target_user_id, bucket }),
      await hashEmail(user.email || ''),
      user.id,
    ).run();
  } catch { /* best-effort */ }

  // Tell the counterpart — and if both sides have now accepted, celebrate the
  // completed connection on both ends.
  try {
    const { notify } = await import('../services/notify');
    const accepterName = (user as any).display_name || user.name || 'A member';
    const mirror = await c.env.DB.prepare(
      `SELECT m.uid, m.status FROM intro_propositions m
       JOIN intro_propositions p ON p.uid=? AND p.user_id=?
       WHERE m.user_id=p.target_user_id AND m.target_user_id=p.user_id
         AND ((p.source<>'offered' AND m.source<>'offered') OR (p.source='offered' AND m.source='offered'
           AND CASE WHEN json_valid(m.breakdown_json) THEN json_extract(m.breakdown_json,'$.offer_uid') END
             = CASE WHEN json_valid(p.breakdown_json) THEN json_extract(p.breakdown_json,'$.offer_uid') END))
       ORDER BY m.id DESC LIMIT 1`,
    ).bind(uid, user.id).first<{ uid: string; status: string }>();
    if (mirror?.status === 'accepted') {
      const targetName = await c.env.DB.prepare(
        `SELECT COALESCE(display_name, name) AS n FROM users WHERE id = ?`,
      ).bind(prop.target_user_id).first<{ n: string | null }>().then((r) => r?.n || 'your match');
      await Promise.all([
        notify(c.env, {
          userId: prop.target_user_id,
          type: 'intro_connected',
          category: 'proactive_nudges',
          title: `Introduction complete — you're connected with ${accepterName}`,
          body: 'Both of you accepted. Open their profile to start the conversation.',
          link: propositionDestination(mirror.uid),
          payload: { proposition_uid: mirror.uid, counterpart_user_id: user.id },
          channels: ['in_app', 'email'],
        }),
        notify(c.env, {
          userId: user.id,
          type: 'intro_connected',
          category: 'proactive_nudges',
          title: `Introduction complete — you're connected with ${targetName}`,
          body: 'Both of you accepted. Open their profile to start the conversation.',
          link: propositionDestination(uid),
          payload: { proposition_uid: uid, counterpart_user_id: prop.target_user_id },
          channels: ['in_app'],
        }),
      ]);
      // D1342 (#3550): both accepted, so each may share their email address with the other.
      const { askBoth } = await import('../services/mail/shares');
      await askBoth(c.env, { id: Number(user.id), name: accepterName }, { id: Number(prop.target_user_id), name: targetName }, uid);
    } else {
      await notify(c.env, {
        userId: prop.target_user_id,
        type: 'intro_accepted',
        category: 'proactive_nudges',
        title: `${accepterName} accepted an introduction with you`,
        body: mirror
          ? 'Review the match on your side to complete the connection.'
          : 'Open Introductions to see the match.',
        link: propositionDestination(mirror?.uid),
        payload: { counterpart_user_id: user.id },
        channels: ['in_app'],
      });
    }
  } catch (e) {
    console.warn('[introductions] accept notify failed:', (e as Error).message);
  }

  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({ ok: true, uid, status: 'accepted', spent_bucket: bucket, credits });
});

// POST /propositions/:uid/decline — free, audited, no notification to the
// counterpart (declines stay private).
introductions.post('/propositions/:uid/decline', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const uid = String(c.req.param('uid') || '').trim();
  if (!uid) return c.json({ error: 'uid_required' }, 400);

  const r = await c.env.DB.prepare(
    `UPDATE intro_propositions
        SET status = 'declined', responded_at = datetime('now')
      WHERE uid = ? AND user_id = ? AND status = 'pending'`,
  ).bind(uid, user.id).run();
  if (!Number(r?.meta?.changes || 0)) {
    const row = await c.env.DB.prepare(
      `SELECT status FROM intro_propositions WHERE uid = ? AND user_id = ?`,
    ).bind(uid, user.id).first<{ status: string }>();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'already_responded', status: row.status }, 409);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       VALUES ('intro_declined', ?, ?, ?)`,
    ).bind(JSON.stringify({ proposition_uid: uid }), await hashEmail(user.email || ''), user.id).run();
  } catch { /* best-effort */ }

  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({ ok: true, uid, status: 'declined', credits });
});

/**
 * PUT /propositions/:uid/terms — what this introduction is, and what came of it.
 *
 * `Kind` AND `With economics` ARE THE SAME FIELD. The `pn2` artboard states it
 * plainly: "For a partner firm an introduction often carries economics, so every
 * row states whether it is a favour or a referral with a fee attached." A row
 * that says neither leaves a reader to guess, and the guess is worth money.
 *
 * ONE SIDE'S RECORD, ON ONE SIDE'S ROW. The proposition addressed to this user
 * is the only one they may write terms against — `owner_user_id` and the
 * ownership check below are the same rule twice, because a referral fee written
 * onto the counterpart's row would be one firm's claim rendered on the other's
 * screen as though both had agreed it.
 *
 * `made_at` IS WHAT SEPARATES `Made` FROM `Both agreed`. Two consents mean the
 * introduction MAY happen; this column says it did. Nothing infers one from the
 * other, which is why the artboard draws them as two of five states.
 */
introductions.put('/propositions/:uid/terms', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const uid = String(c.req.param('uid') || '').trim();
  const body = await c.req.json().catch(() => ({} as any));

  const own = await c.env.DB.prepare(
    `SELECT uid FROM intro_propositions WHERE uid = ? AND user_id = ?`,
  ).bind(uid, user.id).first<{ uid: string }>();
  // Not found rather than forbidden: whether a proposition exists between two
  // other people is not something a third party may learn by probing.
  if (!own) return c.json({ error: 'not_found' }, 404);

  const kind = String(body?.kind || '').trim();
  if (kind !== 'favour' && kind !== 'referral') return c.json({ error: 'kind_invalid' }, 400);
  let feeBps: number | null = null;
  if (kind === 'referral') {
    feeBps = Math.round(Number(body?.fee_bps));
    // The store's CHECK says the same thing; this says it with a message a
    // reader can act on rather than as a constraint failure.
    if (!Number.isInteger(feeBps) || feeBps <= 0 || feeBps > 10000) {
      return c.json({ error: 'fee_bps_required' }, 400);
    }
  }
  const madeAt = String(body?.made_at || '').trim();
  if (madeAt && !/^\d{4}-\d{2}-\d{2}$/.test(madeAt)) return c.json({ error: 'made_at_invalid' }, 400);
  const outcome = body?.outcome ? String(body.outcome).slice(0, 2000) : null;

  await c.env.DB.prepare(
    `INSERT INTO intro_terms (uid, proposition_uid, owner_user_id, kind, fee_bps, made_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (owner_user_id, proposition_uid) DO UPDATE SET
       kind = excluded.kind, fee_bps = excluded.fee_bps, made_at = excluded.made_at,
       outcome = excluded.outcome, updated_at = datetime('now')`,
  ).bind(crypto.randomUUID().replace(/-/g, ''), uid, user.id, kind, feeBps, madeAt || null, outcome).run();

  const row = await c.env.DB.prepare(
    `SELECT kind, fee_bps, made_at, outcome FROM intro_terms
      WHERE owner_user_id = ? AND proposition_uid = ?`,
  ).bind(user.id, uid).first<{ kind: string; fee_bps: number | null; made_at: string | null; outcome: string | null }>();
  return c.json({ ok: true, terms: row || null });
});

// GET /credits — balance breakdown for the header summary.
introductions.get('/credits', async (c) => {
  const user = (await requireAuth(c)) as User;
  const credits = await getIntroCreditState(c.env, user as any);
  return c.json({
    credits,
    refer_path: '/account/referrals',
  });
});

// GET /credits/history — the append-only ledger (auditable transactions).
introductions.get('/credits/history', async (c) => {
  const user = (await requireAuth(c)) as User;
  await ensureIntroNetworkSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT delta, bucket, kind, source_ref, note, created_at
       FROM intro_credit_ledger
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
  ).bind(user.id).all();
  return c.json({ history: rows.results || [] });
});

// GET /packs — intro-credit packs. D755: none are on sale; the route stays
// for tabs still on an older build.
introductions.get('/packs', async (c) => {
  await requireAuth(c);
  return c.json({ packs: [], on_sale: false });
});

export default introductions;
