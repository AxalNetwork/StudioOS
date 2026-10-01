/**
 * The H36 sub-navigation strip's chrome (D285): a row of links under an HQ
 * row's title that stays visible after an item lands in the old Admin
 * Console. Its items are literal links written in App.jsx — the shell — so
 * the reachability walk can see them; this file owns only the states and the
 * phone rule.
 *
 * States, from H36: default is a link at weight 600; the selected item is
 * oxblood with a 2px underline and `aria-current`; keyboard focus is a 2px
 * ring at offset 2. At phone width the strip scrolls inside its own
 * container — the page never scrolls sideways — and the selected item is
 * brought into view by that container on load, not by the window.
 */
import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { hereFrom } from '../lib/hqStrips.js';

export function StripLink({ to, children }) {
  const location = useLocation();
  const selected = hereFrom(location.pathname, location.search) === to;
  return (
    <Link
      to={to}
      aria-current={selected ? 'page' : undefined}
      className={`inline-block whitespace-nowrap text-xs px-3 pt-2 pb-2.5 rounded-t-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#881337] focus-visible:ring-offset-2 ${
        selected
          ? 'font-bold text-[#881337] dark:text-rose-300 shadow-[inset_0_-2px_0_#881337]'
          : 'font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100'
      }`}
    >
      {children}
    </Link>
  );
}

export default function HqSubNavStrip({ label, children }) {
  const location = useLocation();
  const containerRef = useRef(null);

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
  }, [location.pathname, location.search]);

  return (
    <nav
      aria-label={`${label} sections`}
      data-testid={`hq-strip-${label.toLowerCase()}`}
      className="px-4 md:px-6 pt-3 bg-gray-50 dark:bg-gray-950"
    >
      <div ref={containerRef} className="overflow-x-auto border-b border-gray-200 dark:border-gray-800">
        <div className="flex gap-1 w-max">{children}</div>
      </div>
    </nav>
  );
}
