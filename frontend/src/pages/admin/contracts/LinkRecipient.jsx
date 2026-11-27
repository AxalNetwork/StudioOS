import React, { useEffect, useState } from 'react';
import Lightbox from '../../../ui/Lightbox';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { button, input } from './parts';

/**
 * D4811 (#4811) part 11 — the "Link recipient" repair (boards CT-01, CT-02):
 * choose the deal an unlinked agreement belongs to, review what changes, then
 * the Worker's answer (`POST /api/admin/contracts/:uid/link`). Only the company
 * link changes, and a linked agreement is never relinked from here.
 */
export default function LinkRecipient({ row, onClose, onLinked }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState({ phase: 'idle', items: [] });
  const [chosen, setChosen] = useState(null);
  const [step, setStep] = useState('choose'); // choose | review | result
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setOptions((o) => ({ ...o, phase: 'loading' }));
    const t = setTimeout(async () => {
      try {
        const data = await contractsApi.deals({ q: q.trim(), limit: 10 });
        if (live) setOptions({ phase: 'done', items: data?.items || [] });
      } catch (e) {
        reportError('contracts:deal-options', e);
        if (live) setOptions({ phase: 'failed', items: [], message: e?.message || 'The deals could not be read.' });
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  async function confirm() {
    setBusy(true);
    try {
      const data = await contractsApi.link(row.uid, Number(chosen.id));
      setResult({ ok: true, message: `Linked to ${data?.project_name || chosen.project_name}.` });
    } catch (e) {
      setResult({ ok: false, message: e?.message || 'The agreement could not be linked. Nothing was changed.' });
    } finally {
      setBusy(false);
      setStep('result');
    }
  }
  const close = () => { if (result?.ok) onLinked?.(); onClose(); };

  return <Lightbox label="Link recipient" eyebrow="Data repair" title="Link recipient" sub={row.title} onClose={close} width={520} phone="sheet" testId="contracts-link-recipient">
    <div className="space-y-3 p-1 text-[12.5px]">
      <ol className="flex gap-2 text-[11px] text-axal-muted" aria-label="Steps">{['choose', 'review', 'result'].map((s, i) => <li key={s} aria-current={step === s ? 'step' : undefined}
        className={step === s ? 'font-bold text-axal-ink dark:text-white' : ''}>{i + 1}. {s[0].toUpperCase() + s.slice(1)}</li>)}</ol>
      {step === 'choose' && <>
        <p>{row.recipient_name || row.recipient_email || 'This recipient'} is not linked to a company. Choose the deal this agreement belongs to; the agreement takes its company.</p>
        <label className="block font-semibold">Deal or company<input className={input} type="search" maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company name or deal reference" /></label>
        <p role="status" className="text-[11px] text-axal-muted">{options.phase === 'loading' ? 'Reading deals…' : options.phase === 'done' ? `${options.items.length} shown` : ''}</p>
        {options.phase === 'failed' && <p role="alert" className="text-red-700 dark:text-red-300">{options.message}</p>}
        {options.phase === 'done' && (options.items.length === 0
          ? <p className="text-axal-muted">No deal matches. A company needs a deal before an agreement can be linked to it.</p>
          : <ul className="divide-y divide-axal-hairline rounded-lg border border-axal-hairline" aria-label="Deals">{options.items.map((d) => <li key={d.id}>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2"><input type="radio" name="link-deal" checked={chosen?.id === d.id} onChange={() => setChosen(d)} />
              <span><b>{d.project_name}</b> <span className="font-mono text-[11px] text-axal-muted">{d.uid}</span></span></label></li>)}</ul>)}
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={close}>Cancel</button>
          <button type="button" className={`${button} bg-violet-600 text-white`} disabled={!chosen} onClick={() => setStep('review')}>Continue</button></div>
      </>}
      {step === 'review' && chosen && <>
        <dl className="space-y-1">
          <div><dt className="inline font-semibold">What changes: </dt><dd className="inline">“{row.title}” is linked to {chosen.project_name} through deal {chosen.uid}.</dd></div>
          <div><dt className="inline font-semibold">What does not: </dt><dd className="inline">its state, its files and its recipient. Once linked, it is not relinked from here.</dd></div>
          <div><dt className="inline font-semibold">What is recorded: </dt><dd className="inline">the link, in the admin audit log.</dd></div>
        </dl>
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setStep('choose')}>Back</button>
          <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={confirm}>{busy ? 'Linking…' : 'Link recipient'}</button></div>
      </>}
      {step === 'result' && result && <>
        <p role={result.ok ? 'status' : 'alert'} className={result.ok ? '' : 'text-red-700 dark:text-red-300'}>{result.message}</p>
        <div className="flex justify-end gap-2">{!result.ok && <button type="button" className={button} onClick={() => { setResult(null); setStep('choose'); }}>Back to the form</button>}
          <button type="button" className={button} onClick={close}>Close</button></div>
      </>}
    </div>
  </Lightbox>;
}
