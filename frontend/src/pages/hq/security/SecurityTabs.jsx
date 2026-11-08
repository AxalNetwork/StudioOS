import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { SECURITY_TABS, tabAfterKey, tabHref } from './securityTabs.js';
import { StateShape } from './StatusBadge.jsx';
import { securityState } from './securityStates.js';

/**
 * D4800 (#4800, canvas SE01 header, SE11a phone, SEC accessibility) — the
 * workspace switcher.
 *
 * DESKTOP AND TABLET: a `nav` of links with `aria-current="page"`, because
 * each workspace is a route (`?tab=`), not an in-page panel (SEC: "they are
 * routes, not ARIA tabs"). The arrow keys still move between them, as the
 * issue asks: Left and Right wrap, Home and End go to the ends, and the
 * workspace opens as focus lands so the URL always names what is shown.
 *
 * PHONE: a 44 px section select (the #4800 phone board, S4), since seven
 * links do not fit at 390 px without squeezing.
 *
 * A workspace with open findings carries a mark — the worst finding's shape
 * and the count — read out as "2 items need action".
 */
export default function SecurityTabs({ current, onSelect, marks = {} }) {
  const refs = useRef({});
  const onKey = (e) => {
    const next = tabAfterKey(current, e.key);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };
  return (
    <>
      <label className="mt-4 block sm:hidden">
        <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Section</span>
        <select
          value={current}
          onChange={(e) => onSelect(e.target.value)}
          className="mt-1 block min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[14px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          data-testid="security-section-select"
        >
          {SECURITY_TABS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}{marks[t.key] ? ` · ${marks[t.key].count} need${marks[t.key].count === 1 ? 's' : ''} action` : ''}
            </option>
          ))}
        </select>
      </label>
      <nav
        aria-label="Security workspaces"
        className="mt-4 hidden flex-wrap gap-1 border-b border-axal-hairline sm:flex dark:border-gray-800"
        data-testid="security-tabs"
      >
        {SECURITY_TABS.map((t) => {
          const on = t.key === current;
          const mark = marks[t.key];
          return (
            <Link
              key={t.key}
              ref={(el) => { refs.current[t.key] = el; }}
              to={tabHref(t.key)}
              aria-current={on ? 'page' : undefined}
              onKeyDown={onKey}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                on
                  ? 'border-violet-600 text-axal-ink dark:border-violet-400 dark:text-white'
                  : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'
              }`}
              data-testid={`security-tab-${t.key}`}
            >
              {t.label}
              {mark && (
                <span
                  className={`inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-bold ${
                    mark.state === 'failed' ? 'bg-red-700 text-white dark:bg-red-600' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                  }`}
                  data-testid={`security-tab-mark-${t.key}`}
                  data-state={mark.state}
                >
                  <StateShape shape={securityState(mark.state).shape} />
                  {mark.count}
                  <span className="sr-only">{` ${mark.count === 1 ? 'item needs' : 'items need'} action`}</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
