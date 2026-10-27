import React, { useEffect, useId, useRef } from 'react';
import { FOCUSABLE, inertOutside, lockScroll, pushDialog, tabbable, tabTarget, topmost } from './lightboxFocus.js';
import { pushSheet } from './sheetStore.js';
import './sheet.css';

/**
 * D1317 — THE ONE DETAIL SHEET: every record's detail panel opens here, as a
 * right-side sheet docked beside the Eadwyn rail (the owner's ruling of
 * 2026-10-27, after Grow › Publish to… in the "Publish to… and sent history"
 * canvas).
 *
 * WHERE IT SITS.
 *   · Over the current page, full height. Its right edge meets the rail's
 *     left edge: while a sheet is open the rail draws its 44px spine
 *     (`WorkerRail` reads `sheetStore.js`), undimmed and clickable. On a page
 *     with no rail it docks to the window's right edge. The dock is CSS:
 *     `:root[data-eadwyn-rail="docked"]` sets `--axs-dock: 44px` at 1024px
 *     and up (`sheet.css`), the width the rail's own spine takes there.
 *   · The scrim dims the page to the left of the sheet and the rail, never
 *     the rail.
 *   · `width` is the panel's own (480, 520, 560, 640, 720 or 760), capped at
 *     `calc(100vw - 108px)`.
 *   · Card ground, a 1px hairline on the left only (#ececf1; #374151 dark),
 *     16px radius on the left corners only, shadow -24px 0 56px.
 *   · The header (eyebrow, title, ×) and the footer stay put; only the body
 *     scrolls.
 *   · It slides in from the rail's edge in 200ms, and appears with no motion
 *     under `prefers-reduced-motion`. The slide ends on no transform, so a
 *     fixed dialog opened inside the sheet (a confirmation) is not clipped.
 *   · Below 640px it is a full-screen page, or a bottom sheet with
 *     `phone="sheet"`, as the panels were.
 *
 * WHAT IT GUARANTEES (the `Lightbox` contract, D685):
 *   · `role="dialog"`, `aria-modal`, named by its title (`aria-labelledby`),
 *     or by `label` when it has none.
 *   · Focus moves in on open (`initialFocus`, else the first control), Tab and
 *     Shift+Tab stay inside, and focus returns to the opener on close.
 *   · Escape (only the top dialog's: the stack is `Lightbox`'s, so a
 *     confirmation over a sheet closes first), the ×, and a press on the
 *     scrim call `onClose`. `onEscape` may ask before closing.
 *   · Everything behind it is inert except the rail (`[data-sheet-keep]`),
 *     and the page does not scroll behind it.
 *
 * URLS. A panel with an address (`/admin/accounts/all/42`) is mounted by its
 * list page while the address names a record; `onClose` navigates back to the
 * list's address. The sheet itself makes no route or server call.
 *
 * Not portalled, like `Lightbox`: a portal cannot be server-rendered, and a
 * sheet that cannot be rendered cannot be tested.
 */
export const SHEET_WIDTHS = Object.freeze([480, 520, 560, 640, 720, 760]);

export default function Sheet({
  label, title, eyebrow, sub, onClose, onEscape, footer, children, width = 560, testId = 'sheet',
  initialFocus, returnFocusTo, phone = 'full', headerActions = null,
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => pushSheet(id, () => close.current?.()), [id]);

  useEffect(() => {
    const el = dialog.current;
    if (!el || typeof document === 'undefined' || typeof el.querySelector !== 'function') return undefined; // no DOM to manage (a server render, a stub)
    const opener = returnFocusTo?.current || document.activeElement;
    const release = lockScroll(document.body);
    const keep = typeof document.querySelectorAll === 'function' ? Array.from(document.querySelectorAll('[data-sheet-keep]')) : [];
    const restore = inertOutside(el.parentNode || el, document.body, keep);
    const pop = pushDialog(id);
    const first = initialFocus?.current || el.querySelector(FOCUSABLE) || el;
    first.focus?.();
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !topmost(id)) return;
      e.preventDefault();
      (escape.current || close.current)?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      pop(); restore(); release();
      if (opener && opener.isConnected !== false) opener.focus?.();
    };
  }, [id, initialFocus, returnFocusTo]);

  const onTab = (e) => {
    if (e.key !== 'Tab') return;
    const el = dialog.current;
    const list = tabbable(el, document.activeElement);
    const to = tabTarget(list, document.activeElement, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    (to === -1 ? el : list[to]).focus();
  };

  const named = title ? { 'aria-labelledby': titleId } : { 'aria-label': label };
  return (
    <div className="axs-layer fixed inset-y-0 left-0 z-[80]" data-testid={`${testId}-layer`} data-phone={phone}>
      <div
        aria-hidden="true"
        data-testid={`${testId}-scrim`}
        className="axs-scrim absolute inset-0 bg-zinc-900/[.42] dark:bg-black/60"
        onMouseDown={(e) => { if (e.target === e.currentTarget) close.current?.(); }}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        {...named}
        tabIndex={-1}
        data-testid={testId}
        data-width={width}
        onKeyDown={onTab}
        style={{ width, maxWidth: 'calc(100vw - 108px)' }}
        className="axs-sheet absolute inset-y-0 right-0 flex flex-col overflow-hidden rounded-l-2xl border-l border-[#ececf1] bg-white text-axal-ink shadow-[-24px_0_56px_rgba(9,9,11,.2)] outline-none dark:border-[#374151] dark:bg-gray-950 dark:text-gray-100"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-axal-hairline px-5 py-[18px] dark:border-gray-800" data-testid={`${testId}-header`}>
          <div className="min-w-0">
            {eyebrow && <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">{eyebrow}</div>}
            {title && <h2 id={titleId} className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h2>}
            {sub && <p className="m-0 mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">{sub}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <button type="button" onClick={() => close.current?.()} aria-label="Close" data-testid={`${testId}-close`}
              className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[20px] leading-none text-axal-muted hover:bg-gray-100 hover:text-axal-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">×</button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid={`${testId}-body`}>{children}</div>
        {footer && <footer className="shrink-0 border-t border-axal-hairline px-5 py-3.5 dark:border-gray-800" data-testid={`${testId}-footer`}>{footer}</footer>}
      </div>
    </div>
  );
}
