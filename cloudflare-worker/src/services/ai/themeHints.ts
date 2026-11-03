/**
 * #3938 part 6 (D1478 task 4) — the retrieve step of the plan's two theme
 * jobs, GR1 (feedback themes) and VA11 (problem discovery: tag phrases).
 *
 * The plan gives each job two steps: RETRIEVE (embed each item and each theme
 * the founder named with the job's retrieve model, bge-m3, and find each item's
 * nearest themes by cosine), then SYNTH (the fill's writer places items into
 * themes). Until now the presses ran only the writer. This file is the first
 * step: its result is a HINT section added to the writer's facts, never an
 * answer. The writer still chooses, and the fill's parser still accepts only a
 * theme the founder wrote and an item on file, so a hint can never create a
 * theme or move an item that is not there.
 *
 * DEGRADING, NEVER INVENTING. A theme that cannot be embedded drops every hint
 * (a nearest theme out of a partial list is a wrong hint); an item that cannot
 * be embedded gets none. Either way the writer runs on the facts as before. A
 * refusal the member must hear about (assist off, a budget stop, the guard, a
 * plan lock) stops the press, as the match rows do (`matchRows.ts`).
 *
 * Every embedding is the member's press through `run()`: quoted, held, guarded
 * and charged on the fill's page and rail.
 */
import type { Env } from '../../types';
import { run as aiRun, type RunOptions, type RunResult } from '../aiRouter';
import { jobStep } from './modelUseCases';
import { cosine } from './matchRows';
import { runRefusalView } from '../../util/railContext';

export type ThemeJob = 'GR1' | 'VA11';
/** The fill tasks whose job has a retrieve step before its writer. */
export const THEME_JOBS: Readonly<Record<string, ThemeJob>> = Object.freeze({
  grow_theme_feedback: 'GR1',
  validate_tag_pains: 'VA11',
});

export type HintItem = { key: string; text: string };
export type ThemeHintDeps = { embed(text: string): Promise<number[] | null> };
type Charge = Pick<RunOptions, 'userId' | 'surface' | 'rail'>;

/** At most this many items and themes are embedded for one press. */
export const HINT_ITEMS_MAX = 50;
export const HINT_THEMES_MAX = 40;
/** Each item's nearest themes, best first. */
export const HINTS_PER_ITEM = 2;
const TEXT_MAX = 400;

/** The job's retrieve model, from the plan's first step. */
export function retrieveModel(job: ThemeJob): string {
  const step = jobStep(job, 0);
  if (step?.kind !== 'retrieve' || !step.default) throw new Error(`theme job ${job} has no retrieve step`);
  return step.default;
}

/** A refusal the member must hear about: the press stops and the route answers it in its words. */
export class HintRefused extends Error {
  readonly result: RunResult;
  constructor(result: RunResult) { super('hint_refused'); this.result = result; }
}

export function defaultHintDeps(env: Env, charge: Charge, job: ThemeJob): ThemeHintDeps {
  const model = retrieveModel(job);
  return {
    async embed(text) {
      const out = await aiRun(env, { ...charge, rail: charge.rail, surface: charge.surface, task: 'module_embed' as RunOptions['task'], model, text });
      if (!out.ok && runRefusalView(out)) throw new HintRefused(out);
      return out.ok && Array.isArray(out.embedding) && out.embedding.length ? out.embedding : null;
    },
  };
}

/** The seam the route builds its deps through; tests replace `make`. */
export const HINT_DEPS: { make: (env: Env, charge: Charge, job: ThemeJob) => ThemeHintDeps } = { make: defaultHintDeps };

const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);

/**
 * Each item's nearest themes by meaning, best first, or null when the themes
 * could not all be embedded. An item that could not be embedded is left out.
 */
export async function themeHints(themes: string[], items: HintItem[], deps: ThemeHintDeps): Promise<Map<string, string[]> | null> {
  const named = [...new Set(themes.map(clip).filter(Boolean))].slice(0, HINT_THEMES_MAX);
  const pool = items.filter((i) => clip(i.text)).slice(0, HINT_ITEMS_MAX);
  if (!named.length || !pool.length) return null;
  const tv: number[][] = [];
  for (const t of named) {
    const v = await deps.embed(t);
    if (!v) return null;
    tv.push(v);
  }
  const out = new Map<string, string[]>();
  for (const item of pool) {
    const v = await deps.embed(clip(item.text));
    if (!v) continue;
    const scored = named.map((t, i) => ({ t, s: cosine(v, tv[i]) })).filter((x) => Number.isFinite(x.s));
    // A vector of the wrong size scores -Infinity against every theme: no hint, never a guess.
    if (!scored.length) continue;
    scored.sort((a, b) => b.s - a.s || a.t.localeCompare(b.t));
    out.set(item.key, scored.slice(0, HINTS_PER_ITEM).map((x) => x.t));
  }
  return out;
}

/** The hint section the writer reads after the facts, or '' when there is nothing to add. */
export function hintSection(hints: Map<string, string[]> | null): string {
  if (!hints || !hints.size) return '';
  return [
    '',
    'Nearest themes by meaning (a hint from the retrieval step, not an answer; place an item only where a theme clearly fits):',
    ...[...hints].map(([key, t]) => `  ${key} → ${t.join('; ')}`),
  ].join('\n');
}
