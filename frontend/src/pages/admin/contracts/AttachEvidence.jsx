import React, { useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { signedCopyProblem } from './governanceModel';
import { button, input } from './parts';

/**
 * D4811 (#4811) part 18 — attach execution evidence to a legacy agreement
 * marked signed with none (boards CT-02, CT-12 B): the externally signed PDF,
 * the date it was signed, the signatory and the attestation. Written once;
 * the Worker (`POST /api/admin/contracts/:uid/evidence`) checks every field
 * again and its refusal is printed as it comes.
 */
export default function AttachEvidence({ row, onClose, onAttached }) {
  const [form, setForm] = useState({ file: null, signed_on: '', signatory: '', attest: false });
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    const problem = !form.file ? 'Choose the signed PDF.' : !/\.pdf$/i.test(form.file.name || '') ? 'The signed copy must be a PDF.' : signedCopyProblem({ ...form, signed: true });
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { const r = await contractsApi.attachEvidence(row.uid, form); setDone(r?.evidence || {}); }
    catch (e) { reportError('contracts:evidence', e); setError(e?.message || 'The evidence was not attached.'); }
    finally { setBusy(false); }
  }
  const close = () => { if (done) onAttached?.(); onClose(); };
  return <Lightbox label="Attach execution evidence" eyebrow="Data repair" title="Attach execution evidence" sub={row.title} onClose={close} width={520} phone="sheet" testId="contracts-attach-evidence">
    <div className="space-y-2 p-1 text-[12.5px]">
      {done ? <>
        <p role="status">Attached. The signed copy (sha {String(done.file_sha256 || '').slice(0, 4)}…{String(done.file_sha256 || '').slice(-4)}) is this agreement's execution evidence, signed {done.signed_on} by {done.signatory}.</p>
        <div className="flex justify-end"><button type="button" className={button} onClick={close}>Close</button></div>
      </> : <>
        <p>This agreement is marked signed but nothing shows it was. Attach the copy signed outside StudioOS. It is kept once and cannot be replaced.</p>
        <label className="block font-semibold">Signed PDF<input type="file" accept=".pdf,application/pdf" className={input} onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} /></label>
        <label className="block font-semibold">Signed on<input type="date" className={input} max={new Date().toISOString().slice(0, 10)} value={form.signed_on} onChange={(e) => setForm({ ...form, signed_on: e.target.value })} /></label>
        <label className="block font-semibold">Signatory (name, capacity)<input className={input} maxLength={200} value={form.signatory} onChange={(e) => setForm({ ...form, signatory: e.target.value })} /></label>
        <label className="flex min-h-[44px] items-start gap-2"><input type="checkbox" checked={form.attest} onChange={(e) => setForm({ ...form, attest: e.target.checked })} /> I confirm this is the complete, fully signed copy of this agreement.</label>
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={close}>Cancel</button>
          <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={send}>{busy ? 'Attaching…' : 'Attach evidence'}</button></div>
      </>}
    </div>
  </Lightbox>;
}
