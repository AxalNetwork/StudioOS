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
 * Who: the venture's founder alone, as D900's check (`deck_check.ts`'s
 * `reader`): the answers state the records' figures. Anyone else the deck
 * admits answers 403 `founder_only`. Mounted in index.ts BEFORE `decks`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { stageFrom } from '../services/narrative/arcs';
import { readObjections, type Objection } from '../services/narrative/objections';
import { readSources, type SourceItem } from '../services/decks/sources';
import { AUDIENCES } from '../services/decks/slideModel';
import { rankQuestions, type KeptRow } from '../services/decks/deckQa';
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

  const { questions, more } = await rankQuestions({ objections, findings: read.findings, deckCards: read.cards, items, kept });
  return {
    body: {
      deck_id: Number(row.id), version: ask.deck.version, stage: read.plan.stage, stage_label: read.plan.stage_label,
      investor_type: read.plan.investor_type, prospect, prospects, questions, more,
      reads: { objections: objectionsRead, objections_capped: capped, sources, claims: read.claims, kept: keptRead, prospects: prospectsRead },
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
  if (!who.founder) return refuse(c, 403, { code: 'founder_only', message: QA_FOUNDER_ONLY });
  // D1582: checked after the founder gate, so no one else learns which prospects exist.
  let prospect: QaProspect | null = null;
  if (prospectId !== null) {
    prospect = await qaProspect(c.env, Number(row.project_id), prospectId);
    if (!prospect) return refuse(c, 404, { code: 'prospect_not_found', message: QA_PROSPECT_NOT_FOUND });
  }
  return c.json((await deckQa(c, user, row, { stage, investorType, prospect })).body);
});

export default deckQaRoutes;
