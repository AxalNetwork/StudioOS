/**
 * D5080 (#5080) — completeness for a fact derived from more than one source.
 *
 * Source states remain the platform vocabulary from `sourceState.ts`. A
 * derived summary adds `partial`: at least one required source answered and
 * at least one could not answer. This prevents a failed read from becoming a
 * measured zero, “none”, “all”, or “every”.
 */
import type { SourceState } from './sourceState';

export type DerivedSummarySource = {
  key: string;
  state: SourceState;
  required?: boolean;
};

export type DerivedSummaryState = 'recorded' | 'partial' | 'unreadable' | 'not_recorded';

export type DerivedSummary<T> = {
  state: DerivedSummaryState;
  value: T | null;
  complete: boolean;
  sources: DerivedSummarySource[];
  unreadable_sources: string[];
};

const failed = (state: SourceState) => state === 'unreadable' || state === 'unavailable';

/**
 * Describe a derived value without changing it. Callers decide the value;
 * this function decides whether that value is authoritative.
 */
export function derivedSummary<T>(value: T | null, sources: DerivedSummarySource[]): DerivedSummary<T> {
  const required = sources.filter((source) => source.required !== false);
  const unreadable = required.filter((source) => failed(source.state)).map((source) => source.key);
  const answered = required.length - unreadable.length;
  const state: DerivedSummaryState = unreadable.length
    ? answered > 0 ? 'partial' : 'unreadable'
    : value == null ? 'not_recorded' : 'recorded';
  return {
    state,
    value: state === 'unreadable' ? null : value,
    complete: unreadable.length === 0,
    sources: sources.map((source) => ({ ...source })),
    unreadable_sources: unreadable,
  };
}
