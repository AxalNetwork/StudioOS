/**
 * D4357 (#4357), extended by D6707 (#6707) — the Incorporate quote, line by
 * line, before the founder commits: who is paid each line, who collects it,
 * when, in which currency, and whether the charge equals the lines Axal VC
 * collects.
 *
 * Each line says what it is, its amount or null, where the amount comes from
 * and the day that source was last checked. Nothing here invents a figure:
 *   - **Government fees** (D6707): the form's fee lines in the formation
 *     catalogue (`formation_fee_lines`, D6689), with the label the catalogue
 *     (or the jurisdiction's `vocabulary.fee_labels`) gives them. An amount
 *     shows only with its source and checked day; until then it is null and
 *     reads "Not recorded". When the catalogue cannot answer, the reviewed
 *     `STATE_FILING_FEES` table below stands in (logged, as D6691's readers).
 *   - **Axal's service fee:** the incorporation SKU in the Stripe catalog, the
 *     very price `POST /incorporation/order` charges (`resolveIncorporationPrice`),
 *     checked when the catalog mirror last synced that product. When the
 *     catalogue holds a sourced Axal line keyed `service_fee`, that is Axal's
 *     fee and the Stripe price is the charge it must add up to.
 *   - **The partner** (D6707): the `founder_price_minor` of each service the
 *     case's assigned partner (or, before assignment, the default partner of
 *     D6693) covers for the form. `cost_minor` is never read here.
 *   - **Registered agent** and **optional add-ons:** from the catalog, as before.
 *
 * TOTALS. `total` is D4357's: the known lines in the total, in the quote's
 * currency. `totals` has one entry per currency; lines in another currency are
 * never summed (no FX). The total holds the lines paid at order or at filing
 * that are not optional; yearly and monthly lines are listed apart.
 *
 * THE CHARGE (D6707). `charge` is the sum of the lines Axal VC collects with
 * the order (`collected_by = axal`, `timing = at_order`, not optional). The
 * order routes refuse with `quote_charge_mismatch`, before any write, unless
 * it equals the Stripe price they charge (`chargeRefusal`). A partner line
 * collected by Axal is refused for a form whose `allow_axal_collection` is 0
 * (`collectionRefusal`). No money moves to a partner or a registry here.
 */
import type { Env } from '../types';
import { getCatalog, type CatalogProduct } from './catalog';
import { catalogueForm, type FeeLine } from './formationCatalogue';
import { FALLBACK_EVENT, readerVersion } from './formationCatalogueReaders';

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
 * schedule: a figure here must come with the day it was read. Since D6707 the
 * catalogue's fee lines are read first; this is the fallback.
 */
export const STATE_FILING_FEES: Readonly<Record<string, StateFee>> = Object.freeze({
  us_de_ccorp: { amount_cents: null, currency: 'usd', source: 'Delaware Division of Corporations, fee schedule', source_url: 'https://corp.delaware.gov/fee/', checked_on: null },
  us_wy_ccorp: { amount_cents: null, currency: 'usd', source: 'Wyoming Secretary of State, business fees', source_url: 'https://sos.wyo.gov/Business/Docs/BusinessFees.pdf', checked_on: null },
  us_de_llc: { amount_cents: null, currency: 'usd', source: 'Delaware Division of Corporations, fee schedule', source_url: 'https://corp.delaware.gov/fee/', checked_on: null },
  uk_ltd: { amount_cents: null, currency: 'gbp', source: 'Companies House, fees', source_url: 'https://www.gov.uk/government/publications/companies-house-fees', checked_on: null },
  sg_pte: { amount_cents: null, currency: 'sgd', source: 'ACRA, fees for company incorporation', source_url: 'https://www.acra.gov.sg/', checked_on: null },
  ee_oy: { amount_cents: null, currency: 'eur', source: 'Estonian e-Business Register, state fees', source_url: 'https://www.rik.ee/en/e-business-register', checked_on: null },
});

export type LineKey = string;
/** Who is paid the line. */
export type Payee = 'axal' | 'partner' | 'government';
/** Who takes the founder's money for it: Axal VC, the partner, or the founder pays the registry itself. */
export type CollectedBy = 'axal' | 'partner' | 'government';
/** When it is paid: with Axal's order, at filing, or each year or month. */
export type Timing = 'at_order' | 'at_filing' | 'yearly' | 'monthly';

export interface QuoteLine {
  key: LineKey;
  label: string;
  amount_cents: number | null;
  currency: string | null;
  /** 'year' for a subscription; null for a one-time fee. */
  interval: string | null;
  optional: boolean;
  /** D4357: when it is paid: to the state at filing, on Axal VC's order, or after you pay. */
  paid: 'at_filing' | 'with_order' | 'after_you_pay';
  source: string;
  source_url: string | null;
  checked_on: string | null;
  /** D6707. */
  payee: Payee;
  /** The authority or firm paid, when one is named. */
  payee_name: string | null;
  collected_by: CollectedBy;
  timing: Timing;
  /** The partner firm that bills the founder for this line ("billed by [Partner]"), when the partner collects it. */
  billed_by: string | null;
}

export interface QuoteTotal {
  /** The sum of the known lines in the total; null when none is known. */
  amount_cents: number | null;
  currency: string;
  /** True only when every line in the total is known, in this currency. */
  complete: boolean;
  /** The labels of the lines in the total that are not known. */
  unknown: string[];
}

/** D6707: the lines Axal VC collects with the order, and their sum in the charge currency. */
export interface QuoteCharge {
  currency: string;
  /** Null when any such line is unknown or in another currency. */
  amount_cents: number | null;
  lines: string[];
}

export interface Quote { lines: QuoteLine[]; total: QuoteTotal; totals: QuoteTotal[]; charge: QuoteCharge }

export interface CatalogLine { amount_cents: number | null; currency: string | null; interval?: string | null; name?: string; synced_at?: string | null }

/** One service the partner covers for the form, at its current founder price. Never its cost. */
export interface PartnerPrice { service: string; founder_price_minor: number; currency: string; cadence: string }
export interface QuotePartner { formation_partner_id: number; name: string; assigned: boolean; prices: PartnerPrice[] }

/** A catalog sync time as a day, or null. */
const dayOf = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
};

/** A real, positive amount in cents, else null: an unknown fee is never 0. */
const amountOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const lower = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);

const CATALOG = 'Stripe catalog (Axal VC)';
const PARTNER_SOURCE = 'Partner price list (Axal VC partner registry)';

/** The partner services of D6692's coverage, as a line reads them. */
export const PARTNER_SERVICE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  formation: 'Formation service', registered_agent: 'Registered agent', registered_office: 'Registered office',
  company_secretary: 'Company secretary', resident_director: 'Resident director', contact_person: 'Contact person',
  identity_verification: 'Identity verification', structure_memo: 'Structure memo', tax_registration: 'Tax registration',
  bank_introduction: 'Bank introduction',
});

/**
 * Who is paid a catalogue fee line. The catalogue's `payee` is a name: "Axal"
 * (or "Axal VC") is Axal, "partner" is the case's partner firm, and any other
 * name is the authority it names.
 */
export function payeeOf(payee: string): Payee {
  const p = String(payee || '').trim().toLowerCase();
  if (p === 'axal' || p.startsWith('axal ')) return 'axal';
  if (p === 'partner') return 'partner';
  return 'government';
}

/** Who collects it: the catalogue's `axal` is Axal, `provider` the partner, `payee` whoever is paid. */
export function collectedByOf(collected: string, payee: Payee): CollectedBy {
  if (collected === 'axal') return 'axal';
  if (collected === 'provider') return 'partner';
  return payee;
}

/** When: a yearly or monthly line by its recurrence; otherwise with the order when Axal collects it, else at filing. */
export function timingOf(recurrence: string | null, collected: CollectedBy): Timing {
  if (recurrence === 'annual' || recurrence === 'year') return 'yearly';
  if (recurrence === 'monthly' || recurrence === 'month') return 'monthly';
  return collected === 'axal' ? 'at_order' : 'at_filing';
}

const paidOf = (t: Timing, collected: CollectedBy): QuoteLine['paid'] =>
  (t === 'yearly' || t === 'monthly' ? 'after_you_pay' : collected === 'axal' ? 'with_order' : 'at_filing');
const intervalOf = (t: Timing): string | null => (t === 'yearly' ? 'year' : t === 'monthly' ? 'month' : null);

/** A line is in the total when it is not optional and paid once, at order or at filing. */
const inTotal = (l: QuoteLine) => !l.optional && (l.timing === 'at_order' || l.timing === 'at_filing');
/** A line is in Axal's charge when it is in the order, Axal collects it, and it is paid with the order. */
export const inCharge = (l: QuoteLine) => !l.optional && l.collected_by === 'axal' && l.timing === 'at_order';

/** D4357's total: every line in the total, a line in another currency counted as not known. */
function quoteTotal(lines: QuoteLine[], currency: string): QuoteTotal {
  const known = lines.filter((l) => l.amount_cents != null && l.currency === currency);
  return {
    amount_cents: known.length ? known.reduce((n, l) => n + (l.amount_cents as number), 0) : null,
    currency,
    complete: known.length === lines.length,
    unknown: lines.filter((l) => !known.includes(l)).map((l) => l.label),
  };
}

/** One currency's total (D6707): only the lines in that currency (a line of unknown currency counts in the quote's). */
function totalIn(lines: QuoteLine[], currency: string, quoteCurrency: string): QuoteTotal {
  const mine = lines.filter((l) => l.currency === currency || (l.currency == null && currency === quoteCurrency));
  const known = mine.filter((l) => l.amount_cents != null && l.currency === currency);
  return {
    amount_cents: known.length ? known.reduce((n, l) => n + (l.amount_cents as number), 0) : null,
    currency,
    complete: known.length === mine.length,
    unknown: mine.filter((l) => !known.includes(l)).map((l) => l.label),
  };
}

/** The quote's lines and totals, pure. */
export function quoteOf(input: {
  jurisdictionId: string;
  service: CatalogLine | null;
  agent: CatalogLine | null;
  addOns?: (CatalogLine & { id: string })[];
  /** The reviewed table; a test may pass its own. Read only when `feeLines` is not given. */
  stateFees?: Readonly<Record<string, StateFee>>;
  /** D6707: the form's catalogue fee lines; null or absent falls back to `stateFees`. */
  feeLines?: FeeLine[] | null;
  /** D6707: the jurisdiction's vocabulary; `fee_labels` names a line by its key. */
  vocabulary?: Record<string, unknown> | null;
  /** D6707: the assigned or default partner and its founder prices. */
  partner?: QuotePartner | null;
}): Quote {
  const partner = input.partner ?? null;
  const labels = (input.vocabulary && typeof input.vocabulary.fee_labels === 'object' && input.vocabulary.fee_labels) as Record<string, unknown> | null;
  const labelFor = (key: string, fallback: string) => {
    const v = labels?.[key];
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
  };
  const billedBy = (c: CollectedBy) => (c === 'partner' ? partner?.name ?? null : null);

  // Government (and other catalogue) lines.
  const catalogueLines: QuoteLine[] = [];
  let axalFee: FeeLine | null = null;
  const partnerRules = new Map<string, FeeLine>();
  if (input.feeLines) {
    for (const f of input.feeLines) {
      const payee = payeeOf(f.payee);
      if (payee === 'axal' && f.key === 'service_fee') { axalFee = f; continue; }
      if (payee === 'partner') { partnerRules.set(f.key, f); continue; }
      const collected = collectedByOf(f.collected_by, payee);
      const timing = timingOf(f.timing, collected);
      catalogueLines.push({
        key: f.key, label: labelFor(f.key, f.label),
        amount_cents: f.checked_on && f.source ? amountOf(f.amount_cents) : null,
        currency: lower(f.currency), interval: intervalOf(timing), optional: false, paid: paidOf(timing, collected),
        source: f.source?.title ?? 'Not recorded', source_url: f.source?.url ?? null, checked_on: f.checked_on ?? null,
        payee, payee_name: payee === 'axal' ? 'Axal VC' : f.payee, collected_by: collected, timing, billed_by: billedBy(collected),
      });
    }
  } else {
    const fee = (input.stateFees ?? STATE_FILING_FEES)[input.jurisdictionId] ?? null;
    catalogueLines.push({
      key: 'state_filing_fee', label: 'State filing fee',
      amount_cents: fee && fee.checked_on ? amountOf(fee.amount_cents) : null,
      currency: fee?.currency ?? null, interval: null, optional: false, paid: 'at_filing',
      source: fee?.source ?? 'Not recorded', source_url: fee?.source_url ?? null, checked_on: fee?.checked_on ?? null,
      payee: 'government', payee_name: null, collected_by: 'government', timing: 'at_filing', billed_by: null,
    });
  }

  const s = input.service;
  const serviceLine: QuoteLine = axalFee
    ? {
      key: 'service_fee', label: labelFor('service_fee', axalFee.label),
      amount_cents: axalFee.checked_on && axalFee.source ? amountOf(axalFee.amount_cents) : null,
      currency: lower(axalFee.currency), interval: null, optional: false, paid: 'with_order',
      source: axalFee.source?.title ?? 'Not recorded', source_url: axalFee.source?.url ?? null, checked_on: axalFee.checked_on ?? null,
      payee: 'axal', payee_name: 'Axal VC', collected_by: 'axal', timing: 'at_order', billed_by: null,
    }
    : {
      key: 'service_fee', label: 'Axal VC service fee',
      amount_cents: amountOf(s?.amount_cents), currency: s?.currency ? String(s.currency).toLowerCase() : null,
      interval: null, optional: false, paid: 'with_order',
      source: CATALOG, source_url: null, checked_on: dayOf(s?.synced_at),
      payee: 'axal', payee_name: 'Axal VC', collected_by: 'axal', timing: 'at_order', billed_by: null,
    };

  // The partner's lines: each service it covers for the form, at its founder price.
  const partnerLines: QuoteLine[] = [];
  if (partner) {
    const services = new Set<string>([...partner.prices.map((p) => p.service), ...partnerRules.keys()]);
    for (const service of services) {
      const price = partner.prices.find((p) => p.service === service) ?? null;
      const rule = partnerRules.get(service) ?? null;
      const collected: CollectedBy = rule ? collectedByOf(rule.collected_by, 'partner') : 'partner';
      const timing = timingOf(price ? price.cadence : rule?.timing ?? null, collected);
      partnerLines.push({
        key: `partner:${service}`, label: labelFor(`partner:${service}`, rule?.label ?? PARTNER_SERVICE_LABELS[service] ?? service),
        amount_cents: price ? amountOf(price.founder_price_minor) : null,
        currency: lower(price?.currency ?? rule?.currency ?? null), interval: intervalOf(timing), optional: false,
        paid: paidOf(timing, collected), source: price ? PARTNER_SOURCE : 'Not recorded', source_url: null, checked_on: null,
        payee: 'partner', payee_name: partner.name, collected_by: collected, timing, billed_by: billedBy(collected),
      });
    }
  }

  const a = input.agent;
  const agentLine: QuoteLine = {
    key: 'registered_agent', label: a?.name?.trim() || 'Registered agent',
    amount_cents: amountOf(a?.amount_cents), currency: a?.currency ? String(a.currency).toLowerCase() : null,
    interval: a ? (a.interval || 'year') : 'year', optional: true, paid: 'after_you_pay',
    source: a ? CATALOG : 'Not recorded', source_url: null, checked_on: dayOf(a?.synced_at),
    payee: 'axal', payee_name: 'Axal VC', collected_by: 'axal', timing: timingOf(a ? (a.interval || 'year') : 'year', 'axal'), billed_by: null,
  };
  const addOnLines: QuoteLine[] = (input.addOns || []).map((x) => ({
    key: `add_on:${x.id}`, label: x.name?.trim() || 'Add-on',
    amount_cents: amountOf(x.amount_cents), currency: x.currency ? String(x.currency).toLowerCase() : null,
    interval: x.interval ?? null, optional: true, paid: 'after_you_pay',
    source: CATALOG, source_url: null, checked_on: dayOf(x.synced_at),
    payee: 'axal', payee_name: 'Axal VC', collected_by: 'axal', timing: timingOf(x.interval ?? null, 'axal'), billed_by: null,
  }));

  // D4357's order: the government line(s), Axal's fee, then the partner, then the optional lines.
  const lines = [...catalogueLines, serviceLine, ...partnerLines, agentLine, ...addOnLines];
  const counted = lines.filter(inTotal);
  const currency = serviceLine.currency || catalogueLines.find((l) => l.currency)?.currency || 'usd';
  const currencies = [currency, ...[...new Set(counted.map((l) => l.currency).filter((c): c is string => !!c && c !== currency))].sort()];
  const charged = lines.filter(inCharge);
  const chargeKnown = charged.every((l) => l.amount_cents != null && l.currency === currency);
  return {
    lines,
    total: quoteTotal(counted, currency),
    totals: currencies.map((c) => totalIn(counted, c, currency)),
    charge: {
      currency,
      amount_cents: charged.length && chargeKnown ? charged.reduce((n, l) => n + (l.amount_cents as number), 0) : null,
      lines: charged.map((l) => l.key),
    },
  };
}

/** A refusal the quote's writes answer with (`routes/legal.ts`, `routes/legal_incorporation_quote.ts`). */
export interface QuoteRefusal { status: 409; code: 'quote_charge_mismatch' | 'partner_collection_not_allowed'; message: string }

/** A partner line collected by Axal on a form that does not allow it (D707: not a money kind enabled here). */
export function collectionRefusal(quote: Quote, allowAxalCollection: boolean): QuoteRefusal | null {
  if (allowAxalCollection) return null;
  if (!quote.lines.some((l) => l.payee === 'partner' && l.collected_by === 'axal')) return null;
  return {
    status: 409, code: 'partner_collection_not_allowed',
    message: 'This form does not allow Axal VC to collect a partner\'s fee, so it cannot be quoted or ordered until the catalogue is corrected. Nothing was saved or charged.',
  };
}

/**
 * The charge must equal the lines collected by Axal with the order: every one
 * known, in the charge's currency, summing to the Stripe price. Null when it does.
 */
export function chargeRefusal(quote: Quote, price: { amountCents: number; currency: string }): QuoteRefusal | null {
  const c = quote.charge;
  if (c.amount_cents != null && c.amount_cents === price.amountCents && c.currency === String(price.currency || '').toLowerCase()) return null;
  return {
    status: 409, code: 'quote_charge_mismatch',
    message: 'The price on the order does not match the fees Axal VC collects in the quote, so nothing was saved or charged. Ask the Axal VC team to correct the price.',
  };
}

/** The catalogue's view of one form for the quote: its fee lines, vocabulary, partner and collection rule. */
export interface QuoteInputs {
  feeLines: FeeLine[] | null;
  vocabulary: Record<string, unknown> | null;
  partner: QuotePartner | null;
  allowAxalCollection: boolean;
  catalogueVersionId: number | null;
  legacy: boolean;
}

/** One fallback hit, logged as D6691's readers log theirs. */
function logFallback(reason: string, formKey: string) {
  console.warn(JSON.stringify({ event: FALLBACK_EVENT, reader: 'itemised_quote', reason, form_key: formKey }));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The partner a quote prices: the case's accepted formation assignment, or,
 * before one, the default partner of D6693 (a verified firm with formation
 * coverage on for the form, an unexpired credential for the country and a
 * signed data agreement; lowest `priority`, ties to the oldest row). Its
 * founder price for each service it covers for the form; never its cost.
 */
export async function quotePartner(env: Env, country: string, formKey: string, opts: { caseId?: number | null; today?: string } = {}): Promise<QuotePartner | null> {
  const today = opts.today ?? isoDay(new Date());
  let partnerId: number | null = null;
  let assigned = false;
  if (opts.caseId != null) {
    const a = await env.DB.prepare(
      `SELECT formation_partner_id FROM formation_case_assignments
        WHERE case_id = ? AND service = 'formation' AND state = 'accepted' ORDER BY id DESC LIMIT 1`,
    ).bind(opts.caseId).first<{ formation_partner_id: number }>();
    if (a) { partnerId = Number(a.formation_partner_id); assigned = true; }
  }
  if (partnerId == null) {
    const d = await env.DB.prepare(
      `SELECT p.id FROM formation_partner_coverage c JOIN formation_partners p ON p.id = c.formation_partner_id
        WHERE c.country = ? AND c.form_key = ? AND c.service = 'formation' AND c.is_on = 1
          AND p.status = 'verified' AND p.dpa_signed_on IS NOT NULL
          AND EXISTS (SELECT 1 FROM formation_partner_credentials k
                       WHERE k.formation_partner_id = p.id AND k.country = ? AND date(k.valid_until) >= date(?))
        ORDER BY c.priority ASC, c.id ASC LIMIT 1`,
    ).bind(country, formKey, country, today).first<{ id: number }>();
    if (d) partnerId = Number(d.id);
  }
  if (partnerId == null) return null;
  const firm = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(trim(p.company), ''), p.name) AS name
       FROM formation_partners f JOIN partners p ON p.id = f.partner_id WHERE f.id = ?`,
  ).bind(partnerId).first<{ name: string }>();
  const rows = (await env.DB.prepare(
    `SELECT c.service, pr.founder_price_minor, pr.currency, pr.cadence
       FROM formation_partner_coverage c JOIN formation_partner_prices pr ON pr.coverage_id = c.id
      WHERE c.formation_partner_id = ? AND c.country = ? AND c.form_key = ? AND c.is_on = 1
        AND date(pr.effective_from) <= date(?) AND (pr.effective_to IS NULL OR date(pr.effective_to) > date(?))
      ORDER BY c.service, pr.effective_from DESC, pr.id DESC`,
  ).bind(partnerId, country, formKey, today, today).all<{ service: string; founder_price_minor: number; currency: string; cadence: string }>()).results || [];
  const prices: PartnerPrice[] = [];
  for (const r of rows) {
    if (prices.some((p) => p.service === r.service)) continue;
    prices.push({ service: String(r.service), founder_price_minor: Number(r.founder_price_minor), currency: String(r.currency), cadence: String(r.cadence) });
  }
  return { formation_partner_id: partnerId, name: firm?.name ? String(firm.name) : 'Your formation partner', assigned, prices };
}

/**
 * What the catalogue says of one form for the quote. Never throws: when the
 * catalogue cannot answer, the fee lines are null (the reviewed table stands
 * in), there is no partner, and Axal may not collect a partner's fee.
 */
export async function quoteInputs(env: Env, formKey: string, opts: { caseId?: number | null; today?: string } = {}): Promise<QuoteInputs> {
  const none: QuoteInputs = { feeLines: null, vocabulary: null, partner: null, allowAxalCollection: false, catalogueVersionId: null, legacy: true };
  let form;
  try {
    const v = await readerVersion(env);
    if (!v) { logFallback('no_version', formKey); return none; }
    form = await catalogueForm(env, formKey, { version: v });
    if (!form) { logFallback('no_form', formKey); return none; }
  } catch {
    logFallback('read_failed', formKey);
    return none;
  }
  let partner: QuotePartner | null = null;
  try {
    partner = await quotePartner(env, form.jurisdiction.country, formKey, opts);
  } catch {
    partner = null;
  }
  return {
    feeLines: form.fees, vocabulary: form.jurisdiction.vocabulary, partner,
    allowAxalCollection: form.form.allow_axal_collection, catalogueVersionId: form.version.id,
    legacy: String(form.form.legacy_gate ?? '') === '1',
  };
}

/**
 * The order routes' price check (`routes/legal.ts`): the refusal to answer
 * before any write, or null. The Stripe price is the one the route charges.
 */
export async function orderQuoteRefusal(env: Env, formKey: string, price: { amountCents: number; currency: string } | null): Promise<QuoteRefusal | null> {
  const inputs = await quoteInputs(env, formKey);
  const quote = quoteOf({
    jurisdictionId: formKey, service: price ? { amount_cents: price.amountCents, currency: price.currency } : null, agent: null,
    feeLines: inputs.feeLines, vocabulary: inputs.vocabulary, partner: inputs.partner,
  });
  return collectionRefusal(quote, inputs.allowAxalCollection) ?? (price ? chargeRefusal(quote, price) : null);
}

/**
 * The statements that snapshot a quote's lines on a case (`formation_case_fee_lines`),
 * all under one `quote_uid`. A snapshot is never changed; a later quote adds another.
 */
export function snapshotStatements(env: Env, caseId: number, quoteUid: string, quote: Quote, meta: { partnerId: number | null; versionId: number | null; userId: number | null }): D1PreparedStatement[] {
  return quote.lines.map((l, i) => env.DB.prepare(
    `INSERT INTO formation_case_fee_lines (case_id, quote_uid, position, line_key, label, payee, payee_name, collected_by, timing,
       currency, amount_minor, optional, source, source_url, checked_on, formation_partner_id, catalogue_version_id, quoted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(caseId, quoteUid, i, l.key.slice(0, 96), l.label.slice(0, 200), l.payee, l.payee_name?.slice(0, 200) ?? null, l.collected_by, l.timing,
    l.currency, l.amount_cents, l.optional ? 1 : 0, l.source.slice(0, 300), l.source_url?.slice(0, 2000) ?? null, l.checked_on,
    l.payee === 'partner' ? meta.partnerId : null, meta.versionId, meta.userId));
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
