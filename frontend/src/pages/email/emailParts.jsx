/**
 * D1344 — the Email page's small shared parts: class names, the Email action
 * (EM4), a chip row and a state card (EM8). Dark mode on every class.
 */
import { Link } from 'react-router-dom';
import { emailHref } from './emailModel.js';

export const CARD = 'rounded-axal-lg border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
export const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const BODY = 'text-[13px] leading-relaxed text-axal-ink dark:text-gray-200';
export const BTN = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-axal-md border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
export const PRIMARY = 'inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-axal-md border border-axal-violet bg-axal-violet px-3 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:border-violet-500 dark:bg-violet-600 max-sm:min-h-[44px]';
export const DANGER = 'inline-flex min-h-[32px] items-center justify-center rounded-axal-md border border-red-300 bg-white px-3 text-[12.5px] font-semibold text-red-700 disabled:opacity-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300 max-sm:min-h-[44px]';
export const INPUT = 'min-h-[36px] w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
export const EYEBROW = 'text-[11px] font-bold uppercase tracking-wider text-axal-muted dark:text-gray-400';
export const ERROR = 'rounded-axal-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';

/** EM4: the one Email button, on every record with a person. A record with no person draws nothing. */
export function EmailAction({ person, from = null, className = BTN }) {
  if (!person) return null;
  return <Link to={emailHref(person, from)} className={className} data-testid="email-action" aria-label="Email this person">
    <span aria-hidden="true">✉</span> Email
  </Link>;
}

/** A row of single-choice chips. */
export function Chips({ options, value, onChange, label, testId }) {
  return <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5" data-testid={testId}>
    {options.map((o) => {
      const on = o.value === value;
      return <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
        className={`min-h-[30px] rounded-axal-pill border px-3 text-[12.5px] font-semibold max-sm:min-h-[44px] ${on
          ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
          : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>{o.label}</button>;
    })}
  </div>;
}

/** EM8: one state, its title, its line and its one action. */
export function StateCard({ state, onAction, href, testId = 'email-state' }) {
  if (!state) return null;
  return <div className={CARD} data-testid={testId} role="status">
    <h3 className={H3}>{state.title}</h3>
    <p className={`mt-1 ${BODY}`}>{state.line}</p>
    {state.action && (href
      ? <Link to={href} className={`mt-3 ${BTN}`}>{state.action}</Link>
      : onAction ? <button type="button" className={`mt-3 ${BTN}`} onClick={onAction}>{state.action}</button> : null)}
  </div>;
}
