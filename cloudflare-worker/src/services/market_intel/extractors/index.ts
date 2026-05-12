/**
 * Barrel + orchestrator for the six MI extractors. Each extractor
 * lives in its own file under this directory:
 *
 *   - sentiment.ts          — extractSentiment
 *   - talc_position.ts      — extractTalcPosition
 *   - thesis_embedding.ts   — extractThesisEmbedding
 *   - demand_supply.ts      — extractDemandSupply
 *   - sector_heat.ts        — extractSectorHeat
 *   - fit_match.ts          — buildFitMatchWrites (lazy in reducer)
 *
 * `runExtractorsForAnswer` fans the per-answer extractors out for one
 * advisor answer; `runExtractorSweep` performs the nightly
 * reconciliation by re-running them over advisor_answers since the
 * last sweep watermark. Both honour `users.mi_contribution_optout`.
 */
import type { Env } from '../../../types';
import { run as aiRun } from '../../aiRouter';
import { shortHash, weekKey, monthKey, resolveUserSector,
         type ExtractorContext } from './shared';
import { extractSentiment } from './sentiment';
import { extractTalcPosition } from './talc_position';
import { extractDemandSupply } from './demand_supply';
import { extractSectorHeat } from './sector_heat';
import { extractThesisEmbedding } from './thesis_embedding';
import { extractPartnerRateCard, extractPartnerCompModel } from './partner_compensation';

export { resolveUserSector, weekKey, monthKey, shortHash } from './shared';
export { scoreSentiment } from './sentiment';
export { classifyTalc } from './talc_position';
export { tagTopics } from './demand_supply';
export { upsertEmbedding } from './thesis_embedding';
export { buildFitMatchWrites, bytesToFloat32, cosineSafe,
         type VectorRow } from './fit_match';

export interface ExtractorInput {
  env: Env;
  userId: number;
  persona: string;
  questionId: string;
  rawValue: string;
  advisorAnswerId?: number | null;
}

export interface ExtractorResult {
  signals_written: number;
  embeddings_written: number;
  skipped_reason?: string;
}

/**
 * Run all six per-answer extractors for one advisor answer. Honors
 * the `users.mi_contribution_optout` flag synchronously — opted-out
 * users write zero rows. Per-row idempotency held by
 * UNIQUE(extractor, user_id, advisor_answer_id, content_hash).
 */
export async function runExtractorsForAnswer(input: ExtractorInput): Promise<ExtractorResult> {
  const { env, userId, persona, questionId, rawValue, advisorAnswerId } = input;
  if (!rawValue || rawValue.trim().length < 4) {
    return { signals_written: 0, embeddings_written: 0, skipped_reason: 'too_short' };
  }
  // Opt-out check (column may be missing on dev — treat absence as "contribute").
  try {
    const o = await env.DB.prepare(`SELECT mi_contribution_optout AS x FROM users WHERE id = ?`)
      .bind(userId).first<{ x: number | null }>();
    if (o && Number(o.x) === 1) {
      return { signals_written: 0, embeddings_written: 0, skipped_reason: 'opted_out' };
    }
  } catch { /* column missing — schema bootstrap pending; allow */ }

  const sector = await resolveUserSector(env, userId, persona);
  const text = rawValue.slice(0, 4000);
  const hash = await shortHash(`${userId}|${questionId}|${text.toLowerCase().replace(/\s+/g, ' ').trim()}`);
  const ctx: ExtractorContext = {
    env, userId, persona, questionId,
    rawValue: text, advisorAnswerId: advisorAnswerId ?? null,
    sector, contentHash: hash,
    weekKey: weekKey(), monthKey: monthKey(),
  };

  let signals = 0;
  let embeds = 0;

  const sentiment = await extractSentiment(ctx);
  signals += sentiment.written;
  signals += await extractTalcPosition(ctx);
  signals += await extractDemandSupply(ctx);
  signals += await extractSectorHeat(ctx, sentiment.sentiment.valence);
  signals += await extractPartnerRateCard(ctx);
  signals += await extractPartnerCompModel(ctx);
  embeds  += await extractThesisEmbedding(ctx);
  // fit_match is computed lazily in the reducer — no per-answer write.

  return { signals_written: signals, embeddings_written: embeds };
}

/**
 * Nightly extractor reconciliation — re-runs the per-answer
 * extractors over advisor_answers updated since `sinceIso` (defaults
 * to last 36h). Idempotent via the same content_hash UNIQUE index.
 *
 * Required because (a) the per-answer enqueue is best-effort and
 * may drop on transient failures, and (b) lexicons / sector
 * resolution may have changed since the original write — the sweep
 * upserts under the new mapping.
 */
export async function runExtractorSweep(env: Env, opts?: { sinceIso?: string }): Promise<{
  scanned: number; signals_written: number; embeddings_written: number;
}> {
  const sinceIso = opts?.sinceIso || new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  let rows: Array<{ id: number; user_id: number; persona: string; question_id: string; raw_value: string }> = [];
  try {
    const r = await env.DB.prepare(
      `SELECT a.id, a.user_id, COALESCE(u.role, 'unknown') AS persona,
              a.question_id, a.raw_value
         FROM advisor_answers a
         JOIN users u ON u.id = a.user_id
         WHERE a.created_at >= ?
           AND COALESCE(u.mi_contribution_optout, 0) = 0
         ORDER BY a.id ASC
         LIMIT 5000`,
    ).bind(sinceIso).all<{ id: number; user_id: number; persona: string; question_id: string; raw_value: string }>();
    rows = r.results || [];
  } catch (e) {
    console.warn('[mi.sweep] scan failed (advisor_answers may not exist):', (e as Error).message);
    return { scanned: 0, signals_written: 0, embeddings_written: 0 };
  }
  let signals = 0, embeds = 0;
  for (const r of rows) {
    try {
      const out = await runExtractorsForAnswer({
        env, userId: Number(r.user_id), persona: String(r.persona).toLowerCase(),
        questionId: String(r.question_id || ''), rawValue: String(r.raw_value || ''),
        advisorAnswerId: Number(r.id),
      });
      signals += out.signals_written;
      embeds += out.embeddings_written;
    } catch (e) { console.warn('[mi.sweep] row failed:', (e as Error).message); }
  }
  return { scanned: rows.length, signals_written: signals, embeddings_written: embeds };
}

/**
 * Optional paraphrase pass — used only by the reducer when persisting
 * snippets. Returns null if the LLM refused or budget is exhausted.
 */
export async function paraphraseForSnippet(env: Env, userId: number, text: string): Promise<string | null> {
  if (!text || text.length < 20) return null;
  try {
    const r = await aiRun(env, {
      task: 'paraphrase',
      userId,
      systemPrompt: 'Paraphrase the input so no proper nouns, company names, or personally identifiable details remain. Keep it neutral, ≤ 220 chars, single sentence.',
      messages: [{ role: 'user', content: text.slice(0, 1200) }],
      maxTokens: 120, temperature: 0.2,
    });
    if (!r.ok || !r.output) return null;
    return r.output.trim().slice(0, 280);
  } catch (e) {
    console.warn('[mi.extractors] paraphrase failed:', (e as Error).message);
    return null;
  }
}
