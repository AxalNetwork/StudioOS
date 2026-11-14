/**
 * Task #1 — Partner compensation extractors. Two signal families that
 * power the rate-card table and comp-model donut on the Marketplace
 * Pulse tab of the Market Intel page:
 *
 *   - `partner_rate_card`  — emitted on `partner.rate.hourly` and
 *     `partner.rate.project` answers. Payload:
 *        { topic, hourly?: number, project?: number }
 *     Reducer buckets by `(sector, topic)` and computes per-cell
 *     median + p25/p75 hourly + median project, k≥5 suppressed.
 *
 *   - `partner_comp_model` — emitted on `partner.comp.model` answers.
 *     Payload: { model: 'Cash'|'Equity'|'Hybrid'|'Pro Bono' }
 *     Reducer buckets by `sector` and emits a histogram, k≥5 suppressed.
 *
 * Topic resolution: looks up the partner's most recent
 * `partner.services.offered` advisor_answer and runs `tagTopics()` over
 * it. Falls back to 'general' if the partner hasn't answered the
 * services question yet (so the cell still bucketizes coherently).
 *
 * Persona gate: only `partner` answers contribute. Advisor/founder/
 * investor answers on these question_ids would noop.
 */
import { writeSignal, type ExtractorContext } from './shared';
import { tagTopics } from './demand_supply';

function parseNonNegNumber(s: string): number | null {
  const t = String(s ?? '').replace(/[$,\s]/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function resolvePartnerTopic(env: ExtractorContext['env'], userId: number): Promise<string> {
  try {
    const r = await env.DB.prepare(
      `SELECT raw_value FROM advisor_answers
         WHERE user_id = ? AND question_id = 'partner.services.offered'
         ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId).first<{ raw_value: string | null }>();
    const raw = r?.raw_value;
    if (raw) {
      const tags = tagTopics(raw);
      if (tags.length) return tags[0];
      const first = String(raw).split(',')[0]?.trim().toLowerCase();
      if (first) return first.slice(0, 32);
    }
  } catch { /* table missing on dev — fall through */ }
  return 'general';
}

export async function extractPartnerRateCard(ctx: ExtractorContext): Promise<number> {
  if (ctx.persona !== 'partner') return 0;
  const isHourly = ctx.questionId === 'partner.rate.hourly';
  const isProject = ctx.questionId === 'partner.rate.project';
  if (!isHourly && !isProject) return 0;
  const n = parseNonNegNumber(ctx.rawValue);
  if (n == null) return 0;
  // Drop project=0 (the "I only do hourly" sentinel) so it doesn't
  // skew the project median downward.
  if (isProject && n === 0) return 0;
  const topic = await resolvePartnerTopic(ctx.env, ctx.userId);
  const payload: Record<string, unknown> = { topic };
  if (isHourly) payload.hourly = n;
  if (isProject) payload.project = n;
  return await writeSignal(ctx.env, {
    extractor: 'partner_rate_card',
    userId: ctx.userId, persona: ctx.persona,
    advisorAnswerId: ctx.advisorAnswerId, questionId: ctx.questionId,
    sector: ctx.sector, geo: 'global', period_key: ctx.monthKey,
    payload,
    content_hash: ctx.contentHash,
  });
}

const COMP_MODELS = new Set(['Cash', 'Equity', 'Hybrid', 'Pro Bono']);

export async function extractPartnerCompModel(ctx: ExtractorContext): Promise<number> {
  if (ctx.persona !== 'partner') return 0;
  if (ctx.questionId !== 'partner.comp.model') return 0;
  const v = String(ctx.rawValue || '').trim();
  if (!COMP_MODELS.has(v)) return 0;
  return await writeSignal(ctx.env, {
    extractor: 'partner_comp_model',
    userId: ctx.userId, persona: ctx.persona,
    advisorAnswerId: ctx.advisorAnswerId, questionId: ctx.questionId,
    sector: ctx.sector, geo: 'global', period_key: ctx.monthKey,
    payload: { model: v },
    content_hash: ctx.contentHash,
  });
}
