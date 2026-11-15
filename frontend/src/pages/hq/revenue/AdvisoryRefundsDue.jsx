import React, { useEffect, useRef, useState } from 'react';
import { Unreadable } from '../../../ui';
import { Figure, StateMark, When, TABLE, TD, TH, NUM, BTN } from './RevenueStates.jsx';
import { UNAVAILABLE } from './revenueModel.js';
import {
  HIDDEN, OUTCOME_TEXT, RESOLVE_REASON_MAX, amountOf, dayUtc, draftReason, minuteUtc, reasonCheck,
  refundsDueFigure, refundsDueView, resolveOutcome, whyOwed,
} from './advisoryRefundsModel.js';
import { REFUND_REASON_MIN } from '../../../lib/refundReason.js';

/**
 * D5305 (#5305; canvas `HQ Advisory Refunds`, boards RV16 to RV21, keys HAR16
 * to HAR22) — Billing exceptions' advisory refunds due: its tile, its block
 * under the exceptions table (open rows, then the Resolved list) and the
 * "Mark refunded…" sheet (Scope → Review → Step-up → Result).
 *
 * MARKING MOVES NO MONEY. The refund is made in Stripe; the sheet records that
 * it was, by whom, when and why, and the Worker keeps the audit row. Pure over
 * its props (the read is null, UNAVAILABLE, HIDDEN or the payload), so every
 * state renders in a test.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono text-[12.5px]';
const PANEL = 'rounded-lg border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';

/** Mono text with a copy button. The Stripe payment id does not link out (owner, option A). */
function Copyable({ value, what }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(value).then(() => setDone(true), () => {});
    } catch { /* no clipboard: the text stays selectable */ }
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className={`${MONO} select-all break-all ${INK}`}>{value}</span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-transparent text-[12px] text-axal-muted hover:border-axal-hairline dark:text-gray-400 dark:hover:border-gray-700"
        aria-label={`Copy ${what} ${value}`}
      >
        <span aria-hidden="true">{done ? '✓' : '⧉'}</span>
      </button>
    </span>
  );
}

function Why({ status }) {
  const w = whyOwed(status);
  if (!w) return <StateMark state="not_recorded" />;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[12px] font-semibold leading-none text-axal-muted dark:border-gray-700 dark:text-gray-300">
      <span aria-hidden="true">{w.glyph}</span>{w.word}
    </span>
  );
}

const NotRecorded = () => <StateMark state="not_recorded" />;

/** The third tile in Billing exceptions: "Advisory refunds due · As of now · N open". */
export function AdvisoryRefundsTile({ read }) {
  if (read === HIDDEN) return null;
  const v = refundsDueView(read);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="hq-advisory-refunds-tile">
      Advisory refunds due <When kind="now" />
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Figure figure={refundsDueFigure(read)} />
        {v && <span>open{v.oldest ? ` · oldest ${v.oldest}` : ''}</span>}
      </span>
      {read === UNAVAILABLE && <span>· never 0 owed</span>}
    </span>
  );
}

function OpenTable({ rows, onMark }) {
  return (
    <>
      <div className="relative hidden overflow-x-auto lg:block">
        <table className={TABLE}>
          <caption className="sr-only">Advisory refunds due, open, newest recorded first</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Booking</th>
              <th scope="col" className={TH}>Why</th>
              <th scope="col" className={TH}>Stripe payment</th>
              <th scope="col" className={`${TH} ${NUM}`}>Amount</th>
              <th scope="col" className={TH}>Recorded on · UTC</th>
              <th scope="col" className={TH}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody data-testid="hq-advisory-refunds-open">
            {rows.map((r) => (
              <tr key={r.id} data-refund-due={r.id}>
                <td className={TD}><Copyable value={r.booking_uid} what="booking" /></td>
                <td className={TD}><Why status={r.booking_status} /></td>
                <td className={TD}>{r.payment_intent_id ? <Copyable value={r.payment_intent_id} what="payment" /> : <NotRecorded />}</td>
                <td className={`${TD} ${NUM} font-mono`}>{amountOf(r) ?? <NotRecorded />}</td>
                <td className={`${TD} ${MONO} whitespace-nowrap`}>{dayUtc(r.created_at) ?? <NotRecorded />}</td>
                <td className={`${TD} text-right`}>
                  <button type="button" className={BTN} onClick={() => onMark?.(r)} aria-label={`Mark booking ${r.booking_uid} refunded`}>
                    Mark refunded…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 lg:hidden" data-testid="hq-advisory-refunds-open-cards">
        {rows.map((r) => (
          <li key={r.id} className={`${PANEL} p-3`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Copyable value={r.booking_uid} what="booking" />
              <Why status={r.booking_status} />
            </div>
            <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
              <dt className={MUTED}>Amount</dt><dd className={`font-mono ${INK}`}>{amountOf(r) ?? <NotRecorded />}</dd>
              <dt className={MUTED}>Stripe payment</dt><dd className="min-w-0">{r.payment_intent_id ? <Copyable value={r.payment_intent_id} what="payment" /> : <NotRecorded />}</dd>
              <dt className={MUTED}>Recorded on</dt><dd className={`${MONO} ${INK}`}>{dayUtc(r.created_at) ?? <NotRecorded />}</dd>
            </dl>
            <button type="button" className={`${BTN} min-h-[44px] w-full`} onClick={() => onMark?.(r)} aria-label={`Mark booking ${r.booking_uid} refunded`}>
              Mark refunded…
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The reason in one line, in full on focus or hover. */
function Reason({ text }) {
  return (
    <span
      tabIndex={0}
      title={text}
      className={`block max-w-[32ch] truncate rounded text-[13px] ${INK} hover:whitespace-normal focus:whitespace-normal focus:outline focus:outline-2 focus:outline-axal-violet`}
    >
      {text}
    </span>
  );
}

function ResolvedList({ rows }) {
  return (
    <details className="mt-3" data-testid="hq-advisory-refunds-resolved">
      <summary className={`flex min-h-[44px] cursor-pointer items-center gap-1.5 text-[13px] ${MUTED} lg:min-h-0`}>
        <b className={INK}>Resolved</b> · {rows.length} shown, most recently resolved first
      </summary>
      <div className="relative mt-2 hidden overflow-x-auto lg:block">
        <table className={TABLE}>
          <caption className="sr-only">Advisory refunds due, resolved, most recently resolved first</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Booking</th>
              <th scope="col" className={TH}>Why</th>
              <th scope="col" className={TH}>Stripe payment</th>
              <th scope="col" className={`${TH} ${NUM}`}>Amount</th>
              <th scope="col" className={TH}>Recorded on</th>
              <th scope="col" className={TH}>Resolved on · UTC</th>
              <th scope="col" className={TH}>Resolved by</th>
              <th scope="col" className={TH}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-refund-due={r.id}>
                <td className={TD}><Copyable value={r.booking_uid} what="booking" /></td>
                <td className={TD}><Why status={r.booking_status} /></td>
                <td className={`${TD} ${MONO}`}>{r.payment_intent_id || <NotRecorded />}</td>
                <td className={`${TD} ${NUM} font-mono`}>{amountOf(r) ?? <NotRecorded />}</td>
                <td className={`${TD} ${MONO} whitespace-nowrap`}>{dayUtc(r.created_at) ?? <NotRecorded />}</td>
                <td className={`${TD} ${MONO} whitespace-nowrap`}>{minuteUtc(r.resolved_at) ?? <NotRecorded />}</td>
                <td className={TD}>{r.resolved_by_name || <NotRecorded />}</td>
                <td className={TD}>{r.resolution_reason ? <Reason text={r.resolution_reason} /> : <NotRecorded />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 flex flex-col gap-2 lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className={`${PANEL} p-3`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Copyable value={r.booking_uid} what="booking" />
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 dark:border-emerald-900 dark:text-emerald-200"><span aria-hidden="true">✓</span>Resolved</span>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
              <dt className={MUTED}>Amount</dt><dd className={`font-mono ${INK}`}>{amountOf(r) ?? <NotRecorded />}</dd>
              <dt className={MUTED}>Resolved on</dt><dd className={`${MONO} ${INK}`}>{minuteUtc(r.resolved_at) ?? <NotRecorded />} UTC</dd>
              <dt className={MUTED}>Resolved by</dt><dd className={INK}>{r.resolved_by_name || <NotRecorded />}</dd>
            </dl>
            <p className={`mt-2 break-words text-[13px] ${INK}`}>{r.resolution_reason || <NotRecorded />}</p>
          </li>
        ))}
      </ul>
      <p className={`mt-2 text-[12.5px] ${MUTED}`}>
        {rows.length} is the number of resolved rows read with this page (up to 200 rows in all), never a lifetime total.
      </p>
    </details>
  );
}

const HEAD = (
  <div>
    <h3 className={`text-[14.5px] font-extrabold ${INK}`}>Advisory refunds due</h3>
    <p className={`text-[13px] ${MUTED}`}>A charge that landed on a cancelled or missed advisor booking. Refund it in Stripe, then mark it here.</p>
  </div>
);

/** The block under the exceptions table (RV16), in every state (RV18, RV19). */
export function AdvisoryRefundsBlock({ read, onRetry, onMark }) {
  if (read === HIDDEN) return null;
  const v = refundsDueView(read);
  let status = null;
  let body = null;
  if (read === UNAVAILABLE) {
    status = <StateMark state="unavailable" />;
    body = (
      <div data-testid="hq-advisory-refunds-unreadable">
        <Unreadable what="Advisory refunds due" claim="This is not a claim that none are owed." onRetry={onRetry} />
        <p className={`mt-1 text-[12.5px] ${MUTED}`}>Open disputes and HQ refunds above are read separately and still stand.</p>
      </div>
    );
  } else if (!v) {
    status = <span role="status" className={`text-[12.5px] ${MUTED}`}>Loading…</span>;
    body = (
      <div aria-busy="true" className="flex flex-col gap-2" data-testid="hq-advisory-refunds-loading">
        {[0, 1, 2].map((i) => <span key={i} aria-hidden="true" className="block h-8 rounded bg-axal-hairline dark:bg-gray-800" />)}
      </div>
    );
  } else {
    status = <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${MUTED}`}><When kind="now" /> {v.capped ? `${v.count}+` : v.count} open · newest recorded first</span>;
    body = (
      <>
        {v.open.length > 0 ? <OpenTable rows={v.open} onMark={onMark} /> : (
          <div className={`${PANEL} flex items-start gap-2 p-3`} data-testid="hq-advisory-refunds-empty">
            <span aria-hidden="true" className="text-emerald-700 dark:text-emerald-300">✓</span>
            <div>
              <b className={`text-[13.5px] ${INK}`}>No charge on a cancelled or missed booking is owed back.</b>
              <p className={`text-[12.5px] ${MUTED}`}>Rows appear here only when a charge lands on a cancelled or missed booking.</p>
            </div>
          </div>
        )}
        {v.resolved.length > 0 && <ResolvedList rows={v.resolved} />}
        <p className={`mt-3 text-[12.5px] ${MUTED}`} role="note">
          <span aria-hidden="true">⊘ </span>Marking a row moves no money and calls no provider. The refund itself is made in Stripe.
        </p>
      </>
    );
  }
  return (
    <section id="revenue-advisory-refunds" aria-label="Advisory refunds due" className="mt-4 border-t border-axal-hairline pt-4 dark:border-gray-700" data-testid="hq-advisory-refunds">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">{HEAD}{status}</div>
      {body}
    </section>
  );
}

const STEPS = ['Scope', 'Review', 'Step-up', 'Result'];

function StepStrip({ at }) {
  return (
    <ol className="flex flex-wrap gap-1.5 font-mono text-[12px] font-bold uppercase tracking-[.05em]" aria-label={`Step ${at} of ${STEPS.length}`}>
      {STEPS.map((s, i) => {
        const n = i + 1;
        const cls = n < at ? 'text-emerald-700 dark:text-emerald-300' : n === at ? 'text-axal-violet-deep dark:text-violet-300' : 'text-axal-muted dark:text-gray-500';
        return <li key={s} className={cls} aria-current={n === at ? 'step' : undefined}>{n < at ? '✓ ' : ''}{s}</li>;
      })}
    </ol>
  );
}

function RowLine({ row }) {
  const w = whyOwed(row.booking_status);
  return (
    <p className={`${MONO} ${MUTED} break-all`}>
      {row.booking_uid} · {w ? w.word : 'Why not recorded'} · {amountOf(row) || 'Amount not recorded'} · {row.payment_intent_id || 'No Stripe payment recorded'}
    </p>
  );
}

const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-ink bg-axal-ink px-4 text-[13.5px] font-bold text-white hover:bg-black disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white sm:min-h-[36px]';
const SECONDARY = `${BTN} min-h-[44px] sm:min-h-[36px]`;

/**
 * "Mark refunded…" (RV17): Scope → Review (a 12 to 500 character reason) →
 * Step-up → Result. The step-up is the request helper's own authenticator
 * prompt, which opens when the Worker asks for it (as RefundReviewFlow's does).
 * `resolve(id, reason)` is the client method; `onResolved` re-reads the list.
 */
export function MarkRefundedSheet({ row, operatorName, resolve, onResolved, onRefresh, onClose, initial = null }) {
  const [step, setStep] = useState(initial?.step || 1);
  const [reason, setReason] = useState(initial?.reason || '');
  const [touched, setTouched] = useState(Boolean(initial?.touched));
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState(initial?.end || null); // an outcome key from resolveOutcome
  const [done, setDone] = useState(initial?.done || null); // the Worker's answer on success
  const headRef = useRef(null);

  useEffect(() => { headRef.current?.focus?.(); }, [step, end]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const check = reasonCheck(reason);
  const len = reason.trim().length;

  const submit = async () => {
    if (busy) return;
    if (!check.ok) { setTouched(true); setStep(2); return; }
    setBusy(true); setEnd(null);
    try {
      const r = await resolve(row.id, check.reason);
      setDone(r || {});
      setStep(4);
      onResolved?.(r);
    } catch (err) {
      const o = resolveOutcome(err);
      if (o === 'reason') { setTouched(true); setStep(2); } else setEnd(o);
    } finally {
      setBusy(false);
    }
  };

  const titles = { 1: 'Mark refunded', 2: 'Say how it was refunded', 3: 'Verify it’s you', 4: 'Marked refunded' };
  const endTitle = { already_resolved: 'Already resolved', not_found: 'Not found', not_saved: 'Not saved', no_authenticator: 'Authenticator sign-in needed', refused: 'Refused', step_up_cancelled: 'Not verified', unknown: 'No answer' };
  const title = end ? endTitle[end] : titles[step];
  const reasonId = `hq-ard-reason-${row.id}`;

  const reasonField = (
    <div className="flex flex-col gap-1">
      <label htmlFor={reasonId} className={`text-[13px] font-bold ${INK}`}>
        Reason <span className={`font-normal ${MUTED}`}>· required, {REFUND_REASON_MIN} to {RESOLVE_REASON_MAX} characters, kept with the row and in the audit log</span>
      </label>
      <textarea
        id={reasonId}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        maxLength={RESOLVE_REASON_MAX + 50}
        rows={4}
        aria-invalid={touched && !check.ok}
        data-testid="hq-ard-reason"
        aria-describedby={`${reasonId}-count${touched && !check.ok ? ` ${reasonId}-err` : ''}`}
        className="w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-2 text-[14px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${reasonId}-count`} className={`font-mono text-[12px] ${touched && !check.ok ? 'text-red-700 dark:text-red-300' : MUTED}`}>
          {len} / {RESOLVE_REASON_MAX} · at least {REFUND_REASON_MIN}
        </span>
        <button
          type="button"
          className="inline-flex min-h-[32px] items-center rounded-full border border-axal-hairline px-2.5 text-[12px] font-semibold text-axal-muted hover:bg-axal-ground dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          onClick={() => { setReason(draftReason(row)); setTouched(false); }}
          data-testid="hq-ard-draft"
        >
          Start from this row’s values
        </button>
      </div>
      {touched && !check.ok && (
        <p id={`${reasonId}-err`} data-testid="hq-ard-reason-error" role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300"><span aria-hidden="true">! </span>{check.message}</p>
      )}
    </div>
  );

  let body;
  let foot;
  if (end) {
    const keepsReason = end === 'not_saved' || end === 'step_up_cancelled';
    const refreshes = end === 'already_resolved' || end === 'not_found' || end === 'unknown';
    body = (
      <>
        <RowLine row={row} />
        <div role="alert" className={`flex gap-2 rounded-lg border p-3 text-[13px] ${end === 'already_resolved' || end === 'not_found' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100' : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'}`} data-testid="hq-ard-end" data-outcome={end}>
          <span aria-hidden="true">{end === 'already_resolved' || end === 'not_found' ? '▲' : '!'}</span>
          <div>
            <b>{OUTCOME_TEXT[end]}</b>
            {end === 'already_resolved' && <p>Another operator marked this row while you were in the sheet. Your reason was not saved.</p>}
            {end === 'not_found' && <p>The row is not in the record any more.</p>}
            {end === 'not_saved' && <p>The row is still open. Your reason is kept below.</p>}
            {end === 'no_authenticator' && <p>This session was signed in with SMS, a recovery code, a magic link or Google, so it cannot pass step-up. The list stays readable.</p>}
          </div>
        </div>
        {keepsReason && reasonField}
      </>
    );
    foot = (
      <>
        <button type="button" className={SECONDARY} onClick={onClose} disabled={busy}>Close</button>
        {refreshes && <button type="button" className={PRIMARY} onClick={() => { onRefresh?.(); onClose?.(); }} data-testid="hq-ard-refresh">Refresh the list</button>}
        {keepsReason && (
          <button type="button" className={PRIMARY} onClick={submit} disabled={busy || !check.ok} aria-busy={busy || undefined} data-testid="hq-ard-retry">
            {busy ? 'Marking…' : 'Try again'}
          </button>
        )}
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]">
          <dt className={MUTED}>Booking</dt><dd className={`${MONO} ${INK} break-all`}>{row.booking_uid}</dd>
          <dt className={MUTED}>Why it is owed</dt><dd><Why status={row.booking_status} /></dd>
          <dt className={MUTED}>Stripe payment</dt><dd className={`${MONO} ${INK} break-all`}>{row.payment_intent_id || <NotRecorded />}</dd>
          <dt className={MUTED}>Amount</dt><dd className={`font-mono ${INK}`}>{amountOf(row) ?? <NotRecorded />}</dd>
          <dt className={MUTED}>Recorded on</dt><dd className={`${MONO} ${INK}`}>{dayUtc(row.created_at) ? `${dayUtc(row.created_at)} UTC` : <NotRecorded />}</dd>
        </dl>
        <div className="rounded-lg border border-axal-hairline bg-axal-ground p-3 text-[13px] dark:border-gray-700 dark:bg-gray-950/40">
          <b className={INK}>Marking this moves no money. Make the refund in Stripe first.</b>
          <ul className={`mt-1 list-disc pl-5 ${MUTED}`}>
            <li>This records that the refund was made outside the platform, by whom, when and why.</li>
            <li>It calls no provider and cannot be undone here.</li>
          </ul>
        </div>
      </>
    );
    foot = (
      <>
        <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
        <button type="button" className={PRIMARY} onClick={() => setStep(2)} data-testid="hq-ard-next">Continue</button>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <RowLine row={row} />
        {reasonField}
        <p className={`text-[12.5px] ${MUTED}`}>Marking moves no money. The platform never learns the Stripe refund id; only your reason can mention it.</p>
      </>
    );
    foot = (
      <>
        <button type="button" className={SECONDARY} onClick={() => setStep(1)}>Back</button>
        <button type="button" className={PRIMARY} onClick={() => { setTouched(true); if (check.ok) setStep(3); }} data-testid="hq-ard-next">Continue</button>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <RowLine row={row} />
        <p className={`text-[13.5px] ${INK}`}>
          Marking booking <b className="font-mono">{row.booking_uid}</b> refunded. This moves no money.
          If your last check was not recent, you are asked for your authenticator code before it is recorded.
        </p>
        {busy && <p role="status" className={`text-[12.5px] ${MUTED}`}>Saving the row and its audit record together…</p>}
      </>
    );
    foot = (
      <>
        <button type="button" className={SECONDARY} onClick={() => setStep(2)} disabled={busy}>Back</button>
        <button type="button" className={PRIMARY} onClick={submit} disabled={busy} aria-busy={busy || undefined} data-testid="hq-ard-submit">
          {busy ? 'Marking…' : 'Verify and mark refunded'}
        </button>
      </>
    );
  } else {
    const at = minuteUtc(done?.resolved_at);
    body = (
      <>
        <p role="status" className="flex items-center gap-2 text-[14px] font-bold text-emerald-800 dark:text-emerald-200" data-testid="hq-ard-result">
          <span aria-hidden="true">✓</span>
          Marked refunded{operatorName ? ` by ${operatorName}` : ''} {at ? <>at <span className="font-mono">{at} UTC</span></> : 'at a time that was not read back'}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]">
          <dt className={MUTED}>Booking</dt><dd className={`${MONO} ${INK} break-all`}>{row.booking_uid}{amountOf(row) ? ` · ${amountOf(row)}` : ''}</dd>
          <dt className={MUTED}>Audit log</dt><dd className={INK}>✓ Kept · advisory refund due resolved</dd>
          <dt className={MUTED}>Money</dt><dd className={INK}>⊘ No money moved</dd>
          <dt className={MUTED}>Advisor’s money report</dt><dd className={INK}>Counts it as refunded, not owed</dd>
        </dl>
        <p className={`text-[12.5px] ${MUTED}`}>The row moved to the Resolved list.</p>
      </>
    );
    foot = <button type="button" className={PRIMARY} onClick={onClose}>Done</button>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" data-testid="hq-ard-sheet">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`hq-ard-title-${row.id}`}
        className="flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-2xl border border-axal-hairline bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900 sm:max-w-[680px] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-axal-hairline px-4 py-3 dark:border-gray-700 sm:px-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id={`hq-ard-title-${row.id}`} ref={headRef} tabIndex={-1} className={`text-[17px] font-extrabold tracking-tight ${INK} outline-none`}>{title}</h2>
            <StepStrip at={end ? 3 : step} />
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-axal-muted hover:bg-axal-ground disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 sm:h-8 sm:w-8" aria-label="Cancel and close">✕</button>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">{body}</div>
        <div className="flex flex-col-reverse gap-2 border-t border-axal-hairline px-4 py-3 dark:border-gray-700 sm:flex-row sm:justify-end sm:px-5">{foot}</div>
      </div>
    </div>
  );
}
