/**
 * Demand / Supply tagger: founders contribute "demand" rows,
 * advisors/partners contribute "supply" rows. Output schema:
 *   { side: 'demand'|'supply', topics: string[] }
 */
import { writeSignal, type ExtractorContext } from './shared';

const TOPIC_TAGS = ['gtm', 'engineering', 'design', 'fundraising', 'legal', 'finance',
  'product', 'sales', 'marketing', 'data', 'ops', 'recruiting'];

export function tagTopics(text: string): string[] {
  const t = text.toLowerCase();
  const found = new Set<string>();
  for (const tag of TOPIC_TAGS) if (t.includes(tag)) found.add(tag);
  if (/hire|hiring|recruit/.test(t)) found.add('recruiting');
  if (/ai|llm|ml/.test(t)) found.add('engineering');
  if (/customer|sales\b|deal/.test(t)) found.add('sales');
  return Array.from(found);
}

export async function extractDemandSupply(ctx: ExtractorContext): Promise<number> {
  if (ctx.persona !== 'founder' && ctx.persona !== 'advisor' && ctx.persona !== 'partner') return 0;
  const tags = tagTopics(ctx.rawValue);
  if (!tags.length) return 0;
  const side = ctx.persona === 'founder' ? 'demand' : 'supply';
  return await writeSignal(ctx.env, {
    extractor: 'demand_supply',
    userId: ctx.userId, persona: ctx.persona,
    advisorAnswerId: ctx.advisorAnswerId, questionId: ctx.questionId,
    sector: ctx.sector, geo: 'global', period_key: ctx.monthKey,
    payload: { side, topics: tags },
    content_hash: ctx.contentHash,
  });
}
