import { useId, useState } from 'react';
import { Lightbox } from '../../../ui';
import { Unrecorded } from '../../../ui';
import { BTN, INPUT } from '../../account/AccountCenter';
import { NUM } from './parts';
import { FundActControl } from '../../../lib/fundActs';
import { refusalText } from './fundAdminModel';
import { STEPS, UNVERIFIED, actGate, checkCode, confirmedAt } from './moneyFlowModel';

/**
 * D4812 part 2 (#4812, FA-03 and FA-08) — the money-action flow's parts, used
 * inside each act's `Lightbox` (a bottom sheet on a phone, D1165):
 *
 *   FlowSteps        Prepare → Review → Confirm → Authenticate → Receipt, the
 *                    current step `aria-current="step"`, a skipped
 *                    Authenticate said as "not required", never just greyed.
 *   Effects          the exact effect as a definition list; a figure the
 *                    screen does not hold is `Not recorded` with its reason.
 *   ConfirmAct       what the act does, then the one button that names the
 *                    act and the amount. A Super Admin act asks for the
 *                    authenticator code here and steps up first; while the
 *                    act table is unread it draws FA-05d's sentence instead.
 *   FlowReceipt      "Confirmed by the server at …" and what was written.
 *
 * Nothing here decides an act: the Worker does, and its refusal is shown.
 */
export function FlowSteps({ at, skipAuth = true, testId = 'money-flow-steps' }) {
  return (
    <ol className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[12px]" aria-label="Steps" data-testid={testId}>
      {STEPS.map((label, i) => {
        const skipped = label === 'Authenticate' && skipAuth;
        const done = i < at;
        const current = i === at;
        return (
          <li key={label} aria-current={current ? 'step' : undefined} data-testid={`${testId}-${label.toLowerCase()}`}
            className={`inline-flex items-center gap-1 ${current ? 'font-bold text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
            <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${current ? 'border-axal-violet bg-axal-violet text-white' : done ? 'border-axal-positive text-axal-positive dark:border-emerald-400 dark:text-emerald-300' : 'border-axal-hairline dark:border-gray-700'}`}>
              {done ? '✓' : i + 1}
            </span>
            <span>{label}{skipped ? ' · not required' : ''}</span>
            {done && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function Effects({ rows, testId }) {
  return (
    <dl className="m-0 divide-y divide-axal-hairline rounded-axal-sm border border-axal-hairline dark:divide-gray-800 dark:border-gray-800" data-testid={testId}>
      {rows.map(([k, v]) => (
        <div key={k} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 px-3 py-2 ${/after/i.test(k) ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`} data-testid={testId ? `${testId}-${k.toLowerCase().replace(/[^a-z]+/g, '-')}` : undefined}>
          <dt className="text-[12.5px] text-axal-muted dark:text-gray-400">{k}</dt>
          <dd className={`m-0 text-right text-[13px] font-semibold text-axal-ink dark:text-gray-100 ${/^[-−+$\d]/.test(typeof v === 'string' ? v : '') ? NUM : ''}`}>
            {v && typeof v === 'object' && v.notRecorded ? <Unrecorded reason={v.reason}>— Not recorded</Unrecorded> : v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** FA-05d: the three ways a money act is not offered, each a sentence, never a disabled button. */
export function NotOffered({ gate, onRetry, testId }) {
  if (gate.state === 'unverified') {
    return (
      <div role="status" className="rounded-axal-sm border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200" data-testid={testId ? `${testId}-unverified` : 'money-flow-unverified'}>
        <div className="font-bold">{UNVERIFIED.title}</div>
        <div>{UNVERIFIED.line}</div>
        {onRetry && <button type="button" className="mt-1 min-h-[44px] font-bold underline sm:min-h-0" onClick={onRetry}>Retry</button>}
      </div>
    );
  }
  return (
    <p className="m-0 rounded-axal-sm border border-axal-hairline bg-gray-50 px-3 py-2.5 text-[12.5px] text-axal-ink dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100" data-testid={testId}>
{gate.sentence}
    </p>
  );
}

/**
 * FA-03 C: Confirm, and for a Super Admin act Authenticate, on one screen.
 * `run` performs the act; it runs only after a code is accepted (when one is
 * needed). `label` names the act and amount.
 */
export function ConfirmAct({ apis, needsCode, consequences, label, run, busy, error, onBack, testId }) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [stepping, setStepping] = useState(false);
  const errId = useId();
  const submit = async (e) => {
    e.preventDefault();
    setCodeError('');
    if (needsCode) {
      const out = checkCode(code);
      if (out.error) { setCodeError(out.error); return; }
      setStepping(true);
      try {
        await apis.auth.stepUp(out.code);
      } catch (err) {
        setCodeError(typeof err?.message === 'string' && err.message.trim() ? `The code was not accepted: ${err.message.trim()}` : 'The code was not accepted.');
        setStepping(false);
        return;
      }
      setStepping(false);
    }
    await run();
  };
  const working = busy || stepping;
  return (
    <form className="flex flex-col gap-3" onSubmit={submit} data-testid={testId}>
      <ul className="m-0 flex list-none flex-col gap-1.5 rounded-axal-sm border border-axal-hairline px-3 py-2.5 text-[13px] text-axal-ink dark:border-gray-800 dark:text-gray-100">
        {consequences.map((c) => <li key={c} className="flex gap-2"><span aria-hidden="true" className="text-axal-muted">•</span><span>{c}</span></li>)}
      </ul>
      {needsCode && (
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">
          <span>Authenticator code <span className="font-normal text-axal-muted dark:text-gray-400">· step-up required for this act</span></span>
          <input className={`${INPUT} ${NUM} tracking-[.3em]`} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code}
            onChange={(e) => setCode(e.target.value)} disabled={working} aria-invalid={codeError ? 'true' : undefined} aria-describedby={codeError ? errId : undefined}
            data-testid={`${testId}-code`} />
        </label>
      )}
      {codeError && <p id={errId} role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={`${testId}-code-error`}>{codeError}</p>}
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={`${testId}-error`}>{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={`${BTN.ghost} min-h-[44px]`} onClick={onBack} disabled={working} data-testid={`${testId}-back`}>Back</button>
        <button type="submit" className={`${BTN.primary} min-h-[48px] sm:min-h-[40px]`} disabled={working} data-testid={`${testId}-submit`}>{working ? 'Working…' : label}</button>
      </div>
    </form>
  );
}

/** FA-03 D: the server's answer, and what it wrote. */
export function FlowReceipt({ rows, at, onDone, doneLabel = 'Done', testId }) {
  const [when] = useState(() => at || confirmedAt());
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <p role="status" className="m-0 rounded-axal-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-bold text-axal-positive dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        ✓ Confirmed by the server at <span className={NUM}>{when}</span>
      </p>
      <Effects rows={rows} testId={`${testId}-rows`} />
      <div className="flex justify-end">
        <button type="button" className={`${BTN.primary} min-h-[44px]`} onClick={onDone} data-testid={`${testId}-done`}>{doneLabel}</button>
      </div>
    </div>
  );
}

/**
 * D4812 part 5 (FA-03, FA-08) — one act as the flow, after its page's own
 * form (Prepare): Review (the exact effect), Confirm (what it does, the button
 * naming the act), Authenticate (the code, for a Super Admin act only) and the
 * Receipt. `run` performs the act and returns the server's answer; `receipt`
 * turns that answer into rows. An unread act table stops at Review; an act the
 * table refuses reads its sentence there.
 */
export function ActFlow({ apis, access, act, title, sub = null, effects, consequences, label, run, receipt, onClose, onBack = null, onDone, testId, width = 560 }) {
  const [step, setStep] = useState('review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState(null);
  const gate = actGate(access, act);
  const needsCode = gate.tier === 'super_admin';
  const go = async () => {
    setBusy(true); setError('');
    try {
      const out = await run();
      setAnswer(out ?? {});
      setStep('receipt');
      await onDone?.(out);
    } catch (e) { setError(refusalText(e, 'The act could not be completed.')); } finally { setBusy(false); }
  };
  const at = { review: 1, confirm: needsCode ? 3 : 2, receipt: 4 }[step];
  return (
    <Lightbox label={title} title={step === 'receipt' ? `${title} · done` : step === 'confirm' ? (needsCode ? 'Confirm and authenticate' : 'Confirm') : `Review · ${title}`}
      sub={sub} testId={testId} onClose={() => { if (!busy) onClose(); }} width={width}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <FlowSteps at={at} skipAuth={!needsCode} testId={`${testId}-steps`} />
        {step === 'review' && <>
          <Effects rows={effects} testId={`${testId}-effects`} />
          {gate.state !== 'allowed' && <NotOffered gate={gate} testId={`${testId}-refused`} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN.ghost} onClick={onBack || onClose} data-testid={`${testId}-back`}>Back to edit</button>
            {gate.state === 'allowed' && <button type="button" className={BTN.primary} onClick={() => setStep('confirm')} data-testid={`${testId}-continue`}>Continue to confirm</button>}
          </div>
        </>}
        {step === 'confirm' && (
          <FundActControl access={access} act={act} testId={`${testId}-confirm-refused`}>
            <ConfirmAct apis={apis} needsCode={needsCode} testId={`${testId}-confirm`} label={label} busy={busy} error={error}
              consequences={consequences} run={go} onBack={() => { setError(''); setStep('review'); }} />
          </FundActControl>
        )}
        {step === 'receipt' && <FlowReceipt testId={`${testId}-done`} onDone={onClose} rows={receipt(answer)} />}
      </div>
    </Lightbox>
  );
}
