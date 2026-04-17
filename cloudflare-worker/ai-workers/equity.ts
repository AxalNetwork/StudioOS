/**
 * AI equity allocation recommender for spin-outs.
 * Inputs: contributors with role + impact tier. Output: percentage split summing to 100.
 */
import type { Env } from '../src/types';

export interface EquityContributor {
  name: string;
  role: 'founder' | 'partner' | 'studio' | 'advisor' | 'team';
  impact_tier: 1 | 2 | 3;       // 1 = high, 3 = low
}

export interface EquityRecommendation {
  allocations: Array<{ name: string; pct: number }>;
  rationale: string;
}

export async function aiRecommendEquity(
  env: Env,
  contributors: EquityContributor[],
  context?: { stage?: string; spinout_name?: string },
): Promise<EquityRecommendation> {
  const list = contributors.map(c => `- ${c.name} (${c.role}, tier ${c.impact_tier})`).join('\n');
  const prompt = `Recommend equity split for spin-out "${context?.spinout_name ?? 'NewCo'}" at stage ${context?.stage ?? 'pre-seed'}.
Studio (Axal) typically retains 20-40%. Founders 30-55%. Return STRICT JSON:
{"allocations":[{"name":"...","pct":number}], "rationale":"<=200 chars"}
Percentages MUST sum to 100.

Contributors:
${list}`;

  let parsed: any = {};
  try {
    const resp: any = await (env as any).AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Strict JSON. Sum of pct must equal 100.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 350,
    });
    const m = (resp?.response ?? '').match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch (e) { console.error('aiRecommendEquity failed', e); }

  let allocs = Array.isArray(parsed.allocations) ? parsed.allocations : [];
  // Normalize to 100
  const sum = allocs.reduce((a: number, b: any) => a + (Number(b.pct) || 0), 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.5) {
    allocs = allocs.map((a: any) => ({ name: a.name, pct: Math.round((Number(a.pct) / sum) * 100) }));
  }
  if (!allocs.length) {
    // deterministic fallback: even split with 25% to studio
    const founders = contributors.filter(c => c.role === 'founder');
    const others = contributors.filter(c => c.role !== 'founder' && c.role !== 'studio');
    allocs = [
      { name: 'Axal Studio', pct: 25 },
      ...founders.map(f => ({ name: f.name, pct: Math.round(50 / Math.max(1, founders.length)) })),
      ...others.map(o => ({ name: o.name, pct: Math.round(25 / Math.max(1, others.length)) })),
    ];
  }
  return { allocations: allocs, rationale: parsed.rationale ?? 'Default allocation applied.' };
}
