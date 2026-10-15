import React, { useEffect, useId, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useEscapeClose } from '../../components/useEscapeClose.js';
import { inertOutside, lockScroll, tabbable, tabTarget } from '../lightboxFocus.js';

export function SheetRow({ title, description, right, mark, to, onClick, onClose, danger = false }) {
  const children = <>
    {mark && <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded bg-violet-100 dark:bg-violet-900/40 text-[11px] font-bold text-violet-700 dark:text-violet-300">{mark}</span>}
    <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{title}</span>
      {description && <span className="block text-[12px] text-gray-600 dark:text-gray-400">{description}</span>}</span>
    {right && <span className="text-[12px] font-bold text-violet-700 dark:text-violet-300">{right}</span>}
    {!right && <span aria-hidden="true">›</span>}
  </>;
  const cls = `flex min-h-[52px] w-full items-center gap-3 border-b border-gray-200 dark:border-gray-800 px-1 text-left ${danger ? 'text-[#b91c1c] dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`;
  return to ? <Link to={to} onClick={onClose} className={cls}>{children}</Link>
    : <button type="button" onClick={onClick} className={cls}>{children}</button>;
}

export function PhoneSheet({ label, title, onClose, opener, children }) {
  const id = useId();
  const layer = useRef(null);
  const box = useRef(null);
  const start = useRef(null);
  const pathname = useLocation().pathname;
  const routeAtOpen = useRef(pathname);
  useEscapeClose(onClose);
  useEffect(() => {
    const node = box.current;
    if (!node) return undefined;
    // Keep the scrim interactive: inert only the siblings of the whole layer.
    const releaseInert = inertOutside(layer.current);
    const releaseScroll = lockScroll(document.body);
    (tabbable(node)[0] || node)?.focus?.();
    return () => { releaseInert(); releaseScroll(); opener?.current?.focus?.(); };
  }, [opener]);
  useEffect(() => { if (pathname !== routeAtOpen.current) onClose(); }, [pathname, onClose]);
  function onKeyDown(event) {
    if (event.key !== 'Tab') return;
    const targets = tabbable(box.current, document.activeElement);
    const next = tabTarget(targets, document.activeElement, event.shiftKey);
    if (next !== null) { event.preventDefault(); (targets[next] || box.current)?.focus(); }
  }
  return <div ref={layer} className="fixed inset-0 z-50 lg:hidden" role="presentation">
    <div className="absolute inset-0 bg-[rgba(24,24,27,.42)]" onClick={onClose} aria-hidden="true" />
    <div ref={box} role="dialog" aria-modal="true" aria-label={title ? undefined : label} aria-labelledby={title ? id : undefined}
      tabIndex={-1} onKeyDown={onKeyDown} onTouchStart={e => { start.current = e.touches[0]?.clientY; }}
      onTouchEnd={e => { if (e.changedTouches[0]?.clientY - start.current > 60) onClose(); }}
      className="absolute inset-x-0 bottom-0 max-h-[78%] overflow-y-auto rounded-t-[20px] bg-white dark:bg-gray-950 px-4 pb-[calc(22px+env(safe-area-inset-bottom))] pt-2 shadow-xl">
      <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-300 dark:bg-gray-700" aria-hidden="true" />
      {title && <h2 id={id} className="mb-2 text-[16px] font-extrabold text-gray-900 dark:text-gray-100">{title}</h2>}
      {children}
    </div>
  </div>;
}
