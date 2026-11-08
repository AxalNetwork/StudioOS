/**
 * D4152 (#4152 §5, ST2) — Company settings › General as one form, pure.
 *
 * The form saves through `PATCH /api/company/:uid` (routes/company.ts), which
 * takes any of its updatable columns in one body; only the fields that
 * changed are sent, with one "Save changes". Who may edit is the route's own
 * rule (`canEdit`: a platform admin, the primary admin, or an Owner, Admin or
 * Founder), mirrored here only to draw the fields disabled — the Worker
 * decides.
 *
 * THE LOGO (#4201, ST2/ST2b/ST2c) is not a text field: it is a tile with
 * Replace and Remove over `POST`/`DELETE /api/company/:uid/logo` (R2
 * `COMPANY_LOGOS`). A picked or removed logo is held as a pending change and
 * saved with the form's one Save, like the fields; `logoProblem` checks a
 * file before it is held (the Worker checks the bytes again).
 *
 * NOT HERE, ON PURPOSE: a "paste a URL" box, the internal `/c/<uid>` path, and
 * any sentence about how the app works.
 */

export const EDIT_ROLES = ['Owner', 'Admin', 'Founder'];
export const DESCRIPTION_MAX = 280;

/** The route's stage values, in its order (the old page's list). */
export const STAGES = [
  ['', 'Not set'],
  ['idea', 'Idea'],
  ['pre_seed', 'Pre-seed'],
  ['seed', 'Seed'],
  ['series_a', 'Series A'],
  ['series_b', 'Series B'],
  ['series_c_plus', 'Series C+'],
  ['growth', 'Growth'],
  ['profitable', 'Profitable'],
  ['public', 'Public'],
];

/**
 * The currencies the Worker accepts for `default_currency` (#3932, `services/currencies.ts` `ISO_4217_CODES`, the
 * active ISO 4217 codes; a test keeps the two lists equal). An unrecorded currency is the empty choice, "Not
 * recorded", never a guessed USD (#4736).
 */
export const CURRENCY_CODES = Object.freeze([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR',
  'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL',
  'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
  'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD',
  'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX',
  'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XCG', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG',
]);

/**
 * #4964: the matching vocabulary, mirroring `cloudflare-worker/src/services/companyProfileVocab.ts` (a test keeps
 * the codes equal). Regions are canonical codes (`region_codes`); revenue is a band.
 */
export const REGIONS = Object.freeze([
  ['global', 'Global'], ['north_america', 'North America'], ['latin_america', 'Latin America'], ['uk_ireland', 'UK and Ireland'],
  ['europe', 'Europe'], ['middle_east_north_africa', 'Middle East and North Africa'], ['sub_saharan_africa', 'Sub-Saharan Africa'],
  ['south_asia', 'South Asia'], ['east_asia', 'East Asia'], ['southeast_asia', 'Southeast Asia'], ['oceania', 'Oceania'],
]);
export const REGION_CODES = Object.freeze(REGIONS.map(([c]) => c));
export const regionLabel = (code) => (REGIONS.find(([c]) => c === code) || [null, code])[1];
export const REVENUE_RANGES = Object.freeze([
  ['pre_revenue', 'Pre-revenue'], ['under_100k', 'Under $100k a year'], ['100k_1m', '$100k to $1M a year'],
  ['1m_5m', '$1M to $5M a year'], ['5m_20m', '$5M to $20M a year'], ['20m_plus', 'Over $20M a year'],
]);
export const PROSE_MAX = 500;

/** The form's fields, by section, as the canvas draws them. Growth keeps the old page's four. */
export const SECTIONS = [
  { key: 'identity', title: 'Identity', line: 'The name members see everywhere.', fields: ['company_name', 'stage', 'default_currency'] },
  { key: 'links', title: 'Links', fields: ['website', 'linkedin_url'] },
  { key: 'where', title: 'Where you operate', line: 'Regions are used to match you with investors, advisors and events.', fields: ['region_codes', 'international_presence'] },
  { key: 'about', title: 'About', fields: ['description'] },
  { key: 'growth', title: 'Growth', line: 'Used in investor matching and deal analysis.', fields: ['revenue_range', 'employee_count', 'current_products', 'expansion_goals'] },
];
export const LABELS = {
  company_name: 'Company name', stage: 'Stage', default_currency: 'Default currency', website: 'Website', linkedin_url: 'LinkedIn',
  region_codes: 'Regions', international_presence: 'Notes on where you operate', description: 'Description',
  revenue_range: 'Revenue range', employee_count: 'Employee count', current_products: 'Current products', expansion_goals: 'Expansion goals',
};
export const FIELDS = SECTIONS.flatMap((s) => s.fields);

/** Regions are stored as one comma-separated column; the form edits them as chips. */
export const regionsOf = (v) => String(v ?? '').split(',').map((r) => r.trim()).filter(Boolean);
export const regionsText = (list) => [...new Set((list || []).map((r) => String(r).trim()).filter(Boolean))].join(', ');

/** Known codes, in the list's order, without repeats. */
export const regionCodesIn = (v) => {
  const set = new Set(Array.isArray(v) ? v.map(String) : []);
  return REGION_CODES.filter((c) => set.has(c));
};

/** The form's values from a `GET /company/:uid` row ('' for absent, never "Not recorded" inside a form; codes as a list). */
export function formOf(row) {
  const out = {};
  for (const f of FIELDS) out[f] = f === 'region_codes' ? regionCodesIn(row?.region_codes) : row?.[f] == null ? '' : String(row[f]);
  return out;
}

const norm = (f, v) => {
  if (f === 'region_codes') { const c = regionCodesIn(v); return c.length ? c.join(',') : null; }
  const t = String(v ?? '').trim();
  if (f === 'employee_count') return t === '' ? null : Number(t);
  if (f === 'international_presence') return regionsText(regionsOf(t)) || null;
  if (f === 'default_currency') return t === '' ? null : t.toUpperCase();
  return t === '' ? null : t;
};

/** Only what changed, as the route takes it (trimmed; an empty field is null). */
export function changes(form, row) {
  const patch = {};
  for (const f of FIELDS) {
    const next = norm(f, form?.[f]);
    const was = norm(f, row?.[f]);
    if (next !== was) patch[f] = f === 'region_codes' ? regionCodesIn(form?.[f]) : next;
  }
  return patch;
}

// ── Concurrency (#4963) ─────────────────────────────────────────────────────

/** The refusal code a stale save answers with; its body carries `company`, the current detail. */
export const VERSION_CONFLICT = 'version_conflict';

/** The token a save sends back: the `profile_version` this form loaded, or undefined for a row that has none. */
export const versionOf = (row) => (Number.isSafeInteger(row?.profile_version) && row.profile_version > 0 ? row.profile_version : undefined);

/**
 * After a 409: the form rebuilt on the CURRENT company. Every value the other editor committed is kept. This editor's
 * edits to fields nobody else changed are re-applied on top, so they are not lost; an edit to a field the other editor
 * also changed is replaced by their committed value and named in `conflicts`, for this editor to review and redo.
 */
export function rebaseOnConflict(form, loadedRow, currentRow) {
  const mine = changes(form, loadedRow);
  const theirs = changes(formOf(currentRow), loadedRow);
  const next = formOf(currentRow);
  const conflicts = [];
  for (const f of Object.keys(mine)) {
    if (f in theirs) { if (norm(f, form[f]) !== norm(f, currentRow?.[f])) conflicts.push(f); }
    else next[f] = form[f];
  }
  return { form: next, conflicts };
}

/** The line a conflicted save shows. */
export function conflictLine(conflicts) {
  const named = (conflicts || []).map((f) => LABELS[f] || f);
  if (!named.length) return 'Someone else saved changes first. Their values are shown and your other changes are kept; review and save again.';
  return `Someone else saved changes first. Your edit${named.length === 1 ? '' : 's'} to ${named.join(', ')} ${named.length === 1 ? 'was' : 'were'} replaced by their saved value; your other changes are kept. Review and save again.`;
}

/** ST6c for an archived company: nothing here can change until it is restored (#4963, the Worker's rule). */
export const archivedLine = (name) => `${name || 'This company'} is archived. Restore it before you change its settings.`;

/** A link a member can open, as the Worker checks it (`checkProfileUrl`). */
export function profileUrlOk(v, { linkedin = false } = {}) {
  let u;
  try { u = new URL(String(v).trim()); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (!u.hostname.includes('.')) return false;
  return !linkedin || u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com');
}

/**
 * Why the form cannot be saved yet, or null. The name is required; the count is a whole number. With the loaded row,
 * a CHANGED link must be one a member can open and changed prose fits; a value written before these rules is left alone.
 */
export function problemOf(form, row = null) {
  if (!String(form?.company_name ?? '').trim()) return 'Enter a company name.';
  const n = String(form?.employee_count ?? '').trim();
  if (n && !(Number.isInteger(Number(n)) && Number(n) >= 0)) return 'Employee count is a whole number.';
  if (String(form?.description ?? '').length > DESCRIPTION_MAX) return `The description is at most ${DESCRIPTION_MAX} characters.`;
  if (row) {
    const changed = changes(form, row);
    if (changed.website && !profileUrlOk(changed.website)) return 'Enter a website address that starts with https:// or http://.';
    if (changed.linkedin_url && !profileUrlOk(changed.linkedin_url, { linkedin: true })) return 'Enter a LinkedIn address, such as https://www.linkedin.com/company/your-company.';
    for (const f of ['current_products', 'expansion_goals', 'international_presence']) {
      if (typeof changed[f] === 'string' && changed[f].length > PROSE_MAX) return `${LABELS[f]} is at most ${PROSE_MAX} characters.`;
    }
  }
  return null;
}

/** "1 unsaved change", "3 unsaved changes". A pending logo counts as one change. */
export const unsavedLine = (patch, logo = null) => {
  const n = Object.keys(patch || {}).length + (logo ? 1 : 0);
  return n ? `${n} unsaved change${n === 1 ? '' : 's'}` : null;
};

// ── The logo tile (#4201, ST2) ────────────────────────────────────────────────

export const LOGO_HINT = 'PNG or SVG, square, up to 2 MB. Drop a file on the tile.';
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(['image/png', 'image/svg+xml']);

/** Why a picked file cannot be held as the logo, or null. Shape and SVG safety are the Worker's to judge. */
export function logoProblem(file) {
  if (!file) return 'Choose a PNG or SVG file.';
  const named = String(file.name || '').toLowerCase();
  const typed = LOGO_TYPES.has(String(file.type || '').toLowerCase()) || /\.(png|svg)$/.test(named);
  if (!typed) return 'The logo must be a PNG or SVG file.';
  if (!(Number(file.size) > 0)) return 'That file is empty.';
  if (Number(file.size) > LOGO_MAX_BYTES) return 'The logo must be 2 MB or smaller.';
  return null;
}

/**
 * What the tile and the preview draw: the pending logo when one is held
 * (`{ upload: File, preview }` or `{ remove: true }`), else the row's own.
 */
export function shownLogo(row, pending) {
  if (pending?.remove) return null;
  if (pending?.upload) return pending.preview || null;
  return row?.logo_url || null;
}

/** Whether this viewer may edit, mirroring the route's `canEdit`, from the row's members. */
export function canEditCompany(row, me) {
  if (String(me?.role || '') === 'admin') return true;
  const mine = (row?.members || []).find((m) => Number(m.user_id) === Number(me?.id));
  return !!(mine && (mine.is_primary_admin || EDIT_ROLES.includes(mine.role_in_company)));
}

/** ST6c: the one line a member who cannot edit sees. A role is said only where it limits. */
export const readOnlyLine = (name) => `Only Owners, Admins and Founders of ${name || 'this company'} can edit these settings.`;
export const LEAVE_PROMPT = 'Leave without saving? Your changes to General will be lost.';
