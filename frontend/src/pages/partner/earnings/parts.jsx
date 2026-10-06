import React from 'react';
import { Card, Pill, SectionLabel, Unrecorded } from '../../../ui';
import { PAYOUT_CURRENCY_GAP, currencyOf, formatMoney } from '../../../lib/partnerEarnings';

/**
 * The pieces the four earnings screens and the admin commissions console
 * share (D569). Presentational only: every figure arrives already read, and
 * every rule about what a figure means lives in `lib/partnerEarnings.js`.
 *
 * WHY THE ADMIN CONSOLE IMPORTS FROM HERE. `/admin/commissions` is the other
 * half of the same ledger — the rows a partner sees on Earnings are the rows
 * an admin processes — and the two must draw an amount, a status and a
 * confirmation the same way. One copy, imported twice.
 */

/**
 * An amount with its currency code beside it, or the reason there is none.
 * An amount whose currency the row does not carry still prints, with the
 * code marked as not recorded rather than guessed.
 */
export function Money({ cents, currency, className = '', noCurrencyReason = 'The row carries no currency.' }) {
  const text = formatMoney(cents, currency);
  if (text === null) return <Unrecorded reason="The row carries no readable amount.">Not recorded</Unrecorded>;
  const code = currencyOf(currency);
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <span className="font-semibold tabular-nums text-axal-ink dark:text-gray-100">{text}</span>
      {' '}
      {code
        ? <span className="text-[10.5px] font-semibold text-axal-faint">{code}</span>
        : <Unrecorded reason={noCurrencyReason}>currency not recorded</Unrecorded>}
    </span>
  );
}

/** A payout's amount. Its row's currency is the table default, not a record (`PAYOUT_CURRENCY_GAP`). */
export function PayoutMoney({ cents, className = '' }) {
  return <Money cents={cents} currency={null} noCurrencyReason={PAYOUT_CURRENCY_GAP} className={className} />;
}

/**
 * One line per currency, or the sentence for none. `none` is a real empty —
 * the rows were read and none had this status — so it is words, not a zero.
 */
export function MoneyLines({ sums, none, testid }) {
  if (!sums?.length) return <span className="text-[12.5px] text-axal-muted" data-testid={testid}>{none}</span>;
  return (
    <span className="flex flex-col gap-0.5" data-testid={testid}>
      {sums.map((s) => <Money key={s.currency || 'none'} cents={s.cents} currency={s.currency} className="text-[17px]" />)}
    </span>
  );
}

/**
 * A figure whose read failed, in a tile too small for `Unreadable`'s sentence.
 * Red, because it is a failure, and never a zero, because nothing is known.
 */
export function UnreadableValue({ reason, testid }) {
  return (
    <span className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" title={reason} data-testid={testid}>
      Unreadable
    </span>
  );
}

/** A status as a pill, from `statusOf`. */
export function StatusPill({ status, testid }) {
  return <Pill tone={status.tone} data-testid={testid}>{status.label}</Pill>;
}

/**
 * A titled card, the canvases' white panel with its header rule. `meta` sits
 * on the right of the title; `children` is the body.
 */
export function Panel({ title, meta, accent = false, testid, children, className = '' }) {
  return (
    <Card padding="none" variant={accent ? 'accent' : 'plain'} className={`overflow-hidden ${className}`} data-testid={testid}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-700">
        <h2 className="text-[13.5px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</h2>
        {meta ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{meta}</span> : null}
      </div>
      {children}
    </Card>
  );
}

/**
 * A table that is a table on a wide screen and a stack of cards on a phone.
 *
 * `cols` is the Tailwind arbitrary grid for `md` and up, written out whole by
 * the caller so Tailwind can see it. Below `md` the header row is hidden, each
 * row becomes two columns with its first cell spanning both, and every cell
 * carries its own label — which is the canvas's `.op-tr` rule at 760px.
 */
export function RowTable({ cols, head, rows, empty, testid }) {
  return (
    <div data-testid={testid}>
      <div className={`hidden gap-3 border-b border-axal-hairline bg-axal-ground px-4 py-2 md:grid dark:border-gray-700 dark:bg-gray-800/40 ${cols}`}>
        {head.map((h, i) => (
          <SectionLabel key={h || i}>{h}</SectionLabel>
        ))}
      </div>
      {rows.length === 0 && empty ? <div className="px-4 py-4">{empty}</div> : null}
      {rows.map((r) => (
        <div
          key={r.key}
          data-testid={r.testid}
          className={`grid grid-cols-2 items-center gap-x-3 gap-y-1.5 border-b border-axal-hairline px-4 py-2.5 text-[13px] last:border-b-0 md:gap-y-0 dark:border-gray-800 ${cols} ${r.className || ''}`}
        >
          {r.cells.map((cell, i) => (
            <div key={head[i] || i} className={`min-w-0 ${i === 0 ? 'col-span-2 md:col-span-1' : ''}`}>
              {i > 0 && head[i] ? <SectionLabel tone="faint" className="mb-0.5 md:hidden">{head[i]}</SectionLabel> : null}
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The result of a write: what the route said, success or refusal, once. */
export function WriteNote({ note, testid }) {
  if (!note) return null;
  return (
    <p
      role={note.ok ? 'status' : 'alert'}
      data-testid={testid}
      className={`text-[12.5px] font-semibold leading-relaxed ${note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}
    >
      {note.text}
    </p>
  );
}

/**
 * The filled button, in the licence's accent: partner amber (the partner
 * kit's `buttonClass` hue), admin steel (`ACCENT.admin`), or red for a write
 * that marks something as failed. Written out whole so Tailwind sees them.
 */
export const PRIMARY = {
  partner: 'bg-amber-700 hover:bg-amber-800',
  admin: 'bg-slate-700 hover:bg-slate-800',
  danger: 'bg-red-700 hover:bg-red-800',
};

export const primaryButton = (accent = 'partner') => 'rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white '
  + `disabled:cursor-not-allowed disabled:opacity-50 ${PRIMARY[accent] || PRIMARY.partner}`;

export const ghostButton = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold '
  + 'hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';

/**
 * The confirmation every write on these screens passes through: what will be
 * written, laid out as label and value, the consequence in one plain sentence,
 * and a Confirm that is the only control that sends anything.
 */
export function ConfirmPanel({ title, rows, consequence, confirmLabel = 'Confirm', onConfirm, onCancel, busy, accent = 'partner', danger = false, testid, children }) {
  return (
    <Card variant="sunken" padding="md" data-testid={testid}>
      <div className="text-[13px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{title}</div>
      {rows?.length ? (
        <dl className="mt-2.5 space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[12.5px]">
              <dt className="text-axal-muted dark:text-gray-400">{k}</dt>
              <dd className="font-semibold text-axal-ink dark:text-gray-100">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      {consequence ? <p className="mt-2.5 text-[12px] leading-relaxed text-axal-muted dark:text-gray-400">{consequence}</p> : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={ghostButton}
          data-testid={testid ? `${testid}-cancel` : undefined}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={primaryButton(danger ? 'danger' : accent)}
          data-testid={testid ? `${testid}-confirm` : undefined}
        >
          {busy ? `${confirmLabel}…` : confirmLabel}
        </button>
      </div>
    </Card>
  );
}
