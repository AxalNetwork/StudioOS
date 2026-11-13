/**
 * D605 (#1296) — values compatibility across roles (PROFILING_V2.md §6,
 * Session 14 of its programme), for the archetype card's published-member
 * matches (D602).
 *
 * PURE: no DB in the core. `valuesFit` compares two people's recorded values
 * and answers one band, never a dimension, a score or which side holds which
 * (§7.9 keeps a member's values from everyone else).
 *
 * THE PAIRS (§6). Every pair compares the six Axal values. A pair with a
 * founder on one side also compares the dimensions both sides' banks ask:
 *   founder · investor  risk appetite, growth vs sustain, Schwartz
 *                       achievement, benevolence, universalism
 *   founder · partner   autonomy vs structure, all four Schwartz
 *   founder · advisor   all four Schwartz (a coach is asked the advisor bank)
 *   founder · founder   all five founder spectrums, all four Schwartz
 * The paired dimensions already share a slug (an investor's `lean_risk` writes
 * `founder_risk_appetite`), so both sides are on one scale.
 *
 * THE SCALES. `user_values` scores run −2..+2 and `axal_values` 0..1; each is
 * normalised to 0..1 before the distance is taken. A dimension counts only
 * when BOTH sides have it recorded with confidence above 0.
 *
 * THE BAND (D605's thresholds, pinned in the test):
 *   null       fewer than MIN_COMPARED dimensions on both sides — "not enough
 *              recorded", never aligned and never 0;
 *   far_apart  ANY compared dimension at or past FAR_APART — a gap is never
 *              averaged away (§6);
 *   aligned    every compared dimension within ALIGNED;
 *   mixed      otherwise.
 */
import { FIT_V2_VALUES } from './axalFit';

export const MIN_COMPARED = 3;
/** 0.25 on the 0..1 scale is one point on a −2..+2 answer. */
export const ALIGNED = 0.25;
/** 0.5 on the 0..1 scale is two points on a −2..+2 answer: opposite leanings. */
export const FAR_APART = 0.5;

export type Side = 'founder' | 'investor' | 'partner' | 'advisor' | 'other';
export type Band = 'aligned' | 'mixed' | 'far_apart';
export interface Recorded { score: number; confidence: number }
/** One person's values: `axal` 0..1 by value key, `values` −2..+2 by dimension slug. */
export interface ValueProfile { axal: Record<string, Recorded>; values: Record<string, Recorded> }

export const AXAL_KEYS: readonly string[] = FIT_V2_VALUES;
const SCHWARTZ = ['schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism', 'schwartz_self_direction'];
const FOUNDER_SPECTRUMS = [
  'founder_mission_vs_profit', 'founder_speed_vs_quality', 'founder_risk_appetite',
  'founder_growth_vs_sustain', 'founder_autonomy_vs_structure',
];

/** What a founder is compared on with each other side, beyond the Axal values. */
export const FOUNDER_PAIRS: Readonly<Record<Exclude<Side, 'other'>, readonly string[]>> = {
  investor: ['founder_risk_appetite', 'founder_growth_vs_sustain', 'schwartz_achievement', 'schwartz_benevolence', 'schwartz_universalism'],
  partner: ['founder_autonomy_vs_structure', ...SCHWARTZ],
  advisor: [...SCHWARTZ],
  founder: [...FOUNDER_SPECTRUMS, ...SCHWARTZ],
};

/** A role or persona → the side it answers for. A coach is asked the advisor bank. */
export function sideOf(roleOrPersona: string | null | undefined): Side {
  const r = String(roleOrPersona ?? '').toLowerCase();
  if (r === 'founder' || r === 'investor' || r === 'partner' || r === 'advisor') return r;
  if (r === 'coach') return 'advisor';
  return 'other';
}

/** The `user_values` dimensions a pair is compared on (the Axal values are always added). */
export function pairDimensions(a: Side, b: Side): readonly string[] {
  if (a === 'founder' && b !== 'other') return FOUNDER_PAIRS[b];
  if (b === 'founder' && a !== 'other') return FOUNDER_PAIRS[a];
  return [];
}

const recorded = (x: Recorded | undefined): x is Recorded =>
  !!x && Number.isFinite(x.score) && Number.isFinite(x.confidence) && x.confidence > 0;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** The band for two people, and how many dimensions were compared. No dimension leaves this function. */
export function valuesFit(
  a: { side: Side; profile: ValueProfile },
  b: { side: Side; profile: ValueProfile },
): { band: Band | null; compared: number } {
  const gaps: number[] = [];
  for (const k of AXAL_KEYS) {
    const x = a.profile.axal[k];
    const y = b.profile.axal[k];
    if (recorded(x) && recorded(y)) gaps.push(Math.abs(clamp01(x.score) - clamp01(y.score)));
  }
  for (const k of pairDimensions(a.side, b.side)) {
    const x = a.profile.values[k];
    const y = b.profile.values[k];
    if (recorded(x) && recorded(y)) gaps.push(Math.abs(clamp01((x.score + 2) / 4) - clamp01((y.score + 2) / 4)));
  }
  if (gaps.length < MIN_COMPARED) return { band: null, compared: gaps.length };
  if (gaps.some((g) => g >= FAR_APART)) return { band: 'far_apart', compared: gaps.length };
  if (gaps.every((g) => g <= ALIGNED)) return { band: 'aligned', compared: gaps.length };
  return { band: 'mixed', compared: gaps.length };
}

/** Rows read in one batch → a profile per user id. Users with no row get an empty profile. */
export function profilesFrom(
  ids: readonly number[],
  axalRows: Array<{ user_id: number; value_key: string; score: number; confidence: number }>,
  valueRows: Array<{ user_id: number; slug: string; score: number; confidence: number }>,
): Map<number, ValueProfile> {
  const out = new Map<number, ValueProfile>(ids.map((id) => [id, { axal: {}, values: {} }]));
  for (const r of axalRows) {
    const p = out.get(Number(r.user_id));
    if (p) p.axal[r.value_key] = { score: Number(r.score), confidence: Number(r.confidence) };
  }
  for (const r of valueRows) {
    const p = out.get(Number(r.user_id));
    if (p) p.values[r.slug] = { score: Number(r.score), confidence: Number(r.confidence) };
  }
  return out;
}
