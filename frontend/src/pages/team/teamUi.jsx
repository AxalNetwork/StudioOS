import React, { useEffect, useRef, useState } from 'react';

/**
 * D1497 (#3727) — the small pieces every Team card shares: the card frame with
 * its title and count, the eyebrow, a table's header row, and the button
 * classes. Local to `pages/team/`, because only these screens draw them.
 */

export const EYEBROW = 'font-mono text-[11px] font-medium uppercase tracking-[.11em] text-axal-muted dark:text-gray-400';
export const MUTED = 'text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
export const INK = 'text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono text-[12px] text-axal-muted dark:text-gray-400';
export const BTN_PRIMARY = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-[9px] bg-axal-violet px-4 text-[13.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 dark:bg-violet-500 dark:hover:bg-violet-400';
export const BTN_SECONDARY = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-[9px] border border-axal-hairline bg-white px-4 text-[13.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const BTN_DANGER = 'inline-flex h-10 items-center justify-center rounded-[9px] border border-axal-destructive-edge bg-white px-4 text-[13.5px] font-semibold text-axal-destructive hover:bg-axal-destructive-tint disabled:opacity-45 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40';
export const BTN_TEXT = 'inline-flex items-center rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-axal-violet-deep hover:underline disabled:cursor-not-allowed disabled:text-axal-faint disabled:no-underline dark:text-violet-300 dark:disabled:text-gray-500';
export const BTN_TEXT_BODY = 'inline-flex items-center rounded-md px-1.5 py-1 text-[12.5px] font-semibold text-axal-ink hover:underline disabled:cursor-not-allowed disabled:text-axal-faint dark:text-gray-200';
export const FIELD = 'h-10 w-full rounded-[9px] border border-axal-hairline bg-white px-3 text-[13.5px] text-axal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-axal-violet/50 disabled:bg-axal-ground disabled:text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:disabled:bg-gray-800';

/** A Team card: white, hairline, radius 12, with an h2 and a mono count when there is one. */
export function TeamCard({ title, count, aside, children, testId }) {
  return (
    <section className="rounded-axal-lg border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-700 dark:bg-gray-900" data-testid={testId}>
      <header className="mb-3 flex items-center gap-2">
        <h2 className={`m-0 text-[15px] font-bold ${INK}`}>{title}</h2>
        {count != null ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={testId ? `${testId}-count` : undefined}>{count}</span> : null}
        {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** A table's header row, with the actions column named for a screen reader only. */
export function HeadRow({ cols, grid }) {
  return (
    <div role="row" className={`hidden md:grid ${grid} items-center gap-3 border-b border-axal-hairline pb-2 dark:border-gray-800`}>
      {cols.map((c) => <span key={c} role="columnheader" className={EYEBROW}>{c}</span>)}
      <span role="columnheader" className="sr-only">Actions</span>
    </div>
  );
}

/** A dashed honest block: what is not here, and that it is not "none". */
export function HonestBlock({ children, action, testId, role = 'status' }) {
  return (
    <div role={role} className="flex flex-col gap-2 rounded-axal-md border border-dashed border-axal-hairline bg-axal-ground/60 px-4 py-4 dark:border-gray-700 dark:bg-gray-950/40" data-testid={testId}>
      <p className={`m-0 ${MUTED}`}>{children}</p>
      {action || null}
    </div>
  );
}

/** "pending owner": a decision that is the owner's to make, drawn dashed and muted. */
export function PendingOwner({ label = 'pending owner' }) {
  return <span className="inline-flex items-center rounded-axal-pill border border-dashed border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:border-gray-600 dark:text-gray-400" data-testid="pending-owner">{label}</span>;
}

/**
 * A pop-up menu's keyboard model (the WAI menu-button pattern): the first item
 * takes focus on open; ArrowDown and ArrowUp move between items; Escape and a
 * press outside close it, and Escape returns focus to the trigger.
 * `ui/` has no shared menu primitive, so the Team page's two menus share this.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const menu = useRef(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
    const items = () => Array.from(menu.current?.querySelectorAll?.('[role="menuitem"]:not([disabled])') || []);
    items()[0]?.focus?.();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus?.(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = items();
      if (!list.length) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement);
      list[e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length].focus?.();
    };
    const onDown = (e) => {
      if (menu.current?.contains?.(e.target) || trigger.current?.contains?.(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  return { open, setOpen, trigger, menu };
}
