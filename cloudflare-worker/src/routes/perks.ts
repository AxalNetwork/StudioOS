/**
 * Perks & Products — a credit-priced partner perk marketplace.
 *
 * Mounted at /api/perks. Schema: migration 186.
 *
 * FOUNDER SIDE
 *   GET  /                      the live catalogue + my balance + my claims
 *   GET  /:uid                  one listing, with what claiming it would cost
 *   POST /:uid/claim            claim it (debits credits when kind='credits')
 *   GET  /mine                  my claims + my credit ledger
 *
 * PARTNER SIDE (the account that owns a listing)
 *   GET    /partner             my submissions, with their review state
 *   POST   /partner             submit a listing (lands in review, never live)
 *   PATCH  /partner/:uid        edit — a live listing returns to review
 *   GET    /partner/:uid/stats  views, claims, redemptions for MY listing
 *
 * ADMIN
 *   GET   /admin/queue          everything awaiting review
 *   POST  /admin/:uid/review    approve / reject / pause
 *   POST  /admin/credits        grant credits to a user
 *
 * THE THREE PRICE KINDS, and why the credit one is the only interesting one:
 *
 *   tier   — included in a subscription. Gated by `userMeetsTier` from
 *            middleware/requireTier.ts, so it is the SAME gate the rest of the
 *            product uses rather than a second notion of entitlement.
 *   money  — a paid engagement. `price_cents` is quoted and the partner
 *            invoices offline. The claim records intent; no charge is taken
 *            here, and the UI says so.
 *   credits — debits `perk_credit_ledger`.
 *
 * THE DEBIT. Balance is SUM(delta) over the ledger, never a stored column. A
 * claim writes the claim row and the negative ledger row in one D1 batch, so
 * a claim without its debit is not a state this can reach. Two independent
 * guards make a double-spend impossible even under concurrent requests:
 * UNIQUE(perk_id, user_id) on the claim and UNIQUE(user_id, kind, source_ref)
 * on the ledger row keyed 'perk:<claim uid>'. The balance check before the
 * batch is a courtesy that produces a good error message; the indexes are what
 * make it correct.
 *
 * WHAT IS NOT HERE, and why:
 *
 *   * NO MONTHLY ALLOWANCE. The canvas assumes a plan grants credits. How many
 *     a Growth or Studio subscription includes is a commercial term nobody has
 *     set, and inventing one would put a made-up price in the product. Credits
 *     enter only through an admin grant today. `GET /` reports the balance and
 *     whether any grant has ever been made, so the page can say "no credit
 *     allowance is configured" rather than "not enough credits" — those are
 *     very different sentences to show someone.
 *   * NO SEEDED CATALOGUE. `perks` starts empty because no partner has
 *     submitted one. The named partners in the canvas are placeholders; listing
 *     them would be inventing commercial relationships.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { userMeetsTier, type Tier } from '../middleware/requireTier';

const r = new Hono<{ Bindings: Env }>();

const KINDS = new Set(['credits', 'tier', 'money']);
const FULFILMENTS = new Set(['code', 'link', 'intro']);
const TIERS = new Set(['free', 'growth', 'studio']);
const REVIEWABLE = new Set(['approve', 'reject', 'pause']);
const TEXT_MAX = 4000;
const NAME_MAX = 200;

type PerkRow = {
  id: number; uid: string; partner_user_id: number | null; partner_name: string;
  category: string; offer: string; blurb: string | null; detail: string | null;
  kind: string; credits: number; required_tier: string | null; price_cents: number | null;
  fulfilment: string; redeem_url: string | null; claim_cap: number | null;
  status: string; review_note: string | null; featured: number;
  created_at: string; updated_at: string;
};

const str = (v: unknown, max = TEXT_MAX): string => String(v ?? '').trim().slice(0, max);
const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Balance is derived. There is no balance column, on purpose. */
async function balanceOf(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(delta), 0) AS bal FROM perk_credit_ledger WHERE user_id = ?',
  ).bind(userId).first<{ bal: number }>();
  return Number(row?.bal) || 0;
}

/** True once ANY credit has ever been granted to anyone — see the header. */
async function allowanceConfigured(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS x FROM perk_credit_ledger WHERE delta > 0 LIMIT 1",
  ).first<{ x: number }>();
  return !!row;
}

/** The listing a partner owns, or null. Ownership is the only key. */
async function myPerk(env: Env, uid: string, userId: number): Promise<PerkRow | null> {
  return await env.DB.prepare(
    'SELECT * FROM perks WHERE uid = ? AND partner_user_id = ?',
  ).bind(uid, userId).first<PerkRow>();
}

/** What a listing costs THIS caller, and whether they can take it. */
function affordability(perk: PerkRow, user: any, balance: number) {
  if (perk.kind === 'tier') {
    const need = (perk.required_tier || 'growth') as Tier;
    const ok = userMeetsTier(user, need === 'free' ? 'growth' : need);
    return {
      claimable: need === 'free' ? true : ok,
      reason: (need === 'free' || ok) ? null : 'tier_required',
      credits: 0,
      required_tier: perk.required_tier,
    };
  }
  if (perk.kind === 'money') {
    return { claimable: true, reason: null, credits: 0, price_cents: perk.price_cents };
  }
  const cost = Number(perk.credits) || 0;
  return {
    claimable: balance >= cost,
    reason: balance >= cost ? null : 'insufficient_credits',
    credits: cost,
    short_by: Math.max(0, cost - balance),
  };
}

const publicPerk = (p: PerkRow) => ({
  uid: p.uid, partner_name: p.partner_name, category: p.category, offer: p.offer,
  blurb: p.blurb, kind: p.kind, credits: p.credits, required_tier: p.required_tier,
  price_cents: p.price_cents, fulfilment: p.fulfilment, claim_cap: p.claim_cap,
  featured: !!p.featured, created_at: p.created_at,
});

/* ---------------------------------------------------------------- *
 * Founder side                                                      *
 * ---------------------------------------------------------------- */

// Literal paths are registered BEFORE `/:uid` so `/mine` is never swallowed
// by the param route (scripts/check-route-order.mjs enforces this repo-wide).
r.get('/mine', async (c) => {
  try {
    const user = await requireAuth(c);
    const claims = await c.env.DB.prepare(
      `SELECT pc.uid, pc.credits_spent, pc.claimed_price_cents, pc.kind_at_claim,
              pc.code, pc.redeem_url, pc.status, pc.expires_at, pc.redeemed_at,
              pc.created_at, p.offer, p.partner_name, p.category, p.uid AS perk_uid
         FROM perk_claims pc
         JOIN perks p ON p.id = pc.perk_id
        WHERE pc.user_id = ?
        ORDER BY pc.created_at DESC
        LIMIT 200`,
    ).bind(user.id).all<any>();
    const ledger = await c.env.DB.prepare(
      `SELECT delta, kind, source_ref, note, created_at
         FROM perk_credit_ledger WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT 200`,
    ).bind(user.id).all<any>();
    return c.json({
      items: claims.results || [],
      ledger: ledger.results || [],
      balance: await balanceOf(c.env, user.id),
      allowance_configured: await allowanceConfigured(c.env),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/partner', async (c) => {
  try {
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id) AS claim_count
         FROM perks p WHERE p.partner_user_id = ?
        ORDER BY p.created_at DESC LIMIT 200`,
    ).bind(user.id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.post('/partner', async (c) => {
  try {
    const user = await requireAuth(c);
    const b = await c.req.json().catch(() => ({} as any));
    const offer = str(b?.offer, NAME_MAX);
    const partnerName = str(b?.partner_name, NAME_MAX);
    if (!offer || !partnerName) return c.json({ error: 'offer and partner_name are required' }, 400);
    const kind = KINDS.has(String(b?.kind)) ? String(b.kind) : 'credits';
    const fulfilment = FULFILMENTS.has(String(b?.fulfilment)) ? String(b.fulfilment) : 'code';
    const requiredTier = TIERS.has(String(b?.required_tier)) ? String(b.required_tier) : null;
    const credits = kind === 'credits' ? Math.max(0, intOrNull(b?.credits) ?? 0) : 0;
    const priceCents = kind === 'money' ? Math.max(0, intOrNull(b?.price_cents) ?? 0) : null;
    if (kind === 'tier' && !requiredTier) {
      return c.json({ error: 'a tier perk must name the tier that includes it' }, 400);
    }
    const uid = newUid();
    // Submissions land in review. A partner cannot publish to founders directly.
    await c.env.DB.prepare(
      `INSERT INTO perks (uid, partner_user_id, partner_name, category, offer, blurb,
                          detail, kind, credits, required_tier, price_cents, fulfilment,
                          redeem_url, claim_cap, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'in_review', ?, ?)`,
    ).bind(
      uid, user.id, partnerName, str(b?.category, 80) || 'Other', offer,
      str(b?.blurb, 500) || null, str(b?.detail) || null, kind, credits, requiredTier,
      priceCents, fulfilment, str(b?.redeem_url, 500) || null, intOrNull(b?.claim_cap),
      nowIso(), nowIso(),
    ).run();
    return c.json({ uid, status: 'in_review' }, 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/partner/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const perk = await myPerk(c.env, c.req.param('uid'), user.id);
    // 404 rather than 403: a listing the caller does not own should not be
    // confirmed to exist.
    if (!perk) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const sets: string[] = [];
    const binds: any[] = [];
    const put = (col: string, v: any) => { sets.push(`${col} = ?`); binds.push(v); };
    if (b?.offer !== undefined) put('offer', str(b.offer, NAME_MAX));
    if (b?.blurb !== undefined) put('blurb', str(b.blurb, 500) || null);
    if (b?.detail !== undefined) put('detail', str(b.detail) || null);
    if (b?.category !== undefined) put('category', str(b.category, 80) || 'Other');
    if (b?.credits !== undefined) put('credits', Math.max(0, intOrNull(b.credits) ?? 0));
    if (b?.price_cents !== undefined) put('price_cents', intOrNull(b.price_cents));
    if (b?.claim_cap !== undefined) put('claim_cap', intOrNull(b.claim_cap));
    if (b?.redeem_url !== undefined) put('redeem_url', str(b.redeem_url, 500) || null);
    if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
    // Editing a LIVE listing returns it to review. The terms founders were
    // shown are the terms that were approved; a partner must not be able to
    // change the price of something already on the shelf.
    if (perk.status === 'live') { put('status', 'in_review'); put('review_note', null); }
    put('updated_at', nowIso());
    binds.push(perk.id);
    await c.env.DB.prepare(`UPDATE perks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return c.json({ ok: true, status: perk.status === 'live' ? 'in_review' : perk.status });
  } catch (e) { return mapError(c, e); }
});

r.get('/partner/:uid/stats', async (c) => {
  try {
    const user = await requireAuth(c);
    const perk = await myPerk(c.env, c.req.param('uid'), user.id);
    if (!perk) return c.json({ error: 'not_found' }, 404);
    const views = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM perk_views WHERE perk_id = ?',
    ).bind(perk.id).first<{ n: number }>();
    const claims = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) AS redeemed
         FROM perk_claims WHERE perk_id = ?`,
    ).bind(perk.id).first<{ n: number; redeemed: number }>();
    const viewed = Number(views?.n) || 0;
    const claimed = Number(claims?.n) || 0;
    return c.json({
      views: viewed,
      claims: claimed,
      redeemed: Number(claims?.redeemed) || 0,
      // Only a real ratio, and only when there is something to divide by.
      claim_rate: viewed > 0 ? claimed / viewed : null,
      claim_cap: perk.claim_cap,
      remaining: perk.claim_cap === null ? null : Math.max(0, perk.claim_cap - claimed),
    });
  } catch (e) { return mapError(c, e); }
});

/* ---------------------------------------------------------------- *
 * Admin                                                             *
 * ---------------------------------------------------------------- */

r.get('/admin/queue', async (c) => {
  try {
    await requireAdmin(c);
    const rows = await c.env.DB.prepare(
      `SELECT p.*, u.email AS partner_email
         FROM perks p LEFT JOIN users u ON u.id = p.partner_user_id
        WHERE p.status IN ('in_review', 'draft')
        ORDER BY p.created_at ASC LIMIT 200`,
    ).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.post('/admin/credits', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const userId = intOrNull(b?.user_id);
    const delta = intOrNull(b?.delta);
    if (!userId || !delta) return c.json({ error: 'user_id and a non-zero delta are required' }, 400);
    const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(userId).first<{ id: number }>();
    if (!target) return c.json({ error: 'not_found' }, 404);
    // A grant must not take a balance negative — the ledger would then owe
    // credits nobody can spend.
    if (delta < 0 && (await balanceOf(c.env, userId)) + delta < 0) {
      return c.json({ error: 'that would take the balance below zero' }, 400);
    }
    const ref = str(b?.source_ref, 120) || `admin:${admin.id}:${nowIso()}`;
    await c.env.DB.prepare(
      `INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, created_at)
       VALUES (?,?,?,?,?,?)`,
    ).bind(userId, delta, delta > 0 ? 'grant' : 'admin_adjust', ref, str(b?.note, 500) || null, nowIso()).run();
    return c.json({ ok: true, balance: await balanceOf(c.env, userId) });
  } catch (e) { return mapError(c, e); }
});

r.post('/admin/:uid/review', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const action = String(b?.action || '');
    if (!REVIEWABLE.has(action)) {
      return c.json({ error: 'action must be approve, reject or pause' }, 400);
    }
    const perk = await c.env.DB.prepare('SELECT * FROM perks WHERE uid = ?')
      .bind(c.req.param('uid')).first<PerkRow>();
    if (!perk) return c.json({ error: 'not_found' }, 404);
    if (action === 'reject' && !str(b?.review_note)) {
      return c.json({ error: 'a rejection must say why — the partner sees this' }, 400);
    }
    const status = action === 'approve' ? 'live' : action === 'reject' ? 'rejected' : 'paused';
    await c.env.DB.prepare(
      `UPDATE perks SET status = ?, review_note = ?, reviewed_by_user_id = ?,
              reviewed_at = ?, featured = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      status, str(b?.review_note, 1000) || null, admin.id, nowIso(),
      b?.featured ? 1 : perk.featured, nowIso(), perk.id,
    ).run();
    return c.json({ ok: true, status });
  } catch (e) { return mapError(c, e); }
});

/* ---------------------------------------------------------------- *
 * Catalogue + claim — the param routes, registered last             *
 * ---------------------------------------------------------------- */

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM perks WHERE status = 'live'
        ORDER BY featured DESC, created_at DESC LIMIT 200`,
    ).all<PerkRow>();
    const perks = rows.results || [];
    const balance = await balanceOf(c.env, user.id);
    const claimed = await c.env.DB.prepare(
      'SELECT perk_id FROM perk_claims WHERE user_id = ?',
    ).bind(user.id).all<{ perk_id: number }>();
    const mine = new Set((claimed.results || []).map((x) => x.perk_id));
    return c.json({
      items: perks.map((p) => ({
        ...publicPerk(p),
        claimed: mine.has(p.id),
        ...affordability(p, user, balance),
      })),
      balance,
      // The page needs this to tell "you have spent your credits" apart from
      // "credits are not a thing on this account yet".
      allowance_configured: await allowanceConfigured(c.env),
      categories: [...new Set(perks.map((p) => p.category))].sort(),
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const perk = await c.env.DB.prepare(
      "SELECT * FROM perks WHERE uid = ? AND status = 'live'",
    ).bind(c.req.param('uid')).first<PerkRow>();
    if (!perk) return c.json({ error: 'not_found' }, 404);
    // One view per viewer per day. INSERT OR IGNORE against the unique index
    // rather than a read-then-write, so a refresh cannot inflate the number
    // the partner is shown.
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO perk_views (perk_id, user_id, day, created_at)
       VALUES (?,?,?,?)`,
    ).bind(perk.id, user.id, nowIso().slice(0, 10), nowIso()).run();
    const balance = await balanceOf(c.env, user.id);
    const claim = await c.env.DB.prepare(
      'SELECT uid, code, redeem_url, status, created_at FROM perk_claims WHERE perk_id = ? AND user_id = ?',
    ).bind(perk.id, user.id).first<any>();
    return c.json({
      ...publicPerk(perk),
      detail: perk.detail,
      balance,
      claim: claim || null,
      ...affordability(perk, user, balance),
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/claim', async (c) => {
  try {
    const user = await requireAuth(c);
    const perk = await c.env.DB.prepare(
      "SELECT * FROM perks WHERE uid = ? AND status = 'live'",
    ).bind(c.req.param('uid')).first<PerkRow>();
    if (!perk) return c.json({ error: 'not_found' }, 404);

    const existing = await c.env.DB.prepare(
      'SELECT uid, code, redeem_url, status FROM perk_claims WHERE perk_id = ? AND user_id = ?',
    ).bind(perk.id, user.id).first<any>();
    // Idempotent: a second claim returns the first one rather than erroring,
    // so a double-click shows the code instead of a failure.
    if (existing) return c.json({ ...existing, already_claimed: true });

    if (perk.claim_cap !== null) {
      const used = await c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM perk_claims WHERE perk_id = ?',
      ).bind(perk.id).first<{ n: number }>();
      if ((Number(used?.n) || 0) >= perk.claim_cap) {
        return c.json({ error: 'this perk has reached its claim limit' }, 409);
      }
    }

    const balance = await balanceOf(c.env, user.id);
    const afford = affordability(perk, user, balance);
    if (!afford.claimable) {
      return c.json({ error: afford.reason, ...afford }, afford.reason === 'tier_required' ? 402 : 409);
    }

    const claimUid = newUid();
    const now = nowIso();
    const cost = perk.kind === 'credits' ? (Number(perk.credits) || 0) : 0;
    // A code is issued per claim; it is not read from the request, so a caller
    // cannot choose their own redemption code.
    const code = perk.fulfilment === 'code'
      ? `AXAL-${newUid().replace(/-/g, '').slice(0, 10).toUpperCase()}`
      : null;

    const stmts = [
      c.env.DB.prepare(
        `INSERT INTO perk_claims (uid, perk_id, user_id, credits_spent, claimed_price_cents,
                                  kind_at_claim, code, redeem_url, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'issued', ?)`,
      ).bind(claimUid, perk.id, user.id, cost, perk.price_cents, perk.kind, code, perk.redeem_url, now),
    ];
    if (cost > 0) {
      // Same batch as the claim: a claim without its debit is not reachable.
      // source_ref 'perk:<claim uid>' makes the spend idempotent against the
      // ledger's unique index even if this batch were somehow retried.
      stmts.push(c.env.DB.prepare(
        `INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, created_at)
         VALUES (?,?, 'spend', ?, ?, ?)`,
      ).bind(user.id, -cost, `perk:${claimUid}`, perk.offer.slice(0, 200), now));
    }
    await c.env.DB.batch(stmts);

    return c.json({
      uid: claimUid,
      code,
      redeem_url: perk.redeem_url,
      status: 'issued',
      credits_spent: cost,
      balance: balance - cost,
      fulfilment: perk.fulfilment,
    }, 201);
  } catch (e) { return mapError(c, e); }
});

export default r;
