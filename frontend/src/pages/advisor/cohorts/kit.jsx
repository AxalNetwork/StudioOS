import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { SeamChip } from '../../../workspaces/WorkspaceShell';
import { NothingYet } from '../expertise/kit';

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
    <p className="flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-axal-ink-3">
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

/**
 * The batch picker. Rendered only when there is more than one to pick from —
 * a single-option control is a decision nobody has.
 */
export function BatchPicker({ items, value, onChange }) {
  if (!items || items.length < 2) return null;
  return (
    <label className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Batch</span>
      <select
        className="rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {items.map((a) => (
          <option key={a.cohort_cycle_id} value={a.cohort_cycle_id}>{cohortLabel(a.cohort)}</option>
        ))}
      </select>
    </label>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function cohortLabel(cohort) {
  if (!cohort) return 'Cohort';
  const month = MONTHS[Number(cohort.month) - 1];
  return `${month || `Month ${cohort.month}`} ${cohort.year}`;
}

/**
 * A limit the page states about itself.
 *
 * Every one of these zones can answer less than the canvas asked for, and the
 * gap is a missing store rather than an oversight. Saying so on the page is
 * what stops a reader assuming the blank is their own data being empty.
 */
export function StatedLimit({ title, children }) {
  return (
    <Card variant="sunken" padding="md" className="mt-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        {title}
      </div>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">{children}</p>
    </Card>
  );
}

export const WEEK_TONE = {
  passed: 'ok',
  failed: 'danger',
  grace: 'warn',
  pending: 'neutral',
};
