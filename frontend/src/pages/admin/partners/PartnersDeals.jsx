import React, { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PhoneSheet, actionGhost, actionPrimary, usePhoneWidth } from '../../../ui';
import {
  DEAL_SORTS, DEAL_STATES, DEAL_TYPES, ENDS_WITHIN, LIST_CLAIM, dataOf, dealFiltersFromSearch, dealHref, dealTypeWord, noDealLine, rangeText, topDealRows,
} from './partnersDeskModel';
import {
  PHONE_STATE_GROUPS, dealListParams, groupsOfStates, phoneFilterCount, serverDealRow, serverPage, showDealsLabel, statesOfGroups, termsEnding,
} from './dealsReferralsModel';
import { ChartBlock } from './PartnersOverview';
import { useActiveByEnd, useDealPage, useDebounced } from './useDealsReferrals';
import {
  AMBER, CARD, Card, Chip, CopyButton, DealStatePill, EYE, INPUT, LINK, MONO, Pager, ReadState, RowMenu, SUB, TD, TH,
} from './parts';

/**
 * D923 (#2370) — Deals (PI5). D951 (#2727) moves it to D926's server list:
 * search, the six state chips, type, ends within, has redemptions and the
 * sort are the Worker's, 25 a page, with the exact `total` (no Guard L). The
 * partner before signing comes with the row (D926 §3), and since D1117 so do
 * its due-diligence case and whether its invitation lapsed, joined on the
 * Worker rather than against R9's and R1's capped lists. C5 "Terms ending" reads
 * the active deals soonest end first. Top deals by redemptions is R3.
 * D929: `?type=&state=` (Overview's C3) sets the filters it opens with.
 * On a phone (PI11d): cards, a "Filters · [n]" sheet with four state groups
 * and an exact "Show [n] deals", and a sort select.
 */

const COLS = ['Partner', 'Deal type', 'Tiers granted', 'Term', 'Days left', 'Referral code', 'Redemptions', 'State', 'Due diligence', ''];

function TopDeals({ reads }) {
  const items = Array.isArray(dataOf(reads.top)) ? topDealRows(dataOf(reads.top)) : null;
  return (
    <Card title="Top deals by redemptions" meta="All states" testId="partners-top">
      <ReadState read={reads.top} what="The top deals" claim={LIST_CLAIM} onRetry={reads.reload} testId="partners-top-read" />
      {items && !items.length ? <p className={`m-0 ${SUB}`}>No deal has a redemption yet.</p> : null}
      {items && items.length ? (
        <ol className="m-0 flex list-none flex-col p-0">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700">
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link to={`/admin/partner-invitations/deals/${d.id}`} className="text-[13px] font-bold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">
                  {String(d.partner_name || '').trim() || String(d.partner_email || '').trim() || `Deal #${d.id}`}
                </Link>
                <span className={`${MONO} text-[11.5px]`}>{d.referral_code || 'Issued on signing'}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={SUB}>{dealTypeWord(d.deal_type)}</span>
                <DealStatePill status={d.status} />
                <span className="font-mono text-[13px] font-bold text-axal-ink dark:text-gray-100">{Number(d.redemptions_count).toLocaleString('en-US')}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

/** C5, in D893's four states, with "Showing [n] of [m]" over the chart. */
function TermsEnding({ reads, now }) {
  const read = useActiveByEnd(reads.tick);
  const block = termsEnding(read, { now });
  return (
    <ChartBlock b={block} onRetry={reads.reload}>
      {block.state === 'ready' ? <p className={`m-0 ${SUB}`} data-testid="partners-c5-showing">{block.showing}</p> : null}
    </ChartBlock>
  );
}

/** PI11d's filter sheet: four state groups, deal type, ends within; Clear, and "Show [n] deals" from the Worker's count. */
function FilterSheet({ reads, applied, onApply, onClose, opener }) {
  const [groups, setGroups] = useState(() => groupsOfStates(applied.states));
  const [type, setType] = useState(applied.type);
  const [endsWithin, setEndsWithin] = useState(applied.endsWithin);
  const draft = { ...applied, states: statesOfGroups(groups), type, endsWithin, page: 1 };
  const count = useDealPage(dealListParams({ ...draft, size: 1 }), reads.tick);
  const toggle = (k) => setGroups((g) => (g.includes(k) ? g.filter((x) => x !== k) : [...g, k]));
  return (
    <PhoneSheet label="Filter deals" title="Filters" onClose={onClose} opener={opener}>
      <div className="flex flex-col gap-4" data-testid="partners-deals-sheet">
        <div className="flex flex-col gap-2">
          <span className={EYE}>State</span>
          <div className="flex flex-wrap gap-[7px]" role="group" aria-label="State">
            {PHONE_STATE_GROUPS.map((g) => <Chip key={g.key} on={groups.includes(g.key)} onClick={() => toggle(g.key)} testId={`partners-deals-sheet-${g.key}`}>{g.word}</Chip>)}
          </div>
          <span className={SUB}>Ended counts term over, terminated and voided.</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className={EYE}>Deal type</span>
          <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Deal type">
            {DEAL_TYPES.map((t) => <Chip key={t.key} on={type === t.key} onClick={() => setType(type === t.key ? '' : t.key)} testId={`partners-deals-sheet-type-${t.key}`}>{t.word}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className={EYE}>Ends within</span>
          <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Ends within">
            {ENDS_WITHIN.map((d) => <Chip key={d} on={String(endsWithin) === String(d)} onClick={() => setEndsWithin(String(endsWithin) === String(d) ? '' : String(d))} testId={`partners-deals-sheet-ends-${d}`}>{`${d} days`}</Chip>)}
          </div>
        </div>
        {count.status === 'error' ? <p className={`m-0 text-[12px] font-semibold ${AMBER}`} data-testid="partners-deals-sheet-count-failed">How many deals match could not be read.</p> : null}
        <div className="flex gap-2">
          <button type="button" className={`${actionGhost} flex-1`} onClick={() => { setGroups([]); setType(''); setEndsWithin(''); }} data-testid="partners-deals-sheet-clear">Clear</button>
          <button type="button" className={`${actionPrimary} flex-1`} onClick={() => { onApply(draft); onClose(); }} data-testid="partners-deals-sheet-show">{showDealsLabel(count)}</button>
        </div>
      </div>
    </PhoneSheet>
  );
}

/** One deal as a phone card: name, state, deal type and days left. */
function DealCard({ deal, row, onOpen }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className={`${CARD} flex w-full flex-col gap-1.5 px-3.5 py-3 text-left`} data-testid={`partners-deals-card-${row.id}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-[14px] font-bold leading-snug text-axal-ink dark:text-gray-100">{row.partner.name}</span>
          <DealStatePill status={deal.status} />
        </span>
        <span className={SUB}>{row.type}</span>
        <span className={`font-mono text-[12px] ${row.daysLeft.tone === 'amber' ? `font-bold ${AMBER}` : 'text-axal-ink dark:text-gray-100'}`}>{row.daysLeft.text}</span>
        {row.lapsed ? <span className={`text-[11px] font-bold ${AMBER}`}>{row.lapsed}</span> : null}
      </button>
    </li>
  );
}

export default function PartnersDeals({ reads, now, actions }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const phone = usePhoneWidth();
  const [linked] = useState(() => dealFiltersFromSearch(search));
  const [q, setQ] = useState('');
  const [states, setStates] = useState(linked.states || ['active']);
  const [type, setType] = useState(linked.type);
  const [endsWithin, setEndsWithin] = useState('');
  const [hasRedemptions, setHasRedemptions] = useState(false);
  const [sort, setSort] = useState('ends');
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState(false);
  const sheetOpener = useRef(null);
  const needle = useDebounced(q);
  const filters = { q: needle, states, type, endsWithin, hasRedemptions, sort };
  const list = useDealPage(dealListParams({ ...filters, page }), reads.tick);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const toggle = (key) => { setStates((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key])); setPage(1); };
  const clear = () => { setQ(''); setStates([]); setType(''); setEndsWithin(''); setHasRedemptions(false); setPage(1); };
  const open = (id) => navigate(dealHref(id));
  const data = dataOf(list);
  const shown = data ? serverPage(data, page) : null;
  const rows = shown ? shown.rows.map((deal) => ({ deal, row: serverDealRow(deal, { invitations: reads.invitations, now }) })) : [];
  const anyFilter = Boolean(q.trim() || states.length || type || endsWithin || hasRedemptions);
  const filterCount = phoneFilterCount({ states, type, endsWithin });

  const sortSelect = (
    <label className="flex flex-col">
      <span className="sr-only">Sort</span>
      <select value={sort} onChange={(e) => set(setSort)(e.target.value)} className={INPUT} data-testid="partners-deals-sort">
        {DEAL_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
      </select>
    </label>
  );

  return (
    <div className="flex flex-col gap-3.5" data-testid="partners-deals">
      <TermsEnding reads={reads} now={now} />

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Deals">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col">
            <span className="sr-only">Search partner, email or code</span>
            <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder={phone ? 'Search partner or code' : 'Search partner, email or code'} className={INPUT} data-testid="partners-deals-search" />
          </label>
          {phone ? (
            <>
              <button ref={sheetOpener} type="button" className={`${INPUT} font-semibold`} onClick={() => setSheet(true)} data-testid="partners-deals-filters">
                {filterCount ? `Filters · ${filterCount}` : 'Filters'}
              </button>
              {sortSelect}
            </>
          ) : (
            <>
              <label className="flex flex-col">
                <span className="sr-only">Deal type</span>
                <select value={type} onChange={(e) => set(setType)(e.target.value)} className={INPUT} data-testid="partners-deals-type">
                  <option value="">Deal type: any</option>
                  {DEAL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.word}</option>)}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="sr-only">Ends within</span>
                <select value={endsWithin} onChange={(e) => set(setEndsWithin)(e.target.value)} className={INPUT} data-testid="partners-deals-ends">
                  <option value="">Ends: any time</option>
                  {ENDS_WITHIN.map((d) => <option key={d} value={String(d)}>{`Ends within ${d} days`}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
                <input type="checkbox" checked={hasRedemptions} onChange={(e) => set(setHasRedemptions)(e.target.checked)} data-testid="partners-deals-has" />
                Has redemptions
              </label>
              {sortSelect}
            </>
          )}
        </div>
        {phone ? null : (
          <div className="flex flex-wrap gap-[7px]" role="group" aria-label="State">
            {DEAL_STATES.map((s) => <Chip key={s.key} on={states.includes(s.key)} onClick={() => toggle(s.key)} testId={`partners-deals-chip-${s.key}`}>{s.word}</Chip>)}
          </div>
        )}

        <ReadState read={list} what="The deals" claim={LIST_CLAIM} onRetry={reads.reload} testId="partners-deals-read" />

        {shown ? (
          <>
            {rows.length && phone ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="partners-deals-cards">
                {rows.map(({ deal, row }) => <DealCard key={row.id} deal={deal} row={row} onOpen={() => open(row.id)} />)}
              </ul>
            ) : null}
            {rows.length && !phone ? (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
                <table className="w-full min-w-[1180px] border-collapse text-[12.5px]" data-testid="partners-deals-table">
                  <caption className="sr-only">Every deal that matches, 25 a page. Select a row, or press Enter on it, to open it.</caption>
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{COLS.map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
                  <tbody>
                    {rows.map(({ deal, row }) => (
                      <tr key={row.id} tabIndex={0} onClick={() => open(row.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); open(row.id); } }}
                        className="cursor-pointer border-b border-axal-hairline text-axal-ink hover:bg-axal-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
                        data-testid={`partners-deals-row-${row.id}`}>
                        <td className={TD}>
                          <Link to={`/admin/partner-invitations/deals/${row.id}`} onClick={(e) => e.stopPropagation()} className="font-bold leading-snug text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{row.partner.name}</Link>
                          {row.partner.email ? <span className={`block ${SUB}`}>{row.partner.email}</span> : null}
                          {row.lapsed ? <span className={`block text-[11px] font-bold ${AMBER}`}>{row.lapsed}</span> : null}
                        </td>
                        <td className={TD}>{row.type}</td>
                        <td className={TD}>{row.tiers}</td>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11.5px]`}>{row.term}</td>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11.5px] ${row.daysLeft.tone === 'amber' ? `font-bold ${AMBER}` : ''}`}>{row.daysLeft.text}</td>
                        <td className={TD} onClick={(e) => e.stopPropagation()}>
                          {row.code ? (
                            <span className="flex flex-col gap-1">
                              <span className={MONO}>{row.code}</span>
                              <CopyButton text={row.code} label="Copy" noun="code" testId={`partners-deals-copy-${row.id}`} />
                            </span>
                          ) : <span className="text-axal-muted dark:text-gray-400">Issued on signing</span>}
                        </td>
                        <td className={`${TD} font-mono`}>{row.redemptions === null ? <span className="font-sans text-axal-muted dark:text-gray-400">Code not issued</span> : row.redemptions}</td>
                        <td className={TD}><DealStatePill status={deal.status} /></td>
                        <td className={TD} onClick={(e) => e.stopPropagation()}>
                          {row.dd.open && row.dd.uid ? <Link to={`/admin/due-diligence/${row.dd.uid}`} className={LINK}>Open</Link> : (
                            <span className={row.dd.failed ? 'text-red-700 dark:text-red-300' : ''}>{row.dd.text}</span>
                          )}
                        </td>
                        <td className={`${TD} text-right`}>
                          <RowMenu name={row.partner.name} testId={`partners-deals-menu-${row.id}`} items={[
                            { key: 'open', label: 'Open', onSelect: () => open(row.id) },
                            ...(deal.status === 'active' ? [{ key: 'terminate', label: 'Terminate', onSelect: () => actions.terminate(deal) }] : []),
                          ]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!rows.length ? (
              <div className="flex flex-wrap items-center gap-2.5" data-testid="partners-deals-none">
                <span className={SUB}>{anyFilter ? noDealLine({ q, states, endsWithin }) : 'No partner deals yet. A deal starts when an invitee chooses an offer.'}</span>
                {anyFilter ? <button type="button" className={LINK} onClick={clear}>Clear filters</button> : null}
              </div>
            ) : null}
            <Pager shown={shown} range={rangeText(shown)} onPage={setPage} testId="partners-deals-range" />
          </>
        ) : null}
      </section>
      <TopDeals reads={reads} />
      {sheet ? (
        <FilterSheet reads={reads} applied={filters} opener={sheetOpener} onClose={() => setSheet(false)}
          onApply={(d) => { setStates(d.states); setType(d.type); setEndsWithin(d.endsWithin); setPage(1); }} />
      ) : null}
    </div>
  );
}
