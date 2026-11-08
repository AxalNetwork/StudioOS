/**
 * D5048 (#5048, part 1 of #5047) — the canonical package and program legal agreements: one row per agreement
 * version in `licence_program_agreements` (migration 202611082025), never in `licence_contracts`, which stays
 * the territory licence's master agreement.
 *
 * WHAT A ROW IS. One version of one agreement SLOT on a licence: the slot is the kind and its scope
 * (`slotKeyOf`), e.g. `program_schedule:spinout-lab` or `package_master`. A slot holds at most one version in
 * flight (draft, ready, sent, partially signed) and at most one executed version that nothing superseded; the
 * executed one is superseded only when its replacement is executed, so an amendment can be sent while the
 * signed version stays in force.
 *
 * `licence_uid` IS `territory_licences.uid` until #5057's shared licence identity exists; #5057 repoints it.
 *
 * EVERY WRITE IS A BATCH OF STATEMENTS built here: the history line (`licence_agreement_events`) is inserted
 * from the row as it stands, THEN the row is updated, so the two commit together and the event names the
 * status it left. Every update moves `revision` by exactly one (the table's trigger refuses anything else),
 * and a write a person makes names the revision it read (`transitionStatements`).
 *
 * THE FIVE STATES OF A PROGRAM ARE KEPT APART (`programLegalState`): the grant exists, an agreement is
 * required, one was sent, one was executed, and the program is legally in force. `program_grants.state` holds
 * only the first.
 *
 * `program_grants.schedule_contract_uid` stays the read-through for the schedule's envelope until its callers
 * move here; the schedule send, a terms change and the completion hook write this table in the same batch as
 * they write the grant (`routes/admin_program_grants.ts`, `services/programSchedule.ts`).
 */
import type { Env } from '../types';

export const AGREEMENT_KINDS = ['program_licence', 'program_schedule', 'program_addendum', 'package_master', 'package_addendum'] as const;
export type AgreementKind = typeof AGREEMENT_KINDS[number];
export const AGREEMENT_STATUSES = ['draft', 'ready', 'sent', 'partially_signed', 'executed', 'voided', 'superseded'] as const;
export type AgreementStatus = typeof AGREEMENT_STATUSES[number];
/** A version on its way to signature: at most one per slot (`idx_licence_program_agreements_one_in_flight`). */
export const IN_FLIGHT: readonly AgreementStatus[] = ['draft', 'ready', 'sent', 'partially_signed'];
/** States a version never leaves. */
export const TERMINAL: readonly AgreementStatus[] = ['voided', 'superseded'];
/** The kinds whose scope is a program, and those whose scope is a package. */
export const PROGRAM_KINDS: readonly AgreementKind[] = ['program_licence', 'program_schedule', 'program_addendum'];
export const PACKAGE_KINDS: readonly AgreementKind[] = ['package_master', 'package_addendum'];

/** Where a status may go next, by a person's write. Executed and the terminal states move only by signature or supersession. */
export const TRANSITIONS: Record<AgreementStatus, readonly AgreementStatus[]> = {
  draft: ['ready', 'sent', 'voided', 'superseded'],
  ready: ['draft', 'sent', 'voided', 'superseded'],
  sent: ['partially_signed', 'executed', 'voided'],
  partially_signed: ['executed', 'voided'],
  executed: ['superseded'],
  voided: [],
  superseded: [],
};

const KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;

/** The history line's action for a status a person moves a version to. */
const ACTION_OF: Record<AgreementStatus, string> = {
  draft: 'drafted', ready: 'readied', sent: 'sent', partially_signed: 'partially_signed',
  executed: 'executed', voided: 'voided', superseded: 'superseded',
};

export type AgreementScope = {
  agreement_kind: AgreementKind;
  program_key?: string | null;
  package_key?: string | null;
  addendum_key?: string | null;
};

/** The slot a version fills, or null when the scope does not fit the kind. Mirrors the table's CHECK. */
export function slotKeyOf(s: AgreementScope): string | null {
  const program = s.program_key ?? null;
  const pkg = s.package_key ?? null;
  const addendum = s.addendum_key ?? null;
  const ok = (v: string | null) => v !== null && KEY.test(v);
  const isProgram = PROGRAM_KINDS.includes(s.agreement_kind);
  if (isProgram && (!ok(program) || /_/.test(program!))) return null;
  if (PACKAGE_KINDS.includes(s.agreement_kind) && !ok(pkg)) return null;
  const wantsAddendum = s.agreement_kind === 'program_addendum' || s.agreement_kind === 'package_addendum';
  if (wantsAddendum !== (addendum !== null)) return null;
  if (wantsAddendum && !ok(addendum)) return null;
  switch (s.agreement_kind) {
    case 'program_licence': return `program_licence:${program}`;
    case 'program_schedule': return `program_schedule:${program}`;
    case 'program_addendum': return `program_addendum:${program}:${addendum}`;
    case 'package_master': return 'package_master';
    case 'package_addendum': return `package_addendum:${addendum}`;
    default: return null;
  }
}

export type AgreementRow = {
  id: number; uid: string; licence_uid: string; agreement_kind: AgreementKind; slot_key: string;
  program_key: string | null; program_grant_id: number | null; package_offer_uid: string | null;
  package_key: string | null; package_version: number | null; addendum_key: string | null;
  template_slug: string; template_version: number | null; status: AgreementStatus;
  envelope_uuid: string | null; body_sha256: string | null; signed_document_sha256: string | null;
  effective_from: string | null; effective_to: string | null; origin: 'app' | 'backfill_d5048';
  created_at: string; created_by_user_id: number | null; sent_at: string | null; signed_at: string | null;
  voided_at: string | null; superseded_at: string | null; superseded_by_uid: string | null;
  updated_at: string | null; revision: number;
};

// ─────────────────────────────────────────────── statements (all bound; no SQL is assembled at run time)

/** The history line for each row an UPDATE is about to change, inserted from the row as it stands. */
const EVENT_FOR_ENVELOPE = `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
  SELECT uid, licence_uid, ?, status, ?, revision + 1, ?, ?, ? FROM licence_program_agreements WHERE envelope_uuid = ? AND status IN ('sent', 'partially_signed')`;

/**
 * Statements that record a signature on the version that names this envelope: in flight → executed, with its
 * signed document's hash, after any executed version of the same slot is superseded by it. A version already
 * superseded or voided keeps its status and records the time it was signed (it was), once. Runs nothing when
 * no version names the envelope, and a second completion changes nothing (`signed_at` is set once; the
 * trigger refuses a change).
 */
export function agreementSignedStatements(env: Env, envelopeUuid: string, signedAt: string): D1PreparedStatement[] {
  const detail = JSON.stringify({ envelope_uuid: envelopeUuid });
  return [
    // 1. The executed version this one replaces, if any: history, then superseded.
    env.DB.prepare(
      `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
       SELECT p.uid, p.licence_uid, 'superseded', p.status, 'superseded', p.revision + 1, NULL, ?, ?
         FROM licence_program_agreements p JOIN licence_program_agreements n
           ON n.licence_uid = p.licence_uid AND n.slot_key = p.slot_key
        WHERE n.envelope_uuid = ? AND n.status IN ('sent', 'partially_signed') AND p.status = 'executed'`,
    ).bind(JSON.stringify({ superseded_by_envelope: envelopeUuid }), signedAt, envelopeUuid),
    env.DB.prepare(
      `UPDATE licence_program_agreements
          SET status = 'superseded', superseded_at = ?, effective_to = COALESCE(effective_to, ?), updated_at = ?, revision = revision + 1,
              superseded_by_uid = (SELECT n.uid FROM licence_program_agreements n WHERE n.envelope_uuid = ?)
        WHERE status = 'executed'
          AND EXISTS (SELECT 1 FROM licence_program_agreements n
                       WHERE n.envelope_uuid = ? AND n.status IN ('sent', 'partially_signed')
                         AND n.licence_uid = licence_program_agreements.licence_uid AND n.slot_key = licence_program_agreements.slot_key)`,
    ).bind(signedAt, signedAt.slice(0, 10), signedAt, envelopeUuid, envelopeUuid),
    // 2. This version: history, then executed.
    env.DB.prepare(EVENT_FOR_ENVELOPE).bind('executed', 'executed', null, detail, signedAt, envelopeUuid),
    env.DB.prepare(
      `UPDATE licence_program_agreements
          SET status = 'executed', signed_at = ?, signed_document_sha256 = COALESCE(signed_document_sha256, (SELECT f.file_sha256 FROM legal_document_files f JOIN esign_envelopes e ON e.id = f.envelope_id
                WHERE e.envelope_uuid = ? AND f.kind IN ('signed_copy', 'docusign_signed') ORDER BY f.id DESC LIMIT 1)),
              effective_from = COALESCE(effective_from, ?), updated_at = ?, revision = revision + 1
        WHERE envelope_uuid = ? AND status IN ('sent', 'partially_signed')`,
    ).bind(signedAt, envelopeUuid, signedAt.slice(0, 10), signedAt, envelopeUuid),
    // 3. A version already replaced: the signature is recorded on it, its status stays.
    env.DB.prepare(
      `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
       SELECT uid, licence_uid, 'signed_after_supersede', status, status, revision + 1, NULL, ?, ?
         FROM licence_program_agreements WHERE envelope_uuid = ? AND status IN ('superseded', 'voided') AND signed_at IS NULL`,
    ).bind(detail, signedAt, envelopeUuid),
    env.DB.prepare(
      `UPDATE licence_program_agreements
          SET signed_at = ?, signed_document_sha256 = COALESCE(signed_document_sha256, (SELECT f.file_sha256 FROM legal_document_files f JOIN esign_envelopes e ON e.id = f.envelope_id
                WHERE e.envelope_uuid = ? AND f.kind IN ('signed_copy', 'docusign_signed') ORDER BY f.id DESC LIMIT 1)), updated_at = ?, revision = revision + 1
        WHERE envelope_uuid = ? AND status IN ('superseded', 'voided') AND signed_at IS NULL`,
    ).bind(signedAt, envelopeUuid, signedAt, envelopeUuid),
  ];
}

/**
 * The schedule versions of a grant stop being current: its terms changed or it was granted again (D4805), so
 * neither the version in flight nor the executed one covers the grant's terms any more. Their rows, and any
 * signature on them, stay. Run in the same batch as the grant's change.
 */
export function scheduleAgreementsSupersededStatements(env: Env, grantId: number, at: string, actorId: number | null): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
       SELECT uid, licence_uid, 'superseded', status, 'superseded', revision + 1, ?, ?, ?
         FROM licence_program_agreements
        WHERE program_grant_id = ? AND agreement_kind = 'program_schedule' AND status NOT IN ('voided', 'superseded')`,
    ).bind(actorId, JSON.stringify({ reason: 'grant_terms_changed' }), at, grantId),
    env.DB.prepare(
      `UPDATE licence_program_agreements
          SET status = 'superseded', superseded_at = ?, effective_to = CASE WHEN status = 'executed' THEN COALESCE(effective_to, ?) ELSE effective_to END,
              updated_at = ?, revision = revision + 1
        WHERE program_grant_id = ? AND agreement_kind = 'program_schedule' AND status NOT IN ('voided', 'superseded')`,
    ).bind(at, at.slice(0, 10), at, grantId),
  ];
}

/**
 * A schedule sent for a grant: any version still in flight for the slot is closed first (voided when its
 * envelope is dead, superseded otherwise; the send route refuses while one is live), then the new version is
 * written as `sent`, naming its envelope and the hash the envelope carries. Run in the send's batch.
 */
export function scheduleAgreementSentStatements(env: Env, o: {
  uid: string; licenceUid: string; grantId: number; programKey: string; envelopeUuid: string;
  bodySha256: string; actorId: number; at: string;
}): D1PreparedStatement[] {
  const slot = slotKeyOf({ agreement_kind: 'program_schedule', program_key: o.programKey });
  if (!slot) throw new Error('program_schedule: invalid program key');
  return [
    env.DB.prepare(
      `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
       SELECT uid, licence_uid, CASE WHEN (SELECT e.status FROM esign_envelopes e WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid) IN ('void', 'rejected') THEN 'voided' ELSE 'superseded' END, status,
              CASE WHEN (SELECT e.status FROM esign_envelopes e WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid) IN ('void', 'rejected') THEN 'voided' ELSE 'superseded' END, revision + 1, ?, ?, ?
         FROM licence_program_agreements WHERE licence_uid = ? AND slot_key = ? AND status IN ('draft', 'ready', 'sent', 'partially_signed')`,
    ).bind(o.actorId, JSON.stringify({ replaced_by_envelope: o.envelopeUuid }), o.at, o.licenceUid, slot),
    env.DB.prepare(
      `UPDATE licence_program_agreements
          SET voided_at = CASE WHEN (SELECT e.status FROM esign_envelopes e WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid) IN ('void', 'rejected') THEN ? ELSE voided_at END,
              superseded_at = CASE WHEN (SELECT e.status FROM esign_envelopes e WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid) IN ('void', 'rejected') THEN superseded_at ELSE ? END,
              superseded_by_uid = CASE WHEN (SELECT e.status FROM esign_envelopes e WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid) IN ('void', 'rejected') THEN superseded_by_uid ELSE ? END,
              status = CASE WHEN (SELECT e.status FROM esign_envelopes e WHERE e.envelope_uuid = licence_program_agreements.envelope_uuid) IN ('void', 'rejected') THEN 'voided' ELSE 'superseded' END,
              updated_at = ?, revision = revision + 1
        WHERE licence_uid = ? AND slot_key = ? AND status IN ('draft', 'ready', 'sent', 'partially_signed')`,
    ).bind(o.at, o.at, o.uid, o.at, o.licenceUid, slot),
    env.DB.prepare(
      `INSERT INTO licence_program_agreements
         (uid, licence_uid, agreement_kind, slot_key, program_key, program_grant_id, template_slug, template_version, status,
          envelope_uuid, body_sha256, origin, created_at, created_by_user_id, sent_at, updated_at, revision)
       VALUES (?, ?, 'program_schedule', ?, ?, ?, 'program_schedule', NULL, 'sent', ?, ?, 'app', ?, ?, ?, ?, 0)`,
    ).bind(o.uid, o.licenceUid, slot, o.programKey, o.grantId, o.envelopeUuid, o.bodySha256, o.at, o.actorId, o.at, o.at),
    env.DB.prepare(
      `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
       VALUES (?, ?, 'sent', NULL, 'sent', 0, ?, ?, ?)`,
    ).bind(o.uid, o.licenceUid, o.actorId, JSON.stringify({ envelope_uuid: o.envelopeUuid, program_key: o.programKey, program_grant_id: o.grantId }), o.at),
  ];
}

/**
 * A person's status change on one version, guarded on the revision and status they read. The update is the
 * batch's deciding statement: callers run `[update, decisionGuard(env), event, ...]` through `runDecision`, so
 * a stale write (another revision, another status) loses whole, and the event is inserted from the row the
 * update produced.
 */
export function transitionStatements(env: Env, o: {
  uid: string; fromRevision: number; from: AgreementStatus; to: AgreementStatus; actorId: number | null;
  at: string; detail?: Record<string, unknown>; action?: string;
}): { update: D1PreparedStatement; event: D1PreparedStatement } {
  if (!TRANSITIONS[o.from].includes(o.to)) throw new Error(`agreement: ${o.from} cannot become ${o.to}`);
  const update = env.DB.prepare(
    `UPDATE licence_program_agreements
        SET status = ?, updated_at = ?, revision = revision + 1,
            voided_at = CASE WHEN ? = 'voided' THEN ? ELSE voided_at END,
            superseded_at = CASE WHEN ? = 'superseded' THEN ? ELSE superseded_at END
      WHERE uid = ? AND revision = ? AND status = ?`,
  ).bind(o.to, o.at, o.to, o.at, o.to, o.at, o.uid, o.fromRevision, o.from);
  // Written after the update, from the row it produced: inserted only when that row now reads `to` at the next revision.
  const event = env.DB.prepare(
    `INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, from_status, to_status, revision, actor_user_id, detail_json, created_at)
     SELECT uid, licence_uid, ?, ?, status, revision, ?, ?, ? FROM licence_program_agreements WHERE uid = ? AND revision = ? AND status = ?`,
  ).bind(o.action ?? ACTION_OF[o.to], o.from, o.actorId, JSON.stringify(o.detail ?? {}), o.at, o.uid, o.fromRevision + 1, o.to);
  return { update, event };
}

// ─────────────────────────────────────────────── reads

export async function agreementsOfLicence(env: Env, licenceUid: string): Promise<AgreementRow[]> {
  const q = await env.DB.prepare('SELECT * FROM licence_program_agreements WHERE licence_uid = ? ORDER BY slot_key, id DESC')
    .bind(licenceUid).all<AgreementRow>();
  return q.results || [];
}

export async function agreementByUid(env: Env, uid: string): Promise<AgreementRow | null> {
  return await env.DB.prepare('SELECT * FROM licence_program_agreements WHERE uid = ?').bind(uid).first<AgreementRow>();
}

export async function agreementForEnvelope(env: Env, envelopeUuid: string): Promise<AgreementRow | null> {
  return await env.DB.prepare('SELECT * FROM licence_program_agreements WHERE envelope_uuid = ?').bind(envelopeUuid).first<AgreementRow>();
}

export async function agreementEvents(env: Env, uid: string) {
  const q = await env.DB.prepare(
    `SELECT id, action, from_status, to_status, revision, actor_user_id, detail_json, created_at
       FROM licence_agreement_events WHERE agreement_uid = ? ORDER BY id`,
  ).bind(uid).all<{ id: number; action: string; from_status: string | null; to_status: string; revision: number; actor_user_id: number | null; detail_json: string | null; created_at: string }>();
  return (q.results || []).map((e) => {
    let detail: unknown = null;
    try { detail = e.detail_json ? JSON.parse(e.detail_json) : null; } catch { detail = { unreadable: true }; }
    return { ...e, detail_json: undefined, detail };
  });
}

/** What a slot holds now: the executed version in force and the version in flight, each or neither. */
export function slotsOf(rows: AgreementRow[]) {
  const slots = new Map<string, { slot_key: string; agreement_kind: AgreementKind; program_key: string | null; package_key: string | null;
    executed: AgreementRow | null; in_flight: AgreementRow | null; versions: number }>();
  for (const r of rows) {
    const s = slots.get(r.slot_key) ?? { slot_key: r.slot_key, agreement_kind: r.agreement_kind, program_key: r.program_key, package_key: r.package_key, executed: null, in_flight: null, versions: 0 };
    s.versions += 1;
    if (r.status === 'executed') s.executed = r;
    if (IN_FLIGHT.includes(r.status)) s.in_flight = r;
    slots.set(r.slot_key, s);
  }
  return [...slots.values()];
}

/**
 * The five states of a program on a licence, kept apart (#5048). `grant` is the `program_grants` row (or
 * null), `rows` the licence's agreement versions. The schedule is the agreement a grant requires today; the
 * program licence and addenda become required when #5052's strategies say so.
 */
export function programLegalState(grant: Record<string, any> | null, rows: AgreementRow[], o: { licenceActive?: boolean; grantInForce?: boolean } = {}) {
  const key = grant ? String(grant.program_key) : null;
  const schedule = key ? rows.filter((r) => r.slot_key === `program_schedule:${key}`) : [];
  const executed = schedule.find((r) => r.status === 'executed') ?? null;
  const inFlight = schedule.find((r) => IN_FLIGHT.includes(r.status)) ?? null;
  const grantExists = !!grant && ['granted', 'paused'].includes(String(grant.state));
  const required = grantExists && !(grant!.requires_signed_schedule != null && Number(grant!.requires_signed_schedule) === 0);
  return {
    program_key: key,
    grant_exists: grantExists,
    grant_state: grant ? String(grant.state) : null,
    agreement_required: required,
    agreement_sent: !!(inFlight?.sent_at || executed),
    agreement_executed: !!executed,
    executed_agreement_uid: executed?.uid ?? null,
    in_flight_agreement_uid: inFlight?.uid ?? null,
    // `grantInForce` is `presentGrant`'s answer (licence active, dates, the schedule's signature on the grant);
    // without it, the grant's own state and the licence's. Either way an executed agreement is required.
    legally_in_force: grantExists && String(grant!.state) === 'granted'
      && (o.grantInForce ?? (o.licenceActive ?? true)) && (!required || !!executed),
  };
}

/**
 * D5049 (#5049): an envelope completed, on the in-house signing route or the DocuSign poller. The package or
 * program agreement version that names it is executed (superseding the executed version of its slot, in the
 * same batch), or, if it was voided or superseded meanwhile, records that it was signed and stays as it is.
 * A program schedule is left to `onProgramScheduleEnvelopeCompleted`, which writes it in the grant's batch.
 * Null when no version names the envelope. Idempotent: every statement is guarded on the state it changes.
 */
export async function onAgreementEnvelopeCompleted(env: Env, envelopeUuid: string, signedAt: string = new Date().toISOString()) {
  const before = await agreementForEnvelope(env, envelopeUuid);
  if (!before || before.agreement_kind === 'program_schedule') return null;
  await env.DB.batch(agreementSignedStatements(env, envelopeUuid, signedAt));
  const after = await agreementForEnvelope(env, envelopeUuid);
  return { uid: before.uid, licence_uid: before.licence_uid, status: after?.status ?? before.status, executed: before.status !== 'executed' && after?.status === 'executed' };
}
