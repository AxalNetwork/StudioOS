/**
 * Technology Adoption Life-Cycle (TALC) position classifier. Runs
 * for founders + investors only (the personas with a stage POV).
 * Output schema: { stage: 'discovery'|'building'|'scaling'|'distributing', confidence }
 */
import { writeSignal, round, type ExtractorContext } from './shared';

const TALC_RULES: Array<{ stage: 'discovery' | 'building' | 'scaling' | 'distributing'; terms: string[] }> = [
  { stage: 'discovery',     terms: ['idea', 'discovery', 'interview', 'problem', 'hypothesis', 'pre-revenue'] },
  { stage: 'building',      terms: ['mvp', 'beta', 'prototype', 'wedge', 'pmf', 'design partner'] },
  { stage: 'scaling',       terms: ['series a', 'series b', 'arr', 'expansion', 'enterprise', 'channel'] },
  { stage: 'distributing',  terms: ['ipo', 'acquired', 'liquidity', 'secondary', 'distribution', 'm&a'] },
];

export function classifyTalc(text: string): { stage: string; confidence: number } | null {
  const t = text.toLowerCase();
  let best: { stage: string; hits: number } = { stage: '', hits: 0 };
  for (const r of TALC_RULES) {
    const hits = r.terms.reduce((acc, term) => acc + (t.includes(term) ? 1 : 0), 0);
    if (hits > best.hits) best = { stage: r.stage, hits };
  }
  if (best.hits === 0) return null;
  return { stage: best.stage, confidence: Math.min(1, best.hits / 3) };
}

export async function extractTalcPosition(ctx: ExtractorContext): Promise<number> {
  if (ctx.persona !== 'founder' && ctx.persona !== 'investor') return 0;
  const talc = classifyTalc(ctx.rawValue);
  if (!talc) return 0;
  return await writeSignal(ctx.env, {
    extractor: 'talc',
    userId: ctx.userId, persona: ctx.persona,
    advisorAnswerId: ctx.advisorAnswerId, questionId: ctx.questionId,
    sector: ctx.sector, geo: 'global', period_key: ctx.monthKey,
    payload: { stage: talc.stage, confidence: round(talc.confidence) },
    content_hash: ctx.contentHash,
  });
}
