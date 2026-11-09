/**
 * D5052 (#5052, part 5 of #5047) — which agreement a package or program needs, when it must be executed, and
 * the history of a licence's legal readiness. The store is migration 202611090840.
 *
 * A POLICY IS VERSIONED CONFIGURATION (`licence_agreement_policies`). For one package or program HQ declares a
 * strategy (`per_program`, `package_master`, `none`) and a legal gate (`optional`, `required_before_grant`,
 * `required_before_in_force`); a package also lists its programs and, under a master, which of them need their
 * own schedule. Every change is a new version; no version is ever updated.
 *
 * A HOLDING FREEZES A VERSION ON ONE LICENCE (`licence_agreement_policy_holdings`): when a package offer is
 * accepted, or a program is granted. A later version reaches no existing holder. A licence holds at most one
 * package (D5048 owner answer A), so accepting another package supersedes the old holding.
 *
 * WHAT A PROGRAM NEEDS (`requirementFor`), from the licence's holdings, never from the current policy:
 *   · the package the licence holds includes the program, under `package_master`: the package's master
 *     agreement executed for THAT package, plus the program's `package_addendum:<program>` when the package
 *     lists the program among its required schedules;
 *   · under `per_program` (the package's, or the program's own): `program_licence:<program>` executed;
 *   · under `none`: no licence agreement;
 *   · no holding at all: NOT RECORDED. Nothing is inferred; the D1120/D4805 schedule rule applies as before.
 * The program schedule (the grant's signed-schedule rule) is required on top of any strategy, as it always was.
 *
 * THE LEGAL STATUS (`programLegalStatus`) is one of: not granted, draft, granted — agreement required,
 * awaiting signature, granted — not in force yet (dates, licence), in force, paused, ended. A required
 * agreement that is not executed can never read as in force: under `required_before_in_force` and
 * `required_before_grant` the gate holds the program; under `optional` the documents are recorded but do not
 * gate. `required_before_grant` also refuses the grant itself (`routes/admin_program_grants.ts`).
 *
 * REPLACEMENT, NEVER MUTATION (`replacementsRequired`). An executed agreement drafted against grant terms
 * revision R stops matching when the grant moves past R; a package master stops matching when the licence
 * holds another package. Either is reported (and recorded once per revision as `replacement_required`); the
 * executed agreement is never voided, superseded or edited for it. The replacement is a new draft of the same
 * slot (D5048: drafting while the executed version stands), which a person sends; it supersedes the old one
 * only when it is executed. Nothing sends automatically.
 *
 * HISTORY. `licence_legal_events` is append-only and names the actor, the policy uid and version, the agreement
 * uid and revision, the package/program and the reason. Gate lines are written when the gate's answer changes
 * (`gateSyncStatements`): satisfied or unsatisfied, once per change.
 */
import type { Env } from '../types';
import { IN_FLIGHT, agreementsOfLicence, type AgreementRow } from './programAgreements';
import { presentGrant, type LicenceLite } from './programGrants';

export const STRATEGIES = ['per_program', 'package_master', 'none'] as const;
export type Strategy = typeof STRATEGIES[number];
export const LEGAL_GATES = ['optional', 'required_before_grant', 'required_before_in_force'] as const;
export type LegalGate = typeof LEGAL_GATES[number];
export const SCOPE_KINDS = ['program', 'package'] as const;
export type ScopeKind = typeof SCOPE_KINDS[number];
/** The recommended default (#5052): a grant may exist before signature; in force only once executed. */
export const DEFAULT_GATE: LegalGate = 'required_before_in_force';

const SCOPE_KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const PROGRAM_KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const REASON_MIN = 10;

export type Policy = {
  uid: string; scope_kind: ScopeKind; scope_key: string; version: number; strategy: Strategy; legal_gate: LegalGate;
  programs: string[] | null; required_schedules: string[] | null; reason: string; created_at: string; created_by_user_id: number | null;
};
export type Holding = {
  uid: string; licence_uid: string; scope_kind: ScopeKind; scope_key: string; policy_uid: string; policy_version: number;
  origin: 'program_granted' | 'package_offer_accepted'; package_offer_uid: string | null; frozen_at: string;
  frozen_by_user_id: number | null; superseded_at: string | null; superseded_by_uid: string | null;
  policy: Policy;
};

function list(v: string | null): string[] | null {
  if (v == null) return null;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : null; } catch { return null; }
}

export function policyOf(row: Record<string, any>): Policy {
  return {
    uid: String(row.uid), scope_kind: row.scope_kind, scope_key: String(row.scope_key), version: Number(row.version),
    strategy: row.strategy, legal_gate: row.legal_gate, programs: list(row.programs_json), required_schedules: list(row.required_schedules_json),
    reason: String(row.reason), created_at: String(row.created_at), created_by_user_id: row.created_by_user_id ?? null,
  };
}

export type PolicyInput = {
  scope_kind: ScopeKind; scope_key: string; strategy: Strategy; legal_gate: LegalGate;
  programs: string[] | null; required_schedules: string[] | null; reason: string;
};

/** A policy version as HQ submits it, checked as the table's CHECKs check it, and a little more. */
export function parsePolicyInput(scopeKind: string, scopeKey: string, b: any): { ok: true; value: PolicyInput } | { ok: false; error: string } {
  if (!(SCOPE_KINDS as readonly string[]).includes(scopeKind)) return { ok: false, error: 'The scope is a program or a package.' };
  const kind = scopeKind as ScopeKind;
  if (kind === 'program' ? !PROGRAM_KEY.test(scopeKey) : !SCOPE_KEY.test(scopeKey)) return { ok: false, error: `That is not a ${kind} key.` };
  const strategy = String(b?.strategy ?? '') as Strategy;
  if (!(STRATEGIES as readonly string[]).includes(strategy)) return { ok: false, error: 'Choose a strategy: per_program, package_master or none.' };
  if (strategy === 'package_master' && kind !== 'package') return { ok: false, error: 'A master agreement belongs to a package. A program’s own policy is per_program or none.' };
  const gate = String(b?.legal_gate ?? (strategy === 'none' ? 'optional' : DEFAULT_GATE)) as LegalGate;
  if (!(LEGAL_GATES as readonly string[]).includes(gate)) return { ok: false, error: 'Choose a legal gate: optional, required_before_grant or required_before_in_force.' };
  if (strategy === 'none' && gate !== 'optional') return { ok: false, error: 'With no agreement there is nothing to gate on, so the gate is optional.' };
  const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  if (reason.length < REASON_MIN) return { ok: false, error: `Say why, in at least ${REASON_MIN} characters. It is the line HQ's record keeps.` };
  let programs: string[] | null = null;
  let required: string[] | null = null;
  if (kind === 'package') {
    if (!Array.isArray(b?.programs) || !b.programs.length) return { ok: false, error: 'A package lists the programs it includes.' };
    programs = [...new Set(b.programs.map(String))].sort() as string[];
    if (programs.some((p) => !PROGRAM_KEY.test(p))) return { ok: false, error: 'Each program is a program key.' };
    if (strategy === 'package_master') {
      const req = Array.isArray(b?.required_schedules) ? [...new Set(b.required_schedules.map(String))].sort() as string[] : [];
      if (req.some((p) => !programs!.includes(p))) return { ok: false, error: 'A required schedule names a program the package includes.' };
      required = req;
    } else if (b?.required_schedules != null && (!Array.isArray(b.required_schedules) || b.required_schedules.length)) {
      return { ok: false, error: 'Required schedules belong to a package master agreement.' };
    }
  } else if (b?.programs != null || b?.required_schedules != null) {
    return { ok: false, error: 'A program’s policy lists no programs or schedules.' };
  }
  return { ok: true, value: { scope_kind: kind, scope_key: scopeKey, strategy, legal_gate: gate, programs, required_schedules: required, reason } };
}

// ─────────────────────────────────────────────── statements (all bound)

/**
 * A new version of one scope's policy, numbered one above its latest, and its history line, in one batch. Two
 * saves racing cannot share a number (`UNIQUE (scope_kind, scope_key, version)`); the loser's batch rolls back.
 */
export function policyVersionStatements(env: Env, p: PolicyInput, o: { uid: string; actorId: number; at: string }): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `INSERT INTO licence_agreement_policies
         (uid, scope_kind, scope_key, version, strategy, legal_gate, programs_json, required_schedules_json, reason, created_at, created_by_user_id)
       SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?
         FROM licence_agreement_policies WHERE scope_kind = ? AND scope_key = ?`,
    ).bind(o.uid, p.scope_kind, p.scope_key, p.strategy, p.legal_gate,
      p.programs ? JSON.stringify(p.programs) : null, p.required_schedules ? JSON.stringify(p.required_schedules) : null,
      p.reason, o.at, o.actorId, p.scope_kind, p.scope_key),
    env.DB.prepare(
      `INSERT INTO licence_legal_events (licence_uid, action, scope_kind, scope_key, program_key, package_key, policy_uid, policy_version, actor_user_id, reason, detail_json, created_at)
       SELECT NULL, 'policy_versioned', scope_kind, scope_key,
              CASE WHEN scope_kind = 'program' THEN scope_key END, CASE WHEN scope_kind = 'package' THEN scope_key END,
              uid, version, ?, ?, ?, ? FROM licence_agreement_policies WHERE uid = ?`,
    ).bind(o.actorId, p.reason, JSON.stringify({ strategy: p.strategy, legal_gate: p.legal_gate, programs: p.programs, required_schedules: p.required_schedules }), o.at, o.uid),
  ];
}

/**
 * Freeze the scope's LATEST policy version on a licence: supersede the licence's current holding of that scope
 * (for a package, its current package of any key), then insert the new holding and its history line. Writes
 * nothing when the scope has no policy (no row to select). Callers decide idempotency first
 * (`alreadyHolds`); the partial unique index refuses a second current holding written concurrently.
 */
export function freezeHoldingStatements(env: Env, o: {
  uid: string; licenceUid: string; scopeKind: ScopeKind; scopeKey: string; origin: Holding['origin'];
  packageOfferUid: string | null; actorId: number | null; at: string; reason: string | null;
}): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `UPDATE licence_agreement_policy_holdings SET superseded_at = ?, superseded_by_uid = ?
        WHERE licence_uid = ? AND superseded_at IS NULL
          AND ((scope_kind = 'package' AND ? = 'package') OR (scope_kind = ? AND scope_key = ?))
          AND EXISTS (SELECT uid FROM licence_agreement_policies WHERE scope_kind = ? AND scope_key = ? ORDER BY version DESC LIMIT 1)`,
    ).bind(o.at, o.uid, o.licenceUid, o.scopeKind, o.scopeKind, o.scopeKey, o.scopeKind, o.scopeKey),
    env.DB.prepare(
      `INSERT INTO licence_agreement_policy_holdings
         (uid, licence_uid, scope_kind, scope_key, policy_uid, policy_version, origin, package_offer_uid, frozen_at, frozen_by_user_id)
       SELECT ?, ?, scope_kind, scope_key, uid, version, ?, ?, ?, ? FROM licence_agreement_policies
        WHERE uid = (SELECT uid FROM licence_agreement_policies WHERE scope_kind = ? AND scope_key = ? ORDER BY version DESC LIMIT 1)`,
    ).bind(o.uid, o.licenceUid, o.origin, o.packageOfferUid, o.at, o.actorId, o.scopeKind, o.scopeKey),
    env.DB.prepare(
      `INSERT INTO licence_legal_events (licence_uid, action, scope_kind, scope_key, program_key, package_key, policy_uid, policy_version, actor_user_id, reason, detail_json, created_at)
       SELECT h.licence_uid, 'policy_frozen', h.scope_kind, h.scope_key,
              CASE WHEN h.scope_kind = 'program' THEN h.scope_key END, CASE WHEN h.scope_kind = 'package' THEN h.scope_key END,
              h.policy_uid, h.policy_version, ?, ?, ?, ? FROM licence_agreement_policy_holdings h WHERE h.uid = ?`,
    ).bind(o.actorId, o.reason, JSON.stringify({ origin: o.origin, package_offer_uid: o.packageOfferUid }), o.at, o.uid),
  ];
}

/**
 * The executed agreements of a program that a grant terms change leaves stale, recorded once per revision
 * (`idx_licence_legal_events_replacement_once`). `newRevision` is the grant's revision after the change. Only
 * agreements drafted against an earlier revision are named; none of them is changed.
 */
export function replacementOnTermsChangeStatement(env: Env, o: {
  licenceUid: string; programKey: string; newRevision: number; actorId: number | null; at: string; reason: string | null;
}): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO licence_legal_events
       (licence_uid, action, scope_kind, scope_key, program_key, package_key, agreement_uid, agreement_revision, terms_revision, actor_user_id, reason, detail_json, created_at)
     SELECT a.licence_uid, 'replacement_required', 'program', ?, ?, a.package_key, a.uid, a.revision, ?, ?, ?, ?, ?
       FROM licence_program_agreements a
      WHERE a.licence_uid = ? AND a.status = 'executed'
        AND (a.slot_key = 'program_licence:' || ? OR a.slot_key LIKE 'program_addendum:' || ? || ':%' OR a.slot_key = 'package_addendum:' || ?)
        AND COALESCE(CAST(json_extract(a.merge_values_json, '$."grant.revision"') AS INTEGER), 1) < ?`,
  ).bind(o.programKey, o.programKey, o.newRevision, o.actorId, o.reason,
    JSON.stringify({ why: 'grant_terms_changed', grant_terms_revision: o.newRevision }), o.at,
    o.licenceUid, o.programKey, o.programKey, o.programKey, o.newRevision);
}

/** A licence moved to another package: its executed master for the old package needs replacing (recorded once). */
export function replacementOnPackageMoveStatement(env: Env, o: {
  licenceUid: string; packageKey: string; actorId: number | null; at: string; reason: string | null;
}): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO licence_legal_events
       (licence_uid, action, scope_kind, scope_key, package_key, agreement_uid, agreement_revision, terms_revision, actor_user_id, reason, detail_json, created_at)
     SELECT a.licence_uid, 'replacement_required', 'package', ?, ?, a.uid, a.revision, 0, ?, ?,
            json_object('why', 'package_changed', 'from_package', a.package_key, 'to_package', ?), ?
       FROM licence_program_agreements a
      WHERE a.licence_uid = ? AND a.status = 'executed' AND a.agreement_kind IN ('package_master', 'package_addendum') AND a.package_key IS NOT ?`,
  ).bind(o.packageKey, o.packageKey, o.actorId, o.reason, o.packageKey, o.at, o.licenceUid, o.packageKey);
}

// ─────────────────────────────────────────────── reads

export async function latestPolicies(env: Env): Promise<Policy[]> {
  const q = await env.DB.prepare(
    `SELECT p.* FROM licence_agreement_policies p
      WHERE p.version = (SELECT MAX(x.version) FROM licence_agreement_policies x WHERE x.scope_kind = p.scope_kind AND x.scope_key = p.scope_key)
      ORDER BY p.scope_kind, p.scope_key`,
  ).all<Record<string, any>>();
  return (q.results || []).map(policyOf);
}

export async function policyVersions(env: Env, scopeKind: ScopeKind, scopeKey: string): Promise<Policy[]> {
  const q = await env.DB.prepare('SELECT * FROM licence_agreement_policies WHERE scope_kind = ? AND scope_key = ? ORDER BY version DESC')
    .bind(scopeKind, scopeKey).all<Record<string, any>>();
  return (q.results || []).map(policyOf);
}

export async function latestPolicy(env: Env, scopeKind: ScopeKind, scopeKey: string): Promise<Policy | null> {
  const row = await env.DB.prepare('SELECT * FROM licence_agreement_policies WHERE scope_kind = ? AND scope_key = ? ORDER BY version DESC LIMIT 1')
    .bind(scopeKind, scopeKey).first<Record<string, any>>();
  return row ? policyOf(row) : null;
}

/** The licence's holdings with the policy version each one froze. `all` includes superseded holdings. */
export async function holdingsOf(env: Env, licenceUid: string, all = false): Promise<Holding[]> {
  const q = await env.DB.prepare(
    `SELECT h.*, p.uid AS p_uid, p.scope_kind AS p_scope_kind, p.scope_key AS p_scope_key, p.version AS p_version, p.strategy AS p_strategy,
            p.legal_gate AS p_legal_gate, p.programs_json AS p_programs_json, p.required_schedules_json AS p_required_schedules_json,
            p.reason AS p_reason, p.created_at AS p_created_at, p.created_by_user_id AS p_created_by_user_id
       FROM licence_agreement_policy_holdings h JOIN licence_agreement_policies p ON p.uid = h.policy_uid
      WHERE h.licence_uid = ? AND (? = 1 OR h.superseded_at IS NULL) ORDER BY h.id`,
  ).bind(licenceUid, all ? 1 : 0).all<Record<string, any>>();
  return (q.results || []).map((r) => ({
    uid: r.uid, licence_uid: r.licence_uid, scope_kind: r.scope_kind, scope_key: r.scope_key, policy_uid: r.policy_uid,
    policy_version: Number(r.policy_version), origin: r.origin, package_offer_uid: r.package_offer_uid ?? null, frozen_at: r.frozen_at,
    frozen_by_user_id: r.frozen_by_user_id ?? null, superseded_at: r.superseded_at ?? null, superseded_by_uid: r.superseded_by_uid ?? null,
    policy: policyOf({
      uid: r.p_uid, scope_kind: r.p_scope_kind, scope_key: r.p_scope_key, version: r.p_version, strategy: r.p_strategy, legal_gate: r.p_legal_gate,
      programs_json: r.p_programs_json, required_schedules_json: r.p_required_schedules_json, reason: r.p_reason, created_at: r.p_created_at,
      created_by_user_id: r.p_created_by_user_id,
    }),
  }));
}

/** True when the licence's current holding of this scope already froze the latest version (and offer): accepting again changes nothing. */
export function alreadyHolds(holdings: Holding[], scopeKind: ScopeKind, scopeKey: string, latest: Policy | null, packageOfferUid: string | null): boolean {
  if (!latest) return false;
  const h = holdings.find((x) => x.scope_kind === scopeKind && x.scope_key === scopeKey && !x.superseded_at);
  return !!h && h.policy_uid === latest.uid && (h.package_offer_uid ?? null) === (packageOfferUid ?? null);
}

// ─────────────────────────────────────────────── what a program needs, and where it stands

export type RequiredDocument = {
  slot_key: string;
  kind: 'package_master' | 'package_addendum' | 'program_licence' | 'program_schedule';
  /** For a master: the package it must be executed for. */
  package_key: string | null;
  label: string;
};
export type Requirement = {
  basis: 'package' | 'program' | 'not_recorded';
  strategy: Strategy | null;
  legal_gate: LegalGate | null;
  policy_uid: string | null;
  policy_version: number | null;
  package_key: string | null;
  documents: RequiredDocument[];
};

/** What the licence's FROZEN holdings require of one program. Never reads the current policy. */
export function requirementFor(programKey: string, holdings: Holding[]): Requirement {
  const current = holdings.filter((h) => !h.superseded_at);
  const pkg = current.find((h) => h.scope_kind === 'package' && (h.policy.programs || []).includes(programKey)) ?? null;
  const own = current.find((h) => h.scope_kind === 'program' && h.scope_key === programKey) ?? null;
  const out = (basis: Requirement['basis'], h: Holding | null, documents: RequiredDocument[]): Requirement => ({
    basis, strategy: h?.policy.strategy ?? null, legal_gate: h?.policy.legal_gate ?? null,
    policy_uid: h?.policy_uid ?? null, policy_version: h?.policy_version ?? null,
    package_key: pkg ? pkg.scope_key : null, documents,
  });
  const programLicence = (): RequiredDocument => ({ slot_key: `program_licence:${programKey}`, kind: 'program_licence', package_key: null, label: 'Program licence agreement' });
  if (pkg && pkg.policy.strategy === 'package_master') {
    const docs: RequiredDocument[] = [{ slot_key: 'package_master', kind: 'package_master', package_key: pkg.scope_key, label: 'Package master agreement' }];
    if ((pkg.policy.required_schedules || []).includes(programKey)) {
      docs.push({ slot_key: `package_addendum:${programKey}`, kind: 'package_addendum', package_key: pkg.scope_key, label: 'Program schedule under the master' });
    }
    return out('package', pkg, docs);
  }
  if (pkg && pkg.policy.strategy === 'none') return out('package', pkg, []);
  if (pkg && pkg.policy.strategy === 'per_program') {
    // The package defers to each program's own agreement; its own policy version (if frozen) names the gate.
    if (own) return out('program', own, own.policy.strategy === 'none' ? [] : [programLicence()]);
    return out('package', pkg, [programLicence()]);
  }
  if (own) return out('program', own, own.policy.strategy === 'none' ? [] : [programLicence()]);
  return out('not_recorded', null, []);
}

/** Is this document executed, for the right package where it matters? */
function executedFor(doc: RequiredDocument, rows: AgreementRow[]): AgreementRow | null {
  return rows.find((r) => r.slot_key === doc.slot_key && r.status === 'executed' && (doc.package_key === null || r.package_key === doc.package_key)) ?? null;
}
function inFlightFor(doc: RequiredDocument, rows: AgreementRow[]): AgreementRow | null {
  return rows.find((r) => r.slot_key === doc.slot_key && IN_FLIGHT.includes(r.status) && (doc.package_key === null || r.package_key === doc.package_key)) ?? null;
}

export const LEGAL_STATUSES = [
  'not_granted', 'draft', 'granted_agreement_required', 'awaiting_signature', 'granted_not_in_force', 'in_force', 'paused', 'ended',
] as const;
export type LegalStatus = typeof LEGAL_STATUSES[number];
export const LEGAL_STATUS_WORD: Record<LegalStatus, string> = {
  not_granted: 'Not granted',
  draft: 'Draft',
  granted_agreement_required: 'Granted — agreement required',
  awaiting_signature: 'Awaiting signature',
  granted_not_in_force: 'Granted — not in force yet',
  in_force: 'In force',
  paused: 'Paused',
  ended: 'Ended',
};

/**
 * Where one program stands legally on a licence. `grantInForce` is `presentGrant`'s answer (licence active,
 * dates, the schedule's signature): it must be true AND every gating document executed for `in_force`.
 * The schedule (the grant's signed-schedule rule) always gates; the policy's documents gate unless its gate is
 * `optional`.
 */
export function programLegalStatus(
  grant: Record<string, any> | null, rows: AgreementRow[], requirement: Requirement, o: { grantInForce: boolean },
) {
  const programKey = grant ? String(grant.program_key) : null;
  const scheduleRequired = !!grant && ['granted', 'paused'].includes(String(grant.state))
    && !(grant.requires_signed_schedule != null && Number(grant.requires_signed_schedule) === 0);
  const docs: RequiredDocument[] = [...requirement.documents];
  if (scheduleRequired && programKey) docs.push({ slot_key: `program_schedule:${programKey}`, kind: 'program_schedule', package_key: null, label: 'Program schedule' });
  const policyGates = requirement.legal_gate !== null && requirement.legal_gate !== 'optional';
  const documents = docs.map((d) => {
    const ex = executedFor(d, rows);
    const fl = inFlightFor(d, rows);
    const gating = d.kind === 'program_schedule' || policyGates;
    return {
      ...d, gating,
      executed_agreement_uid: ex?.uid ?? null,
      in_flight_agreement_uid: fl?.uid ?? null,
      awaiting_signature: !ex && !!fl && ['sent', 'partially_signed'].includes(fl.status),
      satisfied: !!ex,
    };
  });
  const missing = documents.filter((d) => d.gating && !d.satisfied);
  // The schedule rule is read from the grant itself (D1120/D4805: `schedule_signed_at` for the current revision),
  // because a backfilled or legacy schedule may have no executed canonical row.
  const scheduleSigned = !!grant?.schedule_signed_at;
  const missingNow = missing.filter((d) => !(d.kind === 'program_schedule' && scheduleSigned));
  const legallyReady = missingNow.length === 0;
  let status: LegalStatus;
  if (!grant) status = 'not_granted';
  else if (grant.state === 'draft') status = 'draft';
  else if (grant.state === 'ended') status = 'ended';
  else if (grant.state === 'paused') status = 'paused';
  else if (!legallyReady) status = missingNow.some((d) => d.awaiting_signature) ? 'awaiting_signature' : 'granted_agreement_required';
  else status = o.grantInForce ? 'in_force' : 'granted_not_in_force';
  return {
    program_key: programKey,
    status,
    word: LEGAL_STATUS_WORD[status],
    legally_in_force: status === 'in_force',
    legally_ready: legallyReady,
    requirement: { ...requirement, documents },
    missing: missingNow.map((d) => d.slot_key),
  };
}

export type LegalReadiness = ReturnType<typeof programLegalStatus>;

/**
 * Executed agreements that no longer match what the licence holds: drafted against an earlier grant terms
 * revision, or a master for a package the licence no longer holds. Read, never written: the executed rows stay.
 */
export function replacementsRequired(rows: AgreementRow[], grants: Array<Record<string, any>>, holdings: Holding[]) {
  const out: Array<{ agreement_uid: string; slot_key: string; why: 'grant_terms_changed' | 'package_changed'; detail: Record<string, unknown>; replacement_in_flight_uid: string | null }> = [];
  const grantOf = new Map(grants.map((g) => [String(g.program_key), g]));
  const pkg = holdings.find((h) => h.scope_kind === 'package' && !h.superseded_at) ?? null;
  for (const r of rows) {
    if (r.status !== 'executed') continue;
    const flight = rows.find((x) => x.slot_key === r.slot_key && IN_FLIGHT.includes(x.status))?.uid ?? null;
    const programKey = r.program_key ?? (r.agreement_kind === 'package_addendum' ? r.addendum_key : null);
    if (r.agreement_kind === 'program_licence' || r.agreement_kind === 'program_addendum' || (r.agreement_kind === 'package_addendum' && programKey && grantOf.has(programKey))) {
      const g = programKey ? grantOf.get(programKey) : null;
      if (g && ['granted', 'paused'].includes(String(g.state))) {
        let recorded: number | null = null;
        try { const v = JSON.parse(String((r as any).merge_values_json ?? 'null'))?.['grant.revision']; recorded = v == null ? null : Number(v); } catch { recorded = null; }
        const base = recorded ?? 1;
        const now = Number(g.terms_revision ?? 1);
        if (now > base) {
          out.push({ agreement_uid: r.uid, slot_key: r.slot_key, why: 'grant_terms_changed', detail: { signed_against_revision: recorded, current_revision: now }, replacement_in_flight_uid: flight });
          continue;
        }
      }
    }
    if ((r.agreement_kind === 'package_master' || r.agreement_kind === 'package_addendum') && pkg && r.package_key !== pkg.scope_key) {
      out.push({ agreement_uid: r.uid, slot_key: r.slot_key, why: 'package_changed', detail: { signed_for_package: r.package_key, held_package: pkg.scope_key }, replacement_in_flight_uid: flight });
    }
  }
  return out;
}

/**
 * Gate history: for each program whose readiness is given, one `gate_satisfied` / `gate_unsatisfied` line when
 * its answer differs from the last line recorded for that licence and program (none recorded counts as
 * different only once the program has something to gate). Idempotent: running it twice adds nothing.
 */
export function gateSyncStatements(env: Env, licenceUid: string, states: LegalReadiness[], o: { actorId: number | null; at: string; reason: string | null }): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const s of states) {
    if (!s.program_key) continue;
    // Only a program HQ holds open (granted or paused) has a gate in play; a draft, ended or ungranted one has none.
    if (s.status === 'ended' || s.status === 'not_granted' || s.status === 'draft') continue;
    const gating = s.requirement.documents.some((d) => d.gating);
    if (!gating) continue;
    const action = s.legally_ready ? 'gate_satisfied' : 'gate_unsatisfied';
    out.push(env.DB.prepare(
      `INSERT INTO licence_legal_events
         (licence_uid, action, scope_kind, scope_key, program_key, package_key, policy_uid, policy_version, actor_user_id, reason, detail_json, created_at)
       SELECT ?, ?, 'program', ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT action FROM licence_legal_events
                          WHERE licence_uid = ? AND program_key = ? AND action IN ('gate_satisfied', 'gate_unsatisfied')
                          ORDER BY id DESC LIMIT 1), '') <> ?`,
    ).bind(licenceUid, action, s.program_key, s.program_key, s.requirement.package_key, s.requirement.policy_uid, s.requirement.policy_version,
      o.actorId, o.reason, JSON.stringify({ status: s.status, missing: s.missing, executed: s.requirement.documents.filter((d) => d.satisfied).map((d) => d.executed_agreement_uid) }),
      o.at, licenceUid, s.program_key, action));
  }
  return out;
}

export async function legalEventsOf(env: Env, licenceUid: string) {
  const q = await env.DB.prepare(
    `SELECT id, action, scope_kind, scope_key, program_key, package_key, policy_uid, policy_version, agreement_uid, agreement_revision,
            terms_revision, actor_user_id, reason, detail_json, created_at
       FROM licence_legal_events WHERE licence_uid = ? ORDER BY id`,
  ).bind(licenceUid).all<Record<string, any>>();
  return (q.results || []).map((e) => {
    let detail: unknown = null;
    try { detail = e.detail_json ? JSON.parse(e.detail_json) : null; } catch { detail = { unreadable: true }; }
    return { ...e, detail_json: undefined, detail };
  });
}

/** True when the error says this database has not applied the D5052 migration. */
export function isMissingPolicyStore(e: unknown): boolean {
  return /no such table: licence_(agreement_polic|legal_events)/i.test(String((e as Error)?.message ?? e));
}

// ─────────────────────────────────────────────── one licence, read whole

/**
 * Every program of one licence, legally: its grant, the holdings, the agreements, each program's status and the
 * replacements its executed agreements need. Throws when a read fails; `holdings` is empty on a database
 * without the D5052 store (an older D1), which reads as "not recorded", never as satisfied.
 */
export async function readLicenceLegal(env: Env, licence: LicenceLite & { id: number }, today: string) {
  const [rows, grantsQ, holdings] = await Promise.all([
    agreementsOfLicence(env, licence.uid).catch((e) => {
      // A database without D5048's store holds no agreement; with no store there is no policy either.
      if (/no such table: licence_program_agreements/i.test(String((e as Error)?.message ?? e))) return [] as AgreementRow[];
      throw e;
    }),
    env.DB.prepare('SELECT * FROM program_grants WHERE licence_id = ? ORDER BY program_key').bind(licence.id).all<Record<string, any>>(),
    holdingsOf(env, licence.uid).catch((e) => { if (isMissingPolicyStore(e)) return [] as Holding[]; throw e; }),
  ]);
  const grants = grantsQ.results || [];
  const programs = grants.map((g) => programLegalStatus(g, rows, requirementFor(String(g.program_key), holdings),
    { grantInForce: presentGrant(g, licence, today).in_force }));
  return { rows, grants, holdings, programs, replacements: replacementsRequired(rows, grants, holdings) };
}

/**
 * Record the gate's answer for every program of a licence, after a write that may have changed it. Best
 * effort by design: the write it follows has committed, and a failure here (an older D1 without the store)
 * costs a history line, never the write. Returns how many lines were added.
 */
export async function syncLegalGate(env: Env, licenceUid: string, o: { actorId: number | null; reason: string | null }): Promise<number> {
  try {
    const licence = await env.DB.prepare('SELECT id, uid, licence_ref, brand_name, kind, status, renews_on FROM territory_licences WHERE uid = ?')
      .bind(licenceUid).first<LicenceLite & { id: number }>();
    if (!licence) return 0;
    const at = new Date().toISOString();
    const legal = await readLicenceLegal(env, licence, at.slice(0, 10));
    const st = gateSyncStatements(env, licence.uid, legal.programs, { actorId: o.actorId, at, reason: o.reason });
    if (!st.length) return 0;
    const res = await env.DB.batch(st);
    return res.reduce((n, r) => n + Number(r?.meta?.changes ?? 0), 0);
  } catch (e) {
    console.warn('[agreementPolicies] the legal gate history was not written', (e as Error)?.message);
    return 0;
  }
}

/**
 * D5052 — what the branch copy tells a branch about each grant: 1 when the frozen policy's gate holds the
 * program out of force for want of an executed agreement (the schedule's own rule travels as before, in its
 * columns). `presentGrant` reads it as one more thing the grant waits on. Throws on a failed read, so the copy
 * reports the section unreadable rather than letting a gated program read as in force.
 */
export async function legalWaitingByProgram(env: Env, licence: LicenceLite & { id: number }, today: string): Promise<Map<string, number>> {
  const legal = await readLicenceLegal(env, licence, today);
  const out = new Map<string, number>();
  for (const p of legal.programs) {
    if (!p.program_key) continue;
    const policyMissing = p.requirement.documents.some((d) => d.gating && d.kind !== 'program_schedule' && !d.satisfied);
    out.set(p.program_key, policyMissing ? 1 : 0);
  }
  return out;
}

/** `syncLegalGate` for a licence named by its id (the schedule completion hook knows only that). */
export async function syncLegalGateById(env: Env, licenceId: number, o: { actorId: number | null; reason: string | null }): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT uid FROM territory_licences WHERE id = ?').bind(licenceId).first<{ uid: string }>();
    return row ? await syncLegalGate(env, row.uid, o) : 0;
  } catch (e) {
    console.warn('[agreementPolicies] the legal gate history was not written', (e as Error)?.message);
    return 0;
  }
}
