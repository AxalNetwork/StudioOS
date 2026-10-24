import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ATTRIBUTIONS, CLOSING_WITHIN, COUNT_CLAIM, FIRST_500, PAYOUTS_LINE, PAYOUTS_NOTE, REFERRAL_SORTS, allTimeRedemptions,
  countClosing30, countLast90, countOpenWindows, dealFromSearch, dealsUnion, fanFigure, filterRedemptions, pageOf, rangeText,
  redemptionRow,
} from './partnersDeskModel';
import { AMBER, CARD, Failed, INPUT, LINK, Pager, SUB, TD, TH, Tile } from './parts';

/**
 * D923 (#2370) — Referrals (PI7). Redemptions all time from R5 (else the
 * three redeeming lists under Guard L); the last 90 days, the rev-share
 * windows open and those closing within 30 days, and every redemption,
 * under Guard F: one R4 call per deal with redemptions, exact only when the
 * deal set is complete, every call succeeded and each returned its deal's
 * whole count. A window counts as open only while its deal is active
 * (O-WIN). `?deal=<id>` narrows the table to one deal. C4 and C6 wait for
 * parts 6 and 8; a redeemer's role waits for part 8.
 */

const COLS = ['Member', 'Partner and deal', 'Code', 'Registered', 'Tiers given', 'Granted until', 'Attribution', 'Window'];

export default function PartnersReferrals({ reads, fan, now }) {
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

  const all = allTimeRedemptions(reads.contracts, reads.deals);
  const open = fanFigure(fan, countOpenWindows);
  const tiles = [
    { key: 'all', label: 'Redemptions, all time', ...(all.state === 'unreadable' ? { ...all, reason: COUNT_CLAIM } : all) },
    { key: 'last90', label: 'Last 90 days', ...fanFigure(fan, countLast90(now)) },
    { key: 'open', label: 'Rev-share windows open', ...open, sub: open.sub || (open.state === 'ready' ? 'On active deals only' : null) },
    { key: 'closing', label: 'Closing within 30 days', ...fanFigure(fan, countClosing30) },
  ];
  const partial = fanFigure(fan, (x) => x.length);
  const dealRows = dealsUnion(reads.deals).rows;
  const items = fan.state === 'ready' ? fan.items.map((item) => ({ item, row: redemptionRow(item, dealRows) })) : [];
  const partners = [...new Set(items.map((x) => x.row.partner))].sort((a, b) => a.localeCompare(b));
  const rows = filterRedemptions(items, { q, attribution, partner, closingWithin, from, to, deal, sort });
  const shown = pageOf(rows, page);
  const firstOnly = new Set(fan.state === 'ready' ? fan.firstOnly : []);

  return (
    <div className="flex flex-col gap-3.5" data-testid="partners-referrals">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" data-testid="partners-referrals-tiles">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={reads.reload} testPrefix="partners-ref-tile" />)}
      </div>

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
              {partners.map((p) => <option key={p} value={p}>{p}</option>)}
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
              {REFERRAL_SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
            </select>
          </label>
        </div>

        {fan.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
        {fan.state === 'unreadable' ? <Failed what="Every redemption" claim={`${fan.text}.`} onRetry={reads.reload} testId="partners-ref-unreadable" /> : null}
        {fan.state === 'ready' && !fan.exact ? (
          <p className={`m-0 text-[12px] font-semibold ${AMBER}`} data-testid="partners-ref-partial">{`Not every redemption is listed. ${partial.sub}`}</p>
        ) : null}

        {fan.state === 'ready' ? (
          <>
            {rows.length ? (
              <div className="-mx-[18px] overflow-x-auto px-[18px]">
                <table className="w-full min-w-[1040px] border-collapse text-[12.5px]" data-testid="partners-ref-table">
                  <caption className="sr-only">Every redemption read, 25 a page</caption>
                  <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{COLS.map((c) => <th key={c} scope="col" className={TH}>{c}</th>)}</tr></thead>
                  <tbody>
                    {shown.rows.map(({ row }) => (
                      <tr key={row.key} className="border-b border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`partners-ref-row-${row.key}`}>
                        <td className={TD}><span className="font-bold">{row.member}</span><span className={`block ${SUB}`}>{`Role: ${row.role}`}</span></td>
                        <td className={TD}>
                          <span className="block">{row.partner}</span>
                          <Link to={`/admin/partner-invitations/deals/${row.dealId}`} className={LINK}>{`Deal #${row.dealId}`}</Link>
                          {firstOnly.has(String(row.dealId)) ? <span className={`block ${SUB}`}>{FIRST_500}</span> : null}
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
                {items.length ? 'No redemption matches these filters.' : deal ? 'No member has registered with this deal’s code.' : 'No member has registered with a partner’s code yet.'}
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
