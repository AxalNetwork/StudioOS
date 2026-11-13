/**
 * D1143 (#3029, part 2 of #2433) — the Product-market fit engine.
 *
 * ONE DEFINITION, ONCE. #2433 § "The Product-market fit score" defines the
 * score; SCORING (#2428) reuses it unchanged as a scope for investors. This
 * file is that definition as code: `PMF_MODEL_V1` holds the ten inputs, their
 * weights, the marks that normalise each to 0–100, the grades, the confidence
 * floor and the bands, as data; `scorePmf` is a pure function of the
 * collected inputs and a model. Nothing here reads a store (the collector,
 * `pmfCollector.ts`, does) and nothing here writes one.
 *
 * THE RULES, each tested in `test/pmf_engine.test.ts`:
 *   · NOT RECORDED IS NEVER 0. An input whose module holds no records reads
 *     Not recorded and is left out of the value; an input whose module holds
 *     records none of which meet it is a recorded 0 ("0 of 12 signals paid").
 *   · Value is the weighted mean of the inputs present, the weights
 *     renormalised over them.
 *   · Coverage is the inputs present out of the inputs that apply.
 *   · Confidence is Σ (weight × grade) ÷ Σ weight over the inputs that apply.
 *     A stale input's grade is halved. Below the floor (0.25) the score reads
 *     "Not enough recorded" and carries no number.
 *   · An input that does not apply yet ("Not expected yet": product pull
 *     before a product is live, owner question 4 A) is out of every sum and of
 *     the coverage count.
 *   · Only records after the venture's latest Pivot count (owner question 5
 *     A). The collector applies the window; each input says how many records
 *     it left out.
 *   · Next steps: one fixed rule per input turns its gap into one step, with
 *     the gain this model computes for it (value "up to", confidence and
 *     coverage), ranked by that gain. Code writes them; Eadwyn never does.
 */

export type GradeLabel = 'measured' | 'reviewed' | 'sourced' | 'stated' | 'not_recorded';

/** SCORING's one Source-to-grade table (#2428). A grade sets confidence, never the value. */
export const GRADES: Readonly<Record<GradeLabel, number>> = Object.freeze({
  measured: 1.0, reviewed: 0.9, sourced: 0.7, stated: 0.4, not_recorded: 0,
});

export const PMF_INPUT_KEYS = [
  'icp_interviews', 'icp_coverage', 'pain_frequency', 'pain_severity', 'claims_supported',
  'paying_demand', 'would_pay', 'waitlist', 'experiment_outcomes', 'product_pull',
] as const;
export type PmfInputKey = (typeof PMF_INPUT_KEYS)[number];

/** How an input's figure becomes 0–100. */
export type PmfRule =
  | { kind: 'count'; full: number }                                   // n ÷ full, capped
  | { kind: 'share'; full: number }                                   // (n ÷ of) ÷ full, capped
  | { kind: 'steps'; steps: ReadonlyArray<readonly [number, number]> } // the highest step n reaches
  | { kind: 'marks'; marks: Readonly<Record<string, number>> };       // each part ÷ its mark, capped, averaged

export type PmfModuleSlug =
  | 'customer-research' | 'record' | 'problem-discovery' | 'ideal-customer-profile'
  | 'experiments' | 'demand-signals' | 'verdict' | 'product-roadmap';

export interface PmfModelInput {
  key: PmfInputKey;
  label: string;
  group: 'who' | 'problem' | 'claims' | 'demand';
  weight: number;
  rule: PmfRule;
  /** What the input reads, in the method drawer's words (RD4). */
  reads: string;
  /** Which freshness window applies: records (interviews, documents) or a connector figure. */
  freshness: 'records' | 'connector';
  module: PmfModuleSlug;
}

export interface PmfModel {
  version: string;
  published: string;
  floor: number;
  confidence: ReadonlyArray<readonly [number, 'High' | 'Medium' | 'Low']>;
  bands: ReadonlyArray<readonly [number, 'Strong' | 'Fair' | 'Weak']>;
  /** Days before an input's newest record makes it stale. */
  freshness_days: Readonly<Record<'records' | 'connector', number>>;
  inputs: ReadonlyArray<PmfModelInput>;
}

/** Model v1, as #2433 publishes it (owner question 7 A: the marks are reviewed after the first fairness check). */
export const PMF_MODEL_V1: PmfModel = Object.freeze<PmfModel>({
  version: '1.0',
  published: '2026-10-25',
  floor: 0.25,
  confidence: [[0.70, 'High'], [0.45, 'Medium'], [0.25, 'Low']],
  bands: [[70, 'Strong'], [40, 'Fair'], [0, 'Weak']],
  freshness_days: { records: 365, connector: 90 },
  inputs: [
    { key: 'icp_interviews', label: 'ICP interviews held', group: 'who', weight: 10, rule: { kind: 'count', full: 20 },
      reads: 'Held interviews with ICP fit strong or partial: 5 points each, full at 20.', freshness: 'records', module: 'customer-research' },
    { key: 'icp_coverage', label: 'ICP coverage', group: 'who', weight: 5, rule: { kind: 'share', full: 1 },
      reads: 'The share of held interviews with a fit and a segment recorded.', freshness: 'records', module: 'customer-research' },
    { key: 'pain_frequency', label: 'Pain frequency', group: 'problem', weight: 10, rule: { kind: 'share', full: 0.6 },
      reads: 'The share of ICP interviews naming the top pain theme: full at 60%.', freshness: 'records', module: 'problem-discovery' },
    { key: 'pain_severity', label: 'Pain severity', group: 'problem', weight: 10, rule: { kind: 'share', full: 0.7 },
      reads: 'The share of judged interviews with a pain judged Severe or Real: full at 70%.', freshness: 'records', module: 'problem-discovery' },
    { key: 'claims_supported', label: 'Claims supported', group: 'claims', weight: 20, rule: { kind: 'share', full: 1 },
      reads: 'Open claims Supported, each × its strongest evidence (measured 1, pattern 0.75, anecdote or none 0.5), ÷ open claims. A claim with no verdict lowers confidence.',
      freshness: 'records', module: 'experiments' },
    { key: 'paying_demand', label: 'Paying demand', group: 'demand', weight: 15, rule: { kind: 'steps', steps: [[1, 40], [2, 70], [5, 100]] },
      reads: 'Paid deposits and pilots, and confirmed pre-sales and letters of intent with an amount: 1 → 40, 2–4 → 70, 5 or more → 100.',
      freshness: 'records', module: 'demand-signals' },
    { key: 'would_pay', label: 'Would pay', group: 'demand', weight: 10, rule: { kind: 'share', full: 0.4 },
      reads: 'Confirmed would-pay signals ÷ ICP interviews: full at 40%.', freshness: 'records', module: 'demand-signals' },
    { key: 'waitlist', label: 'Waitlist against your bar', group: 'demand', weight: 5, rule: { kind: 'share', full: 1 },
      reads: 'Waitlist sign-ups ÷ the bar you set, capped at 100.', freshness: 'records', module: 'demand-signals' },
    { key: 'experiment_outcomes', label: 'Experiment outcomes', group: 'claims', weight: 5, rule: { kind: 'share', full: 1 },
      reads: 'Done experiments linked as evidence: the share that support.', freshness: 'records', module: 'experiments' },
    { key: 'product_pull', label: 'Product pull', group: 'demand', weight: 10,
      rule: { kind: 'marks', marks: { activation: 0.4, retention: 0.2, survey: 0.4 } },
      reads: 'Activation, week-4 retention and the "very disappointed" survey share, each full at its mark (40%, 20%, 40%), averaged.',
      freshness: 'connector', module: 'product-roadmap' },
  ],
});

/**
 * One collected input: the facts the collector read, before any scoring.
 * `raw` holds the figure the rule normalises; `meta` holds what the next-step
 * rule needs (counts of what is missing, a claim code, a theme title).
 */
export interface PmfInputFacts {
  key: PmfInputKey;
  /** False: "Not expected yet", out of every sum and of the coverage count. */
  applies: boolean;
  /** False: Not recorded, left out of the value. A recorded 0 is `recorded: true` with a 0 figure. */
  recorded: boolean;
  raw: { n?: number; of?: number; parts?: Record<string, number | null> };
  /** 0–1: the mean grade of the records behind the input (SCORING's table). */
  grade: number;
  grade_label: GradeLabel;
  /** The newest record's day, `YYYY-MM-DD`; staleness is decided against it. */
  as_of: string | null;
  source: { table: string; rows: number };
  /** The figure in words, as the row draws it ("10 of 14 ICP interviews"). */
  words: string;
  /** Why the input is Not recorded or Not expected yet. */
  reason: string | null;
  /** Records dated before the latest Pivot, left out (owner question 5 A). */
  before_pivot: number;
  /**
   * D1145 (#3031, RD16 B): its store could not be read. It applies, so it is
   * out of the value and lowers confidence and coverage, as Not recorded does,
   * but it says "Could not be read" and gets no next step.
   */
  unreadable?: boolean;
  meta?: Record<string, unknown>;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** An input's figure on 0–100, by its rule. Null when the figure cannot be formed. */
export function normalise(rule: PmfRule, raw: PmfInputFacts['raw']): number | null {
  const n = Number(raw.n);
  switch (rule.kind) {
    case 'count':
      return Number.isFinite(n) ? Math.round(clamp01(n / rule.full) * 100) : null;
    case 'share': {
      const of = Number(raw.of);
      if (!Number.isFinite(n) || !Number.isFinite(of) || of <= 0) return null;
      return Math.round(clamp01(n / of / rule.full) * 100);
    }
    case 'steps': {
      if (!Number.isFinite(n)) return null;
      let v = 0;
      for (const [at, value] of rule.steps) if (n >= at) v = value;
      return v;
    }
    case 'marks': {
      const parts = Object.entries(rule.marks)
        .map(([k, mark]) => { const p = raw.parts?.[k]; return typeof p === 'number' && Number.isFinite(p) ? clamp01(p / mark) : null; })
        .filter((p): p is number => p != null);
      return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : null;
    }
  }
}

/** Whether an input's newest record is past its freshness window. */
export function isStale(model: PmfModel, input: PmfModelInput, asOf: string | null, today: string): boolean {
  if (!asOf) return false;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(age) && age > model.freshness_days[input.freshness];
}

export type PmfInputState = 'recorded' | 'not_recorded' | 'not_expected' | 'unreadable';

export interface PmfInputResult {
  key: PmfInputKey; label: string; group: PmfModelInput['group']; weight: number;
  state: PmfInputState;
  value: number | null;
  grade: GradeLabel; grade_factor: number; stale: boolean;
  /** Points this input adds to the value (its weighted share), or null when it is out. */
  contribution: number | null;
  words: string; reason: string | null;
  source: PmfInputFacts['source']; as_of: string | null; before_pivot: number;
  module: PmfModuleSlug;
}

export interface PmfStep {
  input: PmfInputKey;
  text: string;
  module: PmfModuleSlug;
  /** What doing it raises, as this model computes it. */
  gain: {
    value: number | null;            // "Up to +N" points, when both the before and after carry a number
    confidence: { from: string | null; to: string | null } | null;
    coverage: { from: number; to: number; of: number } | null;
  };
  /** The confidence change on 0–1, which ranks steps after the value gain. */
  confidence_delta: number;
}

export interface PmfResult {
  model: string;
  /** `scored`, or `not_enough` below the confidence floor (no value, no band). */
  state: 'scored' | 'not_enough';
  value: number | null;
  band: 'Strong' | 'Fair' | 'Weak' | null;
  confidence: number;
  confidence_word: 'High' | 'Medium' | 'Low' | null;
  coverage: { present: number; applies: number };
  inputs: PmfInputResult[];
  steps: PmfStep[];
}

function wordFor<T extends string>(table: ReadonlyArray<readonly [number, T]>, x: number): T | null {
  for (const [at, word] of table) if (x >= at) return word;
  return null;
}

/** The score without its next steps (the steps call this to price each one). */
export function computePmf(inputs: readonly PmfInputFacts[], model: PmfModel = PMF_MODEL_V1, today: string): Omit<PmfResult, 'steps'> {
  const by = new Map(inputs.map((f) => [f.key, f]));
  const rows = model.inputs.map((mi): PmfInputResult & { _v: number | null; _g: number; _applies: boolean } => {
    const f = by.get(mi.key);
    const applies = Boolean(f?.applies);
    const down = applies && Boolean(f?.unreadable);
    const value = f && applies && !down && f.recorded ? normalise(mi.rule, f.raw) : null;
    const state: PmfInputState = !applies ? 'not_expected' : down ? 'unreadable' : value == null ? 'not_recorded' : 'recorded';
    const stale = state === 'recorded' && isStale(model, mi, f!.as_of, today);
    const g = state === 'recorded' ? clamp01(f!.grade) * (stale ? 0.5 : 1) : 0;
    return {
      key: mi.key, label: mi.label, group: mi.group, weight: mi.weight, state, value,
      grade: state === 'recorded' ? f!.grade_label : 'not_recorded', grade_factor: round1(g * 100) / 100, stale,
      contribution: null,
      words: f?.words ?? 'Not recorded', reason: f?.reason ?? (f ? null : 'Not read'),
      source: f?.source ?? { table: '', rows: 0 }, as_of: f?.as_of ?? null, before_pivot: f?.before_pivot ?? 0,
      module: mi.module, _v: value, _g: g, _applies: applies,
    };
  });
  const applicable = rows.filter((r) => r._applies);
  const present = applicable.filter((r) => r._v != null);
  const wPresent = present.reduce((a, r) => a + r.weight, 0);
  const wApplies = applicable.reduce((a, r) => a + r.weight, 0);
  const value = wPresent > 0 ? present.reduce((a, r) => a + r.weight * (r._v as number), 0) / wPresent : null;
  const confidence = wApplies > 0 ? applicable.reduce((a, r) => a + r.weight * r._g, 0) / wApplies : 0;
  const enough = value != null && confidence >= model.floor;
  for (const r of rows) r.contribution = enough && r._v != null ? round1((r.weight * r._v) / wPresent) : null;
  return {
    model: model.version,
    state: enough ? 'scored' : 'not_enough',
    value: enough ? Math.round(value as number) : null,
    band: enough ? wordFor(model.bands, Math.round(value as number)) : null,
    confidence: Math.round(confidence * 100) / 100,
    confidence_word: wordFor(model.confidence, confidence),
    coverage: { present: present.length, applies: applicable.length },
    inputs: rows.map(({ _v, _g, _applies, ...r }) => r),
  };
}

// ---------------------------------------------------------------------------
// Next steps: one fixed rule per input
// ---------------------------------------------------------------------------

/**
 * A step a rule proposes: the sentence, the input as it would read once the
 * step is done, and the module where it is done when that is not the input's.
 */
type Proposal = { text: string; after: PmfInputFacts; module?: PmfModuleSlug };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const fullOf = (model: PmfModel, key: PmfInputKey) => {
  const r = model.inputs.find((i) => i.key === key)!.rule;
  return r.kind === 'count' || r.kind === 'share' ? r.full : 1;
};
/** The input once recorded with `raw`: at `grade` when given, else at its own grade (Sourced when it had none). */
const recordedAs = (f: PmfInputFacts, raw: PmfInputFacts['raw'], grade?: GradeLabel): PmfInputFacts => ({
  ...f, recorded: true, raw, grade: grade ? GRADES[grade] : (f.recorded ? f.grade : GRADES.sourced),
  grade_label: grade ?? (f.recorded ? f.grade_label : 'sourced'), reason: null,
});

/**
 * The fixed rule per input (#2433 § Next steps). Each lists the steps it can
 * ask for, in its own order; `scorePmf` keeps the first that moves the score
 * and drops the rest, so an input gives at most one step. The `after` facts
 * are the best case the step can reach, so its value gain is an "up to".
 */
export const STEP_RULES: Readonly<Record<PmfInputKey, (f: PmfInputFacts, model: PmfModel) => Proposal[]>> = Object.freeze({
  icp_interviews: (f, model) => {
    const full = fullOf(model, 'icp_interviews');
    const n = num(f.raw.n);
    const out: Proposal[] = [];
    if (n < full) {
      const k = Math.max(1, Math.min(5, full - n));
      out.push({
        text: n === 0 ? 'Log your first interviews with people who fit your ICP' : `Interview ${plural(k, 'more person', 'more people')} who fit your ICP`,
        after: recordedAs(f, { n: n + k }),
      });
    }
    if (f.recorded && f.grade < GRADES.measured) {
      out.push({ text: 'Record your next interview as a session', after: recordedAs(f, f.raw, 'measured'), module: 'record' });
    }
    return out;
  },
  icp_coverage: (f) => {
    const n = num(f.raw.n); const of = num(f.raw.of);
    if (!f.recorded || of <= n) return [];
    return [{ text: `Record the fit and the segment on ${plural(of - n, 'interview', 'interviews')}`, after: recordedAs(f, { n: of, of }) }];
  },
  pain_frequency: (f, model) => {
    if (!f.recorded) return [{ text: 'Log the pains each ICP interview names', after: recordedAs(f, { n: 1, of: 1 }), module: 'customer-research' }];
    const n = num(f.raw.n); const of = num(f.raw.of);
    const need = Math.ceil(fullOf(model, 'pain_frequency') * of);
    if (n >= need) return [];
    const theme = typeof f.meta?.top_theme === 'string' ? f.meta.top_theme : 'the top pain';
    return [{ text: `Hear "${theme}" from ${plural(need - n, 'more ICP interview', 'more ICP interviews')}`, after: recordedAs(f, { n: need, of }) }];
  },
  pain_severity: (f) => {
    const unjudged = num(f.meta?.unjudged);
    if (unjudged <= 0) return [];
    const n = num(f.raw.n); const of = num(f.raw.of);
    return [{ text: `Judge the severity on ${plural(unjudged, 'interview', 'interviews')}`, after: recordedAs(f, { n: n + unjudged, of: of + unjudged }) }];
  },
  claims_supported: (f) => {
    const fitUnrecorded = Array.isArray(f.meta?.fit_unrecorded) ? (f.meta!.fit_unrecorded as Array<{ code: string; interviews: number }>) : [];
    const untested = Array.isArray(f.meta?.untested) ? (f.meta!.untested as string[]) : [];
    const open = num(f.meta?.open);
    if (open === 0) return [{ text: 'Write the claim you most need to be true', after: recordedAs(f, { n: 1, of: 1 }) }];
    // The best case: every open claim Supported, at the grade of the interviews behind them.
    const best = { ...recordedAs(f, { n: open, of: open }), grade: Math.max(f.grade, num(f.meta?.decided_grade)) };
    const out: Proposal[] = [];
    for (const c of fitUnrecorded.slice(0, 1)) {
      out.push({ text: `Record the ICP fit on ${plural(c.interviews, 'interview', 'interviews')} behind ${c.code}`, after: best, module: 'customer-research' });
    }
    for (const code of untested.slice(0, 1)) out.push({ text: `Link evidence to ${code}`, after: best });
    if (f.recorded && num(f.raw.n) < num(f.raw.of)) {
      const weak = typeof f.meta?.weakest === 'string' ? f.meta.weakest : null;
      out.push({ text: weak ? `Back ${weak} with measured evidence` : 'Back your claims with measured evidence', after: best });
    }
    return out;
  },
  paying_demand: (f) => {
    const n = num(f.raw.n);
    const waiting = num(f.meta?.to_confirm);
    const unsourced = num(f.meta?.unsourced);
    const out: Proposal[] = [];
    if (waiting > 0) out.push({ text: `Confirm the ${plural(waiting, 'signal', 'signals')} waiting`, after: recordedAs(f, { n: n + waiting }) });
    if (f.recorded && unsourced > 0) {
      out.push({
        text: unsourced === 1 ? 'Attach the letter to raise confidence' : `Attach the files to ${unsourced} letters and pre-sales`,
        after: { ...f, grade: Math.max(f.grade, num(f.meta?.attach_grade)) },
      });
    }
    if (n < 5) {
      out.push({
        text: n === 0 ? 'Record a paid pilot, a pre-sale or a letter of intent' : 'Record another paid pilot, pre-sale or letter of intent',
        after: recordedAs(f, { n: n + 1 }),
      });
    }
    return out;
  },
  would_pay: (f, model) => {
    const waiting = num(f.meta?.to_confirm);
    const n = num(f.raw.n); const of = num(f.raw.of);
    const out: Proposal[] = [];
    if (waiting > 0 && of > 0) {
      out.push({ text: `Confirm the ${plural(waiting, 'would-pay signal', 'would-pay signals')} waiting`, after: recordedAs(f, { n: n + waiting, of }) });
    }
    const need = Math.ceil(fullOf(model, 'would_pay') * of);
    if (of > 0 && n < need) out.push({ text: 'Ask the next ICP interviews whether they would pay', after: recordedAs(f, { n: need, of }) });
    return out;
  },
  waitlist: (f) => {
    const signups = num(f.meta?.signups);
    const bar = num(f.meta?.bar);
    if (bar <= 0) return [{ text: 'Set the bar for waitlist sign-ups', after: recordedAs(f, { n: signups, of: Math.max(1, signups) }) }];
    if (signups >= bar) return [];
    return [{ text: `Grow the waitlist to your bar of ${bar}`, after: recordedAs(f, { n: bar, of: bar }) }];
  },
  experiment_outcomes: (f) => {
    if (!f.recorded) return [{ text: 'Close an experiment and link its result as evidence', after: recordedAs(f, { n: 1, of: 1 }, 'stated') }];
    return [];
  },
  // Product pull waits for PostHog's metrics (#2409): no step can raise it until they are read.
  product_pull: () => [],
});

/** What a step raises: its value gain ("up to"), the confidence change and the coverage change. */
function gainOf(base: Omit<PmfResult, 'steps'>, after: Omit<PmfResult, 'steps'>) {
  const valueGain = base.value != null && after.value != null ? after.value - base.value : null;
  const coverageMoved = after.coverage.present !== base.coverage.present;
  return {
    value: valueGain != null && valueGain > 0 ? valueGain : null,
    confidence: after.confidence_word !== base.confidence_word ? { from: base.confidence_word, to: after.confidence_word } : null,
    coverage: coverageMoved ? { from: base.coverage.present, to: after.coverage.present, of: after.coverage.applies } : null,
    confidence_delta: Math.round((after.confidence - base.confidence) * 100) / 100,
  };
}

/** The score, its inputs and its next steps, ranked by the gain each would bring. */
export function scorePmf(inputs: readonly PmfInputFacts[], model: PmfModel = PMF_MODEL_V1, today: string): PmfResult {
  const base = computePmf(inputs, model, today);
  const steps: PmfStep[] = [];
  for (const mi of model.inputs) {
    const f = inputs.find((x) => x.key === mi.key);
    if (!f || !f.applies || f.unreadable) continue;
    for (const p of STEP_RULES[mi.key](f, model)) {
      const g = gainOf(base, computePmf(inputs.map((x) => (x.key === mi.key ? p.after : x)), model, today));
      if (g.value == null && g.confidence_delta <= 0 && !g.coverage) continue;
      const { confidence_delta, ...gain } = g;
      steps.push({ input: mi.key, text: p.text, module: p.module ?? mi.module, gain, confidence_delta });
      break;
    }
  }
  // Ranked by gain: the value first, then confidence, then coverage; the model's order breaks ties.
  steps.sort((a, b) => (b.gain.value ?? 0) - (a.gain.value ?? 0) || b.confidence_delta - a.confidence_delta
    || Number(Boolean(b.gain.coverage)) - Number(Boolean(a.gain.coverage)));
  return { ...base, steps };
}

/** A step's link to its module, with `?project=`. */
export function stepHref(module: PmfModuleSlug, projectId: number): string {
  if (module === 'record') return `/validate/record?project=${projectId}`;
  if (module === 'product-roadmap') return `/build/product-roadmap?project=${projectId}`;
  return `/validate/${module}?project=${projectId}`;
}
