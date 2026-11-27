/**
 * D5059 (#5059, user licences 3/4 under #5047) — program entitlements derived from the user licences an account
 * holds. The store is migration 202611122058_5059; the routes are `routes/admin_program_entitlements.ts`.
 *
 * FOUR THINGS, NEVER ONE FLAG:
 *   · ELIGIBILITY — a held licence whose type an in-force rule (`program_licence_rules`) makes eligible, and whose
 *     own status (D5058) holds access (`ACCESS_STATUSES`: active, renewal pending). That licence is a SOURCE.
 *   · THE GRANT — HQ's assignment of the program to the account (`user_program_grants`): granted, paused or ended.
 *   · LEGAL READINESS — a source whose rule requires an agreement is ready only with an executed
 *     `program_licence:<program>` agreement on that licence (D5048's `licence_program_agreements`). A store this
 *     database lacks reads Not recorded and one that fails reads Unreadable; neither is ever read as signed.
 *   · SUSPENSION AND TERMINATION — the licence's own status. A suspended licence is no source.
 * In force = eligible AND granted AND at least one source legally ready.
 *
 * THE UNION. Every held licence is evaluated; a program appears ONCE, with every licence that sources it. Ending one
 * licence removes the entitlement only when no other valid licence still sources it, because the sources are
 * derived on every read and the grant names no licence. The grant row stays (paused, ended, or granted but
 * blocked by "no valid source"); nothing is deleted or rewritten when a licence changes.
 *
 * WHAT IS NEVER READ: `users.role`. The primary licence counts through its own `licences` row (D5058's backfill),
 * and an account with no row holds nothing here, whatever its role says. Admin is not a licence (D5057).
 *
 * NO POLICY IS IN THIS FILE. Which program a type may access, and whether it needs an agreement, is the rule rows'
 * (seeded from the issue's examples). The evaluation names no program and no licence type.
 *
 * TERRITORY PROGRAM GRANTS (`program_grants`, D982) are not read or written here: they are what HQ grants a studio.
 */
import { branchOf } from '../util/branch';
import type { Env } from '../types';
import { ACCESS_STATUSES, USER_LICENCE_TYPES, type UserLicenceStatus, type UserLicenceType } from './userLicences';
import { PROGRAMS } from './programGrants';
import { isRegistryKey } from './programRegistry';

export const LICENCE_TYPE_LABEL: Record<UserLicenceType, string> = {
  founder: 'Founder', investor: 'Investor', operating_partner: 'Operating Partner', advisor: 'Advisor',
};
export const GRANT_STATES = ['granted', 'paused', 'ended'] as const;
export type GrantState = (typeof GRANT_STATES)[number];
/** A grant write, by action, and the states it may start from (`none`: no row yet). */
export const GRANT_ACTIONS: Record<string, { to: GrantState; from: ReadonlyArray<GrantState | 'none'>; needsSource: boolean }> = {
  grant: { to: 'granted', from: ['none', 'ended'], needsSource: true },
  pause: { to: 'paused', from: ['granted'], needsSource: false },
  resume: { to: 'granted', from: ['paused'], needsSource: true },
  end: { to: 'ended', from: ['granted', 'paused'], needsSource: false },
};
export const REASON_MIN = 10;

export class EntitlementError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  readonly extra: Record<string, unknown>;
  constructor(status: 400 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

export type Rule = {
  uid: string; program_key: string; licence_type: UserLicenceType; version: number; eligible: boolean;
  agreement_required: boolean; effective_from: string; reason: string; origin: string; created_at: string;
  created_by_user_id: number | null;
};
export type HeldLicence = {
  uid: string; licence_ref: string; licence_type: UserLicenceType; status: string; revision: number; user_id: number;
};
export type Grant = {
  uid: string; user_id: number; program_key: string; state: GrantState; revision: number; created_at: string;
  updated_at: string;
};
type AgreementRow = { uid: string; licence_uid: string; slot_key: string; status: string };
/** What the agreement store answered: its rows, or why there are none to read. */
export type AgreementRead = { state: 'read'; rows: AgreementRow[] } | { state: 'not_recorded' | 'unreadable' };

export type AgreementState = 'not_required' | 'executed' | 'awaiting_signature' | 'not_sent' | 'missing' | 'not_recorded' | 'unreadable';
export type Source = {
  licence_uid: string; licence_ref: string; licence_type: UserLicenceType; licence_type_label: string; status: string;
  rule: { uid: string; version: number; effective_from: string; agreement_required: boolean };
  agreement: { state: AgreementState; agreement_uid: string | null };
  legally_ready: boolean;
};
export type Blocker = { code: string; sentence: string; licence_uid?: string };
export type EntitlementStatus = 'in_force' | 'granted_not_in_force' | 'eligible_not_granted' | 'paused' | 'ended' | 'not_eligible';
export type Entitlement = {
  program_key: string; program_name: string;
  eligible: boolean; sources: Source[];
  /** Held licences of an eligible type that are not valid sources (suspended, expired, terminated, proposed). */
  held_not_valid: Array<{ licence_uid: string; licence_ref: string; licence_type: UserLicenceType; licence_type_label: string; status: string }>;
  grant: Grant | null; granted: boolean;
  legally_ready: boolean; in_force: boolean;
  /** The source licence the program is in force through (the first ready one), or null. */
  in_force_via: string | null;
  status: EntitlementStatus;
  blockers: Blocker[];
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const todayUtc = () => new Date().toISOString().slice(0, 10);
const isUserType = (v: unknown): v is UserLicenceType => (USER_LICENCE_TYPES as readonly string[]).includes(String(v));

function ruleOf(r: Record<string, any>): Rule {
  return {
    uid: String(r.uid), program_key: String(r.program_key), licence_type: r.licence_type, version: Number(r.version),
    eligible: Number(r.eligible) === 1, agreement_required: Number(r.agreement_required) === 1,
    effective_from: String(r.effective_from), reason: String(r.reason), origin: String(r.origin),
    created_at: String(r.created_at), created_by_user_id: r.created_by_user_id ?? null,
  };
}
function grantOf(r: Record<string, any>): Grant {
  return {
    uid: String(r.uid), user_id: Number(r.user_id), program_key: String(r.program_key), state: r.state,
    revision: Number(r.revision), created_at: String(r.created_at), updated_at: String(r.updated_at),
  };
}

/** The version of each (program, type) pair in force on `day`: the highest whose effective date has come. */
export function rulesInForce(rules: Rule[], day: string): Map<string, Rule> {
  const out = new Map<string, Rule>();
  for (const r of rules) {
    if (r.effective_from > day) continue;
    const k = `${r.program_key}|${r.licence_type}`;
    const cur = out.get(k);
    if (!cur || r.version > cur.version) out.set(k, r);
  }
  return out;
}

function agreementStateOf(read: AgreementRead, licenceUid: string, programKey: string): { state: AgreementState; agreement_uid: string | null } {
  if (read.state !== 'read') return { state: read.state, agreement_uid: null };
  const slot = `program_licence:${programKey}`;
  const mine = read.rows.filter((r) => r.licence_uid === licenceUid && r.slot_key === slot);
  const executed = mine.find((r) => r.status === 'executed');
  if (executed) return { state: 'executed', agreement_uid: executed.uid };
  const signing = mine.find((r) => r.status === 'sent' || r.status === 'partially_signed');
  if (signing) return { state: 'awaiting_signature', agreement_uid: signing.uid };
  const prepared = mine.find((r) => r.status === 'draft' || r.status === 'ready');
  if (prepared) return { state: 'not_sent', agreement_uid: prepared.uid };
  return { state: 'missing', agreement_uid: null };
}

const AGREEMENT_BLOCKER: Record<Exclude<AgreementState, 'not_required' | 'executed'>, [string, (p: string, ref: string) => string]> = {
  missing: ['agreement_missing', (p, ref) => `${p} needs an executed program licence agreement on ${ref}. None is on file.`],
  not_sent: ['agreement_not_sent', (p, ref) => `${p}'s program licence agreement on ${ref} is prepared but not sent.`],
  awaiting_signature: ['agreement_awaiting_signature', (p, ref) => `${p}'s program licence agreement on ${ref} is awaiting signature.`],
  not_recorded: ['agreement_not_recorded', (p, ref) => `${p} needs an agreement on ${ref}, and agreements are not recorded here. It is not treated as signed.`],
  unreadable: ['agreement_unreadable', (p, ref) => `${p}'s agreement on ${ref} could not be read. It is not treated as signed.`],
};

const STATUS_WORD: Record<string, string> = {
  proposed: 'proposed', suspended: 'suspended', expired: 'expired', terminated: 'terminated',
};

/**
 * The pure evaluation: one account's held licences, every rule version, the account's grants and the agreement
 * read, on one day. A program appears when an in-force rule makes any held licence's type eligible (valid or
 * not, so a suspended source still explains itself) or when the account holds a grant of it.
 */
export function evaluateEntitlements(input: {
  licences: HeldLicence[]; rules: Rule[]; grants: Grant[]; agreements: AgreementRead; day: string;
  programName: (key: string) => string;
}): Entitlement[] {
  const inForce = rulesInForce(input.rules, input.day);
  const keys = new Set<string>();
  for (const r of inForce.values()) if (r.eligible && input.licences.some((l) => l.licence_type === r.licence_type)) keys.add(r.program_key);
  for (const g of input.grants) keys.add(g.program_key);
  const out: Entitlement[] = [];
  for (const key of keys) {
    const name = input.programName(key);
    const sources: Source[] = [];
    const heldNotValid: Entitlement['held_not_valid'] = [];
    for (const l of input.licences) {
      const rule = inForce.get(`${key}|${l.licence_type}`);
      if (!rule || !rule.eligible) continue;
      const label = LICENCE_TYPE_LABEL[l.licence_type];
      if (!ACCESS_STATUSES.includes(l.status as UserLicenceStatus)) {
        heldNotValid.push({ licence_uid: l.uid, licence_ref: l.licence_ref, licence_type: l.licence_type, licence_type_label: label, status: l.status });
        continue;
      }
      const agreement = rule.agreement_required ? agreementStateOf(input.agreements, l.uid, key) : { state: 'not_required' as const, agreement_uid: null };
      sources.push({
        licence_uid: l.uid, licence_ref: l.licence_ref, licence_type: l.licence_type, licence_type_label: label, status: l.status,
        rule: { uid: rule.uid, version: rule.version, effective_from: rule.effective_from, agreement_required: rule.agreement_required },
        agreement, legally_ready: agreement.state === 'not_required' || agreement.state === 'executed',
      });
    }
    const grant = input.grants.find((g) => g.program_key === key) ?? null;
    const eligible = sources.length > 0;
    const granted = grant?.state === 'granted';
    const ready = sources.find((s) => s.legally_ready) ?? null;
    const inForceNow = eligible && granted && !!ready;
    const blockers: Blocker[] = [];
    if (!eligible) {
      if (heldNotValid.length) {
        for (const h of heldNotValid) {
          blockers.push({ code: `licence_${h.status}`, licence_uid: h.licence_uid, sentence: `${h.licence_type_label} licence ${h.licence_ref} is ${STATUS_WORD[h.status] ?? h.status}, so it is no source for ${name}.` });
        }
      } else {
        blockers.push({ code: 'no_eligible_licence', sentence: `No licence this account holds is eligible for ${name}.` });
      }
    }
    if (!grant) { if (eligible) blockers.push({ code: 'not_granted', sentence: `${name} is eligible but HQ has not granted it.` }); }
    else if (grant.state === 'paused') blockers.push({ code: 'grant_paused', sentence: `HQ has paused ${name} for this account.` });
    else if (grant.state === 'ended') blockers.push({ code: 'grant_ended', sentence: `HQ has ended ${name} for this account.` });
    if (eligible && !ready) {
      for (const s of sources) {
        const st = s.agreement.state;
        if (st === 'not_required' || st === 'executed') continue;
        const [code, say] = AGREEMENT_BLOCKER[st];
        blockers.push({ code, licence_uid: s.licence_uid, sentence: say(name, s.licence_ref) });
      }
    }
    let status: EntitlementStatus;
    if (inForceNow) status = 'in_force';
    else if (grant?.state === 'paused') status = 'paused';
    else if (grant?.state === 'ended') status = eligible ? 'ended' : 'not_eligible';
    else if (granted) status = 'granted_not_in_force';
    else status = eligible ? 'eligible_not_granted' : 'not_eligible';
    out.push({
      program_key: key, program_name: name, eligible, sources, held_not_valid: heldNotValid, grant, granted,
      legally_ready: !!ready, in_force: inForceNow, in_force_via: inForceNow && ready ? ready.licence_uid : null, status, blockers,
    });
  }
  const order = new Map(PROGRAMS.map((p, i) => [p.key, i]));
  return out.sort((a, b) => (order.get(a.program_key) ?? 999) - (order.get(b.program_key) ?? 999) || a.program_key.localeCompare(b.program_key));
}

// ─────────────────────────────────────────────── reads

export async function readRules(env: Env): Promise<Rule[]> {
  const q = await env.DB.prepare('SELECT * FROM program_licence_rules ORDER BY program_key, licence_type, version').all<Record<string, any>>();
  return (q.results || []).map(ruleOf);
}

/** The program names: the catalogue's nine and every program the registry added. */
export async function programOptions(env: Env) {
  const names = new Map(PROGRAMS.map((p) => [p.key, p.name]));
  try {
    const q = await env.DB.prepare('SELECT key, name FROM programs').all<{ key: string; name: string }>();
    for (const r of q.results || []) if (!names.has(r.key)) names.set(r.key, r.name);
  } catch { /* the registry is optional for a name: the key stands in */ }
  return names;
}

export async function programNames(env: Env): Promise<(key: string) => string> {
  const names = await programOptions(env);
  return (key: string) => names.get(key) ?? key;
}

async function heldLicencesOf(env: Env, userIds: number[]): Promise<HeldLicence[]> {
  if (!userIds.length) return [];
  const q = await env.DB.prepare(
    `SELECT uid, licence_ref, licence_type, status, revision, holder_id FROM licences
      WHERE licence_family = 'user' AND holder_type = 'user' AND holder_id IN (SELECT value FROM json_each(?))
      ORDER BY holder_id, CASE licence_type WHEN 'founder' THEN 1 WHEN 'investor' THEN 2 WHEN 'operating_partner' THEN 3 ELSE 4 END`,
  ).bind(JSON.stringify(userIds.map(String))).all<Record<string, any>>();
  return (q.results || []).filter((r) => isUserType(r.licence_type)).map((r) => ({
    uid: String(r.uid), licence_ref: String(r.licence_ref), licence_type: r.licence_type, status: String(r.status),
    revision: Number(r.revision), user_id: Number(r.holder_id),
  }));
}

async function grantsOf(env: Env, userIds: number[]): Promise<Grant[]> {
  if (!userIds.length) return [];
  const r = await env.DB.prepare('SELECT * FROM user_program_grants WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY user_id, program_key')
    .bind(JSON.stringify(userIds)).all<Record<string, any>>();
  return (r.results || []).map(grantOf);
}

/** The program licence agreements on these licences. A missing store is Not recorded; a failed read, Unreadable. */
export async function readAgreements(env: Env, licenceUids: string[]): Promise<AgreementRead> {
  if (!licenceUids.length) return { state: 'read', rows: [] };
  try {
    const q = await env.DB.prepare(
      `SELECT uid, licence_uid, slot_key, status FROM licence_program_agreements
        WHERE licence_uid IN (SELECT value FROM json_each(?)) AND agreement_kind = 'program_licence'
          AND status IN ('draft', 'ready', 'sent', 'partially_signed', 'executed')`,
    ).bind(JSON.stringify(licenceUids)).all<AgreementRow>();
    return { state: 'read', rows: (q.results || []).map((r) => ({ uid: String(r.uid), licence_uid: String(r.licence_uid), slot_key: String(r.slot_key), status: String(r.status) })) };
  } catch (e) {
    return /no such table/i.test(String((e as Error)?.message || e)) ? { state: 'not_recorded' } : { state: 'unreadable' };
  }
}

type Account = { id: number; name: string | null; email: string | null; role: string | null; is_active: boolean };
async function accountOf(env: Env, userId: number): Promise<Account | null> {
  const u = await env.DB.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').bind(userId).first<Record<string, any>>();
  return u ? { id: Number(u.id), name: u.name ?? null, email: u.email ?? null, role: u.role ?? null, is_active: Number(u.is_active ?? 1) === 1 } : null;
}

/** Every account in `userIds`, evaluated together: four statements whatever the number of accounts. */
export async function evaluateMany(env: Env, userIds: number[], day: string) {
  const [licences, rules, grants, name] = await Promise.all([heldLicencesOf(env, userIds), readRules(env), grantsOf(env, userIds), programNames(env)]);
  const agreements = await readAgreements(env, licences.map((l) => l.uid));
  const by = new Map<number, Entitlement[]>();
  for (const id of userIds) {
    by.set(id, evaluateEntitlements({
      licences: licences.filter((l) => l.user_id === id), rules, grants: grants.filter((g) => g.user_id === id), agreements, day, programName: name,
    }));
  }
  return { licences, by, agreements: agreements.state };
}

const licenceView = (l: HeldLicence) => ({
  uid: l.uid, licence_ref: l.licence_ref, licence_type: l.licence_type, licence_type_label: LICENCE_TYPE_LABEL[l.licence_type],
  status: l.status, revision: l.revision, valid_source: ACCESS_STATUSES.includes(l.status as UserLicenceStatus),
});

/**
 * Apply the licence entitlement alongside a program's existing participation checks.
 * Rollout is explicit because the policy seed only creates eligibility rules.
 */
export async function checkMemberProgramEntry(env: Env, userId: number, programKey: string) {
  if (env.PROGRAM_ENTITLEMENT_ENFORCEMENT !== 'true' || branchOf(env)) return 'allowed';
  try {
    const day = todayUtc();
    const [licences, rules, grants] = await Promise.all([heldLicencesOf(env, [userId]), readRules(env), grantsOf(env, [userId])]);
    const agreements = await readAgreements(env, licences.map((licence) => licence.uid));
    const program = evaluateEntitlements({ licences, rules, grants, agreements, day, programName: (key) => key })
      .find((entry) => entry.program_key === programKey);
    if (program?.in_force) return 'allowed';
    if (program?.blockers.some((blocker) => blocker.code === 'agreement_unreadable')) return 'unavailable';
    return 'blocked';
  } catch (error) {
    console.warn('[program-entitlements] entry read failed', error);
    return 'unavailable';
  }
}

/** One account: the licences it holds and every program they make it eligible for, or that HQ granted it. */
export async function entitlementsOfAccount(env: Env, userId: number, day = todayUtc()) {
  const account = await accountOf(env, userId);
  if (!account) throw new EntitlementError(404, 'not_found', 'Account not found.');
  const e = await evaluateMany(env, [userId], day);
  return {
    on: day, account, licences: e.licences.map(licenceView), programs: e.by.get(userId) || [], agreements: e.agreements,
  };
}

/**
 * One user licence's detail: the licence, its holder, and the programs its type is eligible for or that it
 * sources, each with every source licence (this one or another the holder holds) and the blockers.
 */
export async function entitlementsOfLicence(env: Env, uid: string, day = todayUtc()) {
  const row = await env.DB.prepare(
    "SELECT uid, licence_ref, licence_type, status, revision, holder_id, starts_on, ends_on, renews_on FROM licences WHERE uid = ? AND licence_family = 'user' AND holder_type = 'user'",
  ).bind(uid).first<Record<string, any>>();
  if (!row || !isUserType(row.licence_type)) throw new EntitlementError(404, 'not_found', 'No user licence with that id.');
  const userId = Number(row.holder_id);
  const account = await accountOf(env, userId);
  const e = await evaluateMany(env, [userId], day);
  const rules = rulesInForce(await readRules(env), day);
  const typeEligible = (key: string) => !!rules.get(`${key}|${row.licence_type}`)?.eligible;
  const programs = (e.by.get(userId) || []).filter((p) => typeEligible(p.program_key)
    || p.sources.some((s) => s.licence_uid === uid) || p.held_not_valid.some((h) => h.licence_uid === uid));
  const self = e.licences.find((l) => l.uid === uid)!;
  return {
    on: day,
    licence: { ...licenceView(self), starts_on: row.starts_on ?? null, ends_on: row.ends_on ?? null, renews_on: row.renews_on ?? null },
    account, other_licences: e.licences.filter((l) => l.uid !== uid).map(licenceView),
    programs: programs.map((p) => ({ ...p, source_is_this_licence: p.sources.some((s) => s.licence_uid === uid) })),
    agreements: e.agreements,
  };
}

export type AccessQuery = { licence_type: UserLicenceType | null; holder: number | null; program: string | null; q: string | null; limit: number };

/** The Program access filter's query, refused (400) with the filter's name when a value is unknown. */
export function accessQuery(raw: Record<string, string | undefined>): AccessQuery {
  const type = raw.licence_type && raw.licence_type !== 'all' ? raw.licence_type : null;
  if (type !== null && !isUserType(type)) throw new EntitlementError(400, 'invalid_licence_type', `licence_type must be all or one of ${USER_LICENCE_TYPES.join(', ')}.`);
  let holder: number | null = null;
  if (raw.holder) {
    const m = /^user:([1-9][0-9]{0,15})$/.exec(raw.holder);
    if (!m || !Number.isSafeInteger(Number(m[1]))) throw new EntitlementError(400, 'invalid_holder', 'holder must be user:<account id>.');
    holder = Number(m[1]);
  }
  const program = raw.program || null;
  if (program !== null && !isRegistryKey(program)) throw new EntitlementError(400, 'invalid_program', 'program must be a program key.');
  const q = (raw.q || '').trim().slice(0, 120) || null;
  const n = Number(raw.limit ?? 100);
  const limit = Number.isInteger(n) && n >= 1 && n <= 200 ? n : 100;
  return { licence_type: type as UserLicenceType | null, holder, program, q, limit };
}

/**
 * Program access by user licence: one row per account and program, filtered by the licence type that sources (or
 * would source) it, the holder, the program and a name or email search. Accounts are taken in id order, up to
 * `limit`; `truncated` says when more matched.
 */
export async function programAccessByHolder(env: Env, query: AccessQuery, day = todayUtc()) {
  const like = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const ids = await env.DB.prepare(
    `SELECT DISTINCT u.id, u.name, u.email FROM licences l JOIN users u ON CAST(l.holder_id AS INTEGER) = u.id
      WHERE l.licence_family = 'user' AND l.holder_type = 'user'
        AND (?1 IS NULL OR l.licence_type = ?1)
        AND (?2 IS NULL OR u.id = ?2)
        AND (?3 IS NULL OR u.name LIKE ?3 ESCAPE '\\' OR u.email LIKE ?3 ESCAPE '\\' OR l.licence_ref LIKE ?3 ESCAPE '\\')
      ORDER BY u.id LIMIT ?4`,
  ).bind(query.licence_type, query.holder, like, query.limit + 1).all<{ id: number; name: string | null; email: string | null }>();
  const found = ids.results || [];
  const truncated = found.length > query.limit;
  const holders = found.slice(0, query.limit);
  const e = await evaluateMany(env, holders.map((h) => Number(h.id)), day);
  const items: Array<Record<string, unknown>> = [];
  for (const h of holders) {
    for (const p of e.by.get(Number(h.id)) || []) {
      if (query.program && p.program_key !== query.program) continue;
      if (query.licence_type && !p.sources.some((s) => s.licence_type === query.licence_type)
        && !p.held_not_valid.some((s) => s.licence_type === query.licence_type)) continue;
      items.push({ holder: { type: 'user', id: Number(h.id), name: h.name ?? null, email: h.email ?? null }, ...p });
    }
  }
  return { on: day, items, holders: holders.length, truncated, agreements: e.agreements, filters: query };
}

// ─────────────────────────────────────────────── rule versions

export type RuleInput = { program_key: string; licence_type: UserLicenceType; eligible: boolean; agreement_required: boolean; effective_from: string; reason: string };

export function parseRuleInput(b: any): { ok: true; value: RuleInput } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const program = typeof b?.program_key === 'string' ? b.program_key : '';
  if (!isRegistryKey(program)) fields.program_key = 'must be a program key';
  const type = b?.licence_type;
  if (!isUserType(type)) fields.licence_type = `must be one of ${USER_LICENCE_TYPES.join(', ')}`;
  if (typeof b?.eligible !== 'boolean') fields.eligible = 'must be true or false';
  const agreement = b?.agreement_required ?? false;
  if (typeof agreement !== 'boolean') fields.agreement_required = 'must be true or false';
  else if (agreement && b?.eligible === false) fields.agreement_required = 'a version that withdraws eligibility requires nothing';
  if (!isDay(b?.effective_from)) fields.effective_from = 'must be a real date as YYYY-MM-DD';
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  if (reason.length < REASON_MIN) fields.reason = `say why, in at least ${REASON_MIN} characters`;
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { program_key: program, licence_type: type, eligible: b.eligible, agreement_required: agreement, effective_from: b.effective_from, reason } };
}

/** The next version of one pair. A version may not take effect before the one it follows. */
export async function addRuleVersion(env: Env, v: RuleInput, actorId: number): Promise<Rule> {
  const latest = await env.DB.prepare('SELECT * FROM program_licence_rules WHERE program_key = ? AND licence_type = ? ORDER BY version DESC LIMIT 1')
    .bind(v.program_key, v.licence_type).first<Record<string, any>>();
  if (latest && v.effective_from < String(latest.effective_from)) {
    throw new EntitlementError(409, 'effective_before_previous', `Version ${latest.version} takes effect on ${latest.effective_from}; a later version cannot take effect before it.`, { latest: ruleOf(latest) });
  }
  const uid = `plr_${crypto.randomUUID()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO program_licence_rules (uid, program_key, licence_type, version, eligible, agreement_required, effective_from, reason, origin, created_by_user_id)
       SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, 'hq', ? FROM program_licence_rules WHERE program_key = ? AND licence_type = ?`,
    ).bind(uid, v.program_key, v.licence_type, v.eligible ? 1 : 0, v.agreement_required ? 1 : 0, v.effective_from, v.reason, actorId, v.program_key, v.licence_type).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message || e))) throw new EntitlementError(409, 'rule_changed', 'Another version of this rule was saved at the same time. Nothing was saved. Read the rules again.');
    throw e;
  }
  return ruleOf((await env.DB.prepare('SELECT * FROM program_licence_rules WHERE uid = ?').bind(uid).first<Record<string, any>>())!);
}

// ─────────────────────────────────────────────── the grant

/**
 * One grant write for one account and program, guarded by the revision read (0: no grant yet). A grant or resume
 * needs a valid source licence now; a pause or end does not. Agreement readiness never refuses a grant: a granted
 * program waits on it to be in force. The event records the sources at the time, for the history.
 */
export async function changeGrant(env: Env, a: {
  userId: number; programKey: string; action: string; expectedRevision: number; reason: string; actorId: number; day?: string;
}): Promise<{ grant: Grant; entitlement: Entitlement | null }> {
  const t = GRANT_ACTIONS[a.action];
  if (!t) throw new EntitlementError(400, 'invalid_action', `The action must be one of ${Object.keys(GRANT_ACTIONS).join(', ')}.`);
  const day = a.day ?? todayUtc();
  const before = await entitlementsOfAccount(env, a.userId, day);
  const current = (await grantsOf(env, [a.userId])).find((g) => g.program_key === a.programKey) ?? null;
  const currentRevision = current ? current.revision : 0;
  if (currentRevision !== a.expectedRevision) {
    throw new EntitlementError(409, 'grant_changed', 'This grant changed since you opened it. Nothing was saved. Review the latest, then make your change again.', { current });
  }
  const from: GrantState | 'none' = current ? current.state : 'none';
  if (!t.from.includes(from)) {
    throw new EntitlementError(409, 'invalid_transition', from === 'none' ? 'There is no grant of this program to change.' : `A ${from} grant cannot be ${a.action === 'end' ? 'ended' : `${a.action}d`}.`, { current });
  }
  const ent = before.programs.find((p) => p.program_key === a.programKey) ?? null;
  const sources = ent ? ent.sources.map((s) => s.licence_uid) : [];
  if (t.needsSource && !sources.length) {
    throw new EntitlementError(409, 'not_eligible', 'No licence this account holds is a valid source for this program today, so it cannot be granted.', { entitlement: ent });
  }
  const now = new Date().toISOString();
  const uid = current?.uid ?? `upg_${crypto.randomUUID()}`;
  const write = current
    ? env.DB.prepare(
      `UPDATE user_program_grants SET state = ?, revision = revision + 1, updated_at = ?, updated_by_user_id = ?
        WHERE uid = ? AND revision = ? AND state = ?`,
    ).bind(t.to, now, a.actorId, uid, current.revision, current.state)
    : env.DB.prepare(
      `INSERT OR IGNORE INTO user_program_grants (uid, user_id, program_key, state, revision, created_at, created_by_user_id, updated_at, updated_by_user_id)
       VALUES (?, ?, ?, 'granted', 1, ?, ?, ?, ?)`,
    ).bind(uid, a.userId, a.programKey, now, a.actorId, now, a.actorId);
  const res = await env.DB.batch([
    write,
    env.DB.prepare(
      `INSERT INTO user_program_grant_events (grant_uid, user_id, program_key, action, from_state, to_state, revision, sources_json, reason, actor_id)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(uid, a.userId, a.programKey, a.action, current?.state ?? null, t.to, currentRevision + 1, JSON.stringify(sources), a.reason, a.actorId),
  ]);
  if (!res[0].meta.changes) {
    const now2 = (await grantsOf(env, [a.userId])).find((g) => g.program_key === a.programKey) ?? null;
    throw new EntitlementError(409, 'grant_changed', 'This grant changed since you opened it. Nothing was saved. Review the latest, then make your change again.', { current: now2 });
  }
  const after = await entitlementsOfAccount(env, a.userId, day);
  const grant = (await grantsOf(env, [a.userId])).find((g) => g.program_key === a.programKey)!;
  return { grant, entitlement: after.programs.find((p) => p.program_key === a.programKey) ?? null };
}

/** The account's grant history, newest first. */
export async function grantEventsOf(env: Env, userId: number) {
  const q = await env.DB.prepare('SELECT * FROM user_program_grant_events WHERE user_id = ? ORDER BY id DESC LIMIT 200').bind(userId).all<Record<string, any>>();
  return (q.results || []).map((e) => {
    let sources: string[] = [];
    try { sources = JSON.parse(String(e.sources_json || '[]')); } catch { sources = []; }
    return {
      id: Number(e.id), grant_uid: String(e.grant_uid), program_key: String(e.program_key), action: String(e.action),
      from_state: e.from_state ?? null, to_state: String(e.to_state), revision: Number(e.revision), sources,
      reason: String(e.reason), actor_id: e.actor_id ?? null, created_at: String(e.created_at),
    };
  });
}
