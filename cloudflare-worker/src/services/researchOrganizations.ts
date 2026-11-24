/**
 * D7826 (#7826): Research organizations: roles from a closed set, the catalogue records an organization owns, and
 * sourced relationships between organizations, over the tables of migration 202611241148_7826.
 *
 * CLUES NEVER LINK. Nothing here reads a manager name (the vehicle facts table, the statement store of #7743 or a
 * fund row's name) and nothing derives a link, role or relationship from one. Every row is an admin write with its
 * source. Both ends of a relationship are organizations, so no person is ever at either end.
 *
 * KIND AND ROLE. A fund row's kind is #7744's `record_kind` (vehicle, manager, accelerator, resource) and is not
 * restated here. Role fund_manager corresponds to kind manager, fund_vehicle to vehicle and accelerator to
 * accelerator. A link to a fund record whose recorded kind contradicts the organization's roles, or whose kind is
 * resource (not an organization), is refused with a reason code; a fund row with no recorded kind is allowed. The
 * kind is read from the served row's own columns (`f.*`), so a catalogue without the column reads every row as not
 * recorded; this file names no kind column in SQL.
 *
 * ACCESS (one decision for every read). A company link, and anything derived from a company record, is shown only
 * to an account the Companies rule admits (D7178, `admitsCompanies`) and only while D7819's served rows serve that
 * record. An organization with a company link the caller cannot see is not shown to that caller at all, because its
 * name and roles are derived from that record. A fund link is shown only while `SERVED_FUNDS` serves the row,
 * following a moved fund uid one hop; a linked fund answers as its uid, name and, where recorded, kind, and nothing
 * else (no statement, no vehicle fact). An organization with no link the caller can see is not shown. What the caller
 * may not read is left out and nothing is said about it. Only confirmed links count.
 *
 * WRITERS. The admin writes here insert into the `research_organization*` tables only: never into the fund
 * catalogue, and never into a `network_directory_*` table.
 */
import type { Env, User } from '../types';
import { admitsCompanies } from './researchCompaniesAccess';
import { readCompaniesByUid } from './researchCompanyRead';
import { SERVED_FUNDS } from './researchFundDirectory';

export const ORGANIZATION_ROLES = Object.freeze([
  'operating_company', 'registered_investment_adviser', 'fund_manager', 'fund_vehicle', 'accelerator',
  'venture_capital', 'corporate_venture', 'growth_private_equity', 'family_office', 'lender', 'corporate_group', 'other',
] as const);
export const RELATIONS = Object.freeze(['manages', 'advises', 'vehicle_of', 'member_of_group', 'invested_in'] as const);
export const RECORD_TYPES = Object.freeze(['company', 'fund'] as const);
export const LINK_ORIGINS = Object.freeze(['source_record', 'reviewed'] as const);
export const INVESTOR_ROLES = Object.freeze(['lead', 'co_lead', 'participant'] as const);
/** #7744's fund row kinds. */
export const FUND_RECORD_KINDS = Object.freeze(['vehicle', 'manager', 'accelerator', 'resource'] as const);
/** The roles that correspond to a fund row kind. */
export const ROLE_KIND: Readonly<Record<string, string>> = Object.freeze({
  fund_manager: 'manager', fund_vehicle: 'vehicle', accelerator: 'accelerator',
});

export type Role = (typeof ORGANIZATION_ROLES)[number];
export type RecordType = (typeof RECORD_TYPES)[number];

const UID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/[^\s<>"']{1,1990}$/;
const CURRENCY = /^[A-Z]{3}$/;

export class OrganizationInputError extends Error {
  code: string;
  detail: string;
  status: number;
  constructor(code: string, detail: string, status = 400) { super(code); this.code = code; this.detail = detail; this.status = status; }
}
const notFound = () => new OrganizationInputError('not_found', 'Not found', 404);

export function parseUid(v: unknown): string {
  if (typeof v !== 'string' || !UID.test(v)) throw notFound();
  return v;
}
export function parseRecordType(v: unknown): RecordType {
  if (!RECORD_TYPES.includes(v as RecordType)) throw notFound();
  return v as RecordType;
}

const text = (v: unknown, max: number, field: string, required = false): string | null => {
  if (v == null || (typeof v === 'string' && !v.trim())) {
    if (required) throw new OrganizationInputError('field_required', `${field} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw new OrganizationInputError('invalid_field', `${field} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new OrganizationInputError('field_too_long', `${field} is longer than ${max} characters.`);
  return t;
};
const https = (v: unknown, field: string, required = false): string | null => {
  const t = text(v, 2000, field, required);
  if (t !== null && !HTTPS.test(t)) throw new OrganizationInputError('invalid_url', `${field} must be an https link.`);
  return t;
};
const day = (v: unknown, field: string): string => {
  const t = text(v, 10, field, true)!;
  if (!DAY.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) throw new OrganizationInputError('invalid_date', `${field} must be a date as YYYY-MM-DD.`);
  return t;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], code: string, field: string): T => {
  if (!list.includes(v as T)) throw new OrganizationInputError(code, `${field} must be one of: ${list.join(', ')}.`);
  return v as T;
};
const isUnique = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as any)?.message ?? e));

type OrgRow = { id: number; uid: string; name: string };

async function orgByUid(env: Pick<Env, 'DB'>, uid: string): Promise<OrgRow | null> {
  return (await env.DB.prepare('SELECT id, uid, name FROM research_organizations WHERE uid = ?').bind(uid).first<OrgRow>()) ?? null;
}
async function requireOrg(env: Pick<Env, 'DB'>, uid: string): Promise<OrgRow> {
  const org = await orgByUid(env, parseUid(uid));
  if (!org) throw notFound();
  return org;
}

// ── fund rows: served, one move hop, uid + name + kind only ───────────────────

type FundAnswer = { uid: string; name: string; record_kind: string | null };

/** The fund row `SERVED_FUNDS` serves for `uid`, following a moved uid one hop; null when it serves none. */
export async function servedFund(env: Pick<Env, 'DB'>, uid: string): Promise<FundAnswer | null> {
  const read = (u: string) => env.DB.prepare(`SELECT f.* FROM ${SERVED_FUNDS} AS f WHERE f.uid = ?`).bind(u).first<Record<string, unknown>>();
  let row = await read(uid);
  if (!row) {
    const move = await env.DB.prepare('SELECT new_uid FROM research_fund_directory_uid_moves WHERE old_uid = ?')
      .bind(uid).first<{ new_uid: string }>();
    if (move?.new_uid) row = await read(move.new_uid);
  }
  if (!row) return null;
  const kind = (row as Record<string, unknown>).record_kind;
  return {
    uid: String(row.uid),
    name: String(row.name),
    record_kind: FUND_RECORD_KINDS.includes(kind as any) ? (kind as string) : null,
  };
}

/** The current uid of a fund uid that moved, else the uid itself. */
async function currentFundUid(env: Pick<Env, 'DB'>, uid: string): Promise<string> {
  const move = await env.DB.prepare('SELECT new_uid FROM research_fund_directory_uid_moves WHERE old_uid = ?')
    .bind(uid).first<{ new_uid: string }>();
  return move?.new_uid || uid;
}

/** A company record the served rows serve, as uid and name; null for missing, excluded or withdrawn. */
async function servedCompanies(env: Pick<Env, 'DB'>, uids: string[]): Promise<Map<string, { uid: string; name: string }>> {
  const out = new Map<string, { uid: string; name: string }>();
  if (!uids.length) return out;
  const rows = await readCompaniesByUid(env, uids);
  rows.forEach((row: any, i) => {
    if (row && row.id && row.review_status !== 'excluded' && row.review_status !== 'withdrawn') out.set(uids[i], { uid: row.uid, name: row.name });
  });
  return out;
}

/**
 * The refusal reason for linking `org` to a fund row of `kind` given the organization's roles, or null when allowed.
 * `kind` null (not recorded) is always allowed.
 */
export function kindConflict(roles: readonly string[], kind: string | null): string | null {
  if (kind === null) return null;
  if (kind === 'resource') return 'record_kind_not_organization';
  const kinds = roles.map((r) => ROLE_KIND[r]).filter(Boolean);
  if (kinds.length && !kinds.includes(kind)) return 'role_contradicts_record_kind';
  return null;
}
const KIND_SENTENCE: Record<string, string> = {
  record_kind_not_organization: 'This fund record is a resource, not an organization, so no organization can own it.',
  role_contradicts_record_kind: "This fund record's kind contradicts the organization's role.",
};

async function rolesOf(env: Pick<Env, 'DB'>, orgId: number): Promise<string[]> {
  const r = await env.DB.prepare('SELECT role FROM research_organization_roles WHERE organization_id = ?').bind(orgId).all<{ role: string }>();
  return (r.results || []).map((x) => x.role);
}

// ── admin writes ─────────────────────────────────────────────────────────────

/** Admin: a new organization with its name. Its uid is generated. */
export async function createOrganization(env: Pick<Env, 'DB'>, body: any, actorId: number) {
  const name = text(body?.name, 300, 'name', true)!;
  const uid = `org-${crypto.randomUUID()}`;
  await env.DB.prepare('INSERT INTO research_organizations (uid, name, created_by_user_id) VALUES (?, ?, ?)').bind(uid, name, actorId).run();
  return { organization_uid: uid, name };
}

/** Admin: add a role from the closed set, with its source and the date the source states it. */
export async function addRole(env: Pick<Env, 'DB'>, orgUid: string, body: any, actorId: number) {
  const org = await requireOrg(env, orgUid);
  const role = oneOf(body?.role, ORGANIZATION_ROLES, 'invalid_role', 'role');
  const sourceName = text(body?.source_name, 300, 'source_name', true)!;
  const sourceUrl = https(body?.source_url, 'source_url');
  const statedOn = day(body?.stated_on, 'stated_on');
  if (ROLE_KIND[role]) {
    // The new role must not contradict a fund record the organization already owns.
    const roles = [...(await rolesOf(env, org.id)), role];
    const links = await env.DB.prepare(`SELECT record_uid FROM research_organization_record_links
      WHERE organization_id = ? AND record_type = 'fund' AND state <> 'withdrawn'`).bind(org.id).all<{ record_uid: string }>();
    for (const link of links.results || []) {
      const fund = await servedFund(env, link.record_uid);
      const conflict = kindConflict(roles, fund?.record_kind ?? null);
      if (conflict) throw new OrganizationInputError(conflict, KIND_SENTENCE[conflict], 409);
    }
  }
  try {
    await env.DB.prepare(`INSERT INTO research_organization_roles (organization_id, role, source_name, source_url, stated_on, recorded_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(org.id, role, sourceName, sourceUrl, statedOn, actorId).run();
  } catch (e) {
    if (isUnique(e)) throw new OrganizationInputError('role_already_recorded', 'This organization already has this role.', 409);
    throw e;
  }
  return { organization_uid: org.uid, role, source_name: sourceName, source_url: sourceUrl, stated_on: statedOn };
}

/**
 * Admin: confirm a link from the organization to a catalogue record. A record belongs to at most one organization.
 * The record must be one the catalogue serves (a company in D7819's served rows; a fund in `SERVED_FUNDS`, stored
 * under its current uid after a move). A fund whose kind contradicts the organization's roles is refused.
 */
export async function confirmLink(env: Pick<Env, 'DB'>, orgUid: string, body: any, actorId: number) {
  const org = await requireOrg(env, orgUid);
  const recordType = oneOf(body?.record_type, RECORD_TYPES, 'invalid_record_type', 'record_type');
  const asked = text(body?.record_uid, 64, 'record_uid', true)!;
  if (!UID.test(asked)) throw new OrganizationInputError('record_not_found', 'No served record has this uid.', 404);
  const origin = oneOf(body?.origin ?? 'reviewed', LINK_ORIGINS, 'invalid_origin', 'origin');
  const sourceName = text(body?.source_name, 300, 'source_name');
  const sourceUrl = https(body?.source_url, 'source_url');
  let recordUid = asked;
  if (recordType === 'company') {
    if (!(await servedCompanies(env, [asked])).has(asked)) throw new OrganizationInputError('record_not_found', 'No served record has this uid.', 404);
  } else {
    const fund = await servedFund(env, asked);
    if (!fund) throw new OrganizationInputError('record_not_found', 'No served record has this uid.', 404);
    recordUid = fund.uid;
    const conflict = kindConflict(await rolesOf(env, org.id), fund.record_kind);
    if (conflict) throw new OrganizationInputError(conflict, KIND_SENTENCE[conflict], 409);
  }
  const existing = await env.DB.prepare(`SELECT id, organization_id, state FROM research_organization_record_links
    WHERE record_type = ? AND record_uid = ? AND state <> 'withdrawn'`).bind(recordType, recordUid).first<{ id: number; organization_id: number; state: string }>();
  if (existing && existing.organization_id !== org.id) {
    throw new OrganizationInputError('record_already_linked', 'This record already belongs to another organization.', 409);
  }
  if (existing?.state === 'confirmed') return { organization_uid: org.uid, record_type: recordType, record_uid: recordUid, state: 'confirmed', changed: false };
  try {
    if (existing) {
      await env.DB.prepare(`UPDATE research_organization_record_links SET state = 'confirmed', confirmed_at = datetime('now'), confirmed_by_user_id = ?,
        source_name = COALESCE(?, source_name), source_url = COALESCE(?, source_url) WHERE id = ? AND state = 'proposed'`)
        .bind(actorId, sourceName, sourceUrl, existing.id).run();
    } else {
      await env.DB.prepare(`INSERT INTO research_organization_record_links
        (organization_id, record_type, record_uid, origin, state, source_name, source_url, confirmed_at, confirmed_by_user_id)
        VALUES (?, ?, ?, ?, 'confirmed', ?, ?, datetime('now'), ?)`).bind(org.id, recordType, recordUid, origin, sourceName, sourceUrl, actorId).run();
    }
  } catch (e) {
    if (isUnique(e)) throw new OrganizationInputError('record_already_linked', 'This record already belongs to another organization.', 409);
    throw e;
  }
  return { organization_uid: org.uid, record_type: recordType, record_uid: recordUid, state: 'confirmed', changed: true };
}

/**
 * Admin: add a relationship from this organization to another. A relationship without its source link, where in
 * the source it is stated and the source's date is refused. Only 'invested_in' carries an investor role, an amount
 * (with its currency, where the source states it) or a funding round row.
 */
export async function addRelationship(env: Pick<Env, 'DB'>, subjectUid: string, body: any, actorId: number) {
  const subject = await requireOrg(env, subjectUid);
  const relation = oneOf(body?.relation, RELATIONS, 'invalid_relation', 'relation');
  if (!body?.source_url || !body?.source_locator || !body?.stated_on) {
    throw new OrganizationInputError('source_required', 'A relationship needs its source link, where in the source it is stated, and the date.');
  }
  const sourceUrl = https(body.source_url, 'source_url', true)!;
  const locator = text(body.source_locator, 500, 'source_locator', true)!;
  const statedOn = day(body.stated_on, 'stated_on');
  const objectUid = text(body?.object_uid, 64, 'object_uid', true)!;
  const object = await orgByUid(env, UID.test(objectUid) ? objectUid : '');
  if (!object) throw new OrganizationInputError('organization_not_found', 'object_uid names no organization.', 404);
  if (object.id === subject.id) throw new OrganizationInputError('same_organization', 'A relationship joins two different organizations.');
  let investorRole: string | null = null, amount: number | null = null, currency: string | null = null, roundId: number | null = null;
  const extras = body.investor_role != null || body.amount_minor != null || body.amount_currency != null || body.funding_round_id != null;
  if (extras && relation !== 'invested_in') {
    throw new OrganizationInputError('fields_invested_in_only', 'An investor role, an amount and a funding round belong to invested_in only.');
  }
  if (relation === 'invested_in') {
    if (body.investor_role != null) investorRole = oneOf(body.investor_role, INVESTOR_ROLES, 'invalid_investor_role', 'investor_role');
    if ((body.amount_minor == null) !== (body.amount_currency == null)) {
      throw new OrganizationInputError('amount_needs_currency', 'An amount is recorded only with its currency.');
    }
    if (body.amount_minor != null) {
      if (!Number.isSafeInteger(body.amount_minor) || body.amount_minor <= 0) throw new OrganizationInputError('invalid_amount', 'amount_minor must be a whole number above 0.');
      if (typeof body.amount_currency !== 'string' || !CURRENCY.test(body.amount_currency)) throw new OrganizationInputError('invalid_currency', 'amount_currency must be a three-letter code.');
      amount = body.amount_minor; currency = body.amount_currency;
    }
    if (body.funding_round_id != null) {
      if (!Number.isSafeInteger(body.funding_round_id) || body.funding_round_id <= 0) throw new OrganizationInputError('invalid_funding_round', 'funding_round_id must be a round id.');
      const round = await env.DB.prepare('SELECT funding_round_id FROM company_funding_rounds WHERE funding_round_id = ?').bind(body.funding_round_id).first();
      if (!round) throw new OrganizationInputError('funding_round_not_found', 'funding_round_id names no round.', 404);
      roundId = body.funding_round_id;
    }
  }
  try {
    await env.DB.prepare(`INSERT INTO research_organization_relationships
      (subject_organization_id, relation, object_organization_id, source_url, source_locator, stated_on,
       investor_role, amount_minor, amount_currency, funding_round_id, recorded_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(subject.id, relation, object.id, sourceUrl, locator, statedOn, investorRole, amount, currency, roundId, actorId).run();
  } catch (e) {
    if (isUnique(e)) throw new OrganizationInputError('relationship_already_recorded', 'This relationship is already recorded from this source.', 409);
    throw e;
  }
  return { organization_uid: subject.uid, relation, object_uid: object.uid, source_url: sourceUrl, source_locator: locator, stated_on: statedOn };
}

// ── reads: one access decision ───────────────────────────────────────────────

type Viewer = { admitted: boolean };
export function viewerOf(user: User): Viewer {
  return { admitted: admitsCompanies(user as any) };
}

type Visible = { org: OrgRow; records: Array<{ type: 'company'; uid: string; name: string } | ({ type: 'fund' } & FundAnswer)> };

/** The organization as this viewer may see it, or null when nothing of it may be shown. */
async function visibleOrg(env: Pick<Env, 'DB'>, org: OrgRow, viewer: Viewer): Promise<Visible | null> {
  const links = await env.DB.prepare(`SELECT record_type, record_uid FROM research_organization_record_links
    WHERE organization_id = ? AND state = 'confirmed' ORDER BY record_type, record_uid`).bind(org.id).all<{ record_type: string; record_uid: string }>();
  const rows = links.results || [];
  const companyUids = rows.filter((l) => l.record_type === 'company').map((l) => l.record_uid);
  if (companyUids.length && !viewer.admitted) return null;
  const served = await servedCompanies(env, companyUids);
  if (companyUids.some((u) => !served.has(u))) return null;
  const records: Visible['records'] = companyUids.map((u) => ({ type: 'company' as const, ...served.get(u)! }));
  for (const l of rows.filter((x) => x.record_type === 'fund')) {
    const fund = await servedFund(env, l.record_uid);
    if (fund) records.push({ type: 'fund', ...fund });
  }
  return records.length ? { org, records } : null;
}

async function present(env: Pick<Env, 'DB'>, v: Visible, viewer: Viewer) {
  const [roles, rels] = await Promise.all([
    env.DB.prepare(`SELECT role, source_name, source_url, stated_on FROM research_organization_roles WHERE organization_id = ? ORDER BY role`)
      .bind(v.org.id).all<any>(),
    env.DB.prepare(`SELECT r.relation, r.subject_organization_id, r.object_organization_id, r.source_url, r.source_locator, r.stated_on,
        r.investor_role, r.amount_minor, r.amount_currency, r.funding_round_id,
        o.id AS other_id, o.uid AS other_uid, o.name AS other_name
      FROM research_organization_relationships r
      JOIN research_organizations o ON o.id = CASE WHEN r.subject_organization_id = ? THEN r.object_organization_id ELSE r.subject_organization_id END
      WHERE (r.subject_organization_id = ? OR r.object_organization_id = ?) AND r.state = 'recorded'
      ORDER BY r.relation, o.uid, r.id`).bind(v.org.id, v.org.id, v.org.id).all<any>(),
  ]);
  const relationships = [];
  const seen = new Map<number, Visible | null>();
  for (const r of rels.results || []) {
    if (!seen.has(r.other_id)) seen.set(r.other_id, await visibleOrg(env, { id: r.other_id, uid: r.other_uid, name: r.other_name }, viewer));
    const other = seen.get(r.other_id);
    if (!other) continue;
    relationships.push({
      relation: r.relation,
      direction: r.subject_organization_id === v.org.id ? 'outgoing' : 'incoming',
      organization: { uid: other.org.uid, name: other.org.name, records: other.records },
      source_url: r.source_url, source_locator: r.source_locator, stated_on: r.stated_on,
      ...(r.relation === 'invested_in' ? {
        investor_role: r.investor_role ?? null,
        amount: r.amount_minor == null ? null : { amount_minor: r.amount_minor, currency: r.amount_currency },
        funding_round_id: r.funding_round_id ?? null,
      } : {}),
    });
  }
  return {
    uid: v.org.uid,
    name: v.org.name,
    roles: (roles.results || []).map((r: any) => ({ role: r.role, source_name: r.source_name, source_url: r.source_url ?? null, stated_on: r.stated_on })),
    records: v.records,
    relationships,
  };
}

/** An organization with its roles, relationships and linked records, as this viewer may see it; null otherwise. */
export async function readOrganization(env: Pick<Env, 'DB'>, user: User, uid: string) {
  const org = await orgByUid(env, parseUid(uid));
  if (!org) return null;
  const viewer = viewerOf(user);
  const v = await visibleOrg(env, org, viewer);
  return v ? present(env, v, viewer) : null;
}

/**
 * The organization of a record, by the record's uid (a moved fund uid is followed one hop). Answers null when no
 * organization owns the record or the viewer may not see it; the route refuses a company record to an account the
 * Companies rule does not admit before this is called.
 */
export async function organizationOfRecord(env: Pick<Env, 'DB'>, user: User, type: RecordType, uid: string) {
  const asked = parseUid(uid);
  const recordUid = type === 'fund' ? await currentFundUid(env, asked) : asked;
  const link = await env.DB.prepare(`SELECT o.id, o.uid, o.name FROM research_organization_record_links l
    JOIN research_organizations o ON o.id = l.organization_id
    WHERE l.record_type = ? AND l.record_uid = ? AND l.state = 'confirmed'`).bind(type, recordUid).first<OrgRow>();
  if (!link) return null;
  const viewer = viewerOf(user);
  const v = await visibleOrg(env, link, viewer);
  if (!v || !v.records.some((r) => r.type === type && r.uid === recordUid)) return null;
  return present(env, v, viewer);
}
