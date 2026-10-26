import React, { useState } from 'react';
import { bankAccountsApi } from '../../../lib/api/bankAccounts';
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat';
import { Lightbox } from '../../../ui';
import {
  ENTITY_ORDER, PAYMENT_PURPOSE_OPTIONS, accountName, accountTitle, fromMercuryError, labelError,
  labelForKind, legalName, paymentsEffect, reasonError, refusalText, retireEffect, shortName,
} from './bankAccountsModel';

/**
 * D1185 (#3114) — Bank accounts' dialogs, the canvas's board BNK6. Each one
 * says what it changes before it is sent, and replaces the inline forms D717
 * drew under a row's Manage: Add an account, Add from Mercury, Relabel,
 * Change payments, Retire and Reveal.
 *
 * Payment instructions never change in place, so no dialog edits a bank,
 * beneficiary, number or identifier: only the label and the payments change,
 * and anything else is a retire and a new account. Every write and the
 * reveal go through `request()`, which asks for a fresh authenticator code
 * itself when the Worker answers `step_up_required` (board BNK6 F), and sends
 * the write again once. A refusal stays in its dialog, in the Worker's words.
 */

/**
 * Mercury's partner bank and its public identifiers, each still editable. No
 * account number: the owner types that from Mercury's own account page.
 */
export const MERCURY_PRESET = {
  label: 'Mercury (Column N.A.)',
  bank_name: 'Column N.A.',
  bank_address: '1 Letterman Drive, Building A, Suite A4-700, San Francisco, CA 94129',
  beneficiary_address: '16192 Coastal Highway, Lewes, DE 19958',
  routing_number: '121145433',
  routing_number_alt: '121145307',
  swift_code: 'CLNOUS66MER',
  intermediary_swift_code: 'CHASUS33XXX',
};
const MERCURY_BANK_OPTION = `Mercury · ${MERCURY_PRESET.bank_name} · ABA ${MERCURY_PRESET.routing_number} · SWIFT ${MERCURY_PRESET.swift_code}`;
const { label: _presetLabel, ...MERCURY_BANK } = MERCURY_PRESET;

export const ADD_NOTE = 'Saved encrypted. The full number is not shown again, except through Reveal.';

// ── Styles, shared with the console and the lightbox ─────────────────────────

export const inputCls = 'w-full rounded-md border border-[#dcd9e3] bg-white px-2.5 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const btnCls = 'inline-flex items-center justify-center gap-1 max-sm:min-h-[44px] max-sm:px-3.5 rounded-md border border-[#dcd9e3] bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
export const primaryCls = 'inline-flex items-center justify-center gap-1 max-sm:min-h-[44px] max-sm:px-4 rounded-md bg-axal-violet px-3 py-1.5 text-xs font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400';
export const dangerCls = 'inline-flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:hover:bg-rose-400';
export const fieldCls = 'block text-[11.5px] font-semibold text-axal-muted dark:text-gray-400';
export const muted = 'text-axal-muted dark:text-gray-400';
export const amber = 'text-amber-700 dark:text-amber-300';
const noteCls = {
  info: 'rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] font-semibold text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  warn: 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
};

function Note({ tone = 'info', children, testId }) {
  return <p className={noteCls[tone] || noteCls.info} data-testid={testId}>{children}</p>;
}
function Refusal({ text }) {
  return text ? <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{text}</p> : null;
}

/**
 * One dialog: its title says what it changes, its footer is Cancel and the change.
 * D1187 (BNK12): on a phone it is a bottom sheet (`phone="sheet"`), except
 * Reveal, which BNK12d draws as a full-screen sheet.
 */
function Dialog({ title, sub, testId, onClose, onSubmit, action, actionCls = primaryCls, ready = true, busy, width = 520, phone = 'sheet', children }) {
  const submit = (e) => { e?.preventDefault?.(); if (ready && !busy) onSubmit(); };
  return (
    <Lightbox label={title} title={title} sub={sub} width={width} onClose={onClose} testId={testId} phone={phone}
      footer={(
        <div className="flex flex-wrap justify-end gap-2 max-sm:flex-nowrap">
          <button type="button" className={`${btnCls} max-sm:flex-1`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${actionCls} max-sm:flex-1`} onClick={submit} disabled={!ready || busy}>{action}</button>
        </div>
      )}>
      <form onSubmit={submit} className="space-y-3 px-5 py-4" data-testid={`${testId}-form`}>{children}</form>
    </Lightbox>
  );
}

/** Runs a dialog's write; a refusal stays in the dialog in the Worker's words. */
function useSend() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async (fn, fallback) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(refusalText(e, fallback));
    } finally { setBusy(false); }
  };
  return { busy, error, send };
}

/** The payments an account can take: its own entity's, and only on checking. */
export function PurposePicker({ entity, kind, value, onChange, legend = 'Payments · this entity’s only' }) {
  const options = PAYMENT_PURPOSE_OPTIONS.filter((o) => o.payee === entity);
  if (kind !== 'checking') return <p className={`text-xs ${muted}`}>A savings account takes no payments.</p>;
  if (!options.length) return <p className={`text-xs ${muted}`}>No payment is made to this entity through the registry.</p>;
  return (
    <fieldset className="flex flex-wrap gap-3 text-xs text-gray-700 dark:text-gray-300">
      <legend className={`mb-1 ${fieldCls}`}>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-1">
          <input type="checkbox" checked={value.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((p) => p !== o.value))} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

const OTHER_BANK_FIELDS = [
  ['bank_name', 'Bank name'], ['bank_address', 'Bank address'], ['beneficiary_address', 'Beneficiary address'],
  ['routing_number', 'ABA routing number'], ['routing_number_alt', 'Alternate ABA (optional)'],
  ['swift_code', 'SWIFT (optional)'], ['intermediary_swift_code', 'Intermediary SWIFT (optional)'],
];

/** BNK6 A — Add an account, for one entity. */
export function AddAccountDialog({ entity = null, fundHasAccount, onClose, onAdded }) {
  const [form, setForm] = useState(() => ({
    entity_key: entity || (fundHasAccount ? 'holdings' : 'fund'), bank: 'mercury', account_kind: 'checking',
    label: labelForKind('checking'), labelTouched: false,
    account_number: '', account_number_confirm: '', purposes: [],
    bank_name: '', bank_address: '', beneficiary_address: '', routing_number: '', routing_number_alt: '', swift_code: '', intermediary_swift_code: '',
  }));
  const { busy, error, send } = useSend();
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const pickEntity = (key) => setForm((f) => ({
    ...f, entity_key: key,
    purposes: f.purposes.filter((p) => PAYMENT_PURPOSE_OPTIONS.find((o) => o.value === p)?.payee === key),
  }));
  const pickKind = (kind) => setForm((f) => ({
    ...f, account_kind: kind, purposes: kind === 'checking' ? f.purposes : [],
    label: f.labelTouched ? f.label : labelForKind(kind),
  }));
  const badLabel = labelError(form.label);

  const save = () => send(async () => {
    const bank = form.bank === 'mercury' ? MERCURY_BANK : Object.fromEntries(OTHER_BANK_FIELDS.map(([k]) => [k, form[k]]));
    await bankAccountsApi.add({
      entity_key: form.entity_key,
      label: form.label.trim(),
      beneficiary_name: legalName(form.entity_key),
      account_kind: form.account_kind,
      account_number: form.account_number,
      account_number_confirm: form.account_number_confirm,
      purposes: form.account_kind === 'checking' ? form.purposes : [],
      ...bank,
    });
    await onAdded('Account added.');
  });

  return (
    <Dialog title="Add an account" sub="For one entity. Payment instructions never change once saved." testId="bank-accounts-add-dialog"
      onClose={onClose} onSubmit={save} action="Save account" ready={!badLabel} busy={busy} width={560}>
      <label className={fieldCls}>Entity
        <select className={inputCls} value={form.entity_key} onChange={(e) => pickEntity(e.target.value)}>
          {ENTITY_ORDER.map((k) => <option key={k} value={k}>{shortName(k)}</option>)}
        </select>
      </label>
      <p className={`text-[12px] ${muted}`} data-testid="bank-accounts-add-beneficiary">{`Beneficiary, read only: ${AXAL_ENTITIES[form.entity_key]?.name || form.entity_key}`}</p>
      <label className={fieldCls}>Bank
        <select className={inputCls} value={form.bank} onChange={(e) => set({ bank: e.target.value })}>
          <option value="mercury">{MERCURY_BANK_OPTION}</option>
          <option value="other">Another bank</option>
        </select>
      </label>
      {form.bank === 'other' && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="bank-accounts-other-bank">
          {OTHER_BANK_FIELDS.map(([name, text]) => (
            <label key={name} className={fieldCls}>{text}
              <input className={inputCls} value={form[name]} onChange={(e) => set({ [name]: e.target.value })} />
            </label>
          ))}
        </div>
      )}
      <label className={fieldCls}>Kind
        <select className={inputCls} value={form.account_kind} onChange={(e) => pickKind(e.target.value)}>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </label>
      <label className={fieldCls}>Label
        <input className={inputCls} value={form.label} maxLength={60} onChange={(e) => set({ label: e.target.value, labelTouched: true })} />
      </label>
      <p className={`-mt-2 text-[11.5px] ${badLabel ? amber : muted}`}>{badLabel || 'Prefilled from the kind. You can change it.'}</p>
      <label className={fieldCls}>Account number
        <input className={inputCls} type="password" autoComplete="off" inputMode="numeric" value={form.account_number}
          onChange={(e) => set({ account_number: e.target.value })} />
      </label>
      <label className={fieldCls}>Account number again
        <input className={inputCls} type="password" autoComplete="off" inputMode="numeric" value={form.account_number_confirm}
          onChange={(e) => set({ account_number_confirm: e.target.value })} />
      </label>
      <PurposePicker entity={form.entity_key} kind={form.account_kind} value={form.purposes} onChange={(purposes) => set({ purposes })} />
      <p className={`text-[12px] ${muted}`}>{ADD_NOTE}</p>
      <Refusal text={error} />
    </Dialog>
  );
}

/**
 * BNK6 A, from "Add it to the registry": an account Mercury reads that the
 * registry does not hold. The Worker reads the stored Mercury account and
 * refuses unless its entity, ending and kind match (D1184).
 */
export function AddFromMercuryDialog({ item, onClose, onAdded }) {
  const kind = item?.kind === 'savings' ? 'savings' : 'checking';
  const [number, setNumber] = useState('');
  const [confirm, setConfirm] = useState('');
  const [label, setLabel] = useState(labelForKind(kind));
  const { busy, error, send } = useSend();
  const problem = fromMercuryError(number, confirm, item?.last_four) || labelError(label);
  const touched = number.length > 0 || confirm.length > 0;
  const save = () => send(async () => {
    await bankAccountsApi.addFromMercury(item.uid, {
      entity_key: item.entity_key, label: label.trim(), beneficiary_name: legalName(item.entity_key),
      account_kind: kind, account_number: number, account_number_confirm: confirm, purposes: [], ...MERCURY_BANK,
    });
    await onAdded('Account added. Give it its payments from Change payments.');
  });
  return (
    <Dialog title="Add an account" sub={`${shortName(item?.entity_key)} · from Mercury`} testId="bank-accounts-add-mercury-dialog"
      onClose={onClose} onSubmit={save} action="Save account" ready={!problem} busy={busy}>
      <Note testId="bank-accounts-add-mercury-line">{`Mercury reads ••••${item?.last_four} for ${shortName(item?.entity_key)}. Type the full number from Mercury’s account page. It must end in ${item?.last_four}.`}</Note>
      <label className={fieldCls}>Label
        <input className={inputCls} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className={fieldCls}>Account number
        <input className={inputCls} type="password" autoComplete="off" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
      </label>
      <label className={fieldCls}>Account number again
        <input className={inputCls} type="password" autoComplete="off" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {touched && problem && <p className={`text-[12px] ${amber}`} data-testid="bank-accounts-add-mercury-problem">{problem}</p>}
      <p className={`text-[12px] ${muted}`}>{`${kindWordOf(kind)}, at Mercury · ${MERCURY_PRESET.bank_name}. ${ADD_NOTE}`}</p>
      <Refusal text={error} />
    </Dialog>
  );
}
const kindWordOf = (k) => (k === 'savings' ? 'Savings' : 'Checking');

/** BNK6 B — Relabel: only the label changes. */
export function RelabelDialog({ account, onClose, onSaved }) {
  const [label, setLabel] = useState(account.label || '');
  const { busy, error, send } = useSend();
  const bad = labelError(label);
  const same = label.trim() === account.label;
  const save = () => send(async () => {
    await bankAccountsApi.update(account.uid, { label: label.trim() });
    await onSaved('Label saved.');
  });
  return (
    <Dialog title={`Relabel ${accountTitle(account)}`} sub="Only the label changes. Notices do not print it." testId="bank-accounts-relabel-dialog"
      onClose={onClose} onSubmit={save} action="Save label" ready={!bad && !same} busy={busy}>
      <label className={fieldCls}>Label · 1 to 60 characters
        <input className={inputCls} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
      </label>
      {bad && <p className={`text-[12px] ${amber}`}>{bad}</p>}
      <Refusal text={error} />
    </Dialog>
  );
}

/** BNK6 C — Change payments: says what each change prints, or refuses, before it is saved. */
export function PaymentsDialog({ account, accounts, onClose, onSaved }) {
  const [purposes, setPurposes] = useState(() => [...(account.purposes || [])]);
  const { busy, error, send } = useSend();
  const effect = paymentsEffect(account, purposes, accounts);
  const save = () => send(async () => {
    await bankAccountsApi.update(account.uid, { purposes });
    await onSaved('Payments saved.');
  });
  return (
    <Dialog title={`Change payments · ${accountTitle(account)}`} sub="Only the payments it takes change. Its payment instructions stay as they are."
      testId="bank-accounts-payments-dialog" onClose={onClose} onSubmit={save} action="Save payments"
      ready={effect.changed && !effect.blocked.length} busy={busy}>
      <PurposePicker entity={account.entity_key} kind={account.account_kind} value={purposes} onChange={setPurposes} legend="Payments it takes" />
      <div className="space-y-2" data-testid="bank-accounts-payments-effect">
        {effect.lines.length
          ? effect.lines.map((l) => <Note key={l.text} tone={l.tone}>{l.text}</Note>)
          : <p className={`text-[12.5px] ${muted}`}>Nothing changes yet. Tick or clear a payment.</p>}
      </div>
      <Refusal text={error} />
    </Dialog>
  );
}

/** BNK6 D — Retire: kept, never changed, takes no payments; says what refuses after. */
export function RetireDialog({ account, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const { busy, error, send } = useSend();
  const effect = retireEffect(account);
  const save = () => send(async () => {
    await bankAccountsApi.retire(account.uid, reason.trim());
    await onSaved('Account retired.');
  });
  return (
    <Dialog title={`Retire ${accountTitle(account)}?`} sub="A retired account is kept, never changed, and takes no payments." testId="bank-accounts-retire-dialog"
      onClose={onClose} onSubmit={save} action="Retire account" actionCls={dangerCls} ready={!reasonError(reason)} busy={busy}>
      <label className={fieldCls}>Reason · required · up to 200 characters
        <textarea className={`${inputCls} min-h-[56px]`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </label>
      {effect && <Note tone="warn" testId="bank-accounts-retire-effect">{effect}</Note>}
      <p className={`text-[12px] ${muted}`}>Add the new account after. The retired one stays in the registry and in History.</p>
      <Refusal text={error} />
    </Dialog>
  );
}

/**
 * BNK6 E — Reveal the full number. A reason is required; the Worker writes it
 * to the ledger before it decrypts, and the number shows for 30 seconds.
 */
export function RevealDialog({ account: a, onClose, onReveal }) {
  const [reason, setReason] = useState('');
  const { busy, error, send } = useSend();
  const go = () => send(() => onReveal(reason.trim()), 'The number could not be shown.');
  return (
    <Dialog title="Reveal the full number" sub={null} testId="bank-accounts-reveal-dialog" width={460} phone="full"
      onClose={onClose} onSubmit={go} action="Reveal for 30 seconds" ready={!reasonError(reason)} busy={busy}>
      <p className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="bank-accounts-reveal-body">
        {`${accountName(a)}. Your reason is recorded before the number is shown.`}
      </p>
      <label className={fieldCls}>Reason · required · 1 to 200 characters
        <input className={inputCls} value={reason} maxLength={200} placeholder="Why you need the full number"
          onChange={(e) => setReason(e.target.value)} />
      </label>
      <Refusal text={error} />
    </Dialog>
  );
}
