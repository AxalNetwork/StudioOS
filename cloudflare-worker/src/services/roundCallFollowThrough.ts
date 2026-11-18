/**
 * D6863 (#6863, canvas D6053) — following through on a Call for Capital:
 * remind who has not acted, export the responses, start a new call from a
 * closed one, and record a response as a Signed or Wired commitment.
 *
 * The owner's answers (D6053 "Pending the owner", option A on each):
 *   Q1 only the venture's owner reminds and exports; a co-founder records a
 *      commitment and starts a new call as a draft (D1191, D1222).
 *   Q2 at most 2 reminders per recipient per call, at least 3 days apart.
 *   Q3 investor emails are never in an export.
 *   Q4 recording moves the pipeline line from Soft to Signed or Wired.
 *   Q5 counsel is not told of an export.
 *
 * AN AMOUNT INDICATED ON A CALL IS NEVER COMMITTED (D653). Only the amount the
 * founder types here moves a line to Signed or Wired. A matching investor stays
 * nameless until they respond, here, in a reminder's result and in an export.
 * A reminder is the same in-app notice as the send; no email is sent.
 *
 * Bound SQL only. Each write re-checks the call's state in its own statement.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Env, User } from '../types';
import { holdsLicence, heldLicences } from './accountLicences';
import { RoundCallError, projectFacts, ventureMember, saveDraft, type CallRow, type Relation } from './roundCalls';
import { roundCallsEnabled, positiveCents } from './roundCallPolicy';
import { notify } from './notify';
import { hashEmail } from '../util/hashEmail';
import { csvCell } from './capTableRegister';
import { winAnsiSafe } from './legalDocFormat';
import { liveFiles } from './dataRoomTrash';
import { formatMinor, toMajorString } from '../../../frontend/src/lib/money.js';

/** Q2, option A. */
export const REMIND_LIMIT = 2;
export const REMIND_SPACING_DAYS = 3;
export const INDICATED_HEADER = 'Indicated (USD), not committed';
export const OWNER_ONLY_SENTENCE = 'Only the venture’s owner can remind or export.';

const DAY_MS = 86400000;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const usd = (cents: number | null | undefined) => (typeof cents === 'number' ? formatMinor(cents, 'USD', { locale: 'en-US' }) : null);

type Row = {
  id: number; investor_user_id: number; origin: string; match_reasons_json: string; opened_at: string | null;
  data_room_requested_at: string | null; responded_at: string | null; commitment_cents: number | null; committed_at: string | null;
  delivery_state: string; last_reminded_at: string | null; reminder_count: number | null;
  name: string | null; email: string | null; role: string; is_active: number; kyc_status: string | null;
};
export type Group = 'not_opened' | 'opened_unanswered' | 'not_delivered' | 'responded';
export type Block = 'responded' | 'limit' | 'too_soon' | 'account_unavailable' | null;

/** The venture's owner or an accepted co-founder, read live; anyone else does not find the call. */
export async function callRelation(env: Env, actor: User, call: CallRow): Promise<Relation> {
  if (!roundCallsEnabled(env)) throw new RoundCallError('round_calls_disabled', 503);
  const project = await projectFacts(env, call.project_id);
  const current = await env.DB.prepare('SELECT id,role,founder_id,spinout_lab_active,is_active FROM users WHERE id=?').bind(actor.id).first<User>();
  if (!current) throw new RoundCallError('project_not_found', 404);
  current.licences = await heldLicences(env.DB, current);
  const founder = holdsLicence(current, 'founder') || (current.role === 'exploring' && Number(current.spinout_lab_active) === 1);
  if (Number(current.is_active) === 1 && founder && current.founder_id != null && current.founder_id === project.founder_id) return 'owner';
  if (await ventureMember(env, project.id, current)) return 'member';
  throw new RoundCallError('project_not_found', 404);
}
async function requireOwnerRelation(env: Env, actor: User, call: CallRow) {
  if (await callRelation(env, actor, call) !== 'owner') throw new RoundCallError('owner_only', 403, OWNER_ONLY_SENTENCE);
}

export const named = (r: Pick<Row, 'origin' | 'responded_at'>) => r.origin === 'chosen' || r.responded_at != null;
export function groupOf(r: Pick<Row, 'responded_at' | 'delivery_state' | 'opened_at'>): Group {
  if (r.responded_at) return 'responded';
  if (r.delivery_state === 'not_delivered') return 'not_delivered';
  return r.opened_at ? 'opened_unanswered' : 'not_opened';
}
/** The day from which another reminder may go, or null when none has been sent. */
export function nextReminderFrom(lastRemindedAt: string | null): string | null {
  if (!lastRemindedAt) return null;
  const at = Date.parse(lastRemindedAt.includes('T') ? lastRemindedAt : lastRemindedAt.replace(' ', 'T') + 'Z');
  return Number.isFinite(at) ? new Date(at + REMIND_SPACING_DAYS * DAY_MS).toISOString() : null;
}
/** Why this recipient cannot be reminded now, or null. The limit is checked before the spacing. */
export function blockOf(r: Row, at: string): Block {
  if (r.responded_at) return 'responded';
  if (Number(r.reminder_count || 0) >= REMIND_LIMIT) return 'limit';
  const next = nextReminderFrom(r.last_reminded_at);
  if (next && next > at) return 'too_soon';
  if (r.role !== 'investor' || Number(r.is_active) !== 1 || r.kyc_status !== 'approved') return 'account_unavailable';
  return null;
}
/** Whether the call can take reminders, and the sentence when it cannot. */
export function remindState(call: Pick<CallRow, 'state' | 'target_close'>, day = today()): { on: boolean; reason: string | null; sentence: string | null } {
  const off = (reason: string, sentence: string) => ({ on: false, reason, sentence });
  if (call.state === 'draft') return off('call_draft', 'A draft has told no one. Send the call first.');
  if (call.state === 'awaiting_counsel') return off('call_awaiting_counsel', 'The extension is with counsel. Reminders wait for approval.');
  if (call.state === 'closed') return off('call_closed', 'This call is closed. Nobody can be reminded.');
  if (call.target_close < day) return off('call_past_close', 'This call’s close date has passed. Extend the call to remind anyone.');
  return { on: true, reason: null, sentence: null };
}

async function rows(env: Env, callId: number): Promise<Row[]> {
  const r = await env.DB.prepare(`SELECT r.id,r.investor_user_id,r.origin,r.match_reasons_json,r.opened_at,r.data_room_requested_at,r.responded_at,
      r.commitment_cents,r.committed_at,r.delivery_state,r.last_reminded_at,r.reminder_count,u.name,u.email,u.role,u.is_active,u.kyc_status
    FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.call_id=? ORDER BY r.id`).bind(callId).all<Row>();
  return r.results || [];
}
const reasons = (json: string) => { try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 3) : []; } catch { return []; } };

type Line = { prospect_id: number; stage: string | null; status: string | null; amount_cents: number | null; currency: string; round_call_uid: string | null };
async function pipelineLines(env: Env, projectId: number): Promise<Map<string, Line>> {
  const r = await env.DB.prepare('SELECT id,LOWER(email) AS email,stage,commit_status,amount_cents,currency,round_call_uid FROM raise_prospects WHERE project_id=? AND email IS NOT NULL ORDER BY id')
    .bind(projectId).all<{ id: number; email: string; stage: string | null; commit_status: string | null; amount_cents: number | null; currency: string | null; round_call_uid: string | null }>();
  const out = new Map<string, Line>();
  for (const p of r.results || []) if (!out.has(p.email)) out.set(p.email, { prospect_id: p.id, stage: p.stage, status: p.commit_status, amount_cents: p.amount_cents, currency: p.currency || 'USD', round_call_uid: p.round_call_uid });
  return out;
}

/** Another call that blocks starting a new one: any draft, or a call still open or with counsel. */
async function blockingCall(env: Env, call: CallRow) {
  return env.DB.prepare("SELECT uid,name,state FROM round_calls WHERE project_id=? AND id<>? AND (state IN ('draft','awaiting_counsel') OR (state='sent' AND target_close>=?)) ORDER BY id DESC LIMIT 1")
    .bind(call.project_id, call.id, today()).first<{ uid: string; name: string; state: string }>();
}
function blockSentence(b: { name: string; state: string }) {
  return b.state === 'draft' ? `${b.name} is a draft. Continue it first.` : `One call at a time. ${b.name} is open.`;
}

/** The follow-through read: recipients by group with their reminders, pipeline lines, the export log, and what this viewer may do. */
export async function followThrough(env: Env, call: CallRow, actor: User) {
  const relation = await callRelation(env, actor, call);
  const owner = relation === 'owner';
  const at = now();
  const all = await rows(env, call.id);
  const lines = await pipelineLines(env, call.project_id);
  const recipients = all.map((r) => {
    const shown = named(r);
    const line = shown && r.responded_at && r.email ? lines.get(r.email.toLowerCase()) ?? null : null;
    return {
      recipient_id: r.id, named: shown, origin: r.origin, reasons: r.origin === 'match' ? reasons(r.match_reasons_json) : [],
      ...(shown ? { investor_user_id: r.investor_user_id, name: r.name } : {}),
      group: groupOf(r), delivery_state: r.delivery_state, opened_at: r.opened_at, data_room_requested_at: r.data_room_requested_at,
      responded_at: r.responded_at, commitment_cents: shown ? r.commitment_cents : null, committed_at: shown ? r.committed_at : null,
      last_reminded_at: r.last_reminded_at, reminder_count: Number(r.reminder_count || 0),
      block: blockOf(r, at), next_reminder_from: nextReminderFrom(r.last_reminded_at),
      line: line && { status: line.status, stage: line.stage, amount_cents: line.amount_cents, currency: line.currency, from_this_call: line.round_call_uid === call.uid },
      in_pipeline: shown && r.responded_at ? !!line : null,
    };
  });
  const count = (g: Group) => recipients.filter((r) => r.group === g).length;
  const exportsRead = await env.DB.prepare('SELECT e.uid,e.format,e.scope,e.questions_state,e.named_count,e.responded_count,e.withheld_matches,e.exported_at,e.exported_by,u.name AS exported_by_name FROM round_call_exports e LEFT JOIN users u ON u.id=e.exported_by WHERE e.call_id=? ORDER BY e.exported_at DESC,e.id DESC LIMIT 50')
    .bind(call.id).all<any>();
  const sourceId = (call as CallRow & { source_call_id?: number | null }).source_call_id ?? null;
  const source = sourceId == null ? null : await env.DB.prepare('SELECT uid,name,closed_at FROM round_calls WHERE id=? AND project_id=?').bind(sourceId, call.project_id).first();
  const block = call.state === 'closed' ? await blockingCall(env, call) : null;
  const remind = remindState(call);
  const venture = await projectFacts(env, call.project_id);
  return {
    venture: { name: venture.name },
    call: { uid: call.uid, name: call.name, state: call.state, target_close: call.target_close, sent_at: call.sent_at, closed_at: call.closed_at, project_id: call.project_id },
    relation,
    can: { remind: owner && remind.on, export: owner && call.state !== 'draft', record: call.state !== 'draft', start_new: call.state === 'closed' && !block },
    remind: { ...remind, limit: REMIND_LIMIT, spacing_days: REMIND_SPACING_DAYS },
    start_new: call.state !== 'closed' ? null : { on: !block, sentence: block ? blockSentence(block) : null },
    counts: { recipients: recipients.length, not_opened: count('not_opened'), opened_unanswered: count('opened_unanswered'), not_delivered: count('not_delivered'), responded: count('responded') },
    recipients,
    exports: (exportsRead.results || []).map((e: any) => ({ ...e, exported_by_you: e.exported_by === actor.id, exported_by: undefined })),
    source,
  };
}

/** Remind the chosen recipients with the in-app notice. Owner only; the limit is enforced per recipient in its own statement. */
export async function remind(env: Env, call: CallRow, actor: User, input: Record<string, unknown>) {
  await requireOwnerRelation(env, actor, call);
  const state = remindState(call);
  if (!state.on) throw new RoundCallError(state.reason!, 409, state.sentence!);
  const ids = input.recipient_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((id) => !Number.isSafeInteger(id) || (id as number) <= 0)) throw new RoundCallError('invalid_recipients');
  const wanted = new Set(ids as number[]);
  const all = (await rows(env, call.id)).filter((r) => wanted.has(r.id));
  if (all.length !== wanted.size) throw new RoundCallError('recipient_not_found', 404);
  const project = await projectFacts(env, call.project_id);
  const reminded: number[] = [];
  const notReminded: Array<{ recipient_id: number; name: string | null; reason: string; next_reminder_from?: string | null }> = [];
  for (const r of all) {
    const at = now();
    const why = blockOf(r, at);
    const who = named(r) ? r.name : null;
    if (why) { notReminded.push({ recipient_id: r.id, name: who, reason: why, next_reminder_from: why === 'too_soon' ? nextReminderFrom(r.last_reminded_at) : null }); continue; }
    // The claim: the limit, the spacing and the call's state are re-checked in the write itself.
    const claim = await env.DB.prepare("UPDATE round_call_recipients SET reminder_count=reminder_count+1,last_reminded_at=? "
      + "WHERE id=? AND call_id=? AND responded_at IS NULL AND reminder_count<? AND (last_reminded_at IS NULL OR datetime(last_reminded_at)<=datetime(?,?)) "
      + "AND EXISTS(SELECT 1 FROM round_calls c WHERE c.id=? AND c.state='sent' AND c.target_close>=?)")
      .bind(at, r.id, call.id, REMIND_LIMIT, at, `-${REMIND_SPACING_DAYS} days`, call.id, at.slice(0, 10)).run();
    if (Number(claim.meta?.changes) !== 1) { notReminded.push({ recipient_id: r.id, name: who, reason: 'call_changed' }); continue; }
    let sent: number | null = null;
    try {
      sent = await notify(env, { userId: r.investor_user_id, type: 'round_call_reminder', category: 'deals', channels: ['in_app'], title: 'A private round call',
        body: `${project.name || 'A founder'} invited you to a private round call. It closes on ${call.target_close}.`, link: '/round-calls/' + call.uid });
    } catch { /* recorded as not delivered below, never guessed delivered */ }
    if (sent == null) {
      // Undo the claim: a reminder that did not arrive does not count toward the limit.
      await env.DB.prepare('UPDATE round_call_recipients SET reminder_count=reminder_count-1,last_reminded_at=? WHERE id=? AND last_reminded_at=?').bind(r.last_reminded_at, r.id, at).run();
      notReminded.push({ recipient_id: r.id, name: who, reason: 'not_delivered' });
      continue;
    }
    await env.DB.prepare("UPDATE round_call_recipients SET delivery_state='notified',notified_at=COALESCE(notified_at,?) WHERE id=? AND delivery_state='not_delivered'").bind(at, r.id).run();
    reminded.push(r.id);
  }
  await env.DB.prepare('INSERT INTO activity_logs(action,details,actor,user_id,project_id) VALUES(?,?,?,?,?)')
    .bind('round_call_remind_requested', JSON.stringify({ uid: call.uid, asked: all.length, reminded: reminded.length }), await hashEmail(actor.email), actor.id, call.project_id).run();
  return { asked: all.length, reminded: reminded.length, reminded_ids: reminded, not_reminded: notReminded, at: now() };
}

/* ------------------------------------------------------------------ export */

export type ExportScope = 'responses' | 'terms';
export interface ExportModel {
  call: CallRow; venture: string; exportedAt: string; exportedBy: string; scope: ExportScope;
  questionsState: 'read' | 'unreadable' | 'not_included';
  terms: Array<[string, string | null]>;
  rows: Array<[string, string, string | null, string | null, string | null, string | null, string | null]>;
  named: number; responded: number; withheldMatches: number; indicatedCents: number;
}
export const EXPORT_HEADER = ['Recipient', 'Origin', 'Opened', 'Data room', 'Responded', INDICATED_HEADER, 'Questions'];

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
export function termRows(call: CallRow): Array<[string, string | null]> {
  return [
    ['Call', call.name], ['Instrument', call.instrument], ['Amount (USD)', usd(call.amount_cents)], ['Minimum cheque (USD)', usd(call.minimum_cheque_cents)],
    ['Valuation cap (USD)', usd(call.valuation_cap_cents)], ['Discount', call.discount_bps == null ? null : `${(call.discount_bps * 0.01).toFixed(2)}%`],
    ['Pre-money (USD)', usd(call.pre_money_cents)], ['Close date', call.target_close], ['Counsel approved', day(call.counsel_approved_at)],
    ['Sent', day(call.sent_at)], ['Closed', day(call.closed_at)], ['Plain terms', call.terms],
  ];
}

/** The file's contents. Named recipients only; emails, unnamed matches and Eadwyn's notes never leave. A failed questions read is named, never dropped. */
export async function exportModel(env: Env, call: CallRow, actor: User, scope: ExportScope): Promise<ExportModel> {
  const project = await projectFacts(env, call.project_id);
  const all = await rows(env, call.id);
  const shown = all.filter(named);
  let questionsState: ExportModel['questionsState'] = scope === 'terms' ? 'not_included' : 'read';
  const asked = new Map<number, { n: number; answered: number }>();
  if (scope === 'responses') {
    try {
      const q = await env.DB.prepare('SELECT investor_user_id,answer FROM round_call_questions WHERE call_id=?').bind(call.id).all<{ investor_user_id: number; answer: string | null }>();
      for (const row of q.results || []) {
        const c = asked.get(row.investor_user_id) || { n: 0, answered: 0 };
        c.n += 1; if (row.answer) c.answered += 1; asked.set(row.investor_user_id, c);
      }
    } catch { questionsState = 'unreadable'; }
  }
  const out: ExportModel['rows'] = scope === 'terms' ? [] : shown.map((r) => {
    const q = asked.get(r.investor_user_id);
    return [r.name || 'Name not recorded', r.origin === 'chosen' ? 'Chosen' : 'Matching, responded', day(r.opened_at), day(r.data_room_requested_at), day(r.responded_at),
      r.commitment_cents == null ? null : toMajorString(r.commitment_cents, 'USD'),
      questionsState === 'unreadable' ? 'Questions could not be read' : q ? `${q.n} · ${q.answered} answered` : '0'];
  });
  return {
    call, venture: project.name || 'This venture', exportedAt: now(), exportedBy: actor.name || 'Not recorded', scope, questionsState,
    terms: termRows(call), rows: out, named: scope === 'terms' ? 0 : shown.length, responded: scope === 'terms' ? 0 : shown.filter((r) => r.responded_at).length,
    withheldMatches: scope === 'terms' ? 0 : all.length - shown.length,
    indicatedCents: scope === 'terms' ? 0 : shown.reduce((s, r) => s + (r.commitment_cents || 0), 0),
  };
}

export function withheldLines(m: ExportModel): string[] {
  return [`${m.withheldMatches} matching investors, not named (counted only)`, 'Investor emails', 'Eadwyn’s notes and proposals'];
}

export function exportCsv(m: ExportModel): string {
  const out: string[] = [];
  const w = (...cells: unknown[]) => out.push(cells.map(csvCell).join(','));
  w(`${m.call.name}: ${m.scope === 'terms' ? 'terms' : 'responses'}`, `Exported ${day(m.exportedAt)} by ${m.exportedBy}`);
  w('Indicated amounts are intentions, not commitments. None is counted toward the target.');
  if (m.questionsState === 'unreadable') w('Questions could not be read');
  w(''); w('Terms');
  for (const [k, v] of m.terms) w(k, v ?? 'Not recorded');
  if (m.scope === 'responses') {
    w(''); w('Responses'); w(...EXPORT_HEADER);
    if (!m.rows.length) w('No named recipients');
    for (const row of m.rows) w(...row);
  }
  w(''); w('Withheld');
  for (const line of withheldLines(m)) w(line);
  return out.join('\r\n');
}

export async function exportPdf(m: ExportModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${winAnsiSafe(m.call.name)} ${m.scope === 'terms' ? 'terms' : 'responses'} ${day(m.exportedAt)}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612; const H = 792; const M = 48;
  const ink = rgb(0.1, 0.1, 0.15); const muted = rgb(0.4, 0.4, 0.45); const bad = rgb(0.72, 0.11, 0.11);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const line = (text: string, f: PDFFont, size = 9, color = ink) => {
    if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(winAnsiSafe(text).slice(0, 110), { x: M, y, size, font: f, color });
    y -= size + 6;
  };
  line(`${m.venture} · Call for Capital`, bold, 10, muted);
  line(m.call.name, bold, 16);
  line(`Exported ${day(m.exportedAt)} by ${m.exportedBy}. For counsel. Indicated amounts are intentions, not commitments.`, font, 9, muted);
  if (m.questionsState === 'unreadable') line('Questions could not be read.', bold, 10, bad);
  y -= 6; line('Terms', bold, 12);
  for (const [k, v] of m.terms) line(`${k}: ${v ?? 'Not recorded'}`, font, 9);
  if (m.scope === 'responses') {
    y -= 6; line('Responses', bold, 12);
    line(EXPORT_HEADER.join(' | '), bold, 8, muted);
    if (!m.rows.length) line('No named recipients.', font, 9, muted);
    for (const row of m.rows) line(row.map((c) => (c == null || c === '' ? 'Not recorded' : String(c))).join(' | '), font, 9);
    line(`Indicated in total, not committed: ${usd(m.indicatedCents)}`, bold, 9);
  }
  y -= 6; line('Withheld', bold, 12);
  for (const w of withheldLines(m)) line(w, font, 9, muted);
  return doc.save();
}

/** Owner only, any call that was sent. The log row is written before the file is answered: no log, no file. */
export async function prepareExport(env: Env, call: CallRow, actor: User, format: 'csv' | 'pdf', scopeInput: unknown) {
  await requireOwnerRelation(env, actor, call);
  if (call.state === 'draft') throw new RoundCallError('call_draft', 409, 'A draft has no responses to export.');
  const scope: ExportScope = scopeInput === 'terms' ? 'terms' : 'responses';
  const model = await exportModel(env, call, actor, scope);
  const uid = crypto.randomUUID();
  const [logged] = await env.DB.batch([
    env.DB.prepare("INSERT INTO round_call_exports(uid,call_id,format,scope,questions_state,named_count,responded_count,withheld_matches,exported_by,exported_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM round_calls WHERE id=? AND project_id=? AND state<>'draft')")
      .bind(uid, call.id, format, scope, model.questionsState, model.named, model.responded, model.withheldMatches, actor.id, model.exportedAt, call.id, call.project_id),
    env.DB.prepare('INSERT INTO activity_logs(action,details,actor,user_id,project_id) VALUES(?,?,?,?,?)')
      .bind('round_call_exported', JSON.stringify({ uid: call.uid, format, scope, questions: model.questionsState }), await hashEmail(actor.email), actor.id, call.project_id),
  ]);
  if (Number(logged?.meta?.changes) !== 1) throw new RoundCallError('call_changed', 409);
  const filename = `${call.uid}-${scope}-${day(model.exportedAt)}.${format}`;
  return { model, filename, uid };
}

/* ------------------------------------------------------------ a new call */

export const CARRIED = ['amount_cents', 'instrument', 'minimum_cheque_cents', 'valuation_cap_cents', 'discount_bps', 'pre_money_cents', 'terms', 'data_room_project_uid'] as const;
export const NOT_CARRIED = ['target_close', 'counsel_approval', 'deck_version', 'audience'] as const;

/** Start a draft from a closed call: terms and the data room carry; the close date, counsel approval and deck version do not. Owner or co-founder. */
export async function startFromClosed(env: Env, call: CallRow, actor: User, input: Record<string, unknown>) {
  await callRelation(env, actor, call);
  if (call.state !== 'closed') throw new RoundCallError('source_not_closed', 409, 'Only a closed call can be copied into a new one.');
  const block = await blockingCall(env, call);
  if (block) throw new RoundCallError('another_call_open', 409, blockSentence(block));
  if (typeof input.name === 'string' && input.name.trim() === call.name.trim()) throw new RoundCallError('new_name_required', 400, 'Give the new call its own name.');
  const project = await projectFacts(env, call.project_id);
  let room = call.data_room_project_uid ?? null;
  if (room) {
    // A file in Trash is not data-room content to carry (D6073): `liveFiles` leaves it out.
    const recorded = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM data_room_files WHERE project_id=?${await liveFiles(env.DB)})+(SELECT COUNT(*) FROM data_room_folders WHERE project_id=?) AS n`).bind(project.id, project.id).first<{ n: number }>();
    if (!recorded?.n || room !== project.uid) room = null;
  }
  const carried: Record<string, unknown> = {};
  for (const key of CARRIED) carried[key] = key in input ? input[key] : key === 'data_room_project_uid' ? room : (call as any)[key] ?? null;
  const draft = await saveDraft(env, project, actor, { ...carried, name: input.name, target_close: input.target_close, deck_id: null, deck_version: null });
  await env.DB.batch([
    env.DB.prepare("UPDATE round_calls SET source_call_id=? WHERE id=? AND project_id=? AND state='draft' AND source_call_id IS NULL").bind(call.id, draft.id, call.project_id),
    env.DB.prepare('INSERT INTO activity_logs(action,details,actor,user_id,project_id) VALUES(?,?,?,?,?)')
      .bind('round_call_copied', JSON.stringify({ uid: draft.uid, from: call.uid }), await hashEmail(actor.email), actor.id, call.project_id),
  ]);
  return { call: { ...draft, source_call_id: call.id }, source: { uid: call.uid, name: call.name, closed_at: call.closed_at }, data_room_carried: room != null };
}

/* ---------------------------------------------------- recorded commitment */

/** Record a response as Signed or Wired with the amount the founder typed. Owner or co-founder (D1191). Never overwrites a Wired line. */
export async function recordCommitment(env: Env, call: CallRow, actor: User, input: Record<string, unknown>) {
  await callRelation(env, actor, call);
  if (call.state === 'draft') throw new RoundCallError('call_draft', 409, 'A draft has no responses.');
  const status = input.status;
  if (status !== 'signed' && status !== 'wired') throw new RoundCallError('invalid_status', 400, 'Choose Signed or Wired.');
  if (input.amount_cents == null || input.amount_cents === '') throw new RoundCallError('amount_required', 400, 'Type the amount the investor signed or wired.');
  if (!positiveCents(input.amount_cents)) throw new RoundCallError('invalid_amount', 400, 'Type an amount above zero.');
  const id = input.recipient_id;
  if (!Number.isSafeInteger(id) || (id as number) <= 0) throw new RoundCallError('invalid_recipients');
  const r = await env.DB.prepare('SELECT r.id,r.responded_at,u.email FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.id=? AND r.call_id=?').bind(id, call.id).first<{ id: number; responded_at: string | null; email: string | null }>();
  if (!r) throw new RoundCallError('recipient_not_found', 404);
  if (!r.responded_at) throw new RoundCallError('not_responded', 409, 'Only a response can be recorded as a commitment.');
  const line = r.email ? (await pipelineLines(env, call.project_id)).get(r.email.toLowerCase()) : undefined;
  if (!line) throw new RoundCallError('no_pipeline_line', 409, 'This investor is not in Capital relationships yet. Add them there first.');
  if (line.currency !== 'USD') throw new RoundCallError('other_currency', 409, 'This investor’s line is in another currency. It is listed and never added to the USD total.');
  if (line.status === 'wired') throw new RoundCallError('already_wired', 409, 'Already recorded as Wired. A response never overwrites it.');
  if (line.status === 'signed' && status === 'signed') throw new RoundCallError('already_signed', 409, 'Already recorded as Signed. Record Wired when the money arrives.');
  const at = now();
  const [written] = await env.DB.batch([
    env.DB.prepare("UPDATE raise_prospects SET stage='committed',commit_status=?,amount=?,round_call_uid=?,updated_at=? WHERE id=? AND project_id=? AND currency='USD' AND COALESCE(commit_status,'')=?")
      .bind(status, Number(toMajorString(input.amount_cents as number, 'USD')), call.uid, at, line.prospect_id, call.project_id, line.status ?? ''),
    env.DB.prepare("INSERT INTO activity_logs(project_id,user_id,entity_type,entity_id,action,details,actor) VALUES(?,?,'raise.capital-relationships',?,'prospect_updated',?,?)")
      .bind(call.project_id, actor.id, String(line.prospect_id), `Commitment recorded as ${status === 'signed' ? 'Signed' : 'Wired'} from a call response`, `user:${actor.id}`),
  ]);
  if (Number(written?.meta?.changes) !== 1) throw new RoundCallError('call_changed', 409);
  return { recorded: { status, amount_cents: input.amount_cents, at, prospect_id: line.prospect_id, round_call_uid: call.uid } };
}
