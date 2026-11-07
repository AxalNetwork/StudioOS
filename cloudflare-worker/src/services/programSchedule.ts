/**
 * D1120 (#3000, part of #2376) — a program grant's schedule: the document a
 * studio signs before a grant with the signed-schedule rule comes into force
 * (D982 §4 and §6).
 *
 * WHAT IS SENT. The schedule is built from the grant's own terms when HQ sends
 * it, and sent as that rendered text (`createAndSendEnvelope`'s
 * `renderedBody`), so the bytes the studio signs are the terms the grant held
 * at the send. A term nobody set prints "Not recorded" (D797), never a zero.
 *
 * WHAT IS STORED. `program_grants.schedule_contract_uid` holds the envelope's
 * `envelope_uuid`: the envelope is the schedule's contract, and no
 * `licence_contracts` row is written, because that table is the licence's
 * master agreement and an instantiation there supersedes the others.
 *
 * WHAT SIGNS IT. `onProgramScheduleEnvelopeCompleted` runs when an envelope
 * completes, on the in-house signing route and on the DocuSign poller. It sets
 * `schedule_signed_at` once, on the grant that names this envelope, and only
 * while the grant has not been signed: a second completion changes nothing.
 *
 * A SIGNATURE PROVES ONE REVISION (D4805, #4805). The schedule prints the
 * grant's `terms_revision` and a fingerprint of its terms, and the send stores
 * both on a `program_grant_schedules` row beside the envelope. A completion
 * marks the grant signed only if that row's revision is still the grant's and
 * its fingerprint still matches the grant's terms. An envelope for earlier
 * terms is recorded as signed (it was) on its own row, leaves the grant
 * waiting on an amendment, and writes a history line saying so; it can never
 * make newer terms look signed.
 */
import type { Env } from '../types';
import { programOf, termsHashOf, termsOf, type LicenceLite } from './programGrants';
import { clearGuard, decisionGuard, runDecision } from './decisionBatch';
import { queuePushStatement } from './licencePush';

/** The document type every schedule envelope carries. */
export const PROGRAM_SCHEDULE_DOC_TYPE = 'program_schedule';

const NOT_RECORDED = 'Not recorded';
const LABELS: Record<string, string> = {
  starts_on: 'Starts on',
  ends_on: 'Ends on',
  ends_with_licence: 'Ends with the licence',
  capacity_cap: 'Capacity',
  capacity_uncapped: 'No capacity cap',
  cohorts_per_year: 'Cohorts a year',
  credits_per_quarter: 'Credits a quarter',
  fee_cents: 'Fee',
  currency: 'Currency',
  hq_share_bps: "HQ's share",
  hq_approves_each_cohort: 'HQ approves each cohort',
  hq_approval_above_cents: 'HQ approves each payout above',
  playbook: 'Playbook',
  brand: 'Brand',
  reporting: 'Reporting',
  requires_signed_schedule: 'In force only once this schedule is signed',
};
const WORDS: Record<string, string> = {
  as_written: 'Run as written', may_adapt: 'The studio may adapt it',
  axal: 'Axal', studio: "The studio's own",
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
};

function money(cents: number, currency: unknown): string {
  const whole = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return typeof currency === 'string' && currency ? `${whole} ${currency}` : `${whole} (currency not recorded)`;
}

/** One term as the schedule prints it. */
export function termLine(key: string, value: unknown, terms: Record<string, unknown>): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  switch (key) {
    case 'ends_with_licence':
    case 'capacity_uncapped':
    case 'hq_approves_each_cohort':
    case 'requires_signed_schedule':
      return Number(value) === 1 ? 'Yes' : 'No';
    case 'fee_cents':
    case 'hq_approval_above_cents':
      return money(Number(value), terms.currency);
    case 'hq_share_bps':
      return `${(Number(value) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
    case 'playbook':
    case 'brand':
    case 'reporting':
      return WORDS[String(value)] || String(value);
    default:
      return String(value);
  }
}

/**
 * The schedule's title and text, from the grant's terms as stored now. Plain
 * text with no `{{` anywhere, so the send's unfilled-field check never finds
 * a slot in it.
 */
export function scheduleDocument(
  licence: LicenceLite & { legal_entity_name?: string | null },
  row: Record<string, unknown>,
  sentOn: string,
  revision: { number: number; hash: string },
) {
  const key = String(row.program_key);
  const program = programOf(key);
  const name = program?.name || key;
  const studio = licence.brand_name || licence.legal_entity_name || licence.licence_ref || licence.uid;
  const terms = termsOf(row, key);
  const lines = Object.entries(terms).map(([k, v]) => `- ${LABELS[k] || k}: ${termLine(k, v, terms)}`);
  const note = typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null;
  const title = `Program schedule: ${name}`;
  const body = [
    `# ${title}`,
    '',
    `Licence ${licence.licence_ref || licence.uid}, held by ${studio}.`,
    `Prepared by Axal HQ on ${sentOn}, from the terms of this grant as they stood that day.`,
    `Revision ${revision.number} · terms fingerprint ${revision.hash.slice(0, 16)}. A signature on this schedule covers these terms only.`,
    '',
    '## Terms',
    '',
    ...lines,
    '',
    ...(note ? ['## HQ’s note to the studio', '', note, ''] : []),
    '## Signature',
    '',
    `By signing, the licensee agrees to run ${name} under the licence on the terms above.`,
  ].join('\n').replace(/\{\{/g, '{ {');
  return { title, body };
}

/**
 * D4805 (#4805): the schedules a grant's change replaces are voided in e-sign, until the first signature lands
 * (the canvas's rule, as `POST /esign/:id/void` states it). The studio can then no longer sign terms that are
 * not the grant's, and a replacement can be sent. An envelope already being signed is left alone; if it
 * completes later its schedule row names an earlier revision, so `onProgramScheduleEnvelopeCompleted` records
 * it and marks nothing. Statements for the change's batch, to run BEFORE the schedule rows are superseded.
 */
export function voidSupersededSchedules(env: Env, grantId: number): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `UPDATE esign_envelopes SET status = 'void', last_error = 'voided: the terms of the grant changed'
        WHERE status IN ('sent', 'partially_signed')
          AND envelope_uuid IN (SELECT envelope_uuid FROM program_grant_schedules WHERE grant_id = ? AND signed_at IS NULL AND superseded_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM esign_recipients r WHERE r.envelope_id = esign_envelopes.id AND r.status IN ('signing', 'signed'))`,
    ).bind(grantId),
    env.DB.prepare(
      `UPDATE esign_recipients SET status = 'void'
        WHERE status = 'pending'
          AND envelope_id IN (SELECT e.id FROM esign_envelopes e WHERE e.status = 'void'
                                AND e.envelope_uuid IN (SELECT envelope_uuid FROM program_grant_schedules WHERE grant_id = ? AND signed_at IS NULL AND superseded_at IS NULL))`,
    ).bind(grantId),
  ];
}

/**
 * Records a schedule's signature. The envelope's own `program_grant_schedules` row says which revision it
 * was built for. Returns whether the GRANT changed (it did only if that revision is still the grant's
 * current one and the terms still match their fingerprint), which licence it belongs to, and `stale` when
 * the envelope was for earlier terms. Null when no schedule names this envelope.
 */
export async function onProgramScheduleEnvelopeCompleted(
  env: Env,
  envelopeUuid: string,
  signedAt: string = new Date().toISOString(),
): Promise<{ changed: boolean; stale: boolean; licence_id: number; program_key: string } | null> {
  const rec = await env.DB.prepare(
    `SELECT s.id AS sid, s.grant_id, s.revision, s.terms_hash, s.signed_at AS rec_signed, g.licence_id, g.program_key
       FROM program_grant_schedules s JOIN program_grants g ON g.id = s.grant_id WHERE s.envelope_uuid = ?`,
  ).bind(envelopeUuid).first<{ sid: number; grant_id: number; revision: number; terms_hash: string; rec_signed: string | null; licence_id: number; program_key: string }>();
  if (!rec) return null;
  const out = { licence_id: rec.licence_id, program_key: rec.program_key };
  if (rec.rec_signed) return { ...out, changed: false, stale: false };
  const grant = await env.DB.prepare('SELECT * FROM program_grants WHERE id = ?').bind(rec.grant_id).first<Record<string, unknown>>();
  if (!grant) return { ...out, changed: false, stale: false };
  const current = Number(grant.terms_revision) === Number(rec.revision)
    && (rec.terms_hash === 'legacy' || rec.terms_hash === await termsHashOf(grant));
  const event = (action: string, note: string, detail: Record<string, unknown>) => env.DB.prepare(
    `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
     SELECT ?, 'program_changed', ?, ?, NULL, ? WHERE (? = 0 OR changes() = 1)`,
  ).bind(rec.licence_id, JSON.stringify({ action, program_key: rec.program_key, envelope_uuid: envelopeUuid, ...detail }), note, signedAt, action === 'schedule_signed' ? 1 : 0);

  if (!current) {
    // The studio signed terms that are no longer the grant's. Record that, and leave the grant waiting.
    const run = await runDecision(env, [
      env.DB.prepare('UPDATE program_grant_schedules SET signed_at = ? WHERE id = ? AND signed_at IS NULL').bind(signedAt, rec.sid),
      decisionGuard(env),
      env.DB.prepare('UPDATE program_grants SET signed_revision = MAX(COALESCE(signed_revision, 0), ?) WHERE id = ?').bind(rec.revision, rec.grant_id),
      event('schedule_signed_stale', 'The studio signed an earlier revision of the program schedule. The grant’s current terms are not signed.',
        { signed_revision: Number(rec.revision), current_revision: Number(grant.terms_revision) }),
      clearGuard(env),
    ]);
    return { ...out, changed: false, stale: !run.lost };
  }

  const run = await runDecision(env, [
    env.DB.prepare('UPDATE program_grant_schedules SET signed_at = ? WHERE id = ? AND signed_at IS NULL').bind(signedAt, rec.sid),
    decisionGuard(env),
    // The grant is marked only while its terms are still the revision this envelope showed.
    env.DB.prepare(
      `UPDATE program_grants SET schedule_signed_at = ?, signed_revision = ?
        WHERE id = ? AND terms_revision = ? AND schedule_contract_uid = ? AND schedule_signed_at IS NULL`,
    ).bind(signedAt, rec.revision, rec.grant_id, rec.revision, envelopeUuid),
    event('schedule_signed', 'The studio signed the program schedule.', { revision: Number(rec.revision) }),
    queuePushStatement(env, rec.licence_id, true),
    clearGuard(env),
  ]);
  if (run.lost) return { ...out, changed: false, stale: false };
  const changed = Number(run.results[2]?.meta?.changes) === 1;
  return { ...out, changed, stale: !changed };
}
