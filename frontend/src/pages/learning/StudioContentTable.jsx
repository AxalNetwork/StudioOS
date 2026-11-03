import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Loader2 } from 'lucide-react';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { SectionCard, stateBlock } from './LearningStates';
import { CONTENT_STATUS_TONE, NOT_LIVE, formatDay } from './learningModel';
import { STORAGE_BANNER_LINE, STREAM_COPY_FIELD, storageBanner, stillOnStorage, streamCopyOf, videoColumn } from './videoUpload';
import { hasAnalytics } from './videoAnalyticsModel';

/** The canvas's five filters, each a predicate over a row. */
export const STUDIO_FILTERS = [
  { key: 'all', label: 'All kinds', test: () => true },
  { key: 'published', label: 'Published', test: (r) => r.status === 'published' },
  { key: 'draft', label: 'Draft', test: (r) => r.status === 'draft' },
  { key: 'archived', label: 'Archived', test: (r) => r.status === 'archived' },
  { key: 'program', label: 'Program-only', test: (r) => r.visibility === 'program' },
];

const GRID = 'sm:grid sm:grid-cols-[6rem_minmax(0,1fr)_6.5rem_6rem_minmax(0,0.8fr)_7.5rem_6.5rem] sm:items-center sm:gap-3';

/**
 * #4177 (lr16): Copy to Stream for one uploaded file, by its copy state
 * (`streamCopyOf`). THE STATE IS A GUESS PENDING L4 (#4179): it is drawn only
 * when the read carries `stream_copy`, and the button and "Try again" only
 * when the page passes `onCopy`, which no page does until L4's route exists.
 */
function CopyToStream({ row, onCopy }) {
  const state = streamCopyOf(row);
  if (state === 'copy') {
    return onCopy ? <button type="button" className="text-[12px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" onClick={() => onCopy(row)} data-testid={`button-copy-stream-${row.uid}`}>Copy to Stream</button> : null;
  }
  if (state === 'copying') {
    return <span className="inline-flex items-center gap-1 text-[12px] text-axal-muted dark:text-gray-400" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Copying…</span>;
  }
  if (state === 'verified') return <Pill tone="ok">Verified</Pill>;
  if (state === 'failed') {
    const said = row?.[STREAM_COPY_FIELD]?.error_message;
    return (
      <span className="text-[12px] text-red-700 dark:text-red-300" data-testid={`copy-failed-${row.uid}`}>
        {said ? <span className="block">{said}</span> : null}
        Copy failed{onCopy ? <> · <button type="button" className="font-semibold underline" onClick={() => onCopy(row)}>Try again</button></> : null}
      </span>
    );
  }
  return null;
}

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
 *
 * #4177 (lr16): the Video column (`videoColumn`: Stream · Ready, Uploaded
 * file, Link, None; "Not recorded" where the read cannot say), and, only when
 * the read carries L4's copy state, Copy to Stream per uploaded file and the
 * banner "[n] uploaded videos still play from storage."
 *
 * `onAnalytics(row)` (D4181, lr17) puts "Analytics" on a video's row, which
 * opens its analytics Sheet. A reading has no positions, so it has none.
 */
export default function StudioContentTable({ status, rows, reason = NOT_LIVE.studio, onRetry, onCopyToStream = null, onAnalytics = null }) {
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
  const onStorage = status === 'ready' ? stillOnStorage(all) : null;
  return (
    <SectionCard title="Content" meta={status === 'ready' && all.length ? `${visible.length} of ${all.length}` : null} testid="studio-content">
      {block || (
        <>
          {onStorage ? (
            <div className="mb-3 flex items-start gap-2 rounded-axal-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-amber-800 dark:bg-amber-900/20 dark:text-gray-200" role="status" data-testid="studio-storage-banner">
              <Info size={14} className="mt-0.5 flex-none text-axal-amber-deep dark:text-amber-300" aria-hidden="true" />
              <span><b>{storageBanner(onStorage)}</b> {STORAGE_BANNER_LINE}</span>
            </div>
          ) : null}
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
            <span>Kind</span><span>Title</span><span>Status</span><span>Visibility</span><span>Programs</span><span>Video</span><span>Updated</span>
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
                    {onAnalytics && hasAnalytics(r) ? (
                      <button type="button" onClick={() => onAnalytics(r)}
                        className="ml-2 text-[11.5px] font-bold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300"
                        aria-label={`Analytics for ${r.title || 'this video'}`} data-testid={`studio-analytics-open-${r.uid}`}>
                        Analytics
                      </button>
                    ) : null}
                  </span>
                  <span><Pill tone={CONTENT_STATUS_TONE[r.status] || 'neutral'}>{titleCase(r.status) || 'Status not recorded'}</Pill></span>
                  <span className="text-axal-muted dark:text-gray-400">{r.visibility ? titleCase(r.visibility) : <Unrecorded>Not recorded</Unrecorded>}</span>
                  <span className="text-axal-muted dark:text-gray-400">
                    {r.programs === null || r.programs === undefined
                      ? <Unrecorded reason="The content list does not say which programs hold this. Each program's page lists what it holds.">Not recorded</Unrecorded>
                      : r.programs.length ? r.programs.map((p) => p.name).join(', ') : 'None'}
                  </span>
                  <span className="space-y-1" data-testid={`studio-video-${r.uid}`}>
                    <VideoCell row={r} />
                    <CopyToStream row={r} onCopy={onCopyToStream} />
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

/** The Video column's cell: a video's source, "—" for anything that is not a video. */
function VideoCell({ row }) {
  if (row?.kind !== 'video') return <span className="text-axal-faint dark:text-gray-500">—</span>;
  const col = videoColumn(row);
  if (!col) return <Unrecorded reason="The content list does not say whether this video plays from Stream.">Not recorded</Unrecorded>;
  return <span className="block"><Pill tone={col[1]}>{col[0]}</Pill></span>;
}
