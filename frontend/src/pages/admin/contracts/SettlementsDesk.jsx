import React, { useState } from 'react';
import { partnerSettlementsApi } from '../../../lib/api/partnerSettlements';
import { reportError } from '../../../lib/log';
import {
  SETTLEMENT_DIRECTIONS, SETTLEMENT_KINDS, settlementDirectionLabel, settlementDraft, settlementKindLabel, settlementStateLabel,
} from '../../../lib/partnerSettlements';
import { fmtLedgerCents } from '../../../lib/revenueLedger';
import { ReadState, useRead, Recorded, SidePanel, button, input, date } from './parts';

/**
 * D713 (#1778, F29e): one partner deal's settlements, in the Contracts ›
 * Partner deals drawer. An Admin drafts, edits and deletes drafts; Issue and
 * Void are drawn only for the Super Admin, so a plain Admin is never sent to
 * the routes that answer `super_admin_required`, and never shown a step-up
 * prompt. The Worker checks every one of these again. Nothing here moves money:
 * a settlement records what is owed under the deal, and the member matches it
 * to their own bank line.
 */
const EMPTY = { kind: '', direction: '', amount: '', due_on: '', memo: '' };
const toForm = (row) => ({
  kind: row.kind, direction: row.direction, amount: (Number(row.amount_cents) / 100).toFixed(2), due_on: row.due_on || '', memo: row.memo || '',
});

export function SettlementRows({ rows, superAdmin, busy, onEdit, onDelete, onIssue, onVoid }) {
  if (!rows.length) return <p className="text-sm text-axal-muted" data-testid="settlements-empty">No settlement is drafted under this deal.</p>;
  return <ul className="divide-y divide-axal-hairline text-sm" data-testid="settlements-list">{rows.map((s) => (
    <li key={s.uid} className="space-y-1 py-2" data-testid={`settlement-${s.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{fmtLedgerCents(Number(s.amount_cents)) ?? <Recorded value={null} reason="The amount is not whole cents." />} · {settlementKindLabel(s.kind)}</span>
        <span className="text-xs font-semibold">{settlementStateLabel(s.state)}</span>
      </div>
      <p className="text-xs text-axal-muted">{settlementDirectionLabel(s.direction)} · due <Recorded value={s.due_on} reason="No due date was recorded." /></p>
      {s.memo ? <p className="text-xs text-axal-muted">{s.memo}</p> : null}
      {s.issued_at ? <p className="text-xs text-axal-muted">Issued <Recorded value={date(s.issued_at)} reason="The issue date could not be read." /></p> : null}
      {s.state === 'void' ? <p className="text-xs text-axal-muted">Voided: <Recorded value={s.void_reason} reason="No reason was recorded." /></p> : null}
      <div className="flex flex-wrap gap-2">
        {s.state === 'draft' && <button type="button" className={button} disabled={busy} onClick={() => onEdit(s)} data-testid={`settlement-edit-${s.uid}`}>Edit</button>}
        {s.state === 'draft' && <button type="button" className={button} disabled={busy} onClick={() => onDelete(s)} data-testid={`settlement-delete-${s.uid}`}>Delete draft</button>}
        {superAdmin && s.state === 'draft' && <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy} onClick={() => onIssue(s)} data-testid={`settlement-issue-${s.uid}`}>Issue</button>}
        {superAdmin && s.state === 'issued' && <button type="button" className={button} disabled={busy} onClick={() => onVoid(s)} data-testid={`settlement-void-${s.uid}`}>Void</button>}
      </div>
    </li>
  ))}</ul>;
}

export function SettlementForm({ form, editing, busy, error, onForm, onSave, onCancel }) {
  const draft = settlementDraft({ ...form, partner_deal_id: 1 });
  return <div className="space-y-2 rounded-lg border border-axal-hairline p-3" data-testid="settlement-form">
    <p className="text-xs font-bold uppercase tracking-wider text-axal-muted">{editing ? 'Edit draft' : 'New draft'}</p>
    <label className="block text-xs">Kind<select className={input} value={form.kind} onChange={(e) => onForm({ kind: e.target.value })} data-testid="settlement-kind">
      <option value="">Choose a kind</option>{SETTLEMENT_KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select></label>
    <label className="block text-xs">Direction<select className={input} value={form.direction} onChange={(e) => onForm({ direction: e.target.value })} data-testid="settlement-direction">
      <option value="">Choose who pays whom</option>{SETTLEMENT_DIRECTIONS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="block text-xs">Amount (USD)<input className={input} inputMode="decimal" value={form.amount} placeholder="1,200.00" onChange={(e) => onForm({ amount: e.target.value })} data-testid="settlement-amount" /></label>
      <label className="block text-xs">Due<input className={input} type="date" value={form.due_on} onChange={(e) => onForm({ due_on: e.target.value })} data-testid="settlement-due" /></label>
    </div>
    <label className="block text-xs">Memo (optional)<textarea className={input} rows={2} maxLength={2000} value={form.memo} onChange={(e) => onForm({ memo: e.target.value })} data-testid="settlement-memo" /></label>
    {draft.error && (form.kind || form.direction || form.amount || form.due_on || form.memo) ? <p className="text-xs text-axal-muted" data-testid="settlement-form-hint">{draft.error}</p> : null}
    {error && <p role="alert" className="text-xs text-red-700" data-testid="settlement-form-error">{error}</p>}
    <div className="flex gap-2">
      <button type="button" className={`${button} bg-violet-600 text-white`} disabled={busy || !!draft.error} onClick={onSave} data-testid="settlement-save">{busy ? 'Saving…' : editing ? 'Save draft' : 'Save as draft'}</button>
      {editing && <button type="button" className={button} disabled={busy} onClick={onCancel}>Cancel</button>}
    </div>
  </div>;
}

export default function SettlementsDesk({ deal, superAdmin, onClose }) {
  const [revision, setRevision] = useState(0);
  const read = useRead(() => partnerSettlementsApi.list({ deal: deal.id }), [deal.id, revision]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = deal.status === 'active';

  const run = async (fn, fallback, after) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); after?.(); setRevision((n) => n + 1); }
    catch (e) { reportError('contracts:settlements', e); setError(e?.message || fallback); }
    finally { setBusy(false); }
  };
  const save = () => {
    const out = settlementDraft({ ...form, partner_deal_id: deal.id });
    if (out.error) { setError(out.error); return; }
    run(() => (editing ? partnerSettlementsApi.update(editing.uid, out.body) : partnerSettlementsApi.create(out.body)),
      'The draft could not be saved.', () => { setForm(EMPTY); setEditing(null); });
  };

  return <SidePanel title={`Settlements · ${deal.partner_name || deal.partner_email || `Deal ${deal.id}`}`} onClose={onClose}>
    <p className="text-xs text-axal-muted">What Management and the partner owe each other under this signed deal. Recording one moves no money: the partner matches an issued settlement to a line in their own bank.</p>
    {!superAdmin && <p className="text-xs text-axal-muted" data-testid="settlements-super-admin-note">Issuing and voiding are the Super Admin’s. You can draft, edit and delete drafts.</p>}
    {error && !editing && <p role="alert" className="text-xs text-red-700" data-testid="settlements-error">{error}</p>}
    <ReadState read={read} what="Settlements">
      {Array.isArray(read.data) && <SettlementRows rows={read.data} superAdmin={superAdmin} busy={busy}
        onEdit={(s) => { setEditing(s); setForm(toForm(s)); setError(''); }}
        onDelete={(s) => run(() => partnerSettlementsApi.remove(s.uid), 'The draft could not be deleted. It is unchanged.')}
        onIssue={(s) => run(() => partnerSettlementsApi.issue(s.uid), 'The settlement could not be issued. It is still a draft.')}
        onVoid={(s) => { setVoiding(s); setReason(''); }} />}
    </ReadState>
    {superAdmin && voiding && <div className="space-y-2 rounded-lg border border-axal-hairline p-3" data-testid="settlement-void-form">
      <label className="block text-xs">Why void this settlement?<textarea className={input} rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="settlement-void-reason" /></label>
      <div className="flex gap-2">
        <button type="button" className={button} disabled={busy || !reason.trim()} data-testid="settlement-void-confirm"
          onClick={() => run(() => partnerSettlementsApi.void(voiding.uid, reason.trim()), 'The settlement could not be voided. It still stands.', () => setVoiding(null))}>Void settlement</button>
        <button type="button" className={button} disabled={busy} onClick={() => setVoiding(null)}>Cancel</button>
      </div>
    </div>}
    {active
      ? <SettlementForm form={form} editing={!!editing} busy={busy} error={editing ? error : ''} onForm={(patch) => setForm((f) => ({ ...f, ...patch }))}
        onSave={save} onCancel={() => { setEditing(null); setForm(EMPTY); setError(''); }} />
      : <p className="text-xs text-axal-muted" data-testid="settlements-deal-inactive">A settlement is drafted only under an active deal; this one is {deal.status || 'of a status not recorded'}.</p>}
  </SidePanel>;
}
