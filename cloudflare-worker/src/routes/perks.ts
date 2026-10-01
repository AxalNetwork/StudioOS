/**
 * Perks & Products — a credit-priced partner perk marketplace.
 *
 * Mounted at /api/perks. Schema: migration 186.
 *
 * FOUNDER SIDE
 *   GET  /                      the live catalogue + my balance + my claims
 *   GET  /:uid                  one listing, with what claiming it would cost
 *   POST /:uid/claim            claim it (debits credits when kind='credits')
 *   POST /:uid/rating           rate it 1-5, once my claim is redeemed (D412)
 *   GET  /mine                  my claims + my credit ledger
 *
 * PARTNER SIDE (the account that owns a listing)
 *   GET    /partner             my submissions, with their review state
 *   POST   /partner             submit a listing (lands in review, never live)
 *   PATCH  /partner/:uid        edit — a live listing returns to review, except
 *                               a raise of its claim cap (D412)
 *   GET    /partner/:uid/stats  views, claims, redemptions for MY listing
 *   GET    /partner/:uid/claims the claims on MY listing, without who made them
 *   POST   /partner/:uid/redeem mark one claim redeemed, by its code or uid (D412)
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
import { activeCompanyFor } from '../middleware/activeCompany';
import type { Env } from '../types';
import { requireAuth, requireAdmin, requireRole } from '../auth';
import { mapError, newUid, nowIso, todayIso } from './_t13t14t15_helpers';
import { userMeetsTier, type Tier } from '../middleware/requireTier';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

const KINDS = new Set(['credits', 'tier', 'money']);
const FULFILMENTS = new Set(['code', 'link', 'intro']);
const TIERS = new Set(['free', 'growth', 'studio']);
const REVIEWABLE = new Set(['approve', 'reject', 'pause']);
/** Every field PATCH /partner/:uid accepts; the cap-raise rule reads it. */
const PATCHABLE = [
  'offer', 'blurb', 'detail', 'category', 'credits', 'price_cents', 'claim_cap',
  'redeem_url', 'ends_at', 'grant_scope', 'value_cents',
] as const;
const TEXT_MAX = 4000;
const NAME_MAX = 200;

/**
 * The four routes below are the PARTNER side of the marketplace: list what my
 * agency offers, submit a listing, edit it, read its funnel.
 *
 * They were `requireAuth` only. The submit handler's own comment says "A
 * partner cannot publish to founders directly" — and it is right that the row
 * is forced to `in_review` rather than `live`, so nothing reached a founder
 * unreviewed. But nothing checked the submitter was a partner at all, so any
 * signed-in account (founder, investor, advisor, `exploring`) could put a
 * listing into the admin queue and read the per-listing view/claim funnel of
 * anything it had put there. Only the UI tab was gated (`PerksPage.jsx`),
 * which is not a gate.
 *
 * `requireRole` admits admin unconditionally, which is what the review queue
 * and the partner console both want: an admin operating on a partner's behalf
 * is the existing pattern in `PerksPage`, whose Partner console tab is shown
 * to `partner || admin`.
 *
 * "Operator Partner" is `users.role = 'partner'` — there is no partner
 * sub-type column anywhere in the schema (`partner_type`, `partner_tier` and
 * `partner_kind` return zero hits), and the operator/service-provider
 * distinction lives in `personas.ts` as a label whose `role_alignment` is
 * `partner`. So the role is the whole gate; do not invent a sub-type here.
 */
const partnerOnly = (c: Parameters<typeof requireRole>[0]) => requireRole(c, 'partner');

/**
 * WHO MAY CLAIM A PERK (D412). Claiming is a founder's action — App.jsx says so
 * and the menu only offers it to founders — but the route was `requireAuth`
 * alone, and `userMeetsTier` lets admin, partner, investor and advisor through
 * every tier gate (middleware/requireTier.ts's BYPASS_ROLES). Together that let
 * any non-founder account take a plan-included perk for nothing. The claim, the
 * rating, and the `claimable` flag the catalogue serves all read this one set,
 * and this file is the only place a perk gate lives.
 *
 * NO CLAIMANT ROLE MAY BE A BYPASS ROLE. For a founder `userMeetsTier` checks
 * the subscription itself; perks_claim_founders_d412.test.ts fails if a role
 * added here would skip that check.
 *
 * OWNER DECISION, MADE 2026-09-27: only founders claim. An `exploring`
 * account (a signed-up person whose membership is under review) does not
 * qualify, and neither does any other role. The test that pins this
 * (perks_claim_founders_d412.test.ts) now pins a decision, not a default.
 */
export const PERK_CLAIMANT_ROLES: ReadonlySet<string> = new Set(['founder']);
const isClaimant = (user: any) => PERK_CLAIMANT_ROLES.has(String(user?.role ?? ''));

/**
 * WHO MAY RATE A PERK (D412): a claimant whose claim of THAT perk has been
 * marked redeemed. The canvas draws stars and "Not yet rated" but not who
 * rates; a rating from someone who never used the offer is a review of the
 * listing's copy, so the rule asks for the one fact that says they used it.
 */
export const PERK_RATING_REQUIRES = 'redeemed' as const;

/** Why a signed-in caller cannot claim, as the page prints it. Served, not written on the page. */
const NOT_A_CLAIMANT = 'Perks are claimed by founders. This account can browse the marketplace but not claim from it.';

type PerkRow = {
  id: number; uid: string; partner_user_id: number | null; partner_name: string;
  category: string; offer: string; blurb: string | null; detail: string | null;
  kind: string; credits: number; required_tier: string | null; price_cents: number | null;
  fulfilment: string; redeem_url: string | null; claim_cap: number | null;
  status: string; review_note: string | null; featured: number;
  ends_at: string | null; grant_scope: string | null;
  value_cents: number | null; editorial_note: string | null;
  created_at: string; updated_at: string;
  // Derived in the catalogue query, never stored.
  claim_count?: number; rating_avg?: number | null; rating_count?: number;
};

/**
 * How near an ending counts as `Expiring` — thirty days.
 *
 * THE ARTBOARD DOES NOT SUPPLY THIS NUMBER, so it is chosen here and the zone
 * states it on the page. `po2` authors its five sample rows' states by hand
 * (`state:'Expiring'` is written into the fixture), so there is no window to
 * read off it the way `Going cold` reads 60 days off the Network artboard's own
 * `days > 60`.
 *
 * A WINDOW IS NOT A CAP, which is why choosing one is allowed here and choosing
 * `delivery/capacity`'s 40 is not. Forty would be a claim about how much work
 * THIS FIRM can take. Thirty is the definition of a word the page itself uses,
 * and the page prints the definition beside the word — a reader can see the
 * rule and disagree with it, which is not true of an invented limit.
 *
 * ONE DEFINITION, IN THE WORKER. The frontend never computes a lifecycle: it
 * reads `lifecycle` off the row. `routes/research.ts` imports the same helper
 * for the draft gather. A second copy of this number is how two pages come to
 * disagree about which perks are ending.
 */
export const PERK_EXPIRING_WITHIN_DAYS = 30;

/**
 * `live` | `expiring` | `expired` for one perk's end date.
 *
 * NULL IS `live`, NOT `expiring`. An open-ended standing discount has no end
 * date because there is not one, which is a real answer rather than a missing
 * value — so it never appears in a list of things about to stop.
 *
 * Compared as text. Every date in this schema is `YYYY-MM-DD`, and migration
 * 228's CHECK refuses anything else on this column, so a lexical comparison is
 * a chronological one.
 */
export function perkLifecycle(endsAt: string | null | undefined, today: string): 'live' | 'expiring' | 'expired' {
  const end = String(endsAt || '').slice(0, 10);
  if (!end) return 'live';
  if (end < today) return 'expired';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + PERK_EXPIRING_WITHIN_DAYS);
  return end <= soon.toISOString().slice(0, 10) ? 'expiring' : 'live';
}

const str = (v: unknown, max = TEXT_MAX): string => String(v ?? '').trim().slice(0, max);
const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * A `YYYY-MM-DD` date, or null.
 *
 * The SAME shape migration 228's CHECK enforces, so a value this accepts is a
 * value the column accepts. Anything else — an empty field, a typed
 * "Oct 15 2026", a timestamp — becomes null here and the caller decides whether
 * that is a clear (PATCH refuses it explicitly) or an omission (POST stores it).
 */
const dateOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * A claim's state as a person reads it (D412). `expired` is DERIVED, never
 * written: an issued claim whose snapshotted end date has passed. Nothing runs
 * on a schedule to flip the column, so reading it is the only honest way to
 * know — and the column's own 'expired' value, if an admin ever sets it,
 * passes through unchanged.
 */
export function claimState(
  claim: { status?: string | null; expires_at?: string | null },
  today = todayIso(),
): string {
  const status = String(claim?.status || 'issued');
  if (status !== 'issued') return status;
  const end = String(claim?.expires_at || '').slice(0, 10);
  return end && end < today ? 'expired' : 'issued';
}

/**
 * Whole days from `today` until an issued claim expires, or null (D413).
 *
 * Null for a claim with no expiry (an open-ended offer gives an open-ended
 * claim) and for one that is no longer `issued` — a redeemed claim has nothing
 * left to lapse. Served on each claim so My perks never counts days itself: the
 * "Expiring in 30d" figure and the "N days left" line read the same number,
 * against the same PERK_EXPIRING_WITHIN_DAYS window the partner zone uses.
 */
export function claimDaysLeft(
  claim: { status?: string | null; expires_at?: string | null },
  today = todayIso(),
): number | null {
  if (claimState(claim, today) !== 'issued') return null;
  const end = String(claim?.expires_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

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

/**
 * The listing a partner owns, or null. Ownership is the first key; company
 * scoping (stage 10) narrows within it.
 *
 * The company clause is ANDed onto a query that already matches
 * `partner_user_id`, so it can only ever narrow the caller's OWN listings and
 * can never reach another partner's — the property that lets an `IS NULL` arm
 * be safe in a predicate whose answer is a 404. A listing with no company was
 * made before the partner had a primary one and stays theirs under all of them.
 */
async function myPerk(
  env: Env, uid: string, userId: number, companyId: number | null = null,
): Promise<PerkRow | null> {
  // Two full literals, never a clause dropped into the query text.
  if (companyId === null) {
    return await env.DB.prepare(
      'SELECT * FROM perks WHERE uid = ? AND partner_user_id = ?',
    ).bind(uid, userId).first<PerkRow>();
  }
  return await env.DB.prepare(
    `SELECT * FROM perks
      WHERE uid = ? AND partner_user_id = ?
        AND (company_id = ? OR company_id IS NULL)`,
  ).bind(uid, userId, companyId).first<PerkRow>();
}

/**
 * What a listing costs THIS caller, and whether they can take it.
 *
 * The order is the order the claim route refuses in: who you are, whether the
 * offer is still open, whether it is full, and only then what it costs. A
 * non-founder is told they cannot claim before they are told what a claim
 * would cost them — the tier line below never runs for them, so no role takes
 * a tier perk through a bypass.
 */
function affordability(perk: PerkRow, user: any, balance: number, today = todayIso()) {
  if (!isClaimant(user)) {
    return { claimable: false, reason: 'founders_only', reason_text: NOT_A_CLAIMANT, credits: Number(perk.credits) || 0 };
  }
  if (perkLifecycle(perk.ends_at, today) === 'expired') {
    return { claimable: false, reason: 'perk_ended', credits: Number(perk.credits) || 0 };
  }
  if (perk.claim_cap !== null && perk.claim_count !== undefined && Number(perk.claim_count) >= perk.claim_cap) {
    return { claimable: false, reason: 'cap_reached', credits: Number(perk.credits) || 0 };
  }
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

/**
 * What a founder might expect around a claim of THIS listing that nothing does
 * (D413), with the sentence the claim modal prints.
 *
 * AN INTRODUCTION IS NOT MADE. The canvas's "Introduction" method reads "you
 * contact them", and the page used to tell a founder the partner "has your
 * details and will be in touch". The partner does not: GET /partner/:uid/claims
 * withholds who claimed, because no founder's consent to share their company
 * with a partner is recorded. So the founder carries the claim reference to the
 * partner, and the partner marks it redeemed by that reference. A paid
 * engagement ('money') has the same gap — see listingAbsences.
 */
const PARTNER_NOT_TOLD = 'The partner is not told who claimed: no founder has consented to share their company with a partner, and nothing records that consent yet. Give them your claim reference when you get in touch.';
function listingAbsences(p: Pick<PerkRow, 'fulfilment' | 'kind'>): Record<string, string> {
  // A paid engagement has the same gap: the partner invoices offline, and
  // cannot invoice someone it is not told about.
  return p.fulfilment === 'intro' || p.kind === 'money' ? { partner_contact: PARTNER_NOT_TOLD } : {};
}

const publicPerk = (p: PerkRow, today = todayIso()) => ({
  uid: p.uid, partner_name: p.partner_name, category: p.category, offer: p.offer,
  blurb: p.blurb, kind: p.kind, credits: p.credits, required_tier: p.required_tier,
  price_cents: p.price_cents, fulfilment: p.fulfilment, claim_cap: p.claim_cap,
  featured: !!p.featured, created_at: p.created_at,
  // D412 — migration 322's two listing facts, and what the catalogue derives.
  value_cents: p.value_cents ?? null,
  editorial_note: p.featured ? (p.editorial_note ?? null) : null,
  ends_at: p.ends_at ?? null,
  lifecycle: perkLifecycle(p.ends_at, today),
  // A full listing stays live (the canvas says it "pauses automatically at
  // cap"; nothing pauses it) — so the fact is served and the page says it.
  cap_reached: p.claim_cap !== null && p.claim_count !== undefined && Number(p.claim_count) >= p.claim_cap,
  // No rating is not a zero rating: `null` average until someone has rated.
  rating: {
    count: Number(p.rating_count) || 0,
    average: Number(p.rating_count) > 0 && p.rating_avg !== null && p.rating_avg !== undefined
      ? Math.round(Number(p.rating_avg) * 10) / 10 : null,
  },
});

/**
 * The catalogue's per-listing read: the row plus its claim count and rating
 * summary, derived here rather than stored. One literal SELECT list so every
 * listing read the founder side makes has the same shape.
 */
const LISTING_SELECT = `SELECT p.*,
       (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id) AS claim_count,
       (SELECT AVG(stars) FROM perk_ratings pr WHERE pr.perk_id = p.id) AS rating_avg,
       (SELECT COUNT(*) FROM perk_ratings pr WHERE pr.perk_id = p.id) AS rating_count
  FROM perks p`;

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
              pc.created_at, p.offer, p.partner_name, p.category, p.uid AS perk_uid,
              p.fulfilment, p.value_cents,
              (SELECT stars FROM perk_ratings pr WHERE pr.perk_id = pc.perk_id AND pr.user_id = pc.user_id) AS my_rating
         FROM perk_claims pc
         JOIN perks p ON p.id = pc.perk_id
        WHERE pc.user_id = ?
        ORDER BY pc.created_at DESC
        LIMIT 200`,
    ).bind(user.id).all<any>();
    const today = todayIso();
    const ledger = await c.env.DB.prepare(
      `SELECT delta, kind, source_ref, note, created_at
         FROM perk_credit_ledger WHERE user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT 200`,
    ).bind(user.id).all<any>();
    const items = (claims.results || []).map((x: any) => {
      const daysLeft = claimDaysLeft(x, today);
      return {
        ...x,
        state: claimState(x, today),
        can_rate: isClaimant(user) && x.status === PERK_RATING_REQUIRES,
        // D413 — counted here, once, so the page's "N days left" and its
        // "Expiring in 30d" tile cannot disagree with each other or with the
        // partner zone's window.
        days_left: daysLeft,
        expiring: daysLeft !== null && daysLeft <= PERK_EXPIRING_WITHIN_DAYS,
      };
    });
    return c.json({
      items,
      ledger: ledger.results || [],
      balance: await balanceOf(c.env, user.id),
      allowance_configured: await allowanceConfigured(c.env),
      // The three My perks tiles (D413). Over every claim returned, never a
      // filtered view; `credits_spent` sums what each claim recorded spending.
      stats: {
        claimed: items.length,
        credits_spent: items.reduce((a: number, x: any) => a + Number(x.credits_spent), 0),
        expiring: items.filter((x: any) => x.expiring).length,
        expiring_within_days: PERK_EXPIRING_WITHIN_DAYS,
      },
      // What the canvas draws around a claim that nothing does yet, with the
      // sentence the page prints (D412).
      absent: {
        expiry_reminder: 'No reminder is sent before a claim expires: nothing schedules one yet. The expiry date is shown on each claim.',
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.get('/partner', async (c) => {
  try {
    const user = await partnerOnly(c);
    // "What does MY agency offer" — a claim about a firm, so it narrows. The
    // catalogue below is a marketplace and deliberately does not.
    const companyId = await activeCompanyFor(c, user);
    const rows = await (companyId === null
      ? c.env.DB.prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id) AS claim_count,
                  (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id AND x.status = 'redeemed') AS redeemed_count
             FROM perks p WHERE p.partner_user_id = ?
            ORDER BY p.created_at DESC LIMIT 200`,
        ).bind(user.id)
      : c.env.DB.prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id) AS claim_count,
                  (SELECT COUNT(*) FROM perk_claims x WHERE x.perk_id = p.id AND x.status = 'redeemed') AS redeemed_count
             FROM perks p
            WHERE p.partner_user_id = ? AND (p.company_id = ? OR p.company_id IS NULL)
            ORDER BY p.created_at DESC LIMIT 200`,
        ).bind(user.id, companyId)
    ).all<any>();
    // `lifecycle` IS SERVED, NEVER COMPUTED ON THE PAGE. The window lives in
    // one constant above; a copy of it in the zone is how the strip and the
    // chips come to disagree about which perks are ending.
    const today = todayIso();
    const items = (rows.results || []).map((p: any) => ({
      ...p,
      lifecycle: perkLifecycle(p.ends_at, today),
      // WHAT THE END DATE TAKES BACK, AND WHEN — derived from the two columns
      // migration 228 added rather than stored a third time. A perk that
      // granted nothing revokes nothing, whatever its state.
      grant_revoked_on: p.grant_scope && perkLifecycle(p.ends_at, today) === 'expired'
        ? String(p.ends_at).slice(0, 10)
        : null,
    }));
    return c.json({
      items,
      expiring_within_days: PERK_EXPIRING_WITHIN_DAYS,
      // D413 — the canvas's "What review looks at" panel lists four criteria.
      // None of them is written down anywhere a reviewer reads or this route
      // enforces, so the zone prints this instead of the canvas's four.
      absent: {
        review_criteria: 'What review looks at is not written down yet: an Axal reviewer approves or declines each listing, and a decline says why.',
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/partner', async (c) => {
  try {
    const user = await partnerOnly(c);
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
    const valueCents = intOrNull(b?.value_cents);
    if (valueCents !== null && valueCents < 0) return c.json({ error: 'value_cents must be zero or more' }, 400);
    const uid = newUid();
    // Submissions land in review. A partner cannot publish to founders directly.
    await c.env.DB.prepare(
      `INSERT INTO perks (uid, partner_user_id, partner_name, category, offer, blurb,
                          detail, kind, credits, required_tier, price_cents, fulfilment,
                          redeem_url, claim_cap, ends_at, grant_scope, value_cents,
                          status, created_at, updated_at, company_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'in_review', ?, ?, ?)`,
    ).bind(
      uid, user.id, partnerName, str(b?.category, 80) || 'Other', offer,
      str(b?.blurb, 500) || null, str(b?.detail) || null, kind, credits, requiredTier,
      priceCents, fulfilment, str(b?.redeem_url, 500) || null, intOrNull(b?.claim_cap),
      // BOTH NULLABLE, AND AN EMPTY FIELD IS A NULL RATHER THAN A ''. An
      // open-ended perk has no end date, and a perk whose value is spent at
      // redemption grants nothing that outlives it — migration 228's header
      // has the reasoning. `dateOrNull` refuses anything the column's CHECK
      // would refuse, so a typed date fails here with a message rather than
      // as a constraint error.
      dateOrNull(b?.ends_at), str(b?.grant_scope, 300) || null,
      // D412 — the partner's stated cash value, integer cents; blank is null.
      valueCents,
      // The agency the listing was submitted under. None selected records
      // NULL rather than a guess at the partner's primary company.
      nowIso(), nowIso(), await activeCompanyFor(c, user),
    ).run();
    return c.json({ uid, status: 'in_review' }, 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/partner/:uid', async (c) => {
  try {
    const user = await partnerOnly(c);
    const perk = await myPerk(c.env, c.req.param('uid'), user.id, await activeCompanyFor(c, user));
    // 404 rather than 403: a listing the caller does not own should not be
    // confirmed to exist.
    if (!perk) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const sets: string[] = [];
    const binds: any[] = [];
    const put = (col: string, v: any) => { sets.push(`${col} = ?`); binds.push(v); };
    if (b?.value_cents !== undefined) {
      const v = intOrNull(b.value_cents);
      if (v !== null && v < 0) return c.json({ error: 'value_cents must be zero or more' }, 400);
      put('value_cents', v);
    }
    if (b?.offer !== undefined) put('offer', str(b.offer, NAME_MAX));
    if (b?.blurb !== undefined) put('blurb', str(b.blurb, 500) || null);
    if (b?.detail !== undefined) put('detail', str(b.detail) || null);
    if (b?.category !== undefined) put('category', str(b.category, 80) || 'Other');
    if (b?.credits !== undefined) put('credits', Math.max(0, intOrNull(b.credits) ?? 0));
    if (b?.price_cents !== undefined) put('price_cents', intOrNull(b.price_cents));
    if (b?.claim_cap !== undefined) put('claim_cap', intOrNull(b.claim_cap));
    if (b?.redeem_url !== undefined) put('redeem_url', str(b.redeem_url, 500) || null);
    if (b?.ends_at !== undefined) {
      // A DATE THAT DOES NOT PARSE IS REFUSED HERE, not passed to the CHECK.
      // `Extend` on the zone sends this field and nothing else, so a bad value
      // must come back as a sentence rather than as a constraint failure.
      if (b.ends_at !== null && b.ends_at !== '' && dateOrNull(b.ends_at) === null) {
        return c.json({ error: 'ends_at must be a date, as YYYY-MM-DD' }, 400);
      }
      put('ends_at', dateOrNull(b.ends_at));
    }
    if (b?.grant_scope !== undefined) put('grant_scope', str(b.grant_scope, 300) || null);
    if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
    // RAISING THE CAP IS NOT A CHANGE OF TERMS (D412). Every founder already
    // shown the listing was shown the same offer at the same price; more of
    // them may now take it. So an edit that ONLY raises `claim_cap` — to a
    // higher number, or to uncapped — keeps a live listing live. Anything else
    // in the same request, or a LOWERED cap, still goes back to review.
    const touched = PATCHABLE.filter((k) => b?.[k] !== undefined);
    const nextCap = intOrNull(b?.claim_cap);
    const capRaiseOnly = touched.length === 1 && touched[0] === 'claim_cap'
      && perk.claim_cap !== null && (nextCap === null || nextCap > perk.claim_cap);
    // Editing a LIVE listing returns it to review. The terms founders were
    // shown are the terms that were approved; a partner must not be able to
    // change the price of something already on the shelf.
    if (perk.status === 'live' && !capRaiseOnly) { put('status', 'in_review'); put('review_note', null); }
    put('updated_at', nowIso());
    binds.push(perk.id);
    await c.env.DB.prepare(`UPDATE perks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    const status = perk.status === 'live' && !capRaiseOnly ? 'in_review' : perk.status;
    return c.json({ ok: true, status, reviewed_again: perk.status === 'live' && !capRaiseOnly });
  } catch (e) { return mapError(c, e); }
});

r.get('/partner/:uid/stats', async (c) => {
  try {
    const user = await partnerOnly(c);
    const perk = await myPerk(c.env, c.req.param('uid'), user.id, await activeCompanyFor(c, user));
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
    const redeemed = Number(claims?.redeemed) || 0;
    const rating = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n, AVG(stars) AS avg FROM perk_ratings WHERE perk_id = ?',
    ).bind(perk.id).first<{ n: number; avg: number | null }>();
    return c.json({
      views: viewed,
      claims: claimed,
      redeemed,
      // Only a real ratio, and only when there is something to divide by.
      claim_rate: viewed > 0 ? claimed / viewed : null,
      // D412 — `redeemed` has a writer now (POST /partner/:uid/redeem), so the
      // rate is a fact rather than a permanent zero.
      redemption_rate: claimed > 0 ? redeemed / claimed : null,
      // One claim per founder (UNIQUE(perk_id, user_id)), so claims ARE
      // founders reached — a count, never who they are (below).
      founders_reached: claimed,
      value_cents: perk.value_cents ?? null,
      // D413 — the canvas's "Cost per founder": the value you gave away,
      // counted only where it was redeemed, spread over everyone the listing
      // reached. Integer cents, and only where both inputs exist.
      cost_per_founder_cents: perk.value_cents !== null && perk.value_cents !== undefined && claimed > 0
        ? Math.round((perk.value_cents * redeemed) / claimed)
        : null,
      rating: { count: Number(rating?.n) || 0, average: Number(rating?.n) > 0 ? Math.round(Number(rating?.avg) * 10) / 10 : null },
      claim_cap: perk.claim_cap,
      remaining: perk.claim_cap === null ? null : Math.max(0, perk.claim_cap - claimed),
      absent: {
        founders_list: 'Which founders claimed is not shown to partners: no founder has consented to share their company with a partner, and nothing records that consent yet.',
        card_views: 'Card impressions are not counted; views are detail opens, one per viewer per day.',
        bd_console: 'Claims do not sync anywhere as leads: there is no BD console, and no founder has consented to be passed to a partner as one.',
        ...(claimed === 0 ? { redemption_rate: 'No claims yet, so there is no rate to show.' } : {}),
        ...(perk.value_cents === null || perk.value_cents === undefined
          ? { cost_per_founder: 'This listing states no cash value, so there is nothing to spread across the founders it reached.' }
          : claimed === 0 ? { cost_per_founder: 'No claims yet, so there is no one to spread the value across.' } : {}),
      },
    });
  } catch (e) { return mapError(c, e); }
});

// GET /partner/:uid/claims — the claims on MY listing (D412). What the
// partner needs to honour them — each claim's uid, state and dates — and not
// who made them: no consent to share a founder with a partner is recorded.
r.get('/partner/:uid/claims', async (c) => {
  try {
    const user = await partnerOnly(c);
    const perk = await myPerk(c.env, c.req.param('uid'), user.id, await activeCompanyFor(c, user));
    if (!perk) return c.json({ error: 'not_found' }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT uid, status, expires_at, redeemed_at, created_at
         FROM perk_claims WHERE perk_id = ? ORDER BY created_at DESC LIMIT 500`,
    ).bind(perk.id).all<any>();
    const today = todayIso();
    return c.json({
      items: (rows.results || []).map((x: any) => ({ ...x, state: claimState(x, today) })),
      absent: { founder: 'Who made each claim is not shown: no founder has consented to share their company with a partner, and nothing records that consent yet.' },
    });
  } catch (e) { return mapError(c, e); }
});

// POST /partner/:uid/redeem — the partner marks one claim on THEIR listing
// redeemed (D412). Until now nothing wrote `redeemed`, so every redemption
// figure was a permanent zero. Body: { code } for a code perk, or
// { claim_uid } for a link or intro perk, which has no code.
//
// The redemption happens on the partner's side, where Axal cannot see it, so
// the partner is the only party who can say it did. It is a write on another
// account's claim, so the actor is stored on the row and in activity_logs.
r.post('/partner/:uid/redeem', async (c) => {
  try {
    const user = await partnerOnly(c);
    const perk = await myPerk(c.env, c.req.param('uid'), user.id, await activeCompanyFor(c, user));
    if (!perk) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const code = str(b?.code, 40).toUpperCase();
    const claimUid = str(b?.claim_uid, 64);
    if (!code && !claimUid) return refuse(c, 400, { code: 'claim_required', message: 'Give the claim code, or the claim id for a perk without codes.' });
    // Bound to THIS listing, so a code from another listing — the partner's own
    // or anyone else's — is simply not found.
    const claim = await c.env.DB.prepare(
      code
        ? 'SELECT id, uid, user_id, status, expires_at, redeemed_at FROM perk_claims WHERE perk_id = ? AND UPPER(code) = ?'
        : 'SELECT id, uid, user_id, status, expires_at, redeemed_at FROM perk_claims WHERE perk_id = ? AND uid = ?',
    ).bind(perk.id, code || claimUid).first<any>();
    if (!claim) return refuse(c, 404, { code: 'claim_not_found', message: 'No claim on this listing matches that code.' });
    const today = todayIso();
    const state = claimState(claim, today);
    if (state === 'redeemed') {
      return refuse(c, 409, { code: 'already_redeemed', message: 'This claim was already marked redeemed.', extra: { redeemed_at: claim.redeemed_at } });
    }
    if (state !== 'issued') {
      return refuse(c, 409, { code: 'claim_not_redeemable', message: state === 'expired' ? 'This claim expired before it was redeemed.' : `This claim is ${state} and cannot be redeemed.` });
    }
    const now = nowIso();
    const upd = await c.env.DB.prepare(
      `UPDATE perk_claims SET status = 'redeemed', redeemed_at = ?, redeemed_by_user_id = ?
        WHERE id = ? AND status = 'issued'`,
    ).bind(now, user.id, claim.id).run();
    if ((upd?.meta?.changes ?? 0) < 1) {
      return refuse(c, 409, { code: 'already_redeemed', message: 'This claim was already marked redeemed.' });
    }
    try {
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
      ).bind('perk_claim_redeemed', JSON.stringify({ perk_uid: perk.uid, claim_uid: claim.uid, founder_user_id: claim.user_id }),
        user.email || String(user.id), user.id).run();
    } catch (e) { console.warn('[perks] redeem activity log failed', (e as Error)?.message); }
    return c.json({ ok: true, claim_uid: claim.uid, state: 'redeemed', redeemed_at: now });
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
    // D412 — the editorial quote on a featured card is Axal's, so only this
    // route writes it; omitted keeps what is there, '' clears it.
    const editorial = b?.editorial_note === undefined ? perk.editorial_note : (str(b.editorial_note, 500) || null);
    await c.env.DB.prepare(
      `UPDATE perks SET status = ?, review_note = ?, reviewed_by_user_id = ?,
              reviewed_at = ?, featured = ?, editorial_note = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      status, str(b?.review_note, 1000) || null, admin.id, nowIso(),
      b?.featured ? 1 : perk.featured, editorial, nowIso(), perk.id,
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
    // A listing past its end date is not on the shelf, whatever its status
    // says: it could not be claimed (D412), so it is not offered.
    const today = todayIso();
    const rows = await c.env.DB.prepare(
      `${LISTING_SELECT}
        WHERE p.status = 'live' AND (p.ends_at IS NULL OR p.ends_at >= ?)
        ORDER BY p.featured DESC, p.created_at DESC LIMIT 200`,
    ).bind(today).all<PerkRow>();
    const perks = rows.results || [];
    const balance = await balanceOf(c.env, user.id);
    const claimed = await c.env.DB.prepare(
      'SELECT perk_id FROM perk_claims WHERE user_id = ?',
    ).bind(user.id).all<{ perk_id: number }>();
    const mine = new Set((claimed.results || []).map((x) => x.perk_id));
    return c.json({
      items: perks.map((p) => ({
        ...publicPerk(p, today),
        claimed: mine.has(p.id),
        ...affordability(p, user, balance, today),
      })),
      balance,
      // Whether THIS account may claim at all, and why not, once for the page
      // rather than per card.
      claimant: isClaimant(user),
      claimant_reason: isClaimant(user) ? null : NOT_A_CLAIMANT,
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
      `${LISTING_SELECT} WHERE p.uid = ? AND p.status = 'live'`,
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
      'SELECT uid, code, redeem_url, status, expires_at, redeemed_at, created_at FROM perk_claims WHERE perk_id = ? AND user_id = ?',
    ).bind(perk.id, user.id).first<any>();
    const myRating = await c.env.DB.prepare(
      'SELECT stars FROM perk_ratings WHERE perk_id = ? AND user_id = ?',
    ).bind(perk.id, user.id).first<{ stars: number }>();
    return c.json({
      ...publicPerk(perk),
      detail: perk.detail,
      balance,
      claim: claim ? { ...claim, state: claimState(claim) } : null,
      my_rating: myRating?.stars ?? null,
      can_rate: isClaimant(user) && claim?.status === PERK_RATING_REQUIRES,
      ...affordability(perk, user, balance),
      absent: listingAbsences(perk),
    });
  } catch (e) { return mapError(c, e); }
});

// POST /:uid/rating — { stars: 1-5 }. A founder rates a perk they have used:
// PERK_RATING_REQUIRES says what "used" means, and it is the claim's state.
// One rating per founder per perk; rating again replaces it.
r.post('/:uid/rating', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isClaimant(user)) return refuse(c, 403, { code: 'founders_only', message: NOT_A_CLAIMANT });
    const b = await c.req.json().catch(() => ({} as any));
    const stars = Number(b?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return refuse(c, 400, { code: 'stars_invalid', message: 'A rating is a whole number of stars from 1 to 5.' });
    }
    const perk = await c.env.DB.prepare('SELECT id FROM perks WHERE uid = ?')
      .bind(c.req.param('uid')).first<{ id: number }>();
    if (!perk) return c.json({ error: 'not_found' }, 404);
    const claim = await c.env.DB.prepare('SELECT status FROM perk_claims WHERE perk_id = ? AND user_id = ?')
      .bind(perk.id, user.id).first<{ status: string }>();
    if (claim?.status !== PERK_RATING_REQUIRES) {
      return refuse(c, 403, { code: 'rating_requires_redemption', message: 'You can rate a perk once the partner has marked your claim redeemed.' });
    }
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO perk_ratings (perk_id, user_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(perk_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = excluded.updated_at`,
    ).bind(perk.id, user.id, stars, now, now).run();
    const agg = await c.env.DB.prepare('SELECT COUNT(*) AS n, AVG(stars) AS avg FROM perk_ratings WHERE perk_id = ?')
      .bind(perk.id).first<{ n: number; avg: number }>();
    return c.json({ ok: true, stars, rating: { count: Number(agg?.n) || 0, average: Math.round(Number(agg?.avg) * 10) / 10 } });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/claim', async (c) => {
  try {
    const user = await requireAuth(c);
    // Founders only (D412), and before anything else is read: a non-founder
    // learns nothing about the listing's price or cap from a refusal.
    if (!isClaimant(user)) {
      return refuse(c, 403, { code: 'founders_only', message: NOT_A_CLAIMANT });
    }
    const today = todayIso();
    const perk = await c.env.DB.prepare(
      `${LISTING_SELECT} WHERE p.uid = ? AND p.status = 'live'`,
    ).bind(c.req.param('uid')).first<PerkRow>();
    if (!perk) return c.json({ error: 'not_found' }, 404);

    const existing = await c.env.DB.prepare(
      'SELECT uid, code, redeem_url, status, expires_at FROM perk_claims WHERE perk_id = ? AND user_id = ?',
    ).bind(perk.id, user.id).first<any>();
    // Idempotent: a second claim returns the first one rather than erroring,
    // so a double-click shows the code instead of a failure.
    if (existing) return c.json({ ...existing, already_claimed: true });

    const balance = await balanceOf(c.env, user.id);
    const afford = affordability(perk, user, balance, today);
    if (!afford.claimable) return claimRefusal(c, afford.reason, afford);

    const claimUid = newUid();
    const now = nowIso();
    const cost = perk.kind === 'credits' ? (Number(perk.credits) || 0) : 0;
    // A code is issued per claim; it is not read from the request, so a caller
    // cannot choose their own redemption code.
    const code = perk.fulfilment === 'code'
      ? `AXAL-${newUid().replace(/-/g, '').slice(0, 10).toUpperCase()}`
      : null;
    // THE CLAIM EXPIRES WHEN THE OFFER DOES (D412). `expires_at` has existed
    // since migration 186 and nothing wrote it, so no claim ever said how long
    // it was good for. The listing's own end date is the only term anyone has
    // set — the partner's "duration" — and it is snapshotted here, as the price
    // is, so a later edit to the listing cannot shorten a claim already made.
    // An open-ended listing gives an open-ended claim (null), not a guess.
    const expiresAt = perk.ends_at ? String(perk.ends_at).slice(0, 10) : null;

    // THE CAP, THE BALANCE AND THE OPEN WINDOW ARE CHECKED IN THE INSERT
    // (D412), not before it. They used to be a COUNT and a SUM read ahead of
    // the batch, so two concurrent claims could both pass and overrun the cap,
    // or spend one balance twice across two perks. An INSERT … SELECT … WHERE
    // is one statement, D1 runs a batch as one transaction, and the debit is
    // conditional on the claim row existing — so a claim either lands with its
    // debit, inside the cap and the balance, or neither lands.
    const stmts = [
      c.env.DB.prepare(
        `INSERT INTO perk_claims (uid, perk_id, user_id, credits_spent, claimed_price_cents,
                                  kind_at_claim, code, redeem_url, status, expires_at, created_at)
         SELECT ?,?,?,?,?,?,?,?, 'issued', ?, ?
          WHERE EXISTS (SELECT 1 FROM perks
                         WHERE id = ? AND status = 'live' AND (ends_at IS NULL OR ends_at >= ?))
            AND (? IS NULL OR (SELECT COUNT(*) FROM perk_claims WHERE perk_id = ?) < ?)
            AND (? = 0 OR (SELECT COALESCE(SUM(delta), 0) FROM perk_credit_ledger WHERE user_id = ?) >= ?)`,
      ).bind(
        claimUid, perk.id, user.id, cost, perk.price_cents, perk.kind, code, perk.redeem_url, expiresAt, now,
        perk.id, today,
        perk.claim_cap, perk.id, perk.claim_cap,
        cost, user.id, cost,
      ),
    ];
    if (cost > 0) {
      // Same batch as the claim: a claim without its debit is not reachable,
      // and the debit is written only if the claim row above was.
      // source_ref 'perk:<claim uid>' makes the spend idempotent against the
      // ledger's unique index even if this batch were somehow retried.
      stmts.push(c.env.DB.prepare(
        `INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, created_at)
         SELECT ?,?, 'spend', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM perk_claims WHERE uid = ?)`,
      ).bind(user.id, -cost, `perk:${claimUid}`, perk.offer.slice(0, 200), now, claimUid));
    }
    try {
      await c.env.DB.batch(stmts);
    } catch (e) {
      // UNIQUE(perk_id, user_id): a concurrent claim by the same founder won.
      // Hand back that one, as the idempotent path above does.
      const raced = await c.env.DB.prepare(
        'SELECT uid, code, redeem_url, status, expires_at FROM perk_claims WHERE perk_id = ? AND user_id = ?',
      ).bind(perk.id, user.id).first<any>();
      if (raced) return c.json({ ...raced, already_claimed: true });
      throw e;
    }

    const landed = await c.env.DB.prepare('SELECT uid FROM perk_claims WHERE uid = ?')
      .bind(claimUid).first<{ uid: string }>();
    if (!landed) {
      // Something changed between the read and the write. Re-read and say
      // which condition the insert refused on.
      const now2 = await c.env.DB.prepare(`${LISTING_SELECT} WHERE p.id = ?`).bind(perk.id).first<PerkRow>();
      const bal2 = await balanceOf(c.env, user.id);
      const why = now2 && now2.status === 'live' ? affordability(now2, user, bal2, today) : { claimable: false, reason: 'perk_ended' };
      return claimRefusal(c, why.claimable ? 'cap_reached' : why.reason, why);
    }

    return c.json({
      uid: claimUid,
      code,
      redeem_url: perk.redeem_url,
      status: 'issued',
      expires_at: expiresAt,
      credits_spent: cost,
      balance: balance - cost,
      fulfilment: perk.fulfilment,
    }, 201);
  } catch (e) { return mapError(c, e); }
});

/** One refusal per claim reason, each with our own sentence (D258 / D278). */
function claimRefusal(c: any, reason: string | null | undefined, detail: Record<string, unknown>) {
  switch (reason) {
    case 'tier_required':
      return refuse(c, 402, { code: 'tier_required', message: `This perk is included in the ${String(detail.required_tier || 'growth')} plan.`, extra: detail });
    case 'insufficient_credits':
      return refuse(c, 409, { code: 'insufficient_credits', message: 'You do not have enough perk credits for this one.', extra: detail });
    case 'cap_reached':
      return refuse(c, 409, { code: 'cap_reached', message: 'This perk has reached its claim limit.', extra: detail });
    case 'perk_ended':
      return refuse(c, 409, { code: 'perk_ended', message: 'This offer has ended and can no longer be claimed.', extra: detail });
    case 'founders_only':
      return refuse(c, 403, { code: 'founders_only', message: NOT_A_CLAIMANT });
    default:
      return refuse(c, 409, { code: 'not_claimable', message: 'This perk cannot be claimed right now.', extra: detail });
  }
}

export default r;
