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
 */
import type { Env } from '../types';
import { programOf, termsOf, type LicenceLite } from './programGrants';

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
export function scheduleDocument(licence: LicenceLite & { legal_entity_name?: string | null }, row: Record<string, unknown>, sentOn: string) {
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
 * Records a schedule's signature. Sets `schedule_signed_at` on the grant whose
 * `schedule_contract_uid` is this envelope, only when it is not set yet, and
 * leaves one `program_changed` event when it did. Returns whether a grant
 * changed and which licence it belongs to; null when no grant names this
 * envelope.
 */
export async function onProgramScheduleEnvelopeCompleted(
  env: Env,
  envelopeUuid: string,
  signedAt: string = new Date().toISOString(),
): Promise<{ changed: boolean; licence_id: number; program_key: string } | null> {
  const grant = await env.DB.prepare(
    'SELECT id, licence_id, program_key, schedule_signed_at FROM program_grants WHERE schedule_contract_uid = ?',
  ).bind(envelopeUuid).first<{ id: number; licence_id: number; program_key: string; schedule_signed_at: string | null }>();
  if (!grant) return null;
  const res = await env.DB.prepare(
    'UPDATE program_grants SET schedule_signed_at = ? WHERE id = ? AND schedule_contract_uid = ? AND schedule_signed_at IS NULL',
  ).bind(signedAt, grant.id, envelopeUuid).run();
  const changed = (res.meta?.changes ?? 0) > 0;
  if (changed) {
    await env.DB.prepare(
      `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
       VALUES (?, 'program_changed', ?, ?, NULL, ?)`,
    ).bind(
      grant.licence_id,
      JSON.stringify({ action: 'schedule_signed', program_key: grant.program_key, envelope_uuid: envelopeUuid }),
      'The studio signed the program schedule.',
      signedAt,
    ).run();
  }
  return { changed, licence_id: grant.licence_id, program_key: grant.program_key };
}
