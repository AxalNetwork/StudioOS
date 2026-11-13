import React from 'react';
import { Link } from 'react-router-dom';
import { SeamChip } from '../../../workspaces/WorkspaceShell';
import { NothingYet } from '../expertise/kit';

// `StatedLimit` moved into the shared kit beside `ZoneBody` when Network needed
// it too. Re-exported rather than re-imported at four call sites, and never
// re-implemented: two copies of a sentence is how two versions of it appear.
export { StatedLimit } from '../expertise/kit';

/**
 * Bucket-local pieces for Cohorts. Composition only — the four-state body,
 * the empty card and the absent marker all come from `../expertise/kit`, which
 * is the one implementation and stays that way.
 */

/**
 * The seam, stated rather than decorated.
 *
 * `SeamChip`'s own contract is that the chip never appears alone: it always
 * carries a sentence naming (a) that the data is read-only and (b) whose
 * record it actually is. Both existing usages do that, and this keeps the rule
 * as one component rather than three copies of a paragraph.
 */
export function FromTheLab({ children }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-axal-faint">
      <SeamChip>From the founder</SeamChip>
      {children || 'read-only — cohort data belongs to the Lab and to the founder, never to the practice'}
    </p>
  );
}

/**
 * What an advisor sees when no admin has put them in front of a batch.
 *
 * NOT AN EMPTY LIST, and that distinction is the whole reason this component
 * exists. The worker returns 403 here, not `[]` — access was refused, and
 * rendering "no founders" would report a boundary as a fact about the cohort.
 */
export function NoBatch({ detail }) {
  return (
    <NothingYet
      title="No cohort has been assigned to you"
      body={detail || 'An admin decides which cohort an advisor advises. Until one is assigned, there is no batch here to show — this is a boundary, not an empty cohort.'}
      action={(
        <p className="flex flex-wrap gap-3 text-[12px]">
          <Link to="/practice/opportunities" className="text-emerald-700 underline">Your own client list →</Link>
        </p>
      )}
    />
  );
}

// D4813: the per-zone batch picker is gone. One cohort is selected for the
// whole workspace in the header (`CohortWorkspace.jsx`, `?cohort=`), and the
// name of a cohort comes from the model so the header and the zones agree.
export { cohortLabel } from './cohortModel';

export const WEEK_TONE = {
  passed: 'ok',
  failed: 'danger',
  grace: 'warn',
  pending: 'neutral',
};
