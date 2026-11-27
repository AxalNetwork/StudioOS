/**
 * D1559 (#3806, deck v2 C11) — likely investor questions on a deck version.
 *
 *   GET /api/decks/:id/qa?stage=&investor_type=&prospect=   (the venture's founder)
 *       → { deck_id, version, stage, stage_label, investor_type,
 *           prospect: { id, name, firm } | null, prospects: [{ id, name, firm, objections }],
 *           questions: [{ key, rank, kind: 'objection' | 'finding', question, cards,
 *                         heard?, answered_in?, said?, said_held?,          (an objection)
 *                         severity?, code?, card_uid?, card_index?,         (a finding)
 *                         answer: { state, text, bindings, fill },
 *                         kept: { text, note, deck_id, version, by, at, bindings } | null }],
 *           more, reads: { objections, objections_capped, sources, claims, kept, prospects } }
 *
 * Real objections first (Capital relationships' feedback, `narrative/objections.ts`),
 * then the investor critic's free rule findings (D1557, `deck_critic.ts`'s
 * `readAll`). Each answer is bindings to the venture's deck sources (D896), and
 * its words state no figure that a binding does not carry
 * (`services/decks/deckQa.ts`). No model runs; nothing is written.
 *
 * Kept answers are written by `cycle_raise.ts`, beside the objections routes:
 * `PUT`/`DELETE /api/cycles/raise/narrative/questions/:question/answer`
 * (migration 736, `deck_qa_answers`). `deckQa` is the read both use.
 *
 * PER PROSPECT (D1582, #3829). `?prospect=<raise_prospects.id>` ranks that
 * investor's own objections first (`services/decks/deckQa.ts`). The prospect
 * must be one of the deck's venture's, read with `project_id = ?`; any other
 * id, another venture's included, answers 404 `prospect_not_found`, so the
 * read never says whether another venture's prospect exists. `prospects` is
 * the venture's own list for the picker (name and firm, as Capital
 * relationships shows the founder; never an email), with how many objections
 * each raised. Without `prospect` the reply's order is D1559's.
 *
 * Who: the venture's founder, as D900's check (`deck_check.ts`'s `reader`):
 * the answers state the records' figures. D4270: an HQ admin reads too, in
 * their own session; a support session and anyone else the deck admits answer
 * 403 `founder_only`. Mounted in index.ts BEFORE `decks`.
 *
 * WRITTEN ANSWERS (D4270, #4270, D4254 P2c). The founder's own words for a
 * question, and questions the founder adds (`deck_qa_written`, migration
 * 202611031500). The founder's alone: no share, export or public read selects
 * that table, and only the venture's founder writes it.
 *
 *   PUT    /api/decks/:id/qa/answers/:key  { answer, source?: 'ask'|'typed' }
 *          → { question: key, written }
 *          `source: 'ask'` is kept only when `answer` is the question's bound
 *          draft as it reads now (`answer.text`), else 422 `not_the_draft`:
 *          what Ask placed is the bound draft, and an edit makes it the
 *          founder's ('typed').
 *   POST   /api/decks/:id/qa/answers       { question, card?, answer? }
 *          → 201 { question }   a typed question, `typed-<16 hex>`.
 *   DELETE /api/decks/:id/qa/answers/:key  → { question: key, written: null }
 *          A ranked question loses its written answer; a typed one is removed.
 *
 * The read adds, per question, `written` ({ text, source, by, at, deck_id,
 * version } or null) and `answered` (a written answer or a D1559 kept one),
 * the typed questions after the ranked ones (`kind: 'typed'`), and
 * `answered_count` of `total`. `answer` stays D1559's bound draft.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { stageFrom } from '../services/narrative/arcs';
import { readObjections, type Objection } from '../services/narrative/objections';
import { readSources, type SourceItem } from '../services/decks/sources';
import { AUDIENCES } from '../services/decks/slideModel';
import { QUESTION_KEY, rankQuestions, type KeptRow } from '../services/decks/deckQa';
import { isSupportSession } from '../integrations/providers/mercury';
import { ensureSchema, getDeckRow, rowToDeck } from './decks';
import { readAll, type Ask } from './deck_critic';
import { reader } from './deck_check';
import { mercuryFor } from './deck_sources';

const deckQaRoutes = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);

type ReadState = 'ok' | 'unreadable';

/** D1582: the prospects a picker offers, at most this many. */
export const PROSPECTS_MAX = 200;
export type QaProspect = { id: number; name: string | null; firm: string | null };

/** One of the venture's prospects, or null when the id is not the venture's. A failed read throws. */
export async function qaProspect(env: Env, projectId: number, id: number): Promise<QaProspect | null> {
  const p = await env.DB.prepare('SELECT id, name, firm FROM raise_prospects WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ id: number; name: string | null; firm: string | null }>();
  return p ? { id: Number(p.id), name: p.name || null, firm: p.firm || null } : null;
}

/** The venture's prospects, with how many feedback rows each gave, those with objections first. A failed read throws. */
export async function readProspects(env: Env, projectId: number): Promise<Array<QaProspect & { objections: number }>> {
  const res = await env.DB.prepare(
    `SELECT p.id, p.name, p.firm, (SELECT COUNT(*) FROM raise_prospect_feedback f WHERE f.prospect_id = p.id) AS objections
       FROM raise_prospects p
      WHERE p.project_id = ?
      ORDER BY objections DESC, p.name COLLATE NOCASE, p.id
      LIMIT ?`,
  ).bind(projectId, PROSPECTS_MAX).all<{ id: number; name: string | null; firm: string | null; objections: number }>();
  return (res.results || []).map((r) => ({ id: Number(r.id), name: r.name || null, firm: r.firm || null, objections: Number(r.objections) || 0 }));
}

/** The venture's kept answers by question key. A failed read throws. */
export async function readKept(env: Env, projectId: number): Promise<Map<string, KeptRow>> {
  const res = await env.DB.prepare(
    `SELECT a.question_key, a.deck_id, a.version, a.bindings_json, a.note, a.kept_by, u.name, a.kept_at
       FROM deck_qa_answers a LEFT JOIN users u ON u.id = a.kept_by
      WHERE a.project_id = ?`,
  ).bind(projectId).all<KeptRow>();
  return new Map((res.results || []).map((r) => [r.question_key, r]));
}

// ─────────────────────────────────────────────────── D4270: written answers

/** A written answer's longest words, a typed question's, and how many a venture may add. */
export const WRITTEN_MAX = 2000;
export const TYPED_QUESTION_MAX = 400;
export const TYPED_MAX = 40;
export const TYPED_KEY = /^typed-[0-9a-f]{16}$/;
/** A card a typed question relates to: a card kind's slug. */
export const CARD_REF = /^[a-z][a-z_]{0,39}$/;

export type WrittenRow = {
  uid: string; question_key: string; question_text: string | null; card_ref: string | null; answer: string | null;
  source: 'ask' | 'typed'; deck_id: number | null; version: number | null; updated_by: number | null; name: string | null; updated_at: string | null;
};
export type Written = {
  text: string; source: 'ask' | 'typed'; deck_id: number | null; version: number | null;
  by: { id: number; name: string | null } | null; at: string | null;
};

/** The venture's written answers and typed questions by key, oldest first. A failed read throws. */
export async function readWritten(env: Env, projectId: number): Promise<Map<string, WrittenRow>> {
  const res = await env.DB.prepare(
    `SELECT w.uid, w.question_key, w.question_text, w.card_ref, w.answer, w.source, w.deck_id, w.version, w.updated_by, u.name, w.updated_at
       FROM deck_qa_written w LEFT JOIN users u ON u.id = w.updated_by
      WHERE w.project_id = ?
      ORDER BY w.created_at, w.uid`,
  ).bind(projectId).all<WrittenRow>();
  return new Map((res.results || []).map((r) => [r.question_key, r]));
}

/** A row's answer as the read shows it, or null when there are no words. */
export function writtenOf(r: WrittenRow | undefined | null): Written | null {
  if (!r || !r.answer || !String(r.answer).trim()) return null;
  return {
    text: String(r.answer), source: r.source === 'ask' ? 'ask' : 'typed', deck_id: r.deck_id == null ? null : Number(r.deck_id),
    version: r.version == null ? null : Number(r.version),
    by: r.updated_by ? { id: Number(r.updated_by), name: r.name || null } : null, at: r.updated_at ? String(r.updated_at).slice(0, 10) : null,
  };
}

const NO_DRAFT = Object.freeze({ state: 'no_topic' as const, text: null, bindings: [], fill: [] });

/** A typed question as the read lists it. */
export function typedQuestion(r: WrittenRow) {
  return {
    key: r.question_key, rank: 0, kind: 'typed' as const, question: String(r.question_text ?? ''),
    cards: r.card_ref ? [r.card_ref] : [], answer: NO_DRAFT, kept: null,
  };
}

/**
 * D4270: each question with its written answer and whether it is answered,
 * the typed ones after the ranked ones, re-ranked, and the count. A question
 * is answered when the founder wrote an answer or kept one (D1559).
 */
export function withWritten<Q extends { key: string; rank: number; kept?: unknown }>(questions: readonly Q[], written: ReadonlyMap<string, WrittenRow>) {
  const typed = [...written.values()].filter((r) => TYPED_KEY.test(r.question_key)).map(typedQuestion);
  const all = [...questions, ...typed].map((q, i) => {
    const w = writtenOf(written.get(q.key));
    return { ...q, rank: i + 1, written: w, answered: !!w || !!q.kept };
  });
  return { questions: all, answered_count: all.filter((q) => q.answered).length, total: all.length };
}

/**
 * The deck's likely questions, ranked and bound, with the source items they
 * were bound from. Each read stands alone: one that fails says so in `reads`
 * and never reads as "none".
 */
export async function deckQa(c: any, user: User, row: any, opts: { stage?: string | null; investorType?: string | null; prospect?: QaProspect | null } = {}) {
  const projectId = Number(row.project_id);
  const project: { founder_id: number | null; company_id: number | null } | null = await (c.env as Env).DB
    .prepare('SELECT founder_id, company_id FROM projects WHERE id = ?').bind(projectId).first();
  const ask: Ask = {
    deckId: Number(row.id), projectId, deck: rowToDeck(row), row, project: project ?? { founder_id: null, company_id: null },
    investorType: opts.investorType ?? null, stage: opts.stage ?? null,
  };
  const read = await readAll(c, user, ask);

  let objections: Objection[] = [];
  let objectionsRead: ReadState = 'ok';
  let capped = false;
  const prospect = opts.prospect ?? null;
  try { const r = await readObjections(c.env, projectId, prospect ? prospect.id : null); objections = r.items; capped = r.capped; }
  catch (e) { objectionsRead = 'unreadable'; console.warn('[deck_qa] objections unreadable:', (e as Error)?.name); }

  let items: SourceItem[] = [];
  let sources: ReadState = 'ok';
  try { items = (await readSources({ env: c.env, projectId, today: today(), mercury: await mercuryFor(c, user, ask.project) })).items; }
  catch (e) { sources = 'unreadable'; console.warn('[deck_qa] sources unreadable:', (e as Error)?.name); }

  let kept = new Map<string, KeptRow>();
  let keptRead: ReadState = 'ok';
  try { kept = await readKept(c.env, projectId); }
  catch (e) { keptRead = 'unreadable'; console.warn('[deck_qa] kept answers unreadable:', (e as Error)?.name); }

  let prospects: Array<QaProspect & { objections: number }> = [];
  let prospectsRead: ReadState = 'ok';
  try { prospects = await readProspects(c.env, projectId); }
  catch (e) { prospectsRead = 'unreadable'; console.warn('[deck_qa] prospects unreadable:', (e as Error)?.name); }

  let written = new Map<string, WrittenRow>();
  let writtenRead: ReadState = 'ok';
  try { written = await readWritten(c.env, projectId); }
  catch (e) { writtenRead = 'unreadable'; console.warn('[deck_qa] written answers unreadable:', (e as Error)?.name); }

  const ranked = await rankQuestions({ objections, findings: read.findings, deckCards: read.cards, items, kept });
  // D4270: an unreadable written store answers nothing as answered from it, and says so in `reads`.
  const { questions, answered_count, total } = withWritten(ranked.questions, written);
  return {
    body: {
      deck_id: Number(row.id), version: ask.deck.version, stage: read.plan.stage, stage_label: read.plan.stage_label,
      investor_type: read.plan.investor_type, prospect, prospects, questions, more: ranked.more,
      answered_count: writtenRead === 'ok' && keptRead === 'ok' ? answered_count : null, total,
      reads: { objections: objectionsRead, objections_capped: capped, sources, claims: read.claims, kept: keptRead, prospects: prospectsRead, written: writtenRead },
    },
    items,
  };
}

/** The deck row, or null when there is none. */
export async function qaDeckRow(env: Env, id: number): Promise<any | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  await ensureSchema(env);
  try { return await getDeckRow(env, id); } catch { return null; }
}

export const QA_PROSPECT_NOT_FOUND = 'That investor is not one of this venture’s.';

export const QA_FOUNDER_ONLY = 'Only the venture’s founder reads the likely questions: their answers state the records’ figures.';
export const QA_FOUNDER_WRITES = 'Only the venture’s founder writes answers to the likely questions.';

/** D4270: an HQ admin, in their own session, reads the likely questions and their answers. */
async function hqReads(c: any, user: User): Promise<boolean> {
  return String(user.role ?? '').toLowerCase() === 'admin' && !(await isSupportSession(c));
}

/** The deck and its founder, or the refusal. Writes are the founder's alone. */
async function founderDeck(c: any, user: User): Promise<any | Response> {
  const row = await qaDeckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  const who = await reader(c, user, Number(row.project_id));
  if (who instanceof Response) return who;
  if (!who.founder) return refuse(c, 403, { code: 'founder_only', message: QA_FOUNDER_WRITES });
  return row;
}

const words = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};
const newKey = () => `typed-${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const writtenRow = (env: Env, projectId: number, key: string) => env.DB.prepare(
  `SELECT w.uid, w.question_key, w.question_text, w.card_ref, w.answer, w.source, w.deck_id, w.version, w.updated_by, u.name, w.updated_at
     FROM deck_qa_written w LEFT JOIN users u ON u.id = w.updated_by
    WHERE w.project_id = ? AND w.question_key = ?`,
).bind(projectId, key).first<WrittenRow>();

deckQaRoutes.get('/:id{[0-9]+}/qa', async (c) => {
  const user = await requireAuth(c);
  const stage = c.req.query('stage') || null;
  if (stage && !stageFrom(stage)) return refuse(c, 400, { code: 'invalid_stage', message: 'stage must be one of pre_seed, seed, series_a, series_b_plus' });
  const investorType = c.req.query('investor_type') || null;
  if (investorType && !(AUDIENCES as readonly string[]).includes(investorType)) {
    return refuse(c, 400, { code: 'invalid_investor_type', message: `investor_type must be one of ${AUDIENCES.join(', ')}` });
  }
  const prospectRaw = c.req.query('prospect') || null;
  const prospectId = prospectRaw === null ? null : /^[1-9][0-9]{0,15}$/.test(prospectRaw) ? Number(prospectRaw) : NaN;
  if (prospectId !== null && !Number.isSafeInteger(prospectId)) return refuse(c, 400, { code: 'invalid_prospect', message: 'prospect must be the id of one of this venture’s investors' });
  const row = await qaDeckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  const who = await reader(c, user, Number(row.project_id));
  if (who instanceof Response) return who;
  if (!who.founder && !(await hqReads(c, user))) return refuse(c, 403, { code: 'founder_only', message: QA_FOUNDER_ONLY });
  // D1582: checked after the founder gate, so no one else learns which prospects exist.
  let prospect: QaProspect | null = null;
  if (prospectId !== null) {
    prospect = await qaProspect(c.env, Number(row.project_id), prospectId);
    if (!prospect) return refuse(c, 404, { code: 'prospect_not_found', message: QA_PROSPECT_NOT_FOUND });
  }
  return c.json((await deckQa(c, user, row, { stage, investorType, prospect })).body);
});

// ─────────────────────────────────────────────────── D4270: the writes

deckQaRoutes.put('/:id{[0-9]+}/qa/answers/:key', async (c) => {
  const user = await requireAuth(c);
  const key = c.req.param('key');
  if (!QUESTION_KEY.test(key) && !TYPED_KEY.test(key)) return refuse(c, 400, { code: 'invalid_question', message: 'That is not one of the likely questions.' });
  const body = await c.req.json().catch(() => null) as any;
  const answer = words(body?.answer, WRITTEN_MAX);
  if (!answer) return refuse(c, 400, { code: 'invalid_answer', message: `Write an answer, at most ${WRITTEN_MAX.toLocaleString('en-US')} characters.` });
  const source = body?.source === undefined ? 'typed' : body.source;
  if (source !== 'ask' && source !== 'typed') return refuse(c, 400, { code: 'invalid_source', message: 'An answer is placed by Ask or typed.' });
  const row = await founderDeck(c, user);
  if (row instanceof Response) return row;
  const projectId = Number(row.project_id);
  const deckId = Number(row.id);
  const version = Number(row.version) || null;
  const uid = Number(user.id);

  if (TYPED_KEY.test(key)) {
    // A typed question has no bound draft, so nothing of it is Ask's.
    if (source === 'ask') return refuse(c, 422, { code: 'not_the_draft', message: 'Ask has no draft for a question you added. Save it as your own words.' });
    const done = await c.env.DB.prepare(
      `UPDATE deck_qa_written SET answer = ?, source = 'typed', deck_id = ?, version = ?, updated_by = ?, updated_at = datetime('now')
        WHERE project_id = ? AND question_key = ?`,
    ).bind(answer, deckId, version, uid, projectId, key).run();
    if (!done.meta?.changes) return refuse(c, 404, { code: 'question_not_found', message: 'That question is not one of this venture’s.' });
  } else {
    // A ranked question is one this deck asks now; its words are copied, so the answer stays legible.
    const { body: read } = await deckQa(c, user, row);
    const q = (read.questions as any[]).find((x) => x.key === key && x.kind !== 'typed');
    if (!q) return refuse(c, 404, { code: 'question_not_found', message: 'That question is not one this deck is asked now.' });
    if (source === 'ask' && answer !== String(q.answer?.text ?? '').trim()) {
      return refuse(c, 422, { code: 'not_the_draft', message: 'That is not the draft Ask placed. Save it as your own words.' });
    }
    await c.env.DB.prepare(
      `INSERT INTO deck_qa_written (uid, project_id, deck_id, version, question_key, question_text, card_ref, answer, source, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, question_key) DO UPDATE SET
         answer = excluded.answer, source = excluded.source, question_text = excluded.question_text, card_ref = excluded.card_ref,
         deck_id = excluded.deck_id, version = excluded.version, updated_by = excluded.updated_by, updated_at = datetime('now')`,
    ).bind(crypto.randomUUID(), projectId, deckId, version, key, String(q.question).slice(0, TYPED_QUESTION_MAX), q.cards?.[0] ?? null,
      answer, source, uid, uid).run();
  }
  return c.json({ question: key, written: writtenOf(await writtenRow(c.env, projectId, key)) });
});

deckQaRoutes.post('/:id{[0-9]+}/qa/answers', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null) as any;
  const question = words(body?.question, TYPED_QUESTION_MAX);
  if (!question) return refuse(c, 400, { code: 'invalid_question', message: `Write the question, at most ${TYPED_QUESTION_MAX} characters.` });
  const card = body?.card == null || body.card === '' ? null : typeof body.card === 'string' && CARD_REF.test(body.card) ? body.card : undefined;
  if (card === undefined) return refuse(c, 400, { code: 'invalid_card', message: 'Name the card by its kind, or leave it out.' });
  const answer = body?.answer == null || body.answer === '' ? null : words(body.answer, WRITTEN_MAX);
  if (answer === null && body?.answer != null && body.answer !== '') return refuse(c, 400, { code: 'invalid_answer', message: `An answer is at most ${WRITTEN_MAX.toLocaleString('en-US')} characters.` });
  const row = await founderDeck(c, user);
  if (row instanceof Response) return row;
  const projectId = Number(row.project_id);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM deck_qa_written WHERE project_id = ? AND question_key GLOB 'typed-*'")
    .bind(projectId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= TYPED_MAX) return refuse(c, 409, { code: 'too_many_questions', message: `A venture adds at most ${TYPED_MAX} questions of its own. Remove one first.` });
  const key = newKey();
  await c.env.DB.prepare(
    `INSERT INTO deck_qa_written (uid, project_id, deck_id, version, question_key, question_text, card_ref, answer, source, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'typed', ?, ?)`,
  ).bind(crypto.randomUUID(), projectId, Number(row.id), Number(row.version) || null, key, question, card, answer, Number(user.id), Number(user.id)).run();
  const r = await writtenRow(c.env, projectId, key);
  return c.json({ question: r ? { ...typedQuestion(r), written: writtenOf(r), answered: !!writtenOf(r) } : null }, 201);
});

deckQaRoutes.delete('/:id{[0-9]+}/qa/answers/:key', async (c) => {
  const user = await requireAuth(c);
  const key = c.req.param('key');
  if (!QUESTION_KEY.test(key) && !TYPED_KEY.test(key)) return refuse(c, 400, { code: 'invalid_question', message: 'That is not one of the likely questions.' });
  const row = await founderDeck(c, user);
  if (row instanceof Response) return row;
  const done = await c.env.DB.prepare('DELETE FROM deck_qa_written WHERE project_id = ? AND question_key = ?').bind(Number(row.project_id), key).run();
  if (!done.meta?.changes) return refuse(c, 404, { code: 'question_not_found', message: 'There is no written answer to remove.' });
  return c.json({ question: key, written: null });
});

export default deckQaRoutes;
