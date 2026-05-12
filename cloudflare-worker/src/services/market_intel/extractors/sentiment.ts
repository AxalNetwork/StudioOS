/**
 * Sentiment extractor — lexicon-based valence + energy. Runs for
 * every persona, weekly bucket, sector-keyed. Output schema:
 *   { valence: number in [-1,1], energy: number in [0,1], n_terms }
 */
import { writeSignal, round, type ExtractorContext } from './shared';

const POS = ['great', 'strong', 'growing', 'fast', 'aggressive', 'tailwind', 'bullish', 'momentum',
  'demand', 'breakout', 'win', 'wins', 'opportunity', 'profitable', 'scaling', 'launched',
  'shipped', 'closed', 'raised', 'love', 'excited', 'optimistic'];
const NEG = ['weak', 'shrinking', 'slow', 'cautious', 'headwind', 'bearish', 'churn', 'risk',
  'risky', 'lose', 'losing', 'lost', 'bad', 'fail', 'failed', 'stalled', 'crowded',
  'expensive', 'concerned', 'worried', 'pessimistic', 'unprofitable'];
const ENERGY = ['must', 'urgent', 'now', 'asap', 'immediately', 'soon', 'rapidly', 'aggressive',
  'pivoting', 'deciding', 'closing', 'shipping'];

export function scoreSentiment(text: string): { valence: number; energy: number; n_terms: number } {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return { valence: 0, energy: 0, n_terms: 0 };
  let pos = 0, neg = 0, eng = 0, n = 0;
  for (const t of tokens) {
    if (POS.includes(t)) { pos++; n++; }
    else if (NEG.includes(t)) { neg++; n++; }
    if (ENERGY.includes(t)) eng++;
  }
  const valence = n === 0 ? 0 : (pos - neg) / Math.max(1, n);
  const energy = Math.min(1, eng / Math.max(8, tokens.length / 20));
  return { valence, energy, n_terms: n };
}

export async function extractSentiment(ctx: ExtractorContext): Promise<{ written: number; sentiment: { valence: number; energy: number; n_terms: number } }> {
  const sent = scoreSentiment(ctx.rawValue);
  let written = 0;
  if (sent.n_terms >= 1 || ctx.rawValue.length >= 60) {
    written = await writeSignal(ctx.env, {
      extractor: 'sentiment',
      userId: ctx.userId, persona: ctx.persona,
      advisorAnswerId: ctx.advisorAnswerId, questionId: ctx.questionId,
      sector: ctx.sector, geo: 'global', period_key: ctx.weekKey,
      payload: { valence: round(sent.valence), energy: round(sent.energy), n_terms: sent.n_terms },
      content_hash: ctx.contentHash,
    });
  }
  return { written, sentiment: sent };
}
