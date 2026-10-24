import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  DEAL_SORTS, DEAL_STATES, DEAL_TYPES, ENDS_WITHIN, LIST_CLAIM, WITHIN_DEALS, dataOf, dealFiltersFromSearch, dealHref, dealRow, dealTypeWord,
  dealsUnion, filterDeals, isFailed, isLoading, noDealLine, pageOf, rangeText, topDealRows,
} from './partnersDeskModel';
import {
  AMBER, CARD, Card, Chip, CopyButton, DealStatePill, Failed, INPUT, LINK, MONO, Pager, ReadState, RowMenu, SUB, TD, TH,
} from './parts';

/**
 * D923 (#2370) — Deals (PI5): the six R2 lists under Guard L, one table.
 * Before signing a deal's partner comes from its invitation (R1, by
 * `invitation_id`); its Due diligence comes from R9. One cross-check is
 * drawn: an unsigned deal whose invitation has lapsed. Top deals by
 * redemptions is R3, with deals that have none left out. C5 waits for part 8.
 * D929: `?type=&state=` (Overview's C3) sets the filters it opens with.
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

export default function PartnersDeals({ reads, now, actions }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [linked] = useState(() => dealFiltersFromSearch(search));
  const [q, setQ] = useState('');
  const [states, setStates] = useState(linked.states || ['active']);
  const [type, setType] = useState(linked.type);
  const [endsWithin, setEndsWithin] = useState('');
  const [hasRedemptions, setHasRedemptions] = useState(false);
  const [sort, setSort] = useState('ends');
  const [page, setPage] = useState(1);
  const u = dealsUnion(reads.deals);
  const all = u.rows.map((deal) => ({ deal, row: dealRow(deal, { invitations: reads.invitations, cases: reads.cases, now }) }));
  const rows = filterDeals(all, { q, states, type, endsWithin, hasRedemptions, sort, now });
  const shown = pageOf(rows, page);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const toggle = (key) => { setStates((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key])); setPage(1); };
  const clear = () => { setQ(''); setStates([]); setType(''); setEndsWithin(''); setHasRedemptions(false); setPage(1); };
  const open = (id) => navigate(dealHref(id));
  const anyLoading = DEAL_STATES.some((s) => isLoading(reads.deals[s.key]));

  return (
    <div className="flex flex-col gap-3.5" data-testid="partners-deals">
      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Deals">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col">
            <span className="sr-only">Search partner, email or code</span>
            <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search partner, email or code" className={INPUT} data-testid="partners-deals-search" />
          </label>
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
          <label className="flex flex-col">
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => set(setSort)(e.target.value)} className={INPUT} data-testid="partners-deals-sort">
              {DEAL_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-[7px]" role="group" aria-label="State">
          {DEAL_STATES.map((s) => <Chip key={s.key} on={states.includes(s.key)} onClick={() => toggle(s.key)} testId={`partners-deals-chip-${s.key}`}>{s.word}</Chip>)}
        </div>

        {u.failed.length < DEAL_STATES.length ? DEAL_STATES.map((s) => (reads.deals[s.key]?.status === 'error'
          ? <ReadState key={s.key} read={reads.deals[s.key]} what={`The deals in “${s.word}”`} claim={LIST_CLAIM} onRetry={reads.reload} testId={`partners-deals-read-${s.key}`} />
          : null)) : null}
        {isFailed(reads.cases) ? <ReadState read={reads.cases} what="The due-diligence cases" claim="That is not a claim that no case is open." onRetry={reads.reload} testId="partners-deals-cases" /> : null}
        {anyLoading ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
        {u.capped.length ? <p className={`m-0 text-[12px] font-semibold ${AMBER}`} data-testid="partners-deals-capped">{`${WITHIN_DEALS}: ${u.capped.map((k) => DEAL_STATES.find((s) => s.key === k).word).join(', ')} stopped at 200.`}</p> : null}

        {!anyLoading ? (
          <>
            {rows.length ? (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
                <table className="w-full min-w-[1180px] border-collapse text-[12.5px]" data-testid="partners-deals-table">
                  <caption className="sr-only">Every deal read, 25 a page. Select a row, or press Enter on it, to open it.</caption>
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{COLS.map((c, i) => <th key={c || i} scope="col" className={TH}>{c || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
                  <tbody>
                    {shown.rows.map(({ deal, row }) => (
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
                              <CopyButton text={row.code} label="Copy" testId={`partners-deals-copy-${row.id}`} />
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
            ) : (
              u.failed.length === DEAL_STATES.length ? null : (
                <div className="flex flex-wrap items-center gap-2.5" data-testid="partners-deals-none">
                  <span className={SUB}>{u.rows.length || u.failed.length ? noDealLine({ q, states, endsWithin }) : 'No partner deals yet. A deal starts when an invitee chooses an offer.'}</span>
                  {q.trim() || states.length || type || endsWithin || hasRedemptions ? <button type="button" className={LINK} onClick={clear}>Clear filters</button> : null}
                </div>
              )
            )}
            {u.failed.length === DEAL_STATES.length ? <Failed what="The deals" claim={LIST_CLAIM} onRetry={reads.reload} testId="partners-deals-unreadable" /> : null}
            <Pager shown={shown} range={rangeText(shown, u.capped.length ? WITHIN_DEALS : null)} onPage={setPage} testId="partners-deals-range" />
          </>
        ) : null}
      </section>
      <TopDeals reads={reads} />
    </div>
  );
}
