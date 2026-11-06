/**
 * D1525 (#3783, deck v2 B7) — rank an area's variants, mounted at `/api/decks`.
 *
 *   POST /api/decks/areas/:uid/judge/quote   → { ai: true, hold_microusd, model_label, family, writer_families, of }
 *                                              | { ai: false, reason, message }   (runs nothing)
 *   POST /api/decks/areas/:uid/judge         → { proposal_uid, ranked: true, model_label, family, writer_families,
 *                                                ranking: [{ n, rank, probability, line }], best, of, score, clears,
 *                                                panel: { best, agrees, line }, charged_microusd }
 *                                              | { proposal_uid, ranked: false, reason, message, charged_microusd }
 *
 * `:uid` is one of #3764's `deck_area_proposals`. Who: the deck's writers
 * (`projectOwned` with write); a proposal that does not exist, or whose deck
 * the member may not write, is 404, so a uid tells a stranger nothing. Only a
 * proposal still open (`ready`) is ranked. Ranking accepts nothing.
 *
 * The client never sends a model. The judge is the first of the `decide`
 * kind's models (#3721's table, `services/decks/judge.ts`) whose family is
 * none of the models that wrote the variants; the writers are read from the
 * run's own steps. Clef is billed on input tokens only, and the hold says so
 * (`holdQuoteMicro`). What a run charged is read from its usage row; when
 * that is not recorded the reply says null, never 0.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../services/decks/access';
import { refuse } from '../util/refusal';
import { quoteRun } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { decide } from '../services/ai/decide';
import { modelLabel } from '../services/decks/genRuntime';
import { familyOf } from '../services/decks/critic';
import type { ProposalRow, Variant } from '../services/decks/areas';
import { gridJudge, judgeArea, judgeCandidates, judgeModelFor, rankedLine, REFUSALS, type JudgeInput } from '../services/decks/judge';
import type { RouteMount } from '../util/routeRegistry';

const deckJudge = new Hono<{ Bindings: Env }>();
const UID = '{[0-9a-f-]{36}}';

type Area = { row: ProposalRow; variants: Variant[]; input: JudgeInput; generators: string[] };

const parse = (s: string | null | undefined): any => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };

async function areaOf(c: any): Promise<{ user: { id: number }; area: Area } | Response> {
  const user = await requireAuth(c);
  const uid = c.req.param('uid');
  const row = (await c.env.DB.prepare('SELECT * FROM deck_area_proposals WHERE uid = ?1').bind(uid).first()) as ProposalRow | null;
  const notFound = () => refuse(c, 404, { code: 'proposal_not_found', message: 'That proposal is not available.' });
  if (!row) return notFound();
  try { await projectOwned(c, user, Number(row.project_id), { write: true }); } catch { return notFound(); }
  if (row.state !== 'ready') return refuse(c, 409, { code: 'not_open', message: row.state === 'running' ? 'This area is still generating.' : 'This proposal was already decided or has expired.' });
  const variants = (parse(row.variants_json) ?? []) as Variant[];
  const steps = row.batch_uid
    ? ((await c.env.DB.prepare(`SELECT model, model_used FROM deck_area_batch_steps WHERE batch_uid = ?1 AND card_uid = ?2 AND area_id = ?3 AND state = 'done'`)
      .bind(row.batch_uid, row.card_uid, row.area_id).all()).results ?? []) as { model: string | null; model_used: string | null }[]
    : [];
  const generators = [...new Set(steps.map((s: any) => s.model_used ?? s.model).filter(Boolean))] as string[];
  const payload = parse(row.payload_json) ?? {};
  return {
    user: { id: Number(user.id) || 0 },
    area: { row, variants, generators, input: { element: row.element, source: typeof payload.source === 'string' ? payload.source : null, variants, seed: row.uid } },
  };
}

const charge = (userId: number, row: ProposalRow) => ({ userId, surface: AI_SURFACE.raisePitch, rail: undefined, guardText: undefined, recordRef: `deck_area_proposal:${row.uid}` } as any);

async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ?1 AND user_id = ?2').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

const writerFamilies = (generators: string[]) => [...new Set(generators.map(familyOf))];

deckJudge.post(`/areas/:uid${UID}/judge/quote`, async (c) => {
  const got = await areaOf(c);
  if (got instanceof Response) return got;
  const { area, user } = got;
  const pick = judgeModelFor(judgeCandidates(), area.generators);
  if ('refusal' in pick) return c.json({ ai: false, reason: pick.refusal.code, message: pick.refusal.message, writer_families: writerFamilies(area.generators) });
  const q = gridJudge(area.input);
  if (!q) return c.json({ ai: false, reason: 'nothing_to_rank', message: REFUSALS.nothing_to_rank });
  const quote = await quoteRun(c.env, {
    task: 'module_decision', model: pick.model, ...charge(user.id, area.row),
    specialist: { operation: 'decision', questions: { [q.key]: { type: 'choice', instructions: q.instructions, criteria: q.options } } }, text: q.text,
  });
  if (!quote.ok) return c.json({ ai: false, reason: quote.refusal, message: quote.error });
  return c.json({ ai: true, hold_microusd: quote.hold_microusd, model_label: modelLabel(quote.model), family: familyOf(quote.model), writer_families: writerFamilies(area.generators), of: Object.keys(q.labels).length });
});

deckJudge.post(`/areas/:uid${UID}/judge`, async (c) => {
  const got = await areaOf(c);
  if (got instanceof Response) return got;
  const { area, user } = got;
  let usageLogId: number | null = null;
  const out = await judgeArea({
    // The route's run is its own hold; AUTO-5 passes its per-judge hold and what is left of its quote.
    decide: async (q) => {
      const d = await decide(c.env, charge(user.id, area.row), { model: q.model, key: q.key, instructions: q.instructions, options: q.options, text: q.text });
      if (d.ok) usageLogId = d.usageLogId ?? null;
      return d;
    },
  }, { ...area.input, generators: area.generators });
  const charged = await chargedOf(c.env, usageLogId, user.id);
  const base = { proposal_uid: area.row.uid, writer_families: writerFamilies(area.generators), charged_microusd: charged };
  if (out.state === 'refused') {
    // The judge's own refusals are an answer (`ranked: false`); one the router gave (an allowance, a model) is refused as such.
    if (!(out.refusal.code in REFUSALS)) return refuse(c, 422, { code: out.refusal.code, message: out.refusal.message });
    return c.json({ ...base, ranked: false, reason: out.refusal.code, message: out.refusal.message, ...(out.model ? { model_label: modelLabel(out.model), family: familyOf(out.model) } : {}) });
  }
  const j = out.judgement;
  return c.json({
    ...base, ranked: true, model_label: modelLabel(out.model), family: familyOf(out.model),
    ranking: j.ranking.map((r) => ({ ...r, line: rankedLine(r.rank, j.of) })), best: j.best, of: j.of, score: j.score, clears: j.clears, panel: j.panel,
  });
});

export const mount: RouteMount = { path: '/api/decks', router: deckJudge };
export default deckJudge;
