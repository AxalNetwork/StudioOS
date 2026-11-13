/**
 * Task #8 (DI) — Expert matching engine.
 *
 * Composite score (per spec):
 *   0.35 * base_match
 * + 0.25 * rating_score
 * + 0.10 * language_match
 * + 0.10 * tz_match
 * + 0.10 * availability
 * + 0.10 * price_match
 *
 * All sub-scores are normalised to [0, 1]; final score is in [0, 1].
 */
import type { Env } from '../../types';

export interface ExpertRow {
  id: number;
  uid: string;
  user_id: number | null;
  name: string;
  headline: string | null;
  bio: string | null;
  photo_url: string | null;
  categories_json: string;
  sectors_json: string;
  languages_json: string;
  timezones_json: string;
  modalities_json: string;
  pricing_model: string;
  hourly_rate_usd: number | null;
  first_session_free: number;
  calendly_url: string | null;
  booking_url: string | null;
  website_url: string | null;
  verified: number;
  is_active: number;
  // Task #4 — added by migration 070 / ensureWellbeingSchema ALTERs.
  profile_completion_pct?: number;
  stripe_account_id?: string | null;
  stripe_charges_enabled?: number;
  stripe_payouts_enabled?: number;
  application_fee_pct?: number | null;
  updated_at?: string | null;
  hidden_by_admin?: number;
}

export interface MatchPrefs {
  categories: string[];      // founder's wellness goals / advisor needs
  sectors: string[];         // founder's industry vectors
  languages: string[];       // founder languages, lowercase
  timezone: string | null;   // IANA tz, e.g. 'America/Los_Angeles'
  modalities: string[];      // preferred modalities
  budget_max_usd: number | null;
}

export interface RatingAgg {
  expert_id: number;
  avg_stars: number;
  count: number;
}

export interface ScoredExpert {
  expert: ExpertRow;
  score: number;
  breakdown: {
    base_match: number;
    rating_score: number;
    language_match: number;
    tz_match: number;
    availability: number;
    price_match: number;
  };
  rating_avg: number;
  rating_count: number;
}

function safeJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch { return []; }
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = new Set<string>([...A, ...B]).size;
  return union ? inter / union : 0;
}

function tzOffsetHours(tz: string): number | null {
  try {
    // Build a date in the target tz; derive offset minutes from formatted hour.
    const d = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    return (asUtc - d.getTime()) / 3_600_000;
  } catch { return null; }
}

function tzMatchScore(founderTz: string | null, expertTzs: string[]): number {
  if (!founderTz || !expertTzs.length) return 0.5; // neutral when unknown
  const founderOffset = tzOffsetHours(founderTz);
  if (founderOffset == null) return 0.5;
  let best = 0;
  for (const tz of expertTzs) {
    const off = tzOffsetHours(tz);
    if (off == null) continue;
    const diff = Math.abs(off - founderOffset);
    // 0h diff -> 1.0, 6h -> 0.5, ≥12h -> 0.
    const score = Math.max(0, 1 - diff / 12);
    if (score > best) best = score;
  }
  return best;
}

function priceMatchScore(expert: ExpertRow, budgetMax: number | null): number {
  if (expert.first_session_free) return 1;
  if (expert.pricing_model === 'free') return 1;
  if (expert.pricing_model === 'sliding_scale') return 0.85;
  if (budgetMax == null) return 0.6; // neutral-positive
  const rate = expert.hourly_rate_usd ?? 0;
  if (!rate) return 0.7;
  if (rate <= budgetMax) return 1;
  // Decay: 1.5× budget → 0.5, ≥2× → 0.
  const ratio = rate / budgetMax;
  return Math.max(0, 1 - (ratio - 1));
}

function ratingScore(agg: RatingAgg | null | undefined): number {
  if (!agg || agg.count === 0) return 0.6; // unrated → neutral, slightly under perfect
  const stars = Math.max(1, Math.min(5, agg.avg_stars));
  // 5★ → 1.0, 1★ → 0. Scale linearly, with a small confidence boost for n≥5.
  const base = (stars - 1) / 4;
  const confidence = Math.min(1, agg.count / 5);
  return base * (0.7 + 0.3 * confidence);
}

function availabilityScore(expert: ExpertRow): number {
  // We don't model live calendar availability here; proxy = has booking URL,
  // Calendly URL, and is verified. Active experts with both → 1.0.
  let s = 0.4; // baseline for active
  if (expert.calendly_url) s += 0.35;
  else if (expert.booking_url) s += 0.25;
  if (expert.verified) s += 0.25;
  return Math.min(1, s);
}

export function scoreExpert(
  expert: ExpertRow,
  prefs: MatchPrefs,
  rating: RatingAgg | null,
): ScoredExpert {
  const cats = safeJsonArray(expert.categories_json);
  const sectors = safeJsonArray(expert.sectors_json);
  const langs = safeJsonArray(expert.languages_json);
  const tzs = safeJsonArray(expert.timezones_json);

  // base_match weights category overlap (0.7) and sector overlap (0.3).
  // Modality preference (when supplied) is folded into base_match with a
  // light penalty for non-overlap rather than a separate multiplier — the
  // spec defines the composite formula exactly and we honour it verbatim.
  const catScore = jaccard(cats, prefs.categories);
  const sectorScore = sectors.length && prefs.sectors.length ? jaccard(sectors, prefs.sectors) : 0.5;
  let base = 0.7 * catScore + 0.3 * sectorScore;
  if (prefs.modalities.length) {
    const own = safeJsonArray(expert.modalities_json);
    const modOk = own.length === 0 || jaccard(own, prefs.modalities) > 0;
    if (!modOk) base = base * 0.6;
  }

  const langScore = jaccard(langs, prefs.languages.length ? prefs.languages : ['en']);
  const tzScore = tzMatchScore(prefs.timezone, tzs);
  const availability = availabilityScore(expert);
  const price = priceMatchScore(expert, prefs.budget_max_usd);
  const rscore = ratingScore(rating);

  // Composite per spec — no extra multipliers.
  const composite =
    0.35 * base +
    0.25 * rscore +
    0.10 * langScore +
    0.10 * tzScore +
    0.10 * availability +
    0.10 * price;

  return {
    expert,
    score: composite,
    breakdown: {
      base_match: base,
      rating_score: rscore,
      language_match: langScore,
      tz_match: tzScore,
      availability,
      price_match: price,
    },
    rating_avg: rating?.avg_stars ?? 0,
    rating_count: rating?.count ?? 0,
  };
}

export async function loadRatingAggregates(
  env: Env,
  expertIds: number[],
): Promise<Map<number, RatingAgg>> {
  const out = new Map<number, RatingAgg>();
  if (!expertIds.length) return out;
  const placeholders = expertIds.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `SELECT expert_id, AVG(stars) as avg_stars, COUNT(*) as count
       FROM expert_ratings
      WHERE expert_id IN (${placeholders})
      GROUP BY expert_id`,
  ).bind(...expertIds).all<{ expert_id: number; avg_stars: number; count: number }>();
  for (const r of (res.results || [])) {
    out.set(r.expert_id, { expert_id: r.expert_id, avg_stars: Number(r.avg_stars), count: Number(r.count) });
  }
  return out;
}

export function rankExperts(
  experts: ExpertRow[],
  prefs: MatchPrefs,
  ratings: Map<number, RatingAgg>,
  limit = 6,
): ScoredExpert[] {
  const scored = experts
    .filter((e) => e.is_active)
    .map((e) => scoreExpert(e, prefs, ratings.get(e.id) ?? null));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function applyFilters(experts: ExpertRow[], filters: {
  category?: string | null;
  language?: string | null;
  modality?: string | null;
  price_max?: number | null;
  q?: string | null;
}): ExpertRow[] {
  const q = (filters.q || '').toLowerCase().trim();
  return experts.filter((e) => {
    if (filters.category) {
      const cats = safeJsonArray(e.categories_json);
      if (!cats.includes(filters.category)) return false;
    }
    if (filters.language) {
      const langs = safeJsonArray(e.languages_json).map((x) => x.toLowerCase());
      if (!langs.includes(filters.language.toLowerCase())) return false;
    }
    if (filters.modality) {
      const mods = safeJsonArray(e.modalities_json);
      if (!mods.includes(filters.modality)) return false;
    }
    if (filters.price_max != null && e.hourly_rate_usd != null && !e.first_session_free) {
      if (e.hourly_rate_usd > filters.price_max) return false;
    }
    if (q) {
      const hay = [e.name, e.headline || '', e.bio || ''].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
