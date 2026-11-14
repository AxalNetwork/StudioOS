/**
 * D4531 slice 3 (#4531, section E) — a candidate's evaluation results against a baseline's, per case and per model.
 *
 * WHAT A REGRESSION IS HERE. A pass in the baseline that is a fail in the candidate, on the SAME case text, the SAME
 * model and the SAME evaluator version. Anything else is not a regression and is not called one:
 *   - the case text changed (a starter case shipped with new text, or a different HQ case uid): `case_changed`;
 *   - the evaluator changed (`JUDGE_VERSION` moved between the runs): `evaluator_changed`;
 *   - either side ran before the evaluator or case was recorded on the row (migration 202611090904): `not_recorded`;
 *   - one side has no result for that case and model: `only_baseline` / `only_candidate`;
 *   - either side is `not_run` (a transport or model refusal): `not_run`. A not_run is never a pass or a fail.
 *
 * WHAT CHANGED, SAID APART. The report counts each outcome per model, and its `attribution` says whether the two runs
 * were on an identical case set, model set and evaluator. Only when all three match is a difference in outcomes a
 * quality change; otherwise the report names what moved, so a higher pass rate on easier cases, another model or a
 * newer judge is not read as a better skill.
 *
 * Pure over the rows, so a test feeds it any history. The route reads the rows; nothing here touches D1.
 */

export type ResultRow = {
  case_key: string;
  case_name?: string | null;
  /** The case text's fingerprint, or null when it was not recorded. */
  case_sha256: string | null;
  model_id: string;
  result: 'pass' | 'fail' | 'not_run';
  evaluator_version: number | null;
  detail?: string | null;
  run_at?: string | null;
};

export type PairOutcome =
  | 'regressed' | 'improved' | 'still_pass' | 'still_fail'
  | 'case_changed' | 'evaluator_changed' | 'not_recorded' | 'not_run' | 'only_baseline' | 'only_candidate';

/** The outcomes that compare like with like. Every other outcome is "not comparable", with its reason. */
export const COMPARABLE: ReadonlySet<PairOutcome> = new Set(['regressed', 'improved', 'still_pass', 'still_fail']);

export type PairReport = {
  case_key: string;
  case_name: string | null;
  model_id: string;
  outcome: PairOutcome;
  baseline: { result: ResultRow['result']; evaluator_version: number | null; case_sha256: string | null; detail: string | null } | null;
  candidate: { result: ResultRow['result']; evaluator_version: number | null; case_sha256: string | null; detail: string | null } | null;
};

const side = (r: ResultRow | undefined) => (r
  ? { result: r.result, evaluator_version: r.evaluator_version, case_sha256: r.case_sha256, detail: r.detail ?? null }
  : null);

/** One case and model, baseline against candidate. */
export function pairOutcome(b: ResultRow | undefined, c: ResultRow | undefined): PairOutcome {
  if (!b) return 'only_candidate';
  if (!c) return 'only_baseline';
  if (b.result === 'not_run' || c.result === 'not_run') return 'not_run';
  if (b.evaluator_version == null || c.evaluator_version == null || b.case_sha256 == null || c.case_sha256 == null) return 'not_recorded';
  if (b.case_sha256 !== c.case_sha256) return 'case_changed';
  if (b.evaluator_version !== c.evaluator_version) return 'evaluator_changed';
  if (b.result === 'pass') return c.result === 'pass' ? 'still_pass' : 'regressed';
  return c.result === 'pass' ? 'improved' : 'still_fail';
}

const key = (r: Pick<ResultRow, 'case_key' | 'model_id'>) => `${r.case_key}\u0000${r.model_id}`;

/** The latest row per case and model, by `run_at` then input order (later wins). */
export function latestPerPair(rows: readonly ResultRow[]): Map<string, ResultRow> {
  const out = new Map<string, ResultRow>();
  for (const r of rows) {
    const k = key(r);
    const had = out.get(k);
    if (!had || String(r.run_at ?? '') >= String(had.run_at ?? '')) out.set(k, r);
  }
  return out;
}

export type CompareReport = {
  pairs: PairReport[];
  /** Per model: how many pairs had each outcome. */
  by_model: Record<string, Record<PairOutcome, number>>;
  totals: Record<PairOutcome, number>;
  regressions: PairReport[];
  attribution: {
    /** True only when the case set, the model set and the evaluator were identical, so outcomes moved by quality alone. */
    quality_only: boolean;
    cases: { same: boolean; added: string[]; removed: string[]; changed: string[] };
    models: { same: boolean; added: string[]; removed: string[] };
    evaluator: { same: boolean; baseline: number[]; candidate: number[]; not_recorded: boolean };
  };
};

const zero = (): Record<PairOutcome, number> => ({
  regressed: 0, improved: 0, still_pass: 0, still_fail: 0, case_changed: 0, evaluator_changed: 0,
  not_recorded: 0, not_run: 0, only_baseline: 0, only_candidate: 0,
});

/** Baseline rows against candidate rows: one report per case and model in either, never an aggregate alone. */
export function compareResults(baselineRows: readonly ResultRow[], candidateRows: readonly ResultRow[]): CompareReport {
  const b = latestPerPair(baselineRows);
  const c = latestPerPair(candidateRows);
  const keys = [...new Set([...b.keys(), ...c.keys()])].sort();
  const pairs: PairReport[] = keys.map((k) => {
    const x = b.get(k), y = c.get(k);
    const any = (y ?? x)!;
    return {
      case_key: any.case_key, case_name: (y?.case_name ?? x?.case_name) ?? null, model_id: any.model_id,
      outcome: pairOutcome(x, y), baseline: side(x), candidate: side(y),
    };
  });
  const totals = zero();
  const by_model: Record<string, Record<PairOutcome, number>> = {};
  for (const p of pairs) {
    totals[p.outcome] += 1;
    (by_model[p.model_id] ??= zero())[p.outcome] += 1;
  }

  // What the two runs were on: cases by key and text, models, evaluator versions.
  const casesOf = (m: Map<string, ResultRow>) => {
    const out = new Map<string, string | null>();
    for (const r of m.values()) if (!out.has(r.case_key) || r.case_sha256) out.set(r.case_key, r.case_sha256);
    return out;
  };
  const bc = casesOf(b), cc = casesOf(c);
  const added = [...cc.keys()].filter((k) => !bc.has(k)).sort();
  const removed = [...bc.keys()].filter((k) => !cc.has(k)).sort();
  const changed = [...cc.keys()].filter((k) => bc.has(k) && (bc.get(k) == null || cc.get(k) == null || bc.get(k) !== cc.get(k))).sort();
  const modelsOf = (m: Map<string, ResultRow>) => new Set([...m.values()].map((r) => r.model_id));
  const bm = modelsOf(b), cm = modelsOf(c);
  const mAdded = [...cm].filter((m) => !bm.has(m)).sort();
  const mRemoved = [...bm].filter((m) => !cm.has(m)).sort();
  const versions = (m: Map<string, ResultRow>) => [...new Set([...m.values()].map((r) => r.evaluator_version).filter((v): v is number => v != null))].sort((p, q) => p - q);
  const bv = versions(b), cv = versions(c);
  const evNotRecorded = [...b.values(), ...c.values()].some((r) => r.evaluator_version == null);
  const evSame = !evNotRecorded && bv.length === 1 && cv.length === 1 && bv[0] === cv[0];
  const casesSame = !added.length && !removed.length && !changed.length;
  const modelsSame = !mAdded.length && !mRemoved.length;
  return {
    pairs, by_model, totals,
    regressions: pairs.filter((p) => p.outcome === 'regressed'),
    attribution: {
      quality_only: casesSame && modelsSame && evSame && pairs.length > 0,
      cases: { same: casesSame, added, removed, changed },
      models: { same: modelsSame, added: mAdded, removed: mRemoved },
      evaluator: { same: evSame, baseline: bv, candidate: cv, not_recorded: evNotRecorded },
    },
  };
}
