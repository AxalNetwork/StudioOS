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

/** The form's text fields, by section, as the canvas draws them. Growth keeps the old page's four. */
export const SECTIONS = [
  { key: 'identity', title: 'Identity', line: 'The name members see everywhere.', fields: ['company_name', 'stage', 'default_currency'] },
  { key: 'links', title: 'Links', fields: ['website', 'linkedin_url'] },
  { key: 'where', title: 'Where you operate', line: 'Regions are used to match you with investors, advisors and events.', fields: ['international_presence'] },
  { key: 'about', title: 'About', fields: ['description'] },
  { key: 'growth', title: 'Growth', line: 'Used in investor matching and deal analysis.', fields: ['revenue_range', 'employee_count', 'current_products', 'expansion_goals'] },
];
export const LABELS = {
  company_name: 'Company name', stage: 'Stage', default_currency: 'Default currency', website: 'Website', linkedin_url: 'LinkedIn',
  international_presence: 'Regions', description: 'Description',
  revenue_range: 'Revenue range', employee_count: 'Employee count', current_products: 'Current products', expansion_goals: 'Expansion goals',
};
export const FIELDS = SECTIONS.flatMap((s) => s.fields);

/** Regions are stored as one comma-separated column; the form edits them as chips. */
export const regionsOf = (v) => String(v ?? '').split(',').map((r) => r.trim()).filter(Boolean);
export const regionsText = (list) => [...new Set((list || []).map((r) => String(r).trim()).filter(Boolean))].join(', ');

/** The form's values from a `GET /company/:uid` row ('' for absent, never "Not recorded" inside a form). */
export function formOf(row) {
  const out = {};
  for (const f of FIELDS) out[f] = row?.[f] == null ? '' : String(row[f]);
  return out;
}

const norm = (f, v) => {
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
    if (next !== was) patch[f] = next;
  }
  return patch;
}

/**
 * The Worker's contract for these fields (D4962, `services/companyProfileFields.ts`), restated so the form can say
 * "no" before the request and say the same thing the Worker would. `test/fixtures/company_field_cases.json` is run
 * by both sides, so the two cannot differ without a case failing.
 */
export const EMPLOYEE_MAX = 1_000_000;
export const LIMITS = { revenue_range: 100, current_products: 1000, expansion_goals: 1000, description: 280, website: 500, linkedin_url: 300 };
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A website the Worker would store (http or https, a dotted host, no credentials), or null. */
export function normalizeWebsite(raw) {
  const t = String(raw ?? '').trim();
  if (!t || /\s/.test(t)) return null;
  let url;
  try { url = new URL(HAS_SCHEME.test(t) ? t : `https://${t}`); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.') || url.hostname.startsWith('.') || url.hostname.endsWith('.')) return null;
  const path = url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search}${url.hash}`;
}

/** A LinkedIn company, school or showcase page, or null. */
export function normalizeLinkedIn(raw) {
  const site = normalizeWebsite(raw);
  if (!site) return null;
  const url = new URL(site);
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const m = url.pathname.match(/^\/(company|school|showcase)\/([^/]+)\/?$/i);
  return m ? `https://${host === 'linkedin.com' ? 'www.linkedin.com' : host}/${m[1].toLowerCase()}/${m[2]}` : null;
}

/** Why the form cannot be saved yet, or null. The name is required; every other field follows the Worker's contract. */
export function problemOf(form) {
  if (!String(form?.company_name ?? '').trim()) return 'Enter a company name.';
  const n = String(form?.employee_count ?? '').trim();
  if (n && !(/^\d{1,7}$/.test(n) && Number(n) <= EMPLOYEE_MAX)) return `Employee count is a whole number from 0 to ${EMPLOYEE_MAX.toLocaleString('en-US')}.`;
  if (String(form?.description ?? '').trim().length > DESCRIPTION_MAX) return `The description is at most ${DESCRIPTION_MAX} characters.`;
  for (const f of ['revenue_range', 'current_products', 'expansion_goals', 'description']) {
    const v = String(form?.[f] ?? '').trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v)) return `${LABELS[f]} contains characters that cannot be saved.`;
    if (f !== 'description' && v.length > LIMITS[f]) return `${LABELS[f]} is at most ${LIMITS[f]} characters.`;
  }
  const site = String(form?.website ?? '').trim();
  if (site && !normalizeWebsite(site)) return 'Enter a web address that starts with http:// or https://.';
  const linked = String(form?.linkedin_url ?? '').trim();
  if (linked && !normalizeLinkedIn(linked)) return 'Enter the address of a LinkedIn company, school or showcase page.';
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

/**
 * Whether this viewer may edit: the server's own answer (D4960), `row.viewer.can_edit`,
 * which the company read returns and the write routes enforce. A cached role decides
 * nothing: an admin is not an editor of a company they hold no seat in. Only a read
 * that carries no `viewer` (an older Worker) falls back to the seat rule, and then
 * without any admin pass.
 */
export function canEditCompany(row, me) {
  if (row?.viewer && typeof row.viewer.can_edit === 'boolean') return row.viewer.can_edit;
  const mine = (row?.members || []).find((m) => Number(m.user_id) === Number(me?.id));
  return !!(mine && (mine.is_primary_admin || EDIT_ROLES.includes(mine.role_in_company)));
}

/** ST6c: the one line a member who cannot edit sees. A role is said only where it limits. */
export const readOnlyLine = (name) => `Only Owners, Admins and Founders of ${name || 'this company'} can edit these settings.`;

/** D4960: the line for each reason the server gives; HQ and a support session are not told to ask an Owner. */
export function readOnlyReasonLine(row) {
  const why = row?.viewer?.read_only_reason;
  if (why === 'hq_access') return 'Read only. HQ reads this company; its members make the changes here.';
  if (why === 'support_session') return 'Read only. A support session can read this company but cannot change it.';
  return readOnlyLine(row?.company_name);
}
export const LEAVE_PROMPT = 'Leave without saving? Your changes to General will be lost.';
