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
 * NOT HERE, ON PURPOSE: the logo (there is no image store for logos yet; the
 * field is hidden, not a URL box, until #4201 lands the upload), the internal
 * `/c/<uid>` path, and any sentence about how the app works.
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

/** The form's text fields, by section, as the canvas draws them. Growth keeps the old page's four. */
export const SECTIONS = [
  { key: 'identity', title: 'Identity', line: 'The name members see everywhere.', fields: ['company_name', 'stage'] },
  { key: 'links', title: 'Links', fields: ['website', 'linkedin_url'] },
  { key: 'where', title: 'Where you operate', line: 'Regions are used to match you with investors, advisors and events.', fields: ['international_presence'] },
  { key: 'about', title: 'About', fields: ['description'] },
  { key: 'growth', title: 'Growth', line: 'Used in investor matching and deal analysis.', fields: ['revenue_range', 'employee_count', 'current_products', 'expansion_goals'] },
];
export const LABELS = {
  company_name: 'Company name', stage: 'Stage', website: 'Website', linkedin_url: 'LinkedIn',
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

/** Why the form cannot be saved yet, or null. The name is required; the count is a whole number. */
export function problemOf(form) {
  if (!String(form?.company_name ?? '').trim()) return 'Enter a company name.';
  const n = String(form?.employee_count ?? '').trim();
  if (n && !(Number.isInteger(Number(n)) && Number(n) >= 0)) return 'Employee count is a whole number.';
  if (String(form?.description ?? '').length > DESCRIPTION_MAX) return `The description is at most ${DESCRIPTION_MAX} characters.`;
  return null;
}

/** "1 unsaved change", "3 unsaved changes". */
export const unsavedLine = (patch) => {
  const n = Object.keys(patch || {}).length;
  return n ? `${n} unsaved change${n === 1 ? '' : 's'}` : null;
};

/** Whether this viewer may edit, mirroring the route's `canEdit`, from the row's members. */
export function canEditCompany(row, me) {
  if (String(me?.role || '') === 'admin') return true;
  const mine = (row?.members || []).find((m) => Number(m.user_id) === Number(me?.id));
  return !!(mine && (mine.is_primary_admin || EDIT_ROLES.includes(mine.role_in_company)));
}

/** ST6c: the one line a member who cannot edit sees. A role is said only where it limits. */
export const readOnlyLine = (name) => `Only Owners, Admins and Founders of ${name || 'this company'} can edit these settings.`;
export const LEAVE_PROMPT = 'Leave without saving? Your changes to General will be lost.';
