import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fundStructureApi } from '../../../lib/api/fundStructure';
import { useEscapeClose } from '../../../components/useEscapeClose';
import FundStructureMap from './FundStructureMap';
import { useRead, ReadState, button } from './parts';

/**
 * D717 (#1782) decision 11, #1855: the "Structure of the Fund" sheet, L10 of
 * the "Legal Documents · Templates" canvas. It opens on `?sheet=structure`,
 * reads `GET /api/admin/fund-structure` only once open, and draws three cards:
 * the map with its numbered flows, who signs for each entity, and the accounts.
 *
 * Who sees what is the Worker's answer: the Super Admin's model carries each
 * entity's accounts, masked to the last four; a plain Admin's carries none, and
 * every account cell reads the sentence below. Every string is drawn as text.
 */
export const ADMIN_WITHHELD = 'Only the Super Admin can see or change payment instructions.';
export const BANK_ACCOUNTS_HREF = '/admin/platform/bank-accounts';
const NOT_OPENED_YET = 'Not opened yet';
const NO_NOTICE_PURPOSE = 'No notice purpose';
const FOOTNOTE = 'A and B: the two platform licences. The Investment Management Agreement is a stub for counsel to confirm and receives no fee here.';
const ACCOUNTS_SUB = 'Masked to the last four. Reserve accounts never appear in payment instructions.';

const cardClass = 'rounded-xl border border-[#ececf1] bg-white px-5 py-[18px] dark:border-[#2a2733] dark:bg-[#18161f]';
const muted = 'text-[#615c6e] dark:text-[#a29db0]';
const headCell = 'text-[10px] font-bold uppercase tracking-[.06em] text-[#7d7889] dark:text-[#a29db0]';
const rowLine = 'border-t border-[#ececf1] py-2 dark:border-[#2a2733]';

/** A grid table that scrolls inside its card, never the page. */
function GridTable({ columns, head, rows, label }) {
  return <div className="overflow-x-auto">
    <div role="table" aria-label={label} className="min-w-[480px] text-[12px] leading-[1.45]">
      <div role="row" className={`grid gap-3 pb-2 ${columns}`}>{head.map((h) => <span key={h} role="columnheader" className={headCell}>{h}</span>)}</div>
      {rows.map((cells, i) => <div key={i} role="row" className={`grid gap-3 ${columns} ${rowLine}`}>
        {cells.map((c, j) => <span key={j} role="cell" className={j === 0 ? 'font-bold' : undefined}>{c}</span>)}
      </div>)}
    </div>
  </div>;
}

/** The Super Admin's way to the registry, which keeps its one home on the Bank accounts console. */
export function BankAccountsLink() {
  return <Link to={BANK_ACCOUNTS_HREF} className={`${button} inline-flex items-center`} data-testid="bank-accounts-link">Bank accounts</Link>;
}

/** "Structure of the Fund": sets `?sheet=structure` and keeps every other param. */
export function FundStructureButton() {
  const [params, setParams] = useSearchParams();
  return <button type="button" className={button} onClick={() => { const next = new URLSearchParams(params); next.set('sheet', 'structure'); setParams(next); }}>Structure of the Fund</button>;
}

function accountCell(list, kind) {
  const items = list.filter((a) => a.account_kind === kind);
  if (!items.length) return <span className={muted}>{NOT_OPENED_YET}</span>;
  return <span className="flex flex-col gap-1">{items.map((a, i) => <span key={i}>
    <span className="block font-mono">{a.account_masked}</span>
    <span className={`block text-[11px] ${muted}`}>{a.label}</span>
  </span>)}</span>;
}

function AccountsCard({ model }) {
  const superAdmin = model.audience === 'super_admin';
  const unreadable = superAdmin && model.accounts == null;
  return <section className={cardClass} aria-label="The accounts">
    <h3 className="text-[13px] font-extrabold">The accounts</h3>
    <p className={`mt-1 text-[11.5px] ${muted}`}>{ACCOUNTS_SUB}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {model.rails.map((r) => <p key={r.rail} className={`rounded-lg border px-3 py-2 text-[12px] ${r.rail === 'mercury'
        ? 'border-[#ddd0fb] bg-[#f4f0fe] dark:border-violet-900 dark:bg-violet-950/40'
        : 'border-[#ececf1] bg-white dark:border-[#2a2733] dark:bg-[#18161f]'}`}><b>{r.name}</b>{` · ${r.text}`}</p>)}
    </div>
    <div className="mt-3">
      {unreadable
        ? <p role="alert"><b>Unreadable.</b> The accounts could not be read.</p>
        : <GridTable label="The accounts" columns="grid-cols-[1.4fr_1.1fr_1.1fr_1.6fr]" head={['Entity', 'Operating', 'Reserve', 'Receives on paper']}
          rows={model.entities.map((e) => {
            const list = superAdmin ? (model.accounts.find((a) => a.key === e.key)?.accounts || []) : null;
            return [e.name,
              list ? accountCell(list, 'checking') : <span className={muted}>{ADMIN_WITHHELD}</span>,
              list ? accountCell(list, 'savings') : <span className={muted}>{ADMIN_WITHHELD}</span>,
              e.receives.length ? e.receives.join('; ') : <span className={muted}>{NO_NOTICE_PURPOSE}</span>];
          })} />}
    </div>
  </section>;
}

/** The three cards, drawn from one model. Exported for the static render in the tests. */
export function FundStructureBody({ model }) {
  const s = model.signing;
  return <div className="space-y-4">
    <section className={cardClass} aria-label="The map and the flows">
      <div className="grid gap-6 lg:grid-cols-[520px_1fr]">
        <FundStructureMap map={model.map} />
        <div>
          <GridTable label="The flows" columns="grid-cols-[30px_1.6fr_70px_1.3fr]" head={['No.', 'Flow', 'Rail', 'Receiving account']}
            rows={model.rows.map((r) => [String(r.no), r.label, r.rail === 'stripe' ? 'Stripe' : 'Mercury', r.receiving_text])} />
          <p className={`mt-3 text-[11.5px] ${muted}`}>{FOOTNOTE}</p>
        </div>
      </div>
    </section>
    <section className={cardClass} aria-label="Who signs, and where">
      <h3 className="text-[13px] font-extrabold">Who signs, and where</h3>
      <p className={`mt-1 text-[11.5px] ${muted}`}>{`All four at ${s.address} · legal notices to ${s.email}. ${s.routing}`}</p>
      <div className="mt-3">
        <GridTable label="Who signs, and where" columns="grid-cols-[1.1fr_1.6fr_1.8fr_1.4fr]" head={['Entity', 'Role', 'Signs', 'Signatory']}
          rows={model.entities.map((e) => [e.name, e.role, e.signs, [e.through, e.signatory, e.title].filter(Boolean).join(' · ')])} />
      </div>
    </section>
    <AccountsCard model={model} />
  </div>;
}

/** The sheet itself. Reads on mount, which happens only while `?sheet=structure`. */
export function FundStructureSheet({ onClose }) {
  useEscapeClose(onClose);
  const read = useRead(() => fundStructureApi.read(), []);
  const superAdmin = read.data?.audience === 'super_admin';
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 px-4 py-6" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="Structure of the Fund" data-testid="fund-structure-sheet"
      className="mx-auto w-full max-w-[1160px] rounded-xl bg-[#f7f6fa] p-4 text-[#18181b] shadow-xl dark:bg-[#121018] dark:text-[#f4f3f7] sm:p-5"
      onClick={(e) => e.stopPropagation()}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold">Structure of the Fund</h2>
        <div className="flex items-center gap-2">{superAdmin && <BankAccountsLink />}<button type="button" className={button} onClick={onClose}>Close</button></div>
      </header>
      <ReadState read={read} what="Structure of the Fund">{read.data && <FundStructureBody model={read.data} />}</ReadState>
    </section>
  </div>;
}

/** The button and, while `?sheet=structure`, the sheet. Close and Escape delete `sheet`. */
export function FundStructureDoor() {
  const [params, setParams] = useSearchParams();
  const close = () => { const next = new URLSearchParams(params); next.delete('sheet'); setParams(next); };
  return <>
    <FundStructureButton />
    {params.get('sheet') === 'structure' && <FundStructureSheet onClose={close} />}
  </>;
}
