import React, { useEffect, useRef, useState } from 'react';
import { BTN } from './RevenueStates.jsx';
import { periodLabel } from './revenueModel.js';
import {
  ACTION_LABEL, FLOW_STEPS, actionBody, createActionRunner, newIdempotencyKey, paymentPreview, pendingStep, reasonError,
  receiptRows, revisionOf, statusPreview, adjustmentPreview,
} from './statementActionModel.js';

/**
 * D5039 (#5039 part 2; canvas RV05b, RV14c) — one governed action on one
 * statement, drawn inside the statement drawer in place of its body.
 *
 *   Record a payment   Prepare → Review (before → after) → Confirm → Authenticate → Receipt
 *   Mark issued        Prepare → Review → Confirm → Receipt
 *   Void               Scope → Review → Authenticate → Result
 *
 * The Authenticate step is the request in flight: the Worker answers
 * `step_up_required` when the session needs a fresh code, and `request` opens
 * the app's step-up dialog and retries once. Nothing here asks for a code.
 *
 * ONE KEY PER PREPARED ACTION. It is minted when the action leaves Prepare and
 * sent with every attempt of that action, so "Check again" after an unknown
 * outcome is a replay the Worker answers from its record, never a second
 * payment. Going back to change the action drops the key.
 *
 * Every step moves focus to its heading, and the controls are a column of
 * 44px buttons on a phone (RV14c).
 */
export function StatementActionFlow({ kind, statement, onSubmit, onChanged, onClose, onBusy }) {
  const steps = FLOW_STEPS[kind];
  const [step, setStep] = useState(steps[0]);
  const [fields, setFields] = useState({ amount: '', reference: '', reason: '', dueOn: statement.due_on || '' });
  const [error, setError] = useState(null);
  const [prepared, setPrepared] = useState(null); // { body, rows, key, label }
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);   // classifyOutcome(...) plus the reply
  const send = useRef(onSubmit);
  send.current = onSubmit;
  const runner = useRef(null);
  if (!runner.current) runner.current = createActionRunner((...a) => send.current(...a));
  const heading = useRef(null);
  const who = statement.brand_name || statement.licence_ref || statement.licence_uid || statement.uid;
  const what = `${who} · revenue share ${periodLabel(statement.period) || statement.period || ''}`.trim();

  useEffect(() => { heading.current?.focus?.(); }, [step]);

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  // Prepare / Scope → Review: everything the Worker would refuse for its shape is refused here first.
  const prepare = (e) => {
    e?.preventDefault?.();
    setError(null);
    let rows;
    let extra = {};
    let label;
    if (kind === 'record_payment') {
      const p = paymentPreview({ statement, amountText: fields.amount, reference: fields.reference, reason: fields.reason });
      if (p.error) { setError(p.error); return; }
      rows = p.rows;
      extra = { amount_cents: p.body.amount_cents, reference: p.body.reference };
      label = `Record ${p.amountLabel} payment`;
    } else if (kind === 'record_dispute' || kind === 'set_due_date') {
      const p = adjustmentPreview({ kind, statement, amountText: fields.amount, dueOn: fields.dueOn, reason: fields.reason });
      if (p.error) { setError(p.error); return; }
      rows = p.rows;
      extra = p.body;
      label = ACTION_LABEL[kind];
    } else {
      const why = reasonError(fields.reason);
      if (why) { setError(why); return; }
      rows = statusPreview(kind, statement);
      label = kind === 'void' ? 'Void statement' : 'Mark issued';
    }
    const key = newIdempotencyKey(kind);
    setPrepared({ key, rows, label, body: actionBody({ kind, statement, fields: extra, reason: fields.reason, key }) });
    setStep('Review');
  };

  const back = () => { setPrepared(null); setOutcome(null); setError(null); setStep(steps[0]); };

  const submit = async () => {
    if (runner.current.busy || !prepared) return;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    setStep(pendingStep(kind));
    const o = await runner.current.run(kind, statement.uid, prepared.body);
    setBusy(false);
    onBusy?.(false);
    if (!o) return;
    setOutcome(o);
    setStep(steps[steps.length - 1]);
    // Re-read the ledger whenever the row may have moved: applied, stale, or not known.
    if (o.kind !== 'refused') onChanged?.();
  };

  const stepNo = steps.indexOf(step) + 1;
  const input = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-[14px] text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-axal-violet dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
  const label = 'mb-1 block text-[13px] font-semibold text-axal-ink dark:text-gray-100';
  const primary = `min-h-[44px] rounded-lg px-4 text-[14px] font-bold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet ${kind === 'void' ? 'bg-red-700 hover:bg-red-800 dark:hover:bg-red-600' : 'bg-axal-violet hover:bg-violet-800 dark:hover:bg-violet-600'}`;
  const secondary = `${BTN} min-h-[44px] px-4`;
  const actions = 'mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';

  return (
    <section className="flex flex-col gap-4 px-5 py-4 text-[14px]" aria-labelledby="rv-flow-title" data-testid={`hq-statement-flow-${kind}`}>
      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]" aria-label={`${ACTION_LABEL[kind]}: steps`} data-testid="hq-statement-flow-steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined}
            className={s === step ? 'font-bold text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}>
            <span aria-hidden="true">{i + 1 < stepNo ? '✓' : `${i + 1}.`}</span> {s}
          </li>
        ))}
      </ol>
      <div>
        <h3 id="rv-flow-title" ref={heading} tabIndex={-1} className="text-[16px] font-bold text-axal-ink outline-none dark:text-gray-100">
          {ACTION_LABEL[kind]} · {step}
          <span className="sr-only">, step {stepNo} of {steps.length}</span>
        </h3>
        <p className="text-[13px] text-axal-muted dark:text-gray-400">{what}</p>
      </div>

      {(step === 'Prepare' || step === 'Scope') && (
        <form onSubmit={prepare} noValidate className="flex flex-col gap-3">
          {kind === 'void' && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              <span aria-hidden="true">✕ </span>Voiding withdraws this claim. A period holds one statement, so this period cannot be drawn again.
            </p>
          )}
          {kind === 'record_payment' && (
            <>
              <div>
                <label className={label} htmlFor="rv-flow-amount">Amount received <span className="font-normal text-axal-muted dark:text-gray-400">· {statement.currency}, in its own decimals</span></label>
                <input id="rv-flow-amount" className={`${input} font-mono`} type="text" inputMode="decimal" autoComplete="off" value={fields.amount} onChange={set('amount')} />
              </div>
              <div>
                <label className={label} htmlFor="rv-flow-ref">Bank reference <span className="font-normal text-axal-muted dark:text-gray-400">· optional</span></label>
                <input id="rv-flow-ref" className={input} type="text" autoComplete="off" maxLength={120} value={fields.reference} onChange={set('reference')} />
              </div>
            </>
          )}
          {kind === 'record_dispute' && <div>
            <label className={label} htmlFor="rv-dispute-amount">Disputed amount · {statement.currency}</label>
            <input id="rv-dispute-amount" className={input} inputMode="decimal" value={fields.amount} onChange={set('amount')} />
            <p className="text-[13px]">This replaces the recorded dispute. Enter 0 to clear it; a reason is required.</p>
          </div>}
          {kind === 'set_due_date' && <div>
            <label className={label} htmlFor="rv-due-date">Due date · UTC</label>
            <input id="rv-due-date" type="date" className={input} value={fields.dueOn} onChange={set('dueOn')} />
            <p className="text-[13px]">Leave blank to clear the date. No payment terms are inferred.</p>
          </div>}
          <div>
            <label className={label} htmlFor="rv-flow-reason">Reason <span className="font-normal text-axal-muted dark:text-gray-400">· required, read by whoever audits it</span></label>
            <textarea id="rv-flow-reason" className={input} rows={2} value={fields.reason} onChange={set('reason')} />
          </div>
          {kind === 'record_payment' && (
            <p className="text-[12.5px] text-axal-muted dark:text-gray-400">A payment adds to what was paid; it does not replace the total. An amount that is not a whole number of minor units is refused, never rounded to zero.</p>
          )}
          {error && <p role="alert" className="text-[13px] text-red-700 dark:text-red-300"><span aria-hidden="true">✕ </span>{error}</p>}
          <div className={actions}>
            <button type="button" className={secondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={primary}>Continue to review</button>
          </div>
        </form>
      )}

      {step === 'Review' && prepared && (
        <div>
          <table className="w-full text-[14px]" data-testid="hq-statement-flow-review">
            <caption className="pb-2 text-left text-[13px] text-axal-muted dark:text-gray-400">Before → after, as of revision {revisionOf(statement)}</caption>
            <thead>
              <tr className="text-left text-[12.5px] text-axal-muted dark:text-gray-400">
                <th scope="col" className="py-1 font-semibold">Figure</th>
                <th scope="col" className="py-1 text-right font-semibold">Now</th>
                <th scope="col" className="py-1 text-right font-semibold">After</th>
              </tr>
            </thead>
            <tbody>
              {prepared.rows.map((r) => (
                <tr key={r.label} className="border-t border-axal-hairline dark:border-gray-800">
                  <th scope="row" className="py-2 text-left font-normal text-axal-muted dark:text-gray-400">{r.label}</th>
                  <td className="py-2 text-right tabular-nums">{r.before}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[13px] text-axal-muted dark:text-gray-400">Reason: {prepared.body.reason}</p>
          <div className={actions}>
            <button type="button" className={secondary} onClick={back}>Back</button>
            {kind === 'void'
              ? <button type="button" className={primary} disabled={busy} onClick={submit}>{busy ? 'Voiding…' : 'Void statement'}</button>
              : <button type="button" className={primary} onClick={() => setStep('Confirm')}>Continue</button>}
          </div>
          {kind === 'void' && <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400">You may be asked for your authenticator code.</p>}
        </div>
      )}

      {step === 'Confirm' && prepared && (
        <div>
          <p className="text-[14px] text-axal-ink dark:text-gray-100">
            {kind === 'record_payment'
              ? `${prepared.label.replace(/^Record /, 'Record a ')} received from ${who} against ${periodLabel(statement.period) || statement.period}.`
              : kind === 'issue' ? `Mark the ${periodLabel(statement.period) || statement.period} statement for ${who} as issued: it is then the claim the subsidiary was sent.`
                : `${ACTION_LABEL[kind]} for ${who}, using the before → after values you reviewed.`}
          </p>
          <p className="mt-1 text-[13px] text-axal-muted dark:text-gray-400">
            {kind !== 'issue' ? 'You may be asked for your authenticator code. ' : ''}This is recorded with your name, the reason and the time. Any correction requires another governed action.
          </p>
          <div className={actions}>
            <button type="button" className={secondary} disabled={busy} onClick={() => setStep('Review')}>Back</button>
            <button type="button" className={primary} disabled={busy} onClick={submit} data-testid="hq-statement-flow-confirm">
              {busy ? 'Sending…' : prepared.label}
            </button>
          </div>
        </div>
      )}

      {step === pendingStep(kind) && busy && step !== 'Confirm' && (
        <p role="status" className="text-[14px] text-axal-ink dark:text-gray-100">
          <span aria-hidden="true">◌ </span>Waiting for the server. If your authenticator code is asked for, enter it to continue; nothing is written until it is accepted.
        </p>
      )}

      {(step === 'Receipt' || step === 'Result') && outcome && (
        <FlowOutcome outcome={outcome} kind={kind} busy={busy} onRetry={submit} onBack={back} onClose={onClose} actionsClass={actions} primary={primary} secondary={secondary} />
      )}
    </section>
  );
}

const TONE = {
  settled: { mark: '✓', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200', role: 'status' },
  applied: { mark: '✓', cls: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200', role: 'status' },
  partial: { mark: '◐', cls: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200', role: 'status' },
  refused: { mark: '✕', cls: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200', role: 'alert' },
  stale: { mark: '↻', cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200', role: 'alert' },
  unknown: { mark: '?', cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200', role: 'alert' },
};

/** The Receipt or Result: one of six outcomes, each its own word and mark; unknown is never success. */
export function FlowOutcome({ outcome, kind, busy, onRetry, onBack, onClose, actionsClass, primary, secondary }) {
  const t = TONE[outcome.kind] || TONE.unknown;
  const applied = outcome.kind === 'settled' || outcome.kind === 'partial' || outcome.kind === 'applied';
  return (
    <div data-testid="hq-statement-flow-outcome" data-outcome={outcome.kind}>
      <div role={t.role} className={`rounded-lg border px-3 py-2.5 ${t.cls}`}>
        <b className="block text-[14px]"><span aria-hidden="true">{t.mark} </span>{outcome.title}</b>
        {outcome.message && <p className="mt-1 text-[13px]">{outcome.message}</p>}
        {applied && outcome.replayed && <p className="mt-1 text-[13px]">This was already recorded on an earlier attempt; it was not recorded twice.</p>}
      </div>
      {applied && (
        <dl className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]" data-testid="hq-statement-flow-receipt">
          {receiptRows(outcome.result).map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-axal-muted dark:text-gray-400">{k}</dt>
              <dd className="break-words text-right font-semibold tabular-nums">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <div className={actionsClass}>
        {outcome.kind === 'unknown' && (
          <button type="button" className={primary} disabled={busy} onClick={onRetry}>{busy ? 'Checking…' : 'Check again'}</button>
        )}
        {(outcome.kind === 'refused' || outcome.kind === 'stale') && (
          <button type="button" className={secondary} onClick={onBack}>{outcome.kind === 'stale' ? 'Prepare it again' : 'Back to the form'}</button>
        )}
        <button type="button" className={applied ? primary : secondary} disabled={busy} onClick={onClose}>
          {applied ? 'Done' : 'Close'}
        </button>
      </div>
      {outcome.kind === 'unknown' && kind === 'record_payment' && (
        <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400">The paid and outstanding figures are not shown until the server answers: an unknown is not a zero.</p>
      )}
    </div>
  );
}
