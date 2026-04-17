/**
 * AI valuation + buyer-matching primitives.
 *
 * Valuation logic:
 *   1. Pull deal/subsidiary signals (sector, stage, last score, latest momentum).
 *   2. Ask Llama 3.1 8B for a $-valuation + 25-word rationale (strict JSON).
 *   3. Clamp into a sane range and convert to cents.
 *
 * Matching logic:
 *   1. Score every candidate user (LPs/partners/admins) against the listing.
 *   2. Use deterministic features (sector overlap, capital availability) and
 *      ask the AI for a one-line explanation per top match.
 */
import type { Env } from '../src/types';

const MIN_VALUATION_CENTS = 25_000_00;          // $25k
const MAX_VALUATION_CENTS = 1_000_000_000_00;   // $1B

export interface ValuationContext {
  subsidiary_id: number;
  subsidiary_name?: string;
  deal_id?: number;
  sector?: string;
  stage?: string;
  total_score?: number;          // 0-100
  momentum?: number;             // 0-10
  last_revenue_cents?: number;
  notes?: string;
}

export interface ValuationResult {
  valuation_cents: number;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
}

function safeJson(text: string): any {
  const m = text?.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

function clampCents(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return MIN_VALUATION_CENTS;
  return Math.max(MIN_VALUATION_CENTS, Math.min(MAX_VALUATION_CENTS, Math.round(x)));
}

export async function aiValueAsset(env: Env, ctx: ValuationContext): Promise<ValuationResult> {
  const prompt = `You are an early-stage venture analyst. Estimate fair-value for this spin-out.
Return STRICT JSON: {"valuation_usd": number, "confidence": "low"|"medium"|"high", "rationale": "<=240 chars"}.

Subsidiary: ${ctx.subsidiary_name ?? `#${ctx.subsidiary_id}`}
Sector: ${ctx.sector ?? 'unknown'}
Stage: ${ctx.stage ?? 'pre-seed'}
Composite score (0-100): ${ctx.total_score ?? 'n/a'}
Momentum (0-10): ${ctx.momentum ?? 'n/a'}
Last revenue (USD): ${ctx.last_revenue_cents != null ? (ctx.last_revenue_cents / 100).toFixed(0) : 'n/a'}
Notes: ${ctx.notes ?? ''}`;

  let parsed: any = {};
  try {
    const resp: any = await (env as any).AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Strict JSON output only. Pick a realistic $ figure based on inputs.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 250,
    });
    parsed = safeJson(resp?.response ?? '');
  } catch (e) { console.error('aiValueAsset failed', e); }

  const valuationUsd = Number(parsed.valuation_usd ?? 0);
  // If model returned dollars, convert to cents. Cap to plausible band.
  const cents = clampCents(valuationUsd > 0 ? valuationUsd * 100 : MIN_VALUATION_CENTS);
  const confidence = ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'low';
  return {
    valuation_cents: cents,
    confidence,
    rationale: String(parsed.rationale ?? 'Default conservative valuation applied.').slice(0, 280),
  };
}

// ---------- Buyer matching ----------

export interface BuyerCandidate {
  user_id: number;
  email: string;
  name?: string;
  role: 'admin' | 'founder' | 'partner';
  available_capital_cents?: number;
  preferred_sectors?: string[];
}

export interface ListingForMatch {
  id: number;
  subsidiary_name?: string;
  sector?: string;
  shares: number;
  asking_price_cents: number;
  ai_valuation_cents?: number | null;
}

export interface BuyerMatch {
  buyer_user_id: number;
  buyer_email: string;
  buyer_type: 'secondary_fund' | 'strategic' | 'lp_rollover';
  match_score: number;       // 0..1
  ai_explanation: string;
  proposed_price_cents: number;
}

function deterministicScore(listing: ListingForMatch, b: BuyerCandidate): number {
  let s = 0.4; // baseline
  if (b.role === 'partner') s += 0.15;
  if (b.preferred_sectors?.includes(listing.sector ?? '')) s += 0.25;
  if ((b.available_capital_cents ?? 0) >= listing.asking_price_cents) s += 0.2;
  return Math.max(0, Math.min(1, s));
}

function buyerType(b: BuyerCandidate): BuyerMatch['buyer_type'] {
  if (b.role === 'partner' && (b.available_capital_cents ?? 0) > 1_000_000_00) return 'secondary_fund';
  if (b.role === 'partner') return 'lp_rollover';
  return 'strategic';
}

export async function aiMatchBuyers(
  env: Env,
  listing: ListingForMatch,
  candidates: BuyerCandidate[],
  topN = 5,
): Promise<BuyerMatch[]> {
  const ranked = candidates
    .map(b => ({ b, s: deterministicScore(listing, b) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topN);

  if (!ranked.length) return [];

  // Single AI call to produce explanations for all top matches at once.
  // Anonymize: don't send emails or exact capital figures to the model.
  // Use anon ids and coarse capital bands instead.
  const capitalBand = (cents?: number): string => {
    const c = cents ?? 0;
    if (c >= 10_000_000_00) return 'huge';      // >=$10M
    if (c >= 1_000_000_00) return 'large';      // >=$1M
    if (c >= 100_000_00) return 'medium';       // >=$100k
    if (c > 0) return 'small';
    return 'unknown';
  };
  const anonMap = new Map<number, number>();    // user_id -> anon idx
  ranked.forEach(({ b }, i) => anonMap.set(b.user_id, i + 1));
  const list = ranked.map(({ b, s }) =>
    `- anon=${anonMap.get(b.user_id)} role=${b.role} score=${s.toFixed(2)} sectors=${(b.preferred_sectors || []).join('|')} capital_band=${capitalBand(b.available_capital_cents)}`
  ).join('\n');

  const prompt = `Listing: ${listing.subsidiary_name ?? '#' + listing.id}, sector=${listing.sector ?? '?'},
shares=${listing.shares}, ask=${(listing.asking_price_cents / 100).toFixed(0)} USD.
Explain in <=80 chars why each buyer fits. Return STRICT JSON:
{"explanations":[{"anon":int, "why":"..."}]}

Candidates:
${list}`;

  // Reverse map anon -> real user_id so we can stitch explanations back.
  const reverse: Record<number, number> = {};
  for (const [uid, anon] of anonMap.entries()) reverse[anon] = uid;
  const explanations: Record<number, string> = {};
  try {
    const resp: any = await (env as any).AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'Strict JSON only.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 350,
    });
    const m = (resp?.response ?? '').match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]);
      for (const e of obj.explanations || []) {
        const uid = reverse[Number(e?.anon)];
        if (uid != null) explanations[uid] = String(e.why || '').slice(0, 200);
      }
    }
  } catch (e) { console.error('aiMatchBuyers explanations failed', e); }

  return ranked.map(({ b, s }) => ({
    buyer_user_id: b.user_id,
    buyer_email: b.email,
    buyer_type: buyerType(b),
    match_score: Number(s.toFixed(3)),
    ai_explanation: explanations[b.user_id] ?? `Sector + role fit (score ${s.toFixed(2)}).`,
    proposed_price_cents: Math.round(listing.asking_price_cents * (0.9 + s * 0.1)),
  }));
}
