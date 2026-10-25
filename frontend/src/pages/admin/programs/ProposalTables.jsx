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
import DecideDialog from './DecideDialog';
import {
  HQ_HELD, MINE_EMPTY, MINE_SORTS, MINE_STATUSES, MINE_TITLE, NO_MATCH, NO_NOTE, NOT_SENT, PROPOSAL_STATUS,
  PROPOSE_TITLE, QUEUE_EMPTY, QUEUE_SORTS, QUEUE_STATUSES, QUEUE_TITLE, dayLabel, isEditable, lastPage, listParams,
  pageLabel, proposalHref, studioOptions,
} from './proposalsModel';

export const BTN = 'inline-flex min-h-[34px] items-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const PRIMARY = 'inline-flex min-h-[36px] items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:opacity-90 dark:bg-violet-600';

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

function Toolbar({ prefix, q, setQ, status, setStatus, statuses, sort, setSort, sorts, extra }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${prefix}-tools`}>
      <input type="search" aria-label="Search proposals" placeholder="Search proposals" value={q} onChange={(e) => setQ(e.target.value)} className={`${INPUT} min-w-[200px]`} data-testid={`${prefix}-search`} />
      {extra}
      <select aria-label="Status" value={status || ''} onChange={(e) => setStatus(e.target.value || null)} className={INPUT} data-testid={`${prefix}-status`}>
        <option value="">Status: All</option>
        {statuses.map((s) => <option key={s} value={s}>{`Status: ${PROPOSAL_STATUS[s].word}`}</option>)}
      </select>
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

/** PG2's Proposals from studios, for a Super Admin: on the catalogue and on its own address. */
export function ProposalsFromStudios({ onDecided }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(null);
  const [sort, setSort] = useState('oldest');
  const [licence, setLicence] = useState(null);
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState(null);
  const params = listParams({ q, status, sort, page, licence });
  const read = useListRead(() => programProposalsApi.queue(params), JSON.stringify(params));
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
        sort={sort} setSort={reset(setSort)} sorts={QUEUE_SORTS} extra={studioFilter} />
      <ListState prefix="proposals-queue" read={read} what="The proposals from studios" filtered={filtered} empty={<p className={`m-0 ${SUB}`}>{QUEUE_EMPTY}</p>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead><tr><th className={TH}>Program</th><th className={TH}>Studio</th><th className={TH}>Sent</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Decide</span></th></tr></thead>
            <tbody>
              {(read.data?.rows || []).map((r) => (
                <tr key={r.uid} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`proposals-queue-row-${r.uid}`}>
                  <td className={`${TD} font-bold text-axal-ink dark:text-gray-100`}>{r.name}</td>
                  <td className={TD}>{r.studio || HQ_HELD}</td>
                  <td className={`${TD} font-mono`}>{dayLabel(r.sent_at)}</td>
                  <td className={TD}><ProposalPill status={r.status} /></td>
                  <td className={TD}>
                    {r.status === 'sent'
                      ? <button type="button" className={`${LINK} font-bold`} onClick={() => setDeciding(r)} data-testid={`proposals-queue-decide-${r.uid}`}>Decide</button>
                      : <Link to={proposalHref(r.uid)} className={LINK} data-testid={`proposals-queue-open-${r.uid}`}>Open</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pages prefix="proposals-queue" data={read.data} page={page} setPage={setPage} />
      </ListState>
      {deciding ? (
        <DecideDialog proposal={deciding} onClose={() => setDeciding(null)}
          onDecided={() => { setDeciding(null); read.reload(); if (onDecided) onDecided(); }} />
      ) : null}
    </section>
  );
}

