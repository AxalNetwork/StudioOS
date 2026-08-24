// One accordion row of the clause-by-clause builder.
//
// The body is ALWAYS mounted — visibility is toggled with `hidden`, never with
// conditional mounting. That keeps every generator input in the DOM (so typed
// values survive expand/collapse and existing selectors resolve without a
// click) and avoids a remount on every toggle.
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, AlertTriangle, ExternalLink } from 'lucide-react';
import StatusPill from './StatusPill';

const CRIT = (
  <span className="text-[9px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/40 rounded px-1.5 py-0.5">
    Critical
  </span>
);

export default function ClauseRow({ clause, open, onToggle, showExplain, children }) {
  const c = clause;
  return (
    <div className="border-t border-gray-100 dark:border-gray-800 first:border-t-0" data-testid={c.testid}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`clause-toggle-${c.key}`}
        className="w-full text-left px-1 py-3.5 flex items-start gap-3 hover:bg-violet-50/40 dark:hover:bg-violet-900/10 rounded-lg transition"
      >
        <ChevronDown
          size={14}
          className={`mt-1 shrink-0 text-gray-400 dark:text-gray-500 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{c.label}</span>
            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 tabular-nums">{c.section}</span>
            {c.critical && CRIT}
          </div>
          <div className="text-[12px] text-gray-600 dark:text-gray-300 mt-1 break-words">{c.value}</div>
          {showExplain && (
            <div className="text-[11.5px] italic text-gray-400 dark:text-gray-500 mt-1 leading-snug">{c.explain}</div>
          )}
          {c.note && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2" data-testid={`clause-note-${c.key}`}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                <span className="font-bold">Dependency note: </span>{c.note}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusPill status={c.status} />
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">{c.source}</span>
        </div>
      </button>

      {/* Always mounted. */}
      <div className={open ? 'px-1 pb-4 pl-8' : 'hidden'}>
        {/* The design's drawer framed the current term and always showed the
            plain-English explanation. Both live here so expanding a clause
            presents the term under review, not just the editor. */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 mb-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Current term</div>
          <div className="text-[12.5px] text-gray-800 dark:text-gray-100 break-words" data-testid={`clause-current-${c.key}`}>{c.value}</div>
        </div>
        {c.explain && (
          <div className="mb-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">Plain-English explanation</div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed" data-testid={`clause-explain-${c.key}`}>{c.explain}</p>
          </div>
        )}
        {children}
        {c.sourceTo && (
          <Link
            to={c.sourceTo}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline"
            data-testid={`clause-source-link-${c.key}`}
          >
            Open {c.source.replace(/^from /, '')} <ExternalLink size={10} />
          </Link>
        )}
        {/* Advisory cross-link. Unlike `sourceTo` this does NOT claim the
            linked tool as the value's provenance — it is somewhere worth
            looking, named explicitly by the view model. */}
        {!c.sourceTo && c.linkTo && c.linkLabel && (
          <Link
            to={c.linkTo}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline"
            data-testid={`clause-link-${c.key}`}
          >
            {c.linkLabel} <ExternalLink size={10} />
          </Link>
        )}
      </div>
    </div>
  );
}
