import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, StatedLimit, Unrecorded, ZoneBody, inputClass } from '../expertise/kit';
import { FromTheLab, NoBatch } from './kit';
import { CohortLoading, StatusBadge, useCohortRead, useCohortWorkspace } from './CohortWorkspace';
import { BOARD_COLUMNS, FOUNDER_STATES, dayTime, filterFounders, founderRows, needsAttention } from './cohortModel';

/**
 * Cohorts › Founders — founder triage for the selected cohort (D4813 boards C2,
 * C3, C13; package 1 of #4813).
 *
 * EXPLICIT STATES, NOT A PERCENTAGE. Every founder is Failed, Grace, At risk,
 * On track or Not assessed (`cohortModel.founderState`). A failed or grace
 * founder sits in Needs attention whatever their percentage, and progress that
 * cannot be read — no row, nothing required, an unreadable count — is Not
 * assessed, never 0%.
 *
 * THE BOARD'S COLUMNS ARE STATES (C2), and the four-week view is the Overview's
 * progress grid. D393's week lanes put every founder in the one lane of the
 * batch's current week, so three of four lanes always read "Nobody here yet";
 * the canvas replaced them, and so does this page.
 *
 * WHO IS LISTED IS THE WORKER'S DECISION. The founders read drops a founder who
 * opted out of this advisor and is refused without an active assignment; this
 * page filters nothing back in and adds nobody.
 *
 * LAST ACTIVITY IS WHAT IS RECORDED: the founder's latest recorded action on
 * this advisor's guidance. Submissions and sessions have no activity record
 * (D4813: new backend), so a founder with no guidance action reads "Not
 * recorded", never "never".
 *
 * COMPANY, STAGE, A LIVE SIGNAL AND YOUR NEXT ACTION ARE NOT DRAWN. The roster
 * returns name and email; the Lab records no venture for a founder here, no
 * stage and no live signal. Those columns are absent rather than empty, so a
 * blank is never mistaken for a founder with nothing going on.
 */

const VIEWS = [['board', 'Board'], ['table', 'Table']];
const STATUS_FILTERS = [
  ['all', 'All states'],
  ['attention', 'Needs attention'],
  ['failed', 'Failed'],
  ['grace', 'Grace'],
  ['at_risk', 'At risk'],
  ['on_track', 'On track'],
  ['not_assessed', 'Not assessed'],
];
const SORTS = [['attention', 'Needs attention first'], ['name', 'Name'], ['progress', 'Progress, lowest first'], ['deadline', 'Next deadline']];
const TH = 'px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

/** The latest recorded guidance action per founder. */
export function lastActivityByFounder(guidance) {
  const out = new Map();
  for (const g of guidance?.items || []) {
    for (const a of g.acted_by || []) {
      const t = Date.parse(a.acted_at);
      if (!Number.isFinite(t)) continue;
      const prev = out.get(Number(a.user_id));
      if (!prev || t > Date.parse(prev)) out.set(Number(a.user_id), a.acted_at);
    }
  }
  return out;
}

export function weekText(row) {
  if (row.week == null) return null;
  return row.held ? `Week ${row.week} · held` : `Week ${row.week}`;
}

/** Progress as a bar and a number, or Not assessed — never 0% for unknown. */
export function Progress({ row }) {
  if (row.pct == null) {
    return <span className="text-[11px] italic text-axal-faint" data-progress="none">— Not assessed</span>;
  }
  return (
    <span className="inline-flex min-w-[96px] items-center gap-2" data-progress={row.pct}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-axal-hairline dark:bg-gray-800" aria-hidden="true">
        <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${row.pct}%` }} />
      </span>
      <span className="text-[11px] font-bold tabular-nums">{`${row.pct}%`}</span>
    </span>
  );
}

function LastActivity({ at }) {
  return at ? <span>{`Acted on guidance · ${dayTime(at)}`}</span> : <Unrecorded />;
}

/** One founder, as a card (board columns, and the table on a phone). */
export function FounderCard({ row, lastAt, guidanceHref }) {
  return (
    <article className={`rounded-[10px] border p-3 ${needsAttention(row) ? 'border-amber-200 dark:border-amber-900' : 'border-axal-hairline dark:border-gray-800'} bg-white dark:bg-gray-900`} data-testid="founder-card" data-state={row.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-[12.5px] font-extrabold">{row.name || <Unrecorded>Name not recorded</Unrecorded>}</h3>
        <StatusBadge state={row.state} />
      </div>
      <div className="mt-1 text-[11px] text-axal-faint">{weekText(row) || <Unrecorded>Week not recorded</Unrecorded>}</div>
      <div className="mt-2"><Progress row={row} /></div>
      {row.reason && <p className="mt-2 text-[11.5px] leading-snug text-axal-muted">{row.reason}</p>}
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-axal-faint">Next</dt>
        <dd>{row.deadline ? dayTime(row.deadline) : <Unrecorded>No deadline recorded</Unrecorded>}</dd>
        <dt className="text-axal-faint">Last</dt>
        <dd><LastActivity at={lastAt} /></dd>
      </dl>
      <Link to={guidanceHref} className="mt-2 inline-flex min-h-[44px] items-center text-[12px] font-bold text-emerald-800 underline dark:text-emerald-300 lg:min-h-0">
        Write guidance
      </Link>
    </article>
  );
}

export function FounderTable({ rows, label, lastBy, guidanceHref }) {
  return (
    <Card padding="none" className="overflow-x-auto">
      <table className="w-full text-[12.5px]" data-testid="founder-table">
        <caption className="px-3 pt-2.5 text-left text-[11px] text-axal-faint">{`${rows.length} founder${rows.length === 1 ? '' : 's'} in ${label}`}</caption>
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-700">
            {['Founder', 'Cohort', 'Week', 'Progress', 'Status', 'Next deadline', 'Last activity', 'Action'].map((h) => (
              <th key={h} scope="col" className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id} className="border-b border-axal-hairline/60 align-top last:border-0 dark:border-gray-800" data-state={r.state}>
              <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                {r.name || <Unrecorded>Name not recorded</Unrecorded>}
                {r.email && <div className="text-[11px] font-normal text-axal-faint">{r.email}</div>}
              </th>
              <td className="px-3 py-2.5">{label}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{weekText(r) || <Unrecorded />}</td>
              <td className="px-3 py-2.5"><Progress row={r} /></td>
              <td className="px-3 py-2.5">
                <StatusBadge state={r.state} />
                {r.reason && <div className="mt-1 max-w-[240px] text-[11px] leading-snug text-axal-muted">{r.reason}</div>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">{r.deadline ? dayTime(r.deadline) : <Unrecorded />}</td>
              <td className="px-3 py-2.5"><LastActivity at={lastBy.get(Number(r.user_id))} /></td>
              <td className="px-3 py-2.5"><Link to={guidanceHref} className="font-bold text-emerald-800 underline dark:text-emerald-300">Write guidance</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function FoundersZone() {
  const ws = useCohortWorkspace();
  const [params, setParams] = useSearchParams();
  const founderParam = params.get('founder');
  const only = founderParam && /^[1-9]\d*$/.test(founderParam) ? Number(founderParam) : null;
  const [view, setView] = useState('board');
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [sort, setSort] = useState('attention');

  const roster = useCohortRead((id) => api.listMyAdvisorCohortFounders(id),
    { fallbackError: 'This cohort’s founders could not be read.' });
  const guidance = useCohortRead((id) => api.listMyAdvisorCohortGuidance(id),
    { fallbackError: 'This cohort’s guidance could not be read.' });

  const label = ws.label || 'this cohort';
  const weeks = ws.weeks;
  const weeksReadable = Boolean(weeks.data) && !weeks.error;
  const items = useMemo(() => (Array.isArray(roster.data?.items) ? roster.data.items : []), [roster.data]);
  const rows = useMemo(() => founderRows(items, weeksReadable ? weeks.data : null), [items, weeksReadable, weeks.data]);
  const shown = filterFounders(rows, { q, state, sort, founder: only });
  const lastBy = useMemo(() => lastActivityByFounder(guidance.data), [guidance.data]);
  const guidanceHref = ws.href('/cohorts/guidance');
  const attention = rows.filter(needsAttention).length;

  const showAll = () => { const next = new URLSearchParams(params); next.delete('founder'); setParams(next); };

  return (
    <div className="space-y-4">
      <ZoneBody
        loading={ws.assignments.loading}
        error={ws.assignments.error}
        onRetry={ws.reloadAssignments}
        isEmpty={ws.assignments.items.length === 0}
        empty={<NoBatch />}
      >
        {roster.loading && <CohortLoading what="founders" />}
        <ZoneBody loading={roster.loading} error={roster.error} onRetry={roster.reload}
          isEmpty={items.length === 0}
          empty={(
            <NothingYet
              title="No founders are visible to you"
              body={`You are assigned to ${label}, and no founder in it is visible to you: none is recorded yet, or those who are have not shared their progress with advisors. That is the Lab's record as it stands, not a failed read.`}
            />
          )}>
          <div className="flex flex-wrap items-end gap-2.5" data-testid="founder-tools">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] font-bold text-axal-faint">
              Search founders
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email"
                className={`${inputClass} min-h-[44px] lg:min-h-0`} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-axal-faint">
              Status
              <select value={state} onChange={(e) => setState(e.target.value)} className={`${inputClass} min-h-[44px] lg:min-h-0`}>
                {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold text-axal-faint">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputClass} min-h-[44px] lg:min-h-0`}>
                {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <div role="radiogroup" aria-label="View" className="flex gap-1">
              {VIEWS.map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}
                  className={`min-h-[44px] rounded-lg border px-3 text-[12px] font-bold lg:min-h-[34px] ${view === k
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11.5px] text-axal-faint" aria-live="polite">
            {`${shown.length} of ${items.length}${roster.data?.truncated ? '+' : ''} founders shown · ${weeksReadable ? `${attention} need attention` : 'states not judged: the week record is not loaded'}`}
          </p>
          {only != null && (
            <p role="status" className="text-[12px]">
              Showing one founder from Needs your attention.{' '}
              <button type="button" onClick={showAll} className="min-h-[44px] font-bold text-emerald-800 underline dark:text-emerald-300 lg:min-h-0">Show all founders</button>
            </p>
          )}
          {weeks.error && (
            <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">
              {`${weeks.error} Every founder reads Not assessed until it loads; the roster is still the Lab's record.`}{' '}
              <button type="button" onClick={ws.reloadWeeks} className="font-bold underline">Retry</button>
            </p>
          )}

          {shown.length === 0 ? (
            <p className="text-[12px] text-axal-muted">No founder matches this search and status.</p>
          ) : view === 'board' ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="founder-board">
              {BOARD_COLUMNS.map((col) => {
                const cards = shown.filter(col.test);
                return (
                  <section key={col.key} aria-label={col.label} data-column={col.key}>
                    <div className="mb-2 flex items-baseline justify-between">
                      <h2 className="text-[12px] font-extrabold">{col.label}</h2>
                      <span className="text-[11px] font-bold tabular-nums text-axal-faint">{cards.length}</span>
                    </div>
                    <div className="grid gap-2">
                      {cards.map((r) => <FounderCard key={r.user_id} row={r} lastAt={lastBy.get(Number(r.user_id))} guidanceHref={guidanceHref} />)}
                      {cards.length === 0 && (
                        <div className="rounded-[10px] border border-dashed border-axal-hairline p-3 text-center text-[11px] text-axal-faint dark:border-gray-800">Nobody here</div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <>
              <div className="hidden md:block"><FounderTable rows={shown} label={label} lastBy={lastBy} guidanceHref={guidanceHref} /></div>
              <div className="grid gap-2 md:hidden" data-testid="founder-cards-mobile">
                {shown.map((r) => <FounderCard key={r.user_id} row={r} lastAt={lastBy.get(Number(r.user_id))} guidanceHref={guidanceHref} />)}
              </div>
            </>
          )}

          <p className="text-[11px] text-axal-faint">
            {`States: ${Object.values(FOUNDER_STATES).map((s) => s.label).join(', ')}. A failed or grace founder stays in Needs attention whatever their percentage. Founders who stopped sharing their progress with you do not appear.`}
          </p>
          <FromTheLab />
          <StatedLimit title="What a founder row does not carry">
            The roster gives a founder&apos;s name and email, and the Lab&apos;s week record their status and
            deliverables. No venture, stage or live signal is recorded for a founder here, so none is shown.
            Last activity is the founder&apos;s latest recorded action on your guidance; submissions and
            sessions are not recorded as activity yet.
          </StatedLimit>
        </ZoneBody>
      </ZoneBody>
    </div>
  );
}
