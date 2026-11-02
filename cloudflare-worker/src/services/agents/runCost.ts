/**
 * D4121 (#4121, Roster R5 of #4116) — what an agent's skills cost per run.
 *
 * More skills make an agent more capable and dearer: each skill version's
 * SKILL.md is context every run includes, so it costs its tokens on every run.
 * Several specialists are cheaper than one generalist.
 *
 * THE ESTIMATE, per run, for the agent's model:
 *   tokens in  = the agent's system prompt (`agentRun.ts`'s own, for its first
 *                module) + a typical request (`RUN_COST_CONFIG.requestTokens`)
 *                + each pinned skill version's `context_tokens`
 *   tokens out = `RUN_COST_CONFIG.outputTokens`, a typical proposal
 *   tokens_per_run = in + out
 *   est_usd_per_run = the offered-model catalogue's price for those tokens
 *                at what the sponsor pays (`memberChargeMultiplier`)
 *   monthly_at_cap = how many such runs the agent's monthly cap pays for
 * Every token figure uses the AI budget's own estimate (`estTokens`: one token
 * per four characters). When the model's price cannot be read, the answer is
 * `{ available: false }`, never a 0.
 *
 * THE SPECIALIST HINT (`RUN_COST_CONFIG`): more than `specialistMaxSkills`
 * skills, or a per-run estimate above `specialistCostRatio` × the agent's
 * baseline (the same agent with no skills), names the area with the most
 * skills and an offered persona not on the team whose natural fit is that
 * area, if there is one.
 */
import type { Env } from '../../types';
import { estTokens } from '../ai/shapes';
import { modelById, providerModelById } from '../ai/catalogue';
import { billedMicro, usdRatesBilledMicro } from '../ai/pricing';
import { memberChargeMultiplier } from '../aiBudget';
import { RADAR_AXES } from '../skillsTaxonomySchema';
import { PERSONAS, type AreaKey } from './personas';
import { loadPersonaSettings, statusOf } from './rosterAdmin';

/** The thresholds and typical sizes the estimate uses: one place to change them. */
export const RUN_COST_CONFIG = Object.freeze({
  /** A typical request a person sends an agent, in tokens. */
  requestTokens: 400,
  /** A typical proposal an agent writes back, in tokens. */
  outputTokens: 800,
  /** More skills than this and the hint suggests a specialist. */
  specialistMaxSkills: 6,
  /** A per-run estimate above this many times the agent's baseline suggests a specialist. */
  specialistCostRatio: 2,
});

/** A skill version's context: the AI budget's estimate of its SKILL.md. */
export const contextTokensOf = (skillMd: string): number => estTokens(skillMd ?? '');

/** The radar axis slug (`skillsTaxonomySchema` RADAR_AXES) → the persona area (`personas.ts` AREAS). */
const AXIS_AREA: Readonly<Record<string, AreaKey>> = Object.freeze({
  product: 'product', engineering: 'engineering', design: 'design', gtm_sales: 'gtm',
  marketing_brand: 'marketing', finance_ops: 'finance', legal_compliance: 'legal', capital_network: 'capital',
});
const AXIS_ORDER: readonly string[] = RADAR_AXES.map((a) => a.slug);

export type Pin = { skill_id: number; version: number };
export type Estimate =
  | { available: false; reason: 'pricing_unreadable' | 'skills_unreadable' }
  | { available: true; skills: number; tokens_per_run: number; est_usd_per_run: number; monthly_at_cap: number | null };

/** Each pinned version's stored `context_tokens`, or null when any cannot be read. */
export async function pinTokens(env: Env, pins: readonly Pin[]): Promise<number[] | null> {
  if (!pins.length) return [];
  try {
    const rs = await env.DB.prepare(
      `SELECT v.skill_id, v.version, c.context_tokens, v.skill_md
         FROM agent_skill_versions v LEFT JOIN agent_skill_version_costs c ON c.skill_id = v.skill_id AND c.version = v.version
        WHERE v.skill_id || ':' || v.version IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(pins.map((p) => `${p.skill_id}:${p.version}`))).all<any>();
    const by = new Map((rs.results ?? []).map((r) => [`${r.skill_id}:${r.version}`, r.context_tokens == null ? contextTokensOf(String(r.skill_md ?? '')) : Number(r.context_tokens)]));
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

/** One estimate. The multiplier is read once per call. */
export async function estimate(env: Env, i: EstimateInput, multiplier?: number): Promise<Estimate> {
  const tokens = await pinTokens(env, i.pins);
  if (!tokens) return { available: false, reason: 'skills_unreadable' };
  let mult = multiplier;
  if (mult == null) { try { mult = await memberChargeMultiplier(env, i.sponsorId); } catch { return { available: false, reason: 'pricing_unreadable' }; } }
  const tokensIn = estTokens(i.systemPrompt) + RUN_COST_CONFIG.requestTokens + tokens.reduce((a, b) => a + b, 0);
  const micro = priceMicro(i.model, tokensIn, RUN_COST_CONFIG.outputTokens, mult);
  if (micro == null || !Number.isFinite(micro)) return { available: false, reason: 'pricing_unreadable' };
  return {
    available: true,
    skills: i.pins.length,
    tokens_per_run: tokensIn + RUN_COST_CONFIG.outputTokens,
    est_usd_per_run: micro / 1_000_000,
    monthly_at_cap: i.capMicro != null && micro > 0 ? Math.floor(i.capMicro / micro) : null,
  };
}

/** The area most of these skills' tags fall in (ties in the radar's order), or null when they tag none. */
export async function mainArea(env: Env, skillIds: readonly number[]): Promise<AreaKey | null> {
  if (!skillIds.length) return null;
  try {
    const rs = await env.DB.prepare(
      `SELECT s.category_slug AS axis, COUNT(DISTINCT t.skill_id) AS n
         FROM agent_skill_tags t JOIN skills s ON s.slug = t.taxonomy_skill_slug
        WHERE t.skill_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        GROUP BY s.category_slug`,
    ).bind(JSON.stringify(skillIds)).all<{ axis: string; n: number }>();
    const rows = (rs.results ?? []).filter((r) => AXIS_AREA[r.axis]);
    rows.sort((a, b) => Number(b.n) - Number(a.n) || AXIS_ORDER.indexOf(a.axis) - AXIS_ORDER.indexOf(b.axis));
    return rows.length ? AXIS_AREA[rows[0].axis] : null;
  } catch { return null; }
}

export type Hint = { reason: 'skills' | 'cost'; area: AreaKey | null; suggest: { key: string; name: string } | null };

/**
 * Whether to suggest a specialist, and whom: an offered persona not already
 * live on the team, whose natural fit includes `area`, in catalogue order.
 */
export async function specialistHint(
  env: Env, after: Estimate, baseline: Estimate, skillIds: readonly number[], teamPersonas: ReadonlySet<string>,
): Promise<Hint | null> {
  if (!after.available) return null;
  const tooMany = after.skills > RUN_COST_CONFIG.specialistMaxSkills;
  const tooDear = baseline.available && baseline.est_usd_per_run > 0 && after.est_usd_per_run > RUN_COST_CONFIG.specialistCostRatio * baseline.est_usd_per_run;
  if (!tooMany && !tooDear) return null;
  const area = await mainArea(env, skillIds);
  let suggest: Hint['suggest'] = null;
  if (area) {
    const settings = await loadPersonaSettings(env);
    const p = PERSONAS.find((x) => statusOf(settings.get(x.key)) === 'offered' && !teamPersonas.has(x.key) && x.natural_fit.includes(area));
    if (p) suggest = { key: p.key, name: settings.get(p.key)?.name ?? p.name };
  }
  return { reason: tooMany ? 'skills' : 'cost', area, suggest };
}

/** The change from one estimate to another, or null when either is unknown. */
export function deltaOf(before: Estimate, after: Estimate) {
  if (!before.available || !after.available) return null;
  return {
    skills: after.skills - before.skills,
    tokens_per_run: after.tokens_per_run - before.tokens_per_run,
    est_usd_per_run: Math.round((after.est_usd_per_run - before.est_usd_per_run) * 1_000_000) / 1_000_000,
  };
}
