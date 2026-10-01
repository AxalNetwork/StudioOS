import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, MoreHorizontal, X } from 'lucide-react';
import { mobilePlan, rowActive } from '../lib/mobileTabs';
import './mobileTabBar.css';

/**
 * The phone's tab bar: four tabs and More, below 1024px (D425; Mobile canvas
 * M1, and M5's safe-area and 44pt rules).
 *
 * WHAT IT IS AND IS NOT. The sidebar is a drawer behind a hamburger on a
 * phone, so every destination is two taps and a scan away. This bar puts the
 * four rows a founder opens by habit under the thumb and the rest one tap
 * deeper, in a More sheet. It is navigation only: the pages, their zone pills
 * and the hamburger drawer are unchanged, and the drawer still holds every
 * row, so nothing becomes reachable only from here.
 *
 * WHERE THE ROWS COME FROM. `lib/mobileTabs.js` builds the tabs and More from
 * the founder sidebar's own rows (label, icon, route, `match`), plus the three
 * doors a phone otherwise lacks — Messages, Trust, Company Settings. A tab
 * lights for exactly the pages its sidebar row lights for.
 *
 * MORE IS A SHEET, NEVER A SCREEN — the canvas's rule: 52px rows, dismissed by
 * a tap on the backdrop, a swipe down, Escape or the close button, with the
 * page still visible behind it. It is a real dialog: `aria-modal`, focus moves
 * into it on open and back to More on close, and following a row closes it.
 *
 * SAFE AREAS. The page tag asks for `viewport-fit=cover` (index.html), so the
 * bar and the sheet pad themselves by `env(safe-area-inset-bottom)` to clear
 * the home indicator, and while the bar is up the page's own content is padded
 * by the bar's height (`mobileTabBar.css`), so nothing sits under it.
 *
 * FOUNDER FIRST. `mobilePlan` returns null for the other licences until their
 * allocations are built, and the bar then renders nothing.
 *
 * MOUNTED BY THE SHELL, NOT HERE. App.jsx's mobile chrome is Session 5's, so
 * this PR ships the component and its tests, and the mount (one import, one
 * element beside the drawer) is the shell's to add.
 */

/** How far a downward drag must travel before the sheet counts it as a dismiss. */
const SWIPE_DISMISS_PX = 60;

export default function MobileTabBar({ role }) {
  const { pathname } = useLocation();
  const plan = mobilePlan(role);
  const drawn = plan !== null;
  const [open, setOpen] = useState(false);
  const moreButton = useRef(null);
  const sheetId = `${useId()}-more`;

  // The page's own content is padded by the bar's height only while a bar is
  // actually drawn: the attribute is what `mobileTabBar.css` keys off, and it
  // leaves with the last bar, as the rail's collapse attribute does.
  useEffect(() => {
    if (!drawn || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.setAttribute('data-mobile-tabbar', 'on');
    return () => root.removeAttribute('data-mobile-tabbar');
  }, [drawn]);

  // A route change closes the sheet — including one the sheet did not cause,
  // such as the browser's back button.
  useEffect(() => { setOpen(false); }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    moreButton.current?.focus();
  }, []);

  if (!plan) return null;
  const moreActive = plan.more.some((row) => rowActive(row, pathname));

  return (
    <>
      <nav
        aria-label="Primary"
        className="mtb fixed inset-x-0 bottom-0 z-30 flex border-t border-axal-hairline bg-white lg:hidden dark:border-gray-800 dark:bg-gray-950"
        data-testid="mobile-tab-bar"
      >
        {plan.tabs.map((row) => (
          <TabLink key={row.to} row={row} active={rowActive(row, pathname)} />
        ))}
        <button
          ref={moreButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={sheetId}
          className={`${TAB} ${moreActive ? TAB_ON : TAB_OFF}`}
          data-active={moreActive ? 'true' : 'false'}
          data-testid="button-mobile-tab-more"
        >
          <MoreHorizontal size={22} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
      {open && <MoreSheet id={sheetId} rows={plan.more} pathname={pathname} onClose={close} />}
    </>
  );
}

// 56px tall and a fifth of the width: the whole column is the target, well
// over the canvas's 44pt floor. 10px labels are the canvas's own.
const TAB = 'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] '
  + 'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 '
  + 'focus-visible:outline-axal-violet';
const TAB_ON = 'font-bold text-axal-violet-deep dark:text-violet-300';
const TAB_OFF = 'font-semibold text-axal-muted dark:text-gray-400';

function TabLink({ row, active }) {
  const Icon = row.icon;
  return (
    <Link
      to={row.to}
      aria-current={active ? 'page' : undefined}
      className={`${TAB} ${active ? TAB_ON : TAB_OFF}`}
      data-testid={`link-mobile-tab-${row.to.slice(1).replace(/\//g, '-')}`}
    >
      {Icon && <Icon size={22} aria-hidden="true" />}
      <span className="max-w-full truncate">{row.label}</span>
    </Link>
  );
}

/**
 * The More sheet. Exported so a test can render it open; the bar is the only
 * thing that mounts it.
 */
export function MoreSheet({ id, rows, pathname, onClose }) {
  const titleId = `${id}-title`;
  const first = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onTouchStart = (e) => { drag.current = e.touches?.[0]?.clientY ?? null; };
  const onTouchEnd = (e) => {
    const start = drag.current;
    drag.current = null;
    const end = e.changedTouches?.[0]?.clientY;
    if (start != null && end != null && end - start > SWIPE_DISMISS_PX) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden" data-testid="mobile-more-sheet">
      <button
        type="button"
        aria-label="Close More"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        data-testid="button-mobile-more-backdrop"
      />
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="mtb-sheet absolute inset-x-0 bottom-0 rounded-t-[20px] bg-white pt-2 shadow-[0_-6px_30px_rgba(24,24,27,.2)] dark:bg-gray-900"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-axal-pill bg-gray-300 dark:bg-gray-600" aria-hidden="true" />
        <div className="flex items-center justify-between px-4 pb-1">
          <h2 id={titleId} className="text-[10px] font-extrabold uppercase tracking-axal-label-wide text-axal-muted dark:text-gray-400">
            More
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-axal-sm text-axal-muted hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            data-testid="button-mobile-more-close"
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only">Close More</span>
          </button>
        </div>
        <ul>
          {rows.map((row, i) => {
            const Icon = row.icon;
            const active = rowActive(row, pathname);
            return (
              <li key={row.to} className="border-t border-gray-100 dark:border-gray-800">
                <Link
                  ref={i === 0 ? first : undefined}
                  to={row.to}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[52px] items-center gap-3 px-4 text-[16px] font-semibold ${active ? 'text-axal-violet-deep dark:text-violet-300' : 'text-axal-ink dark:text-gray-100'}`}
                  data-testid={`link-mobile-more-${row.to.slice(1).replace(/\//g, '-')}`}
                >
                  {Icon && <Icon size={19} aria-hidden="true" className="flex-none text-axal-muted dark:text-gray-400" />}
                  <span className="flex-1">{row.label}</span>
                  <ChevronRight size={16} aria-hidden="true" className="text-axal-muted dark:text-gray-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
