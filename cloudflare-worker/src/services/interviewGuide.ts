/**
 * D6008 (#6008) — the interview guide: what to ask, grouped under the venture's
 * open hypotheses and the themes no interview has judged yet (D5995, V27–V29).
 *
 *   - THE MATERIAL (`guideMaterial`) is read from the stores Validate already
 *     reads: the open claims (not retired, and not yet supported or refuted,
 *     the rule `recordSetup.talkingPoints` uses), the pain themes whose
 *     severity no interview judged (`themesOf`, severity null), and the active
 *     segments. With no open claim the guide offers DEFAULT_QUESTIONS, labelled
 *     as defaults.
 *   - THE GUIDE is kept per venture (owner pick A) in `interview_guides`, saved
 *     whole with the version it read (`saveGuide`). A question's author is the
 *     server's call: a new or edited question is the founder's; Eadwyn's stay
 *     Eadwyn's only while their text is unchanged, and enter only through
 *     `acceptDraft` with a receipt this module signed.
 *   - EADWYN'S DRAFT (`draftPrompt`, `parseDraft`) proposes questions for the
 *     chosen segment, each under a listed hypothesis or theme. Nothing is
 *     stored: the answer carries an HMAC receipt for 15 minutes, and Accept
 *     sends it back with the ids the founder kept.
 *   - THE COPY (`copyOnto`) is taken onto one interview the first time the
 *     guide is opened for it, and marking a question asked (`markAsked`)
 *     changes that copy only.
 */
import type { Env } from '../types';
import { signHmac } from './scoreIntegrity';
import {
  claimsOf, loadHypotheses, loadInterviews, loadSeverities, supportsByGroup, themesOf, type Ctx,
} from './cycleValidate';
import { loadPainGroupModel } from './painGroups';

export const GUIDE_MAX_QUESTIONS = 40;
export const QUESTION_MAX = 240;
export const DRAFT_MAX = 12;
export const THEMES_MAX = 6;
const RECEIPT_TTL_MS = 15 * 60 * 1000;

/** The rail's page and option for Eadwyn's draft; the page is Customer research's (`CUSTOMER_RESEARCH_PAGE`). */
export const GUIDE_PAGE = 'Founder · Validate · Customer research';
export const GUIDE_OPTION = 'draft:validate/interview-guide';

/** Shown, labelled as defaults, while no hypothesis is open (V27 C). */
export const DEFAULT_QUESTIONS: readonly string[] = Object.freeze([
  'Tell me about the last time this came up at work.',
  'What did you try, and what did it cost you?',
  'Who else is involved when it goes wrong?',
]);

export type GroupKind = 'hypothesis' | 'theme' | 'default' | 'other';
export type Question = { id: string; text: string; group: { kind: GroupKind; ref: string | null }; by: 'me' | 'eadwyn' | 'default' };
export type Guide = { questions: Question[]; version: number; updated_at: string | null };

/** A refusal: its status, code and the sentence the page prints. */
export class GuideError extends Error {
  status: number; code: string; sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}

export type Material = {
  hypotheses: Array<{ id: number; ref: string; code: string; claim: string; status: string }>;
  themes: Array<{ ref: string; title: string; mentions: number }>;
  segments: Array<{ id: number; name: string; who_they_are: string | null; job_to_be_done: string | null }>;
};

const DECIDED = new Set(['supported', 'refuted']);

export async function guideMaterial(ctx: Ctx): Promise<Material> {
  const [{ hyps, links }, interviews, model, sev, segs] = await Promise.all([
    loadHypotheses(ctx), loadInterviews(ctx), loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }), loadSeverities(ctx),
    ctx.env.DB.prepare(`SELECT id, name, who_they_are, job_to_be_done FROM customer_segments
      WHERE project_id = ? AND archived_at IS NULL ORDER BY id`).bind(ctx.projectId)
      .all<{ id: number; name: string; who_they_are: string | null; job_to_be_done: string | null }>(),
  ]);
  const claims = claimsOf(hyps, links, interviews, model).filter((c) => !DECIDED.has(c.status));
  const themes = themesOf(interviews, model, sev, ctx.today, supportsByGroup(hyps, links))
    .filter((t) => t.severity == null).slice(0, THEMES_MAX);
  return {
    hypotheses: claims.map((c) => ({ id: c.id, ref: `h:${c.id}`, code: c.code, claim: c.claim, status: c.status })),
    themes: themes.map((t) => ({ ref: `t:${t.key}`, title: t.title, mentions: t.mentions })),
    segments: (segs.results || []).map((s) => ({ id: Number(s.id), name: s.name, who_they_are: s.who_they_are, job_to_be_done: s.job_to_be_done })),
  };
}

// ---------------------------------------------------------------------------
// The venture's guide
// ---------------------------------------------------------------------------

const cleanText = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const ID_RE = /^[a-z0-9]{6,32}$/;
export const newQuestionId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

function parseStored(raw: string | null | undefined): Question[] {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((q) => q && typeof q.id === 'string' && typeof q.text === 'string' && q.group && typeof q.group.kind === 'string');
  } catch { return []; }
}

export async function readGuide(env: Env, projectId: number): Promise<Guide> {
  const row = await env.DB.prepare('SELECT questions_json, version, updated_at FROM interview_guides WHERE project_id = ?')
    .bind(projectId).first<{ questions_json: string; version: number; updated_at: string | null }>();
  if (!row) return { questions: [], version: 0, updated_at: null };
  return { questions: parseStored(row.questions_json), version: Number(row.version), updated_at: row.updated_at };
}

function groupOf(raw: unknown, refs: ReadonlySet<string>): Question['group'] {
  const g = (raw && typeof raw === 'object' ? raw : {}) as { kind?: unknown; ref?: unknown };
  const kind = g.kind === 'hypothesis' || g.kind === 'theme' || g.kind === 'default' ? g.kind : 'other';
  const ref = typeof g.ref === 'string' ? g.ref : null;
  // A group whose claim or theme is no longer listed keeps its question, under Other.
  if ((kind === 'hypothesis' || kind === 'theme') && (!ref || !refs.has(ref))) return { kind: 'other', ref: null };
  return { kind, ref: kind === 'hypothesis' || kind === 'theme' ? ref : null };
}

/**
 * The founder's save: the whole list in their order, with the version they read.
 * A question keeps its stored author only while its text is unchanged; anything
 * new or edited is the founder's, so a request can never mark text as Eadwyn's.
 */
export function mergeSave(stored: readonly Question[], incoming: unknown, refs: ReadonlySet<string>): Question[] {
  if (!Array.isArray(incoming)) throw new GuideError(400, 'invalid_guide', 'Send the guide as a list of questions.');
  if (incoming.length > GUIDE_MAX_QUESTIONS) throw new GuideError(400, 'guide_too_long', `A guide holds at most ${GUIDE_MAX_QUESTIONS} questions.`);
  const byId = new Map(stored.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const raw of incoming) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { id?: unknown; text?: unknown; group?: unknown };
    const text = cleanText(r.text);
    if (!text) throw new GuideError(400, 'question_empty', 'A question cannot be empty.');
    if (text.length > QUESTION_MAX) throw new GuideError(400, 'question_too_long', `Keep each question under ${QUESTION_MAX} characters.`);
    const prior = typeof r.id === 'string' ? byId.get(r.id) : undefined;
    const id = prior ? prior.id : typeof r.id === 'string' && ID_RE.test(r.id) && !byId.has(r.id) ? r.id : newQuestionId();
    if (seen.has(id)) throw new GuideError(400, 'question_repeated', 'A question appears twice.');
    seen.add(id);
    const by: Question['by'] = prior && prior.text === text ? prior.by : 'me';
    out.push({ id, text, group: groupOf(r.group, refs), by });
  }
  return out;
}

/** Write the guide if `expected` is the version stored; otherwise 409 with nothing changed. */
export async function writeGuide(env: Env, projectId: number, userId: number, questions: Question[], expected: unknown): Promise<Guide> {
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) throw new GuideError(400, 'version_required', 'Reload the guide before saving it.');
  const json = JSON.stringify(questions);
  const res = expected === 0
    ? await env.DB.prepare(`INSERT INTO interview_guides (project_id, questions_json, version, updated_by)
        VALUES (?, ?, 1, ?) ON CONFLICT(project_id) DO NOTHING`).bind(projectId, json, userId).run()
    : await env.DB.prepare(`UPDATE interview_guides SET questions_json = ?, version = version + 1, updated_by = ?, updated_at = datetime('now')
        WHERE project_id = ? AND version = ?`).bind(json, userId, projectId, expected).run();
  if (Number(res.meta?.changes) !== 1) throw new GuideError(409, 'guide_changed', 'The guide changed in another tab. Reload it before saving, so nothing is overwritten.');
  return readGuide(env, projectId);
}

// ---------------------------------------------------------------------------
// Eadwyn's draft
// ---------------------------------------------------------------------------

export function draftPrompt(m: Material, segmentId: number | null): string {
  const seg = segmentId == null ? null : m.segments.find((s) => s.id === segmentId) ?? null;
  return [
    'You are Eadwyn. Draft interview questions for a founder\'s next customer-discovery interview.',
    'Write open questions about the interviewee\'s past behaviour and real situations: never leading, never pitching the product,',
    'never asking whether they would buy or pay. One question per item, each ending with a question mark, at most 200 characters.',
    `Write at most ${DRAFT_MAX} questions. Put each under exactly one "group": a hypothesis ref or a theme ref from the lists below.`,
    'Answer with JSON only: {"questions": [{"group": "h:1", "text": "..."}]}.',
    seg ? `The interviewee is in this segment: ${JSON.stringify({ name: seg.name, who_they_are: seg.who_they_are, job_to_be_done: seg.job_to_be_done })}` : 'No segment was chosen.',
    'Open hypotheses, as JSON:',
    JSON.stringify(m.hypotheses.map(({ ref, code, claim }) => ({ ref, code, claim }))),
    'Themes no interview has judged yet, as JSON:',
    JSON.stringify(m.themes.map(({ ref, title }) => ({ ref, title }))),
  ].join('\n');
}

const LEADING = /\b(would you (buy|pay|use)|how much would you pay|don't you think|wouldn't you)\b/i;

/** Eadwyn's questions, each under a listed group, or null when the answer is not usable. */
export function parseDraft(output: string, m: Material): Array<{ group: string; text: string }> | null {
  let list: unknown;
  try { list = (JSON.parse(String(output).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { questions?: unknown }).questions; } catch { return null; }
  if (!Array.isArray(list)) return null;
  const refs = new Set([...m.hypotheses.map((h) => h.ref), ...m.themes.map((t) => t.ref)]);
  const out: Array<{ group: string; text: string }> = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { group?: unknown; text?: unknown };
    const text = cleanText(r.text);
    if (typeof r.group !== 'string' || !refs.has(r.group)) continue;
    if (!text || text.length > QUESTION_MAX || !text.endsWith('?') || LEADING.test(text) || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ group: r.group, text });
    if (out.length >= DRAFT_MAX) break;
  }
  return out.length ? out : null;
}

export type DraftPayload = {
  uid: string; user: number; project: number; segment_id: number | null; expires: number;
  questions: Array<{ id: string; group: string; text: string }>;
};

const sign = (env: Env, payload: string) => signHmac(env, 'interview-guide-draft:v1:' + payload);
function same(a: unknown, b: string) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let n = 0; n < b.length; n++) diff |= a.charCodeAt(n) ^ b.charCodeAt(n);
  return diff === 0;
}

export async function draftReceipt(env: Env, user: number, project: number, segmentId: number | null, questions: Array<{ group: string; text: string }>, now = Date.now()) {
  const p: DraftPayload = { uid: newQuestionId(), user, project, segment_id: segmentId, expires: now + RECEIPT_TTL_MS,
    questions: questions.map((q) => ({ id: newQuestionId(), group: q.group, text: q.text })) };
  const payload = JSON.stringify(p);
  return { draft: p, receipt: { payload, signature: await sign(env, payload) } };
}

/** The receipt's own questions, for its own founder and venture, while fresh. */
export async function openReceipt(env: Env, user: number, project: number, raw: unknown, now = Date.now()): Promise<DraftPayload> {
  const r = raw as { payload?: unknown; signature?: unknown } | null;
  if (!r || typeof r.payload !== 'string' || r.payload.length > 20000 || !same(r.signature, await sign(env, r.payload))) {
    throw new GuideError(400, 'invalid_draft', 'Ask Eadwyn for a draft before accepting it.');
  }
  const p = JSON.parse(r.payload) as DraftPayload;
  if (p.user !== user || p.project !== project) throw new GuideError(400, 'invalid_draft', 'Ask Eadwyn for a draft before accepting it.');
  if (!Number.isFinite(p.expires) || p.expires < now) throw new GuideError(409, 'draft_expired', 'This draft is too old to accept. Ask Eadwyn again.');
  return p;
}

/**
 * Accept: the picked questions join the guide as Eadwyn's, under their groups.
 * `edits` maps a picked id to the founder's wording; an edited one is theirs.
 */
export function acceptInto(stored: readonly Question[], p: DraftPayload, ids: unknown, edits: unknown, refs: ReadonlySet<string>): Question[] {
  if (!Array.isArray(ids) || !ids.length || ids.some((v) => typeof v !== 'string')) throw new GuideError(400, 'nothing_accepted', 'Choose a question to accept.');
  const changed = (edits && typeof edits === 'object' && !Array.isArray(edits) ? edits : {}) as Record<string, unknown>;
  const have = new Set(stored.map((q) => q.id));
  const added: Question[] = [];
  for (const id of new Set(ids as string[])) {
    const q = p.questions.find((x) => x.id === id);
    if (!q) throw new GuideError(400, 'not_in_draft', 'That question is not in this draft.');
    if (have.has(q.id)) continue; // accepted already: a repeated press adds nothing
    const edited = typeof changed[id] === 'string' ? cleanText(changed[id]) : null;
    if (edited !== null && (!edited || edited.length > QUESTION_MAX)) throw new GuideError(400, 'question_empty', 'A question cannot be empty.');
    const text = edited ?? q.text;
    const kind: GroupKind = q.group.startsWith('h:') ? 'hypothesis' : 'theme';
    added.push({ id: q.id, text, group: groupOf({ kind, ref: q.group }, refs), by: edited !== null && edited !== q.text ? 'me' : 'eadwyn' });
  }
  const next = [...stored, ...added];
  if (next.length > GUIDE_MAX_QUESTIONS) throw new GuideError(400, 'guide_too_long', `A guide holds at most ${GUIDE_MAX_QUESTIONS} questions.`);
  return next;
}

// ---------------------------------------------------------------------------
// The copy on an interview
// ---------------------------------------------------------------------------

export type Copy = { interview_id: number; questions: Question[]; asked: string[]; copied_at: string; guide_version: number | null };

const copyOf = (row: { interview_id: number; questions_json: string; asked_json: string; copied_at: string; guide_version: number | null }): Copy => {
  let asked: string[] = [];
  try { const a = JSON.parse(row.asked_json || '[]'); asked = Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { asked = []; }
  return { interview_id: Number(row.interview_id), questions: parseStored(row.questions_json), asked, copied_at: row.copied_at, guide_version: row.guide_version };
};

export async function interviewOf(env: Env, projectId: number, interviewId: number) {
  const iv = await env.DB.prepare('SELECT id FROM discovery_interviews WHERE id = ? AND project_id = ?').bind(interviewId, projectId).first();
  if (!iv) throw new GuideError(404, 'interview_not_found', 'That interview is not in this venture.');
}

export async function readCopy(env: Env, projectId: number, interviewId: number): Promise<Copy | null> {
  const row = await env.DB.prepare(`SELECT interview_id, questions_json, asked_json, copied_at, guide_version
    FROM interview_guide_copies WHERE project_id = ? AND interview_id = ?`).bind(projectId, interviewId).first<any>();
  return row ? copyOf(row) : null;
}

/** The guide as it stands, copied onto the interview once; a second call answers the first copy. */
export async function copyOnto(env: Env, projectId: number, interviewId: number, userId: number, guide: Guide, defaults: boolean): Promise<Copy> {
  await interviewOf(env, projectId, interviewId);
  const questions: Question[] = guide.questions.length ? guide.questions
    : defaults ? DEFAULT_QUESTIONS.map((text, i) => ({ id: `default${i + 1}`, text, group: { kind: 'default', ref: null }, by: 'default' })) : [];
  await env.DB.prepare(`INSERT INTO interview_guide_copies (project_id, interview_id, questions_json, guide_version, copied_by)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(interview_id) DO NOTHING`)
    .bind(projectId, interviewId, JSON.stringify(questions), guide.version || null, userId).run();
  const copy = await readCopy(env, projectId, interviewId);
  if (!copy) throw new GuideError(404, 'interview_not_found', 'That interview is not in this venture.');
  return copy;
}

/** Mark one question of the copy asked or not; the venture's guide is untouched. */
export async function markAsked(env: Env, projectId: number, interviewId: number, questionId: unknown, asked: unknown): Promise<Copy> {
  const copy = await readCopy(env, projectId, interviewId);
  if (!copy) throw new GuideError(404, 'copy_not_found', 'Open the guide for this interview first.');
  if (typeof questionId !== 'string' || !copy.questions.some((q) => q.id === questionId)) throw new GuideError(400, 'not_in_copy', 'That question is not on this interview\'s guide.');
  if (typeof asked !== 'boolean') throw new GuideError(400, 'asked_required', 'Say whether the question was asked.');
  const next = asked ? [...new Set([...copy.asked, questionId])] : copy.asked.filter((x) => x !== questionId);
  await env.DB.prepare(`UPDATE interview_guide_copies SET asked_json = ?, updated_at = datetime('now') WHERE project_id = ? AND interview_id = ?`)
    .bind(JSON.stringify(next), projectId, interviewId).run();
  return { ...copy, asked: next };
}
