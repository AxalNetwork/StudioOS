/**
 * D7825 (#7825): record identity for Research company and fund records: names (legal, alias, brand, former, match
 * key), native identifiers and reviewed domains, over the tables of migration 202611222146_7825.
 *
 * ACCESS. A member's identity read answers exactly as that record's own profile route answers the same account:
 * a company by the Companies rule (`admitsCompanies`, decided before the record is read, so a refusal never says
 * whether it exists) and D7819's served rows (`readCompanyByUid`: an excluded or withdrawn record answers its state
 * only); a fund by the fund catalogue's rule (signed in) and `SERVED_FUNDS` through `getFund`, which follows a moved
 * fund uid one hop and answers a fund of a withdrawn list as removed. A refusal carries no identity field.
 *
 * MEMBER VIEW. A match key is for matching and is never returned as a name. A domain's review state and date are
 * returned; its reviewer and note never are. With no domain row, the recorded website's host reads "not reviewed".
 * Two records sharing a name, identifier or host stay two records: a read of one names no other.
 *
 * WEBSITE VERIFICATION. An admin review of a company's domain, with proof, writes the domain row. When the host is
 * the host of the company's recorded website, a review sets `research_company_directory.website_verified_at` to the
 * review time (the column's first writer), and a rejection or a withdrawn review clears it; a review of any other host
 * never touches it. A fetched page is not a review. That one UPDATE is why this file is on the D7819 guard's
 * maintenance-writer list. Nothing here writes a `network_directory_*` table or reads one.
 */
import type { Env, User } from '../types';
import { admitsCompanies } from './researchCompaniesAccess';
import { readCompanyByUid } from './researchCompanyRead';
import { getFund } from './researchFundDirectory';

export const RECORD_KINDS = Object.freeze(['company', 'fund'] as const);
export const NAME_TYPES = Object.freeze(['legal', 'alias', 'brand', 'former', 'match_key'] as const);
/** Native schemes only. No Network directory id and no source-list id: the Research↔Network link is #7672's bridge. */
export const SCHEMES = Object.freeze(['gb_companies_house', 'wikidata', 'no_brreg', 'fi_prh', 'ee_rik', 'lei'] as const);
export const DOMAIN_STATES = Object.freeze(['not_reviewed', 'reviewed', 'rejected'] as const);
export const NOT_RECORDED = 'Not recorded';
export type RecordKind = (typeof RECORD_KINDS)[number];

const UID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const HTTPS = /^https:\/\/[^\s<>"']{1,1990}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class IdentityInputError extends Error {
  code: string;
  detail: string;
  status: number;
  constructor(code: string, detail: string, status = 400) { super(code); this.code = code; this.detail = detail; this.status = status; }
}

/** A URL's host, lower case, with no trailing dot and no "www." prefix; null for anything that is not http(s). */
export function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') || null;
  } catch { return null; }
}
export function parseHost(v: unknown): string {
  const h = typeof v === 'string' ? v.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '') : '';
  if (!HOST.test(h)) throw new IdentityInputError('invalid_host', 'host must be a domain name such as example.com.');
  return h;
}
export function parseKind(v: unknown): RecordKind {
  if (!RECORD_KINDS.includes(v as RecordKind)) throw new IdentityInputError('invalid_kind', 'kind must be company or fund.', 404);
  return v as RecordKind;
}
export function parseUid(v: unknown): string {
  if (typeof v !== 'string' || !UID.test(v)) throw new IdentityInputError('invalid_uid', 'Not found', 404);
  return v;
}

export type RecordAnswer =
  | { state: 'refused' }
  | { state: 'not_found' }
  | { state: 'withdrawn'; review_status: string; reason: string }
  | { state: 'removed'; removed: unknown }
  | { state: 'ok'; kind: RecordKind; uid: string; website: string | null; website_verified_at: string | null; moved_from: string | null };

/**
 * The record as its own profile route answers this account. `user` null is the admin path (no member rule; the
 * admin routes are gated by `requireAdmin` before they call this).
 */
export async function resolveRecord(env: Env, user: User | null, kind: RecordKind, uid: string): Promise<RecordAnswer> {
  if (kind === 'company') {
    if (user && !admitsCompanies(user as any)) return { state: 'refused' };
    const row: any = await readCompanyByUid(env, uid);
    if (!row) return { state: 'not_found' };
    if (!row.id || row.review_status === 'excluded' || row.review_status === 'withdrawn') {
      return { state: 'withdrawn', review_status: row.review_status, reason: row.reason };
    }
    return { state: 'ok', kind, uid: row.uid, website: row.website ?? null, website_verified_at: row.website_verified_at ?? null, moved_from: null };
  }
  const fund: any = await getFund(env, uid);
  if (!fund) return { state: 'not_found' };
  if (fund.removed) return { state: 'removed', removed: fund.removed };
  return { state: 'ok', kind, uid: fund.item.uid, website: fund.item.website ?? null, website_verified_at: null, moved_from: fund.moved_from ?? null };
}

type View = 'member' | 'admin';

/** The identity of one served record. A member never sees a match key, a reviewer or a note. */
export async function identityOf(env: Pick<Env, 'DB'>, rec: Extract<RecordAnswer, { state: 'ok' }>, view: View) {
  const [names, ids, domains] = await Promise.all([
    env.DB.prepare(`SELECT id,name_type,name,language,source_name,source_url,recorded_on,source_key,provider_record_id,stated_row_hash
      FROM research_record_names WHERE record_kind = ? AND record_uid = ? ORDER BY CASE name_type WHEN 'legal' THEN 0 WHEN 'brand' THEN 1 WHEN 'alias' THEN 2 WHEN 'former' THEN 3 ELSE 4 END, id`)
      .bind(rec.kind, rec.uid).all<any>(),
    env.DB.prepare(`SELECT id,scheme,value,source_name,source_url,source_key,provider_record_id,stated_row_hash
      FROM research_record_identifiers WHERE record_kind = ? AND record_uid = ? ORDER BY scheme, id`).bind(rec.kind, rec.uid).all<any>(),
    env.DB.prepare(`SELECT id,host,review_state,reviewed_on,reviewer,proof_url,note,source_name
      FROM research_record_domains WHERE record_kind = ? AND record_uid = ? ORDER BY host`).bind(rec.kind, rec.uid).all<any>(),
  ]);
  const nameRows = (names.results || []).filter((n: any) => view === 'admin' || n.name_type !== 'match_key');
  const domainRows = (domains.results || []).map((d: any) => (view === 'admin' ? d
    : { host: d.host, review_state: d.review_state, reviewed_on: d.reviewed_on ?? null, proof_url: d.proof_url ?? null }));
  const recorded = hostOf(rec.website);
  if (recorded && !domainRows.some((d: any) => d.host === recorded)) {
    domainRows.push({ host: recorded, review_state: 'not_reviewed', reviewed_on: null, proof_url: null, from: 'recorded_website' } as any);
  }
  const legal = nameRows.find((n: any) => n.name_type === 'legal');
  const identifiers = ids.results || [];
  return {
    kind: rec.kind, uid: rec.uid, moved_from: rec.moved_from,
    legal_name: legal ? legal.name : null,
    legal_name_label: legal ? legal.name : NOT_RECORDED,
    names: nameRows.map((n: any) => (view === 'admin' ? n : {
      name_type: n.name_type, name: n.name, language: n.language ?? null, source_name: n.source_name, source_url: n.source_url ?? null, recorded_on: n.recorded_on ?? null,
    })),
    identifiers: identifiers.map((i: any) => (view === 'admin' ? i : { scheme: i.scheme, value: i.value, source_name: i.source_name, source_url: i.source_url ?? null })),
    domains: domainRows,
    recorded: nameRows.length > 0 || identifiers.length > 0,
    ...(nameRows.length || identifiers.length ? {} : { not_recorded: NOT_RECORDED }),
  };
}

// ── admin writes ─────────────────────────────────────────────────────────────

const text = (v: unknown, max: number, field: string, required = false): string | null => {
  if (v == null || (typeof v === 'string' && !v.trim())) {
    if (required) throw new IdentityInputError('field_required', `${field} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw new IdentityInputError('invalid_field', `${field} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new IdentityInputError('invalid_field', `${field} is longer than ${max} characters.`);
  return t;
};
const https = (v: unknown, field: string, required = false) => {
  const t = text(v, 2000, field, required);
  if (t != null && !HTTPS.test(t)) throw new IdentityInputError('invalid_field', `${field} must start with https://.`);
  return t;
};
const day = (v: unknown, field: string) => {
  const t = text(v, 10, field);
  if (t != null && (!DAY.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`)))) throw new IdentityInputError('invalid_field', `${field} must be a date (YYYY-MM-DD).`);
  return t;
};
/** The #7742 citation of a staged source record: source key, provider record id, stated row hash. */
const citation = (b: any) => ({
  source_key: text(b?.source_key, 200, 'source_key'),
  provider_record_id: text(b?.provider_record_id, 200, 'provider_record_id'),
  stated_row_hash: text(b?.stated_row_hash, 128, 'stated_row_hash'),
});
const stamp = (now: Date) => now.toISOString().slice(0, 19).replace('T', ' ');

export function parseName(b: any) {
  if (!NAME_TYPES.includes(b?.name_type)) throw new IdentityInputError('invalid_name_type', 'name_type must be legal, alias, brand, former or match_key.');
  return {
    name_type: b.name_type as string, name: text(b?.name, 300, 'name', true) as string, language: text(b?.language, 16, 'language'),
    source_name: text(b?.source_name, 200, 'source_name', true) as string, source_url: https(b?.source_url, 'source_url'),
    recorded_on: day(b?.recorded_on, 'recorded_on'), ...citation(b),
  };
}
export function parseIdentifier(b: any) {
  if (!SCHEMES.includes(b?.scheme)) throw new IdentityInputError('invalid_scheme', `scheme must be one of ${SCHEMES.join(', ')}.`);
  return {
    scheme: b.scheme as string, value: text(b?.value, 100, 'value', true) as string,
    source_name: text(b?.source_name, 200, 'source_name', true) as string, source_url: https(b?.source_url, 'source_url'), ...citation(b),
  };
}

async function existing(env: Env, kind: RecordKind, uid: string) {
  const rec = await resolveRecord(env, null, kind, uid);
  if (rec.state === 'not_found' || rec.state === 'refused') throw new IdentityInputError('record_not_found', 'Not found', 404);
  return rec;
}
const unique = (e: unknown) => /UNIQUE/i.test(String((e as any)?.message || e));

export async function addName(env: Env, kind: RecordKind, uid: string, body: any) {
  const rec = await existing(env, kind, uid);
  const v = parseName(body);
  const target = rec.state === 'ok' ? rec.uid : uid;
  try {
    const out = await env.DB.prepare(`INSERT INTO research_record_names (record_kind,record_uid,name_type,name,language,source_name,source_url,recorded_on,source_key,provider_record_id,stated_row_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(kind, target, v.name_type, v.name, v.language, v.source_name, v.source_url, v.recorded_on, v.source_key, v.provider_record_id, v.stated_row_hash).run();
    return { id: Number(out.meta?.last_row_id), uid: target };
  } catch (e) { if (unique(e)) throw new IdentityInputError('already_recorded', 'That name is already recorded on this record.', 409); throw e; }
}
export async function correctName(env: Env, kind: RecordKind, uid: string, id: number, body: any) {
  const v = parseName(body);
  const out = await env.DB.prepare(`UPDATE research_record_names SET name_type=?,name=?,language=?,source_name=?,source_url=?,recorded_on=?,source_key=?,provider_record_id=?,stated_row_hash=?
    WHERE id = ? AND record_kind = ? AND record_uid = ?`).bind(v.name_type, v.name, v.language, v.source_name, v.source_url, v.recorded_on, v.source_key, v.provider_record_id, v.stated_row_hash, id, kind, uid).run()
    .catch((e) => { if (unique(e)) throw new IdentityInputError('already_recorded', 'That name is already recorded on this record.', 409); throw e; });
  if (!out.meta?.changes) throw new IdentityInputError('not_found', 'Not found', 404);
  return { id };
}
export async function addIdentifier(env: Env, kind: RecordKind, uid: string, body: any) {
  const rec = await existing(env, kind, uid);
  const v = parseIdentifier(body);
  const target = rec.state === 'ok' ? rec.uid : uid;
  try {
    const out = await env.DB.prepare(`INSERT INTO research_record_identifiers (record_kind,record_uid,scheme,value,source_name,source_url,source_key,provider_record_id,stated_row_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(kind, target, v.scheme, v.value, v.source_name, v.source_url, v.source_key, v.provider_record_id, v.stated_row_hash).run();
    return { id: Number(out.meta?.last_row_id), uid: target };
  } catch (e) { if (unique(e)) throw new IdentityInputError('already_recorded', 'That identifier is already recorded on this record.', 409); throw e; }
}
export async function correctIdentifier(env: Env, kind: RecordKind, uid: string, id: number, body: any) {
  const v = parseIdentifier(body);
  const out = await env.DB.prepare(`UPDATE research_record_identifiers SET scheme=?,value=?,source_name=?,source_url=?,source_key=?,provider_record_id=?,stated_row_hash=?
    WHERE id = ? AND record_kind = ? AND record_uid = ?`).bind(v.scheme, v.value, v.source_name, v.source_url, v.source_key, v.provider_record_id, v.stated_row_hash, id, kind, uid).run()
    .catch((e) => { if (unique(e)) throw new IdentityInputError('already_recorded', 'That identifier is already recorded on this record.', 409); throw e; });
  if (!out.meta?.changes) throw new IdentityInputError('not_found', 'Not found', 404);
  return { id };
}
export async function removeEntry(env: Pick<Env, 'DB'>, table: 'names' | 'identifiers', kind: RecordKind, uid: string, id: number) {
  const sql = table === 'names'
    ? 'DELETE FROM research_record_names WHERE id = ? AND record_kind = ? AND record_uid = ?'
    : 'DELETE FROM research_record_identifiers WHERE id = ? AND record_kind = ? AND record_uid = ?';
  const out = await env.DB.prepare(sql).bind(id, kind, uid).run();
  if (!out.meta?.changes) throw new IdentityInputError('not_found', 'Not found', 404);
  return { id };
}

/**
 * An admin domain review: `reviewed` or `rejected` with an https proof link, or `not_reviewed` to withdraw a review.
 * On a company whose recorded website has this host, a review sets the website verification date and a rejection or
 * withdrawal clears it; any other host never touches it.
 */
export async function reviewDomain(env: Env, kind: RecordKind, uid: string, body: any, reviewer: number, now = new Date()) {
  const rec = await existing(env, kind, uid);
  if (rec.state !== 'ok') throw new IdentityInputError('record_withdrawn', 'This record is not served, so its domains are not reviewed.', 409);
  const host = parseHost(body?.host);
  const state = body?.state;
  if (!DOMAIN_STATES.includes(state)) throw new IdentityInputError('invalid_state', 'state must be reviewed, rejected or not_reviewed.');
  const proof = https(body?.proof_url, 'proof_url', state !== 'not_reviewed');
  const note = text(body?.note, 2000, 'note');
  const at = stamp(now);
  const reviewed = state !== 'not_reviewed';
  await env.DB.prepare(`INSERT INTO research_record_domains (record_kind,record_uid,host,review_state,reviewed_on,reviewer,proof_url,note,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(record_kind,record_uid,host) DO UPDATE SET review_state=excluded.review_state, reviewed_on=excluded.reviewed_on,
      reviewer=excluded.reviewer, proof_url=excluded.proof_url, note=excluded.note, updated_at=excluded.updated_at`)
    .bind(kind, rec.uid, host, state, reviewed ? at : null, reviewed ? reviewer : null, reviewed ? proof : null, note, at).run();
  let verified: string | null | undefined;
  if (kind === 'company' && hostOf(rec.website) === host) {
    verified = state === 'reviewed' ? at : null;
    await env.DB.prepare('UPDATE research_company_directory SET website_verified_at = ? WHERE uid = ?').bind(verified, rec.uid).run();
  }
  return { host, review_state: state, reviewed_on: reviewed ? at : null, ...(verified !== undefined ? { website_verified_at: verified } : {}) };
}

// ── reviewed matching (#7674) ────────────────────────────────────────────────

/**
 * For #7674's reviewed candidate matching (not a member route): each record's match keys, identifiers and reviewed
 * hosts. A shared value is a clue; this never links or merges records.
 */
export async function identityForMatching(env: Pick<Env, 'DB'>, kind: RecordKind, uids: readonly string[]) {
  const list = [...new Set(uids.filter((u) => typeof u === 'string' && UID.test(u)))].slice(0, 500);
  const out = new Map(list.map((u) => [u, { match_keys: [] as string[], identifiers: [] as { scheme: string; value: string }[], reviewed_hosts: [] as string[] }]));
  if (!list.length) return out;
  const json = JSON.stringify(list);
  const [keys, ids, hosts] = await Promise.all([
    env.DB.prepare(`SELECT record_uid,name FROM research_record_names WHERE record_kind = ? AND name_type = 'match_key' AND record_uid IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(kind, json).all<any>(),
    env.DB.prepare('SELECT record_uid,scheme,value FROM research_record_identifiers WHERE record_kind = ? AND record_uid IN (SELECT value FROM json_each(?)) ORDER BY id').bind(kind, json).all<any>(),
    env.DB.prepare(`SELECT record_uid,host FROM research_record_domains WHERE record_kind = ? AND review_state = 'reviewed' AND record_uid IN (SELECT value FROM json_each(?)) ORDER BY host`).bind(kind, json).all<any>(),
  ]);
  for (const r of keys.results || []) out.get(r.record_uid)?.match_keys.push(r.name);
  for (const r of ids.results || []) out.get(r.record_uid)?.identifiers.push({ scheme: r.scheme, value: r.value });
  for (const r of hosts.results || []) out.get(r.record_uid)?.reviewed_hosts.push(r.host);
  return out;
}
