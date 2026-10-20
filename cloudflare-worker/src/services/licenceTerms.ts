/**
 * A licence's terms schedule (D797, #2230): the one list of its fields.
 *
 * WRITTEN ONCE, IMPORTED EVERYWHERE. HQ's write (`PUT /api/admin/licences/:uid/terms`),
 * HQ's read, the Administrator's read (`GET /api/licence/mine`), the branch copy
 * and D800/D801's screens all take the keys, types, ranges and labels from
 * here. Migration 512's CHECKs are the same ranges, so the store refuses what
 * the route refuses.
 *
 * NULL IS "NOT RECORDED", NEVER ZERO. Every term is optional; a term HQ has not
 * entered reads as `null`, and a screen says "Not recorded" for it.
 */
import type { Env } from '../types';
import type { AxalEntityKey } from './legalDocFormat';

export type LicenceTermGroup = 'parties' | 'territory' | 'renewal' | 'money' | 'deal' | 'seats' | 'brand' | 'reporting';

export type LicenceTermField =
  | { key: string; group: LicenceTermGroup; label: string; type: 'enum'; values: readonly string[] }
  | { key: string; group: LicenceTermGroup; label: string; type: 'int'; min: number; max: number; unit: 'months' | 'days' | 'business_days' | 'day_of_month' }
  | { key: string; group: LicenceTermGroup; label: string; type: 'bps' }
  | { key: string; group: LicenceTermGroup; label: string; type: 'cents' }
  | { key: string; group: LicenceTermGroup; label: string; type: 'bool' }
  | { key: string; group: LicenceTermGroup; label: string; type: 'text'; max: number };

/** The licensor entities (`AxalEntityKey`, `services/legalDocFormat.ts`). */
export const LICENSOR_ENTITIES: readonly AxalEntityKey[] = ['management', 'holdings', 'gp', 'fund'];

/** The longest number of days a term may state: ten years. */
export const MAX_TERM_DAYS = 3650;

export const LICENCE_TERM_FIELDS: readonly LicenceTermField[] = [
  // Parties. Two licensors (the Licences canvas, §1.1): platform IP, which is
  // the payee for the licence fee and statements (D798, D802), and the brand.
  { key: 'licensor_ip_entity', group: 'parties', label: 'Licensor, platform IP', type: 'enum', values: LICENSOR_ENTITIES },
  { key: 'licensor_brand_entity', group: 'parties', label: 'Licensor, trademark and brand', type: 'enum', values: LICENSOR_ENTITIES },
  { key: 'governing_law', group: 'parties', label: 'Governing law', type: 'text', max: 200 },
  // Territory
  { key: 'exclusive', group: 'territory', label: 'Exclusive territory', type: 'bool' },
  { key: 'non_compete_months', group: 'territory', label: 'Non-compete after the term', type: 'int', min: 0, max: 120, unit: 'months' },
  { key: 'referrals_note', group: 'territory', label: 'Referrals from outside the territory', type: 'text', max: 500 },
  // Term and renewal
  { key: 'renewal_mode', group: 'renewal', label: 'Renewal', type: 'enum', values: ['auto', 'on_request'] },
  { key: 'non_renewal_notice_days', group: 'renewal', label: 'Non-renewal notice', type: 'int', min: 0, max: MAX_TERM_DAYS, unit: 'days' },
  { key: 'cure_days', group: 'renewal', label: 'Cure period', type: 'int', min: 0, max: MAX_TERM_DAYS, unit: 'days' },
  { key: 'termination_note', group: 'renewal', label: 'At the end of the term', type: 'text', max: 2000 },
  // Money. A stream share left null falls back to the ledger's
  // `territory_licences.revenue_share_bps` when a statement is drawn (D802).
  { key: 'share_subscriptions_bps', group: 'money', label: 'Revenue share, subscriptions', type: 'bps' },
  { key: 'share_licence_fees_bps', group: 'money', label: 'Revenue share, licence fees', type: 'bps' },
  { key: 'share_token_margin_bps', group: 'money', label: 'Revenue share, token margin', type: 'bps' },
  { key: 'royalty_platform_licence_bps', group: 'money', label: 'Royalty on platform licences sold', type: 'bps' },
  { key: 'payment_terms_days', group: 'money', label: 'Payment terms', type: 'int', min: 0, max: MAX_TERM_DAYS, unit: 'days' },
  { key: 'late_interest_bps', group: 'money', label: 'Late interest, per month', type: 'bps' },
  { key: 'minimum_guarantee_cents', group: 'money', label: 'Minimum guarantee', type: 'cents' },
  { key: 'fee_invoiced', group: 'money', label: 'Fee invoiced', type: 'enum', values: ['annually', 'quarterly'] },
  // Deal terms
  { key: 'first_look_business_days', group: 'deal', label: 'First look', type: 'int', min: 0, max: MAX_TERM_DAYS, unit: 'business_days' },
  { key: 'co_invest_max_bps', group: 'deal', label: 'Co-invest, most of a round', type: 'bps' },
  { key: 'carry_share_bps', group: 'deal', label: 'Carry share on sourced deals', type: 'bps' },
  { key: 'referral_fee_bps', group: 'deal', label: 'Referral fee', type: 'bps' },
  { key: 'hq_approval_above_cents', group: 'deal', label: 'HQ approval above', type: 'cents' },
  { key: 'conflicts_note', group: 'deal', label: 'Conflicts', type: 'text', max: 2000 },
  // Seats
  { key: 'seat_includes', group: 'seats', label: 'What a seat includes', type: 'text', max: 500 },
  // Brand: "Axal VC brand kit", or the licensee's own for a white-label.
  { key: 'brand_kit', group: 'brand', label: 'Brand kit', type: 'text', max: 200 },
  // Reporting
  { key: 'usage_report_day', group: 'reporting', label: 'Usage report due, day of month', type: 'int', min: 1, max: 28, unit: 'day_of_month' },
  { key: 'statement_period', group: 'reporting', label: 'Statement period', type: 'enum', values: ['quarter', 'month'] },
  { key: 'data_role', group: 'reporting', label: 'Data controller', type: 'enum', values: ['licensee_controller', 'hq_controller'] },
  { key: 'audit_right', group: 'reporting', label: 'HQ audit right', type: 'bool' },
  { key: 'audit_notice_days', group: 'reporting', label: 'Audit notice', type: 'int', min: 0, max: MAX_TERM_DAYS, unit: 'days' },
];

/**
 * The contract section that states each term, as the Licences canvas cites
 * them (board L2, the Subsidiary Licence Agreement, D803). A read gives these
 * unless HQ recorded another section for the licence (`sections_json`).
 */
export const DEFAULT_TERM_SECTIONS: Readonly<Record<string, string>> = Object.freeze({
  licensor_ip_entity: '§1.1', licensor_brand_entity: '§1.1', governing_law: '§22',
  exclusive: '§2.1', non_compete_months: '§2.4', referrals_note: '§2.5',
  renewal_mode: '§3.2', non_renewal_notice_days: '§3.3', cure_days: '§19.2', termination_note: '§19.5',
  share_subscriptions_bps: '§4.2', share_licence_fees_bps: '§4.2', share_token_margin_bps: '§4.2',
  minimum_guarantee_cents: '§4.4', payment_terms_days: '§4.6', late_interest_bps: '§4.6',
  royalty_platform_licence_bps: '§4.7',
  first_look_business_days: '§5.1', co_invest_max_bps: '§5.2', carry_share_bps: '§5.3',
  referral_fee_bps: '§5.4', hq_approval_above_cents: '§5.5', conflicts_note: '§5.6',
  seat_includes: '§6.2', brand_kit: '§7.2', data_role: '§7.4',
  usage_report_day: '§8.1', statement_period: '§8.2', audit_right: '§8.5', audit_notice_days: '§8.5',
});

export const LICENCE_TERM_KEYS: readonly string[] = LICENCE_TERM_FIELDS.map((f) => f.key);
const BY_KEY = new Map(LICENCE_TERM_FIELDS.map((f) => [f.key, f]));

/** A recorded term's value: a string, a whole number, or null for "not recorded". */
export type TermValue = string | number | null;
export type LicenceTerms = Record<string, TermValue>;

/** The longest contract-section reference, e.g. "§7.3(b)". */
export const MAX_SECTION_CHARS = 40;

export type TermError = { field: string; message: string };

/**
 * One term's value as stored, or the reason it is refused. `null` clears.
 * Booleans are stored as 0/1; whole numbers only, never a float.
 */
export function normaliseTerm(field: LicenceTermField, raw: unknown): { ok: true; value: TermValue } | { ok: false; message: string } {
  if (raw === null) return { ok: true, value: null };
  switch (field.type) {
    case 'enum':
      return typeof raw === 'string' && field.values.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `must be one of ${field.values.join(', ')}` };
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, message: 'must be text' };
      const v = raw.trim();
      if (v.length > field.max) return { ok: false, message: `must be at most ${field.max} characters` };
      return { ok: true, value: v || null };
    }
    case 'bool':
      if (raw === true || raw === 1) return { ok: true, value: 1 };
      if (raw === false || raw === 0) return { ok: true, value: 0 };
      return { ok: false, message: 'must be true or false' };
    case 'bps':
      return Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= 10000
        ? { ok: true, value: raw as number }
        : { ok: false, message: 'must be whole basis points from 0 to 10000' };
    case 'cents':
      return Number.isSafeInteger(raw) && (raw as number) >= 0
        ? { ok: true, value: raw as number }
        : { ok: false, message: 'must be whole cents, not negative' };
    case 'int':
      return Number.isInteger(raw) && (raw as number) >= field.min && (raw as number) <= field.max
        ? { ok: true, value: raw as number }
        : { ok: false, message: `must be a whole number from ${field.min} to ${field.max}` };
  }
}

/**
 * A save's terms and sections, validated. Only the keys the body names change;
 * a key it leaves out keeps its value. An unknown key is refused, never
 * ignored, so a typo cannot read as a save.
 */
export function validateTermsBody(terms: unknown, sections: unknown): { ok: true; terms: LicenceTerms; sections: Record<string, string | null> | null } | { ok: false; errors: TermError[] } {
  const errors: TermError[] = [];
  const out: LicenceTerms = {};
  if (terms !== undefined && (terms === null || typeof terms !== 'object' || Array.isArray(terms))) {
    return { ok: false, errors: [{ field: 'terms', message: 'must be an object of term keys' }] };
  }
  for (const [key, raw] of Object.entries((terms as Record<string, unknown>) || {})) {
    const field = BY_KEY.get(key);
    if (!field) { errors.push({ field: key, message: 'is not a licence term' }); continue; }
    const r = normaliseTerm(field, raw);
    if (r.ok) out[key] = r.value; else errors.push({ field: key, message: r.message });
  }
  let secs: Record<string, string | null> | null = null;
  if (sections !== undefined) {
    if (sections === null || typeof sections !== 'object' || Array.isArray(sections)) {
      errors.push({ field: 'sections', message: 'must be an object of term keys' });
    } else {
      secs = {};
      for (const [key, raw] of Object.entries(sections as Record<string, unknown>)) {
        if (!BY_KEY.has(key)) { errors.push({ field: `sections.${key}`, message: 'is not a licence term' }); continue; }
        if (raw === null) { secs[key] = null; continue; }
        if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > MAX_SECTION_CHARS) {
          errors.push({ field: `sections.${key}`, message: `must be a section reference of 1 to ${MAX_SECTION_CHARS} characters` });
          continue;
        }
        secs[key] = raw.trim();
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, terms: out, sections: secs };
}

/** The stored row, as the reads return it. */
export type LicenceTermsRecord = { terms: LicenceTerms; sections: Record<string, string> };

type Row = Record<string, unknown> & { sections_json?: string | null };

/** A stored row as `{ terms, sections }`: every key present, a missing one null. */
export function termsFromRow(row: Row | null | undefined): LicenceTermsRecord | null {
  if (!row) return null;
  const terms: LicenceTerms = {};
  for (const key of LICENCE_TERM_KEYS) {
    const v = row[key];
    terms[key] = v === undefined || v === null ? null : (typeof v === 'number' ? v : String(v));
  }
  let sections: Record<string, string> = { ...DEFAULT_TERM_SECTIONS };
  try {
    const parsed = row.sections_json ? JSON.parse(String(row.sections_json)) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (BY_KEY.has(k) && typeof v === 'string') sections[k] = v;
      }
    }
  } catch { sections = {}; }
  return { terms, sections };
}

/** One licence's stored terms, or null when HQ has recorded none. Throws when the read fails. */
export async function readLicenceTerms(env: Env, licenceUid: string): Promise<LicenceTermsRecord | null> {
  const row = await env.DB.prepare('SELECT * FROM licence_terms WHERE licence_uid = ?').bind(licenceUid).first<Row>();
  return termsFromRow(row);
}

/** What changed between two records: each changed key with its before and after. */
export function termsDiff(before: LicenceTermsRecord | null, after: LicenceTermsRecord): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of LICENCE_TERM_KEYS) {
    const b = before?.terms[key] ?? null;
    const a = after.terms[key] ?? null;
    if (b !== a) diff[key] = { before: b, after: a };
  }
  const bs = before?.sections ?? {};
  for (const key of new Set([...Object.keys(bs), ...Object.keys(after.sections)])) {
    const b = bs[key] ?? null;
    const a = after.sections[key] ?? null;
    if (b !== a) diff[`sections.${key}`] = { before: b, after: a };
  }
  return diff;
}

/** The sentences a read gives when there are no terms to show. */
export const TERMS_REASON = {
  not_recorded: 'HQ has not recorded this licence\'s terms yet.',
  not_pushed: 'HQ has not pushed this licence\'s terms yet.',
  unreadable: 'This licence\'s terms could not be read just now.',
} as const;
