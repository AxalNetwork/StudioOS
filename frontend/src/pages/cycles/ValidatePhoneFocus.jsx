import React from 'react';
import { Link } from 'react-router-dom';
import { FIRST_FOCUS, phoneFocus, phoneIndex, phoneMeter } from './validatePhone';

/**
 * Validate's phone focus (D685 §5.12, #1589), below md only: the focus card
 * with a full-width CTA, the interviews meter, and the index "Everything else
 * in Validate". It reads the raw overview (`validatePhone.js`); the phone
 * header band and tab bar are #1440's, not this.
 */
const NR = 'rounded-full border border-dashed border-gray-300 bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400';

export default function ValidatePhoneFocus({ raw, search = '' }) {
  const focus = phoneFocus(raw, search);
  const meter = phoneMeter(raw);
  const rows = phoneIndex(raw, search);
  return (
    <div className="flex flex-col gap-3 md:hidden" data-testid="validate-phone">
      {focus && (
        <section className="rounded-2xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="phone-focus" aria-labelledby="phone-focus-title">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[.08em] text-axal-violet-deep dark:text-violet-300">{focus.eyebrow}</p>
          <h2 id="phone-focus-title" className="m-0 mt-1 text-[18px] font-extrabold leading-snug text-axal-ink dark:text-gray-100">{focus.headline}</h2>
          {focus.why && <p className="m-0 mt-1.5 text-[13px] text-axal-muted dark:text-gray-400" data-testid="phone-focus-why">{focus.why}</p>}
          {/* A venture with no interview has nothing to count yet: the canvas draws no meter there. */}
          {focus.headline !== FIRST_FOCUS.headline && <div className="mt-3 rounded-xl bg-axal-ground p-3 dark:bg-gray-800" data-testid="phone-meter">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="font-semibold text-axal-ink dark:text-gray-100">{meter.label}</span>
              <span className="tabular-nums text-axal-ink dark:text-gray-100" data-testid="phone-meter-value">
                {meter.count == null
                  ? <span className={NR}>{meter.unreadable ? 'Unreadable' : 'Not recorded'}</span>
                  : meter.target == null ? <>{meter.count} <span className="text-axal-muted dark:text-gray-400">· No target set</span></> : `${meter.count} of ${meter.target}`}
              </span>
            </div>
            {meter.pct != null && (
              <div className="mt-2 h-1.5 rounded-full bg-violet-100 dark:bg-violet-950" role="progressbar" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.pct}>
                <div className="h-full rounded-full bg-violet-700 dark:bg-violet-400" style={{ width: `${meter.pct}%` }} />
              </div>
            )}
          </div>}
          <Link to={focus.href} className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[10px] bg-axal-violet px-3.5 text-[14px] font-bold text-white hover:bg-axal-violet-deep" data-testid="phone-focus-cta">{focus.cta}</Link>
          {focus.then && <p className="m-0 mt-2 text-[12px] text-axal-muted dark:text-gray-400" data-testid="phone-focus-then">Then: {focus.then}</p>}
        </section>
      )}
      <section aria-labelledby="phone-index-title" data-testid="phone-index">
        <h2 id="phone-index-title" className="m-0 mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">Everything else in Validate</h2>
        <ul className="m-0 list-none divide-y divide-axal-hairline overflow-hidden rounded-2xl border border-axal-hairline bg-white p-0 dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
          {rows.map((r) => (
            <li key={r.key}>
              <Link to={r.href} className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-axal-ground dark:hover:bg-gray-800" data-testid={`phone-index-${r.key}`}>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{r.title}</span>
                  <span className="block truncate text-[12px] text-axal-muted dark:text-gray-400">{r.detail}</span>
                </span>
                {r.value == null ? <span className={NR}>Not recorded</span> : r.value !== '' && <span className="shrink-0 text-[13px] font-bold tabular-nums text-axal-ink dark:text-gray-100">{r.value}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
