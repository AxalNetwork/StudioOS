/** D6139 part 1: the accreditation letter on /trust/me — where it stands, the upload, and the letters on record. */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { trustAccreditationApi } from '../../lib/api/trustAccreditation';
import { ACCREDITATION_BASES, accreditationState, accreditationUploadOpen, day } from './memberTrustModel';
import { MemberUnreadable, SUB } from './MemberOverview';

const BOX = 'rounded-lg border px-4 py-3 text-sm';
const TONE_BOX = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  prog: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  bad: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200',
};
const LETTER_WORD = { submitted: 'Waiting for review', in_review: 'In review', accepted: 'Accepted', sent_back: 'Sent back', expired: 'Expired' };

/** The sentence for each state, from the recorded dates only. */
function StateLine({ state }) {
  const l = state.letter;
  switch (state.key) {
    case 'in_review':
      return <div className={`${BOX} ${TONE_BOX.prog}`}><p className="font-semibold">In review</p><p>Your letter ({l?.basis_label || 'verification letter'}) was uploaded on {day(l?.uploaded_at)}. {l?.status === 'in_review' ? 'The fund team is checking it.' : 'It is waiting for the fund team to open it.'}{state.expiresAt ? ` Your current accreditation stays accepted until ${day(state.expiresAt)}.` : ''}</p></div>;
    case 'accepted':
      return <div className={`${BOX} ${TONE_BOX.ok}`}><p className="font-semibold">Accepted until {day(state.expiresAt)}</p><p>{l ? `Your letter (${l.basis_label}) was accepted on ${day(l.reviewed_at)}.` : 'The platform records this requirement as satisfied.'} Upload a new letter before that date to renew it.</p>{state.sentBack && <p className="mt-2">Your renewal letter was sent back on {day(state.sentBack.reviewed_at)}: {state.sentBack.review_reason || 'Not recorded: no reason was returned.'}</p>}</div>;
    case 'sent_back':
      return <div className={`${BOX} ${TONE_BOX.bad}`}><p className="font-semibold">Sent back</p><p>The fund team sent your letter back on {day(l?.reviewed_at)}: {l?.review_reason || 'Not recorded: no reason was returned.'}</p><p className="mt-1">Upload a new letter to try again.</p></div>;
    case 'expired':
      return <div className={`${BOX} ${TONE_BOX.bad}`}><p className="font-semibold">Expired</p><p>Your accepted accreditation ended on {day(state.expiresAt)}. Upload a new letter to renew it.</p></div>;
    case 'upload':
      return <div className={`${BOX} ${TONE_BOX.neutral}`}><p className="font-semibold">No letter on file</p><p>Upload a verification letter from a CPA, an attorney, a broker-dealer or a registered adviser. The fund team reviews it.</p></div>;
    default:
      return <p className={SUB}>Accreditation evidence is not asked of your account.</p>;
  }
}

function UploadForm({ onUploaded }) {
  const [basis, setBasis] = useState('');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function submit(e) {
    e.preventDefault();
    if (lock.current) return;
    if (!basis) { setErr('Choose who wrote the letter.'); return; }
    if (!file) { setErr('Choose the letter to upload.'); return; }
    lock.current = true; setBusy(true); setErr(null);
    try { await trustAccreditationApi.upload({ basis, file }); setFile(null); setBasis(''); await onUploaded(); }
    catch (x) { setErr(x?.message || 'The letter could not be uploaded. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="mt-4 space-y-3" onSubmit={submit} data-testid="accreditation-upload" aria-label="Upload a verification letter">
    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">Who wrote the letter
      <select className="mt-1 block min-h-11 w-full max-w-sm rounded border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900" value={basis} onChange={(e) => setBasis(e.target.value)} disabled={busy}>
        <option value="">Choose…</option>
        {ACCREDITATION_BASES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </label>
    <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">The letter (PDF, PNG or JPEG, at most 10 MB)
      <input className="mt-1 block min-h-11 w-full max-w-sm text-sm" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
    </label>
    <p className={SUB}>Only a verification letter is accepted. Do not upload tax returns or account statements.</p>
    <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload letter
    </button>
    {err && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{err}</p>}
  </form>;
}

export default function AccreditationEvidence({ onChanged }) {
  const [read, setRead] = useState(null);
  const [failed, setFailed] = useState(false);
  async function load() {
    setFailed(false);
    try {
      const r = await trustAccreditationApi.mine();
      if (!r || !Array.isArray(r.items)) throw new Error('malformed');
      setRead(r);
    } catch { setRead(null); setFailed(true); }
  }
  useEffect(() => { load(); }, []);
  if (failed) return <div className="mt-4" data-testid="accreditation-evidence"><MemberUnreadable what="Your accreditation letters" claim="The requirement above comes from a different read." onRetry={load} /></div>;
  if (!read) return <p className={`mt-4 ${SUB}`} data-testid="accreditation-evidence">Reading your accreditation letters…</p>;
  const state = accreditationState(read);
  const months = read.retention?.accreditation_months;
  const kept = read.retention?.investor_record_months;
  return <div className="mt-4 space-y-3" data-testid="accreditation-evidence" data-state={state.key}>
    <StateLine state={state} />
    {accreditationUploadOpen(state) && <UploadForm onUploaded={async () => { await load(); onChanged?.(); }} />}
    {read.items.length > 0 && <div>
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Your letters</h3>
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {read.items.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{i.basis_label}</span><span className="text-slate-600 dark:text-slate-400">Uploaded {day(i.uploaded_at)} · {LETTER_WORD[i.status] || i.status}</span></li>)}
      </ul>
    </div>}
    {state.key !== 'not_asked' && <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      Your letter is kept in the platform’s private document store, opened only by the fund team. It is kept for your {months ? `${months}-month ` : ''}accreditation period plus the platform’s investor-record retention period{kept == null ? ', which is not set yet' : ` of ${kept} months`}.
    </p>}
  </div>;
}
