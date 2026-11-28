/**
 * D7753 (#7753) — the source import console's shared pieces (FND-I01 to FND-I06): the crumb and header with the
 * Super admin only and HQ only marks, a card, a result chip in D7170's words, a responsive table that becomes cards
 * on a phone, and a UTC stamp. Counts, ids, digests, states and codes only: nothing here draws a record's value.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Pill } from '../../../ui';
import { utcStamp } from '../sheetsSyncModel';

export { utcStamp };

export const btn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const primaryBtn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet dark:bg-violet-600 dark:hover:bg-violet-500';
export const linkCls = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
export const mono = 'font-mono text-[12px]';
export const foot = 'text-[12px] text-axal-muted dark:text-gray-400';
export const inputCls = 'min-h-[44px] w-full rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** Research › Funds › Source imports (› tail). */
export function Crumb({ tail = null }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
      <Link to="/research" className={linkCls}>Research</Link><span aria-hidden="true">›</span>
      <Link to="/research/funds" className={linkCls}>Funds</Link><span aria-hidden="true">›</span>
      {tail ? (<><Link to="/research/source-imports" className={linkCls}>Source imports</Link><span aria-hidden="true">›</span><span>{tail}</span></>) : <span>Source imports</span>}
    </nav>
  );
}

/** The page header: title, the line under it, the two gate marks and the page's action. */
export function ConsoleHeader({ title = 'Source imports', sub, action = null }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100">{title}</h1>
        <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">{sub ?? 'Private source records, staged exactly as captured. A source record is not a fund.'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="info"><Lock size={11} aria-hidden="true" /> Super admin only</Pill>
        <Pill tone="neutral">HQ only</Pill>
        {action}
      </div>
    </header>
  );
}

/** A titled card. */
export function Panel({ title, right = null, children, testId }) {
  return (
    <section className="rounded-xl border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900" data-testid={testId}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
        <h2 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{title}</h2>
        {right}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** A result chip: `{ tone, text }` from `resultLabel` or `phaseLabel`. */
export function ResultChip({ label }) {
  if (!label) return null;
  return <span className="inline-flex justify-self-start"><Pill tone={label.tone === 'ok' ? 'ok' : label.tone === 'warn' ? 'warn' : label.tone === 'danger' ? 'danger' : 'neutral'}>{label.text}</Pill></span>;
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : v);

/**
 * A table at a desk and a list of cards on a phone (no table wider than the screen). `columns` is
 * `[{ key, label, num? }]`; a row is an object keyed the same, each cell a node or a number.
 */
export function Table({ caption, columns, rows, testId, total = null }) {
  return (
    <div data-testid={testId}>
      <table className="hidden w-full border-collapse text-[13px] sm:table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-axal-hairline text-left text-[11px] uppercase tracking-[.06em] text-axal-muted dark:border-gray-700 dark:text-gray-400">
            {columns.map((c, i) => <th key={c.key} scope="col" className={`py-2 pr-3 font-bold ${c.num ? 'text-right' : ''} ${i === 0 ? '' : ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.key ?? ri} className="border-b border-axal-hairline/70 text-axal-ink dark:border-gray-800 dark:text-gray-100">
              {columns.map((c, i) => (i === 0
                ? <th key={c.key} scope="row" className="py-2 pr-3 text-left font-semibold">{n(r[c.key])}</th>
                : <td key={c.key} className={`py-2 pr-3 ${c.num ? 'text-right tabular-nums' : ''}`}>{n(r[c.key])}</td>))}
            </tr>
          ))}
          {total ? (
            <tr className="font-bold text-axal-ink dark:text-gray-100">
              {columns.map((c, i) => (i === 0
                ? <th key={c.key} scope="row" className="py-2 pr-3 text-left">{n(total[c.key])}</th>
                : <td key={c.key} className={`py-2 pr-3 ${c.num ? 'text-right tabular-nums' : ''}`}>{n(total[c.key])}</td>))}
            </tr>
          ) : null}
        </tbody>
      </table>
      <ul className="grid gap-2 sm:hidden" aria-label={caption}>
        {[...rows, ...(total ? [{ ...total, key: '__total' }] : [])].map((r, ri) => (
          <li key={r.key ?? ri} className="rounded-lg border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{n(r[columns[0].key])}</p>
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12px]">
              {columns.slice(1).map((c) => (
                <React.Fragment key={c.key}>
                  <dt className="text-axal-muted dark:text-gray-400">{c.label}</dt>
                  <dd className="text-right text-axal-ink tabular-nums dark:text-gray-100">{n(r[c.key])}</dd>
                </React.Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A digest shown short, the whole of it in the title. */
export function Digest({ value }) {
  if (typeof value !== 'string' || !value) return null;
  return <span className={mono} title={value}>sha256:{value.slice(0, 8)}…{value.slice(-4)}</span>;
}
