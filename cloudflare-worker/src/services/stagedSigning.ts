/**
 * D1216 (#3213, Closing part 3) — one document signed in order by several
 * parties, with an optional Axal countersign stage last (CP4): a SAFE, SPA or
 * SPV Joinder between the company, the investor and Axal.
 *
 * THE BOOKLET'S PATTERN, GENERALISED. Each stage is one single-recipient
 * envelope over the same text, sent with `createAndSendEnvelope({ renderedBody })`
 * as the subscription booklet's two stages are (`bookletSigning.ts`, which is
 * unchanged). Every stage's `body_sha256` must equal the staged envelope's
 * `digest`; an envelope over other words is voided and never recorded.
 *
 * THE ORDER. Stage 1 is sent on creation. When a stage's envelope completes,
 * the next stage is sent (`onStagedEnvelopeCompleted`, called by the sign
 * route), except Axal's: it waits for a Super Admin to release it under
 * `closing.countersign` with a fresh step-up (`releaseCountersign`), and is
 * sent to that Super Admin. Migration 633's triggers refuse a stage sent while
 * one ahead of it is unsigned, so the order holds even if a route forgot it.
 *
 * COUNSEL'S TEXT. A document whose type has no text on file (a SAFE, until
 * D578's counsel text is registered) is never sent. Its draft can be
 * previewed, with the sentence `COUNSEL_DRAFT_LINE`.
 *
 * WHO READS. The closing's founder (the deal's project founder), the line's
 * investor (the commitment's) and admins. Anyone else reads 404, as for a
 * staged envelope that does not exist. A signing token never leaves this file
 * except to the caller who is that stage's signer.
 *
 * NOTHING SECRET IS LOGGED: a log names a code and an id, never a token, a
 * name, an email or the text.
 */
import type { Env } from '../types';
import { createAndSendEnvelope, templateBodyFor } from '../routes/esign';
import { applyMergeFields, mergeTokensIn } from './mergeFields';
import { AXAL_SIGNATORY_NAME } from './legalDocFormat';

export const STAGED_ROLES = ['company', 'investor', 'axal'] as const;
export type StagedRole = typeof STAGED_ROLES[number];
export const MAX_STAGES = 6;

/** The sentence a counsel draft is previewed with (the issue's words, D578). */
export const COUNSEL_DRAFT_LINE = 'This is a counsel draft. It can be previewed, never sent, until counsel’s text is on file (D578).';

/** A refusal in our own words: `sentence` is what the page prints, never a thrown provider's text. */
export class StagedRefusal extends Error {
  status: number;
  code: string;
  sentence: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
    this.extra = extra;
  }
}
const notFound = () => new StagedRefusal(404, 'staged_not_found', 'No envelope here.');

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Caller = { id: number; role: string; email?: string | null; name?: string | null };
type StagedRow = {
  id: number; uid: string; deal_id: number; commitment_id: number | null; document_type: string; title: string;
  body: string; digest: string; countersign: number; created_by: number; voided_at: string | null; created_at: string;
};
type SignerRow = {
  id: number; staged_id: number; position: number; role: StagedRole; user_id: number | null; name: string | null;
  envelope_uuid: string | null; sent_at: string | null; signed_at: string | null;
};

// ---------------------------------------------------------------------------
// Who may read and start one
// ---------------------------------------------------------------------------

/** The deal's founder: the account whose `founder_id` is the deal's project's. */
async function dealFounderId(env: Env, dealId: number): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT u.id FROM deals d JOIN projects p ON p.id = d.project_id JOIN users u ON u.founder_id = p.founder_id
      WHERE d.id = ? AND p.founder_id IS NOT NULL ORDER BY u.id LIMIT 1`,
  ).bind(dealId).first<{ id: number }>();
  return row?.id ?? null;
}

async function lineInvestorId(env: Env, commitmentId: number | null): Promise<number | null> {
  if (!commitmentId) return null;
  const row = await env.DB.prepare('SELECT investor_user_id FROM commitments WHERE id = ?').bind(commitmentId).first<{ investor_user_id: number }>();
  return row?.investor_user_id ?? null;
}

/** The founder of the closing, the line's investor, or an admin. */
async function canRead(env: Env, caller: Caller, s: StagedRow): Promise<boolean> {
  if (caller.role === 'admin') return true;
  if (Number(await dealFounderId(env, s.deal_id)) === Number(caller.id)) return true;
  return Number(await lineInvestorId(env, s.commitment_id)) === Number(caller.id);
}

// ---------------------------------------------------------------------------
// The text: counsel's, or a preview only
// ---------------------------------------------------------------------------

export type Preview = { sendable: boolean; title: string; body: string; line: string | null; unfilled: string[] };

/**
 * The text a stage would sign. With counsel's text on file it is that text,
 * filled from `fields` once for everyone (never per recipient), and sendable
 * when no slot is left empty. Without it, the caller's draft is previewed with
 * `COUNSEL_DRAFT_LINE` and is never sendable.
 */
export async function previewText(
  env: Env, docType: string, fields: Record<string, string> = {}, draft: { title?: string; body?: string } = {},
): Promise<Preview> {
  const type = String(docType || '').trim();
  if (!type) throw new StagedRefusal(400, 'document_type_required', 'Choose the document.');
  let source: Awaited<ReturnType<typeof templateBodyFor>>;
  try { source = await templateBodyFor(env, type); } catch {
    throw new StagedRefusal(503, 'template_unreadable', 'The document’s text could not be read just now. Try again.');
  }
  const merge = { effective_date: new Date().toISOString().slice(0, 10), ...fields };
  if (!source) {
    const body = String(draft.body ?? '').trim();
    if (!body) throw new StagedRefusal(409, 'counsel_draft_only', COUNSEL_DRAFT_LINE);
    const filled = applyMergeFields(body, merge);
    return { sendable: false, title: String(draft.title || type), body: filled, line: COUNSEL_DRAFT_LINE, unfilled: [...mergeTokensIn(filled)] };
  }
  const body = applyMergeFields(source.body, merge);
  const unfilled = [...mergeTokensIn(body)];
  return { sendable: unfilled.length === 0, title: String(draft.title || source.title || type), body, line: null, unfilled };
}

// ---------------------------------------------------------------------------
// Create and send
// ---------------------------------------------------------------------------

export type CreateInput = {
  deal_id: number; commitment_id?: number | null; document_type: string; title?: string;
  fields?: Record<string, string>;
  signers: Array<{ role: 'company' | 'investor'; user_id: number }>;
  countersign?: boolean;
};

/**
 * Records the staged envelope and its stages, then sends stage 1. The caller
 * is the closing's founder or an admin. Each named signer is an account; the
 * investor stage is the line's investor when a line is named. Axal's stage,
 * when asked for, is added last and waits for its release.
 */
export async function createStaged(env: Env, caller: Caller, input: CreateInput, appUrl: string) {
  const dealId = Number(input.deal_id);
  if (!Number.isInteger(dealId) || dealId <= 0) throw new StagedRefusal(400, 'deal_required', 'Name the closing.');
  const deal = await env.DB.prepare('SELECT id FROM deals WHERE id = ?').bind(dealId).first();
  if (!deal) throw notFound();
  const founderId = await dealFounderId(env, dealId);
  if (caller.role !== 'admin' && Number(founderId) !== Number(caller.id)) throw notFound();
  const commitmentId = input.commitment_id == null ? null : Number(input.commitment_id);
  if (commitmentId != null) {
    const line = await env.DB.prepare('SELECT id FROM commitments WHERE id = ? AND deal_id = ?').bind(commitmentId, dealId).first();
    if (!line) throw new StagedRefusal(400, 'line_not_in_closing', 'That line is not in this closing.');
  }
  const signers = Array.isArray(input.signers) ? input.signers : [];
  if (!signers.length) throw new StagedRefusal(400, 'signers_required', 'Name who signs, in order.');
  if (signers.length + (input.countersign ? 1 : 0) > MAX_STAGES) throw new StagedRefusal(400, 'too_many_signers', `At most ${MAX_STAGES} stages.`);
  const lineInvestor = await lineInvestorId(env, commitmentId);
  const named: Array<{ role: 'company' | 'investor'; user_id: number; name: string; email: string }> = [];
  for (const s of signers) {
    if (s?.role !== 'company' && s?.role !== 'investor') {
      throw new StagedRefusal(400, 'signer_role', 'Each signer is the company or the investor. Axal countersigns through `countersign`.');
    }
    const uid = Number(s.user_id);
    const u = Number.isInteger(uid) && uid > 0
      ? await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(uid).first<{ id: number; name: string | null; email: string }>()
      : null;
    if (!u) throw new StagedRefusal(400, 'signer_unknown', 'Each signer must have an account.');
    if (s.role === 'investor' && lineInvestor != null && u.id !== lineInvestor) {
      throw new StagedRefusal(400, 'investor_not_on_line', 'The investor who signs is the line’s investor.');
    }
    named.push({ role: s.role, user_id: u.id, name: u.name || u.email, email: u.email });
  }
  const preview = await previewText(env, input.document_type, input.fields || {}, { title: input.title });
  if (!preview.sendable) {
    if (preview.line) throw new StagedRefusal(409, 'counsel_draft_only', COUNSEL_DRAFT_LINE);
    throw new StagedRefusal(400, 'fields_unfilled', 'Fill every field before sending.', { fields: preview.unfilled });
  }
  const digest = await sha256Hex(preview.body);
  const res = await env.DB.prepare(
    `INSERT INTO esign_staged_envelopes (deal_id, commitment_id, document_type, title, body, digest, countersign, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(dealId, commitmentId, String(input.document_type).trim(), preview.title, preview.body, digest, input.countersign ? 1 : 0, caller.id).run();
  const stagedId = Number(res.meta?.last_row_id);
  const rows = named.map((s, i) => env.DB.prepare(
    'INSERT INTO esign_staged_signers (staged_id, position, role, user_id, name) VALUES (?, ?, ?, ?, ?)',
  ).bind(stagedId, i + 1, s.role, s.user_id, s.name));
  if (input.countersign) {
    rows.push(env.DB.prepare('INSERT INTO esign_staged_signers (staged_id, position, role, user_id, name) VALUES (?, ?, ?, NULL, ?)')
      .bind(stagedId, named.length + 1, 'axal', AXAL_SIGNATORY_NAME));
  }
  await env.DB.batch(rows);
  const staged = await stagedById(env, stagedId);
  await sendStage(env, staged!, 1, { senderId: caller.id, senderName: caller.name || 'Axal VC', appUrl });
  return { uid: staged!.uid };
}

async function stagedById(env: Env, id: number): Promise<StagedRow | null> {
  return env.DB.prepare('SELECT * FROM esign_staged_envelopes WHERE id = ?').bind(id).first<StagedRow>();
}
async function stagedByUid(env: Env, uid: string): Promise<StagedRow | null> {
  return env.DB.prepare('SELECT * FROM esign_staged_envelopes WHERE uid = ?').bind(uid).first<StagedRow>();
}
async function signersOf(env: Env, stagedId: number): Promise<SignerRow[]> {
  const r = await env.DB.prepare('SELECT * FROM esign_staged_signers WHERE staged_id = ? ORDER BY position').bind(stagedId).all<SignerRow>();
  return r.results || [];
}

/**
 * Sends one stage. The order is checked here and again by migration 633's
 * trigger. The envelope must carry the staged digest, or it is voided.
 */
async function sendStage(
  env: Env, staged: StagedRow, position: number,
  opts: { senderId: number; senderName: string; appUrl: string; recipient?: { id: number; name: string; email: string } },
): Promise<{ envelope_uuid: string; signing_url: string }> {
  if (staged.voided_at) throw new StagedRefusal(409, 'staged_void', 'This envelope was voided.');
  const stages = await signersOf(env, staged.id);
  const stage = stages.find((s) => s.position === position);
  if (!stage) throw notFound();
  if (stage.envelope_uuid) throw new StagedRefusal(409, 'stage_already_sent', 'This stage is already out for signature.');
  if (stages.some((s) => s.position < position && !s.signed_at)) {
    throw new StagedRefusal(409, 'not_your_turn', 'A stage ahead of this one has not signed yet.');
  }
  let to = opts.recipient;
  if (!to) {
    const u = stage.user_id
      ? await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(stage.user_id).first<{ id: number; name: string | null; email: string }>()
      : null;
    if (!u) throw new StagedRefusal(409, 'signer_missing', 'This stage’s signer no longer has an account.');
    to = { id: u.id, name: u.name || u.email, email: u.email };
  }
  const out = await createAndSendEnvelope(env, {
    adminUserId: opts.senderId,
    adminName: opts.senderName,
    recipientUserId: to.id,
    recipientEmail: to.email,
    recipientName: to.name,
    documentType: staged.document_type,
    dealId: staged.deal_id,
    appUrl: opts.appUrl,
    viaProvider: 'native',
    renderedBody: { title: `${staged.title} · ${position} of ${stages.length}`, body: staged.body },
    templateVersion: null,
  }).catch(() => { console.warn(`[stagedSigning] send failed staged=${staged.id} position=${position}`); return null; });
  if (!out) throw new StagedRefusal(503, 'send_failed', 'The envelope could not be sent just now. Try again.');
  if (out.already_pending) throw new StagedRefusal(409, 'stage_already_sent', 'This stage is already out for signature.');
  const sha = await env.DB.prepare('SELECT body_sha256 FROM esign_envelopes WHERE envelope_uuid = ?').bind(out.envelope_uuid).first<{ body_sha256: string | null }>();
  if (sha?.body_sha256 !== staged.digest) {
    await env.DB.prepare(`UPDATE esign_envelopes SET status = 'void' WHERE envelope_uuid = ? AND status = 'sent'`).bind(out.envelope_uuid).run();
    throw new StagedRefusal(409, 'text_changed', 'The text could not be sent exactly as recorded, so nothing was sent.');
  }
  await env.DB.prepare(
    `UPDATE esign_staged_signers SET envelope_uuid = ?, sent_at = CURRENT_TIMESTAMP, user_id = COALESCE(user_id, ?)
      WHERE id = ? AND envelope_uuid IS NULL`,
  ).bind(out.envelope_uuid, to.id, stage.id).run();
  return { envelope_uuid: out.envelope_uuid, signing_url: out.signing_url };
}

// ---------------------------------------------------------------------------
// The countersign (closing.countersign: a Super Admin, with step-up)
// ---------------------------------------------------------------------------

/**
 * Releases Axal's stage to the Super Admin who asks, once every stage ahead
 * of it has signed. The route holds the gates (Super Admin, fresh step-up);
 * this holds the order. Returns the signing token for the caller alone.
 */
export async function releaseCountersign(env: Env, superAdmin: Caller, uid: string, appUrl: string) {
  const staged = await stagedByUid(env, uid);
  if (!staged) throw notFound();
  const stages = await signersOf(env, staged.id);
  const axal = stages.find((s) => s.role === 'axal');
  if (!axal) throw new StagedRefusal(409, 'no_countersign', 'This envelope has no Axal countersign stage.');
  const out = await sendStage(env, staged, axal.position, {
    senderId: Number(staged.created_by), senderName: 'Axal VC', appUrl,
    recipient: { id: Number(superAdmin.id), name: AXAL_SIGNATORY_NAME, email: String(superAdmin.email || '') },
  });
  return { envelope_uuid: out.envelope_uuid, token: out.signing_url.split('/esign/').pop() || '' };
}

// ---------------------------------------------------------------------------
// After a signature
// ---------------------------------------------------------------------------

/**
 * Called by the sign route when an envelope completes. A stage records its
 * signature and sends the next stage, except Axal's, which waits for its
 * release. Never fails the signature: a send that cannot happen logs a code.
 * Returns whether the envelope was a stage, so the route can tell.
 */
export async function onStagedEnvelopeCompleted(env: Env, envelopeUuid: string, appUrl: string): Promise<boolean> {
  const stage = await env.DB.prepare('SELECT * FROM esign_staged_signers WHERE envelope_uuid = ?').bind(envelopeUuid).first<SignerRow>();
  if (!stage) return false;
  await env.DB.prepare('UPDATE esign_staged_signers SET signed_at = CURRENT_TIMESTAMP WHERE id = ? AND signed_at IS NULL').bind(stage.id).run();
  const staged = await stagedById(env, stage.staged_id);
  if (!staged) return true;
  const next = (await signersOf(env, staged.id)).find((s) => s.position === stage.position + 1);
  if (next && next.role !== 'axal') {
    try {
      await sendStage(env, staged, next.position, { senderId: Number(staged.created_by), senderName: 'Axal VC', appUrl });
    } catch (e) {
      console.warn(`[stagedSigning] next stage not sent staged=${staged.id} code=${e instanceof StagedRefusal ? e.code : 'error'}`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type StageView = {
  position: number; role: StagedRole; name: string | null;
  state: 'waiting' | 'awaiting_release' | 'sent' | 'signed' | 'declined' | 'void';
  sent_at: string | null; signed_at: string | null;
};

async function envelopeStates(env: Env, uuids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!uuids.length) return m;
  const r = await env.DB.prepare(
    `SELECT e.envelope_uuid, e.status, (SELECT COUNT(*) FROM esign_recipients r WHERE r.envelope_id = e.id AND r.status = 'rejected') AS declined
       FROM esign_envelopes e WHERE e.envelope_uuid IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(uuids)).all<{ envelope_uuid: string; status: string; declined: number }>();
  for (const row of r.results || []) m.set(row.envelope_uuid, Number(row.declined) > 0 ? 'declined' : String(row.status));
  return m;
}

function viewOf(stages: SignerRow[], states: Map<string, string>): StageView[] {
  return stages.map((s) => {
    const env = s.envelope_uuid ? states.get(s.envelope_uuid) : undefined;
    const ahead = stages.filter((o) => o.position < s.position).every((o) => !!o.signed_at);
    const state: StageView['state'] = s.signed_at ? 'signed'
      : env === 'declined' ? 'declined'
        : env === 'void' ? 'void'
          : s.envelope_uuid ? 'sent'
            : s.role === 'axal' && ahead ? 'awaiting_release' : 'waiting';
    return { position: s.position, role: s.role, name: s.name, state, sent_at: s.sent_at, signed_at: s.signed_at };
  });
}

/** One staged envelope's status per signer, and the closing line it belongs to. */
export async function readStaged(env: Env, caller: Caller, uid: string) {
  const staged = await stagedByUid(env, uid);
  if (!staged || !(await canRead(env, caller, staged))) throw notFound();
  const stages = await signersOf(env, staged.id);
  const states = await envelopeStates(env, stages.map((s) => s.envelope_uuid).filter((u): u is string => !!u));
  const view = viewOf(stages, states);
  return {
    uid: staged.uid,
    title: staged.title,
    document_type: staged.document_type,
    closing: { deal_id: staged.deal_id, commitment_id: staged.commitment_id },
    countersign: !!staged.countersign,
    complete: view.length > 0 && view.every((s) => s.state === 'signed'),
    voided: !!staged.voided_at,
    stages: view,
    created_at: staged.created_at,
  };
}

/** Every staged envelope on one closing line: signed ones link to it here. */
export async function readLine(env: Env, caller: Caller, commitmentId: number) {
  const line = await env.DB.prepare('SELECT id, deal_id, investor_user_id FROM commitments WHERE id = ?').bind(commitmentId).first<{ id: number; deal_id: number; investor_user_id: number }>();
  if (!line) throw notFound();
  const allowed = caller.role === 'admin' || Number(line.investor_user_id) === Number(caller.id)
    || Number(await dealFounderId(env, line.deal_id)) === Number(caller.id);
  if (!allowed) throw notFound();
  const rows = await env.DB.prepare('SELECT uid FROM esign_staged_envelopes WHERE commitment_id = ? ORDER BY id DESC').bind(commitmentId).all<{ uid: string }>();
  const envelopes = [];
  for (const r of rows.results || []) envelopes.push(await readStaged(env, { ...caller, role: 'admin' }, r.uid));
  return { closing: { deal_id: line.deal_id, commitment_id: line.id }, envelopes };
}
