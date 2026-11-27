/**
 * D1252 (#3267) — My reviews (DDL12a) at `/admin/due-diligence/my-reviews`
 * and `/due-diligence/my-reviews`: the sections the caller was invited to
 * review, from `GET /api/dd/my-reviews` (D1249). A table from `md` up, cards
 * on a phone (DDL18). Each row opens the case on the caller's own base with
 * the section in focus; the read holds only the caller's own sections.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Unreadable } from '../../ui';
import { ddDeskApi } from '../../lib/api/ddDesk';
import { baseOf } from './ddModel';
import { myReviewsView } from './ddReviewModel';
import { cardCls, eyebrowCls, muted } from './DdUi';

const PILL_OK = 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
const PILL_WARN = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200';
const PILL_PLAIN = 'border-axal-hairline bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200';
const pill = (tone) => `inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${tone}`;
const OPEN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 md:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

/** The read, with Try again. `load` is the client's, so a test can answer it. */
function useMyReviews(load) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', data: null });
    Promise.resolve().then(() => load())
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
  }, [load, tick]);
  return { ...read, retry: useCallback(() => setTick((t) => t + 1), []) };
}

function Expired() {
  return <span className={`block text-[11.5px] font-semibold text-amber-800 dark:text-amber-200`}>Invitation expired. Ask the case lead to resend it.</span>;
}

export default function DdMyReviews({ load = ddDeskApi.myReviews }) {
  const base = baseOf(useLocation().pathname);
  const read = useMyReviews(load);
  const v = myReviewsView(read, base);
  return (
    <section className="flex flex-col gap-3" data-testid="dd-list-my-reviews">
      <p className={`m-0 text-[13.5px] ${muted}`}>Sections you were invited to review. You see only your section of each case.</p>
      {v.status === 'loading' && <div className={`${cardCls} h-24 animate-pulse`} aria-busy="true" data-testid="dd-my-reviews-loading" />}
      {v.status === 'unreadable' && (
        <div className={`${cardCls} p-4`} data-testid="dd-my-reviews-unreadable">
          <Unreadable what="Your reviews" claim="This is not a claim that you have none." onRetry={read.retry} />
        </div>
      )}
      {v.status === 'empty' && (
        <div className={`${cardCls} p-5 text-[13.5px]`} data-testid="dd-my-reviews-empty">
          No section is waiting on you. When a case lead invites you to review a section, it appears here and you are told.
        </div>
      )}
      {v.status === 'ready' && (
        <>
          <div className={`${cardCls} hidden overflow-x-auto md:block`}>
            <table className="w-full text-left text-[13px]" data-testid="dd-my-reviews-table">
              <thead>
                <tr className={eyebrowCls}>
                  {['Case', 'Section', 'Invited', 'NDA', 'Items pending', 'Verdict', ''].map((h, i) => <th key={i} className="px-3 py-2 font-semibold first:pl-4">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={r.key} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`dd-my-review-${r.key}`}>
                    <td className="px-3 py-2.5 pl-4"><b className="text-gray-900 dark:text-gray-100">{r.caseLabel}</b><span className={`block font-mono text-[11.5px] ${muted}`}>{r.caseId}</span></td>
                    <td className="px-3 py-2.5">{r.section}{r.observer && <span className={`ml-1.5 ${pill(PILL_PLAIN)}`}>Observer</span>}{r.expired && <Expired />}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px]">{r.invited || <span className={muted}>Not recorded</span>}</td>
                    <td className="px-3 py-2.5"><span className={pill(r.ndaOnFile ? PILL_OK : PILL_WARN)}>{r.nda}</span></td>
                    <td className="px-3 py-2.5 font-mono">{r.pending == null ? <span className={muted}>Not recorded</span> : `${r.pending} pending`}</td>
                    <td className="px-3 py-2.5"><span className={pill(PILL_PLAIN)}>{r.verdict}</span></td>
                    <td className="px-3 py-2.5 text-right"><Link to={r.href} className={OPEN} data-testid={`dd-my-review-open-${r.key}`}>Open section</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 md:hidden" data-testid="dd-my-reviews-cards">
            {v.rows.map((r) => (
              <li key={r.key} className={`${cardCls} flex flex-col gap-2 p-3`} data-testid={`dd-my-review-card-${r.key}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <b className="text-[14px] text-gray-900 dark:text-gray-100">{r.caseLabel}</b>
                    <span className={`block text-[12.5px] ${muted}`}>{r.section}{r.observer ? ' · Observer' : ''}</span>
                  </div>
                  <span className={pill(r.ndaOnFile ? PILL_OK : PILL_WARN)}>{r.nda}</span>
                </div>
                <p className={`m-0 text-[12px] ${muted}`}>{`${r.pending == null ? 'Items pending not recorded' : `${r.pending} pending`} · ${r.verdict}`}</p>
                {r.expired && <Expired />}
                <Link to={r.href} className={`${OPEN} w-full`} data-testid={`dd-my-review-card-open-${r.key}`}>Open section</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
