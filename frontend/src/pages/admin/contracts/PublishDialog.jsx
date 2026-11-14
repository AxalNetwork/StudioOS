import React, { useId, useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { reportError } from '../../../lib/log';

// D717 (#1852) decisions 8 and 10 — publish one template at its saved
// version, or withdraw a stub's publication, after one confirmation. The
// Worker's refusal sentence is printed as it comes (e.message); this file
// holds none of those sentences.
//
// D4811 part 13 (board CT-16 "Activate template"): publishing is a high-risk
// action. The dialog says what changes, who is told and what is recorded,
// and asks for a reason and the typed word PUBLISH; the Worker checks both
// and asks for a step-up (the global StepUpModal, then the request again).
// Withdraw keeps its one confirmation.

export const PUBLISH_WORD = 'PUBLISH';
export const REASON_MIN = 10;

/** The three-row explanation (CT-16) for publishing `version` of `title`. */
export function publishRows(title, version, usageCount) {
  const earlier = earlierDocumentsLine(usageCount);
  return [
    ['What changes', `v${version} of “${title}” becomes Approved for use. New envelopes and generated documents use this text${earlier ? `; ${earlier.charAt(0).toLowerCase()}${earlier.slice(1)}` : '. Documents already issued do not change.'}`],
    ['Who is told', 'No one is notified. Branches receive it on the next push of the published templates.'],
    ['What is recorded', 'You, the time, the version and your reason, in the template’s publication history.'],
  ];
}

/** Whether the publish form may be sent: a reason of 10 characters or more and the exact word. */
export const publishReady = (reason, typed) => String(reason || '').trim().length >= REASON_MIN && typed === PUBLISH_WORD;

const primary = 'rounded-[9px] bg-[#881337] px-[13px] py-2 text-[12.5px] font-bold text-white disabled:opacity-50';
const secondary = 'rounded-[9px] border border-[#ececf1] bg-white px-[13px] py-2 text-[12.5px] font-bold text-[#18181b] disabled:opacity-50 dark:border-[#2a2733] dark:bg-[#18161f] dark:text-[#f4f3f7]';

/** A recorded time ("2026-10-18 12:00:00" or ISO) in the viewer's locale, or null. */
export function publishedDate(at) {
  if (!at) return null;
  const s = String(at);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Who published: the signed-in user's name when it was them, else the recorded admin id. */
export function publisherName(publishedBy, user) {
  if (publishedBy == null) return 'Not recorded';
  return user && user.id === publishedBy && user.name ? user.name : `Admin #${publishedBy}`;
}

/** Decision 8: what earlier documents keep. `usage_count` cannot say which version each carries. */
export function earlierDocumentsLine(usageCount) {
  const n = Number(usageCount);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n === 1 ? '1 document issued earlier keeps the text it was issued with.'
    : `${n} documents issued earlier keep the text they were issued with.`;
}

export function PublishResult({ publication, version, usageCount, user }) {
  const n = publication?.version ?? version;
  const date = publishedDate(publication?.published_at);
  const earlier = earlierDocumentsLine(usageCount);
  return (
    <div role="status" data-testid="template-publish-done"
      className="w-full max-w-[420px] rounded-xl border border-[#a7f3d0] bg-white p-4 text-[12.5px] text-[#18181b] dark:border-emerald-800 dark:bg-[#18161f] dark:text-[#f4f3f7]">
      <p className="text-[14px] font-extrabold text-emerald-700 dark:text-emerald-300">Published v{n}</p>
      <p className="mt-1">{date ? `${date} · ` : ''}{publisherName(publication?.published_by, user)}. The card now reads Published v{n}.</p>
      {earlier && <p className="mt-1 text-[#615c6e] dark:text-[#a29db0]">{earlier}</p>}
    </div>
  );
}

export default function PublishDialog({ mode, slug, title, version, usageCount = null, onDone, onClose }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const titleId = useId();
  const ids = useId();
  useEscapeClose(() => { if (!busy) onClose(); });
  const withdraw = mode === 'withdraw';

  const confirm = async () => {
    if (busy || (!withdraw && !publishReady(reason, typed))) return;
    setBusy(true);
    setError('');
    try {
      if (withdraw) {
        await contractsApi.withdraw(slug);
        onDone({ mode });
      } else {
        const answer = await contractsApi.publishOne(slug, version, { reason: reason.trim(), confirm: typed });
        onDone({ mode, publication: answer?.publication || null });
      }
    } catch (e) {
      setError(e?.message || '');
      reportError(`TemplateEditor:${withdraw ? 'withdraw' : 'publish'}`, e);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-[520px] rounded-xl border border-[#ececf1] bg-white p-5 text-[#18181b] shadow-[0_18px_40px_rgba(24,24,27,.14)] dark:border-[#2a2733] dark:bg-[#18161f] dark:text-[#f4f3f7]">
        <h2 id={titleId} className="text-[17px] font-extrabold">{withdraw ? `Withdraw published v${version} of ${title}` : `Publish v${version} of ${title}`}</h2>
        {withdraw ? <p className="mt-2 text-[13px] text-[#615c6e] dark:text-[#a29db0]">New envelope stops offering this template. Documents already issued do not change.</p>
          : <>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-[#881337] dark:text-rose-300">High-risk action</p>
            <dl className="mt-2 space-y-2 text-[12.5px]" data-testid="template-publish-rows">{publishRows(title, version, usageCount).map(([k, v]) => <div key={k}>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-[#615c6e] dark:text-[#a29db0]">{k}</dt><dd>{v}</dd></div>)}</dl>
            <label htmlFor={`${ids}-reason`} className="mt-3 block text-[12.5px] font-semibold">Reason</label>
            <textarea id={`${ids}-reason`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}
              className="mt-1 w-full rounded-lg border border-[#ececf1] bg-white px-3 py-2 text-[13px] dark:border-[#2a2733] dark:bg-[#18161f]" placeholder="What approves this version (counsel sign-off, board decision…)" />
            <label htmlFor={`${ids}-word`} className="mt-2 block text-[12.5px] font-semibold">Type {PUBLISH_WORD} to confirm</label>
            <input id={`${ids}-word`} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy}
              className="mt-1 w-full rounded-lg border border-[#ececf1] bg-white px-3 py-2 font-mono text-[13px] dark:border-[#2a2733] dark:bg-[#18161f]" />
            <p className="mt-1 text-[11px] text-[#615c6e] dark:text-[#a29db0]">You may be asked to confirm your identity again before it is published.</p>
          </>}
        {error && <p role="alert" data-testid="template-publish-refusal" className="mt-3 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={primary} onClick={confirm} disabled={busy || (!withdraw && !publishReady(reason, typed))} data-testid="template-publish-confirm">
            {busy ? (withdraw ? 'Withdrawing…' : 'Publishing…') : withdraw ? 'Withdraw' : `Publish v${version}`}
          </button>
        </div>
      </div>
    </div>
  );
}
