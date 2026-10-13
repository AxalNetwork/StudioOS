import React, { useEffect, useId, useRef } from 'react';
import { FOCUSABLE, inertOutside, lockScroll, pushDialog, tabTarget, topmost } from './lightboxFocus.js';

/**
 * The one lightbox shell (D685, #1587): a centred dialog over the page, and a
 * full-screen sheet on a phone. "Record a session" is its first user; Build's,
 * Raise's and Grow's cycle CTAs reuse it (D685 §6), so it carries nothing
 * about recording.
 *
 * WHAT IT GUARANTEES, so no caller has to:
 *   · `role="dialog"` and `aria-modal`, named by `label`.
 *   · Focus moves in on open (the first control, or `initialFocus`), Tab and
 *     Shift+Tab stay inside, and focus goes back to what opened it on close.
 *   · Escape and a click on the backdrop call `onClose`; a click inside does
 *     not. Only the top dialog answers Escape.
 *   · Everything behind it is `inert` and `aria-hidden`, and the page does not
 *     scroll behind it.
 *   · Dark mode, and no blur under `prefers-reduced-motion`.
 *
 * IT IS NOT PORTALLED. It renders where it is mounted, at `z-[80]`: above the
 * Worker AI rail's phone sheet (`workerRail.css`, z 50). Portals cannot be
 * server-rendered, and a dialog that cannot be rendered cannot be tested.
 *
 * `onClose` is the caller's, and it decides what closing means (a route
 * change, a state flip); the shell makes no server call of its own.
 */
export default function Lightbox({
  label, onClose, children, eyebrow, title, sub, footer, initialFocus, returnFocusTo, width = 560, testId = 'lightbox',
}) {
  const id = useId();
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = dialog.current;
    if (!el || typeof document === 'undefined' || typeof el.querySelector !== 'function') return undefined; // no DOM to manage (a server render, a stub)
    const opener = returnFocusTo?.current || document.activeElement;
    const release = lockScroll(document.body);
    const restore = inertOutside(el, document.body);
    const pop = pushDialog(id);
    const first = (initialFocus?.current) || el.querySelector(FOCUSABLE) || el;
    first.focus?.();
    const onKey = (e) => {
      if (e.key === 'Escape' && topmost(id)) { e.preventDefault(); close.current?.(); }
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
    const list = Array.from(el.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);
    const to = tabTarget(list, document.activeElement, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    (to === -1 ? el : list[to]).focus();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 max-sm:p-0" data-testid={`${testId}-layer`}>
      <div
        aria-hidden="true"
        data-testid={`${testId}-backdrop`}
        className="absolute inset-0 bg-zinc-900/40 motion-safe:backdrop-blur-[2px] dark:bg-black/60"
        onMouseDown={(e) => { if (e.target === e.currentTarget) close.current?.(); }}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={onTab}
        style={{ maxWidth: width }}
        className="relative flex max-h-[min(92vh,820px)] w-full flex-col overflow-hidden rounded-2xl border border-axal-hairline bg-white shadow-2xl outline-none dark:border-gray-800 dark:bg-gray-950 max-sm:h-full max-sm:max-h-none max-sm:!max-w-none max-sm:rounded-none max-sm:border-0"
      >
        {(title || eyebrow) && (
          <header className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
            <div className="min-w-0">
              {eyebrow && <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">{eyebrow}</div>}
              {title && <h2 className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h2>}
              {sub && <p className="m-0 mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">{sub}</p>}
            </div>
            <button type="button" onClick={() => close.current?.()} aria-label="Close" data-testid={`${testId}-close`}
              className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[20px] leading-none text-axal-muted hover:bg-gray-100 hover:text-axal-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">×</button>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid={`${testId}-body`}>{children}</div>
        {footer && <footer className="border-t border-axal-hairline px-5 py-3 dark:border-gray-800">{footer}</footer>}
      </div>
    </div>
  );
}
