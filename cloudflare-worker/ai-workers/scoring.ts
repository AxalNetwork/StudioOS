/**
 * AI deal-flow scoring. Pure prompt → JSON.
 * Falls back to a deterministic stub if env.AI is unavailable.
 */
import type { Env } from '../src/types';

export interface ScoringInput {
  project_id: number;
  name: string;
  description?: string;
  market_tam?: number;
  team_summary?: string;
  product_summary?: string;
}

export interface ScoringOutput {
  market: number;        // 0-25
  team: number;          // 0-20
  product: number;       // 0-15
  capital: number;       // 0-15
  total: number;         // 0-100 (last 25 = "AI judgment")
  rationale: string;
}

const SCORING_PROMPT = (i: ScoringInput) => `You are an early-stage venture studio scoring engine.
Score this opportunity strictly as JSON: {"market":int(0-25),"team":int(0-20),"product":int(0-15),"capital":int(0-15),"rationale":string}.
No prose outside JSON.

Project: ${i.name}
TAM (USD): ${i.market_tam ?? 'unknown'}
Description: ${i.description ?? 'n/a'}
Team: ${i.team_summary ?? 'n/a'}
Product: ${i.product_summary ?? 'n/a'}`;

function safeParse(text: string): Partial<ScoringOutput> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

export async function aiScoreDeal(env: Env, input: ScoringInput): Promise<ScoringOutput> {
  let parsed: Partial<ScoringOutput> = {};
  try {
    const resp: any = await (env as any).AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Output strict JSON. No markdown.' },
        { role: 'user', content: SCORING_PROMPT(input) },
      ],
      max_tokens: 400,
    });
    parsed = safeParse(resp?.response ?? '');
  } catch (e) {
    console.error('aiScoreDeal failed', e);
  }
  const market = clamp(parsed.market ?? 12, 0, 25);
  const team = clamp(parsed.team ?? 10, 0, 20);
  const product = clamp(parsed.product ?? 8, 0, 15);
  const capital = clamp(parsed.capital ?? 8, 0, 15);
  return {
    market, team, product, capital,
    total: market + team + product + capital,
    rationale: parsed.rationale ?? 'No rationale produced; defaults applied.',
  };
}

function clamp(n: any, lo: number, hi: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
