import React, { useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { adminGovernanceApi } from '../../../lib/api/adminGovernance';
import { reportError } from '../../../lib/log';
import { button, input } from './parts';

/**
 * D4811 (#4811) part 21 — Unlink a related document (board CT-11): Scope →
 * Review → Result, as Link recipient (part 11) does. Scope names the link and
 * asks why; Review says plainly that both documents stay as they are and only
 * the reference goes, with the review state it carried; Result is the
 * Worker's answer (`POST /api/admin/governance/documents/:uid/related/:id/unlink`),
 * its refusal shown as sent. A restricted row never opens this: the caller
 * offers no Unlink there.
 */
export const UNLINK_REASON_MIN = 10;
export const UNLINK_REASON_MAX = 500;
const KIND_WORD = Object.freeze({ governance: 'governance record', template: 'template', agreement: 'agreement' });

/** The reason as the Worker reads it: whitespace folded; valid at 10 to 500 characters. */
export function unlinkReason(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return { text, ok: text.length >= UNLINK_REASON_MIN && text.length <= UNLINK_REASON_MAX };
}

/** What goes with the link: its review state, in words, or null when it carried none. */
export function reviewStateGoing(r) {
  if (r.state === 'review_suggested') return `its "may require review" flag (since v${r.flag_version})`;
  if (r.state === 'reviewed') return `its review against v${r.reviewed_version}${r.reviewed_by ? ` by ${r.reviewed_by}` : ''}${r.review_note ? ', with its note' : ''}`;
  return null;
}

export default function UnlinkRelation({ uid, recordTitle, r, title, onClose, onUnlinked }) {
  const [reason, setReason] = useState('');
  const [step, setStep] = useState('scope'); // scope | review | result
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const checked = unlinkReason(reason);
  const record = recordTitle ? `“${recordTitle}”` : 'this record';
  const going = reviewStateGoing(r);

  async function confirm() {
    if (!checked.ok || busy) return;
    setBusy(true);
    try {
      await adminGovernanceApi.unlinkRelated(uid, r.id, checked.text);
      setResult({ ok: true, message: `Unlinked. “${title}” is no longer listed as governed by ${record}. Neither document was changed.` });
    } catch (e) {
      reportError('governance:related-unlink', e);
      setResult({ ok: false, message: e?.message || 'The link could not be removed. Nothing was removed.' });
    } finally {
      setBusy(false);
      setStep('result');
    }
  }
  const close = () => { if (result?.ok) onUnlinked?.(); onClose(); };

  return <Lightbox label="Unlink related document" eyebrow="Related documents" title="Unlink related document" sub={title} onClose={close} width={520} phone="sheet" testId="governance-unlink">
    <div className="space-y-3 p-1 text-[12.5px]">
      <ol className="flex gap-2 text-[11px] text-axal-muted" aria-label="Steps">{['scope', 'review', 'result'].map((s, i) => <li key={s} aria-current={step === s ? 'step' : undefined}
        className={step === s ? 'font-bold text-axal-ink dark:text-white' : ''}>{i + 1}. {s[0].toUpperCase() + s.slice(1)}</li>)}</ol>
      {step === 'scope' && <>
        <dl className="space-y-1" data-testid="unlink-scope">
          <div><dt className="inline font-semibold">Link: </dt><dd className="inline">{record} governs the {KIND_WORD[r.kind] || 'document'} “{title}”.</dd></div>
          {going && <div><dt className="inline font-semibold">Its state: </dt><dd className="inline">{going[0].toUpperCase() + going.slice(1)}.</dd></div>}
        </dl>
        <label className="block font-semibold">Why remove it?
          <textarea className={`${input} mt-1`} rows={2} maxLength={UNLINK_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="unlink-reason-hint" /></label>
        <p id="unlink-reason-hint" className="text-[11px] text-axal-muted">{UNLINK_REASON_MIN} to {UNLINK_REASON_MAX} characters. It is kept in the audit log.</p>
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={close}>Cancel</button>
          <button type="button" className={`${button} bg-violet-600 text-white`} disabled={!checked.ok} onClick={() => setStep('review')}>Continue</button></div>
      </>}
      {step === 'review' && <>
        <dl className="space-y-1" data-testid="unlink-review">
          <div><dt className="inline font-semibold">What changes: </dt><dd className="inline">the reference between {record} and “{title}” is removed. Only the reference is removed.</dd></div>
          <div><dt className="inline font-semibold">What does not: </dt><dd className="inline">both documents are unchanged: no text, version, status or file in either is touched.</dd></div>
          {going && <div><dt className="inline font-semibold">What goes with it: </dt><dd className="inline">{going}. The Activity tab keeps the linking, the reviews and this unlink.</dd></div>}
          <div><dt className="inline font-semibold">What is recorded: </dt><dd className="inline">you, the time, both documents, this record's version and your reason, in the admin audit log.</dd></div>
        </dl>
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setStep('scope')}>Back</button>
          <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy || !checked.ok} onClick={confirm}>{busy ? 'Unlinking…' : 'Unlink'}</button></div>
      </>}
      {step === 'result' && result && <>
        <p role={result.ok ? 'status' : 'alert'} className={result.ok ? '' : 'text-red-700 dark:text-red-300'}>{result.message}</p>
        <div className="flex justify-end gap-2">{!result.ok && <button type="button" className={button} onClick={() => { setResult(null); setStep('scope'); }}>Back to the form</button>}
          <button type="button" className={button} onClick={close}>Close</button></div>
      </>}
    </div>
  </Lightbox>;
}
