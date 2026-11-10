/**
 * D5058 (#5058) — the lifecycle of user licences (Founder, Investor, Operating Partner, Advisor) on the shared
 * `licences` identity (D5057), with `account_licences` (D4472) kept in step as the access projection.
 *
 * HOLDER RULES
 *   · One account may hold several user licences at once; each is its own `licences` row with its own status,
 *     dates and revision. A write names one licence and changes only that row and its own access row.
 *   · Admin comes only from `users.role`. Nothing here writes `users.role`, and no licence grants Admin.
 *   · A second licence is granted by an Admin only (owner, 2026-11-09, #3704 C). There is no checkout here.
 *
 * LIFECYCLE
 *   proposed ─▶ active | terminated
 *   active ─▶ suspended | renewal_pending | expired | terminated
 *   suspended ─▶ active (resume) | expired | terminated
 *   renewal_pending ─▶ active (renew) | expired | terminated
 *   expired ─▶ active (renew, with a new term) | terminated
 *   terminated: final, except that an Admin's grant re-opens an additional licence (D4472's re-grant).
 * Access is held while the licence is `active` or `renewal_pending` (its current term is still in force).
 *
 * STALE WRITES. Every write names the revision it read. The licence row changes only when its revision and status
 * are still those; otherwise nothing is written and the caller gets 409 with the current row.
 *
 * RENEWAL never extends signed terms silently: it is an explicit act that adds the next `user_licence_terms` row
 * (its dates, renewal terms and agreement version), so every earlier term and agreement version stays recorded.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

export const USER_LICENCE_TYPES = ['founder', 'investor', 'operating_partner', 'advisor'] as const;
export type UserLicenceType = (typeof USER_LICENCE_TYPES)[number];
export const STATUSES = ['proposed', 'active', 'suspended', 'renewal_pending', 'expired', 'terminated'] as const;
export type UserLicenceStatus = (typeof STATUSES)[number];
/** Statuses under which the licence's access is held. */
export const ACCESS_STATUSES: readonly UserLicenceStatus[] = ['active', 'renewal_pending'];

/** `account_licences.licence` (D4472) ↔ `licences.licence_type` (D5057): the same licences, two spellings. */
export const ACCESS_KEY: Record<UserLicenceType, 'founder' | 'investor' | 'partner' | 'advisor'> = {
  founder: 'founder', investor: 'investor', operating_partner: 'partner', advisor: 'advisor',
};
export const typeOfAccessKey = (k: string): UserLicenceType | null =>
  (Object.entries(ACCESS_KEY).find(([, v]) => v === k)?.[0] as UserLicenceType | undefined) ?? null;

/** A status change, by its action name, and the statuses it may start from. Renewal is its own write. */
export const TRANSITIONS: Record<string, { to: UserLicenceStatus; from: readonly UserLicenceStatus[] }> = {
  activate: { to: 'active', from: ['proposed'] },
  suspend: { to: 'suspended', from: ['active', 'renewal_pending'] },
  resume: { to: 'active', from: ['suspended'] },
  renewal_pending: { to: 'renewal_pending', from: ['active'] },
  expire: { to: 'expired', from: ['active', 'suspended', 'renewal_pending'] },
  terminate: { to: 'terminated', from: ['proposed', 'active', 'suspended', 'renewal_pending', 'expired'] },
};
export const RENEWABLE: readonly UserLicenceStatus[] = ['active', 'renewal_pending', 'expired'];

export class UserLicenceError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  readonly extra: Record<string, unknown>;
  constructor(status: 400 | 403 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

export type UserLicence = {
  uid: string; licence_ref: string; licence_type: UserLicenceType; user_id: number; status: UserLicenceStatus;
  starts_on: string | null; ends_on: string | null; renews_on: string | null; revision: number;
  is_primary: boolean; access_held: boolean; updated_at: string | null;
};
export type Term = {
  uid: string; term_no: number; starts_on: string; ends_on: string | null; agreement_version: string | null;
  renewal_terms: Record<string, unknown>; reason: string; created_at: string; created_by_user_id: number | null;
};
export type LicenceEvent = {
  id: number; licence_uid: string; licence_type: UserLicenceType; action: string; from_status: string | null;
  to_status: string; revision: number; reason: string; actor_id: number | null; term_uid: string | null; created_at: string;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function licenceOf(r: Record<string, any>, primaryRole: string | null): UserLicence {
  const type = r.licence_type as UserLicenceType;
  const status = r.status as UserLicenceStatus;
  return {
    uid: String(r.uid), licence_ref: String(r.licence_ref), licence_type: type, user_id: Number(r.holder_id), status,
    starts_on: r.starts_on ?? null, ends_on: r.ends_on ?? null, renews_on: r.renews_on ?? null, revision: Number(r.revision),
    is_primary: primaryRole !== null && ACCESS_KEY[type] === primaryRole, access_held: ACCESS_STATUSES.includes(status),
    updated_at: r.updated_at ?? null,
  };
}

/**
 * The primary-licence types whose `licences` row says their access is NOT held (suspended, expired, terminated,
 * or still proposed). `heldLicences` (D4472) removes the primary role's licence when it is listed here; a primary
 * with no row (a database before this migration) is held as before.
 */
export async function withheldPrimaryKey(db: D1Database, userId: number, primaryRole: string): Promise<boolean> {
  const type = typeOfAccessKey(primaryRole);
  if (!type) return false;
  try {
    const r = await db.prepare(
      "SELECT status FROM licences WHERE licence_family = 'user' AND holder_type = 'user' AND holder_id = ? AND licence_type = ?",
    ).bind(String(userId), type).first<{ status: string }>();
    return !!r && !(ACCESS_STATUSES as readonly string[]).includes(String(r.status));
  } catch (error) {
    if (/no such table: (?:main\.)?licences/i.test(String(error))) return false;
    throw error;
  }
}

export async function licencesOfUser(env: Env, userId: number): Promise<UserLicence[]> {
  const u = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>();
  if (!u) throw new UserLicenceError(404, 'not_found', 'Account not found.');
  const rows = await env.DB.prepare(
    `SELECT * FROM licences WHERE licence_family = 'user' AND holder_type = 'user' AND holder_id = ?
      ORDER BY CASE licence_type WHEN 'founder' THEN 1 WHEN 'investor' THEN 2 WHEN 'operating_partner' THEN 3 ELSE 4 END`,
  ).bind(String(userId)).all<Record<string, any>>();
  return (rows.results || []).map((r) => licenceOf(r, String(u.role || '').toLowerCase()));
}

export async function licenceByUid(env: Env, uid: string): Promise<UserLicence | null> {
  const r = await env.DB.prepare("SELECT * FROM licences WHERE uid = ? AND licence_family = 'user'").bind(uid).first<Record<string, any>>();
  if (!r) return null;
  const u = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(Number(r.holder_id)).first<{ role: string }>();
  return licenceOf(r, u ? String(u.role || '').toLowerCase() : null);
}

export async function termsOf(env: Env, uid: string): Promise<Term[]> {
  const r = await env.DB.prepare('SELECT * FROM user_licence_terms WHERE licence_uid = ? ORDER BY term_no').bind(uid).all<Record<string, any>>();
  return (r.results || []).map((t) => {
    let renewal: Record<string, unknown> = {};
    try { renewal = JSON.parse(String(t.renewal_terms_json || '{}')); } catch { renewal = {}; }
    return {
      uid: String(t.uid), term_no: Number(t.term_no), starts_on: String(t.starts_on), ends_on: t.ends_on ?? null,
      agreement_version: t.agreement_version ?? null, renewal_terms: renewal, reason: String(t.reason),
      created_at: String(t.created_at), created_by_user_id: t.created_by_user_id ?? null,
    };
  });
}

export async function eventsOf(env: Env, filter: { uid?: string; userId?: number }): Promise<LicenceEvent[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM user_licence_events WHERE (?1 IS NULL OR licence_uid = ?1) AND (?2 IS NULL OR user_id = ?2) ORDER BY id DESC LIMIT 500`,
  ).bind(filter.uid ?? null, filter.userId ?? null).all<Record<string, any>>();
  return (r.results || []).map((e) => ({
    id: Number(e.id), licence_uid: String(e.licence_uid), licence_type: e.licence_type, action: String(e.action),
    from_status: e.from_status ?? null, to_status: String(e.to_status), revision: Number(e.revision), reason: String(e.reason),
    actor_id: e.actor_id ?? null, term_uid: e.term_uid ?? null, created_at: String(e.created_at),
  }));
}

/**
 * The access row, in step with the licence, for an ADDITIONAL licence. The primary licence has no access row
 * (it is `users.role`); its access follows the licence row through `withheldPrimaryKey`. The statement is guarded
 * by the licence row having reached `revision` with `status`, so it lands only when the licence write did.
 */
function accessStatement(env: Env, l: UserLicence, status: UserLicenceStatus, revision: number, actorId: number): D1PreparedStatement {
  const held = ACCESS_STATUSES.includes(status) ? 1 : 0;
  return env.DB.prepare(
    `UPDATE account_licences
        SET revoked_at = CASE WHEN ?1 = 1 THEN NULL ELSE COALESCE(revoked_at, datetime('now')) END,
            revoked_by = CASE WHEN ?1 = 1 THEN NULL ELSE COALESCE(revoked_by, ?2) END
      WHERE user_id = ?3 AND licence = ?4
        AND EXISTS (SELECT 1 FROM users WHERE id = ?3 AND lower(role) <> ?4)
        AND EXISTS (SELECT 1 FROM licences WHERE uid = ?5 AND revision = ?6 AND status = ?7)`,
  ).bind(held, actorId, l.user_id, ACCESS_KEY[l.licence_type], l.uid, revision, status);
}

function staleRefusal(current: UserLicence | null) {
  return new UserLicenceError(409, 'licence_changed', 'This licence changed since you opened it. Nothing was saved. Review the latest, then make your change again.', { current });
}

/** One status change on one licence, guarded by the revision read. */
export async function transitionLicence(env: Env, a: {
  uid: string; action: string; expectedRevision: number; reason: string; actorId: number;
}): Promise<UserLicence> {
  const t = TRANSITIONS[a.action];
  if (!t) throw new UserLicenceError(400, 'invalid_action', `The action must be one of ${Object.keys(TRANSITIONS).join(', ')}.`);
  const l = await licenceByUid(env, a.uid);
  if (!l) throw new UserLicenceError(404, 'not_found', 'No user licence with that id.');
  if (l.revision !== a.expectedRevision) throw staleRefusal(l);
  if (!t.from.includes(l.status)) {
    throw new UserLicenceError(409, 'invalid_transition', `A ${l.status.replace('_', ' ')} licence cannot be ${a.action === 'renewal_pending' ? 'marked renewal pending' : `${a.action}d`}.`, { current: l });
  }
  const next = l.revision + 1;
  const now = new Date().toISOString();
  const res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE licences SET status = ?, revision = revision + 1, updated_at = ?, updated_by_user_id = ?
        WHERE uid = ? AND licence_family = 'user' AND revision = ? AND status = ?`,
    ).bind(t.to, now, a.actorId, l.uid, l.revision, l.status),
    env.DB.prepare(
      `INSERT INTO user_licence_events (licence_uid, user_id, licence_type, action, from_status, to_status, revision, reason, actor_id)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(l.uid, l.user_id, l.licence_type, a.action, l.status, t.to, next, a.reason, a.actorId),
    accessStatement(env, l, t.to, next, a.actorId),
  ]);
  if (!res[0].meta.changes) throw staleRefusal(await licenceByUid(env, a.uid));
  return (await licenceByUid(env, a.uid)) as UserLicence;
}

export type RenewalInput = { starts_on: string; ends_on: string | null; agreement_version: string | null; renewal_terms: Record<string, unknown> };

export function validateRenewal(b: Record<string, unknown> | null): { ok: true; value: RenewalInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const x = b || {};
  if (!isIsoDay(x.starts_on)) errors.starts_on = 'must be a real date as YYYY-MM-DD';
  let ends: string | null = null;
  if (x.ends_on !== undefined && x.ends_on !== null) {
    if (!isIsoDay(x.ends_on)) errors.ends_on = 'must be a real date as YYYY-MM-DD';
    else ends = x.ends_on;
  }
  if (ends && isIsoDay(x.starts_on) && ends <= x.starts_on) errors.ends_on = 'must be after the start date';
  let agreement: string | null = null;
  if (x.agreement_version !== undefined && x.agreement_version !== null) {
    const s = typeof x.agreement_version === 'string' ? x.agreement_version.trim() : '';
    if (s.length < 1 || s.length > 120) errors.agreement_version = 'must be 1 to 120 characters'; else agreement = s;
  }
  let renewal: Record<string, unknown> = {};
  if (x.renewal_terms !== undefined && x.renewal_terms !== null) {
    if (typeof x.renewal_terms !== 'object' || Array.isArray(x.renewal_terms)) errors.renewal_terms = 'must be an object';
    else if (JSON.stringify(x.renewal_terms).length > 4000) errors.renewal_terms = 'is too long';
    else renewal = x.renewal_terms as Record<string, unknown>;
  }
  return Object.keys(errors).length ? { ok: false, errors }
    : { ok: true, value: { starts_on: x.starts_on as string, ends_on: ends, agreement_version: agreement, renewal_terms: renewal } };
}

/**
 * A renewal: the next term, explicitly. The licence becomes `active` with the new term's dates; every earlier term
 * (and the agreement version it was signed under) stays as it was. A renewal that starts before the current term
 * ends, or that names no agreement while the current term has one and no reason to drop it, is still a person's
 * explicit act; nothing here extends a term by itself.
 */
export async function renewLicence(env: Env, a: {
  uid: string; expectedRevision: number; input: RenewalInput; reason: string; actorId: number;
}): Promise<{ licence: UserLicence; term: Term }> {
  const l = await licenceByUid(env, a.uid);
  if (!l) throw new UserLicenceError(404, 'not_found', 'No user licence with that id.');
  if (l.revision !== a.expectedRevision) throw staleRefusal(l);
  if (!RENEWABLE.includes(l.status)) {
    throw new UserLicenceError(409, 'invalid_transition', `A ${l.status.replace('_', ' ')} licence cannot be renewed.`, { current: l });
  }
  const terms = await termsOf(env, l.uid);
  const last = terms[terms.length - 1] ?? null;
  if (last && a.input.starts_on <= last.starts_on) {
    throw new UserLicenceError(400, 'renewal_overlaps', `The new term must start after the current one began (${last.starts_on}).`);
  }
  const next = l.revision + 1;
  const termUid = crypto.randomUUID();
  const now = new Date().toISOString();
  const res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE licences SET status = 'active', starts_on = COALESCE(starts_on, ?), ends_on = ?, renews_on = ?,
          revision = revision + 1, updated_at = ?, updated_by_user_id = ?
        WHERE uid = ? AND licence_family = 'user' AND revision = ? AND status = ?`,
    ).bind(a.input.starts_on, a.input.ends_on, a.input.ends_on, now, a.actorId, l.uid, l.revision, l.status),
    env.DB.prepare(
      `INSERT INTO user_licence_terms (uid, licence_uid, term_no, starts_on, ends_on, agreement_version, renewal_terms_json, reason, created_by_user_id)
       SELECT ?, ?, COALESCE((SELECT MAX(term_no) FROM user_licence_terms WHERE licence_uid = ?), 0) + 1, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM licences WHERE uid = ? AND revision = ? AND status = 'active')`,
    ).bind(termUid, l.uid, l.uid, a.input.starts_on, a.input.ends_on, a.input.agreement_version, JSON.stringify(a.input.renewal_terms),
      a.reason, a.actorId, l.uid, next),
    env.DB.prepare(
      `INSERT INTO user_licence_events (licence_uid, user_id, licence_type, action, from_status, to_status, revision, reason, actor_id, term_uid)
       SELECT ?, ?, ?, 'renew', ?, 'active', ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(l.uid, l.user_id, l.licence_type, l.status, next, a.reason, a.actorId, termUid),
    accessStatement(env, l, 'active', next, a.actorId),
  ]);
  if (!res[0].meta.changes) throw staleRefusal(await licenceByUid(env, a.uid));
  const term = (await termsOf(env, l.uid)).find((t) => t.uid === termUid) as Term;
  return { licence: (await licenceByUid(env, a.uid)) as UserLicence, term };
}

/**
 * Whether this database carries D5058's tables. Every migrated database does; a test database built from the
 * baseline and D4472's migration alone does not, and its grants must work as they did. Read once per database.
 */
const lifecycleTables = new WeakMap<object, Promise<boolean>>();
export function hasLifecycle(db: D1Database): Promise<boolean> {
  const env = { DB: db } as Env;
  const key = bindingKey(env);
  let p = lifecycleTables.get(key);
  if (!p) {
    p = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('licences', 'user_licence_events')")
      .first<{ n: number }>().then((r) => Number(r?.n) === 2).catch(() => false);
    lifecycleTables.set(key, p);
  }
  return p;
}

/**
 * D4472's grant and revoke keep the shared row in step: these return the statements their batch appends, each
 * guarded so it writes only when the grant or revoke did (the access row is the source of that fact).
 */
export function grantLicenceStatements(env: Env, userId: number, accessKey: string, actorId: number, source: string): D1PreparedStatement[] {
  const type = typeOfAccessKey(accessKey);
  if (!type) return [];
  const uid = `ulic_${userId}_${type}`;
  const ref = `USR-${userId}-${type.toUpperCase()}`;
  return [
    env.DB.prepare(
      `INSERT INTO licences (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, starts_on, revision, origin, created_at, created_by_user_id)
       SELECT ?, ?, 'user', ?, 'user', ?, 'active', date('now'), 0, 'app', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?
        WHERE NOT EXISTS (SELECT 1 FROM licences WHERE licence_family = 'user' AND holder_id = ? AND licence_type = ?)
          AND EXISTS (SELECT 1 FROM account_licences WHERE user_id = ? AND licence = ? AND revoked_at IS NULL)`,
    ).bind(uid, ref, type, String(userId), actorId, String(userId), type, userId, accessKey),
    // A re-grant re-opens the licence it already has (a terminated or ended additional licence), at the next revision.
    env.DB.prepare(
      `UPDATE licences SET status = 'active', revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_by_user_id = ?
        WHERE licence_family = 'user' AND holder_id = ? AND licence_type = ? AND status <> 'active'
          AND EXISTS (SELECT 1 FROM account_licences WHERE user_id = ? AND licence = ? AND revoked_at IS NULL)`,
    ).bind(actorId, String(userId), type, userId, accessKey),
    env.DB.prepare(
      `INSERT INTO user_licence_events (licence_uid, user_id, licence_type, action, from_status, to_status, revision, reason, actor_id)
       SELECT l.uid, ?, l.licence_type, 'grant', NULL, l.status, l.revision, ?, ?
         FROM licences l
        WHERE l.licence_family = 'user' AND l.holder_id = ? AND l.licence_type = ? AND l.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM user_licence_events e WHERE e.licence_uid = l.uid AND e.revision = l.revision)`,
    ).bind(userId, `Granted by an Admin (${source}).`, actorId, String(userId), type),
  ];
}

export function revokeLicenceStatements(env: Env, userId: number, accessKey: string, actorId: number, source: string): D1PreparedStatement[] {
  const type = typeOfAccessKey(accessKey);
  if (!type) return [];
  return [
    env.DB.prepare(
      `UPDATE licences SET status = 'terminated', revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_by_user_id = ?
        WHERE licence_family = 'user' AND holder_id = ? AND licence_type = ? AND status <> 'terminated'
          AND EXISTS (SELECT 1 FROM account_licences WHERE user_id = ? AND licence = ? AND revoked_at IS NOT NULL)`,
    ).bind(actorId, String(userId), type, userId, accessKey),
    env.DB.prepare(
      `INSERT INTO user_licence_events (licence_uid, user_id, licence_type, action, from_status, to_status, revision, reason, actor_id)
       SELECT l.uid, ?, l.licence_type, 'terminate', NULL, 'terminated', l.revision, ?, ?
         FROM licences l
        WHERE l.licence_family = 'user' AND l.holder_id = ? AND l.licence_type = ? AND l.status = 'terminated'
          AND NOT EXISTS (SELECT 1 FROM user_licence_events e WHERE e.licence_uid = l.uid AND e.revision = l.revision)`,
    ).bind(userId, `Revoked by an Admin (${source}).`, actorId, String(userId), type),
  ];
}
