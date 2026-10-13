import React from 'react';

/**
 * D686 §5.1 (#1596) — Cycle Action's `page=false` layout, the body every cycle
 * lightbox draws inside `<Lightbox size="tall">`: a header, the step pills, a
 * banner, a body that scrolls on its own, and a footer that stays put.
 *
 *   eyebrow, title, sub   the header; `title` is an h2 with an id the dialog can
 *                         name itself by (`titleId`).
 *   onClose               the 30px round × (`aria-label="Close"`). Omit it when
 *                         the frame draws its own.
 *   steps, step           pills "1 · The round": the current one violet, the
 *                         done ones pale, the rest outlined; `aria-current`.
 *   banner                `{ tone, text, role }`, tone `info` | `warn` | `error`
 *                         | `ok`; the role defaults to `status`, `alert` for an
 *                         error.
 *   footNote, footer      the footer: a note on the left, actions on the right.
 *
 * The exported `primary`, `ghost` and `danger` are the footer's button classes,
 * so every cycle's lightbox draws the same buttons. Dark mode throughout; no
 * motion.
 */
export const primary = 'inline-flex items-center justify-center rounded-[9px] bg-violet-600 px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400';
export const ghost = 'inline-flex items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const danger = 'inline-flex items-center justify-center rounded-[9px] border border-red-300 bg-white px-3.5 py-2 text-[12.5px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40';

const TONES = {
  info: 'border-axal-hairline bg-gray-50 text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
};

export const PILL = {
  current: 'bg-violet-600 text-white dark:bg-violet-500',
  done: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  todo: 'border border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400',
};

export default function ActionSheet({
  eyebrow, title, titleId, sub, onClose, steps = [], step = 0, banner = null, footNote = null, footer = null, children, testId = 'action-sheet',
}) {
  const role = banner ? (banner.role || (banner.tone === 'error' ? 'alert' : 'status')) : null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={testId}>
      <header className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
        <div className="min-w-0">
          {eyebrow && <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-violet dark:text-violet-300">{eyebrow}</div>}
          {title && <h2 id={titleId} className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h2>}
          {sub && <p className="m-0 mt-0.5 text-[12.5px] text-axal-muted dark:text-gray-400">{sub}</p>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" data-testid={`${testId}-close`}
            className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[18px] leading-none text-axal-muted hover:bg-gray-100 hover:text-axal-ink dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">×</button>
        )}
      </header>
      {steps.length > 0 && (
        <ol aria-label="Steps" className="flex shrink-0 gap-1.5 overflow-x-auto whitespace-nowrap border-b border-axal-hairline px-5 py-2.5 dark:border-gray-800" data-testid={`${testId}-steps`}>
          {steps.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${i === step ? PILL.current : i < step ? PILL.done : PILL.todo}`}>
              {i + 1} · {label}
            </li>
          ))}
        </ol>
      )}
      {banner?.text && (
        <p role={role} data-tone={banner.tone || 'info'} data-testid={`${testId}-banner`}
          className={`mx-5 mt-3 shrink-0 rounded-lg border p-3 text-[12.5px] ${TONES[banner.tone] || TONES.info}`}>{banner.text}</p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" data-testid={`${testId}-body`}>{children}</div>
      {(footNote || footer) && (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">
          <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{footNote}</span>
          <div className="flex flex-wrap items-center gap-2">{footer}</div>
        </footer>
      )}
    </div>
  );
}
