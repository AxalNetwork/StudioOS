import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ATTRIBUTIONS, CLOSING_WITHIN, LIST_CLAIM, PAYOUTS_LINE, PAYOUTS_NOTE, dataOf, dealFromSearch, dealsUnion, rangeText,
} from './partnersDeskModel';
import {
  SERVER_REFERRAL_SORTS, countTile, partnerOptions, redemptionParams, referralSets, serverPage, serverRedemptionRow, weeklyFromRead,
  windowTiles, windowsClosing,
} from './dealsReferralsModel';
import { ChartBlock } from './PartnersOverview';
import { useAllRedemptions, useDebounced, useRedemptionCount, useRedemptionPage } from './useDealsReferrals';
import { AMBER, CARD, INPUT, LINK, Pager, ReadState, SUB, TD, TH, Tile } from './parts';

/**
 * D923 (#2370) — Referrals (PI7). D951 (#2727) moves it to D928's cross-deal
 * read (`GET /api/admin/partners/redemptions`), replacing Guard F's fan-out:
 *   · the four tiles: all time and the last 90 days are the read's exact
 *     `total`; the rev-share windows open and closing within 30 days are
 *     counted over every open window, on active deals only (D923's rule,
 *     until the owner answers O-WIN);
 *   · C4 full width, from every redemption of the last twelve weeks;
 *   · C6 "Rev-share windows closing", one bar per open window;
 *   · Every redemption, on the Worker's filters, sort and pages, with the
 *     member's role. `?deal=<id>` narrows it to one deal.
 * Each block reads alone and draws its own state.
 */

const COLS = ['Member', 'Partner and deal', 'Code', 'Registered', 'Tiers given', 'Granted until', 'Attribution', 'Window'];

export default function PartnersReferrals({ reads, now }) {
  const loc = useLocation();
  const deal = dealFromSearch(loc.search);
  const [q, setQ] = useState('');
  const [attribution, setAttribution] = useState('');
  const [partner, setPartner] = useState('');
  const [closingWithin, setClosingWithin] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const set = (fn) => (v) => { fn(v); setPage(1); };
  const needle = useDebounced(q);

  // The sets are fixed for the day they are read on: a new day is a new read.
  const sets = useMemo(() => referralSets(now), [new Date(now).toISOString().slice(0, 10)]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useRedemptionCount('all', sets.all, reads.tick);
  const last90 = useRedemptionCount('last90', sets.last90, reads.tick);
  const windows = useAllRedemptions('windows', sets.windows, reads.tick);
  const weeks = useAllRedemptions('weeks', sets.weeks, reads.tick);
  const list = useRedemptionPage(redemptionParams({ q: needle, attribution, partner, closingWithin, from, to, deal, sort, page }), reads.tick);

  const tiles = [
    { key: 'all', ...countTile(all, 'Redemptions, all time') },
    { key: 'last90', ...countTile(last90, 'Last 90 days') },
    ...windowTiles(windows),
  ];
  const c4 = weeklyFromRead(weeks, { now });
  const c6 = windowsClosing(windows);
  const partners = partnerOptions(dealsUnion(reads.deals).rows);
  const data = dataOf(list);
  const shown = data ? serverPage(data, page) : null;
  const rows = shown ? shown.rows.map(serverRedemptionRow) : [];
  const anyFilter = Boolean(q.trim() || attribution || partner || closingWithin || from || to);

  return (
    <div className="flex flex-col gap-3.5" data-testid="partners-referrals">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="partners-referrals-tiles">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} testPrefix="partners-ref-tile" />)}
      </div>

      <ChartBlock b={c4} onRetry={reads.reload} />
      <ChartBlock b={c6} onRetry={reads.reload}>
        {c6.state === 'ready' ? <p className={`m-0 ${SUB}`} data-testid="partners-c6-showing">{c6.showing}</p> : null}
      </ChartBlock>

      <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-label="Every redemption" data-testid="partners-referrals-table-card">
        <h2 className="m-0 text-[15px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">Every redemption</h2>
        {deal ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="partners-referrals-deal">
            {`Deal #${deal} only.`}
            <Link to="/admin/partner-invitations/referrals" className={LINK}>Show every deal</Link>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col">
            <span className="sr-only">Search member, partner or code</span>
            <input type="search" value={q} onChange={(e) => set(setQ)(e.target.value)} placeholder="Search member, partner or code" className={INPUT} data-testid="partners-ref-search" />
          </label>
          <label className="flex flex-col">
            <span className="sr-only">Attribution</span>
            <select value={attribution} onChange={(e) => set(setAttribution)(e.target.value)} className={INPUT} data-testid="partners-ref-attribution">
              <option value="">Attribution: any</option>
              {ATTRIBUTIONS.map((a) => <option key={a.key} value={a.key}>{a.word}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="sr-only">Partner</span>
            <select value={partner} onChange={(e) => set(setPartner)(e.target.value)} className={INPUT} data-testid="partners-ref-partner">
              <option value="">Partner: any</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="sr-only">Window closing within</span>
            <select value={closingWithin} onChange={(e) => set(setClosingWithin)(e.target.value)} className={INPUT} data-testid="partners-ref-closing">
              <option value="">Window: any</option>
              {CLOSING_WITHIN.map((d) => <option key={d} value={String(d)}>{`Window closing within ${d} days`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            From
            <input type="date" value={from} onChange={(e) => set(setFrom)(e.target.value)} className={INPUT} data-testid="partners-ref-from" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
            To
            <input type="date" value={to} onChange={(e) => set(setTo)(e.target.value)} className={INPUT} data-testid="partners-ref-to" />
          </label>
          <label className="flex flex-col">
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => set(setSort)(e.target.value)} className={INPUT} data-testid="partners-ref-sort">
              {SERVER_REFERRAL_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
            </select>
          </label>
        </div>
        {closingWithin ? <p className={`m-0 ${SUB}`}>The window filter counts every open window, including those on ended deals.</p> : null}

        <ReadState read={list} what="The redemptions" claim={LIST_CLAIM} onRetry={reads.reload} testId="partners-ref-read" />

        {shown ? (
          <>
            {rows.length ? (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
                <table className="w-full min-w-[1040px] border-collapse text-[12.5px]" data-testid="partners-ref-table">
                  <caption className="sr-only">Every redemption that matches, 25 a page</caption>
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{COLS.map((c) => <th key={c} scope="col" className={TH}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-b border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`partners-ref-row-${row.key}`}>
                        <td className={TD}><span className="font-bold">{row.member}</span><span className={`block ${SUB}`}>{`Role: ${row.role}`}</span></td>
                        <td className={TD}>
                          <span className="block">{row.partner}</span>
                          <Link to={`/admin/partner-invitations/deals/${row.dealId}`} className={LINK}>{`Deal #${row.dealId}`}</Link>
                        </td>
                        <td className={`${TD} font-mono text-[11.5px]`}>{row.code}</td>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11.5px]`}>{row.registered}</td>
                        <td className={TD}>{row.tiers}</td>
                        <td className={`${TD} whitespace-nowrap`}>{row.grantedUntil}</td>
                        <td className={TD}>{row.attribution}</td>
                        <td className={`${TD} whitespace-nowrap ${row.window.key === 'open' && row.window.days <= 30 ? `font-bold ${AMBER}` : ''}`}>{row.window.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={`m-0 ${SUB}`} data-testid="partners-ref-none">
                {anyFilter ? 'No redemption matches these filters.' : deal ? 'No member has registered with this deal’s code.' : 'No member has registered with a partner’s code yet.'}
              </p>
            )}
            <Pager shown={shown} range={rangeText(shown)} onPage={setPage} testId="partners-ref-range" />
          </>
        ) : null}

        <p className={`m-0 flex flex-wrap items-center gap-2 ${SUB}`} data-testid="partners-ref-foot">
          {PAYOUTS_LINE}
          <Link to="/admin/contracts?tab=partner-deals" className={LINK}>Open payouts in Contracts</Link>
        </p>
        <p className={`m-0 ${SUB}`}>{PAYOUTS_NOTE}</p>
      </section>
    </div>
  );
}
