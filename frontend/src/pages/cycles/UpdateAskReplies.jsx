import React from 'react';

/**
 * D686 §5.8 item 12 (#1599) — "From update asks" on Distribution (customer
 * asks, a Lead) and Partner network (partner asks, a Partner): the replies a
 * shared update's asks brought in, from the module read's
 * `parts.from_update_asks` (S19-B, #1595). Read beside the module's rows,
 * never copied into them. Nothing is drawn while there is none.
 */
const day = (v) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) || String(v).length <= 10 ? '' : 'Z')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
};
const PILL = 'whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10.5px] font-bold text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200';

export default function UpdateAskReplies({ replies, pill }) {
  const rows = Array.isArray(replies) ? replies : [];
  if (!rows.length) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-update-asks" aria-labelledby="update-asks-title">
      <h2 id="update-asks-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From update asks</h2>
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <li key={r.uid} className="flex items-start justify-between gap-3 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="update-ask-reply">
            <div className="min-w-0">
              <div className="font-semibold text-axal-ink dark:text-gray-100">{r.name || 'Someone'}{day(r.created_at) ? ` · ${day(r.created_at)}` : ''}</div>
              <div className="text-axal-muted dark:text-gray-400">{r.message}</div>
              {r.ask_text && <div className="text-[11.5px] text-axal-faint dark:text-gray-500">In reply to: {r.ask_text}</div>}
            </div>
            <span className={PILL}>{pill}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
