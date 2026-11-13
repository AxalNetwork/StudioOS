/**
 * D4357 (#4357) — the Incorporate quote, line by line, before the founder commits.
 *
 * Each line says what it is, its amount or null, where the amount comes from
 * and the day that source was last checked. Nothing here invents a figure:
 *   - **State filing fee:** `STATE_FILING_FEES`, a reviewed table, one entry a
 *     jurisdiction, each naming the official schedule it is to be read from.
 *     An entry carries an amount only once someone has read that schedule and
 *     written the day they did; until then it is null and reads "Not recorded".
 *     It is paid to the state at filing, not charged by Axal VC's order.
 *   - **Axal's service fee:** the incorporation SKU in the Stripe catalog, the
 *     very price `POST /incorporation/order` charges (`resolveIncorporationPrice`),
 *     checked when the catalog mirror last synced that product.
 *   - **Registered agent:** the catalog's registered-agent subscription,
 *     optional, a year at a time, added after you pay.
 *   - **Optional add-ons:** any other active catalog product tagged
 *     `metadata.category = 'incorporation_addon'` (none are configured today).
 *
 * The total is the sum of the known lines that make up the filing (the state
 * fee and the service fee) in the quote's currency. It says it is incomplete
 * whenever one of them is unknown, and leaves the optional lines out.
 */
import type { Env } from '../types';
import { getCatalog, type CatalogProduct } from './catalog';

export interface StateFee {
  /** Null until read from `source_url` and dated in `checked_on`. */
  amount_cents: number | null;
  currency: string;
  source: string;
  source_url: string;
  /** YYYY-MM-DD the schedule was last read; null when it never has been. */
  checked_on: string | null;
}

/**
 * The state's own filing fee, per jurisdiction id (`routes/legal.ts`
 * `JURISDICTIONS`). Every amount is null until someone reads the named
 * schedule: a figure here must come with the day it was read.
 */
export const STATE_FILING_FEES: Readonly<Record<string, StateFee>> = Object.freeze({
  us_de_ccorp: { amount_cents: null, currency: 'usd', source: 'Delaware Division of Corporations, fee schedule', source_url: 'https://corp.delaware.gov/fee/', checked_on: null },
  us_wy_ccorp: { amount_cents: null, currency: 'usd', source: 'Wyoming Secretary of State, business fees', source_url: 'https://sos.wyo.gov/Business/Docs/BusinessFees.pdf', checked_on: null },
  us_de_llc: { amount_cents: null, currency: 'usd', source: 'Delaware Division of Corporations, fee schedule', source_url: 'https://corp.delaware.gov/fee/', checked_on: null },
  uk_ltd: { amount_cents: null, currency: 'gbp', source: 'Companies House, fees', source_url: 'https://www.gov.uk/government/publications/companies-house-fees', checked_on: null },
  sg_pte: { amount_cents: null, currency: 'sgd', source: 'ACRA, fees for company incorporation', source_url: 'https://www.acra.gov.sg/', checked_on: null },
  ee_oy: { amount_cents: null, currency: 'eur', source: 'Estonian e-Business Register, state fees', source_url: 'https://www.rik.ee/en/e-business-register', checked_on: null },
});

export type LineKey = 'state_filing_fee' | 'service_fee' | 'registered_agent' | `add_on:${string}`;

export interface QuoteLine {
  key: LineKey;
  label: string;
  amount_cents: number | null;
  currency: string | null;
  /** 'year' for a subscription; null for a one-time fee. */
  interval: string | null;
  optional: boolean;
  /** When it is paid: to the state at filing, on Axal VC's order, or after you pay. */
  paid: 'at_filing' | 'with_order' | 'after_you_pay';
  source: string;
  source_url: string | null;
  checked_on: string | null;
}

export interface QuoteTotal {
  /** The sum of the known lines in the total; null when none is known. */
  amount_cents: number | null;
  currency: string;
  /** True only when every line in the total is known, in the quote's currency. */
  complete: boolean;
  /** The labels of the lines in the total that are not known. */
  unknown: string[];
}

export interface CatalogLine { amount_cents: number | null; currency: string | null; interval?: string | null; name?: string; synced_at?: string | null }

/** A catalog sync time as a day, or null. */
const dayOf = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
};

/** A real, positive amount in cents, else null: an unknown fee is never 0. */
const amountOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

const CATALOG = 'Stripe catalog (Axal VC)';

/** The quote's lines and total, pure. */
export function quoteOf(input: {
  jurisdictionId: string;
  service: CatalogLine | null;
  agent: CatalogLine | null;
  addOns?: (CatalogLine & { id: string })[];
  /** The reviewed table; a test may pass its own. */
  stateFees?: Readonly<Record<string, StateFee>>;
}): { lines: QuoteLine[]; total: QuoteTotal } {
  const fee = (input.stateFees ?? STATE_FILING_FEES)[input.jurisdictionId] ?? null;
  const stateLine: QuoteLine = {
    key: 'state_filing_fee', label: 'State filing fee',
    amount_cents: fee && fee.checked_on ? amountOf(fee.amount_cents) : null,
    currency: fee?.currency ?? null, interval: null, optional: false, paid: 'at_filing',
    source: fee?.source ?? 'Not recorded', source_url: fee?.source_url ?? null, checked_on: fee?.checked_on ?? null,
  };
  const s = input.service;
  const serviceLine: QuoteLine = {
    key: 'service_fee', label: 'Axal VC service fee',
    amount_cents: amountOf(s?.amount_cents), currency: s?.currency ? String(s.currency).toLowerCase() : null,
    interval: null, optional: false, paid: 'with_order',
    source: CATALOG, source_url: null, checked_on: dayOf(s?.synced_at),
  };
  const a = input.agent;
  const agentLine: QuoteLine = {
    key: 'registered_agent', label: a?.name?.trim() || 'Registered agent',
    amount_cents: amountOf(a?.amount_cents), currency: a?.currency ? String(a.currency).toLowerCase() : null,
    interval: a ? (a.interval || 'year') : 'year', optional: true, paid: 'after_you_pay',
    source: a ? CATALOG : 'Not recorded', source_url: null, checked_on: dayOf(a?.synced_at),
  };
  const addOnLines: QuoteLine[] = (input.addOns || []).map((x) => ({
    key: `add_on:${x.id}` as LineKey, label: x.name?.trim() || 'Add-on',
    amount_cents: amountOf(x.amount_cents), currency: x.currency ? String(x.currency).toLowerCase() : null,
    interval: x.interval ?? null, optional: true, paid: 'after_you_pay',
    source: CATALOG, source_url: null, checked_on: dayOf(x.synced_at),
  }));

  const lines = [stateLine, serviceLine, agentLine, ...addOnLines];
  const inTotal = lines.filter((l) => !l.optional);
  const currency = serviceLine.currency || stateLine.currency || 'usd';
  const known = inTotal.filter((l) => l.amount_cents != null && l.currency === currency);
  const unknown = inTotal.filter((l) => !known.includes(l)).map((l) => l.label);
  return {
    lines,
    total: {
      amount_cents: known.length ? known.reduce((n, l) => n + (l.amount_cents as number), 0) : null,
      currency,
      complete: unknown.length === 0,
      unknown,
    },
  };
}

/** The catalog product holding this price id, for its sync time; null when not mirrored. */
export function productOfPrice(products: CatalogProduct[], priceId: string | null | undefined): CatalogProduct | null {
  if (!priceId) return null;
  return products.find((p) => p.prices.some((pr) => pr.id === priceId)) ?? null;
}

/** The optional add-ons the catalog offers with a filing. */
export function addOnsOf(products: CatalogProduct[]): (CatalogLine & { id: string })[] {
  return products
    .filter((p) => p.active && p.metadata?.category === 'incorporation_addon')
    .map((p) => {
      const price = p.prices.find((pr) => pr.active) ?? null;
      return { id: p.id, name: p.name, amount_cents: price?.unit_amount ?? null, currency: price?.currency ?? null, interval: price?.interval ?? null, synced_at: p.synced_at };
    });
}

/** The catalog, or none when it cannot be read: the lines then read Not recorded. */
export async function catalogOrNone(env: Env): Promise<CatalogProduct[]> {
  try { return await getCatalog(env); } catch { return []; }
}
