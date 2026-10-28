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
};
const json = (v: string) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };

export function draftView(r: Row) {
  return {
    uid: r.uid, parent_uid: r.parent_uid, person: r.person_ref, intent: r.intent, tone: r.tone, length: r.length,
    subject: r.subject, body: r.body, instruction: r.instruction, sources: json(r.refs_json), blocks: json(r.blocks_json),
    model: r.model, cost: { charged_microusd: r.cost_micro_usd == null ? null : Number(r.cost_micro_usd) }, created_at: r.created_at,
  };
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
  return await env.DB.prepare('SELECT uid, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd, created_at FROM mail_drafts WHERE uid = ? AND user_id = ?').bind(uid, user.id).first<Row>();
}

export async function draftOf(env: Env, user: User, uid: string): Promise<DraftView | null> {
  const r = await rowOf(env, user, uid);
  return r ? draftView(r) : null;
}

/** The member's own drafts, newest first; `person` narrows to one recipient. */
export async function listDrafts(env: Env, user: User, person: string | null) {
  const rows = person
    ? await env.DB.prepare('SELECT uid, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd, created_at FROM mail_drafts WHERE user_id = ? AND person_ref = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(user.id, person).all<Row>()
    : await env.DB.prepare('SELECT uid, person_ref, intent, tone, length, refs_json, blocks_json, subject, body, parent_uid, instruction, model, prompt_tokens, completion_tokens, cost_micro_usd, created_at FROM mail_drafts WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(user.id).all<Row>();
  return (rows.results || []).map(draftView);
}

/** Deletes one of the member's own drafts. Its revisions keep their parent's uid, which then names nothing. */
export async function deleteDraft(env: Env, user: User, uid: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return false;
  const r = await env.DB.prepare('DELETE FROM mail_drafts WHERE uid = ? AND user_id = ?').bind(uid, user.id).run();
  return !!r.meta?.changes;
}

/** The parent of a revision, as its ask: the same person, intent, tone, length, refs and blocks. */
export async function parentAsk(env: Env, user: User, uid: string): Promise<{ row: Row; body: Record<string, unknown> } | null> {
  const row = await rowOf(env, user, uid);
  if (!row) return null;
  return {
    row,
    body: { person: row.person_ref, intent: row.intent, tone: row.tone, length: row.length,
      refs: json(row.refs_json).map((s: any) => s?.ref).filter(Boolean), blocks: json(row.blocks_json).map((b: any) => b?.kind).filter(Boolean) },
  };
}
