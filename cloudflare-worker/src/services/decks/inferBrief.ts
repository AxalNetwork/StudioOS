/**
 * D1599 (#3877): New deck's brief, inferred from the venture's own records.
 *
 * Pure code, no model: the venture's stage (`projects.stage`) and its active
 * round (`raise_rounds` and the latest `round_calls.instrument`, as
 * `activeRound()` in routes/deck_new.ts reads them) pick the audience and the
 * length New deck pre-sets, with one plain sentence saying why.
 *
 * - The rules are one table, `BRIEF_RULES`, read top to bottom; the first that
 *   matches wins.
 * - A round target that is missing or 0 is not an amount: `round.amount` is
 *   null, never 0.
 * - Nothing matched is the standard seed deck, and says so.
 */
import type { Audience, Length } from './newDeck';

export type BriefStage = 'pre_seed' | 'seed' | 'series_a' | 'later';
export type InferredBrief = {
  stage: BriefStage | null;
  audience: Audience;
  length: Length;
  round: { amount: number | null; instrument: string | null } | null;
  why: string;
};
/** The active round as `activeRound()` reads it; only these two fields are used. */
export type ActiveRound = { target_amount: number | null; instrument: string | null };

/** A priced round at or above this target is a Series A round. */
export const SERIES_A_MIN = 3_000_000;
/** A SAFE or note below this target is a pre-seed round. */
export const PRE_SEED_SAFE_MAX = 1_000_000;

/** `projects.stage` holds lifecycle words (idea … grow) or, from older records, funding words. */
export function stageOf(projectStage: string | null | undefined): BriefStage | 'early' | null {
  const s = String(projectStage ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return null;
  if (s === 'series_a') return 'series_a';
  if (s === 'seed') return 'seed';
  if (s === 'pre_seed' || s === 'preseed') return 'pre_seed';
  if (/^series_[b-z]$/.test(s) || s === 'growth' || s === 'later') return 'later';
  // D564's lifecycle: before Build there is nothing to raise on but the idea and the evidence.
  if (s === 'idea' || s === 'validate') return 'early';
  return null;
}

type Ctx = { stage: ReturnType<typeof stageOf>; amount: number | null; instrument: string | null; hasRound: boolean };
const priced = (c: Ctx) => c.instrument === 'equity';
const convertible = (c: Ctx) => c.instrument === 'safe' || c.instrument === 'convertible_note';
const early = (c: Ctx) => c.stage === 'pre_seed' || c.stage === 'early';
const instrumentWord = (i: string | null) => (i === 'equity' ? 'priced' : i === 'safe' ? 'on a SAFE' : i === 'convertible_note' ? 'on a convertible note' : null);

export type BriefRule = {
  id: string;
  when: (c: Ctx) => boolean;
  stage: BriefStage;
  audience: Audience;
  length: Length;
  why: (c: Ctx) => string;
};

/** Read top to bottom; the first rule that matches wins. */
export const BRIEF_RULES: readonly BriefRule[] = [
  {
    id: 'series_a', stage: 'series_a', audience: 'series_a_fund', length: 'standard',
    when: (c) => (priced(c) && c.amount != null && c.amount >= SERIES_A_MIN) || c.stage === 'series_a',
    why: (c) => (priced(c) && c.amount != null && c.amount >= SERIES_A_MIN ? 'Series A round, priced: Series A funds.' : 'Series A stage: Series A funds.'),
  },
  {
    id: 'seed', stage: 'seed', audience: 'seed_fund', length: 'standard',
    when: (c) => (priced(c) && c.amount != null && c.amount < SERIES_A_MIN) || c.stage === 'seed',
    why: (c) => (priced(c) && c.amount != null ? 'Seed round, priced: seed funds.' : 'Seed stage: seed funds.'),
  },
  {
    id: 'angel', stage: 'pre_seed', audience: 'angel', length: 'short',
    when: (c) => !c.hasRound && early(c),
    why: () => 'No active round: a short deck for angels.',
  },
  {
    id: 'pre_seed', stage: 'pre_seed', audience: 'pre_seed_fund', length: 'short',
    when: (c) => (convertible(c) && c.amount != null && c.amount < PRE_SEED_SAFE_MAX) || early(c),
    why: (c) => (convertible(c) && c.amount != null && c.amount < PRE_SEED_SAFE_MAX
      ? `Pre-seed round ${instrumentWord(c.instrument)}: a short deck for pre-seed funds.`
      : 'Early stage: a short deck for pre-seed funds.'),
  },
];

/** What nothing matched: the standard seed deck. */
export const BRIEF_FALLBACK = { audience: 'seed_fund' as Audience, length: 'standard' as Length, why: 'Not enough recorded to infer; the standard seed deck.' };

export function inferBrief(input: { projectStage: string | null; round: ActiveRound | null }): InferredBrief {
  const raw = input.round?.target_amount;
  const amount = raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  const instrument = input.round?.instrument ?? null;
  const ctx: Ctx = { stage: stageOf(input.projectStage), amount, instrument, hasRound: input.round != null };
  const round = input.round ? { amount, instrument } : null;
  const rule = BRIEF_RULES.find((r) => r.when(ctx));
  if (rule) return { stage: rule.stage, audience: rule.audience, length: rule.length, round, why: rule.why(ctx) };
  const stage = ctx.stage === 'early' ? 'pre_seed' : ctx.stage;
  return { stage, audience: BRIEF_FALLBACK.audience, length: BRIEF_FALLBACK.length, round, why: BRIEF_FALLBACK.why };
}
