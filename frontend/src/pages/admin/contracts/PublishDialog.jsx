import React, { useId, useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { reportError } from '../../../lib/log';

// D717 (#1852) decisions 8 and 10 — publish one template at its saved
// version, or withdraw a stub's publication, after one confirmation. The
// Worker's refusal sentence is printed as it comes (e.message); this file
// holds none of those sentences.

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

export default function PublishDialog({ mode, slug, title, version, onDone, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  useEscapeClose(() => { if (!busy) onClose(); });
  const withdraw = mode === 'withdraw';

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (withdraw) {
        await contractsApi.withdraw(slug);
        onDone({ mode });
      } else {
        const answer = await contractsApi.publishOne(slug, version);
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
        <p className="mt-2 text-[13px] text-[#615c6e] dark:text-[#a29db0]">
          {withdraw ? 'New envelope stops offering this template. Documents already issued do not change.'
            : 'Documents issued from now use this text. Documents already issued do not change.'}
        </p>
        {error && <p role="alert" data-testid="template-publish-refusal" className="mt-3 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-1.5">
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={primary} onClick={confirm} disabled={busy} data-testid="template-publish-confirm">
            {busy ? (withdraw ? 'Withdrawing…' : 'Publishing…') : withdraw ? 'Withdraw' : `Publish v${version}`}
          </button>
        </div>
      </div>
    </div>
  );
}
