import React, { Suspense, lazy } from 'react';

/**
 * #4574 (H4): a checkout sheet loaded the first time it opens. CheckoutHost and AddTokensHost are mounted for every
 * signed-in member, and each imported its sheet statically, so both sheets were in every first download although
 * they draw only after a click. Here the sheet's module is fetched when it is first asked for.
 *
 * While it loads, a small dialog says so. If the module cannot be fetched (offline, or a deploy retired the chunk),
 * the dialog says the sheet could not load and that no payment started, with Reload and Close. It never fails
 * silently, and never throws into the host's SafeMount, which would take checkout away until the page reloads.
 */
const BACKDROP = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40';
const PANEL = 'flex w-full max-w-[420px] flex-col gap-2 rounded-[16px] bg-white px-5 py-5 dark:bg-gray-900';
const TITLE = 'text-[14px] font-bold text-axal-ink dark:text-gray-100';
const LINK = 'text-[13px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300';

export function SheetOpening({ label }) {
  return (
    <div className={BACKDROP} data-testid="lazy-sheet-backdrop">
      <div role="dialog" aria-modal="true" aria-label={label} aria-busy="true" className={PANEL} data-testid="lazy-sheet-opening">
        <span className={TITLE}>{`Opening ${label.toLowerCase()}…`}</span>
      </div>
    </div>
  );
}

export function SheetUnavailable({ label, onClose, reload = () => window.location.reload() }) {
  return (
    <div className={BACKDROP} data-testid="lazy-sheet-backdrop">
      <div role="alertdialog" aria-modal="true" aria-label={label} className={PANEL} data-testid="lazy-sheet-unavailable">
        <span className={TITLE}>{`${label} couldn’t load just now.`}</span>
        <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">No payment was started. Reload the page to try again.</p>
        <div className="flex gap-3">
          <button type="button" className={LINK} onClick={reload} data-testid="lazy-sheet-reload">Reload</button>
          {onClose && <button type="button" className={LINK} onClick={onClose} data-testid="lazy-sheet-close">Close</button>}
        </div>
      </div>
    </div>
  );
}

/** A component that takes the sheet's own props and loads its module the first time it draws. */
export function lazySheet(load, label) {
  const Lazy = lazy(() => load().catch(() => ({ default: (props) => <SheetUnavailable label={label} onClose={props.onClose} /> })));
  function Sheet(props) {
    return <Suspense fallback={<SheetOpening label={label} />}><Lazy {...props} /></Suspense>;
  }
  Sheet.displayName = `lazySheet(${label})`;
  return Sheet;
}
