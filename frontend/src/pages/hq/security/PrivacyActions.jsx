import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { newOpKey } from '../../../lib/opKey';
import ActionDialog, { BTN_PLAIN, BTN_PRIMARY, ReasonField, ScopeBox } from './ActionDialog.jsx';
import StatusBadge from './StatusBadge.jsx';
import { MIN_REASON } from './accessModel.js';
import { OUTCOMES, closeResultOf } from './privacyModel.js';

/**
 * D4803 (#4803, canvas SE06c "Record outcome", SE06d "Changed underneath") —
 * HQ records the outcome of one open data-subject request, Scope → Review →
 * Result, in the shell every destructive act in Security uses.
 *
 *   Scope   Fulfilled or Denied (Withdrawn is not offered: only the requester
 *           can withdraw), what closing does and does not do, and the reason;
 *   Review  the request, the outcome and the reason, exactly as sent;
 *   Result  only what the server answered: recorded; unconfirmed (Try again
 *           resends the SAME key, so a retry is recorded once, D4675);
 *           changed underneath (nothing saved, the reason kept, Reload); or
 *           refused with the server's words.
 *
 * ONE KEY PER CLOSE. A key is minted for an outcome and reason; a retry of
 * that close resends it; a different outcome or reason is a different close
 * and gets a new one. The server matches a key to its subject, operator and
 * outcome, so reusing one for another close would be read as a replay.
 */

const KV = ({ rows }) => (
  <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[120px_minmax(0,1fr)]">
    {rows.filter(Boolean).map(([k, v]) => (
      <React.Fragment key={k}>
        <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
        <dd className="min-w-0 break-words text-axal-ink dark:text-gray-100">{v}</dd>
      </React.Fragment>
    ))}
  </dl>
);

export default function DsrOutcomeDialog({ row, onClose, onRecorded, onReread, send = api.hqCloseDsrRequest, returnFocus }) {
  const [step, setStep] = useState(1);
  const [outcome, setOutcome] = useState('fulfilled');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  // The key and the close it was minted for.
  const [key, setKey] = useState(() => ({ value: newOpKey(), for: null }));
  const word = OUTCOMES.find((o) => o.key === outcome)?.word || outcome;
  const name = row.label || 'this request';
  const raw = row.raw || {};

  const toReview = () => {
    if (reason.trim().length < MIN_REASON) {
      setReasonError(`Add a reason of at least ${MIN_REASON} characters.`);
      return;
    }
    setReasonError(null);
    const pair = `${outcome}\n${reason.trim()}`;
    if (key.for !== null && key.for !== pair) setKey({ value: newOpKey(), for: pair });
    else if (key.for === null) setKey((k) => ({ ...k, for: pair }));
    setStep(2);
  };

  const submit = async () => {
    setBusy(true);
    let out;
    try {
      const res = await send(raw.id, outcome, reason.trim(), {
        requested_at: raw.requested_at,
        request_id: raw.request_id ?? null,
        close_key: key.value,
      });
      out = closeResultOf(res, null);
    } catch (err) {
      out = closeResultOf(null, err);
    }
    setResult(out);
    setBusy(false);
    setStep(3);
    if (out.result === 'done') onRecorded?.(row, outcome);
  };

  const copyReason = async () => {
    try {
      await navigator.clipboard.writeText(reason.trim());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const title = step === 1 ? `Record outcome for ${name}`
    : step === 2 ? `Review: close ${name} as ${word}`
      : result.result === 'done' ? `${name} closed as ${word}`
        : result.result === 'changed' ? 'This request changed while you were working'
          : result.result === 'unconfirmed' ? 'Not confirmed' : 'Nothing was recorded';

  let footer;
  if (step === 1) {
    footer = [
      <button key="c" type="button" onClick={onClose} className={BTN_PLAIN}>Cancel</button>,
      <button key="n" type="button" onClick={toReview} className={BTN_PRIMARY} data-testid="dsr-continue">Continue to review</button>,
    ];
  } else if (step === 2) {
    footer = [
      <button key="b" type="button" onClick={() => setStep(1)} disabled={busy} className={BTN_PLAIN}>Back</button>,
      <button key="s" type="button" onClick={submit} disabled={busy} className={BTN_PRIMARY} data-testid="dsr-confirm">
        {busy ? 'Waiting for the server…' : `Close as ${word}`}
      </button>,
    ];
  } else if (result.result === 'changed') {
    footer = [
      <button key="y" type="button" onClick={copyReason} className={BTN_PLAIN} data-testid="dsr-copy-reason">{copied ? 'Reason copied' : 'Copy my reason'}</button>,
      <button key="r" type="button" onClick={() => { onReread?.(); onClose(); }} className={BTN_PRIMARY} data-testid="dsr-reload">Reload request</button>,
    ];
  } else if (result.result === 'unconfirmed') {
    footer = [
      <button key="c" type="button" onClick={() => { onReread?.(); onClose(); }} className={BTN_PLAIN} data-testid="dsr-reread">Re-read requests</button>,
      <button key="t" type="button" onClick={() => { setResult(null); setStep(2); }} className={BTN_PRIMARY} data-testid="dsr-retry">Try again</button>,
    ];
  } else {
    footer = [
      result.result === 'refused' && <button key="b" type="button" onClick={() => { setResult(null); setStep(1); }} className={BTN_PLAIN}>Back</button>,
      <button key="d" type="button" onClick={onClose} className={BTN_PRIMARY} data-testid="dsr-done">Done</button>,
    ].filter(Boolean);
  }

  return (
    <ActionDialog id="dsr-close" title={title} step={step} busy={busy} onClose={onClose} returnFocus={returnFocus} footer={footer} testid="dsr-dialog">
      {step === 1 && (
        <>
          <fieldset className="flex flex-col gap-2" data-testid="dsr-outcomes">
            <legend className="mb-1 text-[12px] font-bold text-axal-ink dark:text-white">Outcome</legend>
            {OUTCOMES.map((o) => (
              <label
                key={o.key}
                className={`flex min-h-[48px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-[12.5px] sm:min-h-0 ${outcome === o.key ? 'border-violet-700 bg-violet-50/60 dark:border-violet-500 dark:bg-violet-950/30' : 'border-axal-hairline dark:border-gray-700'}`}
              >
                <input type="radio" name="dsr-outcome" value={o.key} checked={outcome === o.key} onChange={() => setOutcome(o.key)} className="mt-1" data-testid={`dsr-outcome-${o.key}`} />
                <span aria-hidden="true" className="mt-0.5 font-bold">{o.mark}</span>
                <span><b className="text-axal-ink dark:text-white">{o.word}</b><br /><small className="text-axal-muted dark:text-gray-400">{o.line}</small></span>
              </label>
            ))}
            <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Withdrawn isn&apos;t offered: only the requester can withdraw.</p>
          </fieldset>
          <ScopeBox
            title="What closing does"
            items={[
              `Records ${word} against ${name} (${row.subject}), received ${row.received || 'on an unrecorded date'}.`,
              'Tells the subject the outcome, and writes the admin audit log in the same step.',
              'It does not erase data. Erasure is done separately, so close as Fulfilled only after you have confirmed it.',
            ]}
            testid="dsr-scope"
          />
          <ReasonField
            id="dsr-close-reason"
            value={reason}
            onChange={setReason}
            error={reasonError}
            placeholder={outcome === 'fulfilled' ? 'e.g. records removed from members and documents, checked 7 Nov, ticket DSR-14' : 'e.g. retained under an open legal hold, ticket DSR-15'}
          />
        </>
      )}
      {step === 2 && (
        <>
          <KV rows={[
            ['Request', `${name} · ${row.kind}`],
            ['Subject', row.subject],
            ['Received', row.receivedFull || 'Not recorded'],
            ['Due', row.due || 'Unknown'],
            ['Outcome', word],
            ['Reason', reason.trim()],
            ['Authority', 'Super admin · TOTP session · step-up checked by the server when you confirm'],
          ]} />
          <p className="text-[12px] text-axal-muted dark:text-gray-300" data-testid="dsr-review-note">
            The close names the request you reviewed. If the subject withdrew or asked again since, the server records nothing.
          </p>
          {busy && <p role="status" className="text-[12.5px] text-axal-muted dark:text-gray-300">Waiting for the server. Nothing is shown as done until it answers.</p>}
        </>
      )}
      {step === 3 && result.result === 'done' && (
        <div role="status" className="flex flex-col gap-1 text-[12.5px]" data-testid="dsr-result" data-result="done">
          <span className="flex items-center gap-2"><StatusBadge state="verified" label="Recorded" /> {result.replayed ? 'This close was already on record from your earlier attempt.' : 'Confirmed by the server.'}</span>
          <span className="text-axal-muted dark:text-gray-300">Nothing was erased by this step.</span>
        </div>
      )}
      {step === 3 && result.result === 'changed' && (
        <div className="flex flex-col gap-2 text-[12.5px]" data-testid="dsr-result" data-result="changed">
          <p role="alert" className="font-semibold text-amber-800 dark:text-amber-200">▲ Nothing was saved.</p>
          <KV rows={[
            ['You saw', 'Open'],
            ['Now', <span key="n" className="inline-flex flex-wrap items-center gap-2"><StatusBadge state={result.now.state} label={result.now.word} /> {result.now.line}</span>],
          ]} />
          <p>A request that changed can&apos;t be closed on the strength of a review of the old one. Your reason has been kept in this dialog in case you need it.</p>
        </div>
      )}
      {step === 3 && (result.result === 'unconfirmed' || result.result === 'refused') && (
        <p role="alert" className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="dsr-result" data-result={result.result}>{result.message}</p>
      )}
    </ActionDialog>
  );
}
