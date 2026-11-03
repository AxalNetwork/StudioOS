/**
 * D4121 (#4121, Roster R5 of #4116) — what an agent's runs cost, skill by skill.
 *
 * A RUN CARRIES ONE SKILL (D1612 part D, #3954, `agentRun.ts`): a run that
 * names a skill adds that skill's prompt (`skillPrompt`, its purpose, steps and
 * allow-list) to the system prompt, and a run that names none adds nothing.
 * So a skill costs its tokens on each run that uses it, and having more skills
 * does not make any one run dearer. The owner chose this model (2026-11-03,
 * option "Follow #3954's runs") over the issue's first sketch, where every
 * pinned skill joined every run.
 *
 * THE ESTIMATE, for the agent's model:
 *   a run      = the agent's system prompt (`agentRun.ts`'s own, for its first
 *                module) + a typical request (`RUN_COST_CONFIG.requestTokens`)
 *                + the one skill it uses (`context_tokens`, none for a run
 *                without a skill), in; a typical proposal
 *                (`RUN_COST_CONFIG.outputTokens`), out
 *   baseline   = a run with no skill
 *   runs       = a run with each of its skills
 *   tokens_per_run / est_usd_per_run = the dearest of those: what a run can cost
 *   cheapest   = the cheapest of them
 *   monthly_at_cap = how many of the dearest runs the monthly cap pays for
 * Prices are the offered-model catalogue's at what the sponsor pays
 * (`memberChargeMultiplier`). Every token figure is the AI budget's estimate
 * (`estTokens`). When the price or a skill cannot be read the answer is
 * `{ available: false }`, never a 0.
 *
 * THE SPECIALIST HINT is about breadth, not cost: more than
 * `specialistMaxSkills` skills names the area with the most of them, how many
 * areas they span, and an offered persona not on the team whose natural fit is
 * that area, if there is one.
 */
import type { Env } from '../../types';
import { estTokens } from '../ai/shapes';
import { modelById, providerModelById } from '../ai/catalogue';
import { billedMicro, usdRatesBilledMicro } from '../ai/pricing';
import { memberChargeMultiplier } from '../aiBudget';
import { RADAR_AXES } from '../skillsTaxonomySchema';
import { PERSONAS, type AreaKey } from './personas';
import { loadPersonaSettings, statusOf } from './rosterAdmin';
import { skillPrompt } from './skillEval';
import type { VersionRow } from './skillLinks';

/** The typical sizes and the threshold the estimate uses: one place to change them. */
export const RUN_COST_CONFIG = Object.freeze({
  /** A typical request a person sends an agent, in tokens. */
  requestTokens: 400,
  /** A typical proposal an agent writes back, in tokens. */
  outputTokens: 800,
  /** More skills than this and the hint suggests a specialist. */
  specialistMaxSkills: 6,
});

/** What the version adds to a run that uses it: its prompt, exactly as `agentRun.ts` joins it, by the AI budget's estimate. */
export const contextTokensOf = (v: Pick<VersionRow, 'version' | 'name' | 'purpose' | 'steps_json' | 'allowed_tools_json' | 'output_kind' | 'roles_json'>): number =>
  estTokens(`\n\n${skillPrompt(v as VersionRow)}`);

/** The radar axis slug (`skillsTaxonomySchema` RADAR_AXES) → the persona area (`personas.ts` AREAS). */
const AXIS_AREA: Readonly<Record<string, AreaKey>> = Object.freeze({
  product: 'product', engineering: 'engineering', design: 'design', gtm_sales: 'gtm',
  marketing_brand: 'marketing', finance_ops: 'finance', legal_compliance: 'legal', capital_network: 'capital',
});
const AXIS_ORDER: readonly string[] = RADAR_AXES.map((a) => a.slug);

export type Pin = { skill_id: number; version: number };
export type RunFigure = { tokens_per_run: number; est_usd_per_run: number };
export type Estimate =
  | { available: false; reason: 'pricing_unreadable' | 'skills_unreadable' }
  | {
    available: true; skills: number; tokens_per_run: number; est_usd_per_run: number; monthly_at_cap: number | null;
    baseline: RunFigure; cheapest: RunFigure; runs: Array<RunFigure & { skill_id: number }>;
  };

/** Each pinned version's `context_tokens` (stored, else worked out from the version), or null when any cannot be read. */
export async function pinTokens(env: Env, pins: readonly Pin[]): Promise<number[] | null> {
  if (!pins.length) return [];
  try {
    const rs = await env.DB.prepare(
      `SELECT v.*, c.context_tokens
         FROM agent_skill_versions v LEFT JOIN agent_skill_version_costs c ON c.skill_id = v.skill_id AND c.version = v.version
        WHERE v.skill_id || ':' || v.version IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(pins.map((p) => `${p.skill_id}:${p.version}`))).all<any>();
    const by = new Map((rs.results ?? []).map((r) => [`${r.skill_id}:${r.version}`, r.context_tokens == null ? contextTokensOf(r) : Number(r.context_tokens)]));
    const out: number[] = [];
    for (const p of pins) { const t = by.get(`${p.skill_id}:${p.version}`); if (t == null) return null; out.push(t); }
    return out;
  } catch { return null; }
}

/** The price of a run of `tokensIn` in and `tokensOut` out on `model`, at `multiplier`, in micro-USD; null when it cannot be priced. */
export function priceMicro(model: string, tokensIn: number, tokensOut: number, multiplier: number): number | null {
  try {
    if (modelById(model)) return billedMicro(model, { tokens_in: tokensIn, tokens_out: tokensOut }, multiplier);
    const p = providerModelById(model);
    if (p) return usdRatesBilledMicro(p.rates, { tokens_in: tokensIn, tokens_out: tokensOut }, multiplier);
    return null;
  } catch { return null; }
}

export type EstimateInput = {
  model: string;
  sponsorId: number;
  /** The agent's system prompt as its runs send it. */
  systemPrompt: string;
  /** The monthly cap, in micro-USD, or null for an agent not yet added. */
  capMicro: number | null;
  pins: readonly Pin[];
};

/** One estimate over the agent's skills: a run with none, a run with each, and the dearest. */
export async function estimate(env: Env, i: EstimateInput, multiplier?: number): Promise<Estimate> {
  const tokens = await pinTokens(env, i.pins);
  if (!tokens) return { available: false, reason: 'skills_unreadable' };
  let mult = multiplier;
  if (mult == null) { try { mult = await memberChargeMultiplier(env, i.sponsorId); } catch { return { available: false, reason: 'pricing_unreadable' }; } }
  const base = estTokens(i.systemPrompt) + RUN_COST_CONFIG.requestTokens;
  const figure = (skillTokens: number): RunFigure | null => {
    const micro = priceMicro(i.model, base + skillTokens, RUN_COST_CONFIG.outputTokens, mult!);
    if (micro == null || !Number.isFinite(micro)) return null;
    return { tokens_per_run: base + skillTokens + RUN_COST_CONFIG.outputTokens, est_usd_per_run: micro / 1_000_000 };
  };
  const baseline = figure(0);
  if (!baseline) return { available: false, reason: 'pricing_unreadable' };
  const runs: Array<RunFigure & { skill_id: number }> = [];
  for (let k = 0; k < i.pins.length; k += 1) {
    const f = figure(tokens[k]);
    if (!f) return { available: false, reason: 'pricing_unreadable' };
    runs.push({ skill_id: i.pins[k].skill_id, ...f });
  }
  const all = runs.length ? runs : [baseline];
  const dearest = all.reduce((a, b) => (b.est_usd_per_run > a.est_usd_per_run || (b.est_usd_per_run === a.est_usd_per_run && b.tokens_per_run > a.tokens_per_run) ? b : a));
  const cheapest = all.reduce((a, b) => (b.est_usd_per_run < a.est_usd_per_run || (b.est_usd_per_run === a.est_usd_per_run && b.tokens_per_run < a.tokens_per_run) ? b : a));
  const dearMicro = dearest.est_usd_per_run * 1_000_000;
  return {
    available: true,
    skills: i.pins.length,
    tokens_per_run: dearest.tokens_per_run,
    est_usd_per_run: dearest.est_usd_per_run,
    monthly_at_cap: i.capMicro != null && dearMicro > 0 ? Math.floor(i.capMicro / dearMicro) : null,
    baseline,
    cheapest: { tokens_per_run: cheapest.tokens_per_run, est_usd_per_run: cheapest.est_usd_per_run },
    runs,
  };
}

/**
 * SK3 (#4224's `run_cost_change_microusd`): what a run with this skill costs
 * the agent over a run with none, on the agent's model at its sponsor's
 * price, in micro-USD; null when the price or the skill cannot be read.
 */
export async function skillRunChangeMicro(env: Env, i: Omit<EstimateInput, 'pins' | 'capMicro'>, pin: Pin, multiplier?: number): Promise<number | null> {
  const tokens = await pinTokens(env, [pin]);
  if (!tokens) return null;
  let mult = multiplier;
  if (mult == null) { try { mult = await memberChargeMultiplier(env, i.sponsorId); } catch { return null; } }
  const base = estTokens(i.systemPrompt) + RUN_COST_CONFIG.requestTokens;
  const without = priceMicro(i.model, base, RUN_COST_CONFIG.outputTokens, mult);
  const withIt = priceMicro(i.model, base + tokens[0], RUN_COST_CONFIG.outputTokens, mult);
  return without == null || withIt == null ? null : withIt - without;
}

/** The areas these skills' tags fall in, most skills first (ties in the radar's order). */
export async function skillAreas(env: Env, skillIds: readonly number[]): Promise<AreaKey[] | null> {
  if (!skillIds.length) return [];
  try {
    const rs = await env.DB.prepare(
      `SELECT s.category_slug AS axis, COUNT(DISTINCT t.skill_id) AS n
         FROM agent_skill_tags t JOIN skills s ON s.slug = t.taxonomy_skill_slug
        WHERE t.skill_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        GROUP BY s.category_slug`,
    ).bind(JSON.stringify(skillIds)).all<{ axis: string; n: number }>();
    const rows = (rs.results ?? []).filter((r) => AXIS_AREA[r.axis]);
    rows.sort((a, b) => Number(b.n) - Number(a.n) || AXIS_ORDER.indexOf(a.axis) - AXIS_ORDER.indexOf(b.axis));
    return rows.map((r) => AXIS_AREA[r.axis]);
  } catch { return null; }
}

export type Hint = { reason: 'skills'; area: AreaKey | null; areas: number | null; suggest: { key: string; name: string } | null };

/**
 * Whether to suggest a specialist, and whom: past `specialistMaxSkills`
 * skills, an offered persona not already live on the team whose natural fit
 * includes the area with the most of them, in catalogue order.
 */
export async function specialistHint(env: Env, skillIds: readonly number[], teamPersonas: ReadonlySet<string>): Promise<Hint | null> {
  if (skillIds.length <= RUN_COST_CONFIG.specialistMaxSkills) return null;
  const areas = await skillAreas(env, skillIds);
  const area = areas?.[0] ?? null;
  let suggest: Hint['suggest'] = null;
  if (area) {
    const settings = await loadPersonaSettings(env);
    const p = PERSONAS.find((x) => statusOf(settings.get(x.key)) === 'offered' && !teamPersonas.has(x.key) && x.natural_fit.includes(area));
    if (p) suggest = { key: p.key, name: settings.get(p.key)?.name ?? p.name };
  }
  return { reason: 'skills', area, areas: areas ? areas.length : null, suggest };
}

/** The change in what a run can cost (the dearest run), or null when either is unknown. */
export function deltaOf(before: Estimate, after: Estimate) {
  if (!before.available || !after.available) return null;
  return {
    skills: after.skills - before.skills,
    tokens_per_run: after.tokens_per_run - before.tokens_per_run,
    est_usd_per_run: Math.round((after.est_usd_per_run - before.est_usd_per_run) * 1_000_000) / 1_000_000,
  };
}
