/**
 * D1341 (#3549) — Eadwyn's email drafts: what a draft is asked for, what the
 * prompt carries, what comes back, and the member's own store (migration 648).
 *
 * THE PROMPT CARRIES ONLY WHAT WAS TICKED. The pack is read again at the press,
 * through each module's own read (`contextPack.ts`); a ref that is not in it is
 * refused as "Record not found."; of the pack, only the ticked refs' text and
 * the asked blocks, computed now, reach the model. An unticked record gives the
 * prompt nothing but the recipient's name, which the greeting needs.
 *
 * A revision is a new row naming its parent, read again the same way.
 */
import type { Env, User } from '../../types';
import { contextPack, MailError, notFound, type Pack, type PackItem } from './contextPack';
import { computeBlock, isBlockKind, type Block, type BlockKind } from './blocks';
import { intentFor, LENGTHS, TONES, type Intent } from './intents';
import { caseOnly } from './profileRecords';
import { run, type RailContext, type RunOptions } from '../aiRouter';
import { AI_SURFACE } from '../aiSurfaces';

export type Tone = typeof TONES[number];
export type Length = typeof LENGTHS[number];
export type DraftAsk = { person: string; intent: Intent; tone: Tone; length: Length; refs: string[]; blocks: BlockKind[]; project: number | null };

const MAX_REFS = 20;
const INSTRUCTION_MAX = 500;
const PROJECT = /^[1-9][0-9]{0,9}$/;
const bad = (code: string, sentence: string) => new MailError(400, code, sentence);

/** The project a company item or block is read for when the person has none (an advisor). */
export function projectParam(v: unknown): number | null {
  return PROJECT.test(String(v ?? '')) ? Number(v) : null;
}

/** A draft request, checked: an intent of the person's relationship, a tone, a length, refs and block kinds. */
export async function draftAsk(env: Env, user: User, b: Record<string, unknown>, now = Date.now()): Promise<{ ask: DraftAsk; pack: Pack }> {
  const project = projectParam(b.project);
  const pack = await contextPack(env, user, b.person, project, now);
  const intent = intentFor(pack.person.relationship, b.intent);
  if (!intent) throw bad('intent_invalid', 'Choose what this email is for.');
  if (!(TONES as readonly unknown[]).includes(b.tone)) throw bad('tone_invalid', 'Choose a tone: warm, direct or formal.');
  if (!(LENGTHS as readonly unknown[]).includes(b.length)) throw bad('length_invalid', 'Choose a length: short, medium or long.');
  const refs = Array.isArray(b.refs) ? [...new Set(b.refs.map(String))] : [];
  if (refs.length > MAX_REFS) throw bad('refs_too_many', `Choose at most ${MAX_REFS} records.`);
  const blocks = Array.isArray(b.blocks) ? [...new Set(b.blocks.map((x) => (x && typeof x === 'object' ? (x as any).kind : x)))] : [];
  if (!blocks.every(isBlockKind)) throw bad('block_invalid', 'One of the update blocks is not one Eadwyn can insert.');
  return { ask: { person: pack.person.ref, intent, tone: b.tone as Tone, length: b.length as Length, refs, blocks: blocks as BlockKind[], project }, pack };
}

/** The ticked items of the pack. A ref outside it is refused exactly as a record that does not exist. */
export function ticked(pack: Pack, refs: string[]): PackItem[] {
  const byRef = new Map(pack.items.map((i) => [i.ref, i]));
  return refs.map((ref) => {
    const item = byRef.get(ref);
    if (!item) throw notFound();
    return item;
  });
}

/** The asked blocks, computed now; one with nothing to say is left out. */
export async function blocksNow(env: Env, user: User, pack: Pack, ask: DraftAsk, now = Date.now()): Promise<Block[]> {
  const projectId = pack.person.project_id ?? ask.project;
  // D1348: an admin's draft quotes the case only, never a venture's live block.
  if (projectId == null || !ask.blocks.length || caseOnly(user)) return [];
  const project = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<{ id: number; founder_id: number | null }>();
  if (!project) return [];
  const out: Block[] = [];
  for (const kind of ask.blocks) {
    const block = await computeBlock(env, user, kind, project, now);
    if (block) out.push(block);
  }
  return out;
}

const WORDS: Record<Length, number> = { short: 90, medium: 180, long: 320 };
export const MAX_TOKENS: Record<Length, number> = { short: 450, medium: 750, long: 1100 };

export const SYSTEM = [
  'You draft one email for the sender to review and send themselves.',
  'Use only the facts under SOURCES and UPDATES. Never invent a figure, a name, a date, a promise or a quote.',
  'If a fact the email would need is not there, leave it out rather than guess.',
  'Reply with JSON only: {"subject": "...", "body": "..."}. The body is plain text with line breaks, signed off without a name.',
].join(' ');

export type Revision = { subject: string; body: string; instruction: string };

/** The messages for a draft or a revision. Only the ticked items and the computed blocks are in it. */
export function draftMessages(pack: Pack, ask: DraftAsk, sources: PackItem[], blocks: Block[], revision: Revision | null = null) {
  const lines = [
    `Recipient: ${pack.person.name} (${pack.person.relationship}).`,
    `Purpose: ${ask.intent.instruction}`,
    `Tone: ${ask.tone}. Length: at most ${WORDS[ask.length]} words.`,
    '',
    'SOURCES',
    ...(sources.length ? sources.map((s) => `[${s.ref}] ${s.label}${s.as_of ? ` (as of ${s.as_of})` : ''}\n${s.text}`) : ['(none chosen)']),
    '',
    'UPDATES',
    ...(blocks.length ? blocks.map((b) => `[${b.kind}]${b.as_of ? ` (as of ${b.as_of})` : ''}\n${b.text}`) : ['(none)']),
  ];
  if (revision) {
    lines.push('', 'CURRENT DRAFT', `Subject: ${revision.subject}`, revision.body, '', `Revise the current draft: ${revision.instruction}`);
  }
  return [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: lines.join('\n') }];
}

/** The model's `{subject, body}`, or null when it did not give both. */
export function parseDraft(output: unknown): { subject: string; body: string } | null {
  const text = String(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: any;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim().slice(0, 200) : '';
  const body = typeof parsed?.body === 'string' ? parsed.body.trim().slice(0, 8000) : '';
  return subject && body ? { subject, body } : null;
}

/** A revise press's words: Shorter, Warmer, or the member's own. */
export function revisionInstruction(v: unknown): string {
  if (v === 'shorter') return 'Make it shorter. Keep every fact it states.';
  if (v === 'warmer') return 'Make it warmer, without adding any fact.';
  const own = typeof v === 'string' ? v.trim() : '';
  if (!own) throw bad('instruction_required', 'Say how to change the draft: shorter, warmer, or in your own words.');
  if (own.length > INSTRUCTION_MAX) throw bad('instruction_too_long', `Keep the instruction under ${INSTRUCTION_MAX} characters.`);
  return own;
}

// ---------------------------------------------------------------- store

type Row = {
  uid: string; person_ref: string; intent: string; tone: string; length: string; refs_json: string; blocks_json: string;
  subject: string; body: string; parent_uid: string | null; instruction: string | null; model: string | null;
  prompt_tokens: number | null; completion_tokens: number | null; cost_micro_usd: number | null; created_at: string;
  edited_to: string | null; edited_subject: string | null; edited_body: string | null; edit_revision: number | null; edited_at: string | null;
};
const json = (v: string) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };

export function draftView(r: Row) {
  return {
    uid: r.uid, parent_uid: r.parent_uid, person: r.person_ref, intent: r.intent, tone: r.tone, length: r.length,
    subject: r.subject, body: r.body, instruction: r.instruction, sources: json(r.refs_json), blocks: json(r.blocks_json),
    model: r.model, cost: { charged_microusd: r.cost_micro_usd == null ? null : Number(r.cost_micro_usd) }, created_at: r.created_at,
    edit: editOf(r),
  };
}

/**
 * D4660: the member's own text for this version, or null when they never saved
 * an edit. `subject` and `body` above stay what Eadwyn generated (the source
 * snapshot); this is what the member made of it, with the revision a save must
 * name.
 */
export function editOf(r: Row): { to: string; subject: string; body: string; revision: number; at: string | null } | null {
  const revision = Number(r.edit_revision ?? 0);
  if (revision < 1) return null;
  return { to: r.edited_to ?? '', subject: r.edited_subject ?? r.subject, body: r.edited_body ?? r.body, revision, at: r.edited_at };
}

/** The text a revision starts from: the member's saved edit when there is one, else the generated text. */
export function currentText(r: Row): { subject: string; body: string } {
  const e = editOf(r);
  return e ? { subject: e.subject, body: e.body } : { subject: r.subject, body: r.body };
}
export type DraftView = ReturnType<typeof draftView>;

export type NewDraft = {
  ask: DraftAsk; sources: PackItem[]; blocks: Block[]; subject: string; body: string; parentUid: string | null; instruction: string | null;
  model: string | null; promptTokens: number | null; completionTokens: number | null; chargedMicro: number | null;
};

export async function insertDraft(env: Env, user: User, d: NewDraft): Promise<DraftView> {
  const uid = crypto.randomUUID().replace(/-/g, '');
  const sources = d.sources.map(({ ref, label, as_of, link }) => ({ ref, label, as_of, link }));
  const blocks = d.blocks.map(({ kind, as_of, link }) => ({ kind, as_of, link }));
  await env.DB.prepare(
    `INSERT INTO mail_drafts (uid, user_id, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, user.id, d.ask.person, d.ask.intent.key, d.ask.tone, d.ask.length, JSON.stringify(sources), JSON.stringify(blocks),
    d.subject, d.body, d.parentUid, d.instruction, d.model, d.promptTokens, d.completionTokens, d.chargedMicro).run();
  return (await draftOf(env, user, uid))!;
}

async function rowOf(env: Env, user: User, uid: string): Promise<Row | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  return await env.DB.prepare('SELECT uid, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd, created_at, edited_to, edited_subject, edited_body, edit_revision, edited_at FROM mail_drafts WHERE uid = ? AND user_id = ?').bind(uid, user.id).first<Row>();
}

export async function draftOf(env: Env, user: User, uid: string): Promise<DraftView | null> {
  const r = await rowOf(env, user, uid);
  return r ? draftView(r) : null;
}

/** The member's own drafts, newest first; `person` narrows to one recipient. */
export async function listDrafts(env: Env, user: User, person: string | null) {
  const rows = person
    ? await env.DB.prepare('SELECT uid, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd, created_at, edited_to, edited_subject, edited_body, edit_revision, edited_at FROM mail_drafts WHERE user_id = ? AND person_ref = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(user.id, person).all<Row>()
    : await env.DB.prepare('SELECT uid, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd, created_at, edited_to, edited_subject, edited_body, edit_revision, edited_at FROM mail_drafts WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(user.id).all<Row>();
  return (rows.results || []).map(draftView);
}

export const EDIT_SUBJECT_MAX = 200;
export const EDIT_BODY_MAX = 8000;
export const EDIT_TO_MAX = 254;

export type EditOutcome =
  | { ok: true; draft: DraftView }
  | { ok: false; status: 404 | 400 | 409; code: string; message: string; current?: DraftView };

/**
 * D4660: saves the member's edit of one version, with no model run and no
 * charge. The text is stored exactly as typed (a draft may be half-written, so
 * nothing is trimmed or checked as an address). A save names the revision it
 * read (`expected`), and writes only from that one: a second tab holding an
 * older copy is refused with the current draft, never silently overwritten.
 */
export async function saveDraftEdit(env: Env, user: User, uid: string, input: { to: unknown; subject: unknown; body: unknown; expected: unknown }): Promise<EditOutcome> {
  const row = await rowOf(env, user, uid);
  if (!row) return { ok: false, status: 404, code: 'not_found', message: 'Draft not found.' };
  const { to, subject, body, expected } = input;
  if (typeof subject !== 'string' || typeof body !== 'string' || (to != null && typeof to !== 'string')) {
    return { ok: false, status: 400, code: 'edit_invalid', message: 'Send the recipient, subject and body as text.' };
  }
  if (subject.length > EDIT_SUBJECT_MAX || body.length > EDIT_BODY_MAX || (to ?? '').length > EDIT_TO_MAX) {
    return { ok: false, status: 400, code: 'edit_too_long', message: `Keep the subject under ${EDIT_SUBJECT_MAX} characters, the body under ${EDIT_BODY_MAX} and the address under ${EDIT_TO_MAX}.` };
  }
  if (!Number.isInteger(expected) || (expected as number) < 0) {
    return { ok: false, status: 400, code: 'revision_required', message: 'Name the revision of the draft you read.' };
  }
  const r = await env.DB.prepare(
    `UPDATE mail_drafts SET edited_to = ?, edited_subject = ?, edited_body = ?, edit_revision = edit_revision + 1, edited_at = datetime('now')
     WHERE uid = ? AND user_id = ? AND edit_revision = ?`,
  ).bind(to ?? '', subject, body, uid, user.id, expected).run();
  if (!r.meta?.changes) {
    const now = await draftOf(env, user, uid);
    return { ok: false, status: 409, code: 'stale_edit', message: 'This draft was changed in another tab. Reload it to see the latest text.', current: now ?? undefined };
  }
  return { ok: true, draft: (await draftOf(env, user, uid))! };
}

/** Deletes one of the member's own drafts. Its revisions keep their parent's uid, which then names nothing. */
export async function deleteDraft(env: Env, user: User, uid: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return false;
  const r = await env.DB.prepare('DELETE FROM mail_drafts WHERE uid = ? AND user_id = ?').bind(uid, user.id).run();
  return !!r.meta?.changes;
}

/** The parent of a revision, as its ask: the same person, intent, tone, length, refs and blocks. */
export async function parentAsk(env: Env, user: User, uid: string): Promise<{ row: Row; current: { subject: string; body: string }; body: Record<string, unknown> } | null> {
  const row = await rowOf(env, user, uid);
  if (!row) return null;
  return {
    row,
    current: currentText(row),
    body: { person: row.person_ref, intent: row.intent, tone: row.tone, length: row.length,
      refs: json(row.refs_json).map((s: any) => s?.ref).filter(Boolean), blocks: json(row.blocks_json).map((b: any) => b?.kind).filter(Boolean) },
  };
}

/** The router's options for one draft: the prompt carries the ticked records and the blocks only. */
export function draftRunOptions(user: User, pack: Pack, ask: DraftAsk, sources: PackItem[], blocks: Block[], revision: Revision | null, rail: RailContext | undefined): RunOptions {
  return { task: 'mail_draft', userId: Number(user.id), messages: draftMessages(pack, ask, sources, blocks, revision), maxTokens: MAX_TOKENS[ask.length], rail, surface: AI_SURFACE.mailDraft };
}

async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

/** What one draft run came to: the stored draft, the router's refusal, or no usable answer. */
export type DraftOutcome =
  | { ok: true; draft: DraftView }
  | { ok: false; refusal: string; error?: string }
  | { ok: false; refusal: null; code: 'draft_unreadable'; message: string };

/**
 * D1343 (#3551): one draft, run and stored, shared by `POST /api/mail/drafts`
 * and the MCP tool `mail_draft`, so either is charged once, by the router, and
 * stores one `mail_drafts` row with its sources and that charge.
 */
export async function runDraft(env: Env, user: User, input: { ask: DraftAsk; pack: Pack; sources: PackItem[]; blocks: Block[]; parent: { uid: string; revision: Revision } | null; rail?: RailContext; pinMicrousd?: number }): Promise<DraftOutcome> {
  const { ask, pack, sources, blocks, parent } = input;
  const opts = draftRunOptions(user, pack, ask, sources, blocks, parent?.revision ?? null, input.rail);
  // The page and the rail are named at the call, where D552's and D765's scans read them.
  // D4666: an accepted quote pins the run: the router holds no more than it said and settles at no more.
  const out = await run(env, { ...opts, surface: AI_SURFACE.mailDraft, rail: opts.rail, ...(input.pinMicrousd != null ? { pinMicrousd: input.pinMicrousd } : {}) });
  if (out.refusal) {
    return { ok: false, refusal: out.refusal, error: out.refusal === 'guard_unavailable' ? 'The draft could not be checked. A started run may still be charged.' : undefined };
  }
  if (!out.ok) return { ok: false, refusal: null, code: 'draft_unreadable', message: 'Eadwyn could not draft this email. Try again.' };
  const drafted = parseDraft(out.output);
  if (!drafted) return { ok: false, refusal: null, code: 'draft_unreadable', message: 'Eadwyn’s answer was not an email. Try again; the run may still be charged.' };
  const draft = await insertDraft(env, user, {
    ask, sources, blocks, ...drafted, parentUid: parent?.uid ?? null, instruction: parent?.revision.instruction ?? null,
    model: out.usage?.model ?? null, promptTokens: out.usage?.prompt_tokens ?? null, completionTokens: out.usage?.completion_tokens ?? null,
    chargedMicro: await chargedOf(env, out.usageLogId, Number(user.id)),
  });
  return { ok: true, draft };
}
