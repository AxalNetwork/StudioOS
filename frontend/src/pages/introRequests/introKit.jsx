/** D9068 (#9068): the small shared pieces of the member's introduction pages — header, card, status chip and buttons — in the Network canvases' look, light and dark. */
import React from 'react';
import { Link } from 'react-router-dom';

/** Move focus to an element when it can take it (a heading after a step, an error summary after Save). */
export const focusEl = (el) => { if (el && typeof el.focus === 'function') el.focus(); };

const TONES = {
  plain: 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200',
  good: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300',
  bad: 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-300',
  violet: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-300',
};
// Expired, Unreadable and Not applicable carry a dashed border, so no state relies on colour (NRD-14).
const DASHED = new Set(['Expired', 'Unreadable', 'Not applicable']);

/** One status: its glyph and its word, never colour alone. */
export function Chip({ s, extra, className = '' }) {
  if (!s) return null;
  const tone = TONES[s.tone] || TONES.plain;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${DASHED.has(s.word) ? 'border-dashed' : ''} ${tone} ${className}`.trim()} data-chip={s.word}>
      <span aria-hidden="true">{s.glyph}</span>
      {s.word}
      {extra ? <span className="font-normal"> · {extra}</span> : null}
    </span>
  );
}

export const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 sm:min-h-[36px]';
export const BTN_PRIMARY = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-violet-700 bg-violet-700 px-3.5 text-[13px] font-semibold text-white hover:bg-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-500 dark:bg-violet-600 dark:hover:bg-violet-500 sm:min-h-[36px]';
export const BTN_GHOST = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-violet-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300 sm:min-h-[36px]';
export const INPUT = 'block w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] text-gray-900 placeholder:text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 aria-[invalid=true]:border-red-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-400 sm:min-h-[38px]';
export const LABEL = 'block text-[12.5px] font-semibold text-gray-900 dark:text-gray-100';
export const HINT = 'mt-1 block text-[12px] text-gray-600 dark:text-gray-400';
export const FIELD_ERROR = 'mt-1 block text-[12px] font-semibold text-red-700 dark:text-red-400';
export const EYE = 'font-mono text-[10.5px] font-bold uppercase tracking-[0.07em] text-gray-600 dark:text-gray-400';

/** The Network header: crumb, eyebrow, one h1, a line, and the actions (one primary). */
export function PageHeader({ crumb, eye, title, sub, actions, titleRef }) {
  return (
    <header className="flex flex-col gap-1.5">
      {crumb ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[12px] text-gray-600 dark:text-gray-400">
          {crumb.map((c, i) => (
            <React.Fragment key={i}>
              {i ? <span aria-hidden="true">›</span> : null}
              {c.to ? <Link to={c.to} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
      ) : null}
      <span className={EYE}>{eye}</span>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="break-words text-[22px] font-extrabold tracking-tight text-gray-900 outline-none dark:text-gray-100 lg:text-[26px]">{title}</h1>
          {sub ? <p className="mt-1 text-[13.5px] text-gray-600 dark:text-gray-400">{sub}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:flex-none lg:flex-nowrap">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A section card with an h2 and an optional small line on the right. */
export function Card({ title, aside, id, children, className = '', tone }) {
  const border = tone === 'warn' ? 'border-amber-300 dark:border-amber-500/50' : tone === 'good' ? 'border-emerald-300 dark:border-emerald-500/50' : tone === 'bad' ? 'border-red-300 dark:border-red-500/50' : 'border-gray-200 dark:border-gray-700';
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-white p-4 dark:bg-gray-900 ${border} ${className}`.trim()}>
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={id} className="text-[15px] font-extrabold text-gray-900 dark:text-gray-100">{title}</h2>
          {aside ? <span className="text-[12px] text-gray-600 dark:text-gray-400">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A note strip: information, a warning, a failure or a success, with its glyph. */
export function Note({ tone = 'plain', glyph = 'i', role, children }) {
  const cls = {
    plain: 'border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100',
    warn: 'border-amber-300 bg-amber-50 text-gray-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-gray-100',
    bad: 'border-red-300 bg-red-50 text-gray-900 dark:border-red-500/50 dark:bg-red-500/10 dark:text-gray-100',
    good: 'border-emerald-300 bg-emerald-50 text-gray-900 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-gray-100',
  }[tone];
  return (
    <div role={role} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-[1.45] ${cls}`}>
      <span aria-hidden="true" className="mt-px font-bold">{glyph}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A definition list in the canvas's two columns; one column on a phone. */
export function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
      {rows.filter(Boolean).map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="font-semibold text-gray-600 dark:text-gray-400">{k}</dt>
          <dd className="min-w-0 break-words text-gray-900 dark:text-gray-100">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The page frame: the canvas's 1440 body at desktop, a 16px gutter and room for the sticky bar at 390. */
export function Frame({ children, bar }) {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-5 pb-28 sm:px-6 lg:px-8 lg:pb-8">
      {children}
      {bar ? (
        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-950 lg:hidden">{bar}</div>
      ) : null}
    </div>
  );
}
