/** DDL14 in-page round, cheque and linked-deal editing over the existing PATCH (#6293). */
import React, { useEffect, useRef, useState } from 'react';
import { CURRENCY_CODES } from '../../lib/money.js';
import { ddDeskApi } from '../../lib/api/ddDesk.js';
import { ddLifecycleApi } from '../../lib/api/ddLifecycle.js';
import { caseRefusal } from './ddCaseModel.js';
import { dealContextInitial, dealContextPatch } from './ddDealContextModel.js';
import { Dialog, Note, Refusal, fieldCls, inputCls, muted, useSend } from './DdUi.jsx';

export default function DealContextDialog({ uid, data, onClose, onDone }) {
  const baseline = useRef(data.case).current;
  const [form, setForm] = useState(() => dealContextInitial(baseline));
  const [choices, setChoices] = useState({ status: 'loading', items: [] });
  const { busy, error, setError, send } = useSend(caseRefusal);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value, ...(key === 'cheque' ? { clearCheque: false } : {}) }));
  useEffect(() => {
    let alive = true;
    if (!data.allowed?.update || data.case.scoped) return undefined;
    if (baseline.subject_type !== 'project' || !baseline.subject_id) { setChoices({ status: 'ready', items: [] }); return undefined; }
    ddDeskApi.subjects('project', baseline.subject_label || '').then((r) => {
      if (!alive) return;
      const subject = r?.items?.find((s) => Number(s.id) === Number(baseline.subject_id));
      setChoices(subject && Array.isArray(subject.deals) ? { status: 'ready', items: subject.deals } : { status: 'unavailable', items: [] });
    }).catch(() => { if (alive) setChoices({ status: 'unreadable', items: [] }); });
    return () => { alive = false; };
  }, [baseline, data.allowed?.update, data.case.scoped]);
  if (!data.allowed?.update || data.case.scoped) return <Note>The case lead or an Admin edits deal context.</Note>;
  const submit = () => {
    if (uid !== baseline.uid || data.case.updated_at !== baseline.updated_at) { setError('The case changed while this dialog was open. Close it and read the deal context again.'); return; }
    const result = dealContextPatch(form, baseline, choices.items.map((d) => d.id));
    if (result.error) { setError(result.error); return; }
    send(async () => { await ddLifecycleApi.update(uid, result.body); onDone('The deal context is recorded.'); }, 'The deal context could not be saved.');
  };
  const retained = baseline.deal_id != null && !choices.items.some((d) => Number(d.id) === Number(baseline.deal_id));
  const unknownCheque = baseline.cheque_cents != null && !dealContextInitial(baseline).cheque;
  return <Dialog title="Edit deal context" sub="Save the round, cheque and linked deal on this case." testId="dd-deal-context" action="Save deal context" busy={busy} onClose={onClose} onSubmit={submit}>
    <Note>Case Activity records which fields changed and who saved them. No notification is sent.</Note>
    <label className="block"><span className={fieldCls}>Round</span>
      <input className={inputCls} maxLength={80} value={form.round} onChange={set('round')} data-testid="dd-context-round" />
    </label>
    <label className="block"><span className={fieldCls}>Our cheque</span>
      <input className={`${inputCls} font-mono`} inputMode="decimal" value={form.cheque} onChange={set('cheque')} data-testid="dd-context-cheque" />
    </label>
    <label className="block"><span className={fieldCls}>Currency</span>
      <select className={inputCls} value={form.currency} onChange={set('currency')} data-testid="dd-context-currency">
        <option value="">Choose currency…</option>{CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
    </label>
    <p className={`m-0 text-[12px] ${muted}`}>Changing currency records a new amount; no conversion is made. Leave the amount blank to remove a recorded cheque.</p>
    {unknownCheque ? <Note>The stored cheque’s currency or amount could not be read. It stays unchanged unless you re-enter it or clear it.</Note> : null}
    {baseline.cheque_cents != null ? <button type="button" className={`min-h-11 text-[12.5px] font-semibold ${muted}`} onClick={() => setForm((f) => ({ ...f, cheque: '', clearCheque: true }))} data-testid="dd-context-clear-cheque">Clear cheque</button> : null}
    <label className="block"><span className={fieldCls}>Linked deal</span>
      <select className={inputCls} value={form.deal} onChange={set('deal')} data-testid="dd-context-deal">
        <option value="">No linked deal</option>
        {retained ? <option value={String(baseline.deal_id)}>Current link · Deal #{baseline.deal_id}</option> : null}
        {choices.items.map((d) => <option key={d.id} value={String(d.id)}>Deal #{d.id}{d.instrument ? ` · ${d.instrument}` : ''}{d.status ? ` · ${d.status}` : ''}</option>)}
      </select>
    </label>
    {choices.status === 'loading' ? <p className={`m-0 text-[12px] ${muted}`} aria-busy="true">Reading deals for this subject…</p> : null}
    {['unreadable', 'unavailable'].includes(choices.status) ? <Note>Deal choices for this subject could not be read. The current link is retained unless you remove it.</Note> : null}
    <Refusal text={error} testId="dd-deal-context-error" />
  </Dialog>;
}
