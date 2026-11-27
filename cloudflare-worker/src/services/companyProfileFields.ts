/**
 * D4962 — what a company's General fields may hold, in one place.
 *
 * `PATCH /company/:uid` and `POST /company/create` used to write most of these
 * as supplied, so a direct request could persist an unsupported stage, a
 * negative head count, an unbounded string, a `javascript:` website, or an
 * arbitrary remote logo URL that skipped the hardened R2 upload route.
 *
 * `validateCompanyFields(body)` takes the body's General fields and returns
 * either the values to store (trimmed, an empty string or null cleared to
 * null, URLs and regions in their canonical form) or the first refusal as
 * `{ code, field, detail }`. `company_name` and `default_currency` keep their
 * own checks in the route (their codes and statuses are older than this file).
 *
 * The cases both sides must agree on live in `test/fixtures/company_field_cases.json`,
 * read by the Worker test, the frontend model's test and the dev backend's, so
 * the three cannot drift apart without a test saying which case differs.
 *
 * WHAT IS NOT INVENTED. `revenue_range` has no vocabulary anywhere in the app
 * (the page says "e.g. $1M–$5M ARR"), so it is bounded text, not an enum.
 */

export const STAGES = ['idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c_plus', 'growth', 'profitable', 'public'] as const;
export const LIMITS = {
  revenue_range: 100,
  current_products: 1000,
  expansion_goals: 1000,
  description: 280,
  website: 500,
  linkedin_url: 300,
  region: 80,
  regions: 30,
  employee_count: 1_000_000,
} as const;

/** The General fields a company PATCH may carry. Anything else is refused, not ignored. */
export const GENERAL_FIELDS = [
  'company_name', 'stage', 'revenue_range', 'employee_count', 'current_products', 'international_presence',
  'expansion_goals', 'website', 'linkedin_url', 'description', 'default_currency',
] as const;

export type FieldRefusal = { code: string; field: string; detail: string };
export type FieldsResult = { ok: true; values: Record<string, string | number | null> } | ({ ok: false } & FieldRefusal);

const refuse = (code: string, field: string, detail: string): FieldsResult => ({ ok: false, code, field, detail });

// Control characters other than tab and newline, which a long text may hold.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** A bounded string: trimmed; empty is null; the length is characters, not bytes. */
function text(field: keyof typeof LIMITS, value: unknown, label: string): FieldsResult | { value: string | null } {
  if (value === null) return { value: null };
  if (typeof value !== 'string') return refuse(`${field}_invalid`, field, `${label} must be text.`);
  const t = value.trim();
  if (CONTROL.test(t)) return refuse(`${field}_invalid`, field, `${label} contains characters that cannot be stored.`);
  if (t.length > LIMITS[field]) return refuse(`${field}_too_long`, field, `${label} is at most ${LIMITS[field]} characters.`);
  return { value: t === '' ? null : t };
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A website: http or https, a host with a dot, no credentials. A bare host
 * ("northwind.example") gets https; a trailing slash on a bare host is dropped.
 */
export function normalizeWebsite(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  let url: URL;
  // A scheme-looking prefix is parsed as written (and refused unless it is http or https); a bare host gets https.
  try { url = new URL(HAS_SCHEME.test(t) ? t : `https://${t}`); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.') || url.hostname.startsWith('.') || url.hostname.endsWith('.')) return null;
  const path = url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search}${url.hash}`;
}

/** A LinkedIn company, school or showcase page, on linkedin.com or one of its country hosts, as https. */
export function normalizeLinkedIn(raw: string): string | null {
  const site = normalizeWebsite(raw);
  if (!site) return null;
  const url = new URL(site);
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const m = url.pathname.match(/^\/(company|school|showcase)\/([^/]+)\/?$/i);
  if (!m) return null;
  return `https://${host === 'linkedin.com' ? 'www.linkedin.com' : host}/${m[1].toLowerCase()}/${m[2]}`;
}

/** Regions as the column keeps them: trimmed, de-duplicated (case-blind, first spelling kept), joined by ", ". */
export function normalizeRegions(value: unknown): { value: string | null } | FieldRefusal {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!parts) return { code: 'international_presence_invalid', field: 'international_presence', detail: 'Regions must be a list of names.' };
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') return { code: 'international_presence_invalid', field: 'international_presence', detail: 'Regions must be a list of names.' };
    const r = p.replace(/\s+/g, ' ').trim();
    if (!r) continue;
    if (CONTROL.test(r) || r.includes(',')) return { code: 'international_presence_invalid', field: 'international_presence', detail: 'A region name cannot contain a comma or control characters.' };
    if (r.length > LIMITS.region) return { code: 'international_presence_invalid', field: 'international_presence', detail: `A region name is at most ${LIMITS.region} characters.` };
    if (seen.has(r.toLowerCase())) continue;
    seen.add(r.toLowerCase()); out.push(r);
  }
  if (out.length > LIMITS.regions) return { code: 'international_presence_invalid', field: 'international_presence', detail: `At most ${LIMITS.regions} regions.` };
  return { value: out.length ? out.join(', ') : null };
}

/** A whole number from 0 to `LIMITS.employee_count`, or null. A digits-only string is read as that number. */
function headCount(value: unknown): { value: number | null } | FieldRefusal {
  if (value === null || value === '') return { value: null };
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,7}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > LIMITS.employee_count) {
    return { code: 'employee_count_invalid', field: 'employee_count', detail: `Employee count is a whole number from 0 to ${LIMITS.employee_count.toLocaleString('en-US')}.` };
  }
  return { value: n };
}

const isRefusal = (x: unknown): x is FieldRefusal => !!x && typeof x === 'object' && 'code' in (x as object);

/**
 * Validates the General fields present in `body`; fields absent stay absent.
 * `allowed` is the set the caller accepts (the PATCH list, or create's).
 * `logo_url` is never writable here: the logo has its own route.
 */
export function validateCompanyFields(body: unknown, allowed: readonly string[] = GENERAL_FIELDS): FieldsResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('body_invalid', '', 'Send the fields as a JSON object.');
  const b = body as Record<string, unknown>;
  if ('logo_url' in b) return refuse('logo_url_not_writable', 'logo_url', 'A logo is changed by uploading or removing it (POST or DELETE /company/:uid/logo), not by setting a link.');
  const unknown = Object.keys(b).filter((k) => !allowed.includes(k));
  if (unknown.length) return refuse('unknown_field', unknown[0], `Not a company field: ${unknown.slice(0, 5).join(', ')}.`);
  const values: Record<string, string | number | null> = {};
  for (const f of allowed) {
    if (!(f in b) || b[f] === undefined) continue;
    const v = b[f];
    if (f === 'company_name' || f === 'default_currency') continue; // the route's own checks
    if (f === 'stage') {
      if (v === null || v === '') { values.stage = null; continue; }
      if (typeof v !== 'string' || !(STAGES as readonly string[]).includes(v)) return refuse('stage_invalid', 'stage', `Stage is one of: ${STAGES.join(', ')}.`);
      values.stage = v; continue;
    }
    if (f === 'employee_count') {
      const r = headCount(v);
      if (isRefusal(r)) return { ok: false, ...r };
      values.employee_count = r.value; continue;
    }
    if (f === 'international_presence') {
      const r = normalizeRegions(v);
      if (isRefusal(r)) return { ok: false, ...r };
      values.international_presence = r.value; continue;
    }
    if (f === 'website' || f === 'linkedin_url') {
      const r = text(f, v, f === 'website' ? 'The website' : 'The LinkedIn address');
      if ('ok' in r) return r;
      if (r.value == null) { values[f] = null; continue; }
      const url = f === 'website' ? normalizeWebsite(r.value) : normalizeLinkedIn(r.value);
      if (!url) {
        return refuse(`${f}_invalid`, f, f === 'website'
          ? 'Enter a web address that starts with http:// or https:// (https is assumed when it is left off).'
          : 'Enter the address of a LinkedIn company, school or showcase page, such as linkedin.com/company/your-company.');
      }
      if (url.length > LIMITS[f]) return refuse(`${f}_too_long`, f, `The address is at most ${LIMITS[f]} characters.`);
      values[f] = url; continue;
    }
    const label = ({ revenue_range: 'Revenue range', current_products: 'Current products', expansion_goals: 'Expansion goals', description: 'The description' } as Record<string, string>)[f];
    if (!label) continue;
    const r = text(f as keyof typeof LIMITS, v, label);
    if ('ok' in r) return r;
    values[f] = r.value;
  }
  return { ok: true, values };
}
