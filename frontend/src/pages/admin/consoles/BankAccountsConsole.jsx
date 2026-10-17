import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Landmark, Plus, RefreshCw } from 'lucide-react';
import { bankAccountsApi } from '../../../lib/api/bankAccounts';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat';
import { ConsoleUnreadable, CONSOLE_LOADING } from './shared';

/**
 * D708 (#1773) — Bank accounts: each Axal entity's accounts, which payments
 * each takes, and the resolver's answer per payment.
 *
 * Only the Super Admin sees it. Anyone else gets one sentence, no controls,
 * and no read is made. Lists are masked (`••••NNNN`). A reveal asks for a
 * reason, is recorded by the Worker before it decrypts, and the number shows
 * here for 30 seconds, held in component state only — never in storage.
 *
 * Payment instructions never change in place: an account's bank, beneficiary,
 * number and identifiers are fixed once added. Only the label and the purposes
 * can be edited; to change anything else, retire the account and add another.
 * Writes need a fresh TOTP step-up, which `request()` asks for itself.
 */

export const BANK_ACCOUNTS_HOLDER_ONLY = 'Only the Super Admin can see or change payment instructions.';

/** How long a revealed number stays on screen. */
export const REVEAL_MS = 30_000;

/** The Worker's `PAYMENT_PURPOSES` (`services/payInstructions.ts`): each purpose and the one entity it pays. */
export const PAYMENT_PURPOSE_OPTIONS = [
  { value: 'capital_contribution', label: 'Capital contributions', payee: 'fund' },
  { value: 'gp_commitment', label: 'GP commitment', payee: 'fund' },
  { value: 'management_fee', label: 'Management fee', payee: 'gp' },
  { value: 'platform_licence_fee', label: 'Platform licence fee', payee: 'holdings' },
];

const ENTITY_ORDER = ['holdings', 'management', 'gp', 'fund'];

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

const emptyForm = (entity = 'holdings') => ({
  entity_key: entity, label: '', bank_name: '', bank_address: '',
  beneficiary_name: AXAL_ENTITIES[entity]?.name || '', beneficiary_address: '',
  account_kind: 'checking', account_number: '', account_number_confirm: '',
  routing_number: '', routing_number_alt: '', swift_code: '', intermediary_swift_code: '', purposes: [],
});

const inputCls = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const btnCls = 'inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800';

const errText = (e, fallback) => e?.data?.message || e?.message || fallback;
const purposeLabel = (p) => PAYMENT_PURPOSE_OPTIONS.find((o) => o.value === p)?.label || p;

export function BankAccountsPanel() {
  const holder = isSuperAdminUser(useAuth().user);
  if (!holder) {
    return <p className="p-6 text-sm text-gray-700 dark:text-gray-300" data-testid="bank-accounts-holder-only">{BANK_ACCOUNTS_HOLDER_ONLY}</p>;
  }
  return <BankAccountsRegistry />;
}

function BankAccountsRegistry() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(() => emptyForm());
  const [busy, setBusy] = useState(false);
  // { uid, kind: 'relabel' | 'purposes' | 'retire' | 'reveal', value }
  const [action, setAction] = useState(null);
  // { uid, number } — state only, cleared after REVEAL_MS and on unmount.
  const [revealed, setRevealed] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await bankAccountsApi.list());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: 'ok', msg: ok });
      setAction(null);
      await load();
    } catch (e) {
      setNotice({ kind: 'err', msg: errText(e, 'That did not save. Nothing changed.') });
    } finally { setBusy(false); }
  };

  const reveal = async (uid, reason) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await bankAccountsApi.reveal(uid, reason);
      if (timer.current) clearTimeout(timer.current);
      setRevealed({ uid, number: r?.account?.account_number || '' });
      timer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
      setAction(null);
    } catch (e) {
      setNotice({ kind: 'err', msg: errText(e, 'The number could not be shown.') });
    } finally { setBusy(false); }
  };

  const pickEntity = (entity) => setForm((f) => ({
    ...f, entity_key: entity, beneficiary_name: AXAL_ENTITIES[entity]?.name || '',
    purposes: f.purposes.filter((p) => PAYMENT_PURPOSE_OPTIONS.find((o) => o.value === p)?.payee === entity),
  }));

  const add = (e) => {
    e.preventDefault();
    if (busy) return;
    run(async () => {
      await bankAccountsApi.add(form);
      setForm(emptyForm(form.entity_key));
      setShowAdd(false);
    }, 'Account added.');
  };

  if (failed) return <ConsoleUnreadable what="The bank accounts" onRetry={load} />;
  if (!data) return <div className="p-8 text-center text-sm text-gray-500">{CONSOLE_LOADING}</div>;

  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const coverage = Array.isArray(data.coverage) ? data.coverage : [];

  return (
    <div className="space-y-6 p-4" data-testid="bank-accounts-console">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
          <Landmark size={16} /> Bank accounts
        </h2>
        <div className="flex gap-2">
          <button type="button" className={btnCls} onClick={load} disabled={busy}><RefreshCw size={12} /> Refresh</button>
          <button type="button" className={btnCls} onClick={() => setShowAdd((v) => !v)} data-testid="bank-accounts-add-toggle">
            <Plus size={12} /> Add account
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="bank-accounts-fund-i">
        {data.fund_i
          ? `Fund I is ${data.fund_i.name} (fund #${data.fund_i.id}). Its capital calls are paid into the Fund's account below.`
          : 'No fund carries the spinout-fund-i slug, so no fund is paid into the Fund\'s account. Set the slug on Fund I\'s record.'}
      </p>

      {notice && (
        <p role={notice.kind === 'err' ? 'alert' : 'status'}
          className={`text-sm ${notice.kind === 'err' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {notice.msg}
        </p>
      )}

      <section data-testid="bank-accounts-coverage">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Where each payment goes</h3>
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {coverage.map((row) => (
            <li key={row.purpose} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {row.label} <span className="text-xs font-normal text-gray-500">to {AXAL_ENTITIES[row.payee]?.name || row.payee}</span>
              </span>
              {row.ok
                ? <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">{row.account_masked}</span>
                : <span className="text-xs text-amber-700 dark:text-amber-300">{row.message}</span>}
            </li>
          ))}
        </ul>
      </section>

      {showAdd && (
        <form onSubmit={add} className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-gray-700" data-testid="bank-accounts-add-form">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add an account</h3>
            <button type="button" className={btnCls} onClick={() => setForm((f) => ({ ...f, ...MERCURY_PRESET }))}
              data-testid="bank-accounts-mercury-preset">
              Fill in Mercury (Column N.A.)
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-600 dark:text-gray-400">Entity
              <select className={inputCls} value={form.entity_key} onChange={(e) => pickEntity(e.target.value)}>
                {ENTITY_ORDER.map((k) => <option key={k} value={k}>{AXAL_ENTITIES[k].name}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400">Kind
              <select className={inputCls} value={form.account_kind}
                onChange={(e) => setForm((f) => ({ ...f, account_kind: e.target.value, purposes: e.target.value === 'checking' ? f.purposes : [] }))}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </label>
            {[
              ['label', 'Label'], ['bank_name', 'Bank'], ['bank_address', "Bank's address"],
              ['beneficiary_name', 'Beneficiary (the entity\'s legal name)'], ['beneficiary_address', "Beneficiary's address"],
              ['routing_number', 'ABA routing number'], ['routing_number_alt', 'Alternate ABA (optional)'],
              ['swift_code', 'SWIFT (optional)'], ['intermediary_swift_code', 'Intermediary SWIFT (optional)'],
            ].map(([name, label]) => (
              <label key={name} className="text-xs text-gray-600 dark:text-gray-400">{label}
                <input className={inputCls} value={form[name]} onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))} />
              </label>
            ))}
            <label className="text-xs text-gray-600 dark:text-gray-400">Account number
              <input className={inputCls} type="password" autoComplete="off" inputMode="numeric" value={form.account_number}
                onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} />
            </label>
            <label className="text-xs text-gray-600 dark:text-gray-400">Account number, again
              <input className={inputCls} type="password" autoComplete="off" inputMode="numeric" value={form.account_number_confirm}
                onChange={(e) => setForm((f) => ({ ...f, account_number_confirm: e.target.value }))} />
            </label>
          </div>
          <PurposePicker entity={form.entity_key} kind={form.account_kind} value={form.purposes}
            onChange={(purposes) => setForm((f) => ({ ...f, purposes }))} />
          <button type="submit" className={btnCls} disabled={busy}>Add account</button>
        </form>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Accounts</h3>
        {accounts.length === 0
          ? <p className="text-sm text-gray-500" data-testid="bank-accounts-empty">No account has been added yet.</p>
          : (
            <ul className="space-y-2" data-testid="bank-accounts-list">
              {accounts.map((a) => (
                <AccountRow key={a.uid} account={a} busy={busy} action={action?.uid === a.uid ? action : null}
                  setAction={setAction} revealed={revealed?.uid === a.uid ? revealed.number : null}
                  onRelabel={(label) => run(() => bankAccountsApi.update(a.uid, { label }), 'Label saved.')}
                  onPurposes={(purposes) => run(() => bankAccountsApi.update(a.uid, { purposes }), 'Purposes saved.')}
                  onRetire={(reason) => run(() => bankAccountsApi.retire(a.uid, reason), 'Account retired.')}
                  onReveal={(reason) => reveal(a.uid, reason)} />
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function PurposePicker({ entity, kind, value, onChange }) {
  const options = PAYMENT_PURPOSE_OPTIONS.filter((o) => o.payee === entity);
  if (kind !== 'checking') return <p className="text-xs text-gray-500">A savings account takes no payments.</p>;
  if (!options.length) return <p className="text-xs text-gray-500">No payment is made to this entity through the registry.</p>;
  return (
    <fieldset className="flex flex-wrap gap-3 text-xs text-gray-700 dark:text-gray-300">
      <legend className="mb-1 text-xs text-gray-600 dark:text-gray-400">Takes</legend>
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

function AccountRow({ account: a, busy, action, setAction, revealed, onRelabel, onPurposes, onRetire, onReveal }) {
  const active = a.status === 'active';
  const open = (kind, value = '') => setAction({ uid: a.uid, kind, value });
  const set = (value) => setAction({ ...action, value });
  const submit = (e) => {
    e.preventDefault();
    if (!action || busy) return;
    if (action.kind === 'relabel') onRelabel(action.value);
    if (action.kind === 'purposes') onPurposes(action.value);
    if (action.kind === 'retire') onRetire(action.value);
    if (action.kind === 'reveal') onReveal(action.value);
  };
  return (
    <li className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-700" data-testid="bank-account-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-gray-900 dark:text-gray-100">{a.label}</span>
        <span className="text-xs text-gray-500">{a.entity_name} · {a.account_kind} · {active ? 'active' : `retired ${a.retired_at || ''}`}</span>
      </div>
      <div className="mt-1 grid gap-1 text-xs text-gray-600 dark:text-gray-400 sm:grid-cols-2">
        <span>{a.bank_name}</span>
        <span className="font-mono">{revealed || a.account_masked}</span>
        <span>ABA {a.routing_number}{a.routing_number_alt ? ` · alt ${a.routing_number_alt}` : ''}</span>
        <span>{a.swift_code ? `SWIFT ${a.swift_code}` : ''}{a.intermediary_swift_code ? ` · via ${a.intermediary_swift_code}` : ''}</span>
        <span className="sm:col-span-2">Takes: {a.purposes?.length ? a.purposes.map(purposeLabel).join(', ') : 'nothing'}</span>
        {!active && a.retired_reason && <span className="sm:col-span-2">Retired: {a.retired_reason}</span>}
      </div>
      {revealed && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Shown for 30 seconds. It is not kept on this device.</p>}
      {active && !action && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btnCls} onClick={() => open('relabel', a.label)}>Relabel</button>
          <button type="button" className={btnCls} onClick={() => open('purposes', a.purposes || [])}>Purposes</button>
          <button type="button" className={btnCls} onClick={() => open('reveal')}>Reveal number</button>
          <button type="button" className={btnCls} onClick={() => open('retire')}>Retire</button>
        </div>
      )}
      {action && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          {action.kind === 'purposes'
            ? <PurposePicker entity={a.entity_key} kind={a.account_kind} value={action.value} onChange={set} />
            : (
              <label className="block text-xs text-gray-600 dark:text-gray-400">
                {{ relabel: 'Label', retire: 'Why it is retired', reveal: 'Why you need the number' }[action.kind]}
                <input className={inputCls} value={action.value} maxLength={action.kind === 'relabel' ? 60 : 200}
                  onChange={(e) => set(e.target.value)} />
              </label>
            )}
          {action.kind === 'retire' && (
            <p className="text-xs text-gray-500">A retired account is kept, never changed, and takes no payments. Add the new one after.</p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={btnCls} disabled={busy}>
              {{ relabel: 'Save label', purposes: 'Save purposes', retire: 'Retire account', reveal: 'Reveal' }[action.kind]}
            </button>
            <button type="button" className={btnCls} onClick={() => setAction(null)}>Cancel</button>
          </div>
        </form>
      )}
    </li>
  );
}

export default BankAccountsPanel;
