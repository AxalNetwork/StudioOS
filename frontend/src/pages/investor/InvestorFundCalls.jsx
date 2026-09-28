import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { WorkerRail, Unreadable } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { api } from '../../lib/api';
import './investorFundLanding.css';
import './investorFundCalls.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';
import { useManagedFund, FundPicker } from './managedFund';
import {
  formatCents, parseDollarsToCents, percent, lineStateLabel, lineAge, kycLabel, linesFor, wireRows,
} from './fundCallsModel';

/**
 * IF2 · Capital calls — the fund call ledger (D371, migration 312).
 *
 * This page used to be a static notice: "the current call records are not
 * linked to a specific VC fund register". That was false — every call line
 * joins its fund through `limited_partners.fund_id` — and it is now the
 * ledger it said it could not be:
 *
 *   · each call is numbered, with its purpose and due date, and its LP lines
 *     are the pro-rata split in whole cents, the rounding residual on one
 *     named line (`GET /api/funds/:id/capital-calls`);
 *   · New call previews that split before anything is written, then issues it
 *     (`POST …/capital-calls/preview`, `POST …/capital-call`);
 *   · Record receipt writes an append-only receipt against one LP's line, and
 *     the line is paid when its receipts reach what it owes;
 *   · the wire trail is those receipts, newest first, and Export wires writes
 *     them (`GET …/ledger`).
 *
 * The fund is one the caller operates (`useManagedFund`), never the first row
 * of a list that also carries funds they only invest in.
 */
const money = (cents) => formatCents(cents) ?? 'Not recorded';
const todayIso = () => new Date().toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** An export cell: the amount as a plain decimal (`1234.56`), so a spreadsheet reads a number. */
const exportAmount = (cents) => {
  const s = formatCents(cents);
  return s == null ? null : s.replace(/[$,]/g, '');
};

export default function InvestorFundCalls() {
  const managed = useManagedFund();
  const fund = managed.fund;
  const [filter, setFilter] = useState('latest');
  const [ledger, setLedger] = useState({ status: 'loading', data: null });
  const [wires, setWires] = useState({ status: 'loading', data: null });
  const [composer, setComposer] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const load = useCallback(async () => {
    if (!fund) return;
    setLedger({ status: 'loading', data: null });
    setWires({ status: 'loading', data: null });
    const [calls, trail] = await Promise.allSettled([api.fundsCallLedger(fund.id), api.fundsLedger(fund.id)]);
    setLedger(calls.status === 'fulfilled' && Array.isArray(calls.value?.calls)
      ? { status: 'ready', data: calls.value } : { status: 'unreadable', data: null });
    setWires(trail.status === 'fulfilled' && Array.isArray(trail.value?.entries)
      ? { status: 'ready', data: trail.value } : { status: 'unreadable', data: null });
  }, [fund]);
  useEffect(() => { load(); }, [load]);

  const data = ledger.status === 'ready' ? ledger.data : null;
  const summary = data?.summary || null;
  const latest = data?.calls?.[0] || null;
  const shown = useMemo(() => (data ? linesFor(filter, data) : []), [filter, data]);
  const receipts = useMemo(() => (wires.status === 'ready' ? wireRows(wires.data) : []), [wires]);
  const owingLines = data ? linesFor('outstanding', data).length : null;
  const collected = summary ? summary.received_cents + summary.paid_before_receipts_cents : null;

  const newCall = useMemo(() => (fund
    ? { onClick: () => setComposer({ amount: '', due: '', purpose: '', preview: null, error: '', busy: false }) }
    : { onClick: () => {}, disabled: true, title: 'There is no fund you operate to issue a call on.' }), [fund]);

  // ── New call: preview first, then issue exactly the amount previewed ────
  async function previewCall(e) {
    e.preventDefault();
    const cents = parseDollarsToCents(composer.amount);
    if (cents === null) {
      setComposer((c) => ({ ...c, error: 'Enter the call in dollars, above zero, with at most two decimals.', preview: null }));
      return;
    }
    setComposer((c) => ({ ...c, busy: true, error: '' }));
    try {
      const preview = await api.fundsCallPreview(fund.id, cents);
      setComposer((c) => ({ ...c, busy: false, preview: { ...preview, amount_cents: cents } }));
    } catch (err) {
      setComposer((c) => ({ ...c, busy: false, error: err?.message || 'The split could not be previewed.' }));
    }
  }
  async function issueCall() {
    const { preview, due, purpose } = composer;
    setComposer((c) => ({ ...c, busy: true, error: '' }));
    try {
      await api.fundsCapitalCallV2(fund.id, preview.amount_cents, purpose.trim() || undefined, due || null);
      setComposer(null);
      setFilter('latest');
      await load();
    } catch (err) {
      setComposer((c) => ({ ...c, busy: false, error: err?.message || 'The call could not be issued.' }));
    }
  }

  // ── Record receipt against one LP's line ────────────────────────────────
  function openReceipt(line) {
    setReceipt({
      lineId: line.id, lp: line.lp_name, outstanding: line.outstanding_cents,
      amount: exportAmount(line.outstanding_cents) ?? '', date: todayIso(), reference: '', error: '', busy: false,
    });
  }
  async function saveReceipt(e) {
    e.preventDefault();
    const cents = parseDollarsToCents(receipt.amount);
    if (cents === null) {
      setReceipt((r) => ({ ...r, error: 'Enter the amount received in dollars, above zero, with at most two decimals.' }));
      return;
    }
    setReceipt((r) => ({ ...r, busy: true, error: '' }));
    try {
      await api.fundsRecordReceipt(fund.id, receipt.lineId, {
        amount_cents: cents, received_on: receipt.date, reference: receipt.reference.trim() || undefined,
      });
      setReceipt(null);
      await load();
    } catch (err) {
      setReceipt((r) => ({ ...r, busy: false, error: err?.message || 'The receipt could not be recorded.' }));
    }
  }

  const refresh = () => (managed.error ? managed.reload() : load());
  const busy = managed.loading || (Boolean(fund) && ledger.status === 'loading');
  const calledNote = summary && (percent(summary.called_cents, summary.committed_cents)
    ? `${percent(summary.called_cents, summary.committed_cents)} of ${money(summary.committed_cents)} committed`
    : 'No commitment recorded to measure it against');
  const collectedNote = summary && [
    summary.called_cents > 0 ? `${percent(collected, summary.called_cents)} of called` : 'Nothing called yet',
    summary.paid_before_receipts_cents > 0 ? `${money(summary.paid_before_receipts_cents)} marked paid before receipts were recorded` : null,
  ].filter(Boolean).join(' · ');

  return <div className="i6-fund if2-shell"><main className="i6-main if2-main" data-testid="investor-fund-calls">
    <header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>Calls</b></div><h1>Capital calls</h1><p>Schedule builder, letters, wire tracking and delinquency.</p></div>
      <button className="i6-refresh" type="button" onClick={refresh} disabled={busy} aria-label="Refresh the call ledger"><RefreshCw size={14} className={busy ? 'i6-spin' : ''} /></button></header>
    <ZoneNav bucket={bucketForPath('investor', '/funds')} role="investor" activeSlug="calls" className="my-3" />
    <FundPicker funds={managed.funds} fund={fund} onSelect={managed.select} />
    <ZoneToolbar role="investor" className="mb-3"
      filters={investorZoneFilters('funds/calls', { value: filter, onChange: setFilter })}
      actions={investorZoneActions('funds/calls', {
        handlers: { newCall },
        view: {
          scope: fund?.name, zone: 'wires',
          header: ['Received on', 'LP', 'Call', 'Amount (USD)', 'Reference', 'Recorded by', 'Source'],
          rows: receipts,
          cells: (r) => [r.received_on, r.lp_name, r.call_number ?? 'Before numbering', exportAmount(r.amount_cents), r.reference, r.recorded_by_name, r.source],
        },
      })} />

    {managed.loading ? <div className="i6-skeleton" /> : managed.error ? (
      <div className="if2-unavailable" data-testid="status-fund-list-unreadable"><Unreadable what="The list of funds you operate" claim="This is not a claim that you run no fund." onRetry={managed.reload} /></div>
    ) : !fund ? (
      <section className="i6-card if2-none" data-testid="status-no-managed-fund"><h2>No fund to operate</h2>
        <p>You are not the general partner of record for any fund you can operate here, so there is no call ledger to open. Calls issued against your own LP commitments are in <Link to="/spinout-lab/investor-workspace#my-commitment">My commitment</Link>, on the LP workspace.</p></section>
    ) : <>
      {composer && <CallComposer composer={composer} setComposer={setComposer} onPreview={previewCall} onIssue={issueCall} />}
      {ledger.status === 'unreadable' && <div className="if2-unavailable" data-testid="status-call-ledger-unreadable"><Unreadable what="This fund's call ledger" claim="This is not a claim that the fund has no calls." onRetry={load} /></div>}
      <section className="if2-stats">
        <Stat label="Called to date" value={summary ? money(summary.called_cents) : null} note={calledNote} />
        <Stat label="Collected" value={summary ? money(collected) : null} note={collectedNote} />
        <Stat label="Outstanding" value={summary ? money(summary.outstanding_cents) : null}
          note={summary ? `across ${plural(owingLines, 'LP line')}` : null} />
        <Stat label="Current call" value={latest ? money(latest.amount_cents) : summary ? 'None issued' : null}
          note={latest ? `Call ${latest.call_number}${latest.due_date ? ` · due ${latest.due_date}` : ' · no due date recorded'}` : summary ? 'No numbered call yet' : null} />
      </section>

      {data && <section className="i6-card if2-ledger" data-testid="card-call-ledger">
        <header><div><h2>{filter === 'latest' ? (latest ? `Call ${latest.call_number} · pro-rata and receipts` : 'No numbered call yet') : filter === 'all' ? 'All calls · every LP line' : 'Outstanding · every line still owed'}</h2>
          <span>{filter === 'latest' && latest ? residualSentence(latest) : 'Owed is each LP’s share by commitment, in whole cents, never typed by hand.'}</span></div>
          <span>{plural(shown.length, 'line')}</span></header>
        {filter === 'latest' && latest && <p className="if2-purpose">{latest.purpose ? `Purpose: ${latest.purpose}` : 'No purpose recorded'}{latest.issued_by_name ? ` · issued by ${latest.issued_by_name}` : ''} · {String(latest.created_at).slice(0, 10)}</p>}
        {shown.length === 0 ? <div className="i6-empty if2-empty"><div><strong>{filter === 'outstanding' ? 'Nothing is outstanding.' : 'No numbered call has been issued on this fund.'}</strong><p>{filter === 'outstanding' ? 'Every line issued on this fund is paid.' : 'New call previews the split before anything is written.'}</p></div></div>
          : <LineTable lines={shown} showCall={filter !== 'latest'} receipt={receipt} setReceipt={setReceipt} onOpen={openReceipt} onSave={saveReceipt} />}
      </section>}

      {data?.unnumbered?.length > 0 && <section className="i6-card if2-ledger if2-legacy" data-testid="card-unnumbered-lines">
        <header><div><h2>Issued before calls were numbered</h2><span>Lines written before the call ledger. Their amounts were stored in dollars and are shown rounded to the cent; a line marked paid then has no receipt behind it.</span></div><span>{plural(data.unnumbered.length, 'line')}</span></header>
        <LineTable lines={data.unnumbered} showCall={false} receipt={receipt} setReceipt={setReceipt} onOpen={openReceipt} onSave={saveReceipt} />
      </section>}
      {data?.truncated && <p className="i6-footnote">This fund has more calls or lines than one read returns; the oldest are not shown, and the totals above cover only what was read.</p>}

      <section className="i6-card if2-ledger if2-wires" data-testid="card-wire-trail">
        <header><div><h2>Wire trail</h2><span>Every receipt recorded on this fund, newest first. Receipts are append-only: a mistake is answered by the next receipt, never by editing this one.</span></div><span>{wires.status === 'ready' ? plural(receipts.length, 'receipt') : ''}</span></header>
        {wires.status === 'loading' ? <div className="i6-skeleton" /> : wires.status === 'unreadable'
          ? <Unreadable what="The wire trail" claim="This is not a claim that no money has arrived." onRetry={load} />
          : receipts.length === 0 ? <div className="i6-empty">No receipt has been recorded on this fund.</div>
            : <div className="if2-table-wrap"><table><thead><tr><th>Received</th><th>LP</th><th>Call</th><th className="right">Amount</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>
              {receipts.map((r) => <tr key={r.id} data-testid={`row-receipt-${r.id}`}><td>{r.received_on}</td><td>{r.lp_name || `LP #${r.limited_partner_id}`}</td><td>{r.call_number != null ? `Call ${r.call_number}` : 'Before numbering'}</td><td className="right">{money(r.amount_cents)}</td><td>{r.reference || 'No reference recorded'}</td><td>{r.recorded_by_name || 'Not recorded'}{r.source === 'mark_paid' ? ' · marked paid' : ''}</td></tr>)}
            </tbody></table></div>}
      </section>
    </>}
    <footer className="i6-footnote">New call and Record receipt write to the fund’s ledger. Nothing on this page drafts a letter, sends a reminder or exports anything but the receipts it shows.</footer>
  </main><WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance={'Capital-call ledger'}
    note={'Each LP owes its share of a call by commitment, in whole cents; the residual sits on one named line. A line is paid when the receipts the GP records reach what it owes.'}
    coverage={[
      data ? `${plural(data.calls.length, 'numbered call')} and ${plural(data.unnumbered.length, 'earlier line')} readable` : 'Call ledger not read',
      wires.status === 'ready' ? `${plural(receipts.length, 'receipt')} on the wire trail` : 'Wire trail not read',
    ]}
    coverageNote={'Every figure here is summed from call lines and receipts the worker returned; none is typed.'}
    unavailable={[
      ['Reminder letters', 'Eadwyn drafts no reminder for this page yet, and nothing here sends one. Overdue lines are listed so a GP can follow up.'],
      ['Notice delivery', 'Each LP with a platform account gets an in-app notice when a call is issued; no letter is sent and no delivery is tracked.'],
    ]}
  /></div>;
}

function residualSentence(call) {
  const base = 'Each line is the LP’s share by commitment, in whole cents.';
  if (!call.residual_cents) return `${base} The split came out exact.`;
  const who = call.residual_lp_name ? `${call.residual_lp_name}’s line` : 'one named line';
  return `${base} The ${call.residual_cents}-cent residual sits on ${who}.`;
}

function LineTable({ lines, showCall, receipt, setReceipt, onOpen, onSave }) {
  return <div className="if2-table-wrap"><table><thead><tr>
    {showCall && <th>Call</th>}<th>LP</th><th className="right">Commitment</th><th className="right">Owed</th><th className="right">Received</th><th>State</th><th>Age</th><th />
  </tr></thead><tbody>
    {lines.map((line) => [
      <tr key={line.id} data-testid={`row-call-line-${line.id}`}>
        {showCall && <td>{line.call_number != null ? `Call ${line.call_number}` : 'Before numbering'}</td>}
        <td><strong>{line.lp_name || line.lp_email || `LP #${line.limited_partner_id}`}</strong><small>{kycLabel(line)}</small></td>
        <td className="right">{money(line.commitment_cents)}</td>
        <td className="right">{money(line.owed_cents)}</td>
        <td className="right">{money(line.received_cents)}</td>
        <td><span className={`if2-pill ${line.state}`}>{lineStateLabel(line)}</span></td>
        <td>{lineAge(line)}</td>
        <td>{line.state !== 'paid' && <button type="button" className="if2-row-action" data-testid={`button-record-receipt-${line.id}`} onClick={() => onOpen(line)}>Record receipt</button>}</td>
      </tr>,
      receipt?.lineId === line.id && <tr key={`${line.id}-receipt`} className="if2-receipt-row"><td colSpan={showCall ? 8 : 7}>
        <form className="if2-receipt" onSubmit={onSave} data-testid="form-record-receipt">
          <span>Receipt from {receipt.lp || 'this LP'} · {money(receipt.outstanding)} outstanding</span>
          <label>Amount (USD)<input data-testid="input-receipt-amount" inputMode="decimal" value={receipt.amount} onChange={(e) => setReceipt((r) => ({ ...r, amount: e.target.value }))} /></label>
          <label>Received on<input data-testid="input-receipt-date" type="date" value={receipt.date} max={todayIso()} onChange={(e) => setReceipt((r) => ({ ...r, date: e.target.value }))} /></label>
          <label>Wire reference<input data-testid="input-receipt-reference" value={receipt.reference} maxLength={120} onChange={(e) => setReceipt((r) => ({ ...r, reference: e.target.value }))} placeholder="Optional" /></label>
          <button type="submit" data-testid="button-save-receipt" disabled={receipt.busy}>{receipt.busy ? 'Recording…' : 'Record receipt'}</button>
          <button type="button" onClick={() => setReceipt(null)}>Cancel</button>
          <p role={receipt.error ? 'alert' : undefined}>{receipt.error || 'A receipt cannot be edited or deleted once recorded. The line is paid when its receipts reach what it owes.'}</p>
        </form>
      </td></tr>,
    ])}
  </tbody></table></div>;
}

function CallComposer({ composer, setComposer, onPreview, onIssue }) {
  const { preview } = composer;
  // Changing the amount drops the preview, so Issue can only send the amount
  // whose split is on screen.
  const set = (key) => (e) => setComposer((c) => ({ ...c, [key]: e.target.value, ...(key === 'amount' ? { preview: null } : {}) }));
  return <section className="i6-card if2-composer" data-testid="form-new-call">
    <header><div><h2>New call</h2><span>Preview the split, then issue it. Nothing is written until you issue.</span></div></header>
    <form onSubmit={onPreview} className="if2-composer-fields">
      <label>Amount (USD)<input data-testid="input-call-amount" inputMode="decimal" value={composer.amount} onChange={set('amount')} required /></label>
      <label>Due date<input data-testid="input-call-due" type="date" value={composer.due} onChange={set('due')} /></label>
      <label>Purpose<input data-testid="input-call-purpose" value={composer.purpose} maxLength={500} onChange={set('purpose')} placeholder="Optional" /></label>
      <button type="submit" data-testid="button-preview-call" disabled={composer.busy}>{composer.busy && !preview ? 'Previewing…' : 'Preview split'}</button>
      <button type="button" onClick={() => setComposer(null)}>Cancel</button>
    </form>
    {!composer.due && <p className="if2-note">No due date is set. The call will say “no due date recorded” — a deadline is never filled in for you.</p>}
    {composer.error && <p className="if2-error" role="alert">{composer.error}</p>}
    {preview && <div className="if2-preview" data-testid="panel-call-preview">
      {preview.lines.length === 0 ? <p>This fund has no committed or active LP with a commitment, so a call would bill nobody.</p> : <>
        <p>Call {preview.next_call_number}: {money(preview.amount_cents)} across {plural(preview.lines.length, 'LP')}.
          {preview.residual_cents > 0 ? ` The ${preview.residual_cents}-cent rounding residual goes to the largest commitment.` : ' The split is exact.'}</p>
        <div className="if2-table-wrap"><table><thead><tr><th>LP</th><th className="right">Commitment</th><th className="right">Share</th><th>KYC</th></tr></thead><tbody>
          {preview.lines.map((l) => <tr key={l.lp_id}><td>{l.name || l.email || `LP #${l.lp_id}`}{l.residual ? ' · carries the residual' : ''}</td><td className="right">{money(l.commitment_cents)}</td><td className="right">{money(l.share_cents)}</td><td>{kycLabel(l)}</td></tr>)}
        </tbody></table></div>
        {preview.excluded.length > 0 && <p className="if2-note">Not billed, for want of a recorded commitment: {preview.excluded.map((x) => x.name || x.email || `LP #${x.lp_id}`).join(', ')}.</p>}
        <button type="button" className="if2-issue" data-testid="button-issue-call" disabled={composer.busy} onClick={onIssue}>
          {composer.busy ? 'Issuing…' : `Issue call ${preview.next_call_number} to ${plural(preview.lines.length, 'LP')}`}
        </button>
      </>}
    </div>}
  </section>;
}

function Stat({ label, value, note }) {
  return <article className="if2-stat"><span>{label}</span><b>{value ?? 'Unavailable'}</b><small>{note ?? 'The call ledger was not read'}</small></article>;
}
