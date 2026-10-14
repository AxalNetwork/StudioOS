import React from 'react';
import { Link } from 'react-router-dom';
import { moneyCents, callDate } from '../founder/roundCallParts';

/**
 * D686 §5.6 item 10 (#1598) — Capital relationships' Calls for Capital
 * section (`id="calls"`), Raise's history: the venture's calls, newest first,
 * from the module read's `parts.calls` (S19-A, #1626). Each row opens the call
 * in the Raise shell (`/raise/calls/:uid`); a draft opens where drafts are
 * edited (`/round-calls/:uid`).
 *
 * Flag off, the Worker sends `{ enabled: false }`: "Coming soon. Round calls
 * are not enabled." A failed read is `{ state: 'unreadable' }`: "Unreadable",
 * never an empty list.
 */
export const CALL_STATES = { draft: 'Draft', awaiting_counsel: 'Awaiting counsel', open: 'Open', expired: 'Expired', closed: 'Closed' };
const TONE = {
  open: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  awaiting_counsel: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  expired: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
};
const GREY = 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';

/** One row's line: "Sent 1 Oct · closes 15 Jan · committed $100,000 of $1,500,000 · 3 responses". */
export function callLine(c) {
  const n = Number(c.responded) || 0;
  return [c.sent_at ? `Sent ${callDate(c.sent_at)}` : 'Not sent', `closes ${callDate(c.target_close)}`,
    `committed ${moneyCents(Number(c.committed_cents) || 0)} of ${moneyCents(c.amount_cents)}`, `${n} ${n === 1 ? 'response' : 'responses'}`].join(' · ');
}

export const callHref = (c) => (c.state === 'draft' ? '/round-calls/' : '/raise/calls/') + encodeURIComponent(c.uid);

export default function CallsHistory({ calls }) {
  if (!calls || typeof calls !== 'object') return null;
  const items = Array.isArray(calls.items) ? calls.items : [];
  let body;
  if (calls.state === 'unreadable') body = <p role="alert" className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="calls-unreadable">Unreadable. The calls could not be read; this is not a claim that there are none.</p>;
  else if (calls.enabled === false) body = <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="calls-off">Coming soon. Round calls are not enabled.</p>;
  else if (!items.length) body = <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="calls-none">No call for capital yet.</p>;
  else body = (
    <ul className="m-0 list-none p-0">
      {items.map((c) => {
        const st = c.effective_state || c.state;
        return (
          <li key={c.uid} className="flex items-start justify-between gap-3 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="calls-row">
            <div className="min-w-0">
              <Link to={callHref(c)} className="font-semibold text-axal-ink hover:underline dark:text-gray-100">{c.name}</Link>
              <div className="text-axal-muted dark:text-gray-400">{callLine(c)}</div>
            </div>
            <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE[st] || GREY}`}>{CALL_STATES[st] || st}</span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <section id="calls" className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-calls" aria-labelledby="calls-title">
      <h2 id="calls-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Calls for Capital</h2>
      {body}
    </section>
  );
}
