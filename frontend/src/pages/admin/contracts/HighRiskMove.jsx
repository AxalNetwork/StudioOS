import React, { useId, useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { adminGovernanceApi } from '../../../lib/api/adminGovernance';
import { reportError } from '../../../lib/log';
import { button, input } from './parts';
import { signedCopyLine } from './governanceModel';

/**
 * D4811 (#4811) part 6 — the high-risk governance moves (boards CT-12, CT-16;
 * CT-92 "High-risk actions", "Execution evidence"): Mark executed and Archive,
 * as Scope → Review → Result.
 *   Scope  — for Mark executed, the evidence (a version uploaded as the signed
 *            copy, or the completed envelope the record links); a version
 *            that is not a signed copy is refused inline. The reason.
 *   Review — what changes, who is told, what is recorded; the typed word.
 *   Result — what the Worker answered, in its words. A refusal says nothing
 *            was saved; a step-up the Worker asks for is the global prompt
 *            (`StepUpModal`), and the request is retried after it.
 * The Worker checks every rule again (`services/governanceHighRisk.ts`).
 */
export const MOVE_WORD = Object.freeze({ executed: 'EXECUTED', archived: 'ARCHIVE' });
export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** Whether the Scope step may continue, and why not. */
export function scopeProblem(to, { evidence, reason }, versions = [], document = {}) {
  if (to === 'executed') {
    if (!evidence) return 'Choose the execution evidence.';
    if (evidence.kind === 'version') {
      const v = versions.find((x) => x.version === evidence.version);
      if (!v) return 'Choose a version of this record.';
      if (!v.signed) return `v${v.version} was not uploaded as the signed copy, so it cannot show this record was executed. Choose the signed copy, or upload it as a new version first.`;
    }
    if (evidence.kind === 'envelope' && document.envelope_id == null) return 'No envelope is linked to this record. Link the completed envelope first.';
  }
  const r = String(reason || '').trim();
  if (r.length < REASON_MIN) return `Say why, in at least ${REASON_MIN} characters. It is kept with the record's history.`;
  if (r.length > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters.`;
  return null;
}

/** The three-row explanation block (Approvals v2), in this move's words. */
export function reviewRows(to, document, evidence, versions = []) {
  // D4811 part 12: the chosen signed copy names who signed it and when (CT-12 B).
  const copy = evidence?.kind === 'version' ? signedCopyLine(versions.find((v) => v.version === evidence.version)) : null;
  const changes = to === 'executed'
    ? `“${document.title}” becomes Executed, with ${evidence?.kind === 'version' ? `v${evidence.version} (signed copy${copy ? `; ${copy}` : ''})` : `envelope #${document.envelope_id}`} as the version in force. An executed record takes no new version; to revise it, it is archived and restored as a draft.`
    : `“${document.title}” becomes Archived. It stops counting as this entity's record. It can be restored as a draft later; its versions are kept.`;
  return [
    ['What changes', changes],
    ['Who is told', 'No one is notified. The change shows on the record, its Activity and the governance counts.'],
    ['What is recorded', `You, the time, the reason${to === 'executed' ? ' and the evidence' : ''}, in the record's audit trail.`],
  ];
}

export default function HighRiskMove({ to, document: d, versions = [], onClose, onDone }) {
  const ids = useId();
  const signedVersions = versions.filter((v) => v.signed);
  const [step, setStep] = useState('scope'); // scope | review | result
  const [evidence, setEvidence] = useState(to === 'executed'
    ? (signedVersions[0] ? { kind: 'version', version: signedVersions[0].version } : d.envelope_id != null ? { kind: 'envelope' } : null) : null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }
  const word = MOVE_WORD[to];
  // The record refreshes when the dialog closes after a success, so the Result step is read before the panel reloads.
  const close = () => { if (result?.ok) onDone?.(); onClose(); };
  const title = to === 'executed' ? 'Mark as executed?' : 'Archive this record?';
  const problem = scopeProblem(to, { evidence, reason }, versions, d);
  // An evidence problem shows as soon as it is chosen (CT-12B); a reason problem once Continue is pressed.
  const evidenceProblem = scopeProblem(to, { evidence, reason: 'x'.repeat(REASON_MIN) }, versions, d);
  const [touched, setTouched] = useState(false);
  const shown = evidenceProblem || (touched ? problem : null);
  async function confirm() {
    setBusy(true);
    try {
      await adminGovernanceApi.update(d.uid, { status: to, reason: reason.trim(), confirm: typed, ...(to === 'executed' ? { evidence } : {}) });
      setResult({ ok: true, message: to === 'executed' ? `“${d.title}” is executed.` : `“${d.title}” is archived.` });
    } catch (e) {
      reportError('governance:high-risk', e);
      setResult({ ok: false, message: e?.message || 'The change was not made. Nothing was saved.' });
    } finally { setBusy(false); setStep('result'); }
  }
  return <Lightbox label={title} eyebrow="High-risk action" title={title} sub={d.title} onClose={close} width={520} phone="sheet" testId="governance-high-risk">
    <div className="space-y-3 p-1 text-[12.5px]">
      <ol className="flex gap-2 text-[11px] text-axal-muted" aria-label="Steps">{['scope', 'review', 'result'].map((s, i) => <li key={s} aria-current={step === s ? 'step' : undefined}
        className={step === s ? 'font-bold text-axal-ink dark:text-white' : ''}>{i + 1}. {s[0].toUpperCase() + s.slice(1)}</li>)}</ol>

      {step === 'scope' && <>
        {to === 'executed' && <fieldset className="space-y-2">
          <legend className="font-semibold">Execution evidence</legend>
          <label className="flex min-h-[44px] items-start gap-2"><input type="radio" name={`${ids}-ev`} checked={evidence?.kind === 'version'}
            onChange={() => setEvidence({ kind: 'version', version: (signedVersions[0] || versions[0])?.version })} disabled={!versions.length} />
            <span>Signed copy uploaded to this record
              {evidence?.kind === 'version' && <select aria-label="Version" className={`${input} mt-1`} value={evidence.version ?? ''} onChange={(e) => setEvidence({ kind: 'version', version: Number(e.target.value) })}>
                {versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.signed ? ' · signed copy' : ' · not a signed copy'}</option>)}</select>}
              {evidence?.kind === 'version' && signedCopyLine(versions.find((v) => v.version === evidence.version)) && <span className="mt-1 block text-axal-muted" data-testid="evidence-signed-copy">{signedCopyLine(versions.find((v) => v.version === evidence.version))}</span>}
              {!versions.length && <span className="block text-axal-muted">No file has been uploaded.</span>}</span></label>
          <label className="flex min-h-[44px] items-start gap-2"><input type="radio" name={`${ids}-ev`} checked={evidence?.kind === 'envelope'}
            onChange={() => setEvidence({ kind: 'envelope' })} disabled={d.envelope_id == null} />
            <span>Signed through a StudioOS envelope{d.envelope_id != null ? ` (#${d.envelope_id}; the Worker checks it completed)` : <span className="block text-axal-muted">No envelope is linked.</span>}</span></label>
        </fieldset>}
        <label htmlFor={`${ids}-reason`} className="block font-semibold">Reason</label>
        <textarea id={`${ids}-reason`} className={input} rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)}
          aria-describedby={shown ? `${ids}-problem` : undefined} aria-invalid={shown && !evidenceProblem ? 'true' : undefined} />
        {shown && <p id={`${ids}-problem`} role="alert" className="text-red-700 dark:text-red-300">{shown}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={onClose}>Cancel</button>
          <button type="button" className={`${button} bg-violet-600 text-white`} disabled={!!evidenceProblem} onClick={() => { setTouched(true); if (!problem) setStep('review'); }}>Continue</button></div>
      </>}

      {step === 'review' && <>
        <dl className="space-y-2">{reviewRows(to, d, evidence, versions).map(([k, v]) => <div key={k}><dt className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="text-axal-muted">Reason: {reason.trim()}</p>
        <label htmlFor={`${ids}-word`} className="block font-semibold">Type {word} to confirm</label>
        <input id={`${ids}-word`} className={input} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setStep('scope')}>Back</button>
          <button type="button" className={`${button} border-red-300 bg-red-700 text-white`} disabled={typed !== word || busy} aria-busy={busy ? 'true' : undefined} onClick={confirm}>
            {busy ? 'Saving…' : to === 'executed' ? 'Mark executed' : 'Archive'}</button></div>
      </>}

      {step === 'result' && result && <>
        <p role={result.ok ? 'status' : 'alert'} className={result.ok ? '' : 'text-red-700 dark:text-red-300'}>{result.message}</p>
        <div className="flex justify-end gap-2">{!result.ok && <button type="button" className={button} onClick={() => { setStep('scope'); setResult(null); }}>Back to the form</button>}
          <button type="button" className={button} onClick={close}>Close</button></div>
      </>}
    </div>
  </Lightbox>;
}
