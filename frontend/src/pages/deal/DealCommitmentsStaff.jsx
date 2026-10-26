/**
 * D1155 (#3060) — the Commitment tab for everyone but an investor: the
 * founder's (DL16), an Admin's (DL17a) and an Operating Partner's (DL17b).
 *
 * One read, `GET /api/deals/:id/commitments`, which the Worker shapes per
 * DL15: every row by name, amount and status, and never an investor's note.
 * The founder matches a commitment to their own Mercury (D752's
 * `MercuryMatch`); an Admin records a wire (D1215: an Admin's act), behind an
 * in-page dialog that first reads whether an open IC condition holds wires;
 * an Operating Partner reads only. An Admin on HQ also reads each row's shared
 * proof of funds (D752), from its own audited route.
 */
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { adminCapitalAttestationsApi } from '../../lib/api/adminCapitalAttestations';
import { dealStaffApi } from '../../lib/api/dealStaff.js';
import { reportError } from '../../lib/log';
import { Lightbox, Unreadable, Unrecorded, actionGhost, actionPrimary } from '../../ui';
import { dealMoney } from '../../components/deals/dealMoney';
import { transferRefusal } from '../../components/deals/dealRoomCopy';
import { Refusal } from '../../components/deals/DealRoomKit';
import MercuryMatch from '../../components/MercuryMatch';
import { ProofStatement } from '../../components/ProofOfFunds';
import { FOOT, SORTS, STATUS_FILTERS, gateLine, heading, rowAction, statusWord, tableRows, wireCents } from './dealAudienceModel';

const BOX = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const FIELD = 'rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SMALL = 'rounded-md border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800';
const MUTED = 'text-axal-muted dark:text-gray-400';
const DAY = (v) => { const d = v ? new Date(`${String(v).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'}`) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null; };

/** DL17a — Record a wire, for an Admin, behind the IC gate. Nothing moves money: it records that money arrived. */
export function RecordWireDialog({ dealId, row, currency = 'USD', onClose, onRecorded }) {
  const [gate, setGate] = useState({ status: 'loading' });
  const [amount, setAmount] = useState(() => { const c = wireCents(row); return c == null ? '' : (c / 100).toFixed(2); });
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    dealStaffApi.transferGate(dealId)
      .then((data) => { if (live) setGate({ status: 'ready', data }); })
      .catch((e) => { reportError('DealCommitmentsStaff:gate', e); if (live) setGate({ status: 'failed' }); });
    return () => { live = false; };
  }, [dealId]);
  const g = gateLine(gate);
  const cents = Math.round(Number(String(amount).replace(/,/g, '')) * 100);
  const ready = g.held !== true && Number.isInteger(cents) && cents > 0 && !busy;
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal(null);
    try {
      await api.dealTransferRecord(dealId, { amount_cents: cents, reference: reference.trim() || null, phone_verified: verified, note: note.trim() || null });
      onRecorded();
    } catch (e) {
      reportError('DealCommitmentsStaff:wire', e);
      setRefusal(transferRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label="Record a wire" title="Record a wire" onClose={() => { if (!lock.current) onClose(); }} width={520} testId="deal-wire"
      footer={(
        <div className="flex flex-col gap-2">
          {refusal && <Refusal refusal={refusal} tone={refusal.code === 'open_conditions_block_transfer' ? 'warn' : 'bad'} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={go} disabled={!ready} data-testid="deal-wire-go">{busy ? 'Recording…' : 'Record the wire'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        {g.text && (
          <p className={`m-0 rounded-lg border p-2.5 text-[12.5px] ${g.held ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200' : `border-axal-hairline ${MUTED} dark:border-gray-700`}`} role={g.held ? 'alert' : undefined} data-testid="deal-wire-gate">{g.text}</p>
        )}
        <p className={`m-0 ${MUTED}`}>For {row.investor_name || 'this investor'}’s commitment of {dealMoney(row.amount, currency) || 'an amount not recorded'}. This records that money arrived; the platform never moves money.</p>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold uppercase text-axal-muted dark:text-gray-400">Amount · {currency}</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={FIELD} data-testid="deal-wire-amount" />
        </label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold uppercase text-axal-muted dark:text-gray-400">Reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={FIELD} data-testid="deal-wire-reference" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="deal-wire-phone" />
          <span>Called back on the number on file</span>
        </label>
        <p className={`m-0 text-[12px] ${MUTED}`}>Confirm the sender by phone before you record it. The firm is the one chosen in the company switcher. Recorded under your name.</p>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold uppercase text-axal-muted dark:text-gray-400">Note · optional</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={FIELD} />
        </label>
        {g.held && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="deal-wire-held">Recording opens once the IC condition is met.</p>}
      </div>
    </Lightbox>
  );
}

/** The confirmed total, for a reader the Worker gives the total only. */
export function CommitmentTotal({ total, currency = 'USD' }) {
  return <p className="m-0 text-[13px] text-gray-700 dark:text-gray-300" data-testid="commitments-total">Total committed: {dealMoney(total, currency) || <Unrecorded reason="The read carried no total." />}</p>;
}

export default function DealCommitmentsStaff({ dealId, currency = 'USD', viewer, proof = false }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('amount');
  const [page, setPage] = useState(1);
  const [wire, setWire] = useState(null);
  const [proofs, setProofs] = useState(null);
  const load = () => {
    setRead({ status: 'loading' });
    api.dealCommitments(dealId)
      .then((d) => setRead({ status: 'ready', items: Array.isArray(d) ? d : null, total: Array.isArray(d) ? null : d?.total ?? null }))
      .catch((e) => { reportError('DealCommitmentsStaff:read', e); setRead({ status: 'failed' }); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const loaded = read.status === 'ready' && Array.isArray(read.items);
  useEffect(() => {
    if (!proof || !loaded) return undefined;
    let alive = true;
    adminCapitalAttestationsApi.forDeal(dealId)
      .then((r) => { if (alive) setProofs({ byTarget: Object.fromEntries((r?.items || []).map((i) => [i.target_id, i])) }); })
      .catch((e) => { reportError('proof-of-funds:deal', e); if (alive) setProofs({ error: e }); });
    return () => { alive = false; };
  }, [proof, loaded, dealId]);

  if (read.status === 'failed') return <section className={BOX} data-testid="deal-commitments"><Unreadable what="The commitments" claim="That is not a claim that none is recorded." onRetry={load} /></section>;
  if (read.status === 'loading') return <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" data-testid="deal-commitments-loading" />;
  if (!read.items) {
    // A reader the Worker gives the confirmed total only.
    return (
      <section className={BOX} data-testid="deal-commitments">
        <CommitmentTotal total={read.total} currency={currency} />
      </section>
    );
  }
  const t = tableRows(read.items, { q, status, sort, page });
  return (
    <section className={BOX} data-testid="deal-commitments">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 mr-auto text-[15px] font-bold" data-testid="deal-commitments-heading">{heading(read.items, currency)}</h2>
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search investors" aria-label="Search investors" className={FIELD} data-testid="deal-commitments-search" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className={FIELD} data-testid="deal-commitments-status">
          {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className={FIELD} data-testid="deal-commitments-sort">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      {proof && proofs?.error && (
        <div data-testid="deal-proofs-failed">
          {proofs.error?.status
            ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{proofs.error.message || 'The proofs of funds could not be read.'}</p>
            : <Unreadable what="The proofs of funds" claim="This is not a claim that none was shared." />}
        </div>
      )}
      {read.items.length === 0 ? (
        <p className="m-0 text-[13px]" data-testid="deal-commitments-empty">No commitment is recorded on this deal yet.</p>
      ) : t.total === 0 ? (
        <p className="m-0 text-[13px]" data-testid="deal-commitments-none">No commitment matches. <button type="button" className="font-semibold underline hover:text-gray-900 dark:hover:text-gray-100" onClick={() => { setQ(''); setStatus(''); }}>Clear</button></p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead><tr className={`text-[11px] uppercase ${MUTED}`}><th className="py-1.5 pr-3">Investor</th><th className="pr-3">Amount</th><th className="pr-3">Status</th><th className="pr-3">Recorded</th><th /></tr></thead>
            <tbody>
              {t.rows.map((c) => {
                const act = rowAction(viewer, c);
                return (
                  <tr key={c.id} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid="deal-commitment-row">
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{c.investor_name || <Unrecorded reason="The account has no name." />}</div>
                      {proof && proofs?.byTarget && (
                        <div className="mt-1" data-testid={`deal-proof-${c.id}`}>
                          {proofs.byTarget[c.id] ? <ProofStatement item={proofs.byTarget[c.id]} figureDollars={c.amount} /> : <span className={`text-xs ${MUTED}`}>No proof of funds shared</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{dealMoney(c.amount, currency) || <Unrecorded reason="No amount was recorded on this commitment." />}</td>
                    <td className="py-2 pr-3" data-testid={`deal-commitment-status-${c.id}`}>{statusWord(c.status)}</td>
                    <td className="py-2 pr-3">{DAY(c.created_at) || <Unrecorded reason="No date was recorded." />}</td>
                    <td className="py-2 text-right">
                      {act === 'match' && <MercuryMatch target="commitment" targetId={c.id} matched={c.status === 'confirmed' ? {} : null} onChanged={load} />}
                      {act === 'wire' && <button type="button" className={SMALL} onClick={() => setWire(c)} data-testid={`deal-wire-open-${c.id}`}>Record a wire</button>}
                      {!act && <span className={MUTED}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {t.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12.5px]">
          <span className={MUTED} data-testid="deal-commitments-range">{t.range}</span>
          <button type="button" className={SMALL} disabled={t.page <= 1} onClick={() => setPage(t.page - 1)} aria-label="Previous page">‹</button>
          <button type="button" className={SMALL} disabled={t.page >= t.pages} onClick={() => setPage(t.page + 1)} aria-label="Next page">›</button>
        </div>
      )}
      {FOOT[viewer] && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="deal-commitments-foot">{FOOT[viewer]}</p>}
      {wire && <RecordWireDialog dealId={dealId} row={wire} currency={currency} onClose={() => setWire(null)} onRecorded={() => { setWire(null); load(); }} />}
    </section>
  );
}
