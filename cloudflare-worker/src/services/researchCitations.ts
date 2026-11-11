/**
 * D4613 (#4613): checks an Ask answer's bracketed references against the
 * sources the model was given, so a cited passage, a retrieved passage the
 * answer never cites, and a reference to a source that was never supplied are
 * three different things on the page.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. A reference that names a supplied
 * source is a REFERENCE that resolves, nothing more: it does not show that the
 * passage supports the sentence it sits in. `claim_support` is therefore always
 * `not_verified`, and no surface may call a resolved reference "verified
 * support". A claim-level check needs its own contract and fixtures (#4613).
 */

export interface CitedSource { n?: number | null; [key: string]: unknown }

export type ReferenceStatus =
  /** No answer text: nothing was written, so nothing cites anything. */
  | 'no_answer'
  /** An answer with no bracketed reference at all. */
  | 'none_cited'
  /** Every reference names a source the model was given. */
  | 'resolved'
  /** At least one reference names a source the model was never given. */
  | 'invalid_refs';

export interface ReferenceCheck {
  status: ReferenceStatus;
  /** Source numbers the answer cites that were supplied, ascending. */
  cited: number[];
  /** Numbers the answer cites that name no supplied source, ascending. */
  invalid: number[];
  /** Supplied sources the answer never cites, ascending. */
  uncited: number[];
  /** Always: a resolved reference is not proof the passage supports the claim. */
  claim_support: 'not_verified';
}

/** A range like [2-40] expands to at most this many numbers; past it, the ends alone count. */
const MAX_RANGE = 20;

/**
 * Every source number the text cites: `[1]`, `[1, 3]`, `[1][2]`, `[2-4]`.
 * Only bracketed digits count; `[see note]` and markdown links do not.
 */
export function citedNumbers(text: string | null | undefined): number[] {
  const out = new Set<number>();
  const src = String(text || '');
  for (const m of src.matchAll(/\[(\d{1,4}(?:\s*[,;–-]\s*\d{1,4})*)\]/g)) {
    for (const part of m[1].split(/\s*[,;]\s*/)) {
      const range = part.split(/\s*[–-]\s*/).map(Number);
      if (range.length === 2 && range[1] >= range[0] && range[1] - range[0] < MAX_RANGE) {
        for (let k = range[0]; k <= range[1]; k += 1) out.add(k);
      } else {
        for (const k of range) if (Number.isInteger(k)) out.add(k);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The number a stored citation carries, or its 1-based position when it was stored without one. */
const numberOf = (c: CitedSource, i: number) => (Number.isInteger(c?.n) && (c.n as number) > 0 ? (c.n as number) : i + 1);

export function referenceCheck(answer: string | null | undefined, citations: CitedSource[]): ReferenceCheck {
  const supplied = (Array.isArray(citations) ? citations : []).map(numberOf);
  const suppliedSet = new Set(supplied);
  if (!String(answer || '').trim()) {
    return { status: 'no_answer', cited: [], invalid: [], uncited: [...suppliedSet].sort((a, b) => a - b), claim_support: 'not_verified' };
  }
  const refs = citedNumbers(answer);
  const cited = refs.filter((n) => suppliedSet.has(n));
  const invalid = refs.filter((n) => !suppliedSet.has(n));
  const citedSet = new Set(cited);
  const uncited = [...suppliedSet].filter((n) => !citedSet.has(n)).sort((a, b) => a - b);
  const status: ReferenceStatus = invalid.length ? 'invalid_refs' : cited.length ? 'resolved' : 'none_cited';
  return { status, cited, invalid, uncited, claim_support: 'not_verified' };
}

/**
 * The stored citations, each marked with whether the answer cites it. A
 * passage the answer never names stays in the list as retrieved context,
 * marked `cited: false`, so the page can show it apart from cited support.
 */
export function markCited<T extends CitedSource>(answer: string | null | undefined, citations: T[]): Array<T & { cited: boolean }> {
  const check = referenceCheck(answer, citations);
  const citedSet = new Set(check.cited);
  return (Array.isArray(citations) ? citations : []).map((c, i) => ({ ...c, cited: citedSet.has(numberOf(c, i)) }));
}
