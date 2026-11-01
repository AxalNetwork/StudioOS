/**
 * D1454 (#3710, IV-D1): one record header for every cycle.
 *
 * `CycleHeader` (record mode) holds two empty slots: one beside the title for
 * the record's pills, one at top right for its one action row. The record page
 * fills them through `RecordHeaderRow`, a portal, so each record keeps its own
 * handlers (the interview's Edit details, Delete and Open recording are its
 * own) and the header still draws them in one place:
 *   primary · Ask · Email · the other actions · ⋯ (the danger actions).
 * No action is left on a row of its own, and nothing leaves an empty band.
 *
 * `CycleRoute` provides the slots, the Email action (D1344, EM4) and Ask
 * (D1443's `PageAsk`). A record drawn outside the route (a test, a preview)
 * has no slots, so the same row draws inline where the record put it.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { isPlainClick } from './cycleModel.js';
import { dispatchOf } from './recordModel.js';
import { headerRow } from './recordHeaderModel.js';

const Slots = createContext({ pills: null, actions: null, email: null, emailTo: null, ask: null });

export function RecordHeaderProvider({ pills = null, actions = null, email = null, emailTo = null, ask = null, children }) {
  return <Slots.Provider value={{ pills, actions, email, emailTo, ask }}>{children}</Slots.Provider>;
}
export const useRecordHeader = () => useContext(Slots);

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3.5 text-[12.5px] font-bold max-lg:min-h-[44px]';
export const HEADER_BUTTON = {
  primary: `${BTN} border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-700`,
  default: `${BTN} border-axal-hairline bg-white text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`,
};
const ITEM = 'flex min-h-[44px] w-full items-center px-3 text-left text-[13px] font-semibold hover:bg-axal-ground dark:hover:bg-gray-800';

/** One declared action as a header button, run through the record's own handlers. */
export function HeaderAction({ action, handlers = {}, tone = 'default', className, role, onDone }) {
  const kind = dispatchOf(action);
  if (!kind) return null;
  const cls = className || HEADER_BUTTON[tone] || HEADER_BUTTON.default;
  const testid = `record-header-${action.key}`;
  if (kind === 'link' || kind === 'mailto') {
    return <a href={action.href} className={cls} role={role} data-testid={testid} onClick={(event) => {
      onDone?.();
      // As D696's row: a link or a mailto goes through the record's onLink on a plain click, so the parent decides.
      if (handlers.onLink && isPlainClick(event)) { event.preventDefault(); handlers.onLink(action); }
    }}>{action.label}</a>;
  }
  const run = kind === 'form' ? handlers.onForm : kind === 'write' ? handlers.onWrite : handlers.onClient;
  return <button type="button" className={cls} role={role} disabled={!run} data-testid={testid}
    onClick={() => { onDone?.(); run?.(action); }}>{action.label}</button>;
}

/**
 * ⋯: the danger actions and any extra item the record adds (the interview's
 * "Open the session"). Escape and a press outside close it; focus returns to ⋯.
 */
export function MoreMenu({ actions = [], extra = [], handlers = {}, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus?.(); } };
    const onDown = (e) => { if (box.current && !box.current.contains?.(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  if (!actions.length && !extra.length) return null;
  const close = () => setOpen(false);
  return <div ref={box} className="relative">
    <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
      className={`${HEADER_BUTTON.default} px-2.5`} data-testid="record-header-more" onClick={() => setOpen((o) => !o)}>
      <span aria-hidden="true">⋯</span>
    </button>
    {open && <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[200px] overflow-hidden rounded-xl border border-axal-hairline bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid="record-header-menu">
      {extra.map((item) => <Link key={item.key} to={item.href} role="menuitem" className={`${ITEM} text-axal-ink dark:text-gray-100`} data-testid={`record-header-${item.key}`} onClick={close}>{item.label}</Link>)}
      {actions.map((action) => <HeaderAction key={action.key} action={action} handlers={handlers} role="menuitem" onDone={close}
        className={`${ITEM} ${action.tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-gray-100'}`} />)}
    </div>}
  </div>;
}

/** The row itself: primary, Ask, Email, the rest, ⋯. */
export function HeaderActions({ actions, handlers, extra = [], email = null, ask = null }) {
  const { primary, secondary, menu } = headerRow(actions);
  return <div className="flex flex-wrap items-center justify-end gap-2" data-testid="record-actions" data-header="true">
    {primary && <HeaderAction action={primary} handlers={handlers} tone="primary" />}
    {ask}
    {email}
    {secondary.map((action) => <HeaderAction key={action.key} action={action} handlers={handlers} />)}
    <MoreMenu actions={menu} extra={extra} handlers={handlers} />
  </div>;
}

/**
 * The record's pills and action row, sent to the header's slots, or drawn
 * inline (`inline`, the old place) when the page has no header slots.
 */
export function RecordHeaderRow({ pills = null, actions = [], handlers = {}, extra = [], inline = null }) {
  const slots = useRecordHeader();
  const row = <HeaderActions actions={actions} handlers={handlers} extra={extra} email={slots.email} ask={slots.ask} />;
  if (slots.pills && slots.actions) {
    return <>{pills && createPortal(pills, slots.pills)}{createPortal(row, slots.actions)}</>;
  }
  return inline ? inline(pills, row) : <div className="flex flex-wrap items-center justify-between gap-3.5">{pills}{row}</div>;
}
