/**
 * D4693 (#4693) — the studio pipeline's traction metrics and score
 * (`POST /api/pipeline/metrics/snapshot`, the decision-gate review that reads it).
 *
 * WHAT WAS WRONG. The score summed four capped parts whose caps were 40 + 40 + 15
 * + 15 = 110, on a number the screens print as "/100". Any metric was accepted
 * if `Number()` could read it, so `true` was 1, `null` and `''` were 0, `[]` was
 * 0, and a negative user count or a retention of 400 was stored. A metric left
 * out scored the same as a metric recorded as zero.
 *
 * THE RULES NOW
 *   · A metric is a finite number, or a string that is plainly a decimal number.
 *     A boolean, null, an empty string, an array, hex and `1e3`-style text are
 *     refused, not coerced.
 *   · Each metric has a unit and a range (`METRIC_SPECS`): counts and money are
 *     not negative, a percentage is 0 to 100, growth cannot lose more than 100%,
 *     NPS is -100 to 100. Out of range is refused, never clamped.
 *   · FORMULA v2 CAPS ADD UP TO 100: users 35, revenue 35, engagement 15,
 *     growth 15. The shape of each part is unchanged from v1.
 *   · A component whose metrics were not recorded is `null`, not 0, and is named
 *     in `missing`; the score is the sum of what was recorded.
 *   · THE FORMULA IS VERSIONED. A snapshot written before this change has no
 *     version and is formula 1 (a 0–110 scale); it keeps its score and its
 *     meaning, and a review that reads it says which formula and scale it used.
 *     A new snapshot records `_traction_formula` beside its metrics.
 */

export const TRACTION_FORMULA_VERSION = 2;
/** The key a snapshot's stored metrics carry their formula under. Screens do not print keys that start with `_`. */
export const FORMULA_KEY = '_traction_formula';

type Spec = { unit: 'count' | 'money' | 'percent' | 'growth_percent' | 'nps'; min: number; max: number };

export const METRIC_SPECS: Readonly<Record<string, Spec>> = Object.freeze({
  users: { unit: 'count', min: 0, max: 1e10 },
  mau: { unit: 'count', min: 0, max: 1e10 },
  dau: { unit: 'count', min: 0, max: 1e10 },
  revenue: { unit: 'money', min: 0, max: 1e12 },
  mrr: { unit: 'money', min: 0, max: 1e12 },
  arr: { unit: 'money', min: 0, max: 1e12 },
  cac: { unit: 'money', min: 0, max: 1e9 },
  ltv: { unit: 'money', min: 0, max: 1e12 },
  engagement: { unit: 'percent', min: 0, max: 100 },
  retention: { unit: 'percent', min: 0, max: 100 },
  conversion: { unit: 'percent', min: 0, max: 100 },
  churn: { unit: 'percent', min: 0, max: 100 },
  growth: { unit: 'growth_percent', min: -100, max: 10000 },
  growth_rate: { unit: 'growth_percent', min: -100, max: 10000 },
  nps: { unit: 'nps', min: -100, max: 100 },
});

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** The metrics a request may carry, each a finite number inside its range, or the sentence that refuses it. */
export function validateKeyMetrics(km: unknown): { ok: true; clean: Record<string, number> } | { ok: false; error: string } {
  if (!km || typeof km !== 'object' || Array.isArray(km)) return { ok: false, error: 'key_metrics must be an object' };
  const keys = Object.keys(km as object);
  if (keys.length === 0) return { ok: false, error: 'key_metrics cannot be empty' };
  if (keys.length > 20) return { ok: false, error: 'Too many metrics (max 20)' };
  const clean: Record<string, number> = {};
  for (const k of keys) {
    const spec = METRIC_SPECS[k];
    if (!spec) return { ok: false, error: `Unknown metric '${k}'. Allowed: ${Object.keys(METRIC_SPECS).join(', ')}` };
    const raw = (km as Record<string, unknown>)[k];
    const v = typeof raw === 'number' ? raw : (typeof raw === 'string' && PLAIN_NUMBER.test(raw.trim()) ? Number(raw.trim()) : NaN);
    if (!Number.isFinite(v)) return { ok: false, error: `Metric '${k}' must be a finite number` };
    if (v < spec.min || v > spec.max) {
      return { ok: false, error: `Metric '${k}' must be between ${spec.min} and ${spec.max}${spec.unit === 'percent' || spec.unit === 'growth_percent' ? ' (a percentage)' : ''}` };
    }
    clean[k] = v;
  }
  return { ok: true, clean };
}

export type TractionComponents = { users: number | null; revenue: number | null; engagement: number | null; growth: number | null };
export type TractionScore = {
  score: number;
  formula_version: number;
  max: number;
  components: TractionComponents;
  /** The components no metric was recorded for. They are not scored as zero; they are absent. */
  missing: (keyof TractionComponents)[];
  basis: string;
};

/** Caps per component; they add up to `TRACTION_MAX_V2`. */
export const COMPONENT_CAPS_V2 = Object.freeze({ users: 35, revenue: 35, engagement: 15, growth: 15 });
export const TRACTION_MAX_V2 = 100;
/** Formula 1's scale, kept so a stored score can be read as what it was. */
export const TRACTION_MAX_V1 = 110;

const first = (km: Record<string, number>, ...keys: string[]): number | null => {
  for (const k of keys) if (typeof km[k] === 'number') return km[k];
  return null;
};

/** Formula v2 over validated metrics. */
export function scoreTraction(km: Record<string, number>): TractionScore {
  const users = first(km, 'users', 'mau');
  const revenue = first(km, 'revenue', 'mrr');
  const engagement = first(km, 'engagement', 'retention');
  const growth = first(km, 'growth', 'growth_rate');
  const c = COMPONENT_CAPS_V2;
  const components: TractionComponents = {
    users: users === null ? null : Math.min(c.users, Math.log10(users + 1) * 10),
    revenue: revenue === null ? null : Math.min(c.revenue, Math.log10(revenue + 1) * 8),
    engagement: engagement === null ? null : Math.min(c.engagement, engagement * 0.15),
    // A shrinking metric adds nothing; it does not subtract from the others.
    growth: growth === null ? null : Math.min(c.growth, Math.max(0, growth * 0.5)),
  };
  const missing = (Object.keys(components) as (keyof TractionComponents)[]).filter((k) => components[k] === null);
  const score = Math.round(Math.min(TRACTION_MAX_V2, Object.values(components).reduce<number>((a, v) => a + (v ?? 0), 0)));
  return {
    score, formula_version: TRACTION_FORMULA_VERSION, max: TRACTION_MAX_V2, components, missing,
    basis: missing.length
      ? `Formula v${TRACTION_FORMULA_VERSION}, out of ${TRACTION_MAX_V2}. Not recorded, so not scored: ${missing.join(', ')}.`
      : `Formula v${TRACTION_FORMULA_VERSION}, out of ${TRACTION_MAX_V2}, from all four components.`,
  };
}

/** The formula a stored snapshot was scored with: its recorded version, or 1 for one written before versions existed. */
export function formulaVersionOf(keyMetrics: unknown): number {
  const v = keyMetrics && typeof keyMetrics === 'object' ? (keyMetrics as Record<string, unknown>)[FORMULA_KEY] : null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

/** The scale a formula's score is out of. */
export const scaleOf = (version: number): number => (version >= 2 ? TRACTION_MAX_V2 : TRACTION_MAX_V1);
