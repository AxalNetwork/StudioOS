/**
 * Thesis / discovery embedding extractor. Backs the fit_match
 * cosine matrix in the reducer. Embeddings are 768-dim Float32 from
 * `@cf/baai/bge-base-en-v1.5` via `services.vectorize.embedText`.
 *
 * - investor + thesis-bearing question  → kind='thesis'
 * - founder  + discovery-bearing question → kind='discovery'
 *
 * Idempotent via UNIQUE(user_id, kind) + content_hash guard so
 * re-running on identical text is a no-op.
 */
import type { Env } from '../../../types';
import { embedText } from '../../vectorize';
import { shortHash, type ExtractorContext } from './shared';

export async function upsertEmbedding(
  env: Env, userId: number,
  persona: 'founder' | 'investor',
  kind: 'thesis' | 'discovery' | 'needs' | 'offerings',
  questionId: string, text: string,
): Promise<boolean> {
  const vec = await embedText(env, text);
  if (!vec) return false;
  const f32 = new Float32Array(vec);
  const blob = new Uint8Array(f32.buffer);
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm);
  const hash = await shortHash(text.toLowerCase().slice(0, 1024));
  try {
    await env.DB.prepare(
      `INSERT INTO market_intel_embeddings
         (user_id, persona, kind, source_question_id, vector, norm, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, kind) DO UPDATE SET
         vector = excluded.vector,
         norm = excluded.norm,
         source_question_id = excluded.source_question_id,
         content_hash = excluded.content_hash,
         updated_at = datetime('now')
       WHERE market_intel_embeddings.content_hash != excluded.content_hash`,
    ).bind(userId, persona, kind, questionId, blob, norm, hash).run();
    return true;
  } catch (e) {
    console.warn('[mi.extractors] upsertEmbedding failed:', (e as Error).message);
    return false;
  }
}

export async function extractThesisEmbedding(ctx: ExtractorContext): Promise<number> {
  const haystack = ctx.questionId + ' ' + ctx.rawValue;
  if (ctx.persona === 'investor' && /thesis|invest|sector|stage|focus|conviction/i.test(haystack)) {
    return (await upsertEmbedding(ctx.env, ctx.userId, 'investor', 'thesis', ctx.questionId, ctx.rawValue)) ? 1 : 0;
  }
  if (ctx.persona === 'founder' && /discovery|problem|solution|why_now|customer|wedge|product/i.test(haystack)) {
    return (await upsertEmbedding(ctx.env, ctx.userId, 'founder', 'discovery', ctx.questionId, ctx.rawValue)) ? 1 : 0;
  }
  return 0;
}
