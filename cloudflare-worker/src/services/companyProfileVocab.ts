/**
 * #4964 — the controlled vocabulary for the company profile's matching fields, and their checks.
 *
 * REGIONS ARE CODES. The General page says regions match a company with investors, advisors and events, but they
 * were one comma-separated free-text column (`international_presence`), so "UK", "United Kingdom" and "uk" were
 * three regions. `company_profiles.region_codes` (migration 202611072325) holds a JSON array of the codes below;
 * `international_presence` stays as optional prose ("notes on where you operate").
 *
 * THE MIGRATION STRATEGY for existing rows is lazy and lossless: a row with no `region_codes` is read with codes
 * DERIVED from its legacy text (`regionCodesOf`, by the aliases below), marked `source: 'derived'`, with every
 * entry no alias matched listed as `unmapped`, so nothing is silently dropped. The first General save that sends
 * `region_codes` stores them; the legacy text is never rewritten.
 *
 * REVENUE IS A BAND. `revenue_range` takes one of `REVENUE_RANGES` when it is written. A stored value outside the
 * list (written before this) is read back as it is and kept until someone changes it.
 *
 * The frontend mirrors both lists (`pages/account/companies/generalFormModel.js`); `company_settings_reads_4964`
 * holds them equal.
 */

export const REGIONS: ReadonlyArray<{ code: string; label: string; aliases: readonly string[] }> = [
  { code: 'global', label: 'Global', aliases: ['global', 'worldwide', 'international'] },
  { code: 'north_america', label: 'North America', aliases: ['north america', 'us', 'usa', 'united states', 'america', 'canada', 'na'] },
  { code: 'latin_america', label: 'Latin America', aliases: ['latin america', 'latam', 'south america', 'central america', 'brazil', 'mexico', 'argentina', 'chile', 'colombia'] },
  { code: 'uk_ireland', label: 'UK and Ireland', aliases: ['uk', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales', 'ireland', 'uk and ireland'] },
  { code: 'europe', label: 'Europe', aliases: ['europe', 'eu', 'emea', 'european union', 'germany', 'france', 'spain', 'italy', 'netherlands', 'nordics', 'dach'] },
  { code: 'middle_east_north_africa', label: 'Middle East and North Africa', aliases: ['mena', 'middle east', 'middle east and north africa', 'uae', 'saudi arabia', 'israel', 'egypt', 'gcc'] },
  { code: 'sub_saharan_africa', label: 'Sub-Saharan Africa', aliases: ['africa', 'sub-saharan africa', 'sub saharan africa', 'nigeria', 'kenya', 'south africa', 'ghana'] },
  { code: 'south_asia', label: 'South Asia', aliases: ['south asia', 'india', 'pakistan', 'bangladesh', 'sri lanka'] },
  { code: 'east_asia', label: 'East Asia', aliases: ['east asia', 'china', 'japan', 'korea', 'south korea', 'hong kong', 'taiwan'] },
  { code: 'southeast_asia', label: 'Southeast Asia', aliases: ['southeast asia', 'south east asia', 'sea', 'asean', 'singapore', 'indonesia', 'vietnam', 'thailand', 'philippines', 'malaysia'] },
  { code: 'oceania', label: 'Oceania', aliases: ['oceania', 'apac', 'australia', 'new zealand', 'anz'] },
];
export const REGION_CODES: readonly string[] = REGIONS.map((r) => r.code);

const ALIAS = new Map<string, string>();
for (const r of REGIONS) { ALIAS.set(r.code, r.code); for (const a of r.aliases) ALIAS.set(a, r.code); }

const key = (s: string) => s.trim().toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ');

/** The codes a legacy comma-separated text names, in list order, and every entry no alias matched. */
export function regionCodesOf(text: string | null | undefined): { codes: string[]; unmapped: string[] } {
  const found = new Set<string>();
  const unmapped: string[] = [];
  for (const raw of String(text ?? '').split(/[,;/\n]/)) {
    const t = raw.trim();
    if (!t) continue;
    const code = ALIAS.get(key(t));
    if (code) found.add(code); else if (!unmapped.includes(t)) unmapped.push(t);
  }
  return { codes: REGION_CODES.filter((c) => found.has(c)), unmapped };
}

/** The stored codes, when the column holds a valid JSON array of known codes; null otherwise. */
export function storedRegionCodes(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const set = new Set(v.filter((x) => typeof x === 'string' && REGION_CODES.includes(x)));
    return REGION_CODES.filter((c) => set.has(c));
  } catch { return null; }
}

/** What a detail serves: the codes, where they came from, and the legacy entries no code covers. */
export function regionsOf(row: { region_codes?: unknown; international_presence?: string | null }) {
  const stored = storedRegionCodes(row.region_codes);
  if (stored) return { codes: stored, source: 'stored' as const, unmapped: [] as string[] };
  const derived = regionCodesOf(row.international_presence);
  return { codes: derived.codes, source: derived.codes.length || derived.unmapped.length ? 'derived' as const : 'none' as const, unmapped: derived.unmapped };
}

/** A PATCH's `region_codes`: an array of known codes (null clears). The stored JSON, or an error. */
export function checkRegionCodes(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw) || raw.length > REGION_CODES.length) return { ok: false };
  if (!raw.every((x) => typeof x === 'string' && REGION_CODES.includes(x))) return { ok: false };
  const set = new Set(raw as string[]);
  const codes = REGION_CODES.filter((c) => set.has(c));
  return { ok: true, value: codes.length ? JSON.stringify(codes) : null };
}

export const REVENUE_RANGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'pre_revenue', label: 'Pre-revenue' },
  { code: 'under_100k', label: 'Under $100k a year' },
  { code: '100k_1m', label: '$100k to $1M a year' },
  { code: '1m_5m', label: '$1M to $5M a year' },
  { code: '5m_20m', label: '$5M to $20M a year' },
  { code: '20m_plus', label: 'Over $20M a year' },
];
export const REVENUE_CODES: readonly string[] = REVENUE_RANGES.map((r) => r.code);

/** A link a member can open: http(s), a host with a dot, at most 2,000 characters. LinkedIn must be on linkedin.com. */
export function checkProfileUrl(raw: unknown, { linkedin = false } = {}): boolean {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (!u.hostname.includes('.')) return false;
  if (linkedin && !(u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com'))) return false;
  return true;
}

export const PROSE_MAX = 500;

export const VOCAB_MESSAGES = {
  region_codes_invalid: 'Choose regions from the list.',
  revenue_range_invalid: 'Choose a revenue range from the list.',
  website_invalid: 'Enter a website address that starts with https:// or http://.',
  linkedin_invalid: 'Enter a LinkedIn address, such as https://www.linkedin.com/company/your-company.',
  employee_count_invalid: 'Employee count is a whole number of zero or more.',
  prose_too_long: `Keep this to ${PROSE_MAX} characters or fewer.`,
} as const;
