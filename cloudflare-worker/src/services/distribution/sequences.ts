/**
 * D4493 (#4493): outreach sequences and which step is due for whom. Nothing
 * here sends: a due step becomes a draft the founder presses Send on through
 * D1340's `/api/mail/send` (one recipient, one pressed nonce).
 *
 * `dueSteps` reads, per active enrolment of a venture, the step it stands on
 * and why it is or is not due, in this order: the enrolment's own stop, the
 * venture's HMAC suppression list (#4492; an `opted_out` entry stops the
 * sequence), an inbound reply since enrolment (stops it), the sequence state,
 * the channel offered (email, and the founder's own recorded voice note sent
 * as an email attachment; LinkedIn, WhatsApp and Telegram are blocked with
 * fixed reasons, owner answer D), recorded marketing consent per channel, the
 * wait, and the venture's quiet hours in the recipient's own time zone. A
 * blocked step is skipped for that person and the next step is read.
 */
import type { Env, User } from '../../types';
import { indexHmac } from '../columnCipher';
import { prospectEmail, suppressionHash, suppressionKeyTag } from '../growProspects';
import { constantTimeEqual } from '../../rpc/secret';
import { canAccessProject } from '../projectAccess';

export const OFFERED_CHANNELS = ['email', 'voice'] as const;
export const STEP_CHANNELS = ['email', 'voice', 'linkedin', 'whatsapp', 'telegram'] as const;
export type StepChannel = typeof STEP_CHANNELS[number];
/** Fixed reasons, never a design sample. SMS is not a step at all. */
export const BLOCKED_REASONS: Readonly<Record<'linkedin' | 'whatsapp' | 'telegram', string>> = Object.freeze({
  linkedin: 'Needs LinkedIn’s approval.',
  whatsapp: 'Only to contacts who wrote first or opted in · after counsel’s review.',
  telegram: 'Only to contacts who wrote first or opted in · after counsel’s review.',
});
export const NO_SMS = 'There is no SMS step.';
export const AI_VOICE = 'Not offered';
export const MAX_STEPS = 10;
export const VOICE_MIME: Readonly<Record<string, string>> = Object.freeze({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' });
/** Under Microsoft Graph's 3 MB inline attachment limit once base64 is added. */
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const voicePrefix = (pid: number) => `grow-voice/${pid}/`;

export class SequenceRefused extends Error {
  status: number; sentence: string; field?: string; code: string;
  constructor(status: number, sentence: string, field?: string, code = 'sequence_refused') { super(sentence); this.status = status; this.sentence = sentence; this.field = field; this.code = code; }
}

export type StepState = 'due' | 'waiting' | 'held' | 'blocked' | 'suppressed' | 'stopped_replied' | 'stopped_optout' | 'done';
export type Skipped = { position: number; channel: string; reason: string };
export type DueRow = {
  enrolment_uid: string; sequence_uid: string; sequence_name: string; contact_uid: string; contact_name: string | null;
  position: number | null; channel: string | null; state: StepState; reason: string | null; due_at: string | null; skipped: Skipped[];
};
type Step = { sequence_id: number; position: number; channel: string; wait_days: number; subject: string | null; body: string | null; recording_asset: string | null };
type Enrolment = {
  id: number; uid: string; sequence_id: number; sequence_uid: string; sequence_name: string; sequence_state: string;
  contact_id: number; contact_uid: string; contact_name: string | null; email: string; current_step: number; state: string;
  next_due_at: string | null; recipient_tz: string | null; created_at: string;
};

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const addDays = (at: string | Date, days: number) => iso(new Date(new Date(at).valueOf() + days * 86400_000));
const utc = (v: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
/** A name is shown only when it is not an address. */
export const safeName = (v: unknown) => typeof v === 'string' && v.trim() && !/[^\s@]+@[^\s@]+/.test(v) ? v.trim().slice(0, 120) : null;

export function validTimeZone(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 64) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: v.trim() }); return v.trim(); } catch { return null; }
}
/** HH:MM on the recipient's clock. */
export function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00', m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}
/** True inside a quiet window; a window whose start is after its end wraps midnight. */
export function inQuietHours(clock: string, from: string, to: string) {
  return from < to ? clock >= from && clock < to : clock >= from || clock < to;
}

type Quiet = { quiet_from: string; quiet_to: string } | null;
const consentReason = (name: string | null, channel: 'email' | 'voice') =>
  `Not sent: ${name ?? 'This prospect'} has no consent recorded for ${channel === 'email' ? 'email' : 'a voice note'}. The step was skipped.`;

/**
 * The step a person stands on, as a pure function of what was read, so the
 * order of the checks is one place. `consents` holds the channels with a
 * positive recorded basis (opted_in or wrote_first).
 */
export function evaluate(e: Enrolment, steps: Step[], ctx: { now: Date; quiet: Quiet; suppression: string | null; repliedAt: string | null; consents: Set<string> }): DueRow {
  const row = (state: StepState, reason: string | null, step: Step | null = null, due_at: string | null = null, skipped: Skipped[] = []): DueRow => ({
    enrolment_uid: e.uid, sequence_uid: e.sequence_uid, sequence_name: e.sequence_name, contact_uid: e.contact_uid, contact_name: safeName(e.contact_name),
    position: step?.position ?? null, channel: step?.channel ?? null, state, reason, due_at, skipped,
  });
  if (e.state === 'stopped_replied') return row('stopped_replied', 'They replied. The sequence stopped.');
  if (e.state === 'stopped_optout') return row('stopped_optout', 'They opted out. The sequence stopped.');
  if (e.state === 'done') return row('done', 'Every step was sent.');
  if (ctx.suppression === 'opted_out') return row('stopped_optout', 'They opted out. The sequence stopped.');
  if (ctx.suppression) return row('suppressed', 'On your suppression list. Never due.');
  if (ctx.repliedAt) return row('stopped_replied', 'They replied. The sequence stopped.');
  const ordered = steps.filter((s) => s.position >= e.current_step).sort((a, b) => a.position - b.position);
  if (!ordered.length) return row('done', 'Every step was sent.');
  const name = safeName(e.contact_name);
  const skipped: Skipped[] = [];
  let dueAt = e.next_due_at ?? iso(ctx.now);
  for (const [i, step] of ordered.entries()) {
    if (i > 0) dueAt = addDays(dueAt, step.wait_days);
    let blocked: string | null = null;
    if (Object.hasOwn(BLOCKED_REASONS, step.channel)) blocked = BLOCKED_REASONS[step.channel as keyof typeof BLOCKED_REASONS];
    else if (!(OFFERED_CHANNELS as readonly string[]).includes(step.channel)) blocked = 'This channel is not offered.';
    else if (!ctx.consents.has('email')) blocked = consentReason(name, 'email');
    else if (step.channel === 'voice' && !ctx.consents.has('voice')) blocked = consentReason(name, 'voice');
    if (blocked) { skipped.push({ position: step.position, channel: step.channel, reason: blocked }); continue; }
    if (e.sequence_state !== 'active') return row('held', 'The sequence is not active. Activate it to draft due steps.', step, dueAt, skipped);
    if (step.channel === 'voice' && !step.recording_asset) return row('held', 'Record your voice note before this step is due.', step, dueAt, skipped);
    if (!step.subject?.trim() || step.channel === 'email' && !step.body?.trim()) return row('held', step.channel === 'email' ? 'Write this email’s subject and text before it is due.' : 'Write this voice note’s subject line before it is due.', step, dueAt, skipped);
    if (utc(dueAt) > ctx.now.valueOf()) return row('waiting', `If no reply in ${step.wait_days} ${step.wait_days === 1 ? 'day' : 'days'}`, step, dueAt, skipped);
    if (!ctx.quiet) return row('held', 'Not due: quiet hours are not recorded. Save them in Prospects.', step, dueAt, skipped);
    const zone = validTimeZone(e.recipient_tz);
    if (!zone) return row('held', 'Not due: their time zone is not recorded.', step, dueAt, skipped);
    if (inQuietHours(localClock(ctx.now, zone), ctx.quiet.quiet_from, ctx.quiet.quiet_to)) return row('held', `Due after ${ctx.quiet.quiet_to} their time`, step, dueAt, skipped);
    return row('due', null, step, dueAt, skipped);
  }
  return row('blocked', skipped[0].reason, null, null, skipped);
}

const ENROLMENTS = `SELECT e.id, e.uid, e.sequence_id, s.uid AS sequence_uid, s.name AS sequence_name, s.state AS sequence_state,
  e.contact_id, c.uid AS contact_uid, c.name AS contact_name, c.email, e.current_step, e.state, e.next_due_at, e.recipient_tz, e.created_at
  FROM outreach_enrolments e JOIN outreach_sequences s ON s.id = e.sequence_id JOIN contacts c ON c.id = e.contact_id
  WHERE s.project_id = ? AND c.project_id = ? AND c.audience = 'customer'`;

/** Reads every input once per call; the venture filter is on both the sequence and the contact. */
async function inputs(env: Env, pid: number, enrolmentUid: string | null, sequenceUid: string | null) {
  const where = `${ENROLMENTS} AND (? IS NULL OR e.uid = ?) AND (? IS NULL OR s.uid = ?) ORDER BY e.next_due_at, e.id LIMIT 1000`;
  const [enrolments, steps, quiet] = await Promise.all([
    env.DB.prepare(where).bind(pid, pid, enrolmentUid, enrolmentUid, sequenceUid, sequenceUid).all<Enrolment>(),
    env.DB.prepare(`SELECT t.sequence_id, t.position, t.channel, t.wait_days, t.subject, t.body, t.recording_asset FROM outreach_steps t
      JOIN outreach_sequences s ON s.id = t.sequence_id WHERE s.project_id = ? ORDER BY t.sequence_id, t.position`).bind(pid).all<Step>(),
    env.DB.prepare('SELECT quiet_from, quiet_to FROM venture_outreach_settings WHERE project_id = ?').bind(pid).first<{ quiet_from: string; quiet_to: string }>(),
  ]);
  const list = enrolments.results ?? [];
  const ids = JSON.stringify([...new Set(list.map((e) => e.contact_id))]);
  const [consents, replies] = await Promise.all([
    env.DB.prepare(`SELECT contact_id, channel FROM contact_marketing_consents WHERE basis IN ('opted_in','wrote_first') AND contact_id IN (SELECT value FROM json_each(?))`).bind(ids).all<{ contact_id: number; channel: string }>(),
    env.DB.prepare(`SELECT contact_id, MAX(created_at) AS at FROM contact_replies WHERE direction = 'inbound' AND contact_id IN (SELECT value FROM json_each(?)) GROUP BY contact_id`).bind(ids).all<{ contact_id: number; at: string }>(),
  ]);
  const hashes = new Map<number, string | null>();
  await Promise.all(list.map(async (e) => {
    try { hashes.set(e.contact_id, await suppressionHash(env, pid, e.email)); } catch { hashes.set(e.contact_id, null); }
  }));
  const keyTag = await suppressionKeyTag(env, pid);
  const suppressed = await env.DB.prepare('SELECT address_hash, reason, key_tag FROM venture_suppressions WHERE project_id = ? AND address_hash IN (SELECT value FROM json_each(?))')
    .bind(pid, JSON.stringify([...hashes.values()].filter(Boolean))).all<{ address_hash: string; reason: string; key_tag: string }>();
  const otherKey = await env.DB.prepare('SELECT id FROM venture_suppressions WHERE project_id = ? AND key_tag <> ? LIMIT 1').bind(pid, keyTag).first();
  // A changed key would make old suppressions look absent: nothing is due until they are checked (D4492).
  if (otherKey) throw new SequenceRefused(503, 'Suppression records use a different key and must be checked before any step is due.', undefined, 'suppression_key');
  const byHash = new Map((suppressed.results ?? []).map((r) => [r.address_hash, r.reason]));
  const consentOf = new Map<number, Set<string>>();
  for (const c of consents.results ?? []) { const s = consentOf.get(c.contact_id) ?? new Set<string>(); s.add(c.channel); consentOf.set(c.contact_id, s); }
  const replyOf = new Map((replies.results ?? []).map((r) => [r.contact_id, r.at]));
  const stepsOf = new Map<number, Step[]>();
  for (const s of steps.results ?? []) { const l = stepsOf.get(s.sequence_id) ?? []; l.push(s); stepsOf.set(s.sequence_id, l); }
  return { list, quiet: quiet ?? null, byHash, hashes, consentOf, replyOf, stepsOf };
}

export async function dueSteps(env: Env, pid: number, opts: { now?: Date; enrolmentUid?: string; sequenceUid?: string } = {}) {
  const now = opts.now ?? new Date();
  const read = await inputs(env, pid, opts.enrolmentUid ?? null, opts.sequenceUid ?? null);
  const rows = read.list.map((e) => {
    const hash = read.hashes.get(e.contact_id);
    // An address that cannot be normalised cannot be checked against the list: never due.
    if (hash === null) {
      const r = evaluate(e, [], { now, quiet: read.quiet, suppression: 'unreadable', repliedAt: null, consents: new Set() });
      return r.state === 'suppressed' ? { ...r, reason: 'Not due: their email address cannot be checked against your suppression list.' } : r;
    }
    const replied = read.replyOf.get(e.contact_id);
    const repliedAt = replied && utc(replied) >= utc(e.created_at) ? replied : null;
    return evaluate(e, read.stepsOf.get(e.sequence_id) ?? [], { now, quiet: read.quiet, suppression: read.byHash.get(hash!) ?? null, repliedAt, consents: read.consentOf.get(e.contact_id) ?? new Set() });
  });
  return { rows, due: rows.filter((r) => r.state === 'due').length, quiet_hours: read.quiet, enrolments: read.list };
}

/** Persists a computed stop, so a stopped enrolment stays stopped even if the reply or suppression is later removed. */
export function stopStatement(env: Env, enrolmentUid: string, state: 'stopped_replied' | 'stopped_optout') {
  return env.DB.prepare("UPDATE outreach_enrolments SET state = ?, next_due_at = NULL, updated_at = datetime('now') WHERE uid = ? AND state = 'active'").bind(state, enrolmentUid);
}

// ── The one-click opt-out ─────────────────────────────────────────────────
// Signed per contact with columnCipher's index key (the existing KEK_PII
// secret, domain-separated), so it names no address and cannot be forged.
const OPTOUT_DOMAIN = ['outreach_optout', 'token'] as const;
export async function optoutToken(env: Env, contactUid: string) {
  return `${contactUid}.${await indexHmac(env, OPTOUT_DOMAIN[0], OPTOUT_DOMAIN[1], contactUid)}`;
}
export async function readOptoutToken(env: Env, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 120) return null;
  const m = /^([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return null;
  const expected = await indexHmac(env, OPTOUT_DOMAIN[0], OPTOUT_DOMAIN[1], m[1]);
  return constantTimeEqual(m[2], expected) ? m[1] : null;
}
export function optoutBase(env: Env) {
  return String((env as any).PUBLIC_BASE_URL || (env as any).APP_URL || 'https://axal.vc').replace(/\/+$/, '');
}
export async function optoutLine(env: Env, contactUid: string) {
  return `To stop these emails, open: ${optoutBase(env)}/api/grow/optout/${await optoutToken(env, contactUid)}`;
}

/** Records the opt-out. Answers false for a token naming no customer contact; never says which venture or address. */
export async function recordOptout(env: Env, contactUid: string): Promise<boolean> {
  const c = await env.DB.prepare("SELECT id, project_id, email FROM contacts WHERE uid = ? AND audience = 'customer'").bind(contactUid).first<{ id: number; project_id: number; email: string }>();
  if (!c) return false;
  let hash: string;
  try { hash = await suppressionHash(env, c.project_id, prospectEmail(c.email)); } catch { return false; }
  const keyTag = await suppressionKeyTag(env, c.project_id);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO venture_suppressions(project_id, address_hash, key_tag, reason) VALUES (?, ?, ?, 'opted_out') ON CONFLICT(project_id, address_hash) DO UPDATE SET reason = 'opted_out'").bind(c.project_id, hash, keyTag),
    env.DB.prepare("UPDATE outreach_enrolments SET state = 'stopped_optout', next_due_at = NULL, updated_at = datetime('now') WHERE contact_id = ? AND state = 'active'").bind(c.id),
    env.DB.prepare("INSERT INTO activity_logs(user_id, project_id, action, details, actor) VALUES (NULL, ?, 'grow.sequence.optout', '{}', 'recipient')").bind(c.project_id),
  ]);
  return true;
}

// ── The send boundary (D1340) ──────────────────────────────────────────────
export const SEQUENCE_INTENT = 'sequence_step';
const PERSON = /^sequence:([0-9a-f]{32}):(\d{1,2})$/;
export const sequencePerson = (enrolmentUid: string, position: number) => `sequence:${enrolmentUid}:${position}`;
type DraftRow = { uid: string; person_ref: string; intent: string; attachment_key: string | null; required_line: string | null };

/**
 * Called by `/api/mail/send` before the nonce is spent, for the member's own
 * draft only. Null for any draft that is not a sequence step. A sequence draft
 * must still be due for that person, go to their recorded address only, and
 * keep its opt-out line.
 */
export async function sequenceSendGate(env: Env, user: User, draftUid: string | null, to: string, body: string) {
  if (!draftUid || !/^[a-f0-9]{32}$/.test(draftUid)) return null;
  const d = await env.DB.prepare('SELECT uid, person_ref, intent, attachment_key, required_line FROM mail_drafts WHERE uid = ? AND user_id = ?').bind(draftUid, user.id).first<DraftRow>();
  if (!d || d.intent !== SEQUENCE_INTENT) return null;
  const m = PERSON.exec(d.person_ref);
  if (!m) throw new SequenceRefused(409, 'This sequence draft no longer names a step.', undefined, 'sequence_stale');
  const e = await env.DB.prepare(`SELECT e.uid, s.project_id, c.email FROM outreach_enrolments e JOIN outreach_sequences s ON s.id = e.sequence_id
    JOIN contacts c ON c.id = e.contact_id WHERE e.uid = ? AND c.project_id = s.project_id`).bind(m[1]).first<{ uid: string; project_id: number; email: string }>();
  if (!e) throw new SequenceRefused(409, 'This sequence step is no longer open.', undefined, 'sequence_stale');
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(e.project_id).first<{ id: number; founder_id: number | null }>();
  if (!p || !(await canAccessProject(env, user, p, { write: true }))) throw new SequenceRefused(404, 'Draft not found.', undefined, 'draft_not_found');
  const now = await dueSteps(env, e.project_id, { enrolmentUid: e.uid });
  const row = now.rows[0];
  if (!row || row.state !== 'due' || row.position !== Number(m[2])) throw new SequenceRefused(409, row?.reason ? `Not sent: ${row.reason}` : 'This step is not due now.', undefined, 'sequence_not_due');
  if (to !== String(e.email).trim().toLowerCase()) throw new SequenceRefused(400, 'A sequence step goes only to that prospect’s recorded address.', 'to', 'sequence_recipient');
  if (!d.required_line || !body.includes(d.required_line)) throw new SequenceRefused(400, 'Keep the opt-out link in this message.', 'body', 'optout_required');
  return { enrolmentUid: e.uid, position: Number(m[2]), attachmentKey: d.attachment_key, projectId: e.project_id };
}

/** After the email has gone: the enrolment moves to its next step. A failure here leaves the send accepted. */
export async function sequenceAdvance(env: Env, gate: { enrolmentUid: string; position: number }, sentAt = new Date()) {
  const next = await env.DB.prepare(`SELECT t.position, t.wait_days FROM outreach_steps t JOIN outreach_enrolments e ON e.sequence_id = t.sequence_id
    WHERE e.uid = ? AND t.position > ? ORDER BY t.position LIMIT 1`).bind(gate.enrolmentUid, gate.position).first<{ position: number; wait_days: number }>();
  if (!next) {
    await env.DB.prepare("UPDATE outreach_enrolments SET state = 'done', current_step = ?, next_due_at = NULL, updated_at = datetime('now') WHERE uid = ? AND state = 'active' AND current_step <= ?")
      .bind(gate.position + 1, gate.enrolmentUid, gate.position).run();
    return;
  }
  await env.DB.prepare("UPDATE outreach_enrolments SET current_step = ?, next_due_at = ?, updated_at = datetime('now') WHERE uid = ? AND state = 'active' AND current_step <= ?")
    .bind(next.position, addDays(sentAt, next.wait_days), gate.enrolmentUid, gate.position).run();
}
