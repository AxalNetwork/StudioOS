/**
 * D1415 (#3697, part 1) — a company as a legal entity. Mounted at /api beside
 * `company_lifecycle.ts`, before `company.ts`.
 *
 *   GET  /api/company/:uid/legal                       — member
 *   PUT  /api/company/:uid/legal                       — editor; partial, null clears
 *   GET  /api/company/:uid/tax-id[?full=1]             — member; the number only to an editor who is not an admin
 *   PUT  /api/company/:uid/tax-id                      — editor or admin; { kind, tax_id }
 *   GET  /api/company/:uid/officers                    — member
 *   POST /api/company/:uid/officers                    — editor
 *   PATCH /api/company/:uid/officers/:officerUid       — editor
 *   POST /api/company/:uid/officers/:officerUid/cease  — editor; { ceased_on? }
 *   GET  /api/company/:uid/locations                   — member
 *   POST /api/company/:uid/locations                   — editor
 *   PATCH /api/company/:uid/locations/:locUid          — editor
 *   POST /api/company/:uid/locations/:locUid/close     — editor; { closed_on? }
 *   PUT  /api/company/:uid/slug                        — editor; { slug }
 *
 * WHO. "Member" and "editor" are `company.ts`'s rules, restated here: a
 * member holds a `user_company_links` row (a platform admin counts, as in
 * `viewerIsMember`); an editor is a member whose role is Owner, Admin or
 * Founder, a primary admin, or a platform admin (`canEdit`). A caller who is
 * not a member reads 404, as `GET /company/:uid` answers, so a route never
 * confirms that a company exists. A member who is not an editor gets 403.
 *
 * NOTHING IS DELETED. An officer is ceased and a location closed; a retired
 * slug moves to `slug_history` in the same batch as the rename (migration 685).
 * An archived company (D1137) is read but takes no write: restore it first.
 *
 * THE TAX ID NEVER LEAVES SEALED except to an editor who is not a platform
 * admin asking for their own edit field (`?full=1`), the rule D579 set for the
 * project EIN (owner question A, answer a: the company's tax ID is its own
 * record, and the project EIN stays on the project). A refusal never echoes
 * the value, and an admin write is audited without the number.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { isAdmin, mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { encryptColumn, decryptColumn } from '../services/columnCipher';
import { logAdminAction } from '../services/adminAudit';
import { checkSlug, slugHolder, retireSlug, companyPath } from '../services/slugs';

const r = new Hono<{ Bindings: Env }>();

export const LEGAL_FORMS = ['c_corp', 's_corp', 'llc', 'lp', 'ltd', 'plc', 'gmbh', 'sas', 'bv', 'other'] as const;
export const TAX_ID_KINDS = ['ein', 'vat', 'other'] as const;
export const OFFICES = ['director', 'officer'] as const;
// D1593 (#3861, migration 749): `mailing`, one open per company, as `registered` is.
export const LOCATION_KINDS = ['registered', 'headquarters', 'office', 'mailing', 'other'] as const;

const TAX_TABLE = 'company_tax_ids';
const TAX_COLUMN = 'tax_id_enc';
const TEXT_MAX = 200;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
/** An ISO 3166-1 code, or a 3166-2 subdivision: 'GB', 'US-DE'. */
const JURISDICTION_SHAPE = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;
const COUNTRY_SHAPE = /^[A-Z]{2}$/;
const TAX_SHAPES: Record<(typeof TAX_ID_KINDS)[number], RegExp> = {
  ein: /^\d{2}-\d{7}$/,
  vat: /^[A-Z]{2}[A-Z0-9]{2,13}$/,
  other: /^[A-Za-z0-9][A-Za-z0-9 ./-]{3,39}$/,
};

type CompanyRow = {
  id: number; uid: string; company_name: string; archived_at: string | null; slug: string | null;
  legal_name: string | null; legal_form: string | null; jurisdiction: string | null;
  registration_number: string | null; incorporation_date: string | null; registered_agent_name: string | null;
};
type Access = { company: CompanyRow; member: boolean; editor: boolean; admin: boolean };
type Block<T> = { available: true; value: T } | { available: false; reason: string };
const ok = <T>(value: T): Block<T> => ({ available: true, value });
const failed = (what: string): Block<never> => ({ available: false, reason: `${what} could not be read. That is not the same as none.` });

const COMPANY_SQL = `SELECT id, uid, company_name, archived_at, slug, legal_name, legal_form, jurisdiction,
  registration_number, incorporation_date, registered_agent_name FROM company_profiles WHERE uid = ?`;

/** The company and what the caller may do with it, or null when the caller may not see it. */
async function accessOf(env: Env, uid: string, user: User): Promise<Access | null> {
  const company = await env.DB.prepare(COMPANY_SQL).bind(uid).first<CompanyRow>();
  if (!company) return null;
  const admin = isAdmin(user);
  const link = await env.DB.prepare(
    'SELECT role_in_company, is_primary_admin FROM user_company_links WHERE company_id = ? AND user_id = ?',
  ).bind(company.id, user.id).first<{ role_in_company: string; is_primary_admin: number }>();
  if (!link && !admin) return null;
  const editor = admin || !!link?.is_primary_admin || ['Owner', 'Admin', 'Founder'].includes(String(link?.role_in_company));
  return { company, member: true, editor, admin };
}

const notFound = (c: any) => refuse(c, 404, { code: 'not_found', message: 'Company not found.' });
const notEditor = (c: any) => refuse(c, 403, { code: 'not_editor', message: 'Only an owner, admin or founder of this company can change this.' });
const archived = (c: any) => refuse(c, 409, { code: 'archived', message: 'This company is archived. Restore it before you change it.' });

/** For a write: the access, or the refusal to return. */
async function editorOf(c: any, uid: string, user: User): Promise<Access | Response> {
  const a = await accessOf(c.env, uid, user);
  if (!a) return notFound(c);
  if (!a.editor) return notEditor(c);
  if (a.company.archived_at) return archived(c);
  return a;
}

/** A real calendar date in YYYY-MM-DD. */
function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_SHAPE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const today = () => nowIso().slice(0, 10);

/** A trimmed string, null for null or blank, or an error code. */
function text(v: unknown): { value: string | null } | { error: 'field_invalid' | 'text_too_long' } {
  if (v === null) return { value: null };
  if (typeof v !== 'string') return { error: 'field_invalid' };
  const t = v.trim();
  if (t.length > TEXT_MAX) return { error: 'text_too_long' };
  return { value: t || null };
}

export const MESSAGES: Record<string, string> = {
  field_invalid: 'One of the fields is not text.',
  text_too_long: `Each field must be at most ${TEXT_MAX} characters.`,
  legal_form_invalid: 'Choose an entity type from the list.',
  jurisdiction_invalid: 'Enter the jurisdiction as a country code, or a country and region code (for example GB or US-DE).',
  incorporation_date_invalid: 'Enter the incorporation date as a real date, YYYY-MM-DD.',
  tax_id_invalid: 'That tax ID does not have the shape its kind needs.',
  tax_id_kind_invalid: 'Choose whether the tax ID is an EIN, a VAT number or another kind.',
  name_required: 'Enter the person\'s name.',
  title_required: 'Enter the title, for example CEO or Secretary.',
  office_invalid: 'Choose director or officer.',
  appointed_on_invalid: 'Enter the appointment date as a real date, YYYY-MM-DD.',
  ceased_on_invalid: 'Enter the date as a real date, YYYY-MM-DD.',
  ceased_on_before_appointed: 'A person cannot leave office before they were appointed.',
  user_not_member: 'That account is not a member of this company.',
  kind_invalid: 'Choose registered, headquarters, office, mailing or other.',
  country_invalid: 'Enter the country as a two-letter code, for example GB.',
  closed_on_invalid: 'Enter the date as a real date, YYYY-MM-DD.',
  slug_invalid: 'A slug is 1 to 50 lower-case letters, digits and hyphens, and starts and ends with a letter or digit.',
  slug_reserved: 'That word is used by the address itself. Choose another.',
};
const bad = (c: any, code: string) => refuse(c, 400, { code, message: MESSAGES[code] ?? 'That request is not valid.' });

// ── Legal record ────────────────────────────────────────────────────────────

// D1593 (#3861): the registered agent's name, free text of at most TEXT_MAX characters; null clears it.
const LEGAL_FIELDS = ['legal_name', 'legal_form', 'jurisdiction', 'registration_number', 'incorporation_date', 'registered_agent_name'] as const;

/** Validate a partial legal body: the columns to set, or the first error code. */
export function legalPatch(body: any): { sets: Record<string, string | null> } | { error: string } {
  const sets: Record<string, string | null> = {};
  for (const f of LEGAL_FIELDS) {
    if (body?.[f] === undefined) continue;
    const t = text(body[f]);
    if ('error' in t) return t;
    let v = t.value;
    if (v !== null && f === 'legal_form' && !(LEGAL_FORMS as readonly string[]).includes(v)) return { error: 'legal_form_invalid' };
    if (v !== null && f === 'jurisdiction') {
      v = v.toUpperCase();
      if (!JURISDICTION_SHAPE.test(v)) return { error: 'jurisdiction_invalid' };
    }
    if (v !== null && f === 'incorporation_date' && !isDate(v)) return { error: 'incorporation_date_invalid' };
    sets[f] = v;
  }
  return { sets };
}

type OfficerRow = { uid: string; user_id: number | null; name: string; office: string; title: string; appointed_on: string | null; ceased_on: string | null; created_at: string; updated_at: string };
type LocationRow = { uid: string; kind: string; label: string | null; line1: string | null; line2: string | null; city: string | null; region: string | null; postal_code: string | null; country: string; closed_on: string | null; created_at: string; updated_at: string };

const OFFICERS_SQL = `SELECT uid, user_id, name, office, title, appointed_on, ceased_on, created_at, updated_at
  FROM company_officers WHERE company_id = ? ORDER BY ceased_on IS NOT NULL, office, name, id`;
const OFFICER_SQL = `SELECT uid, user_id, name, office, title, appointed_on, ceased_on, created_at, updated_at
  FROM company_officers WHERE company_id = ? AND uid = ?`;
const LOCATIONS_SQL = `SELECT uid, kind, label, line1, line2, city, region, postal_code, country, closed_on, created_at, updated_at
  FROM company_locations WHERE company_id = ? ORDER BY closed_on IS NOT NULL, kind != 'registered', id`;
const LOCATION_SQL = `SELECT uid, kind, label, line1, line2, city, region, postal_code, country, closed_on, created_at, updated_at
  FROM company_locations WHERE company_id = ? AND uid = ?`;

async function officersOf(env: Env, companyId: number): Promise<Block<OfficerRow[]>> {
  try {
    const rows = await env.DB.prepare(OFFICERS_SQL).bind(companyId).all<OfficerRow>();
    return ok(rows.results || []);
  } catch (e) { console.error('[company_legal] officers read failed', (e as Error).message); return failed('Officers and directors'); }
}

async function locationsOf(env: Env, companyId: number): Promise<Block<LocationRow[]>> {
  try {
    const rows = await env.DB.prepare(LOCATIONS_SQL).bind(companyId).all<LocationRow>();
    return ok(rows.results || []);
  } catch (e) { console.error('[company_legal] locations read failed', (e as Error).message); return failed('Locations'); }
}

type TaxRow = { kind: string; tax_id_enc: string; tax_id_last4: string; updated_at: string };
const taxRow = (env: Env, companyId: number) =>
  env.DB.prepare('SELECT kind, tax_id_enc, tax_id_last4, updated_at FROM company_tax_ids WHERE company_id = ?').bind(companyId).first<TaxRow>();
const masked = (last4: string) => `••••${last4}`;

async function taxSummary(env: Env, companyId: number): Promise<Block<{ recorded: boolean; kind: string | null; last4: string | null }>> {
  try {
    const row = await taxRow(env, companyId);
    return ok({ recorded: !!row, kind: row?.kind ?? null, last4: row?.tax_id_last4 ?? null });
  } catch (e) { console.error('[company_legal] tax id read failed', (e as Error).message); return failed('The tax ID'); }
}

r.get('/company/:uid/legal', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await accessOf(c.env, c.req.param('uid'), user);
    if (!a) return notFound(c);
    const [officers, locations, tax_id] = await Promise.all([
      officersOf(c.env, a.company.id), locationsOf(c.env, a.company.id), taxSummary(c.env, a.company.id),
    ]);
    const registered = locations.available
      ? ok(locations.value.find((l) => l.kind === 'registered' && !l.closed_on) ?? null)
      : locations;
    // D1593: the open mailing address beside it; a failed read is unavailable, never null.
    const mailing = locations.available
      ? ok(locations.value.find((l) => l.kind === 'mailing' && !l.closed_on) ?? null)
      : locations;
    const out: Record<string, unknown> = { uid: a.company.uid, company_name: a.company.company_name };
    for (const f of LEGAL_FIELDS) out[f] = a.company[f];
    return c.json({
      ...out,
      slug: a.company.slug, path: companyPath(a.company),
      registered_address: registered, mailing_address: mailing, tax_id, officers, locations,
      archived: a.company.archived_at != null,
      can_edit: a.editor && a.company.archived_at == null,
    });
  } catch (e) { return mapError(c, e); }
});

r.put('/company/:uid/legal', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const body = await c.req.json().catch(() => ({}));
    const p = legalPatch(body);
    if ('error' in p) return bad(c, p.error);
    const keys = Object.keys(p.sets);
    if (keys.length) {
      // Read, merge, write every column: one fixed statement, nothing composed.
      const next = { ...a.company, ...p.sets } as CompanyRow;
      await c.env.DB.prepare(
        `UPDATE company_profiles SET legal_name = ?, legal_form = ?, jurisdiction = ?, registration_number = ?,
           incorporation_date = ?, registered_agent_name = ?, updated_at = ? WHERE id = ?`,
      ).bind(next.legal_name, next.legal_form, next.jurisdiction, next.registration_number, next.incorporation_date,
        next.registered_agent_name, nowIso(), a.company.id).run();
      if (a.admin) await logAdminAction(c.env, user.id, user.email, 'company_legal_updated', { company_id: a.company.id, fields: keys });
    }
    const fresh = await c.env.DB.prepare(COMPANY_SQL).bind(a.company.uid).first<CompanyRow>();
    const out: Record<string, unknown> = { uid: a.company.uid };
    for (const f of LEGAL_FIELDS) out[f] = fresh?.[f] ?? null;
    return c.json({ ...out, changed: keys });
  } catch (e) { return mapError(c, e); }
});

// ── Tax ID ──────────────────────────────────────────────────────────────────

r.get('/company/:uid/tax-id', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await accessOf(c.env, c.req.param('uid'), user);
    if (!a) return notFound(c);
    const row = await taxRow(c.env, a.company.id);
    // The number goes to an editor's own edit field, and never to a platform admin.
    const full = c.req.query('full') === '1' && a.editor && !a.admin;
    if (!row) return c.json({ recorded: false, kind: null, last4: null, masked: null, recorded_at: null, ...(full ? { tax_id: null } : {}), can_edit: a.editor });
    const out: Record<string, unknown> = {
      recorded: true, kind: row.kind, last4: row.tax_id_last4, masked: masked(row.tax_id_last4), recorded_at: row.updated_at,
    };
    if (full) out.tax_id = await decryptColumn(c.env, TAX_TABLE, TAX_COLUMN, a.company.id, row.tax_id_enc);
    return c.json({ ...out, can_edit: a.editor });
  } catch (e) { return mapError(c, e); }
});

r.put('/company/:uid/tax-id', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; tax_id?: unknown };
    const kind = body.kind as (typeof TAX_ID_KINDS)[number];
    if (!(TAX_ID_KINDS as readonly unknown[]).includes(kind)) return bad(c, 'tax_id_kind_invalid');
    if (typeof body.tax_id !== 'string') return bad(c, 'tax_id_invalid');
    const raw = body.tax_id.trim();
    const value = kind === 'vat' ? raw.replace(/\s+/g, '').toUpperCase() : raw;
    if (!TAX_SHAPES[kind].test(value)) return bad(c, 'tax_id_invalid');
    const alnum = value.replace(/[^A-Za-z0-9]/g, '');
    if (alnum.length < 4) return bad(c, 'tax_id_invalid');
    const last4 = alnum.slice(-4);
    const enc = await encryptColumn(c.env, TAX_TABLE, TAX_COLUMN, a.company.id, value);
    await c.env.DB.prepare(
      `INSERT INTO company_tax_ids (company_id, kind, tax_id_enc, tax_id_last4, recorded_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET kind = excluded.kind, tax_id_enc = excluded.tax_id_enc,
         tax_id_last4 = excluded.tax_id_last4, recorded_by = excluded.recorded_by, updated_at = datetime('now')`,
    ).bind(a.company.id, kind, enc, last4, user.id).run();
    if (a.admin) await logAdminAction(c.env, user.id, user.email, 'company_tax_id_recorded', { company_id: a.company.id, kind });
    return c.json({ recorded: true, kind, last4, masked: masked(last4), can_edit: true });
  } catch (e) { return mapError(c, e); }
});

// ── Officers and directors ──────────────────────────────────────────────────

/** Validate an officer body. `partial` for PATCH: only the keys sent. */
async function officerFields(env: Env, companyId: number, body: any, partial: boolean): Promise<{ sets: Record<string, unknown> } | { error: string }> {
  const sets: Record<string, unknown> = {};
  for (const f of ['name', 'title'] as const) {
    if (body?.[f] === undefined) { if (!partial) return { error: `${f}_required` }; continue; }
    const t = text(body[f]);
    if ('error' in t) return t;
    if (!t.value) return { error: `${f}_required` };
    sets[f] = t.value;
  }
  if (body?.office !== undefined || !partial) {
    if (!(OFFICES as readonly unknown[]).includes(body?.office)) return { error: 'office_invalid' };
    sets.office = body.office;
  }
  if (body?.appointed_on !== undefined) {
    if (body.appointed_on !== null && !isDate(body.appointed_on)) return { error: 'appointed_on_invalid' };
    sets.appointed_on = body.appointed_on;
  }
  if (body?.user_id !== undefined) {
    if (body.user_id === null) sets.user_id = null;
    else {
      const id = Number(body.user_id);
      const member = Number.isSafeInteger(id) && id > 0
        ? await env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(companyId, id).first()
        : null;
      if (!member) return { error: 'user_not_member' };
      sets.user_id = id;
    }
  }
  return { sets };
}

const officerByUid = (env: Env, companyId: number, uid: string) =>
  env.DB.prepare(OFFICER_SQL).bind(companyId, uid).first<OfficerRow>();

r.get('/company/:uid/officers', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await accessOf(c.env, c.req.param('uid'), user);
    if (!a) return notFound(c);
    const officers = await officersOf(c.env, a.company.id);
    if (!officers.available) return refuse(c, 503, { code: 'officers_unreadable', message: officers.reason });
    return c.json({ officers: officers.value, can_edit: a.editor && !a.company.archived_at });
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/officers', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const f = await officerFields(c.env, a.company.id, await c.req.json().catch(() => ({})), false);
    if ('error' in f) return bad(c, f.error);
    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO company_officers (uid, company_id, user_id, name, office, title, appointed_on, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, a.company.id, f.sets.user_id ?? null, f.sets.name, f.sets.office, f.sets.title, f.sets.appointed_on ?? null, user.id).run();
    return c.json(await officerByUid(c.env, a.company.id, uid), 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/company/:uid/officers/:officerUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const officer = await officerByUid(c.env, a.company.id, c.req.param('officerUid'));
    if (!officer) return refuse(c, 404, { code: 'not_found', message: 'That officer or director is not on this company.' });
    if (officer.ceased_on) return refuse(c, 409, { code: 'already_ceased', message: 'This person has left office. Their record is kept as it was.' });
    const f = await officerFields(c.env, a.company.id, await c.req.json().catch(() => ({})), true);
    if ('error' in f) return bad(c, f.error);
    if (Object.keys(f.sets).length) {
      const next = { ...officer, ...f.sets } as OfficerRow;
      await c.env.DB.prepare(
        `UPDATE company_officers SET name = ?, office = ?, title = ?, appointed_on = ?, user_id = ?, updated_at = datetime('now')
          WHERE company_id = ? AND uid = ? AND ceased_on IS NULL`,
      ).bind(next.name, next.office, next.title, next.appointed_on, next.user_id, a.company.id, officer.uid).run();
    }
    return c.json(await officerByUid(c.env, a.company.id, officer.uid));
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/officers/:officerUid/cease', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const officer = await officerByUid(c.env, a.company.id, c.req.param('officerUid'));
    if (!officer) return refuse(c, 404, { code: 'not_found', message: 'That officer or director is not on this company.' });
    if (officer.ceased_on) return refuse(c, 409, { code: 'already_ceased', message: 'This person has already left office.' });
    const body = (await c.req.json().catch(() => ({}))) as { ceased_on?: unknown };
    const ceased = body.ceased_on === undefined ? today() : body.ceased_on;
    if (!isDate(ceased)) return bad(c, 'ceased_on_invalid');
    if (officer.appointed_on && ceased < officer.appointed_on) return bad(c, 'ceased_on_before_appointed');
    await c.env.DB.prepare(
      "UPDATE company_officers SET ceased_on = ?, updated_at = datetime('now') WHERE company_id = ? AND uid = ? AND ceased_on IS NULL",
    ).bind(ceased, a.company.id, officer.uid).run();
    return c.json(await officerByUid(c.env, a.company.id, officer.uid));
  } catch (e) { return mapError(c, e); }
});

// ── Locations ───────────────────────────────────────────────────────────────

const ADDRESS_FIELDS = ['label', 'line1', 'line2', 'city', 'region', 'postal_code'] as const;

function locationFields(body: any, partial: boolean): { sets: Record<string, unknown> } | { error: string } {
  const sets: Record<string, unknown> = {};
  if (body?.kind !== undefined || !partial) {
    if (!(LOCATION_KINDS as readonly unknown[]).includes(body?.kind)) return { error: 'kind_invalid' };
    sets.kind = body.kind;
  }
  if (body?.country !== undefined || !partial) {
    const cc = typeof body?.country === 'string' ? body.country.trim().toUpperCase() : '';
    if (!COUNTRY_SHAPE.test(cc)) return { error: 'country_invalid' };
    sets.country = cc;
  }
  for (const f of ADDRESS_FIELDS) {
    if (body?.[f] === undefined) continue;
    const t = text(body[f]);
    if ('error' in t) return t;
    sets[f] = t.value;
  }
  return { sets };
}

const locationByUid = (env: Env, companyId: number, uid: string) =>
  env.DB.prepare(LOCATION_SQL).bind(companyId, uid).first<LocationRow>();

/** Another open registered address on this company, other than `exceptUid`. */
const openRegistered = (env: Env, companyId: number, exceptUid: string | null) =>
  env.DB.prepare("SELECT uid FROM company_locations WHERE company_id = ? AND kind = 'registered' AND closed_on IS NULL AND uid != ?")
    .bind(companyId, exceptUid ?? '').first();
const registeredExists = (c: any) => refuse(c, 409, { code: 'registered_exists', message: 'This company already has a registered address. Close it before you add another.' });
/** D1593: another open mailing address on this company, other than `exceptUid`. */
const openMailing = (env: Env, companyId: number, exceptUid: string | null) =>
  env.DB.prepare("SELECT uid FROM company_locations WHERE company_id = ? AND kind = 'mailing' AND closed_on IS NULL AND uid != ?")
    .bind(companyId, exceptUid ?? '').first();
const mailingExists = (c: any) => refuse(c, 409, { code: 'mailing_exists', message: 'This company already has a mailing address. Close it before you add another.' });
/** The one-open-per-company kind a write collided on: the index decides when two writes race. */
const clashOf = (c: any, kind: unknown) => (kind === 'mailing' ? mailingExists(c) : registeredExists(c));
const isUniqueClash = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));

r.get('/company/:uid/locations', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await accessOf(c.env, c.req.param('uid'), user);
    if (!a) return notFound(c);
    const locations = await locationsOf(c.env, a.company.id);
    if (!locations.available) return refuse(c, 503, { code: 'locations_unreadable', message: locations.reason });
    return c.json({ locations: locations.value, can_edit: a.editor && !a.company.archived_at });
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/locations', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const f = locationFields(await c.req.json().catch(() => ({})), false);
    if ('error' in f) return bad(c, f.error);
    if (f.sets.kind === 'registered' && await openRegistered(c.env, a.company.id, null)) return registeredExists(c);
    if (f.sets.kind === 'mailing' && await openMailing(c.env, a.company.id, null)) return mailingExists(c);
    const uid = newUid();
    try {
      await c.env.DB.prepare(
        `INSERT INTO company_locations (uid, company_id, kind, label, line1, line2, city, region, postal_code, country, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid, a.company.id, f.sets.kind, ...ADDRESS_FIELDS.map((k) => f.sets[k] ?? null), f.sets.country, user.id).run();
    } catch (e) {
      // Two writes racing for the one open registered or mailing address: the index decides.
      if (isUniqueClash(e)) return clashOf(c, f.sets.kind);
      throw e;
    }
    return c.json(await locationByUid(c.env, a.company.id, uid), 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/company/:uid/locations/:locUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const loc = await locationByUid(c.env, a.company.id, c.req.param('locUid'));
    if (!loc) return refuse(c, 404, { code: 'not_found', message: 'That location is not on this company.' });
    if (loc.closed_on) return refuse(c, 409, { code: 'already_closed', message: 'This location is closed. Its record is kept as it was.' });
    const f = locationFields(await c.req.json().catch(() => ({})), true);
    if ('error' in f) return bad(c, f.error);
    if (f.sets.kind === 'registered' && await openRegistered(c.env, a.company.id, loc.uid)) return registeredExists(c);
    if (f.sets.kind === 'mailing' && await openMailing(c.env, a.company.id, loc.uid)) return mailingExists(c);
    if (Object.keys(f.sets).length) {
      const next = { ...loc, ...f.sets } as LocationRow;
      try {
        await c.env.DB.prepare(
          `UPDATE company_locations SET kind = ?, label = ?, line1 = ?, line2 = ?, city = ?, region = ?, postal_code = ?, country = ?,
             updated_by = ?, updated_at = datetime('now') WHERE company_id = ? AND uid = ? AND closed_on IS NULL`,
        ).bind(next.kind, next.label, next.line1, next.line2, next.city, next.region, next.postal_code, next.country,
          user.id, a.company.id, loc.uid).run();
      } catch (e) {
        if (isUniqueClash(e)) return clashOf(c, f.sets.kind ?? loc.kind);
        throw e;
      }
    }
    return c.json(await locationByUid(c.env, a.company.id, loc.uid));
  } catch (e) { return mapError(c, e); }
});

r.post('/company/:uid/locations/:locUid/close', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const loc = await locationByUid(c.env, a.company.id, c.req.param('locUid'));
    if (!loc) return refuse(c, 404, { code: 'not_found', message: 'That location is not on this company.' });
    if (loc.closed_on) return refuse(c, 409, { code: 'already_closed', message: 'This location is already closed.' });
    const body = (await c.req.json().catch(() => ({}))) as { closed_on?: unknown };
    const closed = body.closed_on === undefined ? today() : body.closed_on;
    if (!isDate(closed)) return bad(c, 'closed_on_invalid');
    await c.env.DB.prepare(
      "UPDATE company_locations SET closed_on = ?, updated_by = ?, updated_at = datetime('now') WHERE company_id = ? AND uid = ? AND closed_on IS NULL",
    ).bind(closed, user.id, a.company.id, loc.uid).run();
    return c.json(await locationByUid(c.env, a.company.id, loc.uid));
  } catch (e) { return mapError(c, e); }
});

// ── Company slug ────────────────────────────────────────────────────────────

r.put('/company/:uid/slug', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await editorOf(c, c.req.param('uid'), user);
    if (a instanceof Response) return a;
    const body = (await c.req.json().catch(() => ({}))) as { slug?: unknown };
    const s = checkSlug(body.slug);
    if (!s.ok) return bad(c, s.code);
    const previous = a.company.slug;
    if (previous === s.slug) return c.json({ slug: s.slug, path: companyPath(a.company), previous_slug: previous });
    const holder = await slugHolder(c.env, 'company', s.slug);
    if (holder != null && holder !== a.company.id) {
      return refuse(c, 409, { code: 'slug_taken', message: 'Another company holds that address. Choose another.' });
    }
    // The rename and the retired slug are one batch: a rename never lands without its history.
    const stmts = [
      c.env.DB.prepare('UPDATE company_profiles SET slug = ?, updated_at = ? WHERE id = ?').bind(s.slug, nowIso(), a.company.id),
      ...(previous ? [retireSlug(c.env, 'company', previous, a.company.id, null, user.id)] : []),
    ];
    try {
      await c.env.DB.batch(stmts);
    } catch (e) {
      if (isUniqueClash(e)) return refuse(c, 409, { code: 'slug_taken', message: 'Another company holds that address. Choose another.' });
      throw e;
    }
    return c.json({ slug: s.slug, path: companyPath({ uid: a.company.uid, slug: s.slug }), previous_slug: previous });
  } catch (e) { return mapError(c, e); }
});

export default r;
