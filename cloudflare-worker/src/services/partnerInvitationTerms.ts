/**
 * D1118 (#2998) — per-invitation terms for Deal-sourcing revenue share and
 * Custom (PI4's "Adjust terms"), migration 634.
 *
 * The owner answered A: the Super Admin sets them in New invitation, and
 * setting them is the approval. An Admin's invitation goes with the standard
 * terms. NULL `terms_json` is the standard terms.
 *
 * Four values: a revenue-share percentage (stored as basis points, never a
 * float), an attribution window in days, a term in months and an optional
 * note. `buildProposals` puts them into the two offers they apply to, so the
 * offer the partner chooses, and the `proposal_json` they sign, carry them.
 */
import type { PartnerDealType } from './partnerDeals';

export type InvitationTerms = Readonly<{
  revshare_bps: number;
  attribution_window_days: number;
  term_months: number;
  note: string | null;
}>;

/** The two offers per-invitation terms apply to. */
export const TERMS_TYPES: ReadonlyArray<PartnerDealType> = ['deal_sourcing_revshare', 'custom'];

/** The bounds the Worker accepts. A percentage has at most two decimals. */
export const TERMS_LIMITS = Object.freeze({
  revshare_bps: [1, 5000] as const,
  attribution_window_days: [30, 1095] as const,
  term_months: [1, 60] as const,
  note_max: 500,
});

const within = (n: number, [lo, hi]: readonly [number, number]) => Number.isSafeInteger(n) && n >= lo && n <= hi;

/** The percentage as written, from basis points: 1250 → "12.5". Whole bps print exactly. */
export function revsharePct(bps: number): string {
  return String(bps / 100);
}

export type TermsParse = { ok: true; terms: InvitationTerms } | { ok: false; error: string; message: string };

const refuse = (error: string, message: string): TermsParse => ({ ok: false, error, message });

/**
 * A New invitation's `terms` field. The percentage comes as a number of
 * percent (12.5), the window and term as whole numbers, the note as text.
 * Every refusal names the field and its bounds, never the value sent.
 */
export function parseTermsInput(raw: unknown): TermsParse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('terms_invalid', 'The terms could not be read.');
  const r = raw as Record<string, unknown>;
  const pct = typeof r.revshare_pct === 'number' ? r.revshare_pct : Number.NaN;
  const bps = Math.round(pct * 100);
  if (!Number.isFinite(pct) || Math.abs(pct * 100 - bps) > 1e-6 || !within(bps, TERMS_LIMITS.revshare_bps)) {
    return refuse('terms_revshare_invalid', 'Enter a revenue share from 0.01% to 50%, with at most two decimals.');
  }
  const days = r.attribution_window_days;
  if (typeof days !== 'number' || !within(days, TERMS_LIMITS.attribution_window_days)) {
    return refuse('terms_window_invalid', 'Enter an attribution window of 30 to 1,095 days.');
  }
  const months = r.term_months;
  if (typeof months !== 'number' || !within(months, TERMS_LIMITS.term_months)) {
    return refuse('terms_term_invalid', 'Enter a term of 1 to 60 months.');
  }
  if (r.note !== undefined && r.note !== null && typeof r.note !== 'string') return refuse('terms_note_invalid', 'The terms note must be text.');
  const note = typeof r.note === 'string' ? r.note.trim().replace(/\s+/g, ' ') : '';
  if (note.length > TERMS_LIMITS.note_max) return refuse('terms_note_invalid', 'Keep the terms note to 500 characters.');
  return { ok: true, terms: Object.freeze({ revshare_bps: bps, attribution_window_days: days, term_months: months, note: note || null }) };
}

export type StoredTerms = { state: 'standard' } | { state: 'set'; terms: InvitationTerms } | { state: 'unreadable' };

/**
 * An invitation's stored terms. A value the writer would not have stored is
 * `unreadable`, never the standard terms: an offer must not quietly drop
 * what the Super Admin set.
 */
export function readStoredTerms(raw: unknown): StoredTerms {
  if (raw === null || raw === undefined) return { state: 'standard' };
  try {
    const v = JSON.parse(String(raw));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { state: 'unreadable' };
    if (!within(v.revshare_bps, TERMS_LIMITS.revshare_bps) || !within(v.attribution_window_days, TERMS_LIMITS.attribution_window_days)
      || !within(v.term_months, TERMS_LIMITS.term_months)) return { state: 'unreadable' };
    if (v.note !== null && (typeof v.note !== 'string' || v.note.length > TERMS_LIMITS.note_max)) return { state: 'unreadable' };
    return { state: 'set', terms: Object.freeze({ revshare_bps: v.revshare_bps, attribution_window_days: v.attribution_window_days,
      term_months: v.term_months, note: v.note }) };
  } catch {
    return { state: 'unreadable' };
  }
}

/** Whether a set of offered types includes one the terms apply to. */
export const termsApply = (types: ReadonlyArray<string>) => types.some((t) => (TERMS_TYPES as ReadonlyArray<string>).includes(t));
