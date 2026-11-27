/**
 * D5456 (#5456, ADP-02 of #5453) — the server-side validation of a private deal preparation's content: field errors
 * for supplied values that are invalid or inconsistent, readiness warnings for what an unfinished draft still lacks,
 * and the canonical digest a revision and an operation key are compared by. Pure: no database, no clock of its own.
 *
 * THE KEYS are D5454's `REVISION_CONTENT_KEYS` (services/dealPreparation.ts); an unknown key is a field error, never
 * stored. `audience_manifest` belongs to release (ADP-04) and is refused here.
 *
 * UNKNOWN IS NOT ZERO. A blank string, `null` or an absent key means "not recorded" and is stored as null (or left
 * out); it is never turned into 0, `none` or a default. An incomplete draft saves; what it lacks is a readiness
 * warning, not an error. Publication requirements are ADP-03/04's.
 *
 * MONEY uses the deal's existing semantics (`deals.target_raise` and friends: whole currency units as a number, at
 * most two decimals). New rounds are USD only until another currency is authorised. Nothing is converted.
 *
 * DEADLINES. `closing_deadline` is a calendar day, `YYYY-MM-DD`. Its instant is the END of that day in UTC
 * (23:59:59.999Z): a deadline has passed once the injected clock is past that instant. A past deadline saves (a
 * historical draft is legitimate) and is a readiness warning; release (ADP-04) decides what it blocks.
 */
import { REVISION_CONTENT_KEYS } from './dealPreparation';

export type ContentKey = typeof REVISION_CONTENT_KEYS[number];
export type FieldErrors = Partial<Record<string, string>>;
export type Content = Partial<Record<ContentKey, unknown>>;

/** The instruments the existing draft and terms forms offer (StudioParts.jsx). No other value is accepted. */
export const PERMITTED_INSTRUMENTS = ['SAFE', 'Convertible Note', 'Equity', 'SPV'] as const;
/** New rounds are USD only until another currency is separately authorised (#5456). */
export const PERMITTED_CURRENCIES = ['USD'] as const;

export const TEXT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  title: 200, summary: 1000, description: 20000, sector: 120, spv_jurisdiction: 120, internal_notes: 10000,
});
export const WEBSITE_MAX = 300;
export const AMOUNT_KEYS = ['target_raise', 'minimum_check', 'valuation_cap'] as const;
export const PERCENT_KEYS = ['carry_pct', 'management_fee_pct'] as const;
/** The largest amount a field accepts: well inside a double's exact-cent range. */
export const AMOUNT_MAX = 1e13;
export const EVIDENCE_MAX = 50;
export const EVIDENCE_SOURCE_MAX = 500;
export const EVIDENCE_URL_MAX = 2048;
/** Fields an evidence reference may point at: the editorial facts, not notes or audience. */
export const EVIDENCE_FIELDS = REVISION_CONTENT_KEYS.filter((k) => k !== 'internal_notes' && k !== 'evidence_refs' && k !== 'audience_manifest');

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** Blank means not recorded. */
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** At most two decimal places, judged on the value's shortest decimal form (no float rounding hides a third). */
function twoDecimals(n: number): boolean {
  const s = String(n);
  if (/e/i.test(s)) return Number.isInteger(n);
  return DECIMAL.test(s);
}

/** A non-negative finite number with at most two decimals, from a number or a plain decimal string. */
function parseDecimal(v: unknown): { ok: true; value: number } | { ok: false; code: string } {
  if (typeof v === 'boolean' || (typeof v !== 'number' && typeof v !== 'string')) return { ok: false, code: 'not_a_number' };
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('-')) return { ok: false, code: 'must_not_be_negative' };
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, code: 'not_a_number' };
    if (!DECIMAL.test(t)) return { ok: false, code: 'too_many_decimals' };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, code: 'not_a_number' };
    return { ok: true, value: n };
  }
  if (!Number.isFinite(v)) return { ok: false, code: 'not_a_number' };
  if (v < 0 || Object.is(v, -0)) return v < 0 ? { ok: false, code: 'must_not_be_negative' } : { ok: true, value: 0 };
  if (!twoDecimals(v)) return { ok: false, code: 'too_many_decimals' };
  return { ok: true, value: v };
}

/** A real calendar day, `YYYY-MM-DD` (2026-02-30 is refused, 2028-02-29 accepted). */
export function isCalendarDay(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DAY.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The instant a closing deadline passes: the end of its day, UTC. */
export function deadlineInstant(day: string): number {
  const m = DAY.exec(day)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

/** Whether `day` has passed at `now`. The deadline day itself, up to 23:59:59.999Z, has not. */
export function deadlinePassed(day: string, now: Date): boolean {
  return now.getTime() > deadlineInstant(day);
}

/** An http(s) URL of at most `max` characters, with a host. Any other scheme (javascript:, data:, ftp:) is refused. */
export function safeUrl(v: unknown, max: number): { ok: true; value: string } | { ok: false; code: string } {
  if (typeof v !== 'string') return { ok: false, code: 'invalid_url' };
  const t = v.trim();
  if (t.length > max) return { ok: false, code: 'too_long' };
  let u: URL;
  try { u = new URL(t); } catch { return { ok: false, code: 'invalid_url' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, code: 'unsupported_url_scheme' };
  if (!u.hostname || u.username || u.password) return { ok: false, code: 'invalid_url' };
  return { ok: true, value: t };
}

function validateEvidence(v: unknown): { ok: true; value: unknown[] } | { ok: false; code: string } {
  if (!Array.isArray(v)) return { ok: false, code: 'not_a_list' };
  if (v.length > EVIDENCE_MAX) return { ok: false, code: 'too_many' };
  const out: unknown[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, code: 'invalid_reference' };
    const r = item as Record<string, unknown>;
    for (const k of Object.keys(r)) if (!['field', 'kind', 'source', 'url'].includes(k)) return { ok: false, code: 'invalid_reference' };
    if (r.field != null && !(EVIDENCE_FIELDS as readonly string[]).includes(String(r.field))) return { ok: false, code: 'invalid_reference_field' };
    // `typed`: an admin entered the value. `quoted`: the value is taken from a named source, which must be given.
    if (r.kind !== 'typed' && r.kind !== 'quoted') return { ok: false, code: 'invalid_reference_kind' };
    const source = blank(r.source) ? null : String(r.source).trim();
    if (source != null && (typeof r.source !== 'string' || source.length > EVIDENCE_SOURCE_MAX)) return { ok: false, code: 'invalid_reference_source' };
    if (r.kind === 'quoted' && source == null) return { ok: false, code: 'quoted_reference_needs_source' };
    let url: string | null = null;
    if (!blank(r.url)) {
      const u = safeUrl(r.url, EVIDENCE_URL_MAX);
      if (!u.ok) return { ok: false, code: 'invalid_reference_url' };
      url = u.value;
    }
    out.push({ field: r.field == null ? null : String(r.field), kind: r.kind, source, url });
  }
  return { ok: true, value: out };
}

/**
 * Validates the keys a create or save supplies, one field at a time. Returns the normalised values (blank → null,
 * trimmed text, upper-case currency) and the field errors. Cross-field rules need the merged content: `crossFieldErrors`.
 */
export function validateChanges(input: unknown): { values: Content; errors: FieldErrors } {
  const values: Content = {};
  const errors: FieldErrors = {};
  if (input == null) return { values, errors };
  if (typeof input !== 'object' || Array.isArray(input)) return { values, errors: { _: 'not_an_object' } };
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(REVISION_CONTENT_KEYS as readonly string[]).includes(key)) { errors[key] = 'unknown_field'; continue; }
    const k = key as ContentKey;
    if (k === 'audience_manifest') {
      if (raw != null) errors[k] = 'not_editable_here';
      continue;
    }
    if (blank(raw)) { values[k] = null; continue; }
    if (k in TEXT_LIMITS) {
      if (typeof raw !== 'string') { errors[k] = 'not_text'; continue; }
      const t = raw.trim();
      if (t.length > TEXT_LIMITS[k]) { errors[k] = 'too_long'; continue; }
      values[k] = t;
    } else if (k === 'website') {
      const u = safeUrl(raw, WEBSITE_MAX);
      if (!u.ok) errors[k] = u.code; else values[k] = u.value;
    } else if (k === 'instrument') {
      if (!(PERMITTED_INSTRUMENTS as readonly unknown[]).includes(raw)) errors[k] = 'unsupported_instrument'; else values[k] = raw;
    } else if (k === 'currency') {
      const cur = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!(PERMITTED_CURRENCIES as readonly string[]).includes(cur)) errors[k] = 'unsupported_currency'; else values[k] = cur;
    } else if ((AMOUNT_KEYS as readonly string[]).includes(k)) {
      const n = parseDecimal(raw);
      if (!n.ok) { errors[k] = n.code; continue; }
      if (n.value > AMOUNT_MAX) { errors[k] = 'too_large'; continue; }
      if (k === 'minimum_check' && n.value <= 0) { errors[k] = 'must_be_positive'; continue; }
      values[k] = n.value;
    } else if ((PERCENT_KEYS as readonly string[]).includes(k)) {
      const n = parseDecimal(raw);
      if (!n.ok) { errors[k] = n.code; continue; }
      if (n.value > 100) { errors[k] = 'percent_out_of_range'; continue; }
      values[k] = n.value;
    } else if (k === 'closing_deadline') {
      if (!isCalendarDay(raw)) errors[k] = 'invalid_date'; else values[k] = raw;
    } else if (k === 'evidence_refs') {
      const e = validateEvidence(raw);
      if (!e.ok) errors[k] = e.code; else values[k] = e.value;
    }
  }
  return { values, errors };
}

/** The rules between fields, on the content as it would be saved (current content with the changes applied). */
export function crossFieldErrors(content: Content): FieldErrors {
  const errors: FieldErrors = {};
  const min = content.minimum_check, target = content.target_raise;
  if (typeof min === 'number' && typeof target === 'number' && min > target) errors.minimum_check = 'minimum_exceeds_target';
  return errors;
}

/**
 * What an unfinished draft still lacks, or a fact that release will have to answer for. Never an error: a draft
 * with every warning still saves. Order is stable so a client can diff two answers.
 */
export function readinessWarnings(content: Content, now: Date): string[] {
  const out: string[] = [];
  const missing = (k: ContentKey) => content[k] === undefined || content[k] === null;
  if (missing('title')) out.push('title_missing');
  if (missing('instrument')) out.push('instrument_missing');
  if (missing('currency')) out.push('currency_missing');
  if (missing('target_raise')) out.push('target_raise_missing');
  if (missing('closing_deadline')) out.push('closing_deadline_missing');
  else if (typeof content.closing_deadline === 'string' && isCalendarDay(content.closing_deadline) && deadlinePassed(content.closing_deadline, now)) {
    out.push('closing_deadline_passed');
  }
  return out;
}

/** Applies validated changes to the current content. A null change is kept as null: "not recorded", never deleted. */
export function mergeContent(current: Content, changes: Content): Content {
  return { ...current, ...changes };
}

/** JSON with object keys sorted at every depth, so two equal payloads have one digest whatever their key order. */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).filter((k) => (v as any)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
