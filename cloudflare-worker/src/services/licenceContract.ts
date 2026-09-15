/**
 * Instantiate a licence agreement from a master template (H3 step 5, D110).
 *
 * WHY THIS IS A SERVICE AND NOT TWENTY LINES IN THE ROUTE. Two things here are
 * worth reading on their own and testing without a Worker: what a licence
 * can fill in, and what happens to a field it cannot. The rendering is a pure
 * function over a template body and a licence row, so the test that matters —
 * an unfillable field stays visible and is reported — needs no database.
 *
 * WHAT A PLACEHOLDER MEANS WHEN NOBODY CAN FILL IT. `extractMergeFields`
 * (legalTemplateStore) reads `{{field}}` out of the body; the licence supplies
 * what it has. A field it does not have is LEFT AS THE PLACEHOLDER and named
 * in `unfilled_fields` — not replaced with an empty string. Blanking it would
 * turn "we never agreed a governing law" into a contract that reads as
 * complete and says nothing, which is the failure mode this whole file is
 * arranged around.
 *
 * MONEY IS FORMATTED FROM INTEGERS, never stored as text and never re-derived
 * on read. `annual_fee_cents` and the two `_bps` columns are the ledger's own
 * integers (migration 187 says why); this renders them once, into the body
 * that is then stored verbatim.
 */
import type { LicenceRow } from '../routes/admin_licences';

/** `{{field}}`, the spelling `extractMergeFields` already recognises. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** 3500 → "35%"; 3550 → "35.5%". Basis points, never a float in the store. */
export function pctFromBps(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined) return null;
  const n = Number(bps);
  if (!Number.isFinite(n)) return null;
  return `${(n / 100).toFixed(n % 100 === 0 ? 0 : 1)}%`;
}

/** 9000000 cents in EUR → "EUR 90,000.00". */
export function moneyFromCents(cents: number | null | undefined, currency: string | null): string | null {
  if (cents === null || cents === undefined) return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(Math.abs(n) / 100);
  const frac = String(Math.abs(n) % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency || 'EUR'} ${n < 0 ? '-' : ''}${grouped}.${frac}`;
}

/**
 * Every value a licence can put into a contract, by the name a template uses.
 *
 * A KEY PRESENT WITH A NULL VALUE IS NOT THE SAME AS AN ABSENT KEY, and the
 * difference is the reason `mergeValues` returns nulls rather than omitting
 * them: a template asking for `renews_on` on a licence whose renewal date has
 * never been set is asking for something this licence genuinely does not have,
 * and it belongs in `unfilled_fields` exactly like a field nobody has heard
 * of. Both are "the contract is not finished".
 */
export function mergeValues(
  licence: LicenceRow,
  territories: string[],
  seats: Array<{ seat_type: string; seats_licensed: number }> = [],
): Record<string, string | null> {
  const seatsTotal = seats.reduce((n, s) => n + (Number(s.seats_licensed) || 0), 0);
  const bySeat: Record<string, string> = {};
  for (const s of seats) bySeat[`seats_${s.seat_type}`] = String(Number(s.seats_licensed) || 0);
  return {
    licence_ref: licence.licence_ref || null,
    legal_entity_name: licence.legal_entity_name || null,
    brand_name: licence.brand_name || null,
    registered_address: licence.registered_address || null,
    signatory_name: licence.signatory_name || null,
    signatory_title: licence.signatory_title || null,
    territory: territories.length ? territories.join(', ') : null,
    territory_count: territories.length ? String(territories.length) : null,
    seats_total: seats.length ? String(seatsTotal) : null,
    ...bySeat,
    annual_fee: moneyFromCents(licence.annual_fee_cents, licence.currency),
    currency: licence.currency || null,
    revenue_share: pctFromBps(licence.revenue_share_bps),
    token_split: pctFromBps(licence.token_split_bps),
    term_years: licence.term_years === null ? null : String(licence.term_years),
    starts_on: licence.starts_on || null,
    renews_on: licence.renews_on || null,
  };
}

/**
 * Substitute what the licence has; leave the rest visible and name it.
 *
 * Order is stable and duplicates collapse, so `unfilled_fields` reads as a
 * checklist rather than as one entry per occurrence.
 */
export function renderContract(
  templateBody: string,
  values: Record<string, string | null>,
): { body: string; unfilled: string[] } {
  const unfilled: string[] = [];
  const body = String(templateBody ?? '').replace(PLACEHOLDER, (whole, name: string) => {
    const v = values[name];
    if (v === null || v === undefined || v === '') {
      if (!unfilled.includes(name)) unfilled.push(name);
      return whole;
    }
    return v;
  });
  return { body, unfilled };
}
