/**
 * D1010 (#2829) — Payments part 2: what the catalogue read says about each
 * product and price, members per plan, and one change-a-price write.
 *
 * Everything here reads the D1 mirror (`stripe_products`), never Stripe,
 * except `changePrice`, which writes to Stripe through the catalogue's own
 * helpers. Money stays in the currency's smallest unit; amounts in different
 * currencies are never added. No key is returned: modes only.
 *
 *   catalogChecks   the catalogue's problems, each a sentence an admin can act
 *                   on: two products making one plan, a plan with no yearly
 *                   price, a subscription that makes no card, a price charged
 *                   every N intervals, a non-USD plan price, a weekly or daily
 *                   plan price, and the publishable key's mode against the
 *                   account's;
 *   showsOn         where a product reaches members, from `planOf`, the kind,
 *                   the audience and the token-pack store;
 *   priceAllowance  the AI allowance a plan price gives each month (D783: 25%
 *                   of a USD monthly price, a yearly one's ÷ 12, none in
 *                   another currency), with the reason when it gives none;
 *   membersPerPlan  live members per price and per family and interval, from
 *                   `member_subscription_amounts`; a row recorded before
 *                   migration 572 has no price and is counted apart;
 *   changePrice     add the new price, then archive the old; if the archive
 *                   fails the new price is archived again, so no half-done
 *                   change is left behind silently.
 */
import type { Env } from '../types';
import type { CatalogPrice, CatalogProduct, StripeMode } from './catalog';
import { archivePrice, createPrice } from './catalog';
import { intervalPrices, planOf } from './aiCredits';
import { allowanceFromCharge } from './planAllowance';

export type CheckSeverity = 'blocker' | 'warning';
export interface CatalogCheck {
  code: string;
  severity: CheckSeverity;
  product_id: string | null;
  price_id: string | null;
  message: string;
}

const FAMILY_WORD: Record<string, string> = {
  founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'partner', market_intelligence: 'Market Intelligence',
};

/** The plan a product makes, keyed so two products making the same one collide; null when it makes none. */
export function planKey(product: Pick<CatalogProduct, 'kind' | 'metadata'>): { key: string; family: string; label: string } | null {
  if (product.kind !== 'subscription') return null;
  const plan = planOf(product.metadata || {});
  if (!plan) return null;
  const key = plan.licence_key ?? plan.family;
  const tier = key.includes(':') ? key.split(':')[1] : null;
  const label = tier ? `${FAMILY_WORD[plan.family] ?? plan.family} ${tier}` : FAMILY_WORD[plan.family] ?? plan.family;
  return { key, family: plan.family, label };
}

const isCountOne = (p: CatalogPrice) => (p.interval_count ?? 1) === 1;
const isUsd = (p: CatalogPrice) => p.currency == null || String(p.currency).toLowerCase() === 'usd';
const priceName = (p: CatalogPrice) => (p.nickname ? `“${p.nickname}” (${p.id})` : p.id);

/**
 * The catalogue's checks. Only active products and active prices are judged:
 * an archived one reaches no member. `accountMode` is the secret key's mode
 * (`stripeMode`), `publishableMode` the publishable key's (`publishableKeyMode`).
 */
export function catalogChecks(
  products: CatalogProduct[],
  keys: { accountMode: StripeMode; publishableMode: 'live' | 'test' | 'unknown' | null },
): CatalogCheck[] {
  const out: CatalogCheck[] = [];
  const active = products.filter((p) => p.active);

  // Two active products making one plan: checkout sells whichever it finds first.
  const byPlan = new Map<string, { label: string; products: CatalogProduct[] }>();
  for (const p of active) {
    const k = planKey(p);
    if (!k) continue;
    const g = byPlan.get(k.key) ?? { label: k.label, products: [] };
    g.products.push(p);
    byPlan.set(k.key, g);
  }
  for (const g of byPlan.values()) {
    if (g.products.length < 2) continue;
    out.push({
      code: 'plan_clash', severity: 'blocker', product_id: g.products[0].id, price_id: null,
      message: `${g.products.map((p) => `“${p.name}”`).join(' and ')} all make the ${g.label} plan. Checkout and /pricing take whichever they read first, so archive all but one.`,
    });
  }

  for (const p of active) {
    if (p.kind === 'subscription' && !planKey(p)) {
      out.push({
        code: 'subscription_no_card', severity: 'warning', product_id: p.id, price_id: null,
        message: `“${p.name}” is a subscription that makes no card: its metadata names no plan, so /pricing never shows it and no plan checkout sells it.`,
      });
      continue;
    }
    const k = planKey(p);
    if (!k) continue;
    const prices = p.prices.filter((x) => x.active && x.type === 'recurring');
    if (!prices.some((x) => x.interval === 'year' && isCountOne(x))) {
      out.push({
        code: 'plan_no_yearly', severity: 'warning', product_id: p.id, price_id: null,
        message: `“${p.name}” has no yearly price, so /pricing offers it monthly only and a yearly checkout for it is refused.`,
      });
    }
    for (const x of prices) {
      if (x.interval === 'week' || x.interval === 'day') {
        out.push({
          code: 'plan_price_short_interval', severity: 'blocker', product_id: p.id, price_id: x.id,
          message: `“${p.name}” has a price charged every ${x.interval} (${priceName(x)}). A plan is charged monthly or yearly: it gives no AI allowance and /pricing ignores it. Archive it.`,
        });
      } else if (!isCountOne(x)) {
        out.push({
          code: 'price_interval_count', severity: 'blocker', product_id: p.id, price_id: x.id,
          message: `“${p.name}” has a price charged every ${x.interval_count} ${x.interval}s (${priceName(x)}). Checkout picks a plan's price by its interval alone, so it could sell this one; /pricing ignores it. Archive it.`,
        });
      }
      if (!isUsd(x)) {
        out.push({
          code: 'plan_price_not_usd', severity: 'warning', product_id: p.id, price_id: x.id,
          message: `“${p.name}” has a price in ${String(x.currency).toUpperCase()} (${priceName(x)}). A plan's AI allowance is counted in USD only, so it gives none, and it is never added to a USD figure.`,
        });
      }
    }
  }

  // The publishable key's mode against the account's (the secret key's).
  if (keys.accountMode === 'unconfigured') {
    out.push({ code: 'secret_key_missing', severity: 'blocker', product_id: null, price_id: null,
      message: 'No Stripe secret key is set, so no checkout can open and the catalogue cannot be synced.' });
  } else if (keys.publishableMode === null) {
    out.push({ code: 'publishable_key_missing', severity: 'blocker', product_id: null, price_id: null,
      message: 'No publishable key is set, so the card form cannot load. Set it under Stripe keys.' });
  } else if (keys.publishableMode === 'unknown') {
    out.push({ code: 'publishable_key_unknown', severity: 'blocker', product_id: null, price_id: null,
      message: 'The publishable key starts with neither pk_live_ nor pk_test_, so its mode cannot be checked against the account’s.' });
  } else if (keys.publishableMode !== keys.accountMode) {
    out.push({ code: 'key_mode_mismatch', severity: 'blocker', product_id: null, price_id: null,
      message: `The publishable key is a ${keys.publishableMode} key but the account key is ${keys.accountMode}. Card forms and checkouts would talk to different Stripe accounts.` });
  }
  return out;
}

export interface ShowsOn { key: 'pricing' | 'bundles' | 'addons' | 'incorporate' | 'packs'; path: string; detail: string | null }

/**
 * Where an active product reaches members, read off the same rules the pages
 * use: a plan is a /pricing card and a Profile bundle on /pricing/products; a
 * token pack (by `ai_token_packs`) is sold on /pricing and Usage, never as an
 * add-on; every other product is an add-on on /pricing/products under its
 * audiences; incorporation and à la carte products are also on /incorporate.
 * An archived product shows nowhere.
 */
export function showsOn(product: CatalogProduct, packProducts: ReadonlySet<string>): ShowsOn[] {
  if (!product.active) return [];
  if (packProducts.has(product.id) || product.kind === 'token_pack') {
    return [{ key: 'packs', path: '/pricing', detail: 'token packs, while the pack is on sale (HQ › AI allowances › Token packs)' }];
  }
  const out: ShowsOn[] = [];
  const k = planKey(product);
  if (k) {
    const hasCard = product.prices.some((x) => x.active && x.type === 'recurring' && isCountOne(x) && (x.interval === 'month' || x.interval === 'year'));
    if (hasCard) out.push({ key: 'pricing', path: '/pricing', detail: `the ${k.label} plan card` });
    out.push({ key: 'bundles', path: '/pricing/products', detail: 'Profile bundles' });
    return out;
  }
  const audiences = Array.isArray(product.categories) ? product.categories : [];
  out.push({ key: 'addons', path: '/pricing/products', detail: audiences.length ? `Add-ons & services: ${audiences.join(', ')}` : 'Add-ons & services, under All only' });
  if (product.kind === 'incorporation' && product.metadata?.jurisdiction_id) out.push({ key: 'incorporate', path: '/incorporate', detail: `the ${product.metadata.jurisdiction_id} filing` });
  if (product.kind === 'alacarte') out.push({ key: 'incorporate', path: '/incorporate', detail: 'add-ons at incorporation' });
  return out;
}

export type AllowanceReason = 'not_a_plan' | 'not_usd' | 'not_monthly_or_yearly' | 'archived' | null;

/** The monthly AI allowance a price gives, in micro-USD, and why it gives none (D783). */
export function priceAllowance(product: CatalogProduct, price: CatalogPrice): { microusd: number; reason: AllowanceReason } {
  if (!planKey(product)) return { microusd: 0, reason: 'not_a_plan' };
  if (!price.active) return { microusd: 0, reason: 'archived' };
  if (!isUsd(price)) return { microusd: 0, reason: 'not_usd' };
  if (price.type !== 'recurring' || (price.interval !== 'month' && price.interval !== 'year')) return { microusd: 0, reason: 'not_monthly_or_yearly' };
  return { microusd: allowanceFromCharge(price.unit_amount, price.interval, price.interval_count ?? 1), reason: null };
}

/** The catalogue as the Payments page reads it: each product's plan, shows-on and yearly saving; each price's allowance. */
export function annotateCatalog(products: CatalogProduct[], packProducts: ReadonlySet<string>) {
  return products.map((p) => {
    const k = planKey(p);
    const prices = p.prices.map((x) => {
      const a = priceAllowance(p, x);
      return { ...x, allowance_microusd: a.microusd, allowance_reason: a.reason };
    });
    const priced = prices.filter((x) => x.active && Number.isSafeInteger(x.unit_amount))
      .map((x) => ({ unit_amount: x.unit_amount as number, currency: x.currency, interval: x.interval, interval_count: x.interval_count, allowance_microusd: x.allowance_microusd }));
    return {
      ...p,
      prices,
      plan: k ? { key: k.key, family: k.family, label: k.label, yearly_saving_percent: intervalPrices(priced).yearly_saving_percent } : null,
      shows_on: showsOn(p, packProducts),
    };
  });
}

/** Product ids that sell token packs (`ai_token_packs`); an empty set when that store is not there yet. */
export async function packProductIds(env: Env): Promise<Set<string>> {
  try {
    const r = await env.DB.prepare('SELECT DISTINCT product_id FROM ai_token_packs WHERE product_id IS NOT NULL').all<{ product_id: string }>();
    return new Set((r.results ?? []).map((x) => String(x.product_id)));
  } catch (e) {
    if (/no such table: ai_token_packs\b/.test(String((e as Error)?.message ?? e))) return new Set();
    throw e;
  }
}

/**
 * Live members per price and per family and interval, from the charges the
 * subscription webhook recorded. `active` is Stripe's paid status; `other`
 * counts the other live statuses (trialing, past_due, unpaid, incomplete);
 * canceled rows are not members. A row with no price (written before
 * migration 572) is counted under its family as `without_price`, never as any
 * one price. A missing table is a failure, not an empty store.
 */
export async function membersPerPlan(env: Env, products: CatalogProduct[]) {
  const rows = (await env.DB.prepare(
    `SELECT plan_family, interval, interval_count, price_id, status, COUNT(*) AS n
       FROM member_subscription_amounts
      WHERE status <> 'canceled'
      GROUP BY plan_family, interval, interval_count, price_id, status`,
  ).all<{ plan_family: string; interval: string; interval_count: number; price_id: string | null; status: string; n: number }>()).results ?? [];
  const priceOwner = new Map<string, CatalogProduct>();
  for (const p of products) for (const x of p.prices) priceOwner.set(x.id, p);

  const byPrice = new Map<string, { price_id: string; product_id: string | null; active: number; other: number }>();
  const byPlan = new Map<string, { family: string; interval: string; interval_count: number; active: number; other: number; without_price: number }>();
  for (const r of rows) {
    const n = Number(r.n) || 0;
    const paid = r.status === 'active';
    const planK = `${r.plan_family}|${r.interval}|${r.interval_count}`;
    const plan = byPlan.get(planK) ?? { family: r.plan_family, interval: r.interval, interval_count: Number(r.interval_count), active: 0, other: 0, without_price: 0 };
    if (paid) plan.active += n; else plan.other += n;
    if (!r.price_id) plan.without_price += n;
    byPlan.set(planK, plan);
    if (r.price_id) {
      const pr = byPrice.get(r.price_id) ?? { price_id: r.price_id, product_id: priceOwner.get(r.price_id)?.id ?? null, active: 0, other: 0 };
      if (paid) pr.active += n; else pr.other += n;
      byPrice.set(r.price_id, pr);
    }
  }
  return {
    by_price: [...byPrice.values()].sort((a, b) => a.price_id.localeCompare(b.price_id)),
    by_plan: [...byPlan.values()].sort((a, b) => a.family.localeCompare(b.family) || a.interval.localeCompare(b.interval) || a.interval_count - b.interval_count),
    without_price_total: [...byPlan.values()].reduce((t, p) => t + p.without_price, 0),
  };
}

export type ChangePriceResult =
  | { ok: true; price: CatalogPrice }
  | { ok: false; stage: 'create' }
  | { ok: false; stage: 'archive'; rolled_back: true; new_price_id: string }
  | { ok: false; stage: 'archive'; rolled_back: false; new_price_id: string };

/**
 * Change a price: create the new one on the same product, with the old one's
 * currency, interval and count, then archive the old. Stripe prices cannot be
 * edited, so this is the only change there is. The create carries an
 * idempotency key, so a retried press makes one price, not two. If the
 * archive fails, the new price is archived again so the old one stays the only
 * live price; when that also fails, the caller says both prices are live.
 */
export async function changePrice(env: Env, product: CatalogProduct, old: CatalogPrice,
  next: { unit_amount: number; nickname?: string | null }, idempotencyKey: string): Promise<ChangePriceResult> {
  let created: CatalogPrice;
  try {
    created = await createPrice(env, product.id, {
      currency: old.currency,
      unit_amount: next.unit_amount,
      type: old.type === 'one_time' ? 'one_time' : 'recurring',
      ...(old.type === 'one_time' ? {} : { interval: old.interval as 'month' | 'year' | 'week' | 'day', interval_count: old.interval_count ?? 1 }),
      ...(next.nickname ? { nickname: next.nickname } : old.nickname ? { nickname: old.nickname } : {}),
    }, { idempotencyKey: `price-change-${idempotencyKey}` });
  } catch {
    return { ok: false, stage: 'create' };
  }
  try {
    await archivePrice(env, old.id);
    return { ok: true, price: created };
  } catch {
    try {
      await archivePrice(env, created.id);
      return { ok: false, stage: 'archive', rolled_back: true, new_price_id: created.id };
    } catch {
      return { ok: false, stage: 'archive', rolled_back: false, new_price_id: created.id };
    }
  }
}
