import React from 'react';
import { Link } from 'react-router-dom';
import { NOT_RECORDED, changeHref } from '../../lib/licencePage';

/**
 * D800 (#2233) — the Licences page's Terms tab (canvas board L2): the
 * schedule in eight sections, each row a label, a value, its source chip and
 * at most one action.
 *
 * WHAT IS HERE TODAY IS THE LEDGER. `MyLicencePage.jsx` builds the rows the
 * licence row itself carries (`/api/licence/mine`: territory, term, fee,
 * share, seats, brand, parties), each chipped "Ledger". The rest of the
 * schedule is D797's (#2242, `services/licenceTerms.ts`); until HQ records it
 * on this licence each section it owns says so in the read's own sentence,
 * and no row is drawn as a guessed value.
 *
 * "REQUEST A CHANGE" IS OFFERED ONLY ON A TERM HQ OWNS AND D799 TAKES
 * (`REQUESTABLE_TERMS`: territory, seats, fee, term). It opens the Requests
 * tab with `?change=<term>`, the `terms_change` sheet's prefill (D804).
 */

const LADDER = [
  ['Notice', 'border-slate-300 bg-slate-100 text-slate-700'],
  ['Your answer', 'border-slate-300 bg-slate-100 text-slate-700'],
  ['Freeze', 'border-amber-300 bg-amber-50 text-amber-800'],
  ['Suspension', 'border-rose-200 bg-rose-50 text-rose-700'],
];

function SourceChip({ source }) {
  const text = source === 'Ledger' ? 'Ledger' : `Contract ${source}`;
  return (
    <span className="whitespace-nowrap rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" data-testid="licence-term-source">
      {text}
    </span>
  );
}

function TermRow({ row, canRequest }) {
  const missing = row.value === NOT_RECORDED;
  return (
    <div
      className="grid grid-cols-2 items-center gap-x-3 gap-y-1 border-t border-gray-100 px-4 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_140px] dark:border-gray-800"
      data-testid="licence-term-row"
      data-term={row.term || ''}
    >
      <span className="col-span-2 text-gray-500 sm:col-span-1 dark:text-gray-400">{row.label}</span>
      <span className={missing ? 'italic text-gray-400 dark:text-gray-500' : 'font-medium text-gray-900 dark:text-gray-100'}>{row.value}</span>
      <span><SourceChip source={row.source} /></span>
      <span className="flex justify-end">
        {canRequest && row.term && (
          <Link to={changeHref(row.term)} className="whitespace-nowrap text-[11.5px] font-bold text-slate-700 dark:text-slate-300" data-testid="licence-term-change">
            Request a change
          </Link>
        )}
      </span>
    </div>
  );
}

/**
 * @param {{ sections: Array<{ title: string, rows: Array<{label, value, source, term?}>, ladder?: boolean, schedule?: boolean }>,
 *           reason?: string, canRequest?: boolean }} props
 */
export default function LicenceTerms({ sections, reason, canRequest = true }) {
  return (
    <div className="space-y-2.5" data-testid="licence-terms">
      {sections.map((s, i) => (
        <details key={s.title} open className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="licence-terms-section">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
            <span><span className="mr-2 font-mono text-xs font-medium text-gray-500">{String(i + 1).padStart(2, '0')}</span>{s.title}</span>
            <span className="text-gray-500 group-open:hidden">+</span>
            <span className="hidden text-gray-500 group-open:inline">−</span>
          </summary>
          {s.rows.map((r) => <TermRow key={r.label} row={r} canRequest={canRequest} />)}
          {s.schedule && (
            <p className="border-t border-gray-100 px-4 py-2.5 text-[11.5px] text-gray-500 dark:border-gray-800 dark:text-gray-400" data-testid="licence-terms-schedule-reason">
              {reason || 'HQ has not recorded this licence’s terms yet.'}
            </p>
          )}
          {s.ladder && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-3 dark:border-gray-800" data-testid="licence-terms-ladder">
              {LADDER.map(([t, tone], k) => (
                <React.Fragment key={t}>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{t}</span>
                  {k < LADDER.length - 1 && <span className="text-gray-400">→</span>}
                </React.Fragment>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
