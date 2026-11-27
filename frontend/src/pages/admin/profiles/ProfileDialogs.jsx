import React, { useState } from 'react';
import { Lightbox } from '../../../ui';
import { api } from '../../../lib/api';
import { partnerProfilesApi } from '../../../lib/api/partnerProfiles';
import { reportError } from '../../../lib/log';
import { REOPEN, rowView } from './ppModel';
import {
  PLAN_LINE, REJECT_MAX, REJECT_MIN, UNBIND_MAX, UNBIND_MIN, countLine, dialogWords, isPlanRefusal, refusalOf,
} from './profileModel';
import { DANGER, EYE, GHOST, INPUT, PRIMARY, REFUSAL, SUB, TONE, TONE_GLYPH } from './ppStyles';

/**
 * D995 (#2806) — PRF5's dialogs. Each says what it changes, who is told and
 * what is recorded before anything is written, and says a refusal in place,
 * in the Worker's words; the dialog stays open on it. Never a browser pop-up.
 *
 *   A, B  Verify (and send the chosen first agreement), through the verify
 *         route (D991, D992). A DocuSign send the plan does not allow is
 *         refused before anything is saved (PRF6's plan line).
 *   C     Reject, with the reason the member reads (10 to 1,000 characters).
 *   D     Reopen for review (D991), with an optional reason; nobody is told.
 *   F     Unbind (D993), a Super Admin's, with a reason and a fresh step-up
 *         (`request()` asks for the code and retries).
 */

function Bullets({ lines }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {lines.map((l) => <li key={l} className="flex gap-2 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100"><span aria-hidden="true" className="text-axal-violet dark:text-violet-300">•</span><span>{l}</span></li>)}
    </ul>
  );
}

function Shell({ title, sub, testId, goTestId = null, onClose, children, refusal, refusalTestId, action, actionClass = PRIMARY, busy, disabled, onAction }) {
  return (
    <Lightbox label={title} title={title} onClose={onClose} testId={testId}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {sub ? <p className={`m-0 ${SUB}`}>{sub}</p> : null}
        {children}
        {refusal ? <p role="alert" className={REFUSAL} data-testid={refusalTestId}>{refusal}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose}>Cancel</button>
          <button type="button" className={actionClass} disabled={busy || disabled} onClick={onAction} data-testid={goTestId || `${testId}-go`}>{action}</button>
        </div>
      </div>
    </Lightbox>
  );
}

/**
 * PRF5 A–C. `kind` is verify or reject. `choice` is what the Decision card
 * holds: the agreement (value and label), the notes and the provider.
 */
export function DecisionDialog({ kind, profile, choice, onClose, onDone }) {
  const name = profile.listed?.user_name || profile.listed?.full_name || profile.user_name || profile.full_name || null;
  const words = dialogWords(kind, { name, email: profile.email, agreement: kind === 'verify' ? choice.agreementLabel : null });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [plan, setPlan] = useState(false);
  const short = kind === 'reject' && reason.trim().length < REJECT_MIN;
  const go = async () => {
    setBusy(true);
    setRefusal('');
    setPlan(false);
    try {
      const res = await api.adminVerifyProfile(profile.email, {
        status: kind === 'verify' ? 'verified' : 'rejected',
        agreement_type: choice.agreement || '',
        admin_notes: choice.notes,
        provider: choice.provider === 'docusign' ? 'docusign' : 'native',
        ...(kind === 'reject' ? { reject_reason: reason.trim() } : {}),
      });
      onDone(res, kind === 'verify' ? 'verified' : 'rejected');
    } catch (e) {
      reportError('partner-profiles:decide', e);
      if (isPlanRefusal(e)) setPlan(true);
      else setRefusal(refusalOf(e, 'The decision could not be saved. Nothing was changed.'));
      setBusy(false);
    }
  };
  return (
    <Shell title={words.title} sub={words.sub} testId={`pp-${kind}-dialog`} onClose={onClose} refusal={refusal} refusalTestId={`pp-${kind}-refusal`}
      action={words.action} actionClass={kind === 'reject' ? DANGER : PRIMARY} busy={busy} disabled={short} onAction={go}>
      {kind === 'reject' ? (
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>Reason · required, at least 10 characters · shown to the member</span>
          <textarea value={reason} maxLength={REJECT_MAX} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Write the reason they will read…" className={INPUT} data-testid="pp-reject-reason" />
          <span className={`self-end font-mono text-[11px] ${SUB}`}>{countLine(reason, REJECT_MAX)}</span>
        </label>
      ) : null}
      <Bullets lines={words.lines} />
      {plan ? (
        <div role="status" className={`flex gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] font-semibold ${TONE.note}`} data-testid="pp-plan-line">
          <span aria-hidden="true">{TONE_GLYPH.note}</span><span>{PLAN_LINE}</span>
        </div>
      ) : null}
    </Shell>
  );
}

/** PRF5d: put a decided profile back in the queue (D991's Reopen). */
export function ReopenDialog({ row, onClose, onDone }) {
  const v = rowView(row);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      await partnerProfilesApi.reopen(row.ref, reason.trim() || null);
      onDone();
    } catch (e) {
      reportError('partner-profiles:reopen', e);
      setRefusal(refusalOf(e, 'The profile could not be reopened. Nothing was changed.'));
      setBusy(false);
    }
  };
  return (
    <Shell title={REOPEN.title(v.name || v.email)} sub={REOPEN.sub} testId="pp-reopen-dialog" goTestId="pp-reopen-go" onClose={onClose} refusal={refusal} refusalTestId="pp-reopen-refusal"
      action="Reopen" busy={busy} onAction={go}>
      <label className="flex flex-col gap-1.5">
        <span className={EYE}>Reason · optional</span>
        <textarea value={reason} maxLength={REOPEN.max} onChange={(e) => setReason(e.target.value)} placeholder="Write a reason…" rows={3} className={INPUT} data-testid="pp-reopen-reason" />
      </label>
      <p className={`m-0 ${SUB}`}>{REOPEN.foot}</p>
    </Shell>
  );
}

/** PRF5f: a Super Admin frees a profile whose address now belongs to another account, or to none. */
export function UnbindDialog({ profile, onClose, onDone }) {
  const words = dialogWords('unbind', { holder: profile.unbind?.holder || null });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const ok = reason.trim().length >= UNBIND_MIN;
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      await partnerProfilesApi.unbind(profile.ref, reason.trim());
      onDone();
    } catch (e) {
      reportError('partner-profiles:unbind', e);
      setRefusal(refusalOf(e, 'The profile could not be unbound. Nothing was changed.'));
      setBusy(false);
    }
  };
  return (
    <Shell title={words.title} sub={words.sub} testId="pp-unbind-dialog" onClose={onClose} refusal={refusal} refusalTestId="pp-unbind-refusal"
      action={words.action} actionClass={DANGER} busy={busy} disabled={!ok} onAction={go}>
      <span className={EYE}>Super Admin</span>
      <label className="flex flex-col gap-1.5">
        <span className={EYE}>Reason · required, at least 10 characters</span>
        <textarea value={reason} maxLength={UNBIND_MAX} onChange={(e) => setReason(e.target.value)} placeholder="Write a reason…" rows={3} className={INPUT} data-testid="pp-unbind-reason" />
      </label>
      <Bullets lines={words.lines} />
    </Shell>
  );
}
