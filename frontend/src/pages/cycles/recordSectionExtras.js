/**
 * D6862 (#6862) — a part a record section draws below its own rows, by cycle,
 * module and section key. Each part is its own chunk, loaded only on its
 * record. `RecordView.jsx` reads this.
 *
 * Validate › Verdict's Memo section: who the decision is shared with, Revoke
 * and Share with… (`DecisionShares.jsx`, D6021 V19).
 */
import { lazy } from 'react';

const DecisionShares = lazy(() => import('./DecisionShares.jsx'));

/** The part for this record's section, or null. */
export function sectionExtra(record, section) {
  if (record?.cycle === 'validate' && record?.module === 'verdict' && section?.key === 'memo' && record?.id != null) return DecisionShares;
  return null;
}
