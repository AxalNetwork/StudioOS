// D964 (#2797, Programs part 11) — the two proposal lists, each on its own
// read of part 2's routes (D955):
//   · Your proposals (PG1, dc:359-364): the studio's own, for an Admin.
//     Open opens a Draft or Sent back proposal in the form, any other read only.
//   · Proposals from studios (PG2, dc:365-368): HQ's queue, for a Super Admin,
//     oldest first, with Decide on each proposal sent to HQ.
// Each list draws its own state: Reading…, Could not be read with Try again,
// an empty list in one sentence, or the rows with a count and pages.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { programProposalsApi } from '../../../lib/api/programProposals';
import { programGrantsApi } from '../../../lib/api/programGrants';
import { BlockFailed, CARD, H2, INPUT, LINK, Pill, SUB, Skeleton, TD, TH } from './parts';
import { ChoiceGroup } from './parts';
import {
  HQ_HELD, MINE_EMPTY, MINE_SORTS, MINE_STATUSES, MINE_TITLE, NO_MATCH, NO_NOTE, NOT_SENT, PROPOSAL_STATUS,
  PROPOSE_TITLE, QUEUE_EMPTY, QUEUE_SORTS, QUEUE_STATUSES, QUEUE_TITLE, dayLabel, isEditable, lastPage, listParams,
  pageLabel, proposalHref, revisionLabel, studioOptions, submittedLabel,
} from './proposalsModel';
import { proposalSummary } from './genericProgramModel';

export const BTN = 'inline-flex min-h-[34px] items-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:opacity-90 dark:bg-violet-600';

/** D4873 (PG04): each status's chip, with its count from the queue's own `counts` ("Waiting for HQ 1"); no count while it reads. */
export const QUEUE_CHIP_WORD = Object.freeze({ sent: 'Waiting for HQ', sent_back: 'Sent back', approved: 'Approved', declined: 'Declined' });
export function statusChips(counts) {
  return Object.fromEntries(Object.entries(QUEUE_CHIP_WORD).map(([k, w]) => [k, counts && Number.isFinite(Number(counts[k])) ? `${w} ${Number(counts[k]).toLocaleString('en-US')}` : w]));
}

export function ProposalPill({ status, testId }) {
  const s = PROPOSAL_STATUS[status] || { word: status, glyph: '–', tone: 'muted' };
  return <Pill tone={s.tone} testId={testId}><span aria-hidden="true">{s.glyph}</span>{s.word}</Pill>;
}

/** One list read: `{ state, data, reload }`, asked again whenever `key` changes. */
function useListRead(fetcher, key) {
  const [read, setRead] = useState({ state: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ state: 'loading', data: r.data }));
    fetcher().then(
      (data) => { if (live) setRead({ state: 'ready', data }); },
      () => { if (live) setRead({ state: 'unreadable', data: null }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { ...read, reload: useCallback(() => setTick((t) => t + 1), []) };
}

function Toolbar({ prefix, q, setQ, status, setStatus, statuses, sort, setSort, sorts, extra, chips = null }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${prefix}-tools`}>
      <input type="search" aria-label="Search proposals" placeholder="Search proposals" value={q} onChange={(e) => setQ(e.target.value)} className={`${INPUT} min-w-[200px]`} data-testid={`${prefix}-search`} />
      {/* D4873 (PG04): HQ's queue filters by status with its counts, one radio group; Your proposals keeps its select. */}
      {chips ? (
        <ChoiceGroup label="Status" value={status || 'all'} onPick={(v) => setStatus(v === 'all' ? null : v)} groupTestId={`${prefix}-status`}
          options={[{ value: 'all', label: 'All' }, ...Object.keys(chips).map((s) => ({ value: s, label: chips[s] }))]} testId={(v) => `${prefix}-status-${v}`} />
      ) : (
        <select aria-label="Status" value={status || ''} onChange={(e) => setStatus(e.target.value || null)} className={INPUT} data-testid={`${prefix}-status`}>
          <option value="">Status: All</option>
          {statuses.map((s) => <option key={s} value={s}>{`Status: ${PROPOSAL_STATUS[s].word}`}</option>)}
        </select>
      )}
      {extra}
      <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={INPUT} data-testid={`${prefix}-sort`}>
        {sorts.map(([v, label]) => <option key={v} value={v}>{`Sort: ${label}`}</option>)}
      </select>
    </div>
  );
}

function Pages({ prefix, data, page, setPage }) {
  const last = lastPage(data);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className={`font-mono ${SUB}`} data-testid={`${prefix}-count`}>{pageLabel(data)}</span>
      {last > 1 ? (
        <div className="flex gap-2">
          <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid={`${prefix}-prev`}>Previous</button>
          <button type="button" className={BTN} disabled={page >= last} onClick={() => setPage(page + 1)} data-testid={`${prefix}-next`}>Next</button>
        </div>
      ) : null}
    </div>
  );
}

/** The list's body in its read's state. */
function ListState({ prefix, read, what, empty, filtered, children }) {
  if (read.state === 'loading' && !read.data) return <Skeleton lines={3} testId={`${prefix}-loading`} />;
  if (read.state === 'unreadable') return <BlockFailed what={what} onRetry={read.reload} testId={`${prefix}-failed`} />;
  if (!read.data?.total) return <div data-testid={`${prefix}-empty`}>{filtered ? <p className={`m-0 ${SUB}`}>{NO_MATCH}</p> : empty}</div>;
  return children;
}

/** PG1's Your proposals, for an Admin, on the catalogue. */
export function YourProposals() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(null);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const params = listParams({ q, status, sort, page });
  const read = useListRead(() => programProposalsApi.mine(params), JSON.stringify(params));
  const reset = (set) => (v) => { set(v); setPage(1); };
  const filtered = Boolean(params.q || params.status);
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="proposals-mine">
      <h2 className={H2}>{MINE_TITLE}</h2>
      <Toolbar prefix="proposals-mine" q={q} setQ={reset(setQ)} status={status} setStatus={reset(setStatus)} statuses={MINE_STATUSES}
        sort={sort} setSort={reset(setSort)} sorts={MINE_SORTS} />
      <ListState prefix="proposals-mine" read={read} what="Your proposals" filtered={filtered} empty={(
        <p className={`m-0 flex flex-wrap items-center gap-x-2 ${SUB}`}>
          <span>{MINE_EMPTY}</span>
          <Link to="/admin/programs/propose" className={LINK} data-testid="proposals-mine-propose">{PROPOSE_TITLE}</Link>
        </p>
      )}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead><tr><th className={TH}>Program</th><th className={TH}>Sent</th><th className={TH}>Status</th><th className={TH}>HQ’s note</th><th className={TH}><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {(read.data?.rows || []).map((r) => (
                <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`proposals-mine-row-${r.uid}`}>
                  <td className={`${TD} font-bold text-axal-ink dark:text-gray-100`}>{r.name || 'Untitled draft'}</td>
                  <td className={`${TD} font-mono`}>{dayLabel(r.sent_at) || <span className="text-axal-muted dark:text-gray-400">{NOT_SENT}</span>}</td>
                  <td className={TD}><ProposalPill status={r.status} /></td>
                  <td className={TD} data-testid={`proposals-mine-note-${r.uid}`}>{r.hq_note || <span className="text-axal-muted dark:text-gray-400">{NO_NOTE}</span>}</td>
                  <td className={TD}>
                    <Link to={proposalHref(r.uid)} className={LINK} aria-label={`${isEditable(r.status) ? 'Open' : 'Read'} ${r.name || 'the draft'}`} data-testid={`proposals-mine-open-${r.uid}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pages prefix="proposals-mine" data={read.data} page={page} setPage={setPage} />
      </ListState>
    </section>
  );
}

/**
 * D4808: the catalogue's compact proposal line for a Super Admin: how many wait on HQ, and one door to `/admin/programs/proposals`,
 * where the search, filters and review live.
 */
export function ProposalsSummary({ waiting }) {
  const s = proposalSummary(waiting);
  return (
    <section className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-[18px] py-3`} data-testid="proposals-summary">
      <div className="flex flex-col gap-0.5">
        <h2 className={H2}>{QUEUE_TITLE}</h2>
        <p className={`m-0 ${SUB}`} data-testid="proposals-summary-text">{s.text}</p>
        {/* D4873 (PG01): only the summary here; search, filters and review live at /admin/programs/proposals. */}
        {s.state === 'ready' && s.count > 0 ? (
          <dl className="m-0 mt-1 flex flex-wrap gap-x-5 gap-y-1" data-testid="proposals-summary-facts">
            <div className="flex flex-col"><dt className={SUB}>awaiting review</dt><dd className="m-0 font-mono text-[15px] font-semibold text-axal-ink dark:text-gray-100">{s.count.toLocaleString('en-US')}</dd></div>
            {s.oldest ? <div className="flex flex-col"><dt className={SUB}>oldest</dt><dd className="m-0 font-mono text-[15px] font-semibold text-axal-ink dark:text-gray-100" data-testid="proposals-summary-oldest">{s.oldest}</dd></div> : null}
            <div className="flex flex-col"><dt className={SUB}>latest studio</dt><dd className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="proposals-summary-studio">{s.latestStudio || 'Not read here yet'}</dd></div>
          </dl>
        ) : null}
      </div>
      <Link to="/admin/programs/proposals" className={PRIMARY} data-testid="proposals-summary-open">Open proposals</Link>
    </section>
  );
}

/** PG2's Proposals from studios, for a Super Admin, on its own address `/admin/programs/proposals`. */
export function ProposalsFromStudios({ refresh = 0 }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(null);
  const [sort, setSort] = useState('oldest');
  const [licence, setLicence] = useState(null);
  const [page, setPage] = useState(1);
  const params = listParams({ q, status, sort, page, licence });
  // D4873: `refresh` reads the list again after the review drawer records a decision, keeping the filters.
  const read = useListRead(() => programProposalsApi.queue(params), `${JSON.stringify(params)}:${refresh}`);
  const studios = useListRead(() => programGrantsApi.grid(), 'grid');
  const reset = (set) => (v) => { set(v); setPage(1); };
  const filtered = Boolean(params.q || params.status || params.licence);
  const studioFilter = studios.state === 'unreadable'
    ? <span className={`${SUB} font-semibold`} data-testid="proposals-queue-studio-failed">Studio filter: Could not be read</span>
    : (
      <select aria-label="Studio" value={licence || ''} onChange={(e) => reset(setLicence)(e.target.value || null)} className={INPUT} disabled={studios.state !== 'ready'} data-testid="proposals-queue-studio">
        <option value="">Studio: All</option>
        {studios.state === 'ready' ? studioOptions(studios.data).map(([v, label]) => <option key={v} value={v}>{label}</option>) : null}
      </select>
    );
  return (
    <section className={`${CARD} flex flex-col gap-3 px-[18px] py-4`} data-testid="proposals-queue">
      <h2 className={H2}>{QUEUE_TITLE}</h2>
      <Toolbar prefix="proposals-queue" q={q} setQ={reset(setQ)} status={status} setStatus={reset(setStatus)} statuses={QUEUE_STATUSES}
        sort={sort} setSort={reset(setSort)} sorts={QUEUE_SORTS} extra={studioFilter} chips={statusChips(read.data?.counts)} />
      <ListState prefix="proposals-queue" read={read} what="The proposals from studios" filtered={filtered} empty={<p className={`m-0 ${SUB}`}>{QUEUE_EMPTY}</p>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead><tr><th className={TH}>Proposal</th><th className={TH}>Studio</th><th className={TH}>Submitted</th><th className={TH}>Revision</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Review</span></th></tr></thead>
            <tbody>
              {(read.data?.rows || []).map((r) => (
                <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`proposals-queue-row-${r.uid}`}>
                  <td className={`${TD} font-bold text-axal-ink dark:text-gray-100`}>{r.name}</td>
                  <td className={TD}>{r.studio || HQ_HELD}</td>
                  <td className={`${TD} font-mono`} data-testid={`proposals-queue-submitted-${r.uid}`}>{submittedLabel(r)}</td>
                  <td className={`${TD} font-mono`} data-testid={`proposals-queue-revision-${r.uid}`}>{revisionLabel(r.revision)}</td>
                  <td className={TD}><ProposalPill status={r.status} /></td>
                  <td className={TD}>
                    {/* D4808, D4873 (PG04): every row opens the review drawer at its address; a sent one is decided there. */}
                    <Link to={`/admin/programs/proposals/${r.uid}`} className={`${LINK}${r.status === 'sent' ? ' font-bold' : ''}`} aria-label={`Review ${r.name}`} data-testid={r.status === 'sent' ? `proposals-queue-review-${r.uid}` : `proposals-queue-open-${r.uid}`}>Review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pages prefix="proposals-queue" data={read.data} page={page} setPage={setPage} />
      </ListState>
    </section>
  );
}

