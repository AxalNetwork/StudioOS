/**
 * D4586 (#4586) — Validate methodology v2, as pure functions: the executable
 * form of `documentation/architecture/decisions/D4586.md`, merged after the
 * owner's review. The boundary outcomes the document tabulates are this code's
 * outputs and are pinned by `cloudflare-worker/test/validate_methodology_4586.test.ts`.
 *
 * WIRED SO FAR (part 2): `decisionEvidenceV2` is the decision's evidence bar in
 * `recordDecision` (`services/verdict.ts`), which records the methodology
 * version and the links that did not count. Claim status is still v1
 * (`verdictFor` in `routes/_founder_validate_helpers.ts`) until its own slice
 * moves it to `claimStatusV2`.
 *
 * FOUR SEPARATE THINGS, never merged into one number:
 *   coverage     how much evidence there is, in named units (links, sources,
 *                interviews, interviewees, organizations);
 *   direction    supporting and contradicting, always shown together;
 *   sufficiency  whether a claim's computed status, or a decision's evidence
 *                bar, is met;
 *   decision     the founder's Proceed, Pivot or Stop, with their reasoning.
 *                Nothing here chooses it; a withheld decision is still theirs.
 *
 * A source count is not statistical proof. The status words say what the
 * interviews show against a fixed bar, not that a claim is true.
 */

export const METHODOLOGY_VERSION = 2;
/** Supporting ICP interviews a claim needs before it can read as supported (unchanged from v1). */
export const CLAIM_BAR = 5;
/** Distinct counted sources a decision needs before it is given rather than withheld (unchanged from v1). */
export const DECISION_BAR = 5;

/** v2 claim statuses. v1's names in brackets: supported (validated), contradicted (invalidated), insufficient (unproven), unknown (null). `contested` is new. */
export type ClaimStatusV2 = 'supported' | 'contested' | 'contradicted' | 'insufficient' | 'unknown';

export type ClaimCounts = {
  /** Distinct ICP (strong or partial) interviews that support the claim. */
  supporting: number;
  /** Distinct interviews, of any fit, that contradict it. */
  contradicting: number;
  /** Distinct interviews touching the support side whose ICP fit was never recorded. */
  fitUnrecorded: number;
  /** Interviews that touch both directions; already inside both counts above, reported, never dropped. */
  both?: number;
};

/** Contradiction is material once there are at least two and at least one for every two supporters. */
export const materialContradiction = (supporting: number, contradicting: number) =>
  contradicting >= 2 && contradicting * 2 >= supporting;

function statusAt(supporting: number, contradicting: number, bar: number): Exclude<ClaimStatusV2, 'unknown'> {
  // CONTRADICTION IS READ BEFORE THE BAR (v1 read the bar first, so 5 / 50 was "validated").
  if (contradicting >= 2 && contradicting > supporting) return 'contradicted';
  if (supporting >= bar) return materialContradiction(supporting, contradicting) ? 'contested' : 'supported';
  return 'insufficient';
}

/**
 * A claim's computed status under v2. Unknown fit makes the status `unknown`
 * only when counting those interviews as ICP would change it; otherwise the
 * status stands and the page still says how many fits are missing.
 */
export function claimStatusV2(c: ClaimCounts, bar: number = CLAIM_BAR): ClaimStatusV2 {
  const known = statusAt(c.supporting, c.contradicting, bar);
  if (c.fitUnrecorded > 0 && statusAt(c.supporting + c.fitUnrecorded, c.contradicting, bar) !== known) return 'unknown';
  return known;
}

// ---------------------------------------------------------------------------
// Coverage and the decision's evidence bar
// ---------------------------------------------------------------------------

export type EvidenceRow = {
  /** The link key, as `evidenceFor` gives it (`pain-<link>-<interview>`, `evidence-<link>`). */
  id: string;
  kind: 'interview' | 'signal' | 'metric' | 'experiment';
  /** The record behind the link: an interview id, a signal ref, a metric key, an experiment id. */
  ref_id: string;
  hypothesis_id: number;
  direction: 'supports' | 'contradicts';
  /** Experiments only: whether a result was recorded. Planned, running, or done without a result is `false`. */
  observed?: boolean;
};

/**
 * The underlying record a link points at. Two links to one interview (a pain
 * link and a direct link, or two claims' pain links) are one source.
 */
export const sourceKey = (r: Pick<EvidenceRow, 'kind' | 'ref_id'>) => `${r.kind}:${r.ref_id}`;

export type Exclusion = 'other_hypothesis' | 'no_observed_result' | 'duplicate_source';

export type DecisionEvidence = {
  methodology_version: number;
  /** Links checked: every relationship, five links to one interview are five. */
  links: number;
  /** Distinct underlying records among them: five links to one interview are one. */
  sources: number;
  /** Distinct sources that count toward the bar. */
  counted: number;
  /** Counted sources with a supporting link, and with a contradicting link. A source with both is in both. */
  counted_supporting: number;
  counted_contradicting: number;
  /** Distinct interviews among the counted sources. */
  interviews: number;
  /** Distinct interviewees and organizations behind those interviews; null where the field is not recorded on every one. */
  interviewees: number | null;
  organizations: number | null;
  /** Each checked link that did not count, with why. It stays in the decision's snapshot. */
  excluded: { id: string; reason: Exclusion }[];
  bar: number;
  state: 'given' | 'withheld';
};

const norm = (v: string | null | undefined) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '');

/**
 * Which of the founder's checked evidence counts toward a decision's bar.
 *
 *   - A hypothesis-level decision counts only evidence linked to that
 *     hypothesis; a venture-level decision counts every claim's evidence.
 *   - An experiment counts only once it has an observed result.
 *   - Each underlying source counts once, whichever links reached it.
 *   - Contradicting evidence counts like supporting evidence: it can be the
 *     reason for a Pivot or a Stop.
 * Excluded links are kept and named, never silently dropped. `people` maps an
 * interview id to its interviewee name and company, read only to count
 * distinct values; neither is returned.
 */
export function decisionEvidenceV2(
  rows: EvidenceRow[], scope: 'venture' | number,
  people: Map<string, { name: string | null; company: string | null }> = new Map(),
  bar: number = DECISION_BAR,
): DecisionEvidence {
  const allSources = new Set(rows.map(sourceKey));
  const counted = new Map<string, EvidenceRow>();
  // A source reached by links in both directions counts once toward the bar
  // and appears in both direction counts: it is not dropped from either side.
  const directions = new Map<string, Set<EvidenceRow['direction']>>();
  const excluded: DecisionEvidence['excluded'] = [];
  for (const r of rows) {
    if (scope !== 'venture' && Number(r.hypothesis_id) !== Number(scope)) { excluded.push({ id: r.id, reason: 'other_hypothesis' }); continue; }
    if (r.kind === 'experiment' && r.observed !== true) { excluded.push({ id: r.id, reason: 'no_observed_result' }); continue; }
    const key = sourceKey(r);
    if (!directions.has(key)) directions.set(key, new Set());
    directions.get(key)!.add(r.direction);
    if (counted.has(key)) { excluded.push({ id: r.id, reason: 'duplicate_source' }); continue; }
    counted.set(key, r);
  }
  const kept = [...counted.values()];
  const withDirection = (d: EvidenceRow['direction']) => [...directions.values()].filter((set) => set.has(d)).length;
  const ivIds = kept.filter((r) => r.kind === 'interview').map((r) => r.ref_id);
  const distinct = (pick: (p: { name: string | null; company: string | null }) => string | null) => {
    if (!ivIds.length) return 0;
    const vals = ivIds.map((id) => norm(pick(people.get(id) ?? { name: null, company: null })));
    return vals.some((v) => !v) ? null : new Set(vals).size;
  };
  return {
    methodology_version: METHODOLOGY_VERSION,
    links: rows.length,
    sources: allSources.size,
    counted: kept.length,
    counted_supporting: withDirection('supports'),
    counted_contradicting: withDirection('contradicts'),
    interviews: new Set(ivIds).size,
    interviewees: distinct((p) => p.name),
    organizations: distinct((p) => p.company),
    excluded,
    bar,
    state: kept.length >= bar ? 'given' : 'withheld',
  };
}
