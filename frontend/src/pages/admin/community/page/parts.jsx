/**
 * #4717 package 6 — The Community page's parts: its classes, a tile or in-card figure, a card, a part in its state, a Manage Community row, a domain's actions and the lightbox opener.
 * Split out of AdminCommunity.jsx; nothing here decides anything.
 */
import React from 'react';
import { OVERDUE_HOURS } from '../communityModel';

export const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
export const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
export const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
export const DANGER = `${BTN} self-start border border-axal-destructive-edge bg-white text-axal-destructive dark:border-red-900 dark:bg-gray-900 dark:text-red-400`;
export const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
export const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
// #4717 package 6: a text link is at least 24px tall (WCAG 2.5.8), whatever its type size.
export const LINK = 'inline-flex min-h-[24px] items-center text-[12px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
export const TAG = 'self-start rounded-full border border-dashed border-axal-muted px-2 py-0.5 text-[11px] font-semibold text-axal-muted dark:text-gray-400';
export const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
export const MONO = 'font-mono tabular-nums';

/** A card's lightbox opener. */
export function Opener({ box, onOpen, children }) {
  return <button type="button" className={`${LINK} self-start`} onClick={() => onOpen(box)} data-testid={`community-open-${box}`}>{children}</button>;
}

export const idle = { status: 'loading', data: null };

export function Skeleton() {
  return <span className="block h-2.5 w-[70%] rounded-full bg-axal-hairline dark:bg-gray-700" />;
}

/** A figure no store records, in a sentence. Never a zero. */
export function Unrecorded({ reason }) {
  return <><span className={TAG}>Not recorded</span><span className={SUB}>{reason}</span></>;
}

/** The amber dot past 72 hours (D915). */
export function OverdueDot({ label = `Overdue: waiting more than ${OVERDUE_HOURS} hours`, testId }) {
  return <span role="img" aria-label={label} title={label} className="inline-block h-2 w-2 flex-none rounded-full bg-[#f59e0b]" data-testid={testId} />;
}

/** A part of a card in its state: Reading…, the reason it could not be read, or not recorded. */
export function PartState({ part, onRetry }) {
  if (part.state === 'loading') return <span className="font-mono text-[12px] text-axal-muted">Reading…</span>;
  if (part.state === 'unreadable') return <Failed reason={part.reason} onRetry={onRetry} />;
  if (part.state === 'unrecorded') return <Unrecorded reason={part.reason} />;
  return null;
}

/** "View as chart" / "View as table", for the chart beside it. */
export function TableToggle({ table, onToggle, testId }) {
  return <button type="button" className={LINK} aria-pressed={table} onClick={onToggle} data-testid={testId}>{table ? 'View as chart' : 'View as table'}</button>;
}

export function Failed({ reason, onRetry }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-axal-destructive-edge bg-axal-destructive-tint p-3.5 text-[13px] leading-normal text-axal-destructive dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
      <span>{reason || 'Could not be read. That is not the same as none.'}</span>
      <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
    </div>
  );
}

/**
 * A figure: a KPI tile, or (`figure`) the same figure drawn inside its domain's
 * card (D4820: show-up in Events, circles and the roster in Network, experts in
 * Wellbeing), in the same four states.
 */
export function Tile({ t, onRetry, children, figure = false }) {
  const box = figure
    ? 'flex min-w-0 flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2 dark:border-gray-700'
    : `${CARD} flex flex-col gap-1.5 px-4 py-3.5`;
  return (
    <div className={box} data-testid={`community-${figure ? 'figure' : 'tile'}-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      {t.state === 'loading' && <><span className="font-mono text-[15px] text-axal-muted">Reading…</span><Skeleton /></>}
      {t.state === 'ready' && (
        <>
          <span className="flex items-center gap-2">
            <span className={`${MONO} ${figure ? 'text-[17px]' : 'text-[26px]'} font-medium tracking-[-.01em] text-axal-ink dark:text-gray-100`}>{t.value}</span>
            {t.overdue ? <OverdueDot label={`Something has waited more than ${OVERDUE_HOURS} hours`} testId={`community-tile-${t.key}-overdue`} /> : null}
          </span>
          {t.sub ? <span className={`${SUB} ${MONO}`}>{t.sub}</span> : null}
          {t.note ? <span className={SUB}>{t.note}</span> : null}
        </>
      )}
      {children}
      {t.state === 'unrecorded' && <Unrecorded reason={t.reason} />}
      {t.state === 'unreadable' && (
        <>
          <span className="text-[13px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>
          <span className={SUB}>{t.reason}</span>
          <button type="button" className={DANGER} onClick={onRetry}>Try again</button>
        </>
      )}
    </div>
  );
}

/**
 * A card: title, then one body per state. `span` is the desktop column span
 * out of 12. `children` is a function, called only when the card is ready, so
 * a body never reads a block that has not answered.
 */
export function Card({ id, title, span = 6, state, reason, onRetry, children, foot }) {
  const cls = { 5: 'col-span-12 lg:col-span-5', 6: 'col-span-12 lg:col-span-6', 7: 'col-span-12 lg:col-span-7', 12: 'col-span-12' }[span];
  return (
    <section className={`${CARD} ${cls} flex min-w-0 flex-col gap-3 px-[18px] py-4`} data-testid={`community-card-${id}`} aria-labelledby={`community-h-${id}`}>
      <h2 id={`community-h-${id}`} className={H2}>{title}</h2>
      {state === 'loading' && <><span className="font-mono text-[12px] text-axal-muted">Reading…</span><Skeleton /></>}
      {state === 'unreadable' && <Failed reason={reason} onRetry={onRetry} />}
      {state === 'unrecorded' && <Unrecorded reason={reason} />}
      {state === 'ready' && children ? children() : null}
      {foot}
    </section>
  );
}

/**
 * D4820 CM01: one Manage Community row: the destination, one short line, its
 * figure when it has one (read, or saying why not), and Open. `children` is the
 * row's literal `Link`, so the reachability walk finds it.
 */
export function ManageRow({ testId, name, what, figure, children }) {
  let fig = null;
  if (figure?.state === 'loading') fig = <span className="font-mono text-[11.5px] text-axal-muted">Reading…</span>;
  else if (figure?.state === 'unreadable') fig = <span className="text-[11.5px] font-bold text-axal-destructive dark:text-red-400">Unreadable</span>;
  else if (figure?.state === 'ready') fig = <span className={`${MONO} whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100`}>{figure.text}</span>;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-axal-hairline px-4 py-2.5 first:border-t-0 dark:border-gray-800" data-testid={testId}>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">{name}</span>
        <span className={SUB}>{what}</span>
      </span>
      <span className="flex items-center gap-3">{fig}{children}</span>
    </li>
  );
}

/**
 * D4820: a domain's two actions, the same on every card: View details opens
 * its analytics lightbox (when it has one) and Manage … → its console.
 * `children` are the Manage links, literal, for the reachability walk.
 */
export function DomainActions({ box, onOpen, children }) {
  return (
    <span className="flex flex-wrap gap-4" data-testid="community-actions">
      {box ? <Opener box={box} onOpen={onOpen}>View details</Opener> : null}
      {children}
    </span>
  );
}
