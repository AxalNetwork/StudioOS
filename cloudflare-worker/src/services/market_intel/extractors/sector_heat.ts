/**
 * Sector heat extractor — derived signal. Tags every contribution
 * with the user's resolved sector so the reducer can compute
 *   heat = sqrt(contributions) × (1 + |mean_valence|)
 * per sector × week. Skips users with no resolved sector ('global').
 */
import { writeSignal, round, type ExtractorContext } from './shared';

export async function extractSectorHeat(ctx: ExtractorContext, sentimentValence: number): Promise<number> {
  if (!ctx.sector || ctx.sector === 'global') return 0;
  return await writeSignal(ctx.env, {
    extractor: 'sector_heat',
    userId: ctx.userId, persona: ctx.persona,
    advisorAnswerId: ctx.advisorAnswerId, questionId: ctx.questionId,
    sector: ctx.sector, geo: 'global', period_key: ctx.weekKey,
    payload: { contribution: 1, valence: round(sentimentValence) },
    content_hash: ctx.contentHash,
  });
}
