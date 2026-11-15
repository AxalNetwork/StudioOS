/** #6089 — Stacked Capital relationships records with an optional wide table. */
import { useState } from 'react';

export default function ResponsiveRecords({ children }) {
  const [table, setTable] = useState(false);
  return (
    <div className="min-w-0">
      <button type="button" aria-pressed={table} data-testid="caprel-view-records" onClick={() => setTable((show) => !show)}
        className="mx-3 my-2 inline-flex min-h-11 items-center rounded-lg border border-axal-hairline px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 lg:hidden">
        {table ? 'View cards' : 'View table'}
      </button>
      <div className={table ? 'overflow-x-auto [&_[data-record-label]]:hidden' : [
        'min-w-0 overflow-hidden lg:overflow-x-auto',
        'max-lg:[&_table]:block max-lg:[&_table]:!min-w-0 max-lg:[&_thead]:sr-only',
        'max-lg:[&_tbody]:grid max-lg:[&_tbody]:gap-2 max-lg:[&_tbody]:p-3',
        'max-lg:[&_tbody_tr]:block max-lg:[&_tbody_tr]:min-w-0 max-lg:[&_tbody_tr]:rounded-lg',
        'max-lg:[&_tbody_tr]:border max-lg:[&_tbody_tr]:p-2 max-lg:[&_tbody_tr:last-child]:border-b',
        'max-lg:[&_td]:block max-lg:[&_td]:min-w-0 max-lg:[&_td]:!whitespace-normal max-lg:[&_td]:!text-left max-lg:[&_td]:[overflow-wrap:anywhere]',
        'max-lg:[&_button]:min-h-11 max-lg:[&_select]:min-h-11',
        '[&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-violet-600',
      ].join(' ')}>
        {children}
      </div>
    </div>
  );
}

/** Visible labels pair each value with its desktop column in the card layout. */
export function RecordLabel({ children }) {
  return <span aria-hidden="true" data-record-label="" className="mb-1 block text-[11px] font-semibold text-axal-muted lg:hidden">{children}</span>;
}
