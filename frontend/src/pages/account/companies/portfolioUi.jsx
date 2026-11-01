import React from 'react';
import { Link } from 'react-router-dom';
import Pill from '../../../ui/Pill.jsx';
import { Unrecorded } from '../../../ui/Honesty.jsx';
import { EYEBROW, INK, MUTED, BTN_SECONDARY } from '../../team/teamUi.jsx';

/**
 * D1413 (#3696) — the small pieces every Portfolio screen draws: the company
 * mark (a lavender square) and the project mark (a dashed square), the type
 * badge, the address chip, a fact, the card frame and a failed block. Local
 * to this folder; the button and text classes are Team's (`teamUi.jsx`).
 */

export { EYEBROW, INK, MUTED };
export const CARD = 'rounded-axal-lg border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-700 dark:bg-gray-900';
export const LINK = 'font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';

const initialsOf = (name) => String(name || '?').replace(/[[\]]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

/** A company's mark: lavender, its initials in violet. */
export function CompanyMark({ name, size = 40 }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[24%] border border-violet-200 bg-axal-lavender font-mono font-bold text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
      data-mark="company">{initialsOf(name)}</span>
  );
}

/** A project's mark: a dashed square with its initials. */
export function ProjectMark({ name, size = 28 }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[24%] border-[1.5px] border-dashed border-axal-hairline bg-white font-mono font-bold text-axal-ink dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
      data-mark="project">{initialsOf(name)}</span>
  );
}

/** "Company" (lavender) or "Project" (neutral). */
export function TypeBadge({ kind }) {
  return kind === 'company'
    ? <Pill tone="info" data-testid="type-company">Company</Pill>
    : <Pill tone="neutral" data-testid="type-project">Project</Pill>;
}

/** An address chip, `/c/northwind-labs`, linked when the Worker gave the address. */
export function SlugChip({ path }) {
  if (!path) return null;
  return (
    <Link to={path} className="inline-flex items-center rounded-[7px] border border-axal-hairline bg-axal-ground px-1.5 py-0.5 font-mono text-[11.5px] text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" data-testid="slug-chip">{path}</Link>
  );
}

/** One fact: its value, muted "Not recorded", or "[what] could not be read". Never a 0 for a missing figure. */
export function Fact({ fact, mono = false }) {
  if (!fact || fact.kind === 'none') return <Unrecorded />;
  if (fact.kind === 'unread') return <span className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="fact-unread">{fact.what} could not be read</span>;
  return <span className={mono ? 'font-mono text-[12.5px]' : undefined}>{fact.text}</span>;
}

/** A card with its h2 title, an optional count and an aside. */
export function PCard({ title, count, aside, children, testId }) {
  return (
    <section className={CARD} data-testid={testId}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.02em] ${INK}`}>{title}</h2>
        {count != null ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{count}</span> : null}
        {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** A definition list in the canvas's shape: a mono key column and the value. */
export function FactList({ rows, testId }) {
  return (
    <dl className="m-0 grid gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-[190px_minmax(0,1fr)]" data-testid={testId}>
      {rows.map(([k, v, extra]) => (
        <React.Fragment key={k}>
          <dt className="font-mono text-[10.5px] uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{k}</dt>
          <dd className={`m-0 ${INK}`}>{v}{extra ? <> {extra}</> : null}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * A block whose read failed, said alone: "[what] could not be read." and Try
 * again. It replaces the block's body, so nothing in it is drawn as none.
 */
export function Failed({ what, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-axal-md border border-dashed border-axal-hairline px-3.5 py-3 dark:border-gray-700" data-testid={testId}>
      <span className={`text-[13px] ${INK}`}>{what} could not be read. That is not the same as having none.</span>
      {onRetry ? <button type="button" className={BTN_SECONDARY} onClick={onRetry} data-testid={testId ? `${testId}-retry` : undefined}>Try again</button> : null}
    </div>
  );
}

/** Reading…, with a busy region a screen reader announces once. */
export function Reading({ testId, lines = 3 }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2" data-testid={testId}>
      <span className={MUTED}>Reading…</span>
      {Array.from({ length: lines }, (_, i) => <span key={i} className="h-2.5 rounded-full bg-axal-ground dark:bg-gray-800" style={{ width: `${80 - i * 12}%` }} />)}
    </div>
  );
}
