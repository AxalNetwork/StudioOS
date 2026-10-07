import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { memberCreditsApi } from '../../lib/api/memberCredits.js';
import { reportError } from '../../lib/log';
import { Card, Unrecorded } from '../../ui';
import {
  NOTE_MAX, PERIODS, REASON_MIN, SOURCES, changeText, filterLedger, newSourceRef, pageOf, sourceOf, submitAdjust,
} from '../../lib/memberCredits';

/**
 * D633 (#1391, Q2) — HQ · Team → one member's credits, the Ops canvas's
 * `hq-credits` (design/canvases/integrated/ops-data.js).
 *
 * WHERE IT LIVES. The canvas labels it `/admin/team/[member]/credits`, but in
 * this app `/admin/team` is the public team page editor and HQ's Team row is
 * `/admin/accounts`. So it lives at `/admin/accounts/credits/:userId`, reached
 * from the member's drawer in the Team directory, Super Admin only (D633).
 *
 * WHAT IT DRAWS:
 *   - the balance, read from the ledger (1 credit = US$1 of perk value);
 *   - the ledger as a registry: date, change, source and note, with search,
 *     a source filter, a period filter, a count and pages of 25. A line with
 *     no note reads "Not recorded" with why;
 *   - "Adjust credits": an amount up or down, a reason of at least ten
 *     characters kept in the audit log, and a note the member sees. It goes
 *     through D608's grant service. A fresh source reference is drawn each
 *     time the form opens, so the same submission sent twice is refused as a
 *     duplicate rather than paid twice;
 *   - the refusals, each a titled sentence: the balance would go below zero,
 *     an unknown member, the same change sent twice.
 * A ledger that cannot be read says "Unreadable" with Try again; it is never
 * drawn as a zero balance or an empty list.
 */

const field = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';
const ghost = 'rounded-lg border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800';
const primary = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50';

export function AdjustForm({ userId, onDone, onCancel, adjust = memberCreditsApi.adjust, sourceRef }) {
  const [ref] = useState(() => sourceRef || newSourceRef());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const ready = reason.trim().length >= REASON_MIN && amount.trim() !== '';
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setRefusal(null);
    const out = await submitAdjust({ userId, amount, reason, note, sourceRef: ref }, adjust);
    setBusy(false);
    if (out.ok) { onDone(out.result); return; }
    if (out.cause) reportError('MemberCredits:adjust', out.cause);
    setRefusal(out.refusal);
  };
  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900" data-testid="adjust-form">
      <p className="text-[12.5px] font-bold">Adjust credits</p>
      <label className="mt-2 block text-[12px] font-semibold">Amount
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="+10 · or −10" className={`mt-1 block w-40 ${field}`} data-testid="adjust-amount" />
      </label>
      <label className="mt-2 block text-[12px] font-semibold">Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={`At least ${REASON_MIN} characters · kept in the audit log`} className={`mt-1 block w-full ${field}`} />
      </label>
      <p className="mt-1 text-[11px] text-axal-muted">{reason.trim().length >= REASON_MIN ? 'Kept in the audit log with your name.' : `At least ${REASON_MIN} characters (${reason.trim().length} so far).`}</p>
      <label className="mt-2 block text-[12px] font-semibold">Note to the member
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} placeholder="What they see on their balance" className={`mt-1 block w-full ${field}`} />
      </label>
      {refusal ? (
        <div role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[12px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="adjust-refusal">
          <strong>{refusal.title}.</strong> {refusal.text}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button type="submit" className={primary} disabled={!ready || busy}>{busy ? 'Saving…' : 'Record adjustment'}</button>
        <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function LedgerTable({ read, onRetry }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [period, setPeriod] = useState('all');
  const [page, setPage] = useState(1);
  let body = null;
  if (read.status === 'loading') body = <p role="status" className="py-6 text-[12.5px] text-axal-muted">Loading the ledger…</p>;
  else if (read.status === 'unreadable') {
    body = (
      <p role="alert" className="flex flex-wrap items-center gap-2 py-6 text-[12.5px] text-red-700 dark:text-red-300" data-testid="ledger-unreadable">
        <span><strong>Unreadable.</strong> The ledger could not be read just now.</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={11} aria-hidden="true" /> Try again</button>
      </p>
    );
  }
  const all = read.status === 'ready' ? read.data?.ledger || [] : [];
  const at = pageOf(filterLedger(all, { q, source, period }), page);
  if (!body && all.length === 0) body = <p className="py-6 text-[12.5px] text-axal-muted" data-testid="ledger-empty">No credit has been granted or spent yet.</p>;
  else if (!body && at.total === 0) {
    body = <p className="py-6 text-[12.5px] text-axal-muted" data-testid="ledger-empty">No line matches these filters. <button type="button" className="font-semibold underline" onClick={() => { setQ(''); setSource('all'); setPeriod('all'); }}>Clear filters</button></p>;
  }
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };
  return (
    <Card className="p-4" data-testid="member-ledger">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={reset(setQ)} placeholder="Search the ledger…" aria-label="Search the ledger" className={field} />
        <select value={source} onChange={reset(setSource)} aria-label="Source" className={field}>{SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select value={period} onChange={reset(setPeriod)} aria-label="Period" className={field}>{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <span className="ml-auto font-mono text-[12px] text-axal-muted" data-testid="ledger-count">{read.status === 'ready' ? at.count : ''}</span>
      </div>
      {body || (
        <>
          <table className="mt-3 w-full text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-axal-muted"><tr><th className="py-1">Date</th><th>Change</th><th>Source</th><th>Note</th></tr></thead>
            <tbody>
              {at.rows.map((l) => (
                <tr key={l.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`ledger-row-${l.id}`}>
                  <td className="py-2 font-mono text-[12px]">{String(l.created_at || '').slice(0, 10)}</td>
                  <td className={`font-mono ${Number(l.delta) > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{changeText(l.delta)}</td>
                  <td>{sourceOf(l).label}{l.revoked ? <span className="ml-1 text-[11px] text-axal-muted">(taken back)</span> : null}</td>
                  <td>{l.note ? l.note : <Unrecorded reason="This entry was recorded without a note to the member." />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {at.pages > 1 ? (
            <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
              <button type="button" className={ghost} disabled={at.page <= 1} onClick={() => setPage(at.page - 1)}>Previous</button>
              <span className="text-axal-muted">Page {at.page} of {at.pages}</span>
              <button type="button" className={ghost} disabled={at.page >= at.pages} onClick={() => setPage(at.page + 1)}>Next</button>
            </div>
          ) : null}
          {read.data?.truncated ? <p className="mt-2 text-[11.5px] text-axal-muted">The latest 500 lines are listed; the balance counts every line.</p> : null}
        </>
      )}
    </Card>
  );
}

/** The balance line: the read's number, or why there is none. Never a zero for a failed read. */
export function BalanceCard({ read }) {
  let v;
  if (read.status === 'loading') v = <span className="text-axal-muted">…</span>;
  else if (read.status === 'ready') v = <><span className="text-2xl font-extrabold">{Number(read.data?.balance ?? 0).toLocaleString('en-US')}</span> <span className="text-[12.5px] text-axal-muted">credits · US${Number(read.data?.balance ?? 0).toLocaleString('en-US')} of perk value</span></>;
  else v = <span className="text-[12.5px] text-red-700 dark:text-red-300">Unreadable</span>;
  return <Card className="p-4" data-testid="member-balance"><p className="text-[11px] font-bold uppercase tracking-wide text-axal-muted">Balance</p><p className="mt-1">{v}</p></Card>;
}

export default function MemberCreditsPage() {
  const { userId } = useParams();
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [adjusting, setAdjusting] = useState(false);
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    memberCreditsApi.read(userId).then((data) => { if (live) setRead({ status: 'ready', data }); }, (e) => {
      reportError('MemberCredits:read', e);
      if (live) setRead({ status: e?.status === 404 ? 'not_found' : 'unreadable', data: null });
    });
    return () => { live = false; };
  }, [userId]);
  useEffect(() => load(), [load]);
  const name = read.data?.member?.name || read.data?.member?.email || (read.status === 'ready' ? `Account #${userId}` : 'Member');
  return (
    <div className="space-y-4" data-testid="member-credits-page">
      <header>
        <Link to="/admin/accounts" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:underline"><ArrowLeft size={12} aria-hidden="true" /> Team</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">{name} · credits</h1>
          {read.status === 'ready' && !adjusting ? <button type="button" className={primary} onClick={() => { setAdjusting(true); setNotice(null); }}>Adjust credits</button> : null}
        </div>
        <p className="mt-1 text-[13px] text-axal-muted">1 credit = US$1 of perk value. Every adjustment is kept in the audit log with its reason. What each reward pays is set on <Link to="/hq/credits" className="font-semibold underline">HQ · Credits</Link>.</p>
      </header>
      {read.status === 'not_found' ? (
        <Card className="p-4" data-testid="member-not-found"><p className="text-[12.5px]"><strong>Unknown member.</strong> No account matches this id. <Link to="/admin/accounts" className="font-semibold underline">Back to Team</Link></p></Card>
      ) : (
        <>
          <BalanceCard read={read} />
          {notice ? <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
          {adjusting ? (
            <AdjustForm userId={Number(userId)} onCancel={() => setAdjusting(false)}
              onDone={(res) => { setAdjusting(false); setNotice(`Recorded ${changeText(res?.delta)} credits. The balance is now ${res?.balance}.`); load(); }} />
          ) : null}
          <LedgerTable read={read} onRetry={load} />
        </>
      )}
    </div>
  );
}
