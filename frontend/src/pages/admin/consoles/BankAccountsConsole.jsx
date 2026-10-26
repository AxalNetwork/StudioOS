import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { bankAccountsApi } from '../../../lib/api/bankAccounts';
import { adminMercuryApi } from '../../../lib/api/adminMercury';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat';
import { Pill, Unreadable } from '../../../ui';
import { entityRows } from '../fundAdmin/mercuryEntityModel';
import { agoLabel } from '../../account/connectorsModel';
import { MercuryEntitySheet } from '../fundAdmin/MercuryEntitySheet';
import { formatCents } from '../../investor/fundCallsModel.js';
import { FundStructureDoor } from '../contracts/FundStructureSheet';
import { ConsoleUnreadable } from './shared';
import {
  ENTITY_ORDER, NOT_IN_REGISTRY_SUB, PAYMENT_PURPOSE_OPTIONS, READING, BASE, accountPath, accountUidOf,
  balanceCell, cardLine, coverageRow, coverageSummary, dayOf, mercuryOnlyBalance, mercuryPill, notInRegistry,
  purposeLabel, shortName,
} from './bankAccountsModel';
import {
  AddAccountDialog, AddFromMercuryDialog, MERCURY_PRESET, PaymentsDialog, RelabelDialog, RetireDialog, RevealDialog,
  amber, btnCls, muted, primaryCls,
} from './BankAccountDialogs';
import { AccountLightbox, MissingAccount } from './BankAccountLightbox';

export { MERCURY_PRESET, PAYMENT_PURPOSE_OPTIONS };

/**
 * D708 (#1773) — Bank accounts: each Axal entity's accounts, which payments
 * each takes, and the resolver's answer per payment. D717 (#1782, #1856)
 * restyled it to the canvas's board L11. D1185 (#3114, part 4 of #2389)
 * draws it as the canvas "Bank Accounts" draws Accounts (BNK1, BNK7):
 *
 *   · "Where each payment goes" first: each purpose paid here or refused,
 *     with the sentence a notice prints, and why a notice refuses;
 *   · one card per entity, joined to its read-only Mercury (D1184): each
 *     account's ending, payments, balance and whether Mercury reads it, the
 *     retired ones folded, and the accounts Mercury reads that the registry
 *     does not hold ("Add it to the registry");
 *   · one account's lightbox at `/account/:uid` (BNK2);
 *   · every change in a dialog that says what it changes (BNK6,
 *     `BankAccountDialogs.jsx`), where D717 drew inline forms under Manage.
 *
 * Only the Super Admin sees it. Anyone else gets one sentence, no controls,
 * and no read is made. Lists are masked (`••••NNNN`). A reveal asks for a
 * reason, is recorded by the Worker before it decrypts, and the number shows
 * here for 30 seconds, held in component state only, never kept in the browser.
 *
 * Payment instructions never change in place: only the label and the payments
 * can be edited; to change anything else, retire the account and add another.
 * Writes need a fresh TOTP step-up, which `request()` asks for itself.
 *
 * Reads per open: the registry's `list`, the Mercury `connections()` and
 * `accounts()`, then one unmatched-credit read per connected entity. Mercury
 * is only read, through `/api/admin/mercury`; this page holds no token form.
 * The refusal sentences under "Why a notice refuses" are the Worker's
 * (`refusals`), never copied.
 */

export const BANK_ACCOUNTS_HOLDER_ONLY = 'Only the Super Admin can see or change payment instructions.';

/** How long a revealed number stays on screen. */
export const REVEAL_MS = 30_000;

// ── BNK1's words ──────────────────────────────────────────────────────────────

const AUDIT_LINE = 'Opening this page is recorded in the admin audit log: one read of the registry, one of the Mercury connections and accounts, and one of each connected entity\'s unmatched receipts.';
const FUND_MISSING = 'No account on file. Capital calls can’t issue until the Fund has one.';
const NO_ACCOUNT = 'No account on file.';
const RESERVE_WORDS = 'Reserve: never printed on a notice';
const NO_PURPOSE_WORDS = 'No notice purpose';
const RECONCILIATION_HREF = '/admin/fund-admin/banking/reconciliation';
const REVEAL_SHOWN = 'Shown for 30 seconds. It is not kept on this device.';

/** The canvas's four lines, keyed by the resolver's code, in the canvas's order (`NOTICE_REFUSALS`). */
export const NOTICE_REFUSAL_LINES = Object.freeze({
  no_active_account: 'No account for this purpose.',
  holder_not_payee: 'The account’s holder is not the payee.',
  savings_account: 'A reserve account can’t receive payments.',
  fund_account_missing: 'Axal VC Spin-Out Lab Fund I LP has no account.',
});

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

/** The Payments cell: the purpose labels, the reserve's words, or the no-purpose words. */
export function purposesText(account) {
  if (account?.account_kind === 'savings') return RESERVE_WORDS;
  const ps = Array.isArray(account?.purposes) ? account.purposes : [];
  return ps.length ? ps.map(purposeLabel).join(' · ') : NO_PURPOSE_WORDS;
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

const cardCls = 'rounded-xl border border-[#dcd9e3] bg-white p-4 dark:border-gray-800 dark:bg-gray-950';
const roseLink = 'font-bold text-rose-600 hover:underline dark:text-rose-300';
const violetLink = 'font-bold text-axal-violet hover:underline dark:text-violet-300';
const ACCOUNT_GRID = 'sm:grid-cols-[1.2fr_0.8fr_1.55fr_1.1fr_1.15fr_0.75fr_0.5fr]';
const RECEIPT_GRID = 'sm:grid-cols-[0.7fr_1.2fr_0.7fr_1.6fr_1fr]';

const entityName = (key) => AXAL_ENTITIES[key]?.name || key;
const list = (v) => (Array.isArray(v) ? v : []);
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;

export function BankAccountsPanel() {
  const holder = isSuperAdminUser(useAuth().user);
  if (!holder) {
    return <p className="p-6 text-sm text-gray-700 dark:text-gray-300" data-testid="bank-accounts-holder-only">{BANK_ACCOUNTS_HOLDER_ONLY}</p>;
  }
  return <BankAccountsRegistry />;
}

function BankAccountsRegistry() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const openUid = accountUidOf(pathname);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(null);
  // { kind: 'add' | 'mercury' | 'relabel' | 'payments' | 'retire' | 'reveal', account?, item?, entity? }
  const [dialog, setDialog] = useState(null);
  // { uid, number, reason, at }: state only, cleared after REVEAL_MS, on Hide now and on unmount.
  const [revealed, setRevealed] = useState(null);
  const timer = useRef(null);
  // { status: 'loading' | 'ready' | 'unreadable', rows }
  const [mercury, setMercury] = useState({ status: 'loading', rows: null });
  // { status: 'loading' | 'ready' | 'unreadable', items }: Mercury's stored accounts.
  const [held, setHeld] = useState({ status: 'loading', items: null });
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

  const loadHeld = useCallback(async () => {
    setHeld({ status: 'loading', items: null });
    try {
      const r = await adminMercuryApi.accounts();
      setHeld({ status: 'ready', items: list(r?.items) });
    } catch {
      setHeld({ status: 'unreadable', items: null });
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

  useEffect(() => { load(); loadMercury(); loadHeld(); }, [load, loadMercury, loadHeld]);
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

  /** A dialog's write went through: close it, say so, read the registry again. */
  const saved = async (msg) => {
    setDialog(null);
    setNotice({ kind: 'ok', msg });
    await load();
    if (msg.startsWith('Account added')) loadHeld();
  };

  /** Throws the Worker's refusal for the dialog to print. */
  const reveal = async (uid, reason) => {
    const r = await bankAccountsApi.reveal(uid, reason);
    if (timer.current) clearTimeout(timer.current);
    setRevealed({ uid, number: r?.account?.account_number || '', reason, at: hhmm(new Date()) });
    timer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
    setDialog(null);
  };
  const hide = () => { if (timer.current) clearTimeout(timer.current); setRevealed(null); };

  const closeSheet = () => { setSheetFor(null); loadMercury(); };
  const open = (kind, extra = {}) => { setNotice(null); setDialog({ kind, ...extra }); };

  if (failed) return <ConsoleUnreadable what="The bank accounts" onRetry={load} />;
  if (!data) return <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="bank-accounts-reading">{READING}</div>;

  const accounts = list(data.accounts);
  const coverage = list(data.coverage);
  const fundHasAccount = accounts.some((a) => a.entity_key === 'fund' && a.status === 'active');
  const rowFor = (key) => (mercury.status === 'ready' ? mercury.rows.find((r) => r.key === key) || null : null);
  const extras = held.status === 'ready' ? notInRegistry(accounts, held.items) : [];
  const lightboxAccount = openUid ? accounts.find((a) => a.uid === openUid) || null : null;
  const closeLightbox = () => navigate(BASE);
  const act = {
    open: (a) => navigate(accountPath(a.uid)),
    reveal: (a) => open('reveal', { account: a }),
    relabel: (a) => open('relabel', { account: a }),
    payments: (a) => open('payments', { account: a }),
    retire: (a) => open('retire', { account: a }),
  };

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-4 rounded-xl border border-[#dcd9e3] bg-[#f8f8fa] p-4 text-[#18181b] dark:border-gray-800 dark:bg-[#121018] dark:text-[#f4f3f7] sm:p-[22px]"
      data-testid="bank-accounts-console">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <FundStructureDoor />
        <button type="button" className={primaryCls} onClick={() => open('add')} data-testid="bank-accounts-add">Add an account</button>
      </div>

      {notice && (
        <p role={notice.kind === 'err' ? 'alert' : 'status'}
          className={`text-sm ${notice.kind === 'err' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {notice.msg}
        </p>
      )}

      <Coverage coverage={coverage} accounts={accounts} refusals={data.refusals} onAddFund={() => open('add', { entity: 'fund' })} />

      {mercury.status === 'unreadable' && (
        <div data-testid="bank-accounts-mercury-unreadable">
          <Unreadable what="The Mercury connections" claim="This is not a claim that none is connected." onRetry={loadMercury} />
        </div>
      )}
      {held.status === 'unreadable' && (
        <div data-testid="bank-accounts-held-unreadable">
          <Unreadable what="Mercury’s accounts" claim="Accounts Mercury reads that the registry does not hold are not listed until this reads." onRetry={loadHeld} />
        </div>
      )}

      {ENTITY_ORDER.map((key) => (
        <EntityCard key={key} entity={key} fundI={data.fund_i} fundHasAccount={fundHasAccount}
          accounts={accounts.filter((a) => a.entity_key === key)}
          coverage={coverage.filter((c) => c.payee === key)}
          extras={extras.filter((m) => m.entity_key === key)}
          mercury={mercury} row={rowFor(key)} onConnect={() => setSheetFor(key)}
          revealed={revealed} act={act}
          onAdd={() => open('add', { entity: key })} onAddFromMercury={(item) => open('mercury', { item })} />
      ))}

      <p className={`text-[11.5px] ${muted}`} data-testid="bank-accounts-audit-line">{AUDIT_LINE}</p>

      <UnmatchedReceipts mercury={mercury} unmatched={unmatched} />

      {openUid && (lightboxAccount
        ? <AccountLightbox account={lightboxAccount} onClose={closeLightbox}
          revealed={revealed?.uid === lightboxAccount.uid ? revealed : null} onHide={hide}
          onReveal={() => act.reveal(lightboxAccount)} onRelabel={() => act.relabel(lightboxAccount)}
          onPayments={() => act.payments(lightboxAccount)} onRetire={() => act.retire(lightboxAccount)} />
        : <MissingAccount onClose={closeLightbox} />)}

      {dialog?.kind === 'add' && <AddAccountDialog entity={dialog.entity} fundHasAccount={fundHasAccount} onClose={() => setDialog(null)} onAdded={saved} />}
      {dialog?.kind === 'mercury' && <AddFromMercuryDialog item={dialog.item} onClose={() => setDialog(null)} onAdded={saved} />}
      {dialog?.kind === 'relabel' && <RelabelDialog account={dialog.account} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'payments' && <PaymentsDialog account={dialog.account} accounts={accounts} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'retire' && <RetireDialog account={dialog.account} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'reveal' && <RevealDialog account={dialog.account} onClose={() => setDialog(null)} onReveal={(reason) => reveal(dialog.account.uid, reason)} />}
      {sheetFor && <MercuryEntitySheet superAdmin eyebrow="Bank accounts" api={adminMercuryApi} onClose={closeSheet} />}
    </div>
  );
}

/** BNK1 — "Where each payment goes": each purpose paid here or refused, and why a notice refuses. */
function Coverage({ coverage, accounts, refusals, onAddFund }) {
  const [why, setWhy] = useState(false);
  const summary = coverageSummary(coverage);
  const sentences = new Map(list(refusals).map((r) => [r?.code, r?.message]));
  const ambiguous = coverage.filter((c) => !c.ok && c.code === 'ambiguous_account');
  return (
    <section className={cardCls} aria-label="Where each payment goes" data-testid="bank-accounts-coverage-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Where each payment goes</h3>
        <span className={`font-mono text-[12px] ${muted}`} data-testid="bank-accounts-coverage-meta">{summary.meta}</span>
      </div>
      {summary.warning && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40"
          data-testid="bank-accounts-coverage-warning">
          <p className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">{summary.warning}</p>
          {summary.fundMissing && <button type="button" className={btnCls} onClick={onAddFund}>Add Fund I’s account</button>}
        </div>
      )}
      <ul className="mt-3 divide-y divide-[#ecebf0] dark:divide-gray-800">
        {coverage.map((c) => {
          const r = coverageRow(c, accounts);
          return (
            <li key={c.purpose} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid="bank-accounts-pay-row">
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-axal-ink dark:text-gray-100">{r.label}</span>
                {r.sub && <span className={`block text-[12px] ${muted}`}>{r.sub}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[12px]">{r.where}</span>
                <Pill tone={r.pill.tone}>{r.pill.text}</Pill>
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" className={`mt-2 text-[13px] ${violetLink}`} aria-expanded={why} onClick={() => setWhy((w) => !w)} data-testid="bank-accounts-why">
        {`${why ? '▾' : '▸'} Why a notice refuses`}
      </button>
      {!why && <p className={`text-[12px] ${muted}`}>Four reasons, each with the sentence a notice prints.</p>}
      {why && (
        <ul className="mt-2 space-y-2 pl-4" aria-label="What a notice refuses" data-testid="bank-accounts-refusals">
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
      )}
    </section>
  );
}

function ConnectionPill({ mercury, row, onConnect }) {
  const pill = mercury.status === 'ready' ? connectionPill(row) : mercury.status === 'unreadable' ? connectionPill(null) : null;
  if (!pill) return <span className={`text-[11px] ${muted}`}>Reading Mercury…</span>;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
      <Pill tone={pill.tone} className="max-w-full max-sm:whitespace-normal" data-testid="bank-accounts-connection">{pill.text}</Pill>
      {mercury.status === 'ready' && row && (
        <button type="button" className={btnCls} onClick={onConnect}>{row.connected ? 'Replace' : 'Connect'}</button>
      )}
    </div>
  );
}

function EntityCard({ entity, fundI, fundHasAccount, accounts, coverage, extras, mercury, row, onConnect, revealed, act, onAdd, onAddFromMercury }) {
  const [showRetired, setShowRetired] = useState(false);
  const name = entityName(entity);
  const fund = entity === 'fund';
  const live = accounts.filter((a) => a.status === 'active');
  const retired = accounts.filter((a) => a.status !== 'active');
  const shown = showRetired ? [...live, ...retired] : live;
  const line = mercury.status === 'ready' ? cardLine(row) : null;
  return (
    <section className={cardCls} aria-label={name} data-testid={`bank-accounts-entity-${entity}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">{shortName(entity)}</h3>
          <span className={`text-[12.5px] ${muted}`}>{name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionPill mercury={mercury} row={row} onConnect={onConnect} />
          <button type="button" className={btnCls} onClick={onAdd}>{`Add an account for ${shortName(entity)}`}</button>
        </div>
      </div>
      {line && <p className={`mt-1 text-[12.5px] ${muted}`} data-testid="bank-accounts-card-line">{line}</p>}

      {fund && (
        <p className="mt-2 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="bank-accounts-fund-i">
          {fundI
            ? `Fund I is ${fundI.name} (fund #${fundI.id}). Its capital calls are paid into the Fund's account below.`
            : 'No fund carries the spinout-fund-i slug, so no fund is paid into the Fund\'s account. Set the slug on Fund I\'s record.'}
        </p>
      )}

      {fund && !fundHasAccount && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[#fcd34d] bg-[#fffbeb] px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950/40"
          data-testid="bank-accounts-fund-missing">
          <p className="text-[12.5px] font-semibold text-[#92400e] dark:text-amber-200">{FUND_MISSING}</p>
          <button type="button" className={btnCls} onClick={onAdd}>Add Fund I’s account</button>
        </div>
      )}

      {(live.length > 0 || retired.length > 0 || extras.length > 0) && (
        <div className="mt-3 text-[12.5px]" role="table" aria-label={`${name} accounts`} data-testid="bank-accounts-table">
          <div role="row" className={`hidden gap-2 border-b border-[#dcd9e3] pb-1.5 text-[11px] font-bold uppercase tracking-[.06em] dark:border-gray-800 sm:grid ${ACCOUNT_GRID} ${muted}`}>
            {['Account', 'Ending', 'Payments', 'Balance', 'Mercury', 'State', ''].map((h, i) => <span key={i} role="columnheader">{h}</span>)}
          </div>
          {shown.map((a) => (
            <AccountRow key={a.uid} account={a} row={row} revealed={revealed?.uid === a.uid ? revealed.number : null} act={act} />
          ))}
          {retired.length > 0 && (
            <div className="border-b border-[#ecebf0] py-2 dark:border-gray-800" data-testid="bank-accounts-retired-toggle">
              <button type="button" className={`text-[12.5px] ${violetLink}`} aria-expanded={showRetired} onClick={() => setShowRetired((v) => !v)}>
                {`${showRetired ? 'Hide' : 'Show'} ${retired.length} retired ${retired.length === 1 ? 'account' : 'accounts'} ${showRetired ? '▴' : '▾'}`}
              </button>
              {!showRetired && (
                <p className={`text-[12px] ${muted}`}>
                  {retired.map((a) => `${a.label} ${a.account_masked} · retired ${dayOf(a.retired_at) || 'on a date not recorded'}${a.retired_reason ? ` · ‘${a.retired_reason}’` : ''}`).join(' · ')}
                </p>
              )}
            </div>
          )}
          {extras.map((m) => <MercuryOnlyRow key={m.uid} item={m} onAdd={() => onAddFromMercury(m)} />)}
        </div>
      )}
      {!fund && accounts.length === 0 && extras.length === 0 && <p className={`mt-3 text-[12.5px] ${muted}`}>{NO_ACCOUNT}</p>}

      {coverage.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12.5px]" data-testid="bank-accounts-coverage">
          {coverage.map((c) => (
            <li key={c.purpose} className={c.ok ? 'text-gray-700 dark:text-gray-300' : amber}>
              {c.ok ? `${c.label}: paid into ${c.account_masked}` : c.message}
            </li>
          ))}
        </ul>
      )}
      {coverage.length === 0 && !PAYMENT_PURPOSE_OPTIONS.some((o) => o.payee === entity) && (
        <p className={`mt-3 text-[12.5px] ${muted}`}>{`${shortName(entity)} takes no payment through the registry.`}</p>
      )}
    </section>
  );
}

function Cell({ cell, className = '' }) {
  return (
    <span role="cell" className={className} title={cell.tip}>
      <span className={cell.tone === 'figure' ? 'font-mono font-bold' : muted}>{cell.text}</span>
      {cell.sub && <span className={`block font-mono text-[11px] ${muted}`}>{cell.sub}</span>}
      {cell.tip && <span className="sr-only">{`: ${cell.tip}`}</span>}
    </span>
  );
}

function AccountRow({ account: a, row, revealed, act }) {
  const active = a.status === 'active';
  const [menu, setMenu] = useState(false);
  const pick = (fn) => () => { setMenu(false); fn(a); };
  const mer = mercuryPill(a, row);
  return (
    <div className="border-b border-[#ecebf0] py-2 last:border-b-0 dark:border-gray-800" data-testid="bank-account-row">
      <div role="row" className={`grid grid-cols-1 gap-1 sm:items-center sm:gap-2 ${ACCOUNT_GRID}`}>
        <span role="cell">
          <Link className="font-bold text-axal-ink hover:underline dark:text-gray-100" to={`/admin/platform/bank-accounts/account/${encodeURIComponent(a.uid)}`} data-testid="bank-account-open">{a.label}</Link>
          <span className={`block text-[11.5px] ${muted}`}>{a.account_kind === 'savings' ? 'Savings' : 'Checking'}</span>
        </span>
        <span role="cell" className="font-mono font-semibold">
          {revealed
            ? <span data-testid="bank-account-revealed">{revealed}</span>
            : <span aria-label={`ending ${String(a.account_last4 || String(a.account_masked || '').slice(-4)).split('').join(' ')}`}>{a.account_masked}</span>}
        </span>
        <span role="cell" className={a.account_kind === 'savings' || !a.purposes?.length ? muted : ''}>{purposesText(a)}</span>
        <Cell cell={balanceCell(a)} />
        <span role="cell"><Pill tone={mer.tone} data-testid="bank-account-mercury">{mer.text}</Pill></span>
        <span role="cell"><Pill tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Retired'}</Pill></span>
        <span role="cell" className="relative flex justify-end">
          <button type="button" className={btnCls} aria-haspopup="menu" aria-expanded={menu}
            aria-label={`Manage ${a.label} ${a.account_masked}`} onClick={() => setMenu((m) => !m)} data-testid="bank-account-menu">⋯</button>
        </span>
      </div>
      {!active && a.retired_reason && <p className={`mt-1 text-xs ${muted}`}>Retired: {a.retired_reason}</p>}
      {revealed && <p className={`mt-1 text-xs ${amber}`}>{REVEAL_SHOWN}</p>}
      {menu && (
        <div role="menu" className="mt-2 flex flex-wrap gap-2" data-testid="bank-account-manage">
          <button type="button" role="menuitem" className={btnCls} onClick={pick(act.open)}>Open</button>
          {active && <button type="button" role="menuitem" className={btnCls} onClick={pick(act.relabel)}>Relabel</button>}
          {active && a.account_kind === 'checking' && <button type="button" role="menuitem" className={btnCls} onClick={pick(act.payments)}>Change payments</button>}
          {active && <button type="button" role="menuitem" className={btnCls} onClick={pick(act.reveal)}>Reveal</button>}
          {active && <button type="button" role="menuitem" className={btnCls} onClick={pick(act.retire)}>Retire</button>}
        </div>
      )}
    </div>
  );
}

/** An account Mercury reads that the registry does not hold: no notice prints it. */
function MercuryOnlyRow({ item, onAdd }) {
  const bal = mercuryOnlyBalance(item);
  return (
    <div className={`grid grid-cols-1 gap-1 border-t border-dashed border-gray-400 py-2 sm:items-center sm:gap-2 ${ACCOUNT_GRID}`} role="row"
      data-testid="bank-accounts-not-in-registry">
      <span role="cell" className="sm:col-span-3">
        <span className={`font-bold ${muted}`}>{`Mercury also reads ••••${item.last_four}${item.nickname ? ` ${item.nickname}` : ''}`}</span>
        <span className={`block text-[11.5px] ${muted}`}>{NOT_IN_REGISTRY_SUB}</span>
      </span>
      <Cell cell={bal} />
      <span role="cell"><Pill tone="warn">Not in the registry</Pill></span>
      <span role="cell" className="sm:col-span-2"><button type="button" className={btnCls} onClick={onAdd}>Add it to the registry</button></span>
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

export default BankAccountsPanel;
