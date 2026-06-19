// Axal Fit — the weighted scorecard methodology (hybrid rubric: structured
// score first, human review second). Encodes the per-persona rubrics, the 5
// Axal behavioral values, red flags, thresholds, and the final decision rule.
//
// Each rubric category is scored 0..5 (mean of its conversational questions).
// total_score = Σ(weight × score/5) / Σweight × 100, banded by threshold.
// Pure helpers (scoreRubric/bandFromScore) are unit-tested; computeFit adds
// the D1 I/O and persists a snapshot.
import type { Env } from '../types';

export type FitPersona = 'founder' | 'investor' | 'partner' | 'mentor' | 'coach';
export type FitBand = 'strong_yes' | 'yes_caution' | 'hold' | 'no';

export interface RubricCategory {
  key: string;
  label: string;
  weight: number; // relative; normalized by Σweight at score time
  look_for: string;
}

// Per-persona weighted rubrics (from the Axal methodology). mentor + coach
// share one rubric. Weights are relative — scoreRubric normalizes by their sum.
export const RUBRICS: Record<FitPersona, RubricCategory[]> = {
  founder: [
    { key: 'vision_clarity',   label: 'Vision clarity',   weight: 15, look_for: 'Can they explain the mission and why now?' },
    { key: 'execution_ability',label: 'Execution ability',weight: 20, look_for: 'Shipping speed, focus, follow-through.' },
    { key: 'domain_insight',   label: 'Domain insight',   weight: 15, look_for: 'Deep understanding of the problem space.' },
    { key: 'coachability',     label: 'Coachability',     weight: 15, look_for: 'Can they absorb feedback without losing conviction?' },
    { key: 'resilience',       label: 'Resilience',       weight: 15, look_for: 'Reaction to setbacks, uncertainty, rejection.' },
    { key: 'communication',    label: 'Communication',    weight: 10, look_for: 'Clear, concise, compelling, honest.' },
    { key: 'team_dynamics',    label: 'Team dynamics',    weight: 10, look_for: 'Trust, alignment, decision-making.' },
    { key: 'values_fit',       label: 'Values fit',       weight: 10, look_for: 'Long-term thinking, stewardship, integrity.' },
  ],
  partner: [
    { key: 'strategic_alignment',label: 'Strategic alignment',weight: 20, look_for: 'Do they amplify Axal VC’s thesis?' },
    { key: 'trustworthiness',    label: 'Trustworthiness',    weight: 20, look_for: 'Reliability, transparency, discretion.' },
    { key: 'network_quality',    label: 'Network quality',    weight: 15, look_for: 'Access to founders, capital, operators.' },
    { key: 'execution_support',  label: 'Execution support',  weight: 15, look_for: 'Can they actually help move deals forward?' },
    { key: 'collaboration_style',label: 'Collaboration style', weight: 15, look_for: 'Low ego, responsive, constructive.' },
    { key: 'reputation',         label: 'Reputation',         weight: 15, look_for: 'References, track record, consistency.' },
  ],
  mentor: [
    { key: 'domain_expertise', label: 'Domain expertise', weight: 25, look_for: 'Relevant, current, practical knowledge.' },
    { key: 'teaching_ability', label: 'Teaching ability', weight: 20, look_for: 'Can they translate complexity into action?' },
    { key: 'listening',        label: 'Listening skills', weight: 15, look_for: 'Do they diagnose before advising?' },
    { key: 'founder_empathy',  label: 'Founder empathy',  weight: 15, look_for: 'Balanced support, not performative advice.' },
    { key: 'reliability',      label: 'Reliability',      weight: 15, look_for: 'Show up, follow through, respect boundaries.' },
    { key: 'values_alignment', label: 'Values alignment', weight: 10, look_for: 'Ethical, constructive, non-extractive.' },
  ],
  // coach shares the mentor rubric.
  coach: [],
  investor: [
    { key: 'thesis_fit',       label: 'Thesis fit',       weight: 20, look_for: 'Do they understand and support Axal VC’s mandate?' },
    { key: 'capital_quality',  label: 'Capital quality',  weight: 15, look_for: 'Patient, strategically useful, clean capital.' },
    { key: 'governance_style', label: 'Governance style', weight: 15, look_for: 'Supportive, not controlling or noisy.' },
    { key: 'reputation',       label: 'Reputation',       weight: 20, look_for: 'Other founders’ experiences, references.' },
    { key: 'decision_quality', label: 'Decision quality', weight: 15, look_for: 'Good judgment under uncertainty.' },
    { key: 'values_fit',       label: 'Values fit',       weight: 15, look_for: 'Long-term orientation, stewardship, fairness.' },
  ],
};
RUBRICS.coach = RUBRICS.mentor; // coach == mentor rubric

// The 5 Axal behavioral values (same across all personas). Asked via behavioral
// questions ("tell me about a time..."), scored 0..5.
export const AXAL_VALUES: Array<{ key: string; label: string; probe: string }> = [
  { key: 'integrity',     label: 'Integrity',     probe: 'Honesty and consistency between words and actions.' },
  { key: 'stewardship',   label: 'Stewardship',   probe: 'Long-term thinking; treating capital and people as a trust.' },
  { key: 'curiosity',     label: 'Curiosity',     probe: 'Hunger to learn, question, and update.' },
  { key: 'resilience',    label: 'Resilience',    probe: 'Composure and recovery under setbacks.' },
  { key: 'collaboration', label: 'Collaboration', probe: 'Low ego, builds trust, shares credit.' },
];
export const AXAL_VALUE_KEYS = AXAL_VALUES.map((v) => v.key);

// Red flags surfaced when a probe trips.
export const RED_FLAGS: Array<{ key: string; label: string }> = [
  { key: 'overconfidence',       label: 'Overconfidence without evidence' },
  { key: 'blame_shifting',       label: 'Blame-shifting' },
  { key: 'inconsistent_stories', label: 'Inconsistent stories' },
  { key: 'poor_follow_through',  label: 'Poor follow-through' },
  { key: 'ego_over_collaboration', label: 'Ego over collaboration' },
  { key: 'transactional',        label: 'Treating people as transactions' },
  { key: 'weak_ethics',          label: 'Weak ethics under pressure' },
];

// Recommended thresholds (final decision rule combines this with signal quality
// + narrative fit).
export function bandFromScore(total: number): FitBand {
  if (total >= 85) return 'strong_yes';
  if (total >= 70) return 'yes_caution';
  if (total >= 55) return 'hold';
  return 'no';
}

export const BAND_LABEL: Record<FitBand, string> = {
  strong_yes: 'Strong yes',
  yes_caution: 'Yes, with caution',
  hold: 'Hold / more diligence',
  no: 'No',
};

export interface RubricLine {
  key: string;
  label: string;
  weight: number;     // normalized to 100
  score: number | null; // 0..5 mean, null if unanswered
  contribution: number; // points toward the 0..100 total
}

export interface RubricResult {
  total_score: number;   // 0..100
  band: FitBand;
  breakdown: RubricLine[];
  coverage: number;      // 0..1 share of categories answered
}

// Pure: weight-normalized 0..100 from per-category 0..5 means. Unanswered
// categories are excluded from both numerator and the weight denominator, so a
// partially-completed conversation scores on what's known (coverage reports it).
export function scoreRubric(persona: FitPersona, categoryScores: Record<string, number | null | undefined>): RubricResult {
  const rubric = RUBRICS[persona] || [];
  const totalWeight = rubric.reduce((s, c) => s + c.weight, 0) || 1;
  let answeredWeight = 0;
  let earned = 0;
  let answered = 0;
  const breakdown: RubricLine[] = rubric.map((c) => {
    const raw = categoryScores[c.key];
    const score = raw == null || !Number.isFinite(Number(raw)) ? null : Math.max(0, Math.min(5, Number(raw)));
    const normWeight = Math.round((c.weight / totalWeight) * 1000) / 10; // 1 decimal
    let contribution = 0;
    if (score != null) {
      answered += 1;
      answeredWeight += c.weight;
      earned += c.weight * (score / 5);
      contribution = Math.round(normWeight * (score / 5) * 10) / 10;
    }
    return { key: c.key, label: c.label, weight: normWeight, score, contribution };
  });
  // Score on answered weight so an incomplete rubric isn't penalized to 0.
  const total = answeredWeight > 0 ? Math.round((earned / answeredWeight) * 100) : 0;
  return {
    total_score: total,
    band: bandFromScore(total),
    breakdown,
    coverage: rubric.length ? answered / rubric.length : 0,
  };
}

export interface FitResult {
  user_id: number;
  persona: FitPersona;
  total_score: number;
  band: FitBand;
  band_label: string;
  rubric: RubricLine[];
  axal_values: Array<{ key: string; label: string; score: number; confidence: number }>;
  red_flags: Array<{ key: string; label: string }>;
  signal_quality: number; // 0..1
  narrative_fit: string;
  computed_at: string | null;
  saved: boolean;
}

async function safeAll<T = Record<string, unknown>>(env: Env, sql: string, binds: unknown[]): Promise<T[]> {
  try {
    const r = await env.DB.prepare(sql).bind(...binds).all();
    return (r.results ?? []) as T[];
  } catch {
    return [];
  }
}

function buildNarrative(persona: FitPersona, r: RubricResult, redFlags: string[]): string {
  if (r.coverage === 0) return 'Not enough conversation yet to assess fit.';
  const ranked = r.breakdown.filter((b) => b.score != null).sort((a, b) => (b.score! - a.score!));
  const top = ranked.slice(0, 2).map((b) => b.label);
  const low = ranked.slice(-2).map((b) => b.label);
  const flagNote = redFlags.length ? ` Watch: ${redFlags.length} red flag(s).` : '';
  return `${BAND_LABEL[r.band]} for ${persona}. Strongest: ${top.join(', ')}. Develop: ${low.join(', ')}.${flagNote}`;
}

// Load scored fit responses, the 5 Axal values, and red flags; compute the
// weighted scorecard; persist a snapshot; return the full result.
export async function computeFit(env: Env, userId: number, persona: FitPersona): Promise<FitResult> {
  const rows = await safeAll<{ category: string | null; avg: number; n: number }>(
    env,
    'SELECT category, AVG(score) AS avg, COUNT(*) AS n FROM axal_fit_responses WHERE user_id = ? AND persona = ? GROUP BY category',
    [userId, persona],
  );
  const categoryScores: Record<string, number> = {};
  for (const row of rows) if (row.category) categoryScores[row.category] = Number(row.avg);

  const rubric = scoreRubric(persona, categoryScores);

  const valueRows = await safeAll<{ value_key: string; score: number; confidence: number }>(
    env,
    'SELECT value_key, score, confidence FROM axal_values WHERE user_id = ?',
    [userId],
  );
  const valueMap = new Map(valueRows.map((v) => [v.value_key, v]));
  const axal_values = AXAL_VALUES.map((v) => ({
    key: v.key,
    label: v.label,
    score: Number(valueMap.get(v.key)?.score ?? 0),
    confidence: Number(valueMap.get(v.key)?.confidence ?? 0),
  }));

  const flagRows = await safeAll<{ red_flag: string }>(
    env,
    'SELECT DISTINCT red_flag FROM axal_fit_responses WHERE user_id = ? AND persona = ? AND red_flag IS NOT NULL',
    [userId, persona],
  );
  const flagKeys = flagRows.map((f) => f.red_flag).filter(Boolean);
  const red_flags = RED_FLAGS.filter((f) => flagKeys.includes(f.key));

  // Signal quality blends rubric coverage with mean value confidence.
  const meanValueConf = axal_values.reduce((s, v) => s + v.confidence, 0) / (axal_values.length || 1);
  const signal_quality = Math.round((0.6 * rubric.coverage + 0.4 * meanValueConf) * 100) / 100;

  const narrative_fit = buildNarrative(persona, rubric, flagKeys);

  // Persist a snapshot (latest row per user/persona is current).
  let saved = false;
  try {
    await env.DB.prepare(
      `INSERT INTO axal_fit_scores
         (user_id, persona, total_score, band, rubric_json, red_flags_json, signal_quality, narrative_fit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId, persona, rubric.total_score, rubric.band,
      JSON.stringify(rubric.breakdown), JSON.stringify(flagKeys), signal_quality, narrative_fit,
    ).run();
    saved = true;
  } catch {
    saved = false;
  }

  return {
    user_id: userId,
    persona,
    total_score: rubric.total_score,
    band: rubric.band,
    band_label: BAND_LABEL[rubric.band],
    rubric: rubric.breakdown,
    axal_values,
    red_flags,
    signal_quality,
    narrative_fit,
    computed_at: saved ? new Date().toISOString() : null,
    saved,
  };
}

// Load the latest persisted fit snapshot (no recompute) for a user/persona.
export async function loadLatestFit(env: Env, userId: number, persona: FitPersona): Promise<Record<string, unknown> | null> {
  try {
    return await env.DB.prepare(
      'SELECT * FROM axal_fit_scores WHERE user_id = ? AND persona = ? ORDER BY computed_at DESC LIMIT 1',
    ).bind(userId, persona).first<Record<string, unknown>>();
  } catch {
    return null;
  }
}
