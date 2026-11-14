/**
 * A recorded value's grades and a block's binding to its record (D896,
 * #2675), with nothing else: no read, no import. Moved here from `sources.ts`
 * for D1536 (#3785), so `slideModel.ts` (and, through it, a deck generation
 * step run by the queue) shapes a binding without importing the readers of a
 * venture's records, member bank data among them
 * (`mercury_member_privacy_d752.test.mjs`). `sources.ts` re-exports all three.
 */

/** The grades a recorded value can carry, strongest first. D1520: Projected is a forecast's, and only a forecast's. */
export const GRADES = ['Measured', 'Reviewed', 'Sourced', 'Stated', 'Projected'] as const;

export type Binding = { source_key: string; record_ref?: string | null; as_of?: string | null; grade?: string | null; snapshot_hash?: string | null };

const BINDING_GRADES = new Set<string>([...GRADES, 'Not recorded']);

/**
 * A block's binding as a save keeps it (#2675; `decks.ts` sanitizers): the
 * five keys and nothing else, each bounded, or null when the source key is
 * not one a slot could name. A malformed binding is dropped, never repaired.
 */
export function sanitizeBinding(b: unknown): Binding | null {
  if (!b || typeof b !== 'object') return null;
  const x = b as Record<string, unknown>;
  const key = typeof x.source_key === 'string' ? x.source_key : '';
  // A slot is `area.slot`; a chart series adds its cadence or origin (`grow.mrr.monthly`, `chartSeries.ts`).
  // D898 §8.7 (#3658): the one-dot rule dropped every bound chart series on save.
  if (!/^[a-z]+\.[a-z0-9_]{1,48}(\.[a-z0-9_]{1,24})?$/.test(key)) return null;
  const ref = typeof x.record_ref === 'string' && x.record_ref.length <= 120 ? x.record_ref : null;
  const asOf = typeof x.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.as_of) ? x.as_of : null;
  const grade = typeof x.grade === 'string' && BINDING_GRADES.has(x.grade) ? x.grade : null;
  const hash = typeof x.snapshot_hash === 'string' && /^[0-9a-f]{24}$/.test(x.snapshot_hash) ? x.snapshot_hash : null;
  return { source_key: key, record_ref: ref, as_of: asOf, grade, snapshot_hash: hash };
}
