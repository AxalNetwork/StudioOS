/** D1433 (#3703): one readiness rule, before any checkout provider request. */
import type { Env } from '../types';
import { getPublishableKey, publishableKeyMode, stripeMode, type CatalogProduct, type StripeMode } from './catalog';
import type { CatalogueEntry } from './planCatalogue';
import { priceForEntry, type CheckoutInterval } from './planCheckout';

export type StripeNotReadyReason = 'secret_key_missing' | 'publishable_key_missing' | 'publishable_key_unknown'
  | 'key_mode_mismatch' | 'webhook_secret_missing' | 'price_missing';
export type StripeReadiness = { state: 'ready' } | { state: 'not_ready'; reason: StripeNotReadyReason };
export const CHECKOUT_NOT_READY_MESSAGE = "This plan can't be bought just now. Nothing was charged.";

export interface StripeKeyModes {
  accountMode: StripeMode;
  publishableMode: 'test' | 'live' | 'unknown' | null;
  webhookConfigured: boolean;
}

/** Pure projection reused by HQ; no key or signing secret leaves this rule. */
export function readinessForKeyModes(keys: StripeKeyModes): StripeReadiness {
  if (keys.accountMode === 'unconfigured') return { state: 'not_ready', reason: 'secret_key_missing' };
  if (keys.publishableMode === null) return { state: 'not_ready', reason: 'publishable_key_missing' };
  if (keys.publishableMode === 'unknown') return { state: 'not_ready', reason: 'publishable_key_unknown' };
  if (keys.accountMode !== keys.publishableMode) return { state: 'not_ready', reason: 'key_mode_mismatch' };
  if (!keys.webhookConfigured) return { state: 'not_ready', reason: 'webhook_secret_missing' };
  return { state: 'ready' };
}

export async function keyReadiness(env: Env): Promise<StripeReadiness> {
  return readinessForKeyModes({ accountMode: stripeMode(env), publishableMode: publishableKeyMode(await getPublishableKey(env)),
    webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET });
}

export async function planReadiness(env: Env, products: readonly CatalogProduct[], entry: CatalogueEntry,
  interval: CheckoutInterval): Promise<StripeReadiness> {
  const keys = await keyReadiness(env);
  if (keys.state === 'not_ready') return keys;
  return planPriceReady(products, entry, interval, stripeMode(env))
    ? { state: 'ready' } : { state: 'not_ready', reason: 'price_missing' };
}

/** Read-only selectors and HQ reuse the same interval and mode rule. */
export function planPriceReady(products: readonly CatalogProduct[], entry: CatalogueEntry,
  interval: CheckoutInterval, mode: StripeMode): boolean {
  if (mode === 'unconfigured' || !entry.sellable) return false;
  return !!priceForEntry(products.filter(product => product.livemode === (mode === 'live')), entry, interval);
}
