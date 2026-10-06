import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { SectionCard, stateBlock } from './LearningStates';
import { CONTENT_STATUS_TONE, NOT_LIVE, formatDay } from './learningModel';

/** The canvas's five filters, each a predicate over a row. */
export const STUDIO_FILTERS = [
  { key: 'all', label: 'All kinds', test: () => true },
  { key: 'published', label: 'Published', test: (r) => r.status === 'published' },
  { key: 'draft', label: 'Draft', test: (r) => r.status === 'draft' },
  { key: 'archived', label: 'Archived', test: (r) => r.status === 'archived' },
  { key: 'program', label: 'Program-only', test: (r) => r.visibility === 'program' },
];

const GRID = 'sm:grid sm:grid-cols-[6rem_minmax(0,1fr)_6.5rem_6rem_minmax(0,0.8fr)_6.5rem] sm:items-center sm:gap-3';

/**
 * Every piece of Learning content, for the Super Admin who authors it (D562;
 * items and courses #1158, exercises and exams #1160, the programs column
 * #1159; webinars have their own list beside it, `WebinarStudioList`).
 *
 * Props, in the shape the studio routes plan:
 *   status  'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   rows    [{ kind, uid, title, status, visibility: 'open' | 'program',
 *              programs: [{ uid, name }] | null, updated_at }]
 *
 * `programs: null` is a row whose list route does not say which programs
 * hold it (none of D557's or D559's lists does): "Not recorded", not "None",
 * because nobody has asked. Each program's own page lists what it holds.
 */
export default function StudioContentTable({ status, rows, reason = NOT_LIVE.studio, onRetry }) {
  const [filter, setFilter] = useState('all');
  const all = rows || [];
  const active = STUDIO_FILTERS.find((f) => f.key === filter) || STUDIO_FILTERS[0];
  const visible = all.filter(active.test);
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the content list',
    claim: 'This is not a claim that nothing has been authored.',
    isEmpty: all.length === 0,
    empty: { title: 'No content yet', body: 'Videos, courses, webinars, exercises and exams appear here once a Super Admin creates them.' },
  });
  return (
    <SectionCard title="Content" meta={status === 'ready' && all.length ? `${visible.length} of ${all.length}` : null} testid="studio-content">
      {block || (
        <>
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter content">
            {STUDIO_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`whitespace-nowrap rounded-axal-pill border px-3 py-1 text-[12px] font-medium ${filter === f.key
                  ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'border-axal-hairline text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:text-gray-300'}`}
                data-testid={`filter-studio-${f.key}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={`hidden border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:border-gray-800 dark:text-gray-500 ${GRID}`} aria-hidden="true">
            <span>Kind</span><span>Title</span><span>Status</span><span>Visibility</span><span>Programs</span><span>Updated</span>
          </div>
          {visible.length === 0 ? (
            <p className="py-4 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="studio-content-filtered-empty">No content matches this filter.</p>
          ) : (
            <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="studio-content-rows">
              {visible.map((r, i) => (
                <li key={r.uid || i} className={`grid grid-cols-2 gap-x-3 gap-y-1 py-2.5 text-[12.5px] ${GRID}`} data-testid={`studio-row-${r.uid}`}>
                  <span className="text-[10.5px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">{titleCase(r.kind) || 'Item'}</span>
                  <span className="col-span-2 font-semibold text-axal-ink sm:col-span-1 dark:text-gray-100">
                    {r.href
                      ? <Link to={r.href} className="hover:text-axal-violet-deep dark:hover:text-violet-300" data-testid={`link-studio-open-${r.uid}`}>{r.title || 'Untitled'}</Link>
                      : (r.title || 'Untitled')}
                  </span>
                  <span><Pill tone={CONTENT_STATUS_TONE[r.status] || 'neutral'}>{titleCase(r.status) || 'Status not recorded'}</Pill></span>
                  <span className="text-axal-muted dark:text-gray-400">{r.visibility ? titleCase(r.visibility) : <Unrecorded>Not recorded</Unrecorded>}</span>
                  <span className="text-axal-muted dark:text-gray-400">
                    {r.programs === null || r.programs === undefined
                      ? <Unrecorded reason="The content list does not say which programs hold this. Each program's page lists what it holds.">Not recorded</Unrecorded>
                      : r.programs.length ? r.programs.map((p) => p.name).join(', ') : 'None'}
                  </span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">{formatDay(r.updated_at) || 'not recorded'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}
