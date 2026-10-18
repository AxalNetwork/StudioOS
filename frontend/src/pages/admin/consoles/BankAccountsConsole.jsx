import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bankAccountsApi } from '../../../lib/api/bankAccounts';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat';
import { Lightbox, Pill, Unreadable } from '../../../ui';
import { entityRows } from '../../account/mercuryModel';
import { agoLabel } from '../../account/connectorsModel';
import { MercuryEntitySheet } from '../../account/MercurySheet';
import { formatCents } from '../../investor/fundCallsModel.js';
import { FundStructureDoor } from '../contracts/FundStructureSheet';
import { ConsoleUnreadable, CONSOLE_LOADING } from './shared';

/**
 * D708 (#1773) — Bank accounts: each Axal entity's accounts, which payments
 * each takes, and the resolver's answer per payment. D717 (#1782, #1856)
 * restyles it in place to the canvas's board L11: one card per entity with its
 * Mercury connection, the unmatched receipts, what a notice refuses, and the
 * Add account and Reveal dialogs.
 *
 * Only the Super Admin sees it. Anyone else gets one sentence, no controls,
 * and no read is made. Lists are masked (`••••NNNN`). A reveal asks for a
 * reason, is recorded by the Worker before it decrypts, and the number shows
 * here for 30 seconds, held in component state only, never kept in the browser.
 *
 * Payment instructions never change in place: an account's bank, beneficiary,
 * number and identifiers are fixed once added. Only the label and the purposes
 * can be edited; to change anything else, retire the account and add another.
 * Writes need a fresh TOTP step-up, which `request()` asks for itself.
 *
 * Reads per open: the registry's `list` and the Mercury `connections()`, then
 * one unmatched-credit read per connected entity. Mercury is only read, through
 * `/api/admin/mercury`; this page holds no token form. The refusal sentences
 * under "What a notice refuses" are the Worker's (`refusals`), never copied.
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

// ── L11's words ───────────────────────────────────────────────────────────────

const SUB_LINE = 'Each entity’s accounts. Notices, statements and invoices fill their payment instructions from here.';
const AUDIT_LINE = 'Opening this page is recorded in the admin audit log: one read of the Mercury connections, and one of each connected entity\'s unmatched receipts.';
const FUND_MISSING = 'No account on file. Capital calls can’t issue until the Fund has one.';
const NO_ACCOUNT = 'No account on file.';
const RESERVE_WORDS = 'Reserve: never printed on a notice';
const NO_PURPOSE_WORDS = 'No notice purpose';
const RECONCILIATION_HREF = '/admin/fund-admin?tab=reconciliation';
const MERCURY_BANK_OPTION = `Mercury · ${MERCURY_PRESET.bank_name} · ABA ${MERCURY_PRESET.routing_number} · SWIFT ${MERCURY_PRESET.swift_code}`;
const ADD_NOTE = 'Saved encrypted. The full number is not shown again, except through Reveal.';
const REVEAL_SHOWN = 'Shown for 30 seconds. It is not kept on this device.';

/** The canvas's four lines, keyed by the resolver's code, in the canvas's order (`NOTICE_REFUSALS`). */
export const NOTICE_REFUSAL_LINES = Object.freeze({
  no_active_account: 'No account for this purpose.',
  holder_not_payee: 'The account’s holder is not the payee.',
  savings_account: 'A reserve account can’t receive payments.',
  fund_account_missing: 'Axal VC Spin-Out Lab Fund I LP has no account.',
});

const KIND_WORDS = { checking: 'Checking', savings: 'Savings' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Pure helpers, exported for the test ───────────────────────────────────────

/** One `entityRows` row (or null when the connections read failed) as the card's pill. */
export function connectionPill(row) {
  if (!row) return { tone: 'neutral', text: 'Not read' };
  if (!row.connected) return { tone: 'warn', text: `Not connected: add a read-only Mercury API token for ${row.name}` };
  if (row.state?.text === 'Connected') {
    const ago = agoLabel(row.lastSyncedAt);
    return { tone: 'ok', text: ago ? `Connected, read-only, last synced ${ago}` : 'Connected, read-only, not synced yet' };
  }
  return { tone: row.state?.tone || 'neutral', text: row.state?.text || 'Not read' };
}

/** The Purposes cell: the purpose labels, the reserve's words, or the no-purpose words. */
export function purposesText(account) {
  if (account?.account_kind === 'savings') return RESERVE_WORDS;
  const list = Array.isArray(account?.purposes) ? account.purposes : [];
  return list.length ? list.map(purposeLabel).join(' · ') : NO_PURPOSE_WORDS;
}

/** "<name>: <n> unmatched", "Not connected" or "Not read". An unknown count is never 0. */
export function unmatchedLine(name, read) {
  if (!read || read.status === 'unconnected') return `${name}: Not connected`;
  if (read.status === 'ready' && Number.isSafeInteger(read.total) && read.total >= 0) return `${name}: ${read.total} unmatched`;
  if (read.status === 'loading') return `${name}: Reading`;
  return `${name}: Not read`;
}

/** A `YYYY-MM-DD` day as "12 Oct"; "Not recorded" for anything else. */
export function receiptDate(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof isoDay === 'string' ? isoDay : '');
  const month = m ? Number(m[2]) : 0;
  const day = m ? Number(m[3]) : 0;
  if (!m || month < 1 || month > 12 || day < 1 || day > 31) return 'Not recorded';
  return `${day} ${MONTHS[month - 1]}`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md border border-[#dcd9e3] bg-white px-2.5 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const btnCls = 'inline-flex items-center gap-1 rounded-md border border-[#dcd9e3] bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
const primaryCls = 'inline-flex items-center gap-1 rounded-md bg-axal-violet px-3 py-1.5 text-xs font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400';
const cardCls = 'rounded-xl border border-[#dcd9e3] bg-white p-4 dark:border-gray-800 dark:bg-gray-950';
const fieldCls = 'block text-[11.5px] font-semibold text-axal-muted dark:text-gray-400';
const muted = 'text-axal-muted dark:text-gray-400';
const amber = 'text-amber-700 dark:text-amber-300';
const roseLink = 'font-bold text-rose-600 hover:underline dark:text-rose-300';
const ACCOUNT_GRID = 'sm:grid-cols-[1fr_0.8fr_0.8fr_1.3fr_1.6fr_0.7fr]';
const RECEIPT_GRID = 'sm:grid-cols-[0.7fr_1.2fr_0.7fr_1.6fr_1fr]';

const errText = (e, fallback) => e?.data?.message || e?.message || fallback;
const purposeLabel = (p) => PAYMENT_PURPOSE_OPTIONS.find((o) => o.value === p)?.label || p;
const entityName = (key) => AXAL_ENTITIES[key]?.name || key;
const list = (v) => (Array.isArray(v) ? v : []);

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
  const [busy, setBusy] = useState(false);
  // { uid, kind: 'relabel' | 'purposes' | 'retire', value }
  const [action, setAction] = useState(null);
  // The account whose Reveal dialog is open.
  const [revealFor, setRevealFor] = useState(null);
  // { uid, number }: state only, cleared after REVEAL_MS and on unmount.
  const [revealed, setRevealed] = useState(null);
  const timer = useRef(null);
  // { status: 'loading' | 'ready' | 'unreadable', rows }
  const [mercury, setMercury] = useState({ status: 'loading', rows: null });
  // entity key → { status: 'loading' | 'ready' | 'unreadable' | 'unconnected', total, items }
  const [unmatched, setUnmatched] = useState({});
  // The entity whose Connect or Replace opened the Mercury sheet.
  const [sheetFor, setSheetFor] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await bankAccountsApi.list());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const loadMercury = useCallback(async () => {
    setMercury({ status: 'loading', rows: null });
    let rows;
    try {
      rows = entityRows(await adminMercuryApi.connections());
    } catch {
      setMercury({ status: 'unreadable', rows: null });
      setUnmatched({});
      return;
    }
    setMercury({ status: 'ready', rows });
    setUnmatched(Object.fromEntries(rows.map((r) => [r.key, { status: r.connected ? 'loading' : 'unconnected' }])));
    await Promise.all(rows.filter((r) => r.connected).map(async (r) => {
      let read;
      try {
        const page = await adminMercuryApi.transactions({ entity: r.key, match: 'none', direction: 'credit' });
        read = { status: 'ready', total: page?.total, items: list(page?.items) };
      } catch {
        read = { status: 'unreadable' };
      }
      setUnmatched((u) => ({ ...u, [r.key]: read }));
    }));
  }, []);

  useEffect(() => { load(); loadMercury(); }, [load, loadMercury]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Best effort: once the sheet has drawn its rows, bring the chosen entity's group into view.
  useEffect(() => {
    if (!sheetFor) return undefined;
    const raf = globalThis.requestAnimationFrame;
    const doc = globalThis.document;
    if (typeof raf !== 'function' || !doc || typeof doc.querySelector !== 'function') return undefined;
    const start = Date.now();
    let live = true;
    let id = 0;
    const tick = () => {
      if (!live) return;
      const node = doc.querySelector(`[data-testid="mercury-entity-${sheetFor}"]`);
      if (node && typeof node.scrollIntoView === 'function') { node.scrollIntoView({ block: 'start' }); return; }
      if (Date.now() - start < 1000) id = raf(tick);
    };
    id = raf(tick);
    return () => { live = false; if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id); };
  }, [sheetFor]);

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

  /** Throws the Worker's refusal for the dialog to print. */
  const reveal = async (uid, reason) => {
    const r = await bankAccountsApi.reveal(uid, reason);
    if (timer.current) clearTimeout(timer.current);
    setRevealed({ uid, number: r?.account?.account_number || '' });
    timer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
    setRevealFor(null);
  };

  const added = async () => {
    setShowAdd(false);
    setNotice({ kind: 'ok', msg: 'Account added.' });
    await load();
  };

  const closeSheet = () => { setSheetFor(null); loadMercury(); };

  if (failed) return <ConsoleUnreadable what="The bank accounts" onRetry={load} />;
  if (!data) return <div className="p-8 text-center text-sm text-gray-500">{CONSOLE_LOADING}</div>;

  const accounts = list(data.accounts);
  const coverage = list(data.coverage);
  const fundHasAccount = accounts.some((a) => a.entity_key === 'fund' && a.status === 'active');
  const rowFor = (key) => (mercury.status === 'ready' ? mercury.rows.find((r) => r.key === key) || null : null);

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 rounded-xl border border-[#dcd9e3] bg-[#f8f8fa] p-4 text-[#18181b] dark:border-gray-800 dark:bg-[#121018] dark:text-[#f4f3f7] sm:p-[22px]"
      data-testid="bank-accounts-console">
      <RegistryHeader onAdd={() => { setNotice(null); setShowAdd(true); }} />

      {notice && (
        <p role={notice.kind === 'err' ? 'alert' : 'status'}
          className={`text-sm ${notice.kind === 'err' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {notice.msg}
        </p>
      )}

      {mercury.status === 'unreadable' && (
        <div data-testid="bank-accounts-mercury-unreadable">
          <Unreadable what="The Mercury connections" claim="This is not a claim that none is connected." onRetry={loadMercury} />
        </div>
      )}

      {ENTITY_ORDER.map((key) => (
        <EntityCard key={key} entity={key} fundI={data.fund_i} fundHasAccount={fundHasAccount}
          accounts={accounts.filter((a) => a.entity_key === key)}
          coverage={coverage.filter((c) => c.payee === key)}
          mercury={mercury} row={rowFor(key)} onConnect={() => setSheetFor(key)}
          busy={busy} action={action} setAction={setAction} revealed={revealed}
          onReveal={(a) => setRevealFor(a)}
          onRelabel={(a, label) => run(() => bankAccountsApi.update(a.uid, { label }), 'Label saved.')}
          onPurposes={(a, purposes) => run(() => bankAccountsApi.update(a.uid, { purposes }), 'Purposes saved.')}
          onRetire={(a, reason) => run(() => bankAccountsApi.retire(a.uid, reason), 'Account retired.')} />
      ))}

      <p className={`text-[11.5px] ${muted}`} data-testid="bank-accounts-audit-line">{AUDIT_LINE}</p>

      <UnmatchedReceipts mercury={mercury} unmatched={unmatched} />
      <NoticeRefusals refusals={data.refusals} coverage={coverage} />

      {showAdd && <AddAccountDialog fundHasAccount={fundHasAccount} onClose={() => setShowAdd(false)} onAdded={added} />}
      {revealFor && <RevealDialog account={revealFor} onClose={() => setRevealFor(null)} onReveal={(reason) => reveal(revealFor.uid, reason)} />}
      {sheetFor && <MercuryEntitySheet superAdmin eyebrow="Bank accounts" api={adminMercuryApi} onClose={closeSheet} />}
    </div>
  );
}

function RegistryHeader({ onAdd }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">Bank accounts</h2>
        <p className={`mt-0.5 text-[13px] ${muted}`}>{SUB_LINE}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FundStructureDoor />
        <button type="button" className={primaryCls} onClick={onAdd} data-testid="bank-accounts-add">Add account</button>
      </div>
    </header>
  );
}

function ConnectionPill({ mercury, row, onConnect }) {
  const pill = mercury.status === 'ready' ? connectionPill(row) : mercury.status === 'unreadable' ? connectionPill(null) : null;
  if (!pill) return <span className={`text-[11px] ${muted}`}>{CONSOLE_LOADING}</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
      <Pill tone={pill.tone} className="max-w-full max-sm:whitespace-normal" data-testid="bank-accounts-connection">{pill.text}</Pill>
      {mercury.status === 'ready' && row && (
        <button type="button" className={btnCls} onClick={onConnect}>{row.connected ? 'Replace' : 'Connect'}</button>
      )}
    </div>
  );
}

function EntityCard({ entity, fundI, fundHasAccount, accounts, coverage, mercury, row, onConnect, busy, action, setAction, revealed, onReveal, onRelabel, onPurposes, onRetire }) {
  const name = entityName(entity);
  const fund = entity === 'fund';
  const shown = fund && !fundHasAccount ? accounts.filter((a) => a.status !== 'active') : accounts;
  return (
    <section className={cardCls} aria-label={name} data-testid={`bank-accounts-entity-${entity}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{name}</h3>
        <ConnectionPill mercury={mercury} row={row} onConnect={onConnect} />
      </div>
      {row?.connected && row.error && <p className={`mt-1 text-[12px] ${muted}`}>{row.error}</p>}

      {fund && (
        <p className="mt-2 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="bank-accounts-fund-i">
          {fundI
            ? `Fund I is ${fundI.name} (fund #${fundI.id}). Its capital calls are paid into the Fund's account below.`
            : 'No fund carries the spinout-fund-i slug, so no fund is paid into the Fund\'s account. Set the slug on Fund I\'s record.'}
        </p>
      )}

      {fund && !fundHasAccount && (
        <p className="mt-3 rounded-lg border border-dashed border-[#fcd34d] bg-[#fffbeb] px-3 py-2.5 text-[12.5px] font-semibold text-[#92400e] dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="bank-accounts-fund-missing">
          {FUND_MISSING}
        </p>
      )}

      {shown.length > 0 && (
        <div className="mt-3 text-[12.5px]" role="table" aria-label={`${name} accounts`} data-testid="bank-accounts-table">
          <div role="row" className={`hidden gap-2 border-b border-[#dcd9e3] pb-1.5 text-[11px] font-bold uppercase tracking-[.06em] dark:border-gray-800 sm:grid ${ACCOUNT_GRID} ${muted}`}>
            {['Label', 'Bank', 'Kind', 'Account', 'Purposes', 'Status'].map((h) => <span key={h} role="columnheader">{h}</span>)}
          </div>
          {shown.map((a) => (
            <AccountRow key={a.uid} account={a} busy={busy} action={action?.uid === a.uid ? action : null}
              setAction={setAction} revealed={revealed?.uid === a.uid ? revealed.number : null}
              onReveal={() => onReveal(a)} onRelabel={(v) => onRelabel(a, v)} onPurposes={(v) => onPurposes(a, v)} onRetire={(v) => onRetire(a, v)} />
          ))}
        </div>
      )}
      {!fund && accounts.length === 0 && <p className={`mt-3 text-[12.5px] ${muted}`}>{NO_ACCOUNT}</p>}

      {coverage.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12.5px]" data-testid="bank-accounts-coverage">
          {coverage.map((c) => (
            <li key={c.purpose} className={c.ok ? 'text-gray-700 dark:text-gray-300' : amber}>
              {c.ok ? `${c.label}: paid into ${c.account_masked}` : c.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PurposePicker({ entity, kind, value, onChange }) {
  const options = PAYMENT_PURPOSE_OPTIONS.filter((o) => o.payee === entity);
  if (kind !== 'checking') return <p className={`text-xs ${muted}`}>A savings account takes no payments.</p>;
  if (!options.length) return <p className={`text-xs ${muted}`}>No payment is made to this entity through the registry.</p>;
  return (
    <fieldset className="flex flex-wrap gap-3 text-xs text-gray-700 dark:text-gray-300">
      <legend className={`mb-1 ${fieldCls}`}>Purposes</legend>
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

function AccountRow({ account: a, busy, action, setAction, revealed, onReveal, onRelabel, onPurposes, onRetire }) {
  const active = a.status === 'active';
  const [managing, setManaging] = useState(false);
  const open = (kind, value = '') => setAction({ uid: a.uid, kind, value });
  const set = (value) => setAction({ ...action, value });
  const submit = (e) => {
    e.preventDefault();
    if (!action || busy) return;
    if (action.kind === 'relabel') onRelabel(action.value);
    if (action.kind === 'purposes') onPurposes(action.value);
    if (action.kind === 'retire') onRetire(action.value);
  };
  return (
    <div className="border-b border-[#ecebf0] py-2 last:border-b-0 dark:border-gray-800" data-testid="bank-account-row">
      <div role="row" className={`grid grid-cols-1 gap-1 sm:items-center sm:gap-2 ${ACCOUNT_GRID}`}>
        <span role="cell" className="font-semibold text-axal-ink dark:text-gray-100">{a.label}</span>
        <span role="cell">{a.bank_name}</span>
        <span role="cell">{KIND_WORDS[a.account_kind] || a.account_kind}</span>
        <span role="cell" className="font-mono">
          {revealed
            ? <span data-testid="bank-account-revealed">{revealed}</span>
            : <span aria-label={`ending ${a.account_last4 || String(a.account_masked || '').slice(-4)}`}>{a.account_masked}</span>}
        </span>
        <span role="cell" className={a.account_kind === 'savings' || !a.purposes?.length ? muted : ''}>{purposesText(a)}</span>
        <span role="cell" className="flex flex-wrap items-center gap-1.5">
          <Pill tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Retired'}</Pill>
          {active && (
            <button type="button" className={btnCls} aria-expanded={managing}
              onClick={() => { setManaging((m) => !m); if (action) setAction(null); }}>Manage</button>
          )}
        </span>
      </div>
      {!active && a.retired_reason && <p className={`mt-1 text-xs ${muted}`}>Retired: {a.retired_reason}</p>}
      {revealed && <p className={`mt-1 text-xs ${amber}`}>{REVEAL_SHOWN}</p>}
      {active && managing && !action && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="bank-account-manage">
          <button type="button" className={btnCls} onClick={() => open('relabel', a.label)}>Relabel</button>
          <button type="button" className={btnCls} onClick={() => open('purposes', a.purposes || [])}>Purposes</button>
          <button type="button" className={btnCls} onClick={onReveal}>Reveal</button>
          <button type="button" className={btnCls} onClick={() => open('retire')}>Retire</button>
        </div>
      )}
      {action && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          {action.kind === 'purposes'
            ? <PurposePicker entity={a.entity_key} kind={a.account_kind} value={action.value} onChange={set} />
            : (
              <label className={fieldCls}>
                {{ relabel: 'Label', retire: 'Why it is retired' }[action.kind]}
                <input className={inputCls} value={action.value} maxLength={action.kind === 'relabel' ? 60 : 200}
                  onChange={(e) => set(e.target.value)} />
              </label>
            )}
          {action.kind === 'retire' && (
            <p className={`text-xs ${muted}`}>A retired account is kept, never changed, and takes no payments. Add the new one after.</p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={btnCls} disabled={busy}>
              {{ relabel: 'Save label', purposes: 'Save purposes', retire: 'Retire account' }[action.kind]}
            </button>
            <button type="button" className={btnCls} onClick={() => setAction(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function UnmatchedReceipts({ mercury, unmatched }) {
  const rows = ENTITY_ORDER.flatMap((key) => {
    const read = unmatched[key];
    return read?.status === 'ready' ? read.items.map((t) => ({ ...t, entity: key })) : [];
  })
    .sort((x, y) => String(y.created_on || '').localeCompare(String(x.created_on || '')))
    .slice(0, 5);
  const anyConnected = mercury.status === 'ready' && mercury.rows.some((r) => r.connected);
  const settled = anyConnected && ENTITY_ORDER.every((k) => unmatched[k]?.status !== 'loading');
  return (
    <section className={cardCls} aria-label="Unmatched receipts" data-testid="bank-accounts-unmatched">
      <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Unmatched receipts</h3>
      <p className={`mt-0.5 text-[12px] ${muted}`}>Mercury transactions that match no fee or capital-call line.</p>
      <ul className="mt-3 space-y-1 text-[12.5px]" data-testid="bank-accounts-unmatched-lines">
        {ENTITY_ORDER.map((key) => (
          <li key={key}>{unmatchedLine(entityName(key), mercury.status === 'unreadable' ? { status: 'unreadable' } : mercury.status === 'loading' ? { status: 'loading' } : unmatched[key])}</li>
        ))}
      </ul>
      {rows.length > 0 && (
        <div className="mt-3 text-[12.5px]" role="table" aria-label="Unmatched receipts" data-testid="bank-accounts-unmatched-table">
          <div role="row" className={`hidden gap-2 border-b border-[#dcd9e3] pb-1.5 text-[11px] font-bold uppercase tracking-[.06em] dark:border-gray-800 sm:grid ${RECEIPT_GRID} ${muted}`}>
            {['Date', 'Entity', 'Amount', 'Counterparty · memo', ''].map((h, i) => <span key={i} role="columnheader">{h}</span>)}
          </div>
          {rows.map((t) => (
            <div key={t.uid} role="row" className={`grid grid-cols-1 gap-1 border-b border-[#ecebf0] py-2 last:border-b-0 dark:border-gray-800 sm:items-center sm:gap-2 ${RECEIPT_GRID}`}
              data-testid="bank-accounts-unmatched-row">
              <span role="cell">{receiptDate(t.created_on)}</span>
              <span role="cell">{entityName(t.entity)}</span>
              <span role="cell" className="font-mono">{formatCents(t.amount_cents) || 'Not recorded'}</span>
              <span role="cell">{[t.counterparty_name, t.memo].filter(Boolean).join(' · ') || 'Not recorded'}</span>
              <span role="cell"><Link className={roseLink} to={RECONCILIATION_HREF}>Match on Reconciliation</Link></span>
            </div>
          ))}
        </div>
      )}
      {settled && rows.length === 0 && <p className={`mt-3 text-[12.5px] ${muted}`}>No unmatched receipt.</p>}
      <Link className={`mt-3 inline-block text-[12.5px] ${roseLink}`} to={RECONCILIATION_HREF}>Open the Reconciliation tab</Link>
    </section>
  );
}

function NoticeRefusals({ refusals, coverage }) {
  const sentences = new Map(list(refusals).map((r) => [r?.code, r?.message]));
  const ambiguous = coverage.filter((c) => !c.ok && c.code === 'ambiguous_account');
  return (
    <section className={cardCls} aria-label="What a notice refuses" data-testid="bank-accounts-refusals">
      <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">What a notice refuses</h3>
      <ul className="mt-3 space-y-2">
        {Object.entries(NOTICE_REFUSAL_LINES).map(([code, line]) => (
          <li key={code} data-testid="bank-accounts-refusal">
            <p className={`text-[12.5px] font-medium ${amber}`}>{line}</p>
            {typeof sentences.get(code) === 'string' && sentences.get(code) && (
              <p className={`text-[12px] ${muted}`}>{`A notice reads: ${sentences.get(code)}`}</p>
            )}
          </li>
        ))}
        {ambiguous.map((c) => (
          <li key={c.purpose} data-testid="bank-accounts-refusal">
            <p className={`text-[12.5px] font-medium ${amber}`}>{c.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const OTHER_BANK_FIELDS = [
  ['bank_name', 'Bank name'], ['bank_address', 'Bank address'], ['beneficiary_address', 'Beneficiary address'],
  ['routing_number', 'ABA routing number'], ['routing_number_alt', 'Alternate ABA (optional)'],
  ['swift_code', 'SWIFT (optional)'], ['intermediary_swift_code', 'Intermediary SWIFT (optional)'],
];

function AddAccountDialog({ fundHasAccount, onClose, onAdded }) {
  const [form, setForm] = useState(() => ({
    entity_key: fundHasAccount ? 'holdings' : 'fund', bank: 'mercury', account_kind: 'checking',
    account_number: '', account_number_confirm: '', purposes: [],
    bank_name: '', bank_address: '', beneficiary_address: '', routing_number: '', routing_number_alt: '', swift_code: '', intermediary_swift_code: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const pickEntity = (entity) => setForm((f) => ({
    ...f, entity_key: entity,
    purposes: f.purposes.filter((p) => PAYMENT_PURPOSE_OPTIONS.find((o) => o.value === p)?.payee === entity),
  }));

  const save = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const { label: _presetLabel, ...preset } = MERCURY_PRESET;
    const bank = form.bank === 'mercury' ? preset : Object.fromEntries(OTHER_BANK_FIELDS.map(([k]) => [k, form[k]]));
    const body = {
      entity_key: form.entity_key,
      label: form.account_kind === 'savings' ? 'Reserve' : 'Operating',
      beneficiary_name: AXAL_ENTITIES[form.entity_key]?.name || '',
      account_kind: form.account_kind,
      account_number: form.account_number,
      account_number_confirm: form.account_number_confirm,
      purposes: form.account_kind === 'checking' ? form.purposes : [],
      ...bank,
    };
    setBusy(true);
    setError(null);
    try {
      await bankAccountsApi.add(body);
      setBusy(false);
      await onAdded();
    } catch (err) {
      setError(errText(err, 'That did not save. Nothing changed.'));
      setBusy(false);
    }
  };

  return (
    <Lightbox label="Add account" title="Add account" width={560} onClose={onClose} testId="bank-accounts-add-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={btnCls} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryCls} onClick={save} disabled={busy}>Save account</button>
        </div>
      )}>
      <form onSubmit={save} className="space-y-3 px-5 py-4" data-testid="bank-accounts-add-form">
        <label className={fieldCls}>Beneficiary
          <select className={inputCls} value={form.entity_key} onChange={(e) => pickEntity(e.target.value)}>
            {ENTITY_ORDER.map((k) => <option key={k} value={k}>{AXAL_ENTITIES[k].name}</option>)}
          </select>
        </label>
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
          <select className={inputCls} value={form.account_kind}
            onChange={(e) => setForm((f) => ({ ...f, account_kind: e.target.value, purposes: e.target.value === 'checking' ? f.purposes : [] }))}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </select>
        </label>
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
        {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      </form>
    </Lightbox>
  );
}

function RevealDialog({ account: a, onClose, onReveal }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = reason.trim().length > 0 && !busy;
  const go = async (e) => {
    e?.preventDefault?.();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onReveal(reason.trim());
    } catch (err) {
      setError(errText(err, 'The number could not be shown.'));
      setBusy(false);
    }
  };
  return (
    <Lightbox label="Reveal the full number?" title="Reveal the full number?" width={460} onClose={onClose} testId="bank-accounts-reveal-dialog"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={btnCls} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryCls} onClick={go} disabled={!ready}>Reveal for 30 seconds</button>
        </div>
      )}>
      <form onSubmit={go} className="space-y-3 px-5 py-4" data-testid="bank-accounts-reveal-form">
        <p className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="bank-accounts-reveal-body">
          {`${a.entity_name} · ${a.label} ${String(a.account_kind || '').toLowerCase()} ${a.account_masked}. Your reason is written to the audit log.`}
        </p>
        <label className={fieldCls}>Reason
          <input className={inputCls} value={reason} maxLength={200} placeholder="Why you need the full number"
            onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      </form>
    </Lightbox>
  );
}

export default BankAccountsPanel;
