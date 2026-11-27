/**
 * D7729 (#7729, canvas D7703-p2) — the pieces the study frame, its sections
 * and the New research form share: the "Started from" lines (RST-02, RST-03),
 * the project's Overview texts shown read-only with Edit on Overview (RST-01),
 * a section's heading, and the classes they are drawn with.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { DataState, StateChip } from '../../../ui/Honesty';
import { originFilterWords } from './studyModel.js';

export const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
export const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-[13px] font-bold text-white hover:bg-violet-800 disabled:opacity-50 sm:min-h-[36px] dark:bg-violet-600 dark:hover:bg-violet-700';
export const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const TEXT_BTN = 'inline-flex min-h-[44px] items-center px-1 text-[12.5px] font-bold text-violet-700 hover:underline disabled:opacity-50 sm:min-h-[32px] dark:text-violet-300';
export const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export const H2 = 'text-[15px] font-extrabold text-axal-ink dark:text-white';
export const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
export const DT = 'text-[11.5px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400';
export const DD = 'text-[13px] text-axal-ink dark:text-gray-100';

/** A stored text, or Not recorded. */
export function Shown({ value, reason }) {
  return value ? <span className="whitespace-pre-wrap">{value}</span> : <DataState state="not_recorded" reason={reason} reasonVisible={Boolean(reason)} />;
}

/** "Market X · tracked sector Y" and the Markets filters, labelled as company location. */
export function OriginLines({ market, sector, filters }) {
  const words = originFilterWords(filters);
  return (
    <>
      <span>
        Market <b>{market}</b> · tracked sector{' '}
        {sector?.state === 'tracked' && sector.name ? <b>{sector.name}</b> : <DataState state="none">None</DataState>}
      </span>
      <span data-testid="origin-filters">
        <b>Markets filters: where listed companies are based</b>
        {words.length ? words.map(([k, v]) => <span key={k}> · {k} <b>{v}</b></span>) : <span> · none in force</span>}
      </span>
    </>
  );
}

/** RST-01: the project's question, objective, scope and exclusions, edited on Overview only (D5157). */
export function FromOverview({ project, archived }) {
  const rows = [['Question', project?.question], ['Objective', project?.objective], ['Scope', project?.scope], ['Excluded', project?.exclusions]];
  return (
    <section className={CARD} aria-labelledby="study-overview-h" data-testid="study-from-overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="study-overview-h" className="text-[14px] font-extrabold text-axal-ink dark:text-white">
          From Overview <span className="text-[12px] font-medium text-axal-muted dark:text-gray-400">read-only here</span>
        </h3>
        {archived || !project?.uid ? null : <Link className={SECONDARY} to={`/research/projects/${encodeURIComponent(project.uid)}`} data-testid="link-edit-on-overview">Edit on Overview</Link>}
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[120px_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className={DT}>{k}</dt>
            <dd className={DD}><Shown value={v} /></dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
}

/** "Archived: read-only." (RST-01 D). */
export function ArchivedNote() {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" data-testid="study-archived">
      <StateChip kind="not_applicable" label="Archived" />
      <span><b>Archived: read-only.</b> Restore the project to edit its study. Nothing here can be saved, added or removed.</span>
    </div>
  );
}
