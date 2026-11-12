/**
 * D5060 (#5060, user licences 4/4 under #5047) — HQ's one registry of every Axal VC licence, read from the shared
 * identity D5057 created (`licences`): operator licences (territory, white label, master franchise) and user
 * licences (Founder, Investor, Operating Partner, Advisor) in one list, and a detail read shaped by the family.
 *
 * WHAT A ROW CARRIES. Ref, holder, type, status, renewal, agreement, packages, programs and attention. The
 * territory block (countries, kind, brand, legal entity) is on an operator row only; a user row has no
 * `territory` key at all, so no franchise field reaches it.
 *
 * NOTHING IS GUESSED.
 *   - A store this database does not have is "Not recorded" with its reason (`notRecorded`), never an empty list.
 *   - A store that fails to read is "Unreadable" for that section of every row (`unreadable`), never zero and
 *     never "none".
 *   - A user licence's program entitlements are #5059's: `programs` is Not recorded, naming #5059.
 *   - A user licence agreement is the e-sign envelope of its Contracts template
 *     (`USER_LICENCE_AGREEMENT_TEMPLATES`, `services/contractAgreementSources.ts`). The agreement this read names
 *     is the envelope uuid, the same `agreement_uid` Contracts' row carries for it.
 *
 * Every statement is literal SQL with its values bound; lists ride `json_each(?)`. No `${…}` reaches a query.
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import { eventsOf } from './userLicences';
import {
  LICENCE_TYPE_LABELS, licenceContractLegalStatus, loadUserLicenceAgreements,
  programAgreementLegalStatus, userLicenceTemplateFor, type AgreementContext, type LegalStatus, LEGAL_STATUS_LABELS,
} from './contractAgreementSources';

/** The registry's family filter, as HQ's Licences page offers it (#5060). `all` filters nothing. */
export const REGISTRY_FAMILIES = ['all', 'operator', 'founder', 'investor', 'operating_partner', 'advisor'] as const;
export type RegistryFamily = typeof REGISTRY_FAMILIES[number];
export const REGISTRY_PAGE_DEFAULT = 50;
export const REGISTRY_PAGE_MAX = 100;
/** A licence whose renewal or end falls within this many days is due. */
export const RENEWAL_DUE_DAYS = 30;
/** Statuses in which a licence is in force, for both families (territory `active`; D5058's `renewal_pending`). */
const IN_FORCE = ['active', 'renewal_pending'];

export class RegistryRefusal extends Error {
  status: 400 | 404;
  code: string;
  sentence: string;
  constructor(status: 400 | 404, code: string, sentence: string) {
    super(code);
    this.status = status; this.code = code; this.sentence = sentence;
  }
}

export type NotRecorded = { available: false; state: 'not_recorded'; reason: string };
export type Unreadable = { available: false; state: 'unreadable'; reason: string };
export const notRecorded = (reason: string): NotRecorded => ({ available: false, state: 'not_recorded', reason });
export const unreadable = (what: string): Unreadable => ({ available: false, state: 'unreadable', reason: `${what} could not be read. Retry; this is not "none".` });

const MISSING_TABLE = /no such table/i;
const missing = (e: unknown) => MISSING_TABLE.test(String((e as Error)?.message ?? e));
const HOLDER = /^(user|entity):[A-Za-z0-9_:-]{1,120}$/;
const STATUS = /^[a-z_]{1,40}$/;
const UID = /^[A-Za-z0-9_-]{1,80}$/;
export const ENTITLEMENTS_REASON = 'Program entitlements from a user licence are not recorded yet: #5059 derives them from the licences held.';

export type RegistryQuery = { family: RegistryFamily; holder: { type: string; id: string } | null; status: string | null; q: string | null; limit: number; after: string | null };

/** The query, validated; a value the registry does not know is refused by name. */
export function registryQuery(raw: Record<string, string | undefined>): RegistryQuery {
  const pick = (k: string) => (raw[k] ?? '').trim() || null;
  const family = (pick('family') ?? 'all') as RegistryFamily;
  if (!(REGISTRY_FAMILIES as readonly string[]).includes(family)) throw new RegistryRefusal(400, 'invalid_family', `Choose a licence family: ${REGISTRY_FAMILIES.join(', ')}.`);
  const holderRaw = pick('holder');
  if (holderRaw && !HOLDER.test(holderRaw)) throw new RegistryRefusal(400, 'invalid_holder', 'A holder is user:<account id> or entity:<entity id>.');
  const holder = holderRaw ? { type: holderRaw.slice(0, holderRaw.indexOf(':')), id: holderRaw.slice(holderRaw.indexOf(':') + 1) } : null;
  const status = pick('status');
  if (status && !STATUS.test(status)) throw new RegistryRefusal(400, 'invalid_status', 'Choose a licence status.');
  const q = pick('q');
  if (q && q.length > 120) throw new RegistryRefusal(400, 'invalid_query', 'Search with at most 120 characters.');
  const n = Math.floor(Number(pick('limit') ?? REGISTRY_PAGE_DEFAULT));
  const limit = Number.isFinite(n) && n >= 1 ? Math.min(REGISTRY_PAGE_MAX, n) : REGISTRY_PAGE_DEFAULT;
  let after: string | null = null;
  const cursor = pick('cursor');
  if (cursor) {
    try { after = String(JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))).after); }
    catch { throw new RegistryRefusal(400, 'invalid_cursor', 'That page cursor is not one this registry issued.'); }
    if (!after || after.length > 60) throw new RegistryRefusal(400, 'invalid_cursor', 'That page cursor is not one this registry issued.');
  }
  return { family, holder, status, q, limit, after };
}

const cursorOf = (ref: string) => btoa(JSON.stringify({ after: ref })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The family filter as the two columns it reads. */
function familyColumns(f: RegistryFamily): { family: string | null; type: string | null } {
  if (f === 'all') return { family: null, type: null };
  if (f === 'operator') return { family: 'operator', type: null };
  return { family: 'user', type: f };
}

const LIST_SELECT = `
  SELECT l.uid, l.licence_ref, l.licence_family, l.licence_type, l.holder_type, l.holder_id, l.status,
         l.starts_on, l.ends_on, l.renews_on, l.revision, l.territory_licence_id,
         t.legal_entity_name, t.brand_name, t.kind AS territory_kind,
         en.name AS entity_name, u.name AS user_name, u.email AS user_email
    FROM licences l
    LEFT JOIN territory_licences t ON t.id = l.territory_licence_id
    LEFT JOIN entities en ON l.holder_type = 'entity' AND en.id = CAST(l.holder_id AS INTEGER)
    LEFT JOIN users u ON l.holder_type = 'user' AND u.id = CAST(l.holder_id AS INTEGER)`;

const LIST_WHERE = `
   WHERE (? IS NULL OR l.licence_family = ?)
     AND (? IS NULL OR l.licence_type = ?)
     AND (? IS NULL OR (l.holder_type = ? AND l.holder_id = ?))
     AND (? IS NULL OR l.status = ?)
     AND (? IS NULL OR lower(l.licence_ref) LIKE ? ESCAPE '\\' OR lower(COALESCE(t.legal_entity_name, '')) LIKE ? ESCAPE '\\'
          OR lower(COALESCE(t.brand_name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(en.name, '')) LIKE ? ESCAPE '\\'
          OR lower(COALESCE(u.name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(u.email, '')) LIKE ? ESCAPE '\\')`;

// The three statements, whole, from the two constant fragments above (no value is ever spliced into them).
const PAGE_SQL = LIST_SELECT + LIST_WHERE + ' AND (? IS NULL OR l.licence_ref > ?) ORDER BY l.licence_ref LIMIT ?';
const COUNT_SQL = 'SELECT COUNT(*) AS n FROM (' + LIST_SELECT + LIST_WHERE + ')';
const DETAIL_SQL = LIST_SELECT + ' WHERE l.uid = ?';

function whereBinds(q: RegistryQuery): unknown[] {
  const { family, type } = familyColumns(q.family);
  const like = q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  return [
    family, family, type, type,
    q.holder ? 1 : null, q.holder?.type ?? null, q.holder?.id ?? null,
    q.status, q.status,
    like, like, like, like, like, like, like,
  ];
}

type LicenceRowOut = Record<string, any>;

function holderOf(r: any) {
  if (r.holder_type === 'user') {
    return { type: 'user', id: String(r.holder_id), name: r.user_name || r.user_email || null, email: r.user_email ?? null,
      reason: r.user_name || r.user_email ? null : 'No account with this id is on file.' };
  }
  const name = r.legal_entity_name || r.brand_name || r.entity_name || null;
  return { type: 'entity', id: String(r.holder_id), name, email: null, reason: name ? null : 'No entity name is recorded for this holder.' };
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** When the licence next renews or ends, and which date that is. */
function renewalOf(r: any) {
  if (r.renews_on) return { on: String(r.renews_on).slice(0, 10), basis: 'renews_on' as const };
  if (r.ends_on) return { on: String(r.ends_on).slice(0, 10), basis: 'ends_on' as const };
  return { on: null, basis: null, reason: 'No renewal or end date is recorded for this licence.' };
}

/** The primary agreement a licence's row summarises. */
type AgreementSummary =
  | { available: true; state: LegalStatus | 'none'; state_label: string; agreement_uid: string | null; store: string | null; template_slug: string | null; signed_at: string | null; reason: string | null }
  | NotRecorded | Unreadable;

const none = (reason: string): AgreementSummary => ({ available: true, state: 'none', state_label: 'None on file', agreement_uid: null, store: null, template_slug: null, signed_at: null, reason });

/** Of one licence's versions, the one a row shows: the executed one in force, else the one in flight, else the newest. */
function primaryOf(versions: Array<{ uid: string; store: string; template_slug: string | null; legal: LegalStatus; signed_at: string | null; created_at: string | null }>): AgreementSummary | null {
  const rank: Record<LegalStatus, number> = { executed: 0, awaiting_signature: 1, draft: 2, superseded: 3, voided: 4 };
  const pick = [...versions].sort((a, b) => rank[a.legal] - rank[b.legal] || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
  if (!pick) return null;
  return { available: true, state: pick.legal, state_label: LEGAL_STATUS_LABELS[pick.legal], agreement_uid: pick.uid, store: pick.store, template_slug: pick.template_slug, signed_at: pick.signed_at, reason: null };
}

/** Each operator licence's master licence agreement (`licence_contracts`), by licence uid. */
async function masterAgreements(env: Env, uids: string[]) {
  const out = new Map<string, any[]>();
  if (!uids.length) return out;
  const rows = await env.DB.prepare(
    `SELECT c.uid, c.licence_uid, c.template_slug, c.status, c.superseded_at, c.signed_at, c.created_at, e.status AS envelope_status, e.completed_at
       FROM licence_contracts c LEFT JOIN esign_envelopes e ON e.envelope_uuid = c.envelope_uid
      WHERE c.licence_uid IN (SELECT value FROM json_each(?)) ORDER BY c.id`,
  ).bind(JSON.stringify(uids)).all<any>();
  for (const r of rows.results || []) out.set(r.licence_uid, [...(out.get(r.licence_uid) || []), r]);
  return out;
}

/** Each licence's package and program agreement versions (`licence_program_agreements`), by licence uid. */
async function programAgreements(env: Env, uids: string[]) {
  const out = new Map<string, any[]>();
  if (!uids.length) return out;
  const rows = await env.DB.prepare(
    `SELECT a.uid, a.licence_uid, a.agreement_kind, a.program_key, a.package_key, a.package_version, a.template_slug, a.status,
            a.envelope_uuid, a.signed_at, a.created_at, e.status AS envelope_status
       FROM licence_program_agreements a LEFT JOIN esign_envelopes e ON e.envelope_uuid = a.envelope_uuid
      WHERE a.licence_uid IN (SELECT value FROM json_each(?)) ORDER BY a.id`,
  ).bind(JSON.stringify(uids)).all<any>();
  for (const r of rows.results || []) out.set(r.licence_uid, [...(out.get(r.licence_uid) || []), r]);
  return out;
}

/** An operator licence's program grants, by territory licence id. */
async function programGrants(env: Env, ids: number[]) {
  const out = new Map<number, any[]>();
  if (!ids.length) return out;
  const rows = await env.DB.prepare(
    'SELECT licence_id, program_key, state FROM program_grants WHERE licence_id IN (SELECT value FROM json_each(?)) ORDER BY program_key',
  ).bind(JSON.stringify(ids)).all<any>();
  for (const r of rows.results || []) out.set(Number(r.licence_id), [...(out.get(Number(r.licence_id)) || []), { program_key: r.program_key, state: r.state }]);
  return out;
}

/** Each operator licence's countries, by territory licence id. */
async function countries(env: Env, ids: number[]) {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  const rows = await env.DB.prepare(
    'SELECT licence_id, country_code FROM licence_territories WHERE licence_id IN (SELECT value FROM json_each(?)) ORDER BY country_code',
  ).bind(JSON.stringify(ids)).all<any>();
  for (const r of rows.results || []) out.set(Number(r.licence_id), [...(out.get(Number(r.licence_id)) || []), String(r.country_code)]);
  return out;
}

/** Runs a section's read; a missing store and a failed read come back as themselves, never as an empty map. */
async function section<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; missing: boolean }> {
  try { return { ok: true, value: await read() }; }
  catch (e) {
    if (missing(e)) return { ok: false, missing: true };
    console.warn('[licence-registry] section unreadable', (e as Error)?.message);
    return { ok: false, missing: false };
  }
}

/** The user licence agreements of these accounts, as Contracts reads them (one canonical uid per document). */
async function userAgreements(env: Env, accountIds: number[]): Promise<AgreementContext[]> {
  if (!accountIds.length) return [];
  const sql = getSQL(env);
  try { return await loadUserLicenceAgreements(sql as any, accountIds); } finally { await sql.end(); }
}

/** Every section of a page of registry rows, read once for the page. */
async function enrich(env: Env, rows: any[]): Promise<LicenceRowOut[]> {
  const operatorUids = rows.filter((r) => r.licence_family === 'operator').map((r) => String(r.uid));
  const allUids = rows.map((r) => String(r.uid));
  const territoryIds = rows.filter((r) => r.territory_licence_id != null).map((r) => Number(r.territory_licence_id));
  const accountIds = [...new Set(rows.filter((r) => r.holder_type === 'user' && /^[1-9][0-9]*$/.test(String(r.holder_id))).map((r) => Number(r.holder_id)))];
  const [masters, versions, grants, terr, users] = await Promise.all([
    section(() => masterAgreements(env, operatorUids)),
    section(() => programAgreements(env, allUids)),
    section(() => programGrants(env, territoryIds)),
    section(() => countries(env, territoryIds)),
    section(() => userAgreements(env, accountIds)),
  ]);
  const now = today();
  return rows.map((r) => {
    const uid = String(r.uid);
    const isUser = r.licence_family === 'user';
    // The primary agreement.
    let agreement: AgreementSummary;
    if (isUser) {
      if (!users.ok) agreement = users.missing ? notRecorded('E-sign envelopes are not on this database.') : unreadable('The user licence agreements');
      else {
        const mine = users.value.filter((a) => a.licence_uid === uid);
        agreement = primaryOf(mine.map((a) => ({ uid: a.agreement_uid, store: a.store, template_slug: a.template_slug, legal: a.legal_status, signed_at: a.signed_at, created_at: a.created_at })))
          ?? none(`No ${userLicenceTemplateFor(r.licence_type)?.title ?? 'licence agreement'} has been sent to this holder.`);
      }
    } else if (r.territory_licence_id == null) {
      agreement = notRecorded(`A ${LICENCE_TYPE_LABELS[r.licence_type] ?? r.licence_type} has no agreement store yet.`);
    } else if (!masters.ok) {
      agreement = masters.missing ? notRecorded('The licence agreement store is not on this database.') : unreadable('The licence agreements');
    } else {
      agreement = primaryOf((masters.value.get(uid) || []).map((c) => ({
        uid: c.uid, store: 'licence_contracts', template_slug: c.template_slug, signed_at: c.signed_at ?? c.completed_at ?? null, created_at: c.created_at,
        legal: licenceContractLegalStatus(c.superseded_at ?? null, c.envelope_status ?? null, String(c.status)),
      }))) ?? none('No licence agreement has been drafted for this licence.');
    }
    // Packages: the package agreements on this licence that are not voided or superseded.
    const packages = !versions.ok
      ? (versions.missing ? notRecorded('The package and program agreement store is not on this database.') : unreadable('The package agreements'))
      : { available: true, items: [...new Set((versions.value.get(uid) || [])
          .filter((v) => (v.agreement_kind === 'package_master' || v.agreement_kind === 'package_addendum')
            && !['voided', 'superseded'].includes(programAgreementLegalStatus(String(v.status), v.envelope_status ?? null)))
          .map((v) => String(v.package_key)))] };
    // Programs: an operator licence's grants; a user licence's entitlements are #5059's.
    const programs = isUser ? notRecorded(ENTITLEMENTS_REASON)
      : r.territory_licence_id == null ? notRecorded('Program grants are held by a territory licence; this licence has none.')
      : !grants.ok ? (grants.missing ? notRecorded('Program grants are not on this database.') : unreadable('The program grants'))
      : { available: true, items: grants.value.get(Number(r.territory_licence_id)) || [] };
    const renewal = renewalOf(r);
    // Attention: what HQ should look at on this licence, each with a code.
    const attention: Array<{ code: string; label: string }> = [];
    const inForce = IN_FORCE.includes(String(r.status));
    if (r.status === 'suspended') attention.push({ code: 'suspended', label: 'Suspended' });
    if (inForce && renewal.on && renewal.on <= plusDays(now, RENEWAL_DUE_DAYS)) {
      attention.push(renewal.on < now ? { code: 'renewal_overdue', label: `Renewal date ${renewal.on} has passed` } : { code: 'renewal_due', label: `Renews or ends on ${renewal.on}` });
    }
    if (agreement.available && inForce && agreement.state !== 'executed') {
      attention.push({ code: 'agreement_not_executed', label: agreement.state === 'none' ? 'No agreement on file' : `Agreement: ${agreement.state_label}` });
    }
    if (!agreement.available && agreement.state === 'unreadable') attention.push({ code: 'agreement_unreadable', label: 'Agreement unreadable' });
    const out: LicenceRowOut = {
      uid,
      licence_ref: r.licence_ref,
      licence_family: r.licence_family,
      licence_type: r.licence_type,
      licence_type_label: LICENCE_TYPE_LABELS[r.licence_type] ?? r.licence_type,
      holder: holderOf(r),
      status: r.status,
      revision: r.revision,
      starts_on: r.starts_on ?? null,
      ends_on: r.ends_on ?? null,
      renewal,
      agreement,
      packages,
      programs,
      attention,
    };
    // The territory block is an operator licence's alone: a user licence carries no franchise field at all.
    if (!isUser) {
      out.territory = r.territory_licence_id == null
        ? notRecorded('This operator licence has no territory row.')
        : {
            available: true,
            territory_licence_id: Number(r.territory_licence_id),
            kind: r.territory_kind ?? null,
            brand_name: r.brand_name ?? null,
            legal_entity_name: r.legal_entity_name ?? null,
            countries: terr.ok ? (terr.value.get(Number(r.territory_licence_id)) || []) : null,
            countries_state: terr.ok ? 'recorded' : terr.missing ? 'not_recorded' : 'unreadable',
          };
    }
    return out;
  });
}

/** Licences per family filter, over the whole registry (the filter chips' counts). */
async function familyCounts(env: Env) {
  const rows = await env.DB.prepare('SELECT licence_family, licence_type, COUNT(*) AS n FROM licences GROUP BY licence_family, licence_type').all<any>();
  const counts: Record<RegistryFamily, number> = { all: 0, operator: 0, founder: 0, investor: 0, operating_partner: 0, advisor: 0 };
  for (const r of rows.results || []) {
    const n = Number(r.n) || 0;
    counts.all += n;
    if (r.licence_family === 'operator') counts.operator += n;
    else if (r.licence_type in counts) counts[r.licence_type as RegistryFamily] += n;
  }
  return counts;
}

/** One page of the registry. A database without the registry answers Not recorded, never an empty list. */
export async function registryPage(env: Env, q: RegistryQuery) {
  let rows: any[];
  let total: number;
  try {
    const binds = whereBinds(q);
    const page = await env.DB.prepare(PAGE_SQL).bind(...binds, q.after, q.after, q.limit + 1).all<any>();
    rows = page.results || [];
    const count = await env.DB.prepare(COUNT_SQL).bind(...binds).first<{ n: number }>();
    total = Number(count?.n ?? 0);
  } catch (e) {
    if (missing(e)) return { ...notRecorded('The licence registry (D5057) is not on this database, so no licence family can be listed.'), items: null, total: null };
    throw e;
  }
  const more = rows.length > q.limit;
  const pageRows = rows.slice(0, q.limit);
  return {
    available: true,
    family: q.family,
    items: await enrich(env, pageRows),
    total,
    limit: q.limit,
    next_cursor: more ? cursorOf(String(pageRows[pageRows.length - 1].licence_ref)) : null,
    counts: await familyCounts(env),
  };
}

/** One licence, its detail shaped by its family. Null when there is no such licence. */
export async function registryDetail(env: Env, uid: string) {
  if (!UID.test(uid)) return null;
  let row: any;
  try {
    row = await env.DB.prepare(DETAIL_SQL).bind(uid).first<any>();
  } catch (e) {
    if (missing(e)) return { ...notRecorded('The licence registry (D5057) is not on this database.'), licence: null };
    throw e;
  }
  if (!row) return null;
  const [base] = await enrich(env, [row]);
  const overview = {
    uid: base.uid, licence_ref: base.licence_ref, licence_family: base.licence_family, licence_type: base.licence_type,
    licence_type_label: base.licence_type_label, holder: base.holder, status: base.status, revision: base.revision,
    starts_on: base.starts_on, ends_on: base.ends_on, renewal: base.renewal, attention: base.attention,
  };
  const related = await section(() => programAgreements(env, [uid]));
  const relatedAgreements = !related.ok
    ? (related.missing ? notRecorded('The package and program agreement store is not on this database.') : unreadable('The package and program agreements'))
    : {
        available: true,
        items: (related.value.get(uid) || []).map((v) => {
          const legal = programAgreementLegalStatus(String(v.status), v.envelope_status ?? null);
          return {
            agreement_uid: v.uid, store: 'licence_program_agreements', agreement_kind: v.agreement_kind, program_key: v.program_key ?? null,
            package_key: v.package_key ?? null, package_version: v.package_version ?? null, template_slug: v.template_slug,
            legal_status: legal, legal_status_label: LEGAL_STATUS_LABELS[legal], envelope_uuid: v.envelope_uuid ?? null, signed_at: v.signed_at ?? null,
          };
        }),
      };

  if (base.licence_family === 'operator') {
    const masters = row.territory_licence_id == null ? null : await section(() => masterAgreements(env, [uid]));
    return {
      available: true,
      layout: 'operator',
      overview,
      territory: base.territory,
      packages: base.packages,
      programs: base.programs,
      agreement: {
        primary: base.agreement,
        versions: masters === null ? notRecorded(`A ${base.licence_type_label} has no agreement store yet.`)
          : !masters.ok ? (masters.missing ? notRecorded('The licence agreement store is not on this database.') : unreadable('The licence agreements'))
          : {
              available: true,
              items: (masters.value.get(uid) || []).map((c) => {
                const legal = licenceContractLegalStatus(c.superseded_at ?? null, c.envelope_status ?? null, String(c.status));
                return { agreement_uid: c.uid, store: 'licence_contracts', template_slug: c.template_slug, legal_status: legal, legal_status_label: LEGAL_STATUS_LABELS[legal], signed_at: c.signed_at ?? c.completed_at ?? null, created_at: c.created_at ?? null };
              }),
            },
        related: relatedAgreements,
      },
      // The territory licence's own terms, fees, seats, events and blockers are its existing detail read.
      operator_detail: row.territory_licence_id == null ? null : `/api/admin/licences/${encodeURIComponent(uid)}`,
    };
  }

  // A user licence: overview, programs, agreement, billing and history.
  const accountId = /^[1-9][0-9]*$/.test(String(row.holder_id)) ? Number(row.holder_id) : null;
  const account = accountId === null ? null
    : await env.DB.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').bind(accountId).first<any>();
  const users = await section(() => userAgreements(env, accountId === null ? [] : [accountId]));
  const tpl = userLicenceTemplateFor(row.licence_type);
  const events = await section(() => eventsOf(env, { uid }));
  const history = events.ok
    ? { available: true, items: events.value }
    : events.missing
      ? notRecorded('The user licence history store is not on this database.')
      : unreadable('The user licence history');
  const agreementVersions = !users.ok
    ? (users.missing ? notRecorded('E-sign envelopes are not on this database.') : unreadable('The user licence agreements'))
    : {
        available: true,
        template_slug: tpl?.slug ?? null,
        items: users.value.filter((a) => a.licence_uid === uid).map((a) => ({
          agreement_uid: a.agreement_uid, store: a.store, template_slug: a.template_slug, template_version: a.template_version,
          legal_status: a.legal_status, legal_status_label: a.legal_status_label, is_current: a.is_current,
          sent_at: a.sent_at, signed_at: a.signed_at, envelope_uuid: a.envelope_uuid, document_available: a.document_available,
        })),
      };
  return {
    available: true,
    layout: 'user',
    overview: {
      ...overview,
      account: account
        ? { available: true, user_id: account.id, name: account.name ?? null, email: account.email ?? null, role: account.role ?? null, is_active: Number(account.is_active) === 1 }
        : notRecorded('No account with this holder id is on file.'),
      entitlements: notRecorded(ENTITLEMENTS_REASON),
    },
    programs: notRecorded(ENTITLEMENTS_REASON),
    packages: base.packages,
    agreement: {
      primary: base.agreement,
      versions: agreementVersions,
      related: relatedAgreements,
    },
    billing: notRecorded('No commercial terms are recorded on a user licence in the registry.'),
    history,
  };
}
