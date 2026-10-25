import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import CapTableDialog, { useWrite } from './CapTableDialog';
import {
  ADMIN_FOOT, CONFIRM_TAIL, FIELDS, NOT_FOUND, PRICE_LABEL, PROPOSE_FOOT, RECORD_FOOT, RECORD_TYPES,
  classesFor, correctionBody, draftBody, draftView, isoDay, issuanceBody, poolsOf, registerHolders, voidLine,
} from './historyModel';
import { money as moneyOf } from './capTableModel';

/**
 * D1025 (#2862) — the Cap table's dialogs, each in the page (never a browser
 * pop-up), saying what it changes and who sees it, with the Worker's refusal
 * under its buttons:
 *
 *   - Record an issuance (CT12a), the owner's; a co-founder's is "Propose an
 *     issuance", which waits for the owner; an admin's carries the reason the
 *     founder reads. From a signed data-room file, Eadwyn may read the terms
 *     (D1021): the draft drawer (CT11c) holds every amount for the person.
 *   - Void (CT12b), with its required reason; the row stays, struck through.
 *   - The admin's correction (CT12c): the share count the row should have and
 *     the reason the founder will see, recorded as a correction (D1017).
 */

const INPUT = 'w-full rounded-[9px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'flex flex-col gap-1 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const CHIP = 'rounded-full border px-2.5 py-1 text-[12px] font-bold';
const ON = 'border-axal-violet bg-axal-violet text-white';
const OFF = 'border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

function Field({ label, children, sub, testId }) {
  return (
    <label className={LABEL} data-testid={testId}>
      {label}
      {children}
      {sub ? <span className={`text-[11.5px] font-normal normal-case tracking-normal ${MUTED}`}>{sub}</span> : null}
    </label>
  );
}

/** A register holder, or a new name typed in. */
function HolderField({ label, holders, value, onChange, testId }) {
  const picked = value?.id != null ? String(value.id) : value?.name != null ? 'new' : '';
  return (
    <Field label={label} sub="Choose a holder on the record, or add a new holder." testId={testId}>
      <select className={INPUT} value={picked} aria-label={label}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'new' ? { name: '' } : { id: Number(e.target.value) })}>
        <option value="">Choose…</option>
        {holders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        <option value="new">New holder…</option>
      </select>
      {picked === 'new' ? <input className={INPUT} value={value.name} maxLength={200} aria-label={`${label}: new holder's name`} placeholder="Their name, or the firm's"
        onChange={(e) => onChange({ name: e.target.value })} /> : null}
    </Field>
  );
}

/** The venture's data-room files, read alone: a failed read says so and the field stays optional. */
function useDataRoom(projectId) {
  const [state, setState] = useState({ status: 'loading', files: [] });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await api.getProject(projectId);
        const room = p?.uid ? await api.dataRoom(p.uid) : null;
        if (live) setState({ status: 'ready', files: (room?.files || []).map((f) => ({ id: f.id, name: f.name })) });
      } catch {
        if (live) setState({ status: 'error', files: [] });
      }
    })();
    return () => { live = false; };
  }, [projectId]);
  return state;
}

/** CT12a: Record an issuance (or Propose one). */
export function RecordDialog({ projectId, record, mode = 'record', admin = false, onClose, onDone }) {
  const code = record?.currency?.code || 'USD';
  const [form, setForm] = useState({ kind: 'founding', holder: null, from: null, class_uid: '', pool_uid: '', shares: '', price: '', amount: '', cap: '', discount: '', interest: '', basis: 'post_money', maturity: '', date: '', document_ref: '', reason: '' });
  const [draft, setDraft] = useState(null);
  const [reading, setReading] = useState('');
  const room = useDataRoom(projectId);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const write = useWrite(onDone);
  const built = issuanceBody(form, { currency: code, admin });
  const holders = registerHolders(record);
  const want = new Set(FIELDS[form.kind]);
  const classes = classesFor(form.kind, record);
  const pools = poolsOf(record);
  const propose = mode === 'propose';
  const title = propose ? 'Propose an issuance' : 'Record an issuance';
  const go = () => {
    if (built.sentence) { write.setRefusal(built.sentence); return; }
    write.run(() => (propose ? capTableRecordApi.propose(projectId, built.body) : capTableRecordApi.record(projectId, built.body)));
  };
  const fileRef = form.document_ref.startsWith('data_room_files:') ? form.document_ref : '';
  const readIt = async () => {
    setReading('Eadwyn is reading the document…');
    try {
      const out = await capTableRecordApi.readDocument(projectId, fileRef);
      setReading('');
      setDraft(out?.draft || null);
      if (!out?.draft) setReading('Eadwyn found nothing to draft in that document.');
    } catch (e) {
      setReading(e?.message || 'Eadwyn could not read that document. Nothing was drafted.');
    }
  };
  if (draft) return <DraftDrawer projectId={projectId} record={record} draft={draft} mode={mode} admin={admin} onClose={() => setDraft(null)} onDone={onDone} />;
  return (
    <CapTableDialog title={title} sub={admin ? ADMIN_FOOT : propose ? PROPOSE_FOOT : RECORD_FOOT} onClose={onClose}
      action={propose ? 'Propose' : 'Record'} onAction={go} write={write} testId="captable-record-dialog">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Type" data-testid="captable-record-types">
        {RECORD_TYPES.map((t) => (
          <button key={t.kind} type="button" aria-pressed={form.kind === t.kind} className={`${CHIP} ${form.kind === t.kind ? ON : OFF}`}
            onClick={() => setForm((f) => ({ ...f, kind: t.kind, class_uid: '', pool_uid: '' }))} data-testid={`captable-record-type-${t.kind}`}>{t.label}</button>
        ))}
      </div>
      {want.has('from') ? <HolderField label="From" holders={holders} value={form.from} onChange={set('from')} testId="captable-record-from" /> : null}
      {want.has('holder') ? <HolderField label={form.kind === 'transfer' ? 'To' : 'Holder'} holders={holders} value={form.holder} onChange={set('holder')} testId="captable-record-holder" /> : null}
      {want.has('pool') ? (
        <Field label={form.kind === 'grant' ? 'Class' : 'From the pool'} sub={pools.length ? null : 'No option pool is recorded. Record its class first, on Option pool.'} testId="captable-record-pool">
          <select className={INPUT} value={form.pool_uid} onChange={set('pool_uid')} aria-label="Pool"><option value="">Choose…</option>{pools.map((c) => <option key={c.uid} value={c.uid}>{c.name}</option>)}</select>
        </Field>
      ) : null}
      {want.has('class') ? (
        <Field label="Class" sub={classes.length ? null : 'No share class is recorded yet.'} testId="captable-record-class">
          <select className={INPUT} value={form.class_uid} onChange={set('class_uid')} aria-label="Class"><option value="">Choose…</option>{classes.map((c) => <option key={c.uid} value={c.uid}>{c.name}</option>)}</select>
        </Field>
      ) : null}
      {want.has('shares') ? <Field label={form.kind === 'grant' ? 'Options' : 'Shares'}><input className={INPUT} inputMode="numeric" value={form.shares} onChange={set('shares')} aria-label="Shares" data-testid="captable-record-shares" /></Field> : null}
      {want.has('price') ? <Field label={PRICE_LABEL[form.kind]}><input className={INPUT} inputMode="decimal" value={form.price} onChange={set('price')} aria-label={PRICE_LABEL[form.kind]} data-testid="captable-record-price" /></Field> : null}
      {want.has('amount') ? <Field label={`Amount (${code})`}><input className={INPUT} inputMode="decimal" value={form.amount} onChange={set('amount')} aria-label="Amount" data-testid="captable-record-amount" /></Field> : null}
      {want.has('cap') ? <Field label={`Valuation cap (${code})`} sub="Leave it blank if there is none."><input className={INPUT} inputMode="decimal" value={form.cap} onChange={set('cap')} aria-label="Valuation cap" data-testid="captable-record-cap" /></Field> : null}
      {want.has('basis') ? (
        <Field label="Basis" sub="Axal’s SAFE template is post-money.">
          <select className={INPUT} value={form.basis} onChange={set('basis')} aria-label="Basis"><option value="post_money">Post-money</option><option value="pre_money">Pre-money</option></select>
        </Field>
      ) : null}
      {want.has('discount') ? <Field label="Discount (%)" sub="Leave it blank if there is none: it reads Not recorded."><input className={INPUT} inputMode="decimal" value={form.discount} onChange={set('discount')} aria-label="Discount" data-testid="captable-record-discount" /></Field> : null}
      {want.has('interest') ? <Field label="Interest (% a year)"><input className={INPUT} inputMode="decimal" value={form.interest} onChange={set('interest')} aria-label="Interest" /></Field> : null}
      {want.has('maturity') ? <Field label="Maturity"><input type="date" className={INPUT} value={form.maturity} onChange={set('maturity')} aria-label="Maturity" /></Field> : null}
      {want.has('date') ? <Field label="Date"><input type="date" className={INPUT} value={form.date} onChange={set('date')} aria-label="Date" data-testid="captable-record-date" /></Field> : null}
      <Field label="Document" sub={room.status === 'error' ? 'The data room could not be read, so no file can be picked now. You can record it without one.' : 'Pick the signed copy from the data room. Without one the row reads No document.'} testId="captable-record-document">
        <select className={INPUT} value={form.document_ref} onChange={set('document_ref')} aria-label="Document" disabled={room.status !== 'ready'}>
          <option value="">{room.status === 'loading' ? 'Reading the data room…' : 'No document'}</option>
          {room.files.map((f) => <option key={f.id} value={`data_room_files:${f.id}`}>{f.name}</option>)}
        </select>
      </Field>
      {fileRef ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={actionGhost} onClick={readIt} disabled={!!reading && reading.endsWith('…')} data-testid="captable-record-read">Let Eadwyn read its terms</button>
          <span className={`text-[11.5px] ${MUTED}`}>Eadwyn finds the terms and the pages; you enter every amount.</span>
        </div>
      ) : null}
      {reading ? <p className={`m-0 text-[12px] ${MUTED}`} role="status" data-testid="captable-record-reading">{reading}</p> : null}
      {admin ? (
        <Field label="Reason the founder will see · required">
          <textarea className={`${INPUT} min-h-[52px]`} value={form.reason} maxLength={2000} onChange={set('reason')} aria-label="Reason the founder will see" data-testid="captable-record-reason" />
        </Field>
      ) : null}
      <p className={`m-0 text-[12px] font-semibold ${MUTED}`} data-testid="captable-record-foot">{admin ? ADMIN_FOOT : propose ? PROPOSE_FOOT : RECORD_FOOT}</p>
    </CapTableDialog>
  );
}

/** CT11c: Eadwyn's draft from a signed document. The terms carry their page; every amount is the person's to enter. */
export function DraftDrawer({ projectId, record, draft, mode = 'record', admin = false, onClose, onDone }) {
  const code = record?.currency?.code || 'USD';
  const v = draftView(draft);
  const [typed, setTyped] = useState({ amount: '', valuation_cap: '', discount: '', price_per_share: '', shares: '' });
  const [reason, setReason] = useState('');
  const write = useWrite(onDone);
  const built = draftBody(draft, typed, { currency: code });
  const money = v.kind === 'safe' || v.kind === 'note';
  const shown = v.amounts.filter((a) => (money ? ['amount', 'valuation_cap', 'discount'] : ['shares', 'price_per_share']).includes(a.key));
  const discard = () => write.run(async () => {
    // The draft is D780's rail proposal: Discard decides it there, and nothing reaches the record.
    if (draft.uid) await railProposalsApi.decide(draft.uid, 'discard');
    return null;
  });
  const accept = () => {
    if (built.sentence) { write.setRefusal(built.sentence); return; }
    const body = admin ? { ...built.body, reason: reason.trim() } : built.body;
    if (admin && !reason.trim()) { write.setRefusal('Write the reason the founder will see.'); return; }
    write.run(() => (mode === 'propose' ? capTableRecordApi.propose(projectId, body) : capTableRecordApi.record(projectId, body)));
  };
  const confirm = built.body
    ? `Record ${v.holder}’s ${money ? `${v.kind === 'safe' ? 'SAFE' : 'note'} for ${moneyOf(built.body.amount_cents, code)}` : `${built.body.shares.toLocaleString('en-US')} shares`}? ${CONFIRM_TAIL}`
    : 'Accept opens once you enter the amounts the document holds.';
  return (
    <Lightbox label="Drafted by Eadwyn" eyebrow="Proposal · drafted by Eadwyn" title={v.title} width={600} onClose={() => !write.busy && onClose()} testId="captable-draft-drawer"
      footer={(
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[12px] font-semibold text-axal-ink dark:text-gray-100" data-testid="captable-draft-confirm">{confirm}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={actionGhost} onClick={discard} disabled={write.busy} data-testid="captable-draft-discard">Discard</button>
            <button type="button" className={actionPrimary} onClick={accept} disabled={write.busy || !built.body} data-testid="captable-draft-accept">{mode === 'propose' ? 'Propose' : 'Accept'}</button>
          </div>
          {write.refusal ? <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="captable-draft-refusal">{write.refusal}</p> : null}
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="m-0 rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 font-semibold text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200" data-testid="captable-draft-note">
          Eadwyn drafted this from {v.document || 'the document'}. Check it, then accept. It never enters an amount, a cap, a discount, a price or a share count.
        </p>
        <section aria-label="Terms Eadwyn found" data-testid="captable-draft-terms">
          <h3 className={`m-0 mb-1 text-[10.5px] font-extrabold uppercase tracking-[.07em] ${MUTED}`}>Terms Eadwyn found</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {v.terms.map((t) => (
              <li key={t.key} className="flex justify-between gap-3" data-testid={`captable-draft-term-${t.key}`}>
                <span className={MUTED}>{t.label}</span>
                <span className={t.value === NOT_FOUND ? MUTED : 'font-semibold'}>{t.value}{t.page ? <span className={`ml-2 font-mono text-[11.5px] ${MUTED}`}>{t.page}</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Amounts are yours to enter" className="flex flex-col gap-2" data-testid="captable-draft-amounts">
          <h3 className={`m-0 text-[10.5px] font-extrabold uppercase tracking-[.07em] ${MUTED}`}>Amounts are yours to enter</h3>
          {shown.map((a) => (
            <Field key={a.key} label={a.label} sub={a.hint}>
              <input className={INPUT} inputMode="decimal" value={typed[a.key]} placeholder={a.hint} aria-label={a.label}
                onChange={(e) => setTyped((t) => ({ ...t, [a.key]: e.target.value }))} data-testid={`captable-draft-${a.key}`} />
            </Field>
          ))}
        </section>
        {admin ? (
          <Field label="Reason the founder will see · required">
            <textarea className={`${INPUT} min-h-[52px]`} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} aria-label="Reason the founder will see" />
          </Field>
        ) : null}
      </div>
    </Lightbox>
  );
}

/** CT12b: Void this issuance? Its reason is required; the row stays in History, struck through. */
export function VoidDialog({ projectId, record, row, admin = false, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const write = useWrite(onDone);
  const go = () => {
    if (!reason.trim()) { write.setRefusal('Say why this issuance is void.'); return; }
    write.run(() => capTableRecordApi.void(projectId, row.uid, reason.trim()));
  };
  return (
    <CapTableDialog title="Void this issuance?" sub={voidLine(row, record)} onClose={onClose} action="Void" tone="danger" onAction={go} write={write} testId="captable-void-dialog">
      <p className={`m-0 ${MUTED}`} data-testid="captable-void-line">{voidLine(row, record)}</p>
      <Field label={admin ? 'Reason the founder will see · required' : 'Reason · required'}>
        <textarea className={`${INPUT} min-h-[60px]`} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="Write a reason…" data-testid="captable-void-reason" />
      </Field>
      <p className={`m-0 text-[12px] ${MUTED}`}>It leaves every count on record. Co-founders see the void and your reason at once.</p>
    </CapTableDialog>
  );
}

/** CT12c: an admin's correction. The founder sees the reason and the change. */
export function CorrectDialog({ projectId, record, row, today = isoDay(), onClose, onDone }) {
  const [next, setNext] = useState(row?.shares != null ? String(row.shares) : '');
  const [reason, setReason] = useState('');
  const write = useWrite(onDone);
  const go = () => {
    const out = correctionBody(row, next, reason, today);
    if (!out.body) { write.setRefusal(out.sentence); return; }
    write.run(() => capTableRecordApi.record(projectId, out.body));
  };
  return (
    <CapTableDialog title="Correct a record" sub={ADMIN_FOOT} onClose={onClose} action="Save correction" onAction={go} write={write} testId="captable-correct-dialog">
      <Field label="Record"><span className="text-[13px] font-semibold normal-case tracking-normal text-axal-ink dark:text-gray-100" data-testid="captable-correct-record">{voidLine(row, record).split('. It stays')[0]}</span></Field>
      <Field label="Shares" sub="The share count this record should have. The difference is recorded as a correction."><input className={INPUT} inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value)} aria-label="Shares" data-testid="captable-correct-shares" /></Field>
      <Field label="Reason the founder will see · required">
        <textarea className={`${INPUT} min-h-[52px]`} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} aria-label="Reason the founder will see" data-testid="captable-correct-reason" />
      </Field>
    </CapTableDialog>
  );
}
