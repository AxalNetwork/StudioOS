/**
 * D1255 (#3278) — the pure venture scorecard engine. It reads no store and
 * writes none: `collectors.ts` hands it facts, `store.ts` keeps its result.
 *
 * THE RULES (#2428 § "The scoring model"), the same as PMF's (`../scoring/pmf.ts`):
 *   · Not recorded is never 0 and never a neutral 50: it is out of the value.
 *     A recorded 0 ("0 of 4 must-haves done") is a value.
 *   · Value is the weighted mean of the inputs present, weights renormalised.
 *   · Coverage is the inputs present of the inputs that apply.
 *   · Confidence is Σ weight × grade ÷ Σ weight over the inputs that apply;
 *     past its freshness window an input's grade halves ("Stale").
 *   · Below the floor (0.25) the scope is "Not enough recorded", with no number.
 *   · An input that does not apply (a solo founder's values, spin-out terms
 *     for a venture that is not one) is out of every sum and of coverage. A
 *     scope "Not expected yet" at the venture's stage is out altogether.
 *   · An input whose store could not be read is out of the value and lowers
 *     confidence; the scope is then partial and is never stored.
 */
import { GRADES, VENTURE_MODEL_V1, type GradeLabel, type ModelInput, type Rule, type ScopeKey, type ScopeModel, type VentureModel } from './model';

export interface InputFacts {
  key: string;
  /** False: out of every sum and of the coverage count. */
  applies: boolean;
  /** False: Not recorded. A recorded 0 is `recorded: true` with a 0 figure. */
  recorded: boolean;
  raw: { n?: number | null; of?: number | null };
  /** 0–1: the mean grade of the records behind the input. */
  grade: number;
  grade_label: GradeLabel;
  /** The newest record's day, `YYYY-MM-DD`. */
  as_of: string | null;
  source: { table: string; rows: number };
  /** The figure in words. Counts and states only: never a name. */
  words: string;
  /** Why it is Not recorded or does not apply. */
  reason: string | null;
  unreadable?: boolean;
}

export type InputState = 'recorded' | 'not_recorded' | 'not_applicable' | 'unreadable';

export interface InputResult {
  key: string; label: string; weight: number;
  state: InputState;
  value: number | null;
  grade: GradeLabel; grade_factor: number; stale: boolean;
  contribution: number | null;
  words: string; reason: string | null;
  source: InputFacts['source']; as_of: string | null;
  personal: boolean;
}

export type ScopeState = 'scored' | 'not_enough' | 'not_expected' | 'unreadable';

export interface ScopeResult {
  scope: ScopeKey;
  model: string;
  state: ScopeState;
  value: number | null;
  band: 'Strong' | 'Fair' | 'Weak' | null;
  confidence: number;
  confidence_word: 'High' | 'Medium' | 'Low' | null;
  coverage: { present: number; applies: number };
  /** True when an input could not be read: drawn, never stored. */
  partial: boolean;
  reason: string | null;
  inputs: InputResult[];
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** An input's figure on 0–100, by its rule. Null when the figure cannot be formed. */
export function normalise(rule: Rule, raw: InputFacts['raw']): number | null {
  const n = raw.n == null ? NaN : Number(raw.n);
  if (!Number.isFinite(n)) return null;
  switch (rule.kind) {
    case 'count': return Math.round(clamp01(n / rule.full) * 100);
    case 'share': {
      const of = raw.of == null ? NaN : Number(raw.of);
      if (!Number.isFinite(of) || of <= 0) return null;
      return Math.round(clamp01(n / of / rule.full) * 100);
    }
    case 'steps': {
      let v = 0;
      for (const [at, value] of rule.steps) if (n >= at) v = value;
      return v;
    }
    case 'scale': return Math.round(clamp01((n - rule.zero) / (rule.full - rule.zero)) * 100);
    case 'direct': return Math.round(clamp01(n / 100) * 100);
  }
}

/** Whether an input's newest record is past its freshness window. */
export function isStale(model: VentureModel, input: ModelInput, asOf: string | null, today: string): boolean {
  if (!asOf) return false;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(age) && age > model.freshness_days[input.freshness];
}

function wordFor<T extends string>(table: ReadonlyArray<readonly [number, T]>, x: number): T | null {
  for (const [at, word] of table) if (x >= at) return word;
  return null;
}

/** "Not expected yet": the scope is out at this lifecycle stage (owner question 11 A). */
export function notExpected(scope: ScopeModel, stage: string | null): boolean {
  return !!stage && scope.not_expected_at.includes(stage);
}

/** One scope, from its collected facts. Pure. */
export function scoreScope(
  key: ScopeKey, facts: readonly InputFacts[], today: string,
  opts: { stage?: string | null; model?: VentureModel } = {},
): ScopeResult {
  const model = opts.model ?? VENTURE_MODEL_V1;
  const scope = model.scopes[key];
  const base = { scope: key, model: model.version };
  if (notExpected(scope, opts.stage ?? null)) {
    return { ...base, state: 'not_expected', value: null, band: null, confidence: 0, confidence_word: null,
      coverage: { present: 0, applies: 0 }, partial: false, reason: 'Not expected yet at this stage', inputs: [] };
  }
  const by = new Map(facts.map((f) => [f.key, f]));
  const rows = scope.inputs.map((mi) => {
    const f = by.get(mi.key);
    const applies = f ? f.applies : true;
    const down = applies && Boolean(f?.unreadable);
    const value = f && applies && !down && f.recorded ? normalise(mi.rule, f.raw) : null;
    const state: InputState = !applies ? 'not_applicable' : down ? 'unreadable' : value == null ? 'not_recorded' : 'recorded';
    const stale = state === 'recorded' && isStale(model, mi, f!.as_of, today);
    const g = state === 'recorded' ? clamp01(f!.grade) * (stale ? 0.5 : 1) : 0;
    const row: InputResult = {
      key: mi.key, label: mi.label, weight: mi.weight, state, value,
      grade: state === 'recorded' ? f!.grade_label : 'not_recorded', grade_factor: round1(g * 100) / 100, stale,
      contribution: null,
      words: state === 'recorded' ? (f?.words ?? '') : state === 'unreadable' ? 'Could not be read' : 'Not recorded',
      reason: f?.reason ?? (f ? null : 'Not read'),
      source: f?.source ?? { table: mi.source ?? '', rows: 0 }, as_of: f?.as_of ?? null,
      personal: Boolean(mi.personal),
    };
    return { row, applies, v: value, g };
  });
  const applicable = rows.filter((r) => r.applies);
  const present = applicable.filter((r) => r.v != null);
  const wPresent = present.reduce((a, r) => a + r.row.weight, 0);
  const wApplies = applicable.reduce((a, r) => a + r.row.weight, 0);
  const value = wPresent > 0 ? present.reduce((a, r) => a + r.row.weight * (r.v as number), 0) / wPresent : null;
  const confidence = wApplies > 0 ? applicable.reduce((a, r) => a + r.row.weight * r.g, 0) / wApplies : 0;
  const partial = applicable.some((r) => r.row.state === 'unreadable');
  const enough = value != null && confidence >= model.floor;
  for (const r of rows) r.row.contribution = enough && r.v != null ? round1((r.row.weight * r.v) / wPresent) : null;
  const rounded = enough ? Math.round(value as number) : null;
  return {
    ...base,
    state: enough ? 'scored' : partial ? 'unreadable' : 'not_enough',
    value: rounded,
    band: rounded == null ? null : wordFor(model.bands, rounded),
    confidence: Math.round(confidence * 100) / 100,
    confidence_word: wordFor(model.confidence, confidence),
    coverage: { present: present.length, applies: applicable.length },
    partial,
    reason: enough ? null : partial ? 'Could not be read' : 'Not enough recorded',
    inputs: rows.map((r) => r.row),
  };
}

/** A fact for an input with no source on the platform: it applies and is Not recorded. */
export function unsourced(key: string, reason: string): InputFacts {
  return { key, applies: true, recorded: false, raw: {}, grade: 0, grade_label: 'not_recorded', as_of: null,
    source: { table: '', rows: 0 }, words: 'Not recorded', reason };
}

/** The grade factor for a label (SCORING's one table). */
export const gradeOf = (label: Exclude<GradeLabel, 'not_recorded'>) => GRADES[label];
