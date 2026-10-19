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
import { AI_USD_SCALE } from './aiBudget';
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
  | { origin: 'created' | 'adopted'; packUid: string; priceId: string; productId: string; faceCents: number; bonusMicrousd: number; onSale: boolean }
  | { origin: 'environment'; packUid: null; priceId: string; productId: null; faceCents: null; bonusMicrousd: 0; onSale: true };

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
      faceCents: row.face_cents, bonusMicrousd: row.bonus_microusd, onSale: row.on_sale === 1 };
  }
  if (fallbackPriceId(env) === priceId)
    return { origin: 'environment', packUid: null, priceId, productId: null, faceCents: null, bonusMicrousd: 0, onSale: true };
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

export type TokenPackRefusal = 'token_pack_alone' | 'promo_not_for_token_packs' | 'token_pack_not_on_sale'
  | 'token_pack_daily_limit' | 'token_balance_ceiling' | 'token_packs_on_hold';
export type TokenPackQuote = { priceId: string; packUid: string | null; creditMicrousd: number; bonusMicrousd: number };

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
  const creditMicrousd = face * (AI_USD_SCALE / 100);
  const bonusMicrousd = pack.bonusMicrousd;
  const exclude = opts.excludeOrderRef ?? '';
  const window = `-${TOKEN_PACK_LIMITS.orderWindowHours} hours`;
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN credited_at IS NULL THEN credit_microusd+bonus_microusd ELSE 0 END),0) AS pending
    FROM ai_topup_purchases WHERE user_id = ? AND order_ref <> ? AND created_at > datetime('now', ?)`)
    .bind(userId, exclude, window).first<any>();
  if (!recent || !Number.isSafeInteger(recent.n) || !Number.isSafeInteger(recent.pending)) throw new Error('AI top-up purchases unreadable');
  if (recent.n >= TOKEN_PACK_LIMITS.ordersPerDay) return { error: 'token_pack_daily_limit' };
  const account = await env.DB.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id = ?').bind(userId).first<any>();
  const balance = account ? account.balance_microusd : 0;
  if (!Number.isSafeInteger(balance)) throw new Error('AI top-up balance unreadable');
  if (balance + recent.pending + creditMicrousd + bonusMicrousd > TOKEN_PACK_LIMITS.balanceCeilingMicrousd) return { error: 'token_balance_ceiling' };
  const hold = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM ai_topup_purchases WHERE user_id = ? AND dispute_state = 'open') AS disputed,
      EXISTS(SELECT 1 FROM ai_credit_ledger WHERE user_id = ? AND shortfall_microusd > 0 AND created_at > datetime('now', ?)) AS short`)
    .bind(userId, userId, `-${TOKEN_PACK_LIMITS.shortfallHoldDays} days`).first<any>();
  if (!hold) throw new Error('AI top-up holds unreadable');
  if (hold.disputed || hold.short) return { error: 'token_packs_on_hold' };
  return { priceId: line.price_id, packUid: pack.packUid, creditMicrousd, bonusMicrousd };
}
