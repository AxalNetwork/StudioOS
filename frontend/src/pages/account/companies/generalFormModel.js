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

/**
 * D4966 (#5312, boards CS-01 to CS-05): the form's fields in the canvas's FOUR
 * INTENT GROUPS, each with the one line that says what it affects. The five
 * groups before it (Identity, Links, Where you operate, About, Growth) named
 * the shape of the data; these name what changing a field does, which is the
 * question a member actually has. Every field is in exactly one group, and the
 * set is the same set: `FIELDS` is still the form's whole contract.
 */
export const SECTIONS = [
  {
    key: 'identity',
    title: 'Company identity',
    line: 'Used across StudioOS and when interpreting company financial data.',
    fields: ['company_name', 'stage', 'default_currency'],
  },
  {
    key: 'presence',
    title: 'Public presence',
    line: 'How members and StudioOS surfaces understand and present your company.',
    fields: ['website', 'linkedin_url', 'description'],
  },
  {
    key: 'matching',
    title: 'Matching profile',
    line: 'Used to improve matching with investors, advisors, opportunities and events. It narrows suggestions; it doesn’t guarantee them.',
    fields: ['region_codes', 'international_presence', 'revenue_range'],
  },
  {
    key: 'snapshot',
    title: 'Business snapshot',
    line: 'Business context used in fundraising, matching and company analysis where supported. Private to your company.',
    fields: ['employee_count', 'current_products', 'expansion_goals'],
  },
];

/** The short word under a field, from the canvas. A field with none gets none; nothing is invented. */
export const FIELD_HINT = Object.freeze({
  company_name: 'Shown everywhere',
  employee_count: 'Whole number',
  revenue_range: 'Private to your company',
});

/** The sentence beside a field, from the canvas. */
export const FIELD_HELP = Object.freeze({
  default_currency: 'How amounts are read for this company. Never guessed.',
  description: 'One or two sentences: what you make and for whom.',
  current_products: 'One per line.',
  expansion_goals: 'What you want to do next, one per line.',
});
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
  // D4961: compared as the Worker stores them, so "northwind.example" and the stored "https://northwind.example" are the same value.
  if (f === 'website') return t === '' ? null : (normalizeWebsite(t) ?? t);
  if (f === 'linkedin_url') return t === '' ? null : (normalizeLinkedIn(t) ?? t);
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

/** A link a member can open, as the Worker checks it (`checkProfileUrl`). Kept for the conflict tests. */
export function profileUrlOk(v, { linkedin = false } = {}) {
  let u;
  try { u = new URL(String(v).trim()); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (!u.hostname.includes('.')) return false;
  return !linkedin || u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com');
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

/**
 * Why the form cannot be saved yet, or null. The name is required; every other field follows the Worker's contract
 * (D4962). With the loaded row, a value written before these rules is left alone (#4964): only a CHANGED link, a
 * changed count and changed prose are checked, and prose the editor is typing is capped at PROSE_MAX.
 */
export function fieldProblems(form, row = null) {
  const out = [];
  const add = (field, message) => out.push({ field, message });
  if (!String(form?.company_name ?? '').trim()) add('company_name', 'Enter a company name.');
  const n = String(form?.employee_count ?? '').trim();
  if (n && !(/^\d{1,7}$/.test(n) && Number(n) <= EMPLOYEE_MAX)) add('employee_count', `Employee count is a whole number from 0 to ${EMPLOYEE_MAX.toLocaleString('en-US')}.`);
  if (String(form?.description ?? '').trim().length > DESCRIPTION_MAX) add('description', `The description is at most ${DESCRIPTION_MAX} characters.`);
  const changed = row ? changes(form, row) : null;
  const check = (f) => !changed || f in changed;
  for (const f of ['revenue_range', 'current_products', 'expansion_goals', 'description']) {
    if (!check(f)) continue;
    const v = String(form?.[f] ?? '').trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v)) { add(f, `${LABELS[f]} contains characters that cannot be saved.`); continue; }
    const cap = f === 'description' ? DESCRIPTION_MAX : (changed ? Math.min(LIMITS[f], PROSE_MAX) : LIMITS[f]);
    if (f !== 'description' && v.length > cap) add(f, `${LABELS[f]} is at most ${cap} characters.`);
  }
  if (check('website')) {
    const site = String(form?.website ?? '').trim();
    if (site && !normalizeWebsite(site)) add('website', 'Enter a web address that starts with http:// or https://.');
  }
  if (check('linkedin_url')) {
    const linked = String(form?.linkedin_url ?? '').trim();
    if (linked && !normalizeLinkedIn(linked)) add('linkedin_url', 'Enter the address of a LinkedIn company, school or showcase page.');
  }
  // One problem per field: the first thing wrong with it is what the field says.
  return out.filter((p, i) => out.findIndex((q) => q.field === p.field) === i);
}

/**
 * Why the form cannot be saved yet, or null: the FIRST of `fieldProblems`. The
 * two cannot diverge, because this reads that (D4966's summary links to every
 * one; the save bar still says one).
 */
export function problemOf(form, row = null) {
  return fieldProblems(form, row)[0]?.message ?? null;
}

/** How many unsaved changes there are. A pending logo counts as one. The one place this rule lives. */
export const changeCount = (patch, logo = null) => Object.keys(patch || {}).length + (logo ? 1 : 0);

/** "1 unsaved change", "3 unsaved changes". D4966's rail says it its own way (`railStatus`), from the same count. */
export const unsavedLine = (patch, logo = null) => {
  const n = changeCount(patch, logo);
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

// ── One Save, one recoverable operation (D4961) ───────────────────────────────

/**
 * What one click on Save means: the changed fields and the pending logo, together. The Worker takes them as one
 * request (`POST /company/:uid/settings`) and commits them as one, so a logo can no longer commit while the fields
 * fail. This is the intent a failed or uncertain save is judged against.
 */
export function saveIntent(patch, logo) {
  return {
    fields: patch || {},
    logo: logo?.upload || null,
    remove: Boolean(logo?.remove),
  };
}

export const hasIntent = (intent) => Object.keys(intent?.fields || {}).length > 0 || Boolean(intent?.logo) || Boolean(intent?.remove);

const storedLogo = (uid, url) => typeof url === 'string' && url.startsWith(`/api/company/${encodeURIComponent(uid)}/logo?v=`);

/**
 * What a re-read of the company says about an intent. `before` is the company as the form last held it. Never
 * "saved" unless every part of the intent is in the row:
 *   - each field equals what was asked, compared as the Worker stores it;
 *   - an upload: the row's logo is a stored one and is not the one that was there before;
 *   - a removal: the row has no logo.
 * `none` committed means "not saved" and a retry is safe; `some` is a partial commit, said specifically; `all` is saved.
 */
export function reconcile(row, intent, before, uid) {
  const fields = Object.keys(intent?.fields || {});
  const fieldDone = fields.filter((f) => norm(f, row?.[f]) === norm(f, intent.fields[f]));
  let logoDone = null;
  if (intent?.logo) logoDone = storedLogo(uid, row?.logo_url) && row.logo_url !== (before?.logo_url ?? null);
  else if (intent?.remove) logoDone = (row?.logo_url ?? null) === null;
  const parts = fields.length + (logoDone === null ? 0 : 1);
  const done = fieldDone.length + (logoDone ? 1 : 0);
  return {
    outcome: parts === 0 || done === parts ? 'all' : done === 0 ? 'none' : 'some',
    fieldsSaved: fieldDone,
    fieldsLeft: fields.filter((f) => !fieldDone.includes(f)),
    logoSaved: logoDone === true,
    logoLeft: logoDone === false,
  };
}

/** A failure the Worker answered with a 4xx did not write anything (it checks everything first). No answer, or a 5xx, may have. */
export const failedBeforeWriting = (e) => Number.isInteger(e?.status) && e.status >= 400 && e.status < 500;

const label = (f) => (LABELS[f] || f).toLowerCase();

/**
 * The sentence for a settled save. `kind`: 'saved' | 'saved_after_check' | 'not_saved' | 'partly' | 'unknown'.
 * "Not saved" is said only when a re-read (or a 4xx) shows nothing committed; an unconfirmed outcome says so.
 */
export function saveLine(kind, { detail = '', result = null } = {}) {
  const tail = detail ? ` ${detail}` : '';
  switch (kind) {
    case 'saved': return 'Saved · just now';
    case 'saved_after_check': return 'Saved. The answer did not arrive, so we checked: your changes are in.';
    case 'not_saved': return `Your changes were not saved. Nothing was changed; they are still here to try again.${tail}`;
    case 'partly': {
      const done = [...(result?.fieldsSaved || []).map(label), ...(result?.logoSaved ? ['the logo'] : [])];
      const left = [...(result?.fieldsLeft || []).map(label), ...(result?.logoLeft ? ['the logo'] : [])];
      return `Part of your changes saved: ${done.join(', ') || 'nothing'}. Not saved yet: ${left.join(', ')}. They are still here to try again.`;
    }
    default: return 'We could not confirm whether your changes saved. They are still here; Try again checks first, then saves only what is missing.';
  }
}

// ── D4966 (#5312): the public-only preview, the save rail, and the fields ────

/**
 * What the preview may show: the Worker's own `PUBLIC_FIELDS`
 * (`cloudflare-worker/src/routes/company.ts`), which is what a member who is
 * not in this company is served. `region_codes` is the reading of the public
 * `international_presence` column, so it belongs here too.
 *
 * Everything in `PREVIEW_NEVER` is on the company's DETAIL read only — it
 * reaches this member because they can edit the company, and it must not be
 * drawn as "how your company appears". Revenue, employees, products and goals
 * are the canvas's named four; the default currency is detail-only too.
 */
export const PREVIEW_PUBLIC = Object.freeze([
  'company_name', 'stage', 'logo_url', 'website', 'linkedin_url', 'description', 'international_presence', 'region_codes',
]);
export const PREVIEW_NEVER = Object.freeze(['revenue_range', 'employee_count', 'current_products', 'expansion_goals', 'default_currency']);

/**
 * A stage's own label, or null when none is recorded. The picker's own empty
 * choice reads "Not set", which is right inside a form; the preview must say
 * "not recorded" instead, so an absent stage answers null here.
 */
export const stageLabel = (v) => {
  const k = String(v ?? '');
  return k ? (STAGES.find(([code]) => code === k) || [null, null])[1] : null;
};

/**
 * The preview, from the form over the row: the public fields only, each as the
 * platform would show it, plus whether what is drawn includes unsaved changes.
 * A field with no value is null — "not recorded" — and never a placeholder the
 * company did not write.
 */
export function previewOf(row, form = null, logo = null, patch = null) {
  const value = (f) => (form && f in form ? form[f] : row?.[f]);
  const text = (f) => { const t = String(value(f) ?? '').trim(); return t || null; };
  const dirty = Object.keys(patch || {}).filter((f) => PREVIEW_PUBLIC.includes(f));
  return {
    name: text('company_name'),
    stage: stageLabel(value('stage')) || null,
    regions: regionCodesIn(value('region_codes')).map(regionLabel),
    description: text('description'),
    website: normalizeWebsite(text('website')),
    linkedin: normalizeLinkedIn(text('linkedin_url')),
    logo: shownLogo(row, logo),
    // A pending logo is an unsaved change the preview is already drawing.
    unsaved: dirty.length > 0 || Boolean(logo),
  };
}
export const PREVIEW_UNSAVED = 'Includes unsaved changes';
export const PREVIEW_TITLE = 'Preview — how your company appears across StudioOS';

/** "last saved 7 Nov, 18:42", from the row's own `updated_at`. An unreadable stamp is left out, never guessed. */
export function savedAtText(row) {
  const raw = row?.updated_at ?? null;
  if (!raw) return null;
  const at = new Date(String(raw).includes('T') ? raw : String(raw).replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return null;
  try {
    return at.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  } catch { return at.toISOString().slice(0, 16).replace('T', ' '); }
}

/**
 * D4966's twelve-state rail (board CS-12): the one line the status region says,
 * and how it is announced. The states are checked in the order the canvas puts
 * them: what the server last told us wins over what the form is doing, and a
 * read-only or archived company has no save state at all.
 *
 * `state` is one of: read_only, archived, conflict, unknown, partly, failed,
 * invalid, saving, checking, saved, dirty, clean.
 */
export function railStatus({
  canEdit = true, archived = false, row = null, status = 'idle', message = '', problems = [], patch = {}, logo = null,
} = {}) {
  const line = (state, text, announce) => ({ state, line: text, announce });
  if (archived) return line('archived', 'Archived · restore to edit', 'none');
  if (!canEdit) return line('read_only', `Read-only · ${readOnlyReasonLine(row)}`, 'none');
  if (status === 'conflict') return line('conflict', message || 'Newer company data exists', 'assertive');
  if (status === 'unknown') return line('unknown', message || 'Checking save outcome…', 'polite');
  if (status === 'partly') return line('partly', message || 'Some changes still need attention', 'assertive');
  if (status === 'error') return line('failed', message || 'Save failed', 'assertive');
  if (status === 'saving') return line('saving', 'Saving…', 'polite');
  if (status === 'reconciling') return line('checking', message || 'Checking save outcome…', 'polite');
  const bad = (problems || []).length;
  if (bad) return line('invalid', `Fix ${bad} field${bad === 1 ? '' : 's'}`, 'assertive');
  if (status === 'saved') return line('saved', message || 'Saved · just now', 'polite');
  const n = changeCount(patch, logo);
  if (n) return line('dirty', `Unsaved changes · ${n} field${n === 1 ? '' : 's'}`, 'polite');
  const at = savedAtText(row);
  return line('clean', at ? `All changes saved · last saved ${at}` : 'All changes saved', 'none');
}

// ── The currency combobox (board CS-06) ─────────────────────────────────────

/** The ones a member is most likely to want, as a fixed list. "Recent" would need a stored history nobody keeps. */
export const COMMON_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SGD', 'INR', 'BRL']);
export const CURRENCY_NONE = 'Not recorded';

/** A code's own name, from the platform's locale data. A code the runtime does not name is its code, never a guess. */
export function currencyName(code) {
  const c = String(code ?? '').toUpperCase();
  if (!c) return '';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(c);
    return name && name.toUpperCase() !== c ? name : '';
  } catch { return ''; }
}

/** `USD · US Dollar`, or just the code when the runtime names none. */
export function currencyLabel(code) {
  const name = currencyName(code);
  return name ? `${String(code).toUpperCase()} · ${name}` : String(code ?? '').toUpperCase();
}

/**
 * The codes a search matches, by code or by name, in the list's own order: the
 * common ones first when the query is empty, every matching code otherwise.
 * `stored` is the company's current code, which is always offered even when it
 * is not on the list, so a stored value can never be dropped by searching.
 */
export function currencyMatches(query, { stored = '', limit = 30 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const all = CURRENCY_CODES.includes(String(stored).toUpperCase())
    ? CURRENCY_CODES
    : [...(String(stored).toUpperCase() ? [String(stored).toUpperCase()] : []), ...CURRENCY_CODES];
  if (!q) {
    const common = COMMON_CURRENCIES.filter((c) => all.includes(c));
    return [...new Set([...(String(stored).toUpperCase() ? [String(stored).toUpperCase()] : []), ...common])].slice(0, limit);
  }
  return all.filter((c) => c.toLowerCase().includes(q) || currencyName(c).toLowerCase().includes(q)).slice(0, limit);
}

// ── URL fields (board CS-09) ────────────────────────────────────────────────

/** The link the field offers to open: the address as it would be SAVED, or null when it is not one yet. */
export function openableUrl(field, raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  return field === 'linkedin_url' ? normalizeLinkedIn(t) : field === 'website' ? normalizeWebsite(t) : null;
}

/** "Will be saved as https://…", when what will be stored differs from what was typed. Null when it does not. */
export function normalisedHint(field, raw) {
  const t = String(raw ?? '').trim();
  const url = openableUrl(field, t);
  return url && url !== t ? `Will be saved as ${url}` : null;
}

export const LINKEDIN_HINT = 'A company, school or showcase page: linkedin.com/company/…';

/** `118 / 280`, and whether the description is near or over its limit. Never a count of a field nobody typed in. */
export function descriptionCount(v, max = DESCRIPTION_MAX) {
  const n = String(v ?? '').length;
  return { text: `${n} / ${max}`, near: n >= max - 40 && n <= max, over: n > max };
}
