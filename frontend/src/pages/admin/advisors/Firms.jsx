import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminPartnerFirmsApi } from '../../../lib/api/adminPartnerFirms.js';
import { reportError } from '../../../lib/log';
import { DEAL_TYPES, isRecordId } from '../partners/partnersDeskModel';
import { AMBER, CARD, Chip, Done, EYE, H2, INPUT, MONO, Pager, SUB, TD, TH } from '../partners/parts';
import FirmAttachDialog from './FirmAttachDialog';
import FirmDrawer from './FirmDrawer';
import FirmLinks from './FirmLinks';
import {
  DIRECTORY_OPTIONS, ENDS_OPTIONS, INITIAL_QUERY, SORT_OPTIONS, endsSoonSub, firmRows, isFiltered, listParams, pagesOf, rangeText, unattachedOf, unreadableLine, whoOf,
} from './firmsModel';

/**
 * D979 (#2765) — Advisors & Partners › Firms complete (AP5): search, the four
 * filters (directory, deal type, deal ends within, has no accounts), sort and
 * pages, all answered by the Worker with an exact total; the "No firm" strip
 * with Attach (AP10); each row opens the firm's drawer (AP6) at `?firm=<id>`,
 * so a reload or a shared link reopens it. D952's attach table stays below as
 * "See all".
 *
 * A failed list says so with Try again; one failed column says so in its
 * cells and once above the table. Nothing here is a zero for a missing value.
 */

const SELECT = `${INPUT} pr-7`;

/** The list read: one page at a time, refetched when the query changes. */
function useFirmsList(query) {
  const [read, setRead] = useState({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useState(0);
  const params = JSON.stringify(listParams(query));
  useEffect(() => {
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    adminPartnerFirmsApi.list(JSON.parse(params)).then(
      (data) => { if (live) setRead({ status: 'ready', data, error: null }); },
      (error) => { reportError('advisors-partners:firms', error); if (live) setRead({ status: 'error', data: null, error }); },
    );
    return () => { live = false; };
  }, [params, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { read, reload };
}

function Strip({ links, onAttach }) {
  if (!links || links.status !== 'ready') return null;
  const u = unattachedOf(links.data);
  if (!u.count) return null;
  return (
    <section className="flex flex-col gap-2 rounded-[10px] bg-axal-amber/30 px-3.5 py-3 text-[13px] text-axal-ink dark:bg-amber-950/30 dark:text-gray-100" aria-labelledby="ap-h-nofirm" data-testid="ap-firms-unattached">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="ap-h-nofirm" className="m-0 text-[13px] font-extrabold">Partner accounts with no firm: <span className={MONO}>{u.count.toLocaleString('en-US')}</span></h3>
        <a href="#ap-firm-links" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300">See all</a>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {u.rows.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3" data-testid={`ap-nofirm-${a.id}`}>
            <span className="font-semibold">{whoOf(a)}</span>
            <button type="button" className="rounded-[8px] border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-bold dark:border-gray-700 dark:bg-gray-900" onClick={() => onAttach(a)} data-testid={`ap-nofirm-attach-${a.id}`}>Attach to firm</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Toolbar({ query, set, filters }) {
  const types = (filters?.deal_types || DEAL_TYPES.map((t) => t.key)).map((k) => ({ key: k, word: (DEAL_TYPES.find((t) => t.key === k) || {}).word || k }));
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ap-firms-toolbar">
      <label className="flex min-w-[220px] flex-1 flex-col gap-1">
        <span className="sr-only">Search firm or company</span>
        <input type="search" value={query.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search firm or company" className={INPUT} data-testid="ap-firms-search" />
      </label>
      <label className="flex flex-col gap-1"><span className="sr-only">Directory</span>
        <select value={query.directory} onChange={(e) => set({ directory: e.target.value })} className={SELECT} data-testid="ap-firms-directory">
          {DIRECTORY_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.word}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1"><span className="sr-only">Deal type</span>
        <select value={query.dealType} onChange={(e) => set({ dealType: e.target.value })} className={SELECT} data-testid="ap-firms-deal-type">
          <option value="">Any deal type</option>
          {types.map((o) => <option key={o.key} value={o.key}>{o.word}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1"><span className="sr-only">Deal ends within</span>
        <select value={query.endsWithin} onChange={(e) => set({ endsWithin: e.target.value })} className={SELECT} data-testid="ap-firms-ends">
          {ENDS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.word}</option>)}
        </select>
      </label>
      <Chip on={query.noAccounts} onClick={() => set({ noAccounts: !query.noAccounts })} testId="ap-firms-no-accounts">Has no accounts</Chip>
      <label className="flex flex-col gap-1"><span className="sr-only">Sort</span>
        <select value={query.sort} onChange={(e) => set({ sort: e.target.value })} className={SELECT} data-testid="ap-firms-sort">
          {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{`Sort: ${o.word}`}</option>)}
        </select>
      </label>
    </div>
  );
}

function Table({ rows, onOpen }) {
  return (
    <div className="-mx-[18px] overflow-x-auto px-[18px]">
      <table className="w-full min-w-[1060px] border-collapse text-[12.5px]" data-testid="ap-firms-table">
        <caption className="sr-only">Firms. A row opens the firm.</caption>
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-700">
            {['Firm', 'Accounts', 'Specialization', 'Active deal', 'Deal ends', 'Redemptions', 'Directory', 'Rating', 'Settlements due'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-axal-hairline align-top text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`ap-firm-${r.id}`}>
              <th scope="row" className={`${TD} text-left`}>
                <button type="button" className="text-left font-bold text-axal-ink hover:text-axal-violet dark:text-gray-100" onClick={() => onOpen(r.id)} data-testid={`ap-firm-open-${r.id}`}>{r.title}</button>
                {r.sub ? <span className={`block font-normal ${SUB}`}>{r.sub}</span> : null}
              </th>
              <td className={`${TD} ${MONO}`}>{r.accounts}</td>
              <td className={TD}>{r.specialization}</td>
              <td className={TD} data-testid={`ap-firm-${r.id}-deal`}>{r.deal.none ? <span className={SUB}>{r.deal.word}</span> : r.deal.word}</td>
              <td className={`${TD} ${MONO} ${r.deal.soon ? AMBER : ''}`} data-testid={`ap-firm-${r.id}-ends`}>
                {r.deal.ends}{endsSoonSub(r.deal) ? <span className={`block ${SUB}`}>{endsSoonSub(r.deal)}</span> : null}
              </td>
              <td className={`${TD} ${MONO}`}>{r.redemptions}</td>
              <td className={TD}>{r.directory}</td>
              <td className={`${TD} ${MONO}`}>{r.rating}</td>
              <td className={TD} data-testid={`ap-firm-${r.id}-settlements`}>
                <span className={r.settlements.none ? SUB : MONO}>{r.settlements.text}</span>
                {r.settlements.sub ? <span className={`block ${SUB}`}>{r.settlements.sub}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Firms tab: the list, its drawer, then attaching an account to one (D952). */
export default function FirmsTab({ reads, reload }) {
  const [query, setQuery] = useState(INITIAL_QUERY);
  const [search, setSearch] = useSearchParams();
  const [attachFor, setAttachFor] = useState(null);
  const [done, setDone] = useState(null);
  const { read, reload: reloadList } = useFirmsList(query);
  const set = (patch) => setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }));
  const open = search.get('firm');
  const openFirm = (id) => { const next = new URLSearchParams(search); next.set('firm', String(id)); setSearch(next); };
  const closeFirm = () => { const next = new URLSearchParams(search); next.delete('firm'); setSearch(next); };
  const changed = () => { reloadList(); reload(); };
  const links = reads.links?.status === 'ready' ? reads.links.data : null;
  const data = read.data;
  const rows = data ? firmRows(data) : [];
  const unread = data ? unreadableLine(data) : null;

  return (
    <div className="flex flex-col gap-3.5" data-testid="ap-firms-tab">
      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="ap-h-firms" data-testid="ap-firms">
        <h2 id="ap-h-firms" className={H2}>Firms</h2>
        {done ? <Done testId="ap-firms-done"><span>{done}</span></Done> : null}
        <Strip links={reads.links} onAttach={(a) => setAttachFor(a)} />
        <Toolbar query={query} set={set} filters={data?.filters} />
        {read.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="ap-firms-reading">Reading…</span> : null}
        {read.status === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-red-700 dark:text-red-300" data-testid="ap-firms-unreadable">
            <span>{Number(read.error?.status) === 503 && read.error?.data?.error === 'filter_unreadable'
              ? (read.error?.data?.message || 'This filter could not be answered. That is not the same as no firms.')
              : 'The firms could not be read. That is not the same as no firms.'}</span>
            <button type="button" className="font-semibold underline" onClick={reloadList}>Try again</button>
          </div>
        ) : null}
        {unread ? <p role="status" className={`m-0 text-[12.5px] font-semibold ${AMBER}`} data-testid="ap-firms-columns-unreadable">{unread}</p> : null}
        {read.status === 'ready' && rows.length === 0 ? (
          <p className={`m-0 ${SUB}`} data-testid="ap-firms-none">{isFiltered(query) ? 'No firm matches this search and these filters.' : 'No firm is recorded yet. A firm is created when a partner is invited.'}</p>
        ) : null}
        {read.status === 'ready' && rows.length ? <Table rows={rows} onOpen={openFirm} /> : null}
        {read.status === 'ready' ? <Pager shown={pagesOf(data, query.page)} range={rangeText(data)} onPage={(page) => set({ page })} testId="ap-firms-range" /> : null}
        <span className={`${EYE} normal-case tracking-normal`}>A row opens the firm.</span>
      </section>
      <FirmLinks reads={{ links: reads.links, reload }} />
      {isRecordId(open) ? <FirmDrawer firmId={Number(open)} links={links} onClose={closeFirm} onChanged={changed} /> : null}
      {attachFor && links ? <FirmAttachDialog links={links} account={attachFor} onClose={() => setAttachFor(null)} onDone={(line) => { setAttachFor(null); setDone(line); changed(); }} /> : null}
    </div>
  );
}
