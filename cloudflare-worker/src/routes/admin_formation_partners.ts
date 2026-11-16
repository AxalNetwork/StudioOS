/**
 * D6692 (#6692, P1 of #6680) — the formation partner registry, mounted at
 * /api/admin/formation/partners: which partner firm may do which formation
 * service, for which form in which country, under which licence and data
 * terms, at which price, and who at the firm acts for it.
 *
 *   GET   /                               the registered partners, with counts
 *   GET   /:uid                           one partner: data terms, credentials, coverage and prices, members
 *   POST  /                               register an existing partner firm `{ partner_uid, deal_id? }` (draft)
 *   PATCH /:uid                           `{ deal_id?, next_review_on? }`
 *   PATCH /:uid/data-terms                the data agreement and its terms
 *   POST  /:uid/credentials               a licence in one country
 *   PATCH /:uid/credentials/:cuid         edit a licence
 *   POST  /:uid/coverage                  a form, country and service, created off
 *   PATCH /:uid/coverage/:cuid            target hours, priority, on or off
 *   POST  /:uid/coverage/:cuid/prices     a price for one coverage row
 *   PATCH /:uid/prices/:puid              edit a price
 *   POST  /:uid/verify                    draft or suspended → verified (Super Admin, write bar)
 *   POST  /:uid/suspend                   verified → suspended, coverage off in the same batch (Super Admin, write bar)
 *   POST  /:uid/end                       → ended, coverage off in the same batch (Super Admin, write bar)
 *   POST  /:uid/members                   `{ user_id, role }`
 *   POST  /:uid/members/:muid/revoke
 *
 * WHO. Every route is `requireHqAdmin`: HQ holds the registry and a branch is
 * refused. Verify, suspend, end and any write that carries `cost_minor` are
 * the Super Admin's, behind `requireSuperAdminWriteBar`; a plain Admin is
 * refused `super_admin_required` before being asked for a code. `cost_minor`
 * is never returned to anyone but the Super Admin; `founder_price_minor` is.
 *
 * Every write records the actor through `logAdminAction`, with the action
 * names in `FORMATION_PARTNER_ACTIONS` (services/formationPartners.ts). The
 * rules themselves live there too.
 *
 * Out of scope (#6692): assigning cases (#6710), partner-facing routes,
 * paying partners, and any screen (#6702).
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { isSuperAdmin, requireHqAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import type { RouteMount } from '../util/routeRegistry';
import {
  CADENCES, DATA_ROLES, MEMBER_ROLES, SERVICES, SHORT_MAX, TEXT_MAX,
  coverageOnRefusal, isCountry, isCurrency, isDate, isFormKey, isMinor, isOneOf, isPositiveId,
  partnerByUid, readPartner, statusChangeBatch, textOrNull, verifyRefusal, type Refusal,
} from '../services/formationPartners';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

const has = (b: any, k: string) => !!b && typeof b === 'object' && Object.prototype.hasOwnProperty.call(b, k);
const body = async (c: Ctx): Promise<any> => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
};
const deny = (c: Ctx, x: Refusal) => refuse(c, x.status, { code: x.code, message: x.message });
const unreadable = (c: Ctx, raw: unknown) =>
  refuse(c, 503, { code: 'formation_partners_unreadable', message: 'The formation partner registry could not be read. Try again in a moment.', raw });
const unsaved = (c: Ctx, raw: unknown) =>
  refuse(c, 503, { code: 'formation_partners_unsaved', message: 'The change was not saved. Try again in a moment.', raw });
const BAD_BODY = { status: 400, code: 'invalid_request', message: 'Send a JSON object.' } as const;
const NOT_FOUND = { status: 404, code: 'formation_partner_not_found', message: 'No formation partner has that reference.' } as const;
const ENDED = { status: 409, code: 'partner_ended', message: 'This partner has ended, so its record no longer changes.' } as const;

/** The Super Admin, past the write bar. A plain Admin is refused before being asked for a code. */
async function superAdminWrite(c: Ctx, admin: User, what: string): Promise<Response | null> {
  if (!isSuperAdmin(admin)) return refuse(c, 403, { code: 'super_admin_required', message: `Only the Super Admin ${what}.` });
  await requireSuperAdminWriteBar(c);
  return null;
}

async function documentExists(env: Env, id: number): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM documents WHERE id = ?').bind(id).first());
}

/** The partner named in the path, or the refusal to send. */
async function loadPartner(c: Ctx, opts: { writable?: boolean } = {}): Promise<any | Response> {
  const f = await partnerByUid(c.env, c.req.param('uid') || '');
  if (!f) return deny(c, NOT_FOUND);
  if (opts.writable && f.status === 'ended') return deny(c, ENDED);
  return f;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

r.get('/', async (c) => {
  await requireHqAdmin(c);
  const status = c.req.query('status') || '';
  if (status && !['draft', 'verified', 'suspended', 'ended'].includes(status)) {
    return refuse(c, 400, { code: 'unknown_status', message: 'Status is draft, verified, suspended or ended.' });
  }
  try {
    const rows = await c.env.DB.prepare(
      `SELECT f.uid, f.status, f.verified_at, f.next_review_on, f.dpa_signed_on, f.created_at, f.updated_at,
              p.uid AS partner_uid, p.name AS partner_name, p.company AS partner_company,
              (SELECT COUNT(*) FROM formation_partner_coverage v WHERE v.formation_partner_id = f.id AND v.is_on = 1) AS coverage_on,
              (SELECT COUNT(*) FROM formation_partner_coverage v WHERE v.formation_partner_id = f.id) AS coverage_total,
              (SELECT COUNT(DISTINCT x.country) FROM formation_partner_credentials x WHERE x.formation_partner_id = f.id
                  AND datetime(x.valid_until) >= datetime('now', 'start of day')) AS licensed_countries,
              (SELECT COUNT(*) FROM formation_partner_members m WHERE m.formation_partner_id = f.id AND m.revoked_at IS NULL) AS members
         FROM formation_partners f JOIN partners p ON p.id = f.partner_id
        WHERE (? = '' OR f.status = ?)
        ORDER BY p.name COLLATE NOCASE, f.id`,
    ).bind(status, status).all<any>();
    return c.json({
      items: (rows.results || []).map((x) => ({
        uid: x.uid, status: x.status,
        partner: { uid: x.partner_uid, name: x.partner_name, company: x.partner_company ?? null },
        verified_at: x.verified_at ?? null, next_review_on: x.next_review_on ?? null, dpa_signed: !!x.dpa_signed_on,
        coverage_on: Number(x.coverage_on), coverage_total: Number(x.coverage_total),
        licensed_countries: Number(x.licensed_countries), members: Number(x.members),
        created_at: x.created_at, updated_at: x.updated_at,
      })),
    });
  } catch (e) { return unreadable(c, e); }
});

r.get('/:uid', async (c) => {
  const admin = await requireHqAdmin(c);
  try {
    const f = await loadPartner(c);
    if (f instanceof Response) return f;
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)));
  } catch (e) { return unreadable(c, e); }
});

/* ------------------------------------------------------------------ *
 * The partner record
 * ------------------------------------------------------------------ */

r.post('/', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  if (typeof b.partner_uid !== 'string' || !b.partner_uid) {
    return refuse(c, 400, { code: 'partner_required', message: 'Name the partner firm to register, by its reference.' });
  }
  if (b.deal_id !== undefined && b.deal_id !== null && !isPositiveId(b.deal_id)) {
    return refuse(c, 400, { code: 'invalid_deal', message: 'The deal is a partner deal’s id, or left out.' });
  }
  try {
    const firm = await c.env.DB.prepare('SELECT id, uid, name FROM partners WHERE uid = ?').bind(b.partner_uid).first<any>();
    if (!firm) return refuse(c, 404, { code: 'partner_not_found', message: 'No partner firm has that reference.' });
    if (b.deal_id && !(await c.env.DB.prepare('SELECT 1 AS x FROM partner_deals WHERE id = ?').bind(b.deal_id).first())) {
      return refuse(c, 404, { code: 'deal_not_found', message: 'No partner deal has that id.' });
    }
    const taken = await c.env.DB.prepare('SELECT uid FROM formation_partners WHERE partner_id = ?').bind(firm.id).first<any>();
    if (taken) return refuse(c, 409, { code: 'formation_partner_exists', message: 'This firm is already registered as a formation partner.', extra: { uid: taken.uid } });
    const row = await c.env.DB.prepare(
      `INSERT INTO formation_partners (partner_id, deal_id, created_by) VALUES (?, ?, ?) RETURNING uid`,
    ).bind(firm.id, b.deal_id ?? null, admin.id).first<any>();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.created', { uid: row.uid, partner_uid: firm.uid, deal_id: b.deal_id ?? null });
    const f = await partnerByUid(c.env, row.uid);
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)), 201);
  } catch (e) { return unsaved(c, e); }
});

r.patch('/:uid', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const deal = has(b, 'deal_id') ? b.deal_id : f.deal_id;
    const review = has(b, 'next_review_on') ? b.next_review_on : f.next_review_on;
    if (deal !== null && deal !== undefined && !isPositiveId(deal)) return refuse(c, 400, { code: 'invalid_deal', message: 'The deal is a partner deal’s id, or null.' });
    if (review !== null && review !== undefined && !isDate(review)) return refuse(c, 400, { code: 'invalid_date', message: 'The next review is a date, YYYY-MM-DD, or null.' });
    if (deal && !(await c.env.DB.prepare('SELECT 1 AS x FROM partner_deals WHERE id = ?').bind(deal).first())) {
      return refuse(c, 404, { code: 'deal_not_found', message: 'No partner deal has that id.' });
    }
    await c.env.DB.prepare(`UPDATE formation_partners SET deal_id = ?, next_review_on = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(deal ?? null, review ?? null, f.id).run();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.updated', { uid: f.uid, deal_id: deal ?? null, next_review_on: review ?? null });
    return c.json(await readPartner(c.env, await partnerByUid(c.env, f.uid), isSuperAdmin(admin)));
  } catch (e) { return unsaved(c, e); }
});

r.patch('/:uid/data-terms', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const pick = (k: string) => (has(b, k) ? b[k] : f[k]);
    const role = pick('data_role');
    if (role !== null && role !== undefined && !isOneOf(DATA_ROLES, role)) {
      return refuse(c, 400, { code: 'invalid_data_role', message: `The data role is one of ${DATA_ROLES.join(', ')}, or null.` });
    }
    const doc = pick('dpa_document_id');
    if (doc !== null && doc !== undefined && !isPositiveId(doc)) return refuse(c, 400, { code: 'invalid_document', message: 'The data agreement is a document’s id, or null.' });
    const signed = pick('dpa_signed_on');
    if (signed !== null && signed !== undefined && !isDate(signed)) return refuse(c, 400, { code: 'invalid_date', message: 'The day the agreement was signed is a date, YYYY-MM-DD, or null.' });
    if (f.status === 'verified' && !signed) {
      return refuse(c, 409, { code: 'dpa_missing', message: 'A verified partner keeps a signed data agreement. Suspend the partner before clearing it.' });
    }
    const transfer = textOrNull(pick('transfer_mechanism'), SHORT_MAX);
    const retention = textOrNull(pick('retention_terms'), TEXT_MAX);
    const contact = textOrNull(pick('deletion_contact'), SHORT_MAX);
    if (transfer === 'bad' || retention === 'bad' || contact === 'bad') {
      return refuse(c, 400, { code: 'invalid_text', message: `The transfer mechanism and deletion contact are at most ${SHORT_MAX} characters, the retention terms at most ${TEXT_MAX}.` });
    }
    let places = f.restricted_places_json || '[]';
    if (has(b, 'restricted_places')) {
      const list = b.restricted_places;
      if (!Array.isArray(list) || list.length > 50 || list.some((p: unknown) => typeof p !== 'string' || !p.trim() || p.length > 80)) {
        return refuse(c, 400, { code: 'invalid_places', message: 'Restricted places are up to 50 names of at most 80 characters.' });
      }
      places = JSON.stringify(list.map((p: string) => p.trim()));
    }
    if (doc && !(await documentExists(c.env, doc))) return refuse(c, 404, { code: 'document_not_found', message: 'No document has that id.' });
    await c.env.DB.prepare(
      `UPDATE formation_partners SET data_role = ?, dpa_document_id = ?, dpa_signed_on = ?, transfer_mechanism = ?,
              retention_terms = ?, deletion_contact = ?, restricted_places_json = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(role ?? null, doc ?? null, signed ?? null, transfer, retention, contact, places, f.id).run();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.data_terms_updated', {
      uid: f.uid, fields: Object.keys(b).filter((k) => ['data_role', 'dpa_document_id', 'dpa_signed_on', 'transfer_mechanism', 'retention_terms', 'deletion_contact', 'restricted_places'].includes(k)),
    });
    return c.json(await readPartner(c.env, await partnerByUid(c.env, f.uid), isSuperAdmin(admin)));
  } catch (e) { return unsaved(c, e); }
});

/* ------------------------------------------------------------------ *
 * Credentials
 * ------------------------------------------------------------------ */

type CredentialInput = {
  country: string; licence_type: string; licence_number: string; regulator: string; valid_until: string;
  evidence_document_id: number | null; checked_on: string | null;
};
function readCredential(b: any, base?: any): CredentialInput | Refusal {
  const pick = (k: string) => (has(b, k) ? b[k] : base?.[k]);
  const country = pick('country');
  if (!isCountry(country)) return { status: 400, code: 'invalid_country', message: 'The country is a two-letter ISO code in capitals, such as GB.' };
  const type = textOrNull(pick('licence_type'), SHORT_MAX);
  const number = textOrNull(pick('licence_number'), SHORT_MAX);
  const regulator = textOrNull(pick('regulator'), SHORT_MAX);
  if (!type || !number || !regulator || type === 'bad' || number === 'bad' || regulator === 'bad') {
    return { status: 400, code: 'licence_incomplete', message: `Give the licence type, its number and the regulator, each at most ${SHORT_MAX} characters.` };
  }
  const until = pick('valid_until');
  if (!isDate(until)) return { status: 400, code: 'invalid_date', message: 'Valid until is a date, YYYY-MM-DD.' };
  const evidence = pick('evidence_document_id') ?? null;
  if (evidence !== null && !isPositiveId(evidence)) return { status: 400, code: 'invalid_document', message: 'The evidence is a document’s id, or null.' };
  const checked = pick('checked_on') ?? null;
  if (checked !== null && !isDate(checked)) return { status: 400, code: 'invalid_date', message: 'Checked on is a date, YYYY-MM-DD, or null.' };
  return { country, licence_type: type, licence_number: number, regulator, valid_until: until, evidence_document_id: evidence, checked_on: checked };
}
const isRefusal = (v: unknown): v is Refusal => !!v && typeof (v as Refusal).code === 'string' && typeof (v as Refusal).status === 'number';

r.post('/:uid/credentials', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  const input = readCredential(b);
  if (isRefusal(input)) return deny(c, input);
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    if (input.evidence_document_id && !(await documentExists(c.env, input.evidence_document_id))) {
      return refuse(c, 404, { code: 'document_not_found', message: 'No document has that id.' });
    }
    const row = await c.env.DB.prepare(
      `INSERT INTO formation_partner_credentials
         (formation_partner_id, country, licence_type, licence_number, regulator, valid_until, evidence_document_id, checked_by, checked_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING uid`,
    ).bind(f.id, input.country, input.licence_type, input.licence_number, input.regulator, input.valid_until,
      input.evidence_document_id, input.checked_on ? admin.id : null, input.checked_on, admin.id).first<any>();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.credential_added', { uid: f.uid, credential_uid: row.uid, country: input.country, valid_until: input.valid_until });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)), 201);
  } catch (e) { return unsaved(c, e); }
});

r.patch('/:uid/credentials/:cuid', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const cred = await c.env.DB.prepare('SELECT * FROM formation_partner_credentials WHERE uid = ? AND formation_partner_id = ?')
      .bind(c.req.param('cuid'), f.id).first<any>();
    if (!cred) return refuse(c, 404, { code: 'credential_not_found', message: 'This partner holds no licence with that reference.' });
    const input = readCredential(b, cred);
    if (isRefusal(input)) return deny(c, input);
    if (input.evidence_document_id && !(await documentExists(c.env, input.evidence_document_id))) {
      return refuse(c, 404, { code: 'document_not_found', message: 'No document has that id.' });
    }
    const checkedBy = has(b, 'checked_on') ? (input.checked_on ? admin.id : null) : cred.checked_by;
    await c.env.DB.prepare(
      `UPDATE formation_partner_credentials SET country = ?, licence_type = ?, licence_number = ?, regulator = ?, valid_until = ?,
              evidence_document_id = ?, checked_by = ?, checked_on = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(input.country, input.licence_type, input.licence_number, input.regulator, input.valid_until,
      input.evidence_document_id, checkedBy ?? null, input.checked_on, cred.id).run();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.credential_updated', { uid: f.uid, credential_uid: cred.uid, fields: Object.keys(b) });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)));
  } catch (e) { return unsaved(c, e); }
});

/* ------------------------------------------------------------------ *
 * Coverage and prices
 * ------------------------------------------------------------------ */

const BAD_HOURS = { status: 400, code: 'invalid_target_hours', message: 'Target hours are a whole number above 0, or null.' } as const;
const BAD_PRIORITY = { status: 400, code: 'invalid_priority', message: 'Priority is a whole number from 0 to 1000; lower comes first.' } as const;
const okHours = (v: unknown) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 100_000);
const okPriority = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1000;

r.post('/:uid/coverage', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  if (!isCountry(b.country)) return refuse(c, 400, { code: 'invalid_country', message: 'The country is a two-letter ISO code in capitals, such as GB.' });
  if (!isFormKey(b.form_key)) return refuse(c, 400, { code: 'invalid_form_key', message: 'The form key is lower case letters, digits and underscores, starting with a letter.' });
  if (!isOneOf(SERVICES, b.service)) return refuse(c, 400, { code: 'unknown_service', message: `The service is one of ${SERVICES.join(', ')}.` });
  const hours = b.target_hours ?? null;
  const priority = b.priority ?? 100;
  if (!okHours(hours)) return deny(c, BAD_HOURS);
  if (!okPriority(priority)) return deny(c, BAD_PRIORITY);
  if (b.on === true) {
    return refuse(c, 400, { code: 'coverage_created_off', message: 'Coverage is created off. Switch it on once it exists.' });
  }
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const dup = await c.env.DB.prepare(
      'SELECT uid FROM formation_partner_coverage WHERE formation_partner_id = ? AND country = ? AND form_key = ? AND service = ?',
    ).bind(f.id, b.country, b.form_key, b.service).first<any>();
    if (dup) return refuse(c, 409, { code: 'coverage_exists', message: 'This partner already covers that service for that form and country.', extra: { uid: dup.uid } });
    const row = await c.env.DB.prepare(
      `INSERT INTO formation_partner_coverage (formation_partner_id, country, form_key, service, target_hours, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING uid`,
    ).bind(f.id, b.country, b.form_key, b.service, hours, priority, admin.id).first<any>();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.coverage_added', { uid: f.uid, coverage_uid: row.uid, country: b.country, form_key: b.form_key, service: b.service });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)), 201);
  } catch (e) { return unsaved(c, e); }
});

r.patch('/:uid/coverage/:cuid', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  if (has(b, 'on') && typeof b.on !== 'boolean') return refuse(c, 400, { code: 'invalid_on', message: 'On is true or false.' });
  if (has(b, 'target_hours') && !okHours(b.target_hours)) return deny(c, BAD_HOURS);
  if (has(b, 'priority') && !okPriority(b.priority)) return deny(c, BAD_PRIORITY);
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const v = await c.env.DB.prepare('SELECT * FROM formation_partner_coverage WHERE uid = ? AND formation_partner_id = ?')
      .bind(c.req.param('cuid'), f.id).first<any>();
    if (!v) return refuse(c, 404, { code: 'coverage_not_found', message: 'This partner has no coverage with that reference.' });
    const on = has(b, 'on') ? b.on : Number(v.is_on) === 1;
    const switching = on !== (Number(v.is_on) === 1);
    if (switching && on) {
      const no = await coverageOnRefusal(c.env, f, v.country);
      if (no) return deny(c, no);
    }
    await c.env.DB.prepare(
      `UPDATE formation_partner_coverage SET target_hours = ?, priority = ?, is_on = ?,
              switched_by = CASE WHEN ? THEN ? ELSE switched_by END,
              switched_at = CASE WHEN ? THEN datetime('now') ELSE switched_at END,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(has(b, 'target_hours') ? b.target_hours : v.target_hours, has(b, 'priority') ? b.priority : v.priority, on ? 1 : 0,
      switching ? 1 : 0, admin.id, switching ? 1 : 0, v.id).run();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.coverage_updated', { uid: f.uid, coverage_uid: v.uid, fields: Object.keys(b), on });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)));
  } catch (e) { return unsaved(c, e); }
});

type PriceInput = { founder_price_minor: number; cost_minor: number | null; currency: string; cadence: string; effective_from: string; effective_to: string | null };
function readPrice(b: any, base?: any): PriceInput | Refusal {
  const pick = (k: string) => (has(b, k) ? b[k] : base?.[k]);
  const founder = pick('founder_price_minor');
  if (!isMinor(founder)) return { status: 400, code: 'invalid_price', message: 'The founder price is whole minor units (cents for USD), 0 or more.' };
  const cost = pick('cost_minor') ?? null;
  if (cost !== null && !isMinor(cost)) return { status: 400, code: 'invalid_cost', message: 'The cost is whole minor units (cents for USD), 0 or more, or null.' };
  const currency = pick('currency');
  if (!isCurrency(currency)) return { status: 400, code: 'invalid_currency', message: 'The currency is a three-letter code in capitals, such as USD.' };
  const cadence = pick('cadence');
  if (!isOneOf(CADENCES, cadence)) return { status: 400, code: 'invalid_cadence', message: `The cadence is one of ${CADENCES.join(', ')}.` };
  const from = pick('effective_from');
  const to = pick('effective_to') ?? null;
  if (!isDate(from) || (to !== null && (!isDate(to) || to < from))) {
    return { status: 400, code: 'invalid_dates', message: 'Give the day the price starts, and the day it ends (on or after it) or null, as YYYY-MM-DD.' };
  }
  return { founder_price_minor: founder, cost_minor: cost, currency, cadence, effective_from: from, effective_to: to };
}

r.post('/:uid/coverage/:cuid/prices', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  if (has(b, 'cost_minor')) {
    const bar = await superAdminWrite(c, admin, 'records what a partner costs');
    if (bar) return bar;
  }
  const input = readPrice(b);
  if (isRefusal(input)) return deny(c, input);
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const v = await c.env.DB.prepare('SELECT id, uid FROM formation_partner_coverage WHERE uid = ? AND formation_partner_id = ?')
      .bind(c.req.param('cuid'), f.id).first<any>();
    if (!v) return refuse(c, 404, { code: 'coverage_not_found', message: 'This partner has no coverage with that reference.' });
    const row = await c.env.DB.prepare(
      `INSERT INTO formation_partner_prices (coverage_id, founder_price_minor, cost_minor, currency, cadence, effective_from, effective_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING uid`,
    ).bind(v.id, input.founder_price_minor, input.cost_minor, input.currency, input.cadence, input.effective_from, input.effective_to, admin.id).first<any>();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.price_added', {
      uid: f.uid, coverage_uid: v.uid, price_uid: row.uid, currency: input.currency, cost_recorded: input.cost_minor !== null,
    });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)), 201);
  } catch (e) { return unsaved(c, e); }
});

r.patch('/:uid/prices/:puid', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  if (has(b, 'cost_minor')) {
    const bar = await superAdminWrite(c, admin, 'records what a partner costs');
    if (bar) return bar;
  }
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    const p = await c.env.DB.prepare(
      `SELECT pr.* FROM formation_partner_prices pr JOIN formation_partner_coverage v ON v.id = pr.coverage_id
        WHERE pr.uid = ? AND v.formation_partner_id = ?`,
    ).bind(c.req.param('puid'), f.id).first<any>();
    if (!p) return refuse(c, 404, { code: 'price_not_found', message: 'This partner has no price with that reference.' });
    const input = readPrice(b, p);
    if (isRefusal(input)) return deny(c, input);
    await c.env.DB.prepare(
      `UPDATE formation_partner_prices SET founder_price_minor = ?, cost_minor = ?, currency = ?, cadence = ?,
              effective_from = ?, effective_to = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(input.founder_price_minor, input.cost_minor, input.currency, input.cadence, input.effective_from, input.effective_to, p.id).run();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.price_updated', { uid: f.uid, price_uid: p.uid, fields: Object.keys(b) });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)));
  } catch (e) { return unsaved(c, e); }
});

/* ------------------------------------------------------------------ *
 * Verify, suspend, end: the Super Admin's
 * ------------------------------------------------------------------ */

r.post('/:uid/verify', async (c) => {
  const admin = await requireHqAdmin(c);
  const bar = await superAdminWrite(c, admin, 'verifies a formation partner');
  if (bar) return bar;
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  const checked = textOrNull(b.what_was_checked, TEXT_MAX);
  if (!checked || checked === 'bad') {
    return refuse(c, 400, { code: 'what_was_checked_required', message: `Say what was checked to verify this partner, in at most ${TEXT_MAX} characters.` });
  }
  if (!isDate(b.next_review_on)) return refuse(c, 400, { code: 'invalid_date', message: 'The next review is a date, YYYY-MM-DD.' });
  try {
    const f = await loadPartner(c);
    if (f instanceof Response) return f;
    const no = verifyRefusal(f);
    if (no) return deny(c, no);
    const res = await c.env.DB.prepare(
      `UPDATE formation_partners SET status = 'verified', verified_by = ?, verified_at = datetime('now'), what_was_checked = ?,
              next_review_on = ?, status_reason = NULL, status_changed_by = ?, status_changed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status IN ('draft', 'suspended') AND dpa_signed_on IS NOT NULL`,
    ).bind(admin.id, checked, b.next_review_on, admin.id, f.id).run();
    if (!res.meta?.changes) return refuse(c, 409, { code: 'partner_changed', message: 'The partner changed while you were verifying it. Reload and try again.' });
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.verified', { uid: f.uid, from: f.status, next_review_on: b.next_review_on });
    return c.json(await readPartner(c.env, await partnerByUid(c.env, f.uid), true));
  } catch (e) { return unsaved(c, e); }
});

async function changeStatus(c: Ctx, to: 'suspended' | 'ended') {
  const admin = await requireHqAdmin(c);
  const bar = await superAdminWrite(c, admin, to === 'suspended' ? 'suspends a formation partner' : 'ends a formation partner');
  if (bar) return bar;
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  const reason = textOrNull(b.reason, TEXT_MAX);
  if (!reason || reason === 'bad') return refuse(c, 400, { code: 'reason_required', message: `Give the reason, in at most ${TEXT_MAX} characters.` });
  const from = to === 'suspended' ? (['verified'] as const) : (['draft', 'verified', 'suspended'] as const);
  try {
    const f = await loadPartner(c);
    if (f instanceof Response) return f;
    if (!(from as readonly string[]).includes(f.status)) {
      return to === 'suspended'
        ? refuse(c, 409, { code: 'partner_not_verified', message: 'Only a verified partner can be suspended.' })
        : deny(c, ENDED);
    }
    const [status, coverage] = await c.env.DB.batch(statusChangeBatch(c.env, f.id, to, from, admin.id, reason));
    if (!status.meta?.changes) return refuse(c, 409, { code: 'partner_changed', message: 'The partner changed while you were working on it. Reload and try again.' });
    await logAdminAction(c.env, admin.id, admin.email, `formation_partner.${to}`, {
      uid: f.uid, from: f.status, reason, coverage_switched_off: Number(coverage.meta?.changes ?? 0),
    });
    return c.json(await readPartner(c.env, await partnerByUid(c.env, f.uid), true));
  } catch (e) { return unsaved(c, e); }
}
r.post('/:uid/suspend', (c) => changeStatus(c, 'suspended'));
r.post('/:uid/end', (c) => changeStatus(c, 'ended'));

/* ------------------------------------------------------------------ *
 * Members
 * ------------------------------------------------------------------ */

r.post('/:uid/members', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await body(c);
  if (!b) return deny(c, BAD_BODY);
  if (!isPositiveId(b.user_id)) return refuse(c, 400, { code: 'user_required', message: 'Name the member by their user id.' });
  if (!isOneOf(MEMBER_ROLES, b.role)) return refuse(c, 400, { code: 'invalid_role', message: `The role is one of ${MEMBER_ROLES.join(', ')}.` });
  try {
    const f = await loadPartner(c, { writable: true });
    if (f instanceof Response) return f;
    if (!(await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(b.user_id).first())) {
      return refuse(c, 404, { code: 'user_not_found', message: 'No member has that id.' });
    }
    const live = await c.env.DB.prepare('SELECT uid FROM formation_partner_members WHERE formation_partner_id = ? AND user_id = ? AND revoked_at IS NULL')
      .bind(f.id, b.user_id).first<any>();
    if (live) return refuse(c, 409, { code: 'member_exists', message: 'This member already acts for the partner. Revoke it first to change the role.', extra: { uid: live.uid } });
    const row = await c.env.DB.prepare(
      `INSERT INTO formation_partner_members (formation_partner_id, user_id, role, granted_by) VALUES (?, ?, ?, ?) RETURNING uid`,
    ).bind(f.id, b.user_id, b.role, admin.id).first<any>();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.member_added', { uid: f.uid, member_uid: row.uid, target_user_id: b.user_id, role: b.role });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)), 201);
  } catch (e) { return unsaved(c, e); }
});

r.post('/:uid/members/:muid/revoke', async (c) => {
  const admin = await requireHqAdmin(c);
  try {
    const f = await loadPartner(c);
    if (f instanceof Response) return f;
    const m = await c.env.DB.prepare('SELECT id, uid, user_id, revoked_at FROM formation_partner_members WHERE uid = ? AND formation_partner_id = ?')
      .bind(c.req.param('muid'), f.id).first<any>();
    if (!m) return refuse(c, 404, { code: 'member_not_found', message: 'This partner has no member with that reference.' });
    if (m.revoked_at) return refuse(c, 409, { code: 'member_revoked', message: 'This membership is already revoked.' });
    await c.env.DB.prepare(`UPDATE formation_partner_members SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ? AND revoked_at IS NULL`)
      .bind(admin.id, m.id).run();
    await logAdminAction(c.env, admin.id, admin.email, 'formation_partner.member_revoked', { uid: f.uid, member_uid: m.uid, target_user_id: Number(m.user_id) });
    return c.json(await readPartner(c.env, f, isSuperAdmin(admin)));
  } catch (e) { return unsaved(c, e); }
});

export default r;

/** #4105: mounts itself; nothing else answers under this path. */
export const mount: RouteMount = { path: '/api/admin/formation/partners', router: r };
