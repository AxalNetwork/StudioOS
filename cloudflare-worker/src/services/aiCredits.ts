/**
 * D755 (#1870, #1905) — AI credits: token packs and the top-up ledger.
 *
 * Three balances, never mixed (D755 §1):
 *   - the AI top-up balance: `ai_topup_accounts` and `ai_credit_ledger`
 *     (migration 486), bought only as Stripe token packs;
 *   - Perk credits: earned or granted, never bought;
 *   - Introduction credits: no longer sold.
 * There is no transfer, conversion or shared code path between them, and no
 * file here reads the perk or the introduction ledger.
 *
 * Every amount is integer micro-USD (`AI_USD_SCALE`), except a pack's face
 * value, which is Stripe's integer cents.
 */
import type { Env } from '../types';
import { AI_USD_SCALE, planView } from './aiBudget';
import type { PricedCart } from './orders';

const usd = (dollars: number) => dollars * AI_USD_SCALE;

/** The one constant block for D755 §16. */
export const TOKEN_PACK_LIMITS = Object.freeze({
  /** A pack's face value, whole dollars from $5 to $500. */
  minFaceCents: 500,
  maxFaceCents: 50_000,
  /** A pack's bonus, at most 10% of its face value. */
  maxBonusPercent: 10,
  /** Pack orders per member in any rolling 24 hours. */
  ordersPerDay: 5,
  orderWindowHours: 24,
  /** Balance + uncredited packs + this pack never goes above $1,000. */
  balanceCeilingMicrousd: usd(1_000),
  /** No pack is sold for this long after a shortfall. */
  shortfallHoldDays: 90,
  /** One adjustment moves at most $100 either way. */
  maxAdjustmentMicrousd: usd(100),
  /** At most $250 is added by adjustments per member in 30 days. */
  maxAdjustmentAddedMicrousd: usd(250),
  adjustmentWindowDays: 30,
});

/** SUM(delta_microusd) for one member: equal to their balance, for tests and CR2's reconcile read. */
export async function ledgerBalance(env: Env, userId: number): Promise<number> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('AI ledger unreadable');
  const row = await env.DB.prepare('SELECT COALESCE(SUM(delta_microusd),0) AS balance FROM ai_credit_ledger WHERE user_id = ?')
    .bind(userId).first<{ balance: number }>();
  if (!row || !Number.isSafeInteger(row.balance)) throw new Error('AI ledger unreadable');
  return row.balance;
}

/**
 * A token pack: a row of `ai_token_packs`, or the `STRIPE_PRICE_AI_TOPUP`
 * fallback (origin `environment`: no row, no bonus, face value from the
 * mirrored price). The list is D1's, never Stripe metadata (D755 §3).
 */
export type TokenPack =
  | { origin: 'created' | 'adopted'; packUid: string; priceId: string; productId: string; faceCents: number; bonusMicrousd: number; onSale: boolean;
      offerStartsAt: string | null; offerEndsAt: string | null; firstPurchaseOnly: boolean }
  | { origin: 'environment'; packUid: null; priceId: string; productId: null; faceCents: null; bonusMicrousd: 0; onSale: true;
      offerStartsAt: null; offerEndsAt: null; firstPurchaseOnly: false };

/**
 * D790 (#2215): whether a pack's bonus is offered at `now`: from its start
 * (inclusive) to its end (exclusive), either end open (migration 509). A
 * window that cannot be read offers no bonus.
 */
export function offerOpen(window: { offer_starts_at?: string | null; offer_ends_at?: string | null }, now = Date.now()): boolean {
  const starts = window.offer_starts_at ?? null, ends = window.offer_ends_at ?? null;
  const s = starts === null ? -Infinity : Date.parse(starts), e = ends === null ? Infinity : Date.parse(ends);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return s <= now && now < e;
}

/** D790: whether a member has bought a pack before: any purchase on the ledger, refunded or not. */
export async function hasBoughtPack(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM ai_credit_ledger WHERE user_id = ? AND kind = 'purchase') AS bought`)
    .bind(userId).first<{ bought: number }>();
  if (!row) throw new Error('AI top-up purchases unreadable');
  return row.bought === 1;
}

function fallbackPriceId(env: Env): string | null {
  const raw = (env as any).STRIPE_PRICE_AI_TOPUP;
  return typeof raw === 'string' && /^price_[A-Za-z0-9]+$/.test(raw) ? raw : null;
}
/**
 * One read of the pack store. Where migration 486 has not run (a database
 * built without it), the table is absent and so no pack can exist: that is
 * the only failure read as "no pack". Any other failed read throws.
 */
async function packStore<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (/no such table: ai_token_packs\b/.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
}
async function packRow(env: Env, priceId: string) {
  return packStore(() => env.DB.prepare('SELECT * FROM ai_token_packs WHERE price_id = ?').bind(priceId).first<any>());
}

/** The pack sold at this price (not archived), the fallback, or null. */
export async function tokenPackForPrice(env: Env, priceId: string): Promise<TokenPack | null> {
  if (typeof priceId !== 'string' || !priceId) return null;
  const row = await packRow(env, priceId);
  if (row) {
    if (row.archived_at !== null) return null;
    return { origin: row.origin, packUid: row.uid, priceId: row.price_id, productId: row.product_id,
      faceCents: row.face_cents, bonusMicrousd: row.bonus_microusd, onSale: row.on_sale === 1,
      offerStartsAt: row.offer_starts_at ?? null, offerEndsAt: row.offer_ends_at ?? null, firstPurchaseOnly: row.first_purchase_only === 1 };
  }
  if (fallbackPriceId(env) === priceId)
    return { origin: 'environment', packUid: null, priceId, productId: null, faceCents: null, bonusMicrousd: 0, onSale: true,
      offerStartsAt: null, offerEndsAt: null, firstPurchaseOnly: false };
  return null;
}

/** Any pack price, archived ones included, or the fallback: none is sold anywhere but the order intent. */
export async function isTokenPackPrice(env: Env, priceId: string): Promise<boolean> {
  if (typeof priceId !== 'string' || !priceId) return false;
  if (fallbackPriceId(env) === priceId) return true;
  return (await packRow(env, priceId)) !== null;
}

/** Any pack's product, or the fallback price's product. */
export async function isTokenPackProduct(env: Env, productId: string): Promise<boolean> {
  if (typeof productId !== 'string' || !productId) return false;
  const row = await packStore(() => env.DB.prepare('SELECT 1 AS hit FROM ai_token_packs WHERE product_id = ? LIMIT 1').bind(productId).first<any>());
  if (row) return true;
  const fallback = fallbackPriceId(env);
  if (!fallback) return false;
  const { findCatalogProductByPriceId } = await import('./catalog');
  return (await findCatalogProductByPriceId(env, fallback))?.product.id === productId;
}

/**
 * The face value a pack sells at now, or null when it is not on sale: the row
 * is on sale and its mirrored price passes D750's `judge` and equals
 * `face_cents`. The fallback follows D750's rules alone.
 */
async function saleFaceCents(env: Env, pack: TokenPack): Promise<number | null> {
  const { judge, readAiTopupProduct } = await import('./aiTopups');
  if (pack.origin === 'environment') {
    const r = await readAiTopupProduct(env);
    return r.configured && r.state === 'ready' && r.product.price_id === pack.priceId ? r.product.unit_amount : null;
  }
  if (!pack.onSale) return null;
  const { findCatalogProductByPriceId } = await import('./catalog');
  const found = await findCatalogProductByPriceId(env, pack.priceId);
  if (!found || found.product.id !== pack.productId) return null;
  const r = judge(pack.priceId, found);
  return r.configured && r.state === 'ready' && r.product.unit_amount === pack.faceCents ? pack.faceCents : null;
}
export async function packOnSale(env: Env, pack: TokenPack): Promise<boolean> {
  return (await saleFaceCents(env, pack)) !== null;
}

/** §16's hold: an open dispute, or a shortfall in the last 90 days. */
export async function packsOnHold(env: Env, userId: number): Promise<boolean> {
  const hold = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM ai_topup_purchases WHERE user_id = ? AND dispute_state = 'open') AS disputed,
      EXISTS(SELECT 1 FROM ai_credit_ledger WHERE user_id = ? AND shortfall_microusd > 0 AND created_at > datetime('now', ?)) AS short`)
    .bind(userId, userId, `-${TOKEN_PACK_LIMITS.shortfallHoldDays} days`).first<any>();
  if (!hold) throw new Error('AI top-up holds unreadable');
  return Boolean(hold.disputed || hold.short);
}

export type TokenPackRefusal = 'token_pack_alone' | 'promo_not_for_token_packs' | 'token_pack_not_on_sale'
  | 'token_pack_daily_limit' | 'token_balance_ceiling' | 'token_packs_on_hold' | 'token_pack_first_purchase_only';
export type TokenPackQuote = { priceId: string; packUid: string | null; creditMicrousd: number; bonusMicrousd: number; firstPurchaseOnly: boolean };

/**
 * D805 (#2243): the member's pack orders in the rolling window
 * (`TOKEN_PACK_LIMITS.orderWindowHours`), counted once, for the purchase check
 * (`tokenPackQuote`) and for the read that shows the count
 * (`GET /api/ai-budget/limit`'s `pack_orders`). Every order is an
 * `ai_topup_purchases` row, an auto-reload (D794) included, since it is bought
 * through the same check. `excludeOrderRef` leaves out the order being
 * refreshed, so a refresh is not counted against itself.
 *   - `n`: orders in the window;
 *   - `pending`: what those not yet credited will add to the balance;
 *   - `oldest`: the oldest order's `created_at`, when the count next drops.
 */
export async function recentPackOrders(env: Env, userId: number, excludeOrderRef = ''): Promise<{ n: number; pending: number; oldest: string | null }> {
  const window = `-${TOKEN_PACK_LIMITS.orderWindowHours} hours`;
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN credited_at IS NULL THEN credit_microusd+bonus_microusd ELSE 0 END),0) AS pending,
      MIN(created_at) AS oldest
    FROM ai_topup_purchases WHERE user_id = ? AND order_ref <> ? AND created_at > datetime('now', ?)`)
    .bind(userId, excludeOrderRef, window).first<any>();
  if (!recent || !Number.isSafeInteger(recent.n) || !Number.isSafeInteger(recent.pending)) throw new Error('AI top-up purchases unreadable');
  return { n: recent.n, pending: recent.pending, oldest: typeof recent.oldest === 'string' ? recent.oldest : null };
}

/**
 * D805: the member's pack orders as the limits card reads them: `today` in the
 * rolling window, out of `per_day`, and `resets_at`, when the oldest of them
 * leaves the window (null with none). The same count `tokenPackQuote` refuses at.
 */
export async function packOrdersToday(env: Env, userId: number): Promise<{ today: number; per_day: number; window_hours: number; resets_at: string | null }> {
  const { n, oldest } = await recentPackOrders(env, userId);
  const resets = oldest ? new Date(Date.parse(`${oldest.replace(' ', 'T')}Z`) + TOKEN_PACK_LIMITS.orderWindowHours * 3_600_000) : null;
  return {
    today: n, per_day: TOKEN_PACK_LIMITS.ordersPerDay, window_hours: TOKEN_PACK_LIMITS.orderWindowHours,
    resets_at: resets && Number.isFinite(resets.getTime()) ? resets.toISOString() : null,
  };
}

/**
 * D755 §5: the quote for an order with a pack line, a refusal, or null when no
 * line is a pack. Called before the promo is resolved, so a pack never reaches
 * the free path. `excludeOrderRef` is this order's own earlier purchase row,
 * when the intent is refreshed, so a refresh is not counted against itself.
 */
export async function tokenPackQuote(env: Env, userId: number, cart: PricedCart, promoCode: string,
  opts: { excludeOrderRef?: string | null } = {}): Promise<TokenPackQuote | { error: TokenPackRefusal } | null> {
  const flags = await Promise.all(cart.lines.map((l) => isTokenPackPrice(env, l.price_id)));
  if (!flags.some(Boolean)) return null;
  if (cart.lines.length !== 1 || cart.lines[0].quantity !== 1) return { error: 'token_pack_alone' };
  if (promoCode) return { error: 'promo_not_for_token_packs' };
  const line = cart.lines[0];
  const pack = await tokenPackForPrice(env, line.price_id);
  const face = pack ? await saleFaceCents(env, pack) : null;
  if (!pack || face === null || line.unit_amount !== face || cart.currency !== 'usd') return { error: 'token_pack_not_on_sale' };
  // D790: a first-purchase pack is for a member who has bought none; the webhook checks again.
  if (pack.firstPurchaseOnly && await hasBoughtPack(env, userId)) return { error: 'token_pack_first_purchase_only' };
  const creditMicrousd = face * (AI_USD_SCALE / 100);
  // D790: the bonus only while its offer window is open. The one quoted here is stored on the purchase row.
  const bonusMicrousd = offerOpen({ offer_starts_at: pack.offerStartsAt, offer_ends_at: pack.offerEndsAt }) ? pack.bonusMicrousd : 0;
  const recent = await recentPackOrders(env, userId, opts.excludeOrderRef ?? '');
  if (recent.n >= TOKEN_PACK_LIMITS.ordersPerDay) return { error: 'token_pack_daily_limit' };
  const account = await env.DB.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').bind(userId).first<any>();
  const balance = account ? account.balance_microusd : 0;
  if (!Number.isSafeInteger(balance)) throw new Error('AI top-up balance unreadable');
  if (balance + recent.pending + creditMicrousd + bonusMicrousd > TOKEN_PACK_LIMITS.balanceCeilingMicrousd) return { error: 'token_balance_ceiling' };
  if (await packsOnHold(env, userId)) return { error: 'token_packs_on_hold' };
  return { priceId: line.price_id, packUid: pack.packUid, creditMicrousd, bonusMicrousd, firstPurchaseOnly: pack.firstPurchaseOnly };
}

// ---------------------------------------------------------------------------
// D755 CR2 (#1919): the reads, and the Super Admin's account tools.
// ---------------------------------------------------------------------------

/** "$25 of tokens": the label is derived from the face value, never stored or typed (§3). */
export function packLabel(faceCents: number): string {
  const dollars = faceCents % 100 === 0 ? String(faceCents / 100) : (faceCents / 100).toFixed(2);
  return `$${dollars} of tokens`;
}

type MirroredPrice = { product: { id: string; name: string; active: boolean }; price: { id: string; active: boolean; type: string; currency: string; unit_amount: number | null } };
/**
 * One price as the D1 catalog mirror holds it, read from D1 alone. Unlike
 * `findCatalogProductByPriceId` it never syncs an empty mirror from Stripe, so
 * the public read never calls Stripe (§13). A missing mirror table is no price.
 */
async function mirrorIndex(env: Env): Promise<Map<string, MirroredPrice>> {
  let rows: any[] = [];
  try {
    const res = await env.DB.prepare('SELECT id, name, active, prices_json FROM stripe_products').all<any>();
    if (res.success !== true) throw new Error('catalog mirror unreadable');
    rows = res.results ?? [];
  } catch (e) {
    if (!/no such table: stripe_products\b/.test(String((e as Error)?.message ?? e))) throw e;
  }
  const out = new Map<string, MirroredPrice>();
  for (const row of rows) {
    let prices: any[];
    try { prices = JSON.parse(row.prices_json); } catch { continue; }
    if (!Array.isArray(prices)) continue;
    for (const p of prices) if (p && typeof p.id === 'string')
      out.set(p.id, { product: { id: row.id, name: row.name, active: row.active === 1 }, price: { id: p.id, active: p.active === true, type: p.type, currency: p.currency, unit_amount: p.unit_amount ?? null } });
  }
  return out;
}

export type PackLine = { uid: string | null; origin: 'created' | 'adopted' | 'environment'; price_id: string; face_cents: number | null;
  on_sale: boolean; bonus_microusd: number; sort: number; state: 'ready' | 'not_ready'; reason: string | null; adoptable: boolean;
  offer_starts_at: string | null; offer_ends_at: string | null; first_purchase_only: boolean };
/**
 * Every pack HQ manages, not archived, with D750's state and reason per pack
 * (§14), plus the fallback as its own line when it is set and is not a row.
 * Reads D1 only: a price the mirror lacks is `missing_from_catalog`.
 */
export async function packLines(env: Env): Promise<PackLine[]> {
  const { judge } = await import('./aiTopups');
  const rows = await packStore(async () => {
    const res = await env.DB.prepare('SELECT * FROM ai_token_packs WHERE archived_at IS NULL ORDER BY sort, face_cents, uid').all<any>();
    if (res.success !== true) throw new Error('AI token packs unreadable');
    return res.results ?? [];
  }) ?? [];
  const mirror = await mirrorIndex(env);
  const lines: PackLine[] = rows.map((row: any) => {
    const found = mirror.get(row.price_id);
    let reason: string | null = null;
    if (!found) reason = 'missing_from_catalog';
    else if (found.product.id !== row.product_id) reason = 'product_mismatch';
    else {
      const r = judge(row.price_id, found as any);
      if (r.configured && r.state === 'not_ready') reason = r.reason;
      else if (r.configured && r.state === 'ready' && r.product.unit_amount !== row.face_cents) reason = 'price_mismatch';
    }
    if (!reason && row.on_sale !== 1) reason = 'off_sale';
    return { uid: row.uid, origin: row.origin, price_id: row.price_id, face_cents: row.face_cents, on_sale: row.on_sale === 1,
      bonus_microusd: row.bonus_microusd, sort: row.sort, state: reason ? 'not_ready' : 'ready', reason, adoptable: false,
      offer_starts_at: row.offer_starts_at ?? null, offer_ends_at: row.offer_ends_at ?? null, first_purchase_only: row.first_purchase_only === 1 };
  });
  const raw = (env as any).STRIPE_PRICE_AI_TOPUP;
  if (raw !== undefined && raw !== null && raw !== '') {
    const id = fallbackPriceId(env);
    const all = id ? await packStore(() => env.DB.prepare('SELECT 1 AS hit FROM ai_token_packs WHERE price_id = ?').bind(id).first<any>()) : null;
    if (!all) {
      const found = id ? mirror.get(id) : undefined;
      const r = id && found ? judge(id, found as any) : null;
      const reason = !id ? 'bad_config' : !found ? 'missing_from_catalog' : r && r.configured && r.state === 'not_ready' ? r.reason : null;
      lines.push({ uid: null, origin: 'environment', price_id: id ?? '', face_cents: r && r.configured && r.state === 'ready' ? r.product.unit_amount : null,
        on_sale: true, bonus_microusd: 0, sort: Number.MAX_SAFE_INTEGER, state: reason ? 'not_ready' : 'ready', reason, adoptable: Boolean(id),
        offer_starts_at: null, offer_ends_at: null, first_purchase_only: false });
    }
  }
  return lines;
}

/**
 * A pack a member may buy now. D790: `bonus_microusd` (and `bonus_usd`) is the
 * bonus offered now, 0 outside the offer window; `offer_ends_at` is when a live
 * bonus ends (null for none, or no end); `first_purchase_only` says the pack is
 * for a member who has bought none.
 */
export type PackOffer = { uid: string | null; label: string; price_id: string; unit_amount: number; currency: 'usd'; credit_microusd: number; bonus_microusd: number;
  bonus_usd: number; offer_ends_at: string | null; first_purchase_only: boolean };
/** The packs a member may buy now, as the member and the public reads list them. */
export async function packsOnSale(env: Env, now = Date.now()): Promise<{ state: 'unset' | 'not_ready' | 'ready'; packs: PackOffer[] }> {
  const lines = await packLines(env);
  const packs = lines.filter((l) => l.state === 'ready' && l.face_cents !== null).map((l) => {
    const bonus = offerOpen(l, now) ? l.bonus_microusd : 0;
    return {
      uid: l.uid, label: packLabel(l.face_cents as number), price_id: l.price_id, unit_amount: l.face_cents as number,
      currency: 'usd' as const, credit_microusd: (l.face_cents as number) * (AI_USD_SCALE / 100), bonus_microusd: bonus,
      bonus_usd: bonus / AI_USD_SCALE, offer_ends_at: bonus > 0 ? l.offer_ends_at : null, first_purchase_only: l.first_purchase_only };
  });
  return { state: lines.length === 0 ? 'unset' : packs.length ? 'ready' : 'not_ready', packs };
}

export type PurchaseState = 'waiting' | 'overdue' | 'credited' | 'refunded' | 'disputed';
const PURCHASE_SELECT = `SELECT p.payment_intent_id, p.order_ref, p.user_id, p.pack_uid, p.credit_microusd, p.bonus_microusd,
    p.reversed_microusd, p.dispute_state, p.credited_at, p.created_at, o.status AS order_status, o.paid_at,
    k.face_cents AS pack_face_cents,
    CASE WHEN p.credited_at IS NULL AND o.status = 'paid' AND o.paid_at <= datetime('now', '-1 hours') THEN 1 ELSE 0 END AS overdue
  FROM ai_topup_purchases p
  LEFT JOIN orders o ON o.order_ref = p.order_ref
  LEFT JOIN ai_token_packs k ON k.uid = p.pack_uid`;
function purchaseState(row: any): PurchaseState {
  if (row.dispute_state === 'open' || row.dispute_state === 'lost') return 'disputed';
  if (row.reversed_microusd > 0) return 'refunded';
  if (row.credited_at) return 'credited';
  return row.overdue === 1 ? 'overdue' : 'waiting';
}
function purchaseView(row: any) {
  const face = row.pack_face_cents ?? Math.floor(row.credit_microusd / (AI_USD_SCALE / 100));
  return { payment_intent_id: row.payment_intent_id, order_ref: row.order_ref, pack_uid: row.pack_uid, pack_label: packLabel(face),
    state: purchaseState(row), amount_microusd: row.credit_microusd + row.bonus_microusd, credit_microusd: row.credit_microusd,
    bonus_microusd: row.bonus_microusd, reversed_microusd: row.reversed_microusd, dispute_state: row.dispute_state,
    credited_at: row.credited_at, at: row.created_at };
}
/**
 * A member's purchases, newest first. `where` is only ever a literal fragment
 * written in this file, its values bound through `binds`; PURCHASE_SELECT is a
 * constant. The orders table is created if missing, so no purchase is ever
 * overdue on a database that has none.
 */
async function purchasesOf(env: Env, userId: number, where = '', binds: unknown[] = [], limit = 100) {
  const { ensureOrdersSchema } = await import('./orders');
  await ensureOrdersSchema(env);
  const res = await env.DB.prepare(`${PURCHASE_SELECT} WHERE p.user_id = ? ${where} ORDER BY p.created_at DESC, p.payment_intent_id DESC LIMIT ?`)
    .bind(userId, ...binds, limit).all<any>();
  if (res.success !== true) throw new Error('AI top-up purchases unreadable');
  return (res.results ?? []).map(purchaseView);
}

/** Owner-scoped checkout receipt projection. Reads existing webhook records only. */
export async function orderTopUp(env: Env, userId: number, orderRef: string) {
  // Probe only columns that also existed before D755. An ordinary historical
  // order is not a pack because HQ later adopts one of its prices.
  try {
    const found = await env.DB.prepare('SELECT payment_intent_id FROM ai_topup_purchases WHERE user_id = ? AND order_ref = ? LIMIT 1')
      .bind(userId, orderRef).all<{ payment_intent_id: string }>();
    if (found.success !== true) throw new Error('AI top-up purchase unreadable');
    if (!found.results?.length) return null;
  } catch (error) {
    // Older development databases can have ordinary orders without the top-up
    // table. All other failed reads remain unreadable.
    if (/no such table: ai_topup_purchases\b/.test(String((error as Error)?.message ?? error))) return null;
    throw error;
  }
  const purchases = await purchasesOf(env, userId, 'AND p.order_ref = ?', [orderRef], 1);
  const purchase = purchases[0];
  if (!purchase) return null;
  const account = await env.DB.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?')
    .bind(userId).first<{ balance_microusd: number }>();
  const balance = account?.balance_microusd ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('AI top-up balance unreadable');
  return { state: purchase.state, amount_microusd: purchase.amount_microusd,
    credit_microusd: purchase.credit_microusd, bonus_microusd: purchase.bonus_microusd,
    balance_microusd: balance, at: purchase.at };
}

/** `GET /api/ai-budget/top-up`'s D755 part: the packs on sale, the hold, and the latest purchase in 24 hours. Never a reason. */
export async function memberTopUp(env: Env, userId: number) {
  const sale = await packsOnSale(env);
  const recent = await purchasesOf(env, userId, `AND p.created_at > datetime('now', ?)`, [`-${TOKEN_PACK_LIMITS.orderWindowHours} hours`], 1);
  const latest = recent[0] ? { order_ref: recent[0].order_ref, pack_label: recent[0].pack_label, state: recent[0].state,
    amount_microusd: recent[0].amount_microusd, at: recent[0].at } : null;
  return { state: sale.state, packs: sale.packs, on_hold: await packsOnHold(env, userId), latest };
}

const MEMBER_KINDS = ['purchase', 'bonus', 'refund', 'dispute', 'dispute_won', 'adjustment'] as const;
const RUN_KINDS = ['hold', 'release', 'spend'] as const;
export const HISTORY_MAX = 50;
/** A ledger cursor: `<created_at>|<uid>`, the row the next page starts after. */
function parseCursor(before: string | undefined) {
  if (before === undefined || before === '') return null;
  const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|([0-9A-Za-z_-]{1,64})$/.exec(before);
  if (!m) throw new RangeError('cursor');
  return { at: m[1], uid: m[2] };
}
/**
 * One member's ledger, newest first, paged on (created_at, uid). `reasons`
 * is the Super Admin's view; a member never reads an adjustment's reason.
 */
export async function ledgerPage(env: Env, userId: number, opts: { before?: string; limit?: number; kinds: readonly string[]; reasons: boolean }) {
  const limit = Math.min(HISTORY_MAX, Math.max(1, Math.floor(Number(opts.limit) || 20)));
  const cursor = parseCursor(opts.before);
  const kinds = opts.kinds.filter((k) => /^[a-z_]+$/.test(k));
  const res = await env.DB.prepare(`SELECT l.uid, l.kind, l.delta_microusd, l.shortfall_microusd, l.source_ref, l.reservation_uid,
      l.pack_uid, l.reason, l.actor, l.created_at, p.order_ref, k.face_cents AS pack_face_cents, p.credit_microusd AS purchase_credit
    FROM ai_credit_ledger l
    LEFT JOIN ai_topup_purchases p ON p.payment_intent_id = l.payment_intent_id
    LEFT JOIN ai_token_packs k ON k.uid = l.pack_uid
    WHERE l.user_id = ? AND l.kind IN (${kinds.map(() => '?').join(',')})
      AND (? IS NULL OR l.created_at < ? OR (l.created_at = ? AND l.uid < ?))
    ORDER BY l.created_at DESC, l.uid DESC LIMIT ?`)
    .bind(userId, ...kinds, cursor?.at ?? null, cursor?.at ?? null, cursor?.at ?? null, cursor?.uid ?? null, limit + 1).all<any>();
  if (res.success !== true) throw new Error('AI ledger unreadable');
  const rows = res.results ?? [];
  const page = rows.slice(0, limit);
  const items = page.map((r: any) => {
    const face = r.pack_face_cents ?? (r.purchase_credit != null ? Math.floor(r.purchase_credit / (AI_USD_SCALE / 100)) : null);
    const item: Record<string, unknown> = { uid: r.uid, kind: r.kind, delta_microusd: r.delta_microusd, shortfall_microusd: r.shortfall_microusd,
      at: r.created_at, order_ref: r.order_ref ?? null, pack_label: face !== null ? packLabel(face) : null, reservation_uid: r.reservation_uid ?? null };
    if (opts.reasons) { item.reason = r.reason; item.actor = r.actor; item.source_ref = r.source_ref; }
    return item;
  });
  const last = page[page.length - 1];
  return { items, next_before: rows.length > limit && last ? `${last.created_at}|${last.uid}` : null };
}
/** `GET /api/ai-budget/history`: the member's own rows; with `runs`, the hold, release and spend too. */
export async function memberHistory(env: Env, userId: number, opts: { before?: string; limit?: number; runs: boolean }) {
  const page = await ledgerPage(env, userId, { before: opts.before, limit: opts.limit, kinds: opts.runs ? [...MEMBER_KINDS, ...RUN_KINDS] : MEMBER_KINDS, reasons: false });
  // Paid but not yet credited purchases lead the first page: "being added".
  const pending = opts.before ? [] : (await purchasesOf(env, userId, 'AND p.credited_at IS NULL'))
    .filter((p) => p.state === 'waiting' || p.state === 'overdue')
    .map((p) => ({ order_ref: p.order_ref, pack_label: p.pack_label, state: p.state, amount_microusd: p.amount_microusd, at: p.at }));
  return { ...page, pending };
}

/** The Super Admin's view of one member's AI account (§14). Read-only: it creates no account row. */
export async function memberAccount(env: Env, userId: number, opts: { before?: string; limit?: number }) {
  const { resolveAiCaps } = await import('./aiBudget');
  const caps = await resolveAiCaps(env, userId);
  const bank = await env.DB.prepare(`SELECT
      (SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?) AS balance,
      (SELECT COALESCE(SUM(topup_microusd),0) FROM ai_budget_reservations WHERE user_id = ? AND status IN ('pending','review')) AS held`)
    .bind(userId, userId).first<any>();
  if (!bank) throw new Error('AI account unreadable');
  const ledger = await ledgerPage(env, userId, { before: opts.before, limit: opts.limit, kinds: [...MEMBER_KINDS, ...RUN_KINDS], reasons: true });
  const purchases = await purchasesOf(env, userId);
  const shortfalls = await env.DB.prepare(`SELECT uid, kind, shortfall_microusd, source_ref, created_at FROM ai_credit_ledger
    WHERE user_id = ? AND shortfall_microusd > 0 ORDER BY created_at DESC, uid DESC LIMIT 100`).bind(userId).all<any>();
  if (shortfalls.success !== true) throw new Error('AI ledger unreadable');
  return { member_id: userId, allowance: { licence_key: caps.licence, source: caps.source, daily_capped: caps.daily_capped, daily_microusd: caps.daily_microusd, monthly_microusd: caps.monthly_microusd, plan: planView(caps.plan) },
    balance_microusd: bank.balance ?? 0, topup_held_microusd: bank.held, ledger_balance_microusd: await ledgerBalance(env, userId),
    on_hold: await packsOnHold(env, userId), ledger, purchases,
    shortfalls: (shortfalls.results ?? []).map((r: any) => ({ uid: r.uid, kind: r.kind, shortfall_microusd: r.shortfall_microusd, source_ref: r.source_ref, at: r.created_at })) };
}

export type AdjustmentOutcome =
  | { ok: true; already: boolean; uid: string; delta_microusd: number; balance_microusd: number }
  | { ok: false; error: 'ai_adjustment_out_of_bounds' | 'idempotency_key_reused'; detail: string };
/**
 * §14 and §16: one `adjustment` row and its balance change in one batch, with
 * the audit row. At most $100 either way, at most $250 added per member in 30
 * days, never below zero. The bounds are checked inside the INSERT, so two
 * concurrent adjustments cannot pass one check together. The member's notice
 * gives the amount and never the reason.
 */
export async function recordAdjustment(env: Env, input: { userId: number; actorId: number; deltaMicrousd: number; reason: string; key: string }): Promise<AdjustmentOutcome> {
  const { userId, actorId, deltaMicrousd: delta, reason, key } = input;
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > TOKEN_PACK_LIMITS.maxAdjustmentMicrousd)
    return { ok: false, error: 'ai_adjustment_out_of_bounds', detail: 'An adjustment moves at most $100 either way, and never $0.' };
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500)
    return { ok: false, error: 'ai_adjustment_out_of_bounds', detail: 'Give a reason of 10 to 500 characters.' };
  const sourceRef = `adj:${key}`;
  const { ensureAdminAuditLogTable } = await import('../routes/admin');
  await ensureAdminAuditLogTable(env);
  const uid = crypto.randomUUID();
  const window = `-${TOKEN_PACK_LIMITS.adjustmentWindowDays} days`;
  const results = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id) VALUES(?)').bind(userId),
    env.DB.prepare(`INSERT OR IGNORE INTO ai_credit_ledger(uid, user_id, kind, delta_microusd, source_ref, actor, reason)
      SELECT ?, a.user_id, 'adjustment', ?, ?, ?, ? FROM ai_topup_accounts a
      WHERE a.user_id = ? AND a.balance_microusd + ? >= 0
        AND (? < 0 OR (SELECT COALESCE(SUM(delta_microusd), 0) FROM ai_credit_ledger
          WHERE user_id = a.user_id AND kind = 'adjustment' AND delta_microusd > 0 AND created_at > datetime('now', ?)) + ? <= ?)`)
      .bind(uid, delta, sourceRef, String(actorId), reason, userId, delta, delta, window, delta, TOKEN_PACK_LIMITS.maxAdjustmentAddedMicrousd),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd = balance_microusd + ?, updated_at = datetime('now')
      WHERE user_id = ? AND EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`).bind(delta, userId, uid),
    env.DB.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, viewed_user_id, filters_json)
      SELECT ?, 'ai_balance_adjustment', 'billing', ?, ? WHERE EXISTS(SELECT 1 FROM ai_credit_ledger WHERE uid = ?)`)
      .bind(actorId, userId, JSON.stringify({ member_id: userId, delta_microusd: delta, reason, source_ref: sourceRef }), uid),
  ]);
  if (results.length !== 4 || results.some((r) => r.success !== true)) throw new Error('AI adjustment unreadable');
  if (Number(results[1].meta.changes) !== 1) {
    // Not written: this key's earlier row (a replay, or a concurrent twin), or a bound.
    const raced = await env.DB.prepare("SELECT uid, user_id, delta_microusd FROM ai_credit_ledger WHERE kind = 'adjustment' AND source_ref = ?").bind(sourceRef).first<any>();
    if (raced && raced.user_id === userId && raced.delta_microusd === delta) {
      const bal = await env.DB.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').bind(userId).first<any>();
      return { ok: true, already: true, uid: raced.uid, delta_microusd: delta, balance_microusd: bal?.balance_microusd ?? 0 };
    }
    if (raced) return { ok: false, error: 'idempotency_key_reused', detail: 'This idempotency key already recorded a different adjustment.' };
    return { ok: false, error: 'ai_adjustment_out_of_bounds', detail: delta < 0
      ? 'An adjustment never takes the balance below zero.'
      : 'At most $250 is added by adjustments to one member in 30 days.' };
  }
  const bal = await env.DB.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').bind(userId).first<any>();
  try {
    const { notify } = await import('./notify');
    const amount = `$${(Math.abs(delta) / AI_USD_SCALE).toFixed(2)}`;
    await notify(env, { userId, type: 'ai_balance_adjusted', category: 'billing',
      title: delta > 0 ? `${amount} added to your AI top-up balance` : `${amount} taken off your AI top-up balance`,
      body: 'Axal adjusted your AI top-up balance. Your Usage page lists every change.', link: '/account/usage#top-ups',
      payload: { delta_microusd: delta }, channels: ['in_app'] });
  } catch { /* best-effort */ }
  return { ok: true, already: false, uid, delta_microusd: delta, balance_microusd: bal?.balance_microusd ?? 0 };
}

export const RESEND_INSTRUCTION = 'Resend payment_intent.succeeded from Stripe › Developers › Events';
/** §14's reconcile: balances that differ from their ledger, purchases paid over an hour ago and not credited, and open disputes. HQ never credits. */
export async function reconcile(env: Env) {
  const { ensureOrdersSchema } = await import('./orders');
  await ensureOrdersSchema(env);
  const mismatched = await env.DB.prepare(`SELECT u.user_id, COALESCE(a.balance_microusd, 0) AS balance_microusd, COALESCE(l.total, 0) AS ledger_microusd
    FROM (SELECT user_id FROM ai_topup_accounts UNION SELECT user_id FROM ai_credit_ledger) u
    LEFT JOIN ai_topup_accounts a ON a.user_id = u.user_id
    LEFT JOIN (SELECT user_id, SUM(delta_microusd) AS total FROM ai_credit_ledger GROUP BY user_id) l ON l.user_id = u.user_id
    WHERE COALESCE(a.balance_microusd, 0) <> COALESCE(l.total, 0) ORDER BY u.user_id`).all<any>();
  const overdue = await env.DB.prepare(`${PURCHASE_SELECT} WHERE p.credited_at IS NULL AND o.status = 'paid' AND o.paid_at <= datetime('now', '-1 hours')
    ORDER BY p.created_at, p.payment_intent_id LIMIT 200`).all<any>();
  const disputes = await env.DB.prepare(`${PURCHASE_SELECT} WHERE p.dispute_state = 'open' ORDER BY p.created_at, p.payment_intent_id LIMIT 200`).all<any>();
  for (const r of [mismatched, overdue, disputes]) if (r.success !== true) throw new Error('AI reconcile unreadable');
  return {
    mismatched: (mismatched.results ?? []).map((r: any) => ({ member_id: r.user_id, balance_microusd: r.balance_microusd, ledger_microusd: r.ledger_microusd,
      difference_microusd: r.balance_microusd - r.ledger_microusd })),
    overdue: (overdue.results ?? []).map((r: any) => ({ member_id: r.user_id, ...purchaseView(r), instruction: RESEND_INSTRUCTION })),
    open_disputes: (disputes.results ?? []).map((r: any) => ({ member_id: r.user_id, ...purchaseView(r) })),
  };
}

export const PLAN_COVERS = 'Covers Eadwyn and the AI tools on every page, Validate interview sessions and live transcription, at the rates on your Usage page.';
export const PLAN_RESETS = 'Resets on the 1st of each month at 00:00 UTC.';
export type PlanFamily = 'founder' | 'investor' | 'advisor' | 'partner' | 'market_intelligence' | 'other';
/** A subscription product's family and licence key, from its metadata (§11). Null when the metadata names no plan: no card. */
export function planOf(metadata: Record<string, string>): { family: PlanFamily; licence_key: string | null } | null {
  if (metadata.tier === 'growth' || metadata.tier === 'studio') return { family: 'founder', licence_key: `founder:${metadata.tier}` };
  if (metadata.investor_tier === 'professional' || metadata.investor_tier === 'institutional') return { family: 'investor', licence_key: `investor:${metadata.investor_tier}` };
  if (metadata.plan_group === 'advisor' || metadata.plan_group === 'partner') return { family: metadata.plan_group, licence_key: metadata.plan_group };
  if (metadata.plan === 'mi_pro') return { family: 'market_intelligence', licence_key: null };
  return null;
}
/**
 * `GET /api/public/plans-and-packs` (§11, §13): every plan with its price from
 * the D1 mirror and its AI allowance from the allowance store, and the packs on
 * sale. D1 only, never Stripe. The allowance is a projection: no recorded_by,
 * no user id and no person's name.
 */
export async function plansAndPacks(env: Env) {
  const { PLAN_AI_SHARE, allowanceFromCharge } = await import('./planAllowance');
  // D783: no plan, no allowance. A paid plan includes 25% of its price each month: each price says what it gives,
  // and the plan's figure is its headline price's (monthly first, else yearly), as the card shows the price.
  const none = { share: PLAN_AI_SHARE, monthly_microusd: 0, source: 'none' };
  const headline = (prices: Array<{ interval: string | null; interval_count: number | null; allowance_microusd: number }>) =>
    prices.find((p) => p.interval === 'month' && (p.interval_count ?? 1) === 1) ?? prices.find((p) => p.interval === 'year' && (p.interval_count ?? 1) === 1) ?? prices[0];
  let rows: any[] = [];
  try {
    const res = await env.DB.prepare("SELECT id, name, active, metadata_json, prices_json FROM stripe_products WHERE kind = 'subscription' AND active = 1 ORDER BY name COLLATE NOCASE ASC, id").all<any>();
    if (res.success !== true) throw new Error('catalog mirror unreadable');
    rows = res.results ?? [];
  } catch (e) {
    if (!/no such table: stripe_products\b/.test(String((e as Error)?.message ?? e))) throw e;
  }
  const plans: Record<string, unknown>[] = [];
  for (const [family, key] of [['founder', 'founder:free'], ['investor', 'investor:free'], ['other', 'other']] as const)
    plans.push({ family, licence_key: key, product_id: null, plan_name: null, free: true, prices: [], allowance: none });
  for (const row of rows) {
    let metadata: Record<string, string>, prices: any[];
    try { metadata = JSON.parse(row.metadata_json); prices = JSON.parse(row.prices_json); } catch { continue; }
    const plan = metadata && typeof metadata === 'object' ? planOf(metadata) : null;
    if (!plan || !Array.isArray(prices)) continue;
    const priced = prices.filter((p) => p && p.active === true && Number.isSafeInteger(p.unit_amount)).map((p) => ({
      price_id: p.id, unit_amount: p.unit_amount, currency: p.currency, interval: p.interval ?? null, interval_count: p.interval_count ?? null,
      allowance_microusd: p.currency == null || String(p.currency).toLowerCase() === 'usd' ? allowanceFromCharge(p.unit_amount, p.interval, p.interval_count) : 0 }));
    const top = headline(priced);
    plans.push({ family: plan.family, licence_key: plan.licence_key, product_id: row.id, plan_name: row.name, free: false,
      prices: priced, allowance: top ? { share: PLAN_AI_SHARE, monthly_microusd: top.allowance_microusd, source: 'plan' } : null });
  }
  return { plans, packs: (await packsOnSale(env)).packs, covers: PLAN_COVERS, resets: PLAN_RESETS };
}
