/** D6884 — scoped, cited diligence drafts. No case mutation and no model-selected action. */
import type { Env, User } from '../types';
import { caseAllowed, MEMO_MAX, resolveSubjectUserId } from '../routes/dd';
import { decField, blockingSectionsWithOpenSevereFlags } from './dueDiligence';
import { UNTRUSTED_RULE, untrustedBlock, withoutUnrecordedLinks } from './ai/untrusted';
import { MAX_PASSAGES_PER_FILE, type Hit } from './dataRoomSearch';
import { liveFiles } from './dataRoomTrash';

export const DD_PAGE = 'Due diligence';
export const DD_OPTIONS = ['dd:summary', 'dd:request_drafts', 'dd:memo_draft', 'dd:section_summary', 'dd:answer_from_room'] as const;
export type DdOption = typeof DD_OPTIONS[number];
export type DdInput = { option: DdOption; case_uid: string; section_id?: number; request_id?: number; mode?: 'summary' | 'verdict_note'; text?: string };
type Row = Record<string, any>;
type Source = { id: string; kind: string; text: string; file_uid?: string; passage?: string };
export class DdRunRefusal extends Error {
  readonly status: 400 | 403 | 404 | 409 | 412 | 503;
  readonly code: string;
  readonly sentence: string;
  constructor(status: 400 | 403 | 404 | 409 | 412 | 503, code: string, sentence: string) { super(sentence); this.status = status; this.code = code; this.sentence = sentence; }
}
const deny = (): never => { throw new DdRunRefusal(403, 'dd_forbidden', 'You cannot run this option on this case.'); };
const unavailable = () => { throw new DdRunRefusal(503, 'dd_unreadable', 'Diligence records are unavailable right now.'); };
const positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function ddInput(body: any): DdInput {
  if (body?.page !== DD_PAGE || !DD_OPTIONS.includes(body?.option) || typeof body?.case_uid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.case_uid)
    || (body.section_id !== undefined && !positive(body.section_id)) || (body.request_id !== undefined && !positive(body.request_id))
    || (body.mode !== undefined && !['summary', 'verdict_note'].includes(body.mode))
    || (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > 4000))) {
    throw new DdRunRefusal(400, 'dd_input_invalid', 'Choose a case and a supported diligence option.');
  }
  return { option: body.option, case_uid: body.case_uid, section_id: body.section_id, request_id: body.request_id, mode: body.mode, text: body.text };
}
export type DdScope = { cs: Row; sections: Row[]; sectionId: number | null; request: Row | null; projectId: number | null; memo: boolean; record: string };
type RoomOwner = (uid: string) => Promise<boolean>;
/** Authorisation precedes every source read, retrieval and model call, and is repeated before storage. */
export async function ddScope(env: Env, user: User, input: DdInput, ownsRoom: RoomOwner): Promise<DdScope> {
  const cs = await env.DB.prepare('SELECT id, uid, owner_user_id, lead_user_id, subject_type, subject_id, subject_label, subject_email_enc, subject_legal_name_enc, status, risk_band FROM dd_cases WHERE uid = ?').bind(input.case_uid).first<Row>();
  if (!cs) throw new DdRunRefusal(404, 'dd_case_missing', 'This diligence case could not be found.');
  const record = `dd_case:${cs.uid}`;
  if (input.option === 'dd:answer_from_room') {
    if (await resolveSubjectUserId(env, cs) !== Number(user.id)) deny();
    if (!positive(input.request_id)) throw new DdRunRefusal(400, 'dd_request_required', 'Choose the request you want to answer.');
    const request = await env.DB.prepare('SELECT id, title, details, response_note, state FROM dd_requests WHERE id = ? AND case_id = ? AND withdrawn_at IS NULL')
      .bind(input.request_id, cs.id).first<Row>();
    if (!request) throw new DdRunRefusal(404, 'dd_request_missing', 'This request could not be found on your case.');
    if (request.state === 'reviewed') throw new DdRunRefusal(409, 'dd_request_reviewed', 'This request has already been reviewed.');
    const project = cs.subject_type === 'project' ? await env.DB.prepare('SELECT id, uid FROM projects WHERE id = ?').bind(cs.subject_id).first<Row>() : null;
    if (!project) return deny();
    if (!await ownsRoom(project.uid)) deny();
    return { cs, request, projectId: Number(project.id), sections: [], sectionId: null, memo: false, record };
  }
  const mine = (await env.DB.prepare('SELECT section_id, role FROM dd_reviewers WHERE case_id = ? AND user_id = ?').bind(cs.id, user.id).all<Row>()).results;
  const manager = user.role === 'admin' || Number(cs.lead_user_id ?? cs.owner_user_id) === Number(user.id) || Number(cs.owner_user_id) === Number(user.id);
  if (!manager && mine.length === 0) deny();
  if (!manager && mine.every(r => r.role === 'observer') && input.option !== 'dd:summary') deny();
  const all = (await env.DB.prepare('SELECT id FROM dd_sections WHERE case_id = ? ORDER BY id').bind(cs.id).all<Row>()).results;
  const allowed = caseAllowed(user, cs, mine as any, all.map(r => Number(r.id)));
  if (input.option === 'dd:memo_draft' && !allowed.memo_read) deny();
  if (input.option === 'dd:request_drafts' && !allowed.requests) deny();
  let sectionId = input.section_id ?? null;
  if (!manager && sectionId === null && mine.length === 1) sectionId = Number(mine[0].section_id);
  if ((!manager || input.option === 'dd:section_summary') && sectionId === null) {
    throw new DdRunRefusal(400, 'dd_section_required', 'Choose one of your assigned sections.');
  }
  if (sectionId !== null && (!all.some(r => Number(r.id) === sectionId) || (!manager && !mine.some(r => Number(r.section_id) === sectionId)))) deny();
  if (input.option === 'dd:section_summary' && !allowed.work[String(sectionId)]) deny();
  if (input.mode === 'verdict_note') {
    if (input.option !== 'dd:section_summary' || !allowed.verdict[String(sectionId)]) deny();
    // Same evidence gate as the verdict route: a signed artifact, never a client boolean.
    if (user.role !== 'admin' && Number(cs.lead_user_id ?? cs.owner_user_id) !== Number(user.id)) {
      const nda = await env.DB.prepare('SELECT id FROM dd_attachments WHERE case_id = ? AND section_id = ? AND uploaded_by_user_id = ? LIMIT 1').bind(cs.id, sectionId, user.id).first();
      if (!nda) throw new DdRunRefusal(412, 'dd_nda_required', 'Upload your signed NDA before drafting a verdict note.');
    }
  }
  const sections = (await env.DB.prepare('SELECT id, title, status, verdict, blocking, reviewer_notes_enc FROM dd_sections WHERE case_id = ? AND (? IS NULL OR id = ?) ORDER BY id').bind(cs.id, sectionId, sectionId).all<Row>()).results;
  return { cs, sections, sectionId, request: null, projectId: null, memo: input.option === 'dd:memo_draft' && allowed.memo_read, record };
}
async function plaintext(env: Env, table: string, column: string, row: Row, cipher: string): Promise<string> {
  if (!row[cipher]) return '';
  const value = await decField(env, table, column, row.id, row[cipher]);
  if (value === null) unavailable();
  return value!;
}
/** Remove identities before any guard, embedding or generation; no dynamic regular expressions. */
export function identityScrubber(identities: readonly string[]) {
  const names = [...new Set(identities.map(s => s.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return (value: unknown): string => {
    let text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    let clean = '';
    // Scan the original text only: short or overlapping aliases cannot redact
    // the replacement marker repeatedly or expand it without bound.
    while (text) {
      let at = -1, matched = '';
      const lower = text.toLowerCase();
      for (const name of names) {
        const found = lower.indexOf(name.toLowerCase());
        if (found >= 0 && (at < 0 || found < at)) { at = found; matched = name; }
      }
      if (at < 0) { clean += text; break; }
      // Unicode case-fold expansion is withheld rather than guessed.
      if (text.slice(at, at + matched.length).toLowerCase() !== matched.toLowerCase()) return '[identity withheld]';
      clean += text.slice(0, at) + '[identity withheld]';
      text = text.slice(at + matched.length);
    }
    return clean.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email withheld]');
  };
}
export type DdContext = { sources: Source[]; scrub: (value: unknown) => string; targets: string[]; revision: string | null; empty: boolean; risk: string | null; query: string };
/** Loads only scoped evidence; a reviewer's path never issues a memo query. */
export async function ddContext(env: Env, scope: DdScope, input: DdInput, hits?: Hit[]): Promise<DdContext> {
  const cs = scope.cs;
  const identities = [cs.subject_label, await plaintext(env, 'dd_cases', 'subject_email', cs, 'subject_email_enc'), await plaintext(env, 'dd_cases', 'subject_legal_name', cs, 'subject_legal_name_enc')];
  const raw: Source[] = [];
  const targets: string[] = [];
  let revision: string | null = null;
  let worked = false;
  if (scope.request) {
    raw.push({ id: `request:${scope.request.id}`, kind: 'request', text: JSON.stringify({ title: scope.request.title, details: scope.request.details, answer: input.text ?? scope.request.response_note }) });
    for (const [index, hit] of (hits ?? []).entries()) {
      const passages = (await env.DB.prepare(`SELECT f.uid, f.name, p.text AS passage_text FROM data_room_files f JOIN data_room_passages p ON p.file_id = f.id AND p.project_id = f.project_id WHERE f.uid = ? AND f.project_id = ?${await liveFiles(env.DB, 'f')} ORDER BY p.seq LIMIT ?`).bind(hit.file_uid, scope.projectId, MAX_PASSAGES_PER_FILE).all<Row>()).results;
      // Search slices JS strings (UTF-16); SQLite substr counts code points.
      // Use the same slice for an exact recheck, including astral characters.
      const file = passages.find(p => String(p.passage_text).slice(0, 320) === hit.snippet);
      if (!file) continue;
      raw.push({ id: `passage:${index}`, kind: 'passage', text: `${file.name}: ${hit.snippet}`, file_uid: String(file.uid), passage: hit.snippet });
    }
  } else {
    const items = (await env.DB.prepare('SELECT id, section_id, title, status, severity, note_enc FROM dd_checklist_items WHERE case_id = ? AND (? IS NULL OR section_id = ?) ORDER BY id LIMIT 1001').bind(cs.id, scope.sectionId, scope.sectionId).all<Row>()).results;
    const flags = (await env.DB.prepare('SELECT id, section_id, title, severity, state, resolved_at, detail_enc, subject_name_enc, evidence_excerpt_enc FROM dd_findings WHERE case_id = ? AND (? IS NULL OR section_id = ?) ORDER BY id LIMIT 1001').bind(cs.id, scope.sectionId, scope.sectionId).all<Row>()).results;
    if (items.length > 1000 || flags.length > 1000) throw new DdRunRefusal(409, 'dd_context_large', 'Choose a smaller section before running Eadwyn.');
    const blockingSections = scope.sections.map(s => ({ id: Number(s.id), blocking: Number(s.blocking) }));
    for (const flag of flags) identities.push(await plaintext(env, 'dd_findings', 'subject_name', flag, 'subject_name_enc'));
    for (const s of scope.sections) {
      const notes = await plaintext(env, 'dd_sections', 'reviewer_notes', s, 'reviewer_notes_enc');
      worked ||= Boolean(notes || s.verdict || s.status === 'completed' || s.status === 'blocked');
      raw.push({ id: `section:${s.id}`, kind: 'section', text: JSON.stringify({ title: s.title, status: s.status, verdict: s.verdict, blocking: s.blocking, notes }) });
    }
    for (const item of items) {
      const note = await plaintext(env, 'dd_checklist_items', 'note', item, 'note_enc');
      worked ||= Boolean(note || item.status !== 'pending');
      const blocksProceed = blockingSectionsWithOpenSevereFlags(blockingSections, [], [{ section_id: Number(item.section_id), status: String(item.status), severity: item.severity ?? null }]).length > 0;
      raw.push({ id: `item:${item.id}`, kind: 'item', text: JSON.stringify(input.option === 'dd:request_drafts' ? { title: item.title } : { title: item.title, status: item.status, severity: item.severity, note, blocks_proceed: blocksProceed }) });
      if (['pending', 'flag', 'fail'].includes(item.status)) targets.push(`item:${item.id}`);
    }
    for (const flag of flags) {
      worked = true;
      const blocksProceed = blockingSectionsWithOpenSevereFlags(blockingSections, [{ section_id: flag.section_id === null ? null : Number(flag.section_id), severity: String(flag.severity), resolved_at: flag.resolved_at ?? null }], []).length > 0;
      raw.push({ id: `flag:${flag.id}`, kind: 'flag', text: JSON.stringify({ title: flag.title, severity: flag.severity, state: flag.state, resolved_at: flag.resolved_at,
        detail: await plaintext(env, 'dd_findings', 'detail', flag, 'detail_enc'), excerpt: await plaintext(env, 'dd_findings', 'evidence_excerpt', flag, 'evidence_excerpt_enc'), blocks_proceed: blocksProceed }) });
    }
    if (input.option !== 'dd:request_drafts') {
      const requests = (await env.DB.prepare('SELECT id, title, state, response_note FROM dd_requests WHERE case_id = ? AND withdrawn_at IS NULL AND (? IS NULL OR section_id = ?) ORDER BY id LIMIT 1001').bind(cs.id, scope.sectionId, scope.sectionId).all<Row>()).results;
      if (requests.length > 1000) throw new DdRunRefusal(409, 'dd_context_large', 'Choose a smaller section before running Eadwyn.');
      for (const request of requests) {
        worked = true;
        raw.push({ id: `request:${request.id}`, kind: 'request', text: JSON.stringify({ title: request.title, state: request.state, response: request.response_note }) });
      }
    }
    if (scope.memo) {
      const memo = await env.DB.prepare('SELECT id, summary_enc, verified_enc, on_trust_enc, conditions_enc, updated_at FROM dd_case_memos WHERE case_id = ?').bind(cs.id).first<Row>();
      revision = memo?.updated_at ?? null;
      if (memo) for (const part of MEMO_PARTS) {
        const text = await plaintext(env, 'dd_case_memos', part, memo, `${part}_enc`);
        if (text) raw.push({ id: `memo:${part}`, kind: 'memo', text });
      }
    }
  }
  const scrub = identityScrubber(identities);
  const sources = raw.map(s => ({ ...s, text: ['request', 'section', 'item', 'flag'].includes(s.kind)
    ? JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(s.text)).map(([k, v]) => [k, typeof v === 'string' ? scrub(v) : v])))
    : scrub(s.text), ...(s.passage ? { passage: scrub(s.passage) } : {}) }));
  if (JSON.stringify(sources).length > 60000) throw new DdRunRefusal(409, 'dd_context_large', 'Choose a smaller section before running Eadwyn.');
  return { sources, targets, revision, scrub, empty: !scope.request && !worked, risk: cs.risk_band ?? null, query: scrub(input.text || scope.request?.title || '') };
}
export const MEMO_PARTS = ['summary', 'verified', 'on_trust', 'conditions'] as const;
export function ddMessages(ctx: DdContext, input: DdInput) {
  const rules: Record<DdOption, string> = {
    'dd:summary': 'Summarise worked and open items; only a source with blocks_proceed=true blocks Proceed under the existing case gate. Every line is a separate draft with its source IDs. Never decide or infer Green from missing data.',
    'dd:request_drafts': 'Draft one founder-safe request for each target item. Cite that item alone. Do not disclose internal flags, severity, reviewers, verdicts, risk or case notes.',
    'dd:memo_draft': `Draft exactly the four memo parts summary, verified, on_trust, conditions from recorded evidence. Each text has at most ${MEMO_MAX} characters. Do not choose a decision.`,
    'dd:section_summary': input.mode === 'verdict_note' ? 'Draft a neutral evidence note for this section. Suggest no verdict, decision or course of action.' : 'Summarise only this section, with a source citation for each line; suggest no verdict.',
    'dd:answer_from_room': 'Propose a founder answer using only the addressed request and matched room passages. Cite at least one passage per draft. Do not send it or attach files.',
  };
  // Requests never see internal encrypted flag detail, even in a model asked to write safe copy.
  const records = input.option === 'dd:request_drafts' ? ctx.sources.filter(s => ctx.targets.includes(s.id)) : ctx.sources;
  const data = untrustedBlock('record_text', JSON.stringify({ sources: records, targets: ctx.targets }));
  return { messages: [{ role: 'system' as const, content: `You are Eadwyn. ${rules[input.option]} Return JSON only: {"drafts":[{"text":"...","sources":["source:id"],"part":"memo part only"}]}. Use source IDs exactly as supplied. Never include email addresses or legal names. These are proposals only. ${UNTRUSTED_RULE}` },
    { role: 'user' as const, content: data }], guardText: data };
}
/** Closed payload: citation IDs are checked, file passages come from the server, and no verdict/action is stored. */
export function ddDrafts(output: unknown, ctx: DdContext, input: DdInput) {
  let parsed: any;
  try { parsed = typeof output === 'string' ? JSON.parse(output) : output; } catch { return []; }
  if (!Array.isArray(parsed?.drafts) || parsed.drafts.length === 0 || parsed.drafts.length > 100) return [];
  const drafts: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  for (const d of parsed.drafts) {
    if (typeof d?.text !== 'string' || !d.text.trim() || d.text.length > MEMO_MAX || !Array.isArray(d.sources) || d.sources.length === 0 || d.sources.length > 20) return [];
    if (['dd:summary', 'dd:section_summary'].includes(input.option) && /[\r\n]/.test(d.text)) return [];
    const sources: Source[] = [];
    for (const id of d.sources) {
      const source = ctx.sources.find(s => s.id === id);
      if (!source) return [];
      sources.push(source);
    }
    if (input.option === 'dd:request_drafts') {
      if (sources.length !== 1 || !ctx.targets.includes(sources[0].id) || used.has(sources[0].id)) return [];
      used.add(sources[0].id);
    }
    if (input.option === 'dd:memo_draft') {
      if (!MEMO_PARTS.includes(d.part) || used.has(d.part)) return [];
      used.add(d.part);
    }
    if (input.option === 'dd:answer_from_room' && !sources.some(s => s.file_uid)) return [];
    const text = withoutUnrecordedLinks(ctx.scrub(d.text), ctx.sources.map(s => s.text));
    if (!text || text.length > MEMO_MAX) return [];
    if (input.mode === 'verdict_note' && /\b(pass|fail|warn|proceed|approve|reject|verdict|recommend|advi[cs]e)\b/i.test(text)) return [];
    drafts.push({ type: input.option, text, citations: sources.map(s => ({ source: s.id, ...(s.file_uid ? { file_uid: s.file_uid, passage: s.passage } : {}) })), visibility: 'private',
      ...(input.option === 'dd:memo_draft' ? { part: d.part, characters: text.length, max_characters: MEMO_MAX, base_revision: ctx.revision } : {}),
      ...(input.option === 'dd:section_summary' ? { section_id: input.section_id, mode: input.mode ?? 'summary' } : {}),
      ...(input.option === 'dd:answer_from_room' ? { request_id: input.request_id } : {}) });
  }
  if (input.option === 'dd:memo_draft' && used.size !== MEMO_PARTS.length) return [];
  if (input.option === 'dd:request_drafts' && used.size !== ctx.targets.length) return [];
  return drafts;
}
