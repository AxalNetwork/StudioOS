/**
 * The H36 sub-navigation strip's chrome (D285): a row of links under an HQ
 * row's title that stays visible on every item's page. Its items are literal links written in App.jsx — the shell — so
 * the reachability walk can see them; this file owns only the states and the
 * phone rule.
 *
 * States, from H36: default is a link at weight 600; the selected item is
 * oxblood with a 2px underline and `aria-current`; keyboard focus is a 2px
 * ring at offset 2. At phone width the strip scrolls inside its own
 * container — the page never scrolls sideways — and the selected item is
 * brought into view by that container on load, not by the window.
 *
 * D4860 part 5 (#4860, findings 12 and 13), the Platform strip only:
 *   · a group's name (Infrastructure, Payments, AI, …) is drawn before its
 *     first item, from `HQ_STRIPS`, so App.jsx keeps plain links;
 *   · a console whose address is outside `/admin/platform` (Monitoring,
 *     Telegram) carries an "HQ" mark that says where it lives;
 *   · Overview carries the overall Platform health, always, and a console
 *     carries its state where it is not Healthy (`lib/platformStrip.js`,
 *     the overview's own rule). A symbol and a word, never colour alone;
 *     Unknown is its own dashed state and is never drawn as Healthy.
 *   · a link is `relative`, so its screen-reader text (`sr-only`, absolutely
 *     placed) stays inside the strip's scroller: without it the far items'
 *     text set the page's width and the page scrolled sideways.
 */
import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { stripItemFor, stripGroupStart, outsidePlatform, PLATFORM_HOME } from '../lib/hqStrips.js';
import { usePlatformStrip } from '../lib/platformStrip.js';
import { STATUS } from '../pages/hq/platformOverviewModel.js';

/** `{ on, snap }` inside the Platform strip; null in the others. */
const StripStates = createContext(null);

const TONE = {
  ok: 'border-emerald-300 text-emerald-800 dark:border-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  bad: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-300',
  unknown: 'border-dashed border-gray-400 text-gray-700 dark:border-gray-500 dark:text-gray-200',
  neutral: 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300',
};

/** One state in the strip: its symbol and its word, from the overview's vocabulary. */
export function StripState({ s, of, title }) {
  const x = STATUS[s] || STATUS.Unknown;
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-bold leading-4 ${TONE[x.tone]}`}
      data-status={s}
      data-testid="hq-strip-state"
      title={title}
    >
      <span aria-hidden="true">{x.sym}</span>
      <span><span className="sr-only">{of}: </span>{s === 'Reading' ? 'Reading' : s}</span>
    </span>
  );
}

/** "Lives elsewhere in HQ": the console's address is outside Platform's (finding 13). */
export function ElsewhereInHq({ to }) {
  const path = String(to).split('#')[0];
  return (
    <span
      className="ml-1.5 inline-block rounded border border-gray-300 px-1 align-middle font-mono text-[9px] font-bold leading-[14px] text-gray-500 dark:border-gray-600 dark:text-gray-400"
      title={`Lives at ${path}, outside Platform's addresses`}
      data-testid="hq-elsewhere"
    >
      <span aria-hidden="true">HQ</span>
      <span className="sr-only">, at {path}, outside Platform</span>
    </span>
  );
}

export function StripLink({ to, children }) {
  const location = useLocation();
  const strip = useContext(StripStates);
  const selected = stripItemFor(location.pathname) === to;
  const group = strip ? stripGroupStart(to) : null;
  let state = null;
  if (strip) {
    if (to === PLATFORM_HOME) state = strip.snap ? strip.snap.health.state : 'Reading';
    else state = strip.snap?.byRoute[to] || null;
  }
  return (
    <>
      {group && (
        <span
          className="ml-2 inline-flex items-center whitespace-nowrap border-l border-gray-200 pl-3 pr-0.5 pt-2 pb-2.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:border-gray-800 dark:text-gray-400"
          data-testid="hq-strip-group"
        >
          {group}
        </span>
      )}
      <Link
        to={to}
        aria-current={selected ? 'page' : undefined}
        className={`relative inline-flex items-center whitespace-nowrap text-xs px-3 pt-2 pb-2.5 rounded-t-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] focus-visible:ring-offset-2 ${
          selected
            ? 'font-bold text-[#881337] dark:text-rose-300 shadow-[inset_0_-2px_0_#881337]'
            : 'font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
        }`}
      >
        {children}
        {strip && outsidePlatform(to) && <ElsewhereInHq to={to} />}
        {state && (
          <StripState
            s={state}
            of={to === PLATFORM_HOME ? 'Platform health' : 'State'}
            title={to === PLATFORM_HOME && strip.snap?.at ? `Platform health, observed ${strip.snap.at.toISOString().slice(11, 16)} UTC` : undefined}
          />
        )}
      </Link>
    </>
  );
}

export default function HqSubNavStrip({ label, children }) {
  const location = useLocation();
  const containerRef = useRef(null);
  const platform = label === 'Platform';
  const snap = usePlatformStrip(platform, location.pathname);

  // The container scrolls the selected item into view, never the window: a
  // window scroll would move the page to reach a strip that sits at its top.
  useEffect(() => {
    const c = containerRef.current;
    const el = c?.querySelector('[aria-current="page"]');
    if (!c || !el) return;
    const left = el.offsetLeft - c.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < c.scrollLeft) c.scrollLeft = Math.max(0, left - 8);
    else if (right > c.scrollLeft + c.clientWidth) c.scrollLeft = right - c.clientWidth + 8;
  }, [location.pathname]);

  return (
    <nav
      aria-label={`${label} sections`}
      data-testid={`hq-strip-${label.toLowerCase()}`}
      className="px-4 md:px-6 pt-3 bg-gray-50 dark:bg-gray-950"
    >
      <StripStates.Provider value={platform ? { snap } : null}>
        <div ref={containerRef} className="overflow-x-auto border-b border-gray-200 dark:border-gray-800">
          <div className="flex gap-1 w-max">{children}</div>
        </div>
      </StripStates.Provider>
    </nav>
  );
}
