import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PhoneSheet } from '../../../ui/phone/PhoneSheet';
import { BELOW_MD_QUERY, usePhoneWidth } from '../../../ui/phone/usePhoneWidth';

/**
 * D1204 (#3154) — one ⋯ menu for the Tester pool's rows and, on a phone, a
 * program's applicant cards. On a desktop it drops down under the button; on
 * a phone (below `md`) it is TST16f's bottom sheet: the eyebrow naming the row,
 * "Actions", one 48px row per item and a centred Cancel. Each item is a link
 * (`to`) or a step (`onPick`), never a browser pop-up.
 */
const ITEM = 'px-3 py-2 text-left text-[13px] font-semibold text-axal-ink no-underline hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800';
const SHEET_ITEM = 'flex min-h-[48px] w-full items-center border-b border-axal-hairline px-1 text-left text-[15px] font-bold text-axal-ink no-underline dark:border-gray-800 dark:text-gray-100';

export default function ActionMenu({ items, label, eyebrow, onPick, testId, buttonClass = '' }) {
  const [open, setOpen] = useState(false);
  const phone = usePhoneWidth(BELOW_MD_QUERY);
  const ref = useRef(null);
  const opener = useRef(null);
  useEffect(() => {
    if (!open || phone || typeof document === 'undefined') return undefined;
    const away = (e) => { if (ref.current && typeof ref.current.contains === 'function' && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener?.('mousedown', away);
    document.addEventListener?.('keydown', esc);
    return () => { document.removeEventListener?.('mousedown', away); document.removeEventListener?.('keydown', esc); };
  }, [open, phone]);
  const pick = (it) => { setOpen(false); if (!it.to) onPick?.(it.key); };
  const close = () => setOpen(false);
  return (
    <span ref={ref} className="relative inline-block">
      <button ref={opener} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        className={`inline-flex min-h-[32px] w-8 items-center justify-center rounded-lg border border-axal-hairline text-[15px] font-bold text-axal-ink max-md:min-h-[44px] max-md:w-11 dark:border-gray-700 dark:text-gray-100 ${buttonClass}`}
        onClick={() => setOpen((o) => !o)} data-testid={testId}>⋯</button>
      {open && !phone ? (
        <span role="menu" className="absolute right-0 z-20 mt-1 flex min-w-[190px] flex-col rounded-xl border border-axal-hairline bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid={`${testId}-items`}>
          {items.map((it) => (it.to
            ? <Link key={it.key} role="menuitem" to={it.to} className={ITEM} onClick={close} data-testid={`${testId}-${it.key}`}>{it.label}</Link>
            : <button key={it.key} type="button" role="menuitem" className={ITEM} onClick={() => pick(it)} data-testid={`${testId}-${it.key}`}>{it.label}</button>))}
        </span>
      ) : null}
      {open && phone ? (
        <PhoneSheet label={label} title="Actions" onClose={close} opener={opener}>
          <div data-testid={`${testId}-sheet`}>
            {eyebrow ? <p className="m-0 mb-1 text-[11px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400" data-testid={`${testId}-sheet-eyebrow`}>{eyebrow}</p> : null}
            {items.map((it) => (it.to
              ? <Link key={it.key} to={it.to} className={SHEET_ITEM} onClick={close} data-testid={`${testId}-sheet-${it.key}`}>{it.label}</Link>
              : <button key={it.key} type="button" className={SHEET_ITEM} onClick={() => pick(it)} data-testid={`${testId}-sheet-${it.key}`}>{it.label}</button>))}
            <button type="button" className="mt-2 flex min-h-[48px] w-full items-center justify-center text-[15px] font-bold text-axal-violet dark:text-violet-300" onClick={close} data-testid={`${testId}-sheet-cancel`}>Cancel</button>
          </div>
        </PhoneSheet>
      ) : null}
    </span>
  );
}
