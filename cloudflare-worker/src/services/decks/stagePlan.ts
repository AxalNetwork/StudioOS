/**
 * D1522 (#3774) — the stage plan of one deck, read from the venture's records.
 *
 * `stagePlan(env, …)` is the service the route `GET /api/decks/:id/stage-plan`
 * answers with, and the one the one-click run (#3768, AUTO-1) calls with no UI
 * press to order its outline and apply `cutUnproven`.
 *
 * deck.stage is read, not stored (no migration): the stage asked for, else the
 * one the deck's audience implies, else the venture's `projects.stage`, else
 * seed, the standard deck — and `stage_source` says which.
 *
 * Each read stands alone: deck sources, pinned evidence and the investors'
 * objections. One that cannot be read makes its part "unreadable"; it never
 * reads as "no proof".
 */
import type { Env } from '../../types';
import { AUDIENCES } from './slideModel';
import type { Audience } from './newDeck';
import { readSources, type SourceCtx, type SourceItem } from './sources';
import { pinnedItems } from '../raiseClaims';
import { EVIDENCE_RULES } from '../raiseEvidenceSources';
import { readObjections } from '../narrative/objections';
import { AUDIENCE_STAGE, UNCHECKED_LINE, cardOfSlide, planFor, stageFrom, type Plan, type Stage } from '../narrative/arcs';

export type StageSource = 'asked' | 'audience' | 'venture' | 'default';
export type StagePlan = Plan & {
  stage_source: StageSource;
  sources: 'ok' | 'unreadable';
  evidence: 'ok' | 'unreadable';
  /** The investors' objections the venture has not answered yet, most heard first (`objections.ts`). */
  objections: { state: 'ok' | 'unreadable'; unanswered: Array<{ text: string; count: number }> };
};

export const OBJECTIONS_SHOWN = 3;

/** The deck's stage and where it came from. */
export function deckStage(asked: unknown, audience: unknown, projectStage: unknown): { stage: Stage; source: StageSource } {
  const a = stageFrom(asked);
  if (a) return { stage: a, source: 'asked' };
  const fromAudience = AUDIENCES.includes(audience as Audience) ? AUDIENCE_STAGE[audience as Audience] : undefined;
  if (fromAudience) return { stage: fromAudience, source: 'audience' };
  const v = stageFrom(projectStage);
  if (v) return { stage: v, source: 'venture' };
  return { stage: 'seed', source: 'default' };
}

/** What the venture's pinned evidence backs (`EVIDENCE_RULES[].backs` by item kind). */
export function backsOf(kinds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const k of kinds) for (const b of EVIDENCE_RULES.find((r) => r.kind === k)?.backs ?? []) out.add(b);
  return out;
}

export async function stagePlan(env: Env, input: {
  projectId: number; slides: unknown; audience: unknown; stage?: unknown; investorType?: unknown;
  mercury: SourceCtx['mercury']; today: string;
}): Promise<StagePlan> {
  const project = await env.DB.prepare('SELECT stage FROM projects WHERE id = ?').bind(input.projectId).first<{ stage: string | null }>().catch(() => null);
  const { stage, source } = deckStage(input.stage, input.audience, project?.stage);
  const investorType = AUDIENCES.includes(input.investorType as Audience) ? input.investorType as Audience
    : AUDIENCES.includes(input.audience as Audience) ? input.audience as Audience : null;

  let items: SourceItem[] = [];
  let sources: 'ok' | 'unreadable' = 'ok';
  try { items = (await readSources({ env, projectId: input.projectId, today: input.today, mercury: input.mercury })).items; }
  catch (e) { sources = 'unreadable'; console.warn('[stage-plan] sources unreadable:', (e as Error)?.name); }

  let pinned = new Set<string>();
  let evidence: 'ok' | 'unreadable' = 'ok';
  try { pinned = backsOf((await pinnedItems(env, input.projectId)).map((i) => i.kind)); }
  catch (e) { evidence = 'unreadable'; console.warn('[stage-plan] evidence unreadable:', (e as Error)?.name); }

  let objections: StagePlan['objections'] = { state: 'ok', unanswered: [] };
  try {
    const read = await readObjections(env, input.projectId);
    objections.unanswered = read.items.filter((o) => !o.answered && !o.answer).slice(0, OBJECTIONS_SHOWN).map((o) => ({ text: o.text, count: o.count }));
  } catch (e) { objections = { state: 'unreadable', unanswered: [] }; console.warn('[stage-plan] objections unreadable:', (e as Error)?.name); }

  const cards = (Array.isArray(input.slides) ? input.slides : []).map(cardOfSlide);
  // With no source read at all, nothing can be called missing: every slot reads unreadable.
  const readItems = sources === 'ok' ? items : [];
  const plan = planFor({ stage, investorType, cards, items: readItems, pinnedBacks: pinned });
  if (sources === 'unreadable') {
    for (const r of plan.order) if (r.proof === 'missing') r.proof = 'unchecked';
    plan.warnings = plan.warnings.map((w) => (w.code === 'missing_proof'
      ? { ...w, code: 'unchecked_proof' as const, message: `${plan.order.find((r) => r.card === w.card)!.title}: ${UNCHECKED_LINE}`, action: 'Open its sources' }
      : w));
  }
  return { ...plan, stage_source: source, sources, evidence, objections };
}
