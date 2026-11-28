import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { WorkerRail, Unreadable } from '../../ui';
import ZoneHeader from '../../workspaces/ZoneHeader';
import { ZonePrimaryScope } from '../../workspaces/ZoneActions';
import { api } from '../../lib/api';
import { fundCallsApi } from '../../lib/api/fundCalls';
import './investorFundLanding.css';
import './investorFundCalls.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';
import { useManagedFund, FundPicker } from './managedFund';
import FromMercury from './FromMercury';
import BankReversals, { BankReversalPill } from './BankReversals';
import { FundActControl, useFundActs } from '../../lib/fundActs';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { reminderSubject } from './fundLpCommsModel';
import {
  formatCents, parseDollarsToCents, percent, lineStateLabel, lineAge, kycLabel, linesFor, wireRows,
  kycFlag, kycFlagged, latestCall, callRows, linesBehind, withdrawRule,
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
 *
 * D6238 (#6238, the Investor Fund v2 canvas FV5–FV7, D6229): 'All calls' is a
 * list of calls, one row each, and a row opens that call's page at `?call=`
 * (so `?fund=` travels with it): its lines, receipts, the comms logged on
 * them and the notices Axal issued on them (read from the one notice record,
 * routes/fund_notices.ts, as summaries). There a due date or purpose is
 * corrected and a call with no receipts withdrawn, each recorded with who
 * and when. Send reminders lays out one Eadwyn draft per line behind; each is
 * logged as sent only when the GP confirms it, and the product sends none.
 *
 * D9017 (#9017): a line whose receipted wire the bank reversed carries a Bank
 * reversed pill, and the call page lists its reversals for the GP of record
 * or an Admin to resolve with a note (`BankReversals.jsx`). Nothing is
 * reversed: the receipt and the line stand (D8534 answer b).
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
  // D6236: an LP's name on a line opens their record on Fund · LPs.
  const lpHref = (lpId) => `/funds/lps?fund=${encodeURIComponent(fund?.id ?? '')}&lp=${encodeURIComponent(lpId)}`;
  const [filter, setFilter] = useState('latest');
  const [ledger, setLedger] = useState({ status: 'loading', data: null });
  const [wires, setWires] = useState({ status: 'loading', data: null });
  const [composer, setComposer] = useState(null);
  const [receipt, setReceipt] = useState(null);
  // D714: issuing is a Super Admin act. A plain Admin previews and reads the
  // sentence where Issue would be; the Worker still decides.
  const acts = useFundActs();
  // D553: one open follow-up per page — a reminder draft or a "Log as sent"
  // form — on one LP's line.
  const [followUp, setFollowUp] = useState(null);
  // D6238: the call page is `?call=<id>`; `chase=1` opens its reminders.
  const [params, setParams] = useSearchParams();
  const openCallId = /^[1-9]\d*$/.test(params.get('call') || '') ? Number(params.get('call')) : null;
  const chase = params.get('chase') === '1';
  const goCall = useCallback((id, opts = {}) => {
    const next = new URLSearchParams(params);
    if (id == null) { next.delete('call'); next.delete('chase'); } else {
      next.set('call', String(id));
      if (opts.chase) next.set('chase', '1'); else next.delete('chase');
    }
    setParams(next);
  }, [params, setParams]);

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
  const latest = data ? latestCall(data) : null;
  const shown = useMemo(() => (data ? linesFor(filter, data) : []), [filter, data]);
  const receipts = useMemo(() => (wires.status === 'ready' ? wireRows(wires.data) : []), [wires]);
  const owingLines = data ? linesFor('outstanding', data).length : null;
  const collected = summary ? summary.received_cents + summary.paid_before_receipts_cents : null;

  const newCall = useMemo(() => (fund
    ? { onClick: () => setComposer({ amount: '', due: '', purpose: '', preview: null, error: '', busy: false }) }
    : { onClick: () => {}, disabled: true, title: 'There is no fund you operate to issue a call on.' }), [fund]);
  // D6238: Send reminders opens the chase on the call in view, else the
  // current call. A call with no line behind has nobody to remind.
  const chaseTarget = openCallId ?? latest?.id ?? null;
  const chaseCall = data?.calls?.find((c) => c.id === chaseTarget) || null;
  const sendReminders = useMemo(() => {
    if (!fund || !chaseCall) return { onClick: () => {}, disabled: true, title: 'There is no issued call to chase.' };
    if (!linesBehind(chaseCall).length) return { onClick: () => {}, disabled: true, title: `No line of call ${chaseCall.call_number} still owes anything.` };
    return { onClick: () => goCall(chaseCall.id, { chase: true }) };
  }, [fund, chaseCall, goCall]);

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

  // ── D553: draft a reminder, then log it as sent ───────────────────────────
  // The draft is Eadwyn's `funds/calls` surface over THIS line. Nothing is
  // sent from here: the GP sends it themselves, then logs it, and the log keeps
  // the subject and the date, never the message.
  function openDraft(line) { setReceipt(null); setFollowUp({ lineId: line.id, mode: 'draft' }); }
  function openLog(line) {
    setReceipt(null);
    setFollowUp({ lineId: line.id, mode: 'log', lpId: line.limited_partner_id, lp: line.lp_name, subject: reminderSubject(line), date: todayIso(), error: '', busy: false, logged: false });
  }
  async function saveLog(e) {
    e.preventDefault();
    if (!followUp.subject.trim()) { setFollowUp((f) => ({ ...f, error: 'A logged message needs its subject.' })); return; }
    setFollowUp((f) => ({ ...f, busy: true, error: '' }));
    try {
      await api.fundsLogComm(fund.id, {
        lp_id: followUp.lpId, kind: 'call_reminder', subject: followUp.subject.trim(),
        sent_at: followUp.date, capital_call_id: followUp.lineId,
      });
      setFollowUp((f) => ({ ...f, busy: false, logged: true }));
    } catch (err) {
      setFollowUp((f) => ({ ...f, busy: false, error: err?.message || 'The message could not be logged.' }));
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

  return <ZonePrimaryScope><div className="i6-fund if2-shell"><main className="i6-main if2-main" data-testid="investor-fund-calls">
    <ZoneHeader family="i6" bucketPath="/funds" activeSlug="calls" crumb="Calls" title="Capital calls" intro={CALLS_INTRO}
      refresh={<button className="i6-refresh" type="button" onClick={refresh} disabled={busy} aria-label="Refresh the call ledger"><RefreshCw size={14} className={busy ? 'i6-spin' : ''} /></button>} />
    <FundPicker funds={managed.funds} fund={fund} onSelect={managed.select} />
    <ZoneToolbar role="investor" className="mb-3"
      filters={investorZoneFilters('funds/calls', { value: filter, onChange: setFilter })}
      actions={investorZoneActions('funds/calls', {
        handlers: { newCall, sendReminders },
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
      {composer && <CallComposer composer={composer} setComposer={setComposer} onPreview={previewCall} onIssue={issueCall} acts={acts} />}
      {ledger.status === 'unreadable' && <div className="if2-unavailable" data-testid="status-call-ledger-unreadable"><Unreadable what="This fund's call ledger" claim="This is not a claim that the fund has no calls." onRetry={load} /></div>}
      <section className="if2-stats">
        <Stat label="Called to date" value={summary ? money(summary.called_cents) : null} note={calledNote} />
        <Stat label="Collected" value={summary ? money(collected) : null} note={collectedNote} />
        <Stat label="Outstanding" value={summary ? money(summary.outstanding_cents) : null}
          note={summary ? `across ${plural(owingLines, 'LP line')}` : null} />
        <Stat label="Current call" value={latest ? money(latest.amount_cents) : summary ? 'None issued' : null}
          note={latest ? `Call ${latest.call_number}${latest.due_date ? ` · due ${latest.due_date}` : ' · no due date recorded'}` : summary ? 'No numbered call yet' : null} />
      </section>

      {openCallId != null ? <CallPage fund={fund} callId={openCallId} chase={chase} acts={acts} onBack={() => goCall(null)}
        onChase={(on) => goCall(openCallId, { chase: on })} onChanged={load} />
      : data && filter === 'all' ? <CallList rows={callRows(data)} onOpen={(id) => goCall(id)} />
      : data && <section className="i6-card if2-ledger" data-testid="card-call-ledger">
        <header><div><h2>{filter === 'latest' ? (latest ? `Call ${latest.call_number} · pro-rata and receipts` : 'No numbered call yet') : filter === 'all' ? 'All calls · every LP line' : 'Outstanding · every line still owed'}</h2>
          <span>{filter === 'latest' && latest ? residualSentence(latest) : 'Owed is each LP’s share by commitment, in whole cents, never typed by hand.'}</span></div>
          <span>{plural(shown.length, 'line')}</span></header>
        {filter === 'latest' && latest && <p className="if2-purpose">{latest.purpose ? `Purpose: ${latest.purpose}` : 'No purpose recorded'}{latest.issued_by_name ? ` · issued by ${latest.issued_by_name}` : ''} · {String(latest.created_at).slice(0, 10)}</p>}
        {shown.length === 0 ? <div className="i6-empty if2-empty"><div><strong>{filter === 'outstanding' ? 'Nothing is outstanding.' : 'No numbered call has been issued on this fund.'}</strong><p>{filter === 'outstanding' ? 'Every line issued on this fund is paid.' : 'New call previews the split before anything is written.'}</p></div></div>
          : <LineTable lines={shown} showCall={filter !== 'latest'} receipt={receipt} setReceipt={setReceipt} onOpen={openReceipt} onSave={saveReceipt} lpHref={lpHref}
            followUp={followUp} setFollowUp={setFollowUp} onDraft={openDraft} onLog={openLog} onSaveLog={saveLog} />}
        {filter === 'latest' && latest && <button type="button" className="if2-row-action if2-open-call" data-testid={`button-open-call-${latest.id}`} onClick={() => goCall(latest.id)}>Open call {latest.call_number}</button>}
      </section>}

      {openCallId == null && data?.unnumbered?.length > 0 && <section className="i6-card if2-ledger if2-legacy" data-testid="card-unnumbered-lines">
        <header><div><h2>Issued before calls were numbered</h2><span>Lines written before the call ledger. Their amounts were stored in dollars and are shown rounded to the cent; a line marked paid then has no receipt behind it.</span></div><span>{plural(data.unnumbered.length, 'line')}</span></header>
        <LineTable lines={data.unnumbered} showCall={false} receipt={receipt} setReceipt={setReceipt} onOpen={openReceipt} onSave={saveReceipt} lpHref={lpHref}
          followUp={followUp} setFollowUp={setFollowUp} onDraft={openDraft} onLog={openLog} onSaveLog={saveLog} />
      </section>}
      {data?.truncated && <p className="i6-footnote">This fund has more calls or lines than one read returns; the oldest are not shown, and the totals above cover only what was read.</p>}

      {openCallId == null && <section className="i6-card if2-ledger if2-wires" data-testid="card-wire-trail">
        <header><div><h2>Wire trail</h2><span>Every receipt recorded on this fund, newest first. Receipts are append-only: a mistake is answered by the next receipt, never by editing this one.</span></div><span>{wires.status === 'ready' ? plural(receipts.length, 'receipt') : ''}</span></header>
        {wires.status === 'loading' ? <div className="i6-skeleton" /> : wires.status === 'unreadable'
          ? <Unreadable what="The wire trail" claim="This is not a claim that no money has arrived." onRetry={load} />
          : receipts.length === 0 ? <div className="i6-empty">No receipt has been recorded on this fund.</div>
            : <div className="if2-table-wrap"><table><thead><tr><th>Received</th><th>LP</th><th>Call</th><th className="right">Amount</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>
              {receipts.map((r) => <tr key={r.id} data-testid={`row-receipt-${r.id}`}><td data-label="Received">{r.received_on}</td><td data-label="LP">{r.lp_name || `LP #${r.limited_partner_id}`}</td><td data-label="Call">{r.call_number != null ? `Call ${r.call_number}` : 'Before numbering'}</td><td className="right" data-label="Amount">{money(r.amount_cents)}</td><td data-label="Reference">{r.reference || 'No reference recorded'}</td><td data-label="Recorded by">{r.recorded_by_name || 'Not recorded'}{r.source === 'mark_paid' ? ' · marked paid' : ''}</td></tr>)}
            </tbody></table></div>}
      </section>}
    </>}
    {/* D840 (#2349): payments from the GP's own Mercury, matched to open lines; a receipt is recorded only on Accept. */}
    <FromMercury section="calls" fundId={fund?.id ?? null} />
    <footer className="i6-footnote">New call and Record receipt write to the fund’s ledger, Correct and Withdraw write the call’s own record of who changed it and when, and Log as sent writes the fund’s comms log. Draft reminder and Send reminders draft reminders for you to send yourself: nothing on this page sends one, or exports anything but the receipts it shows.</footer>
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
      ['Reminder delivery', 'Eadwyn drafts a reminder for one LP’s line, and nothing here sends it. Send reminders lays out one draft per line behind; Log as sent records the subject and the date on the comms log, never the message, and only when you confirm it.'],
      ['Notice delivery', 'Each LP with a platform account gets an in-app notice when a call is issued; no letter is sent and no delivery is tracked.'],
    ]}
  /></div></ZonePrimaryScope>;
}

/** The zone's intro: only what this page holds (D6238). */
export const CALLS_INTRO = 'Numbered capital calls, each LP’s line, the receipts recorded against it and what was logged to each LP.';

function residualSentence(call) {
  const base = 'Each line is the LP’s share by commitment, in whole cents.';
  if (!call.residual_cents) return `${base} The split came out exact.`;
  const who = call.residual_lp_name ? `${call.residual_lp_name}’s line` : 'one named line';
  return `${base} The ${call.residual_cents}-cent residual sits on ${who}.`;
}

export function LineTable({ lines, showCall, receipt, setReceipt, onOpen, onSave, lpHref = null, followUp = null, setFollowUp = () => {}, onDraft = () => {}, onLog = () => {}, onSaveLog = () => {} }) {
  return <div className="if2-table-wrap"><table><thead><tr>
    {showCall && <th>Call</th>}<th>LP</th><th className="right">Commitment</th><th className="right">Owed</th><th className="right">Received</th><th>State</th><th>Age</th><th />
  </tr></thead><tbody>
    {lines.map((line) => [
      <tr key={line.id} data-testid={`row-call-line-${line.id}`}>
        {showCall && <td data-label="Call">{line.call_number != null ? `Call ${line.call_number}` : 'Before numbering'}</td>}
        <td>{lpHref && line.limited_partner_id != null
          // D6236: the LP's name opens their record on Fund · LPs.
          ? <Link to={lpHref(line.limited_partner_id)} className="if2-lp-link" data-testid={`link-lp-record-${line.id}`}><strong>{line.lp_name || line.lp_email || `LP #${line.limited_partner_id}`}</strong></Link>
          : <strong>{line.lp_name || line.lp_email || `LP #${line.limited_partner_id}`}</strong>}<small>{kycLabel(line)}</small></td>
        <td className="right" data-label="Commitment">{money(line.commitment_cents)}</td>
        <td className="right" data-label="Owed">{money(line.owed_cents)}</td>
        <td className="right" data-label="Received">{money(line.received_cents)}</td>
        <td data-label="State"><span className={`if2-pill ${line.state}`}>{lineStateLabel(line)}</span> <BankReversalPill line={line} /></td>
        <td data-label="Age">{lineAge(line)}</td>
        <td className="if2-actions">{line.state !== 'paid' && <>
          <button type="button" className="if2-row-action" data-testid={`button-record-receipt-${line.id}`} onClick={() => onOpen(line)}>Record receipt</button>
          <button type="button" className="if2-row-action" data-testid={`button-draft-reminder-${line.id}`} onClick={() => onDraft(line)}>Draft reminder</button>
          <button type="button" className="if2-row-action" data-testid={`button-log-sent-${line.id}`} onClick={() => onLog(line)}>Log as sent</button>
        </>}</td>
      </tr>,
      followUp?.lineId === line.id && followUp.mode === 'draft' && <tr key={`${line.id}-draft`} className="if2-receipt-row"><td colSpan={showCall ? 8 : 7}>
        <ZoneDraft
          surface="funds/calls"
          scopeKey={String(line.id)}
          railOption="draft:lp-reminder"
          label="Proposal · a reminder to this LP"
          accept="Accept draft"
          run="Draft the reminder"
          foot="A draft only. Nothing is sent: send it yourself, then Log as sent."
          empty="A short reminder to this LP alone, stating what this line still owes and when it was due, as the ledger records it."
          nothingToDraft="This line owes nothing, or it is not on a fund you operate, so there is nothing to remind about."
        />
        <button type="button" className="if2-row-action" onClick={() => setFollowUp(null)}>Close</button>
      </td></tr>,
      followUp?.lineId === line.id && followUp.mode === 'log' && <tr key={`${line.id}-log`} className="if2-receipt-row"><td colSpan={showCall ? 8 : 7}>
        {followUp.logged
          ? <p data-testid="status-comm-logged">Logged on the comms log: “{followUp.subject}”, sent {followUp.date}. <button type="button" onClick={() => setFollowUp(null)}>Close</button></p>
          : <form className="if2-receipt" onSubmit={onSaveLog} data-testid="form-log-sent">
            <span>Log a reminder sent to {followUp.lp || 'this LP'}</span>
            <label>Subject<input data-testid="input-comm-subject" value={followUp.subject} maxLength={200} onChange={(e) => setFollowUp((f) => ({ ...f, subject: e.target.value }))} /></label>
            <label>Sent on<input data-testid="input-comm-date" type="date" value={followUp.date} max={todayIso()} onChange={(e) => setFollowUp((f) => ({ ...f, date: e.target.value }))} /></label>
            <button type="submit" data-testid="button-save-comm" disabled={followUp.busy}>{followUp.busy ? 'Logging…' : 'Log as sent'}</button>
            <button type="button" onClick={() => setFollowUp(null)}>Cancel</button>
            <p role={followUp.error ? 'alert' : undefined}>{followUp.error || 'The log keeps the subject and the date, never the message.'}</p>
          </form>}
      </td></tr>,
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

export function CallComposer({ composer, setComposer, onPreview, onIssue, acts }) {
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
          {preview.lines.map((l) => <tr key={l.lp_id}><td>{l.name || l.email || `LP #${l.lp_id}`}{l.residual ? ' · carries the residual' : ''}</td><td className="right" data-label="Commitment">{money(l.commitment_cents)}</td><td className="right" data-label="Share">{money(l.share_cents)}</td><td data-label="KYC">{kycFlagged(l) ? <b className="if2-kyc-flag">⚠ {kycLabel(l)}</b> : kycLabel(l)}</td></tr>)}
        </tbody></table></div>
        {kycFlag(preview.lines) && <p className="if2-warn" role="status" data-testid="warning-call-kyc">⚠ {kycFlag(preview.lines).sentence}</p>}
        {preview.excluded.length > 0 && <p className="if2-note">Not billed, for want of a recorded commitment: {preview.excluded.map((x) => x.name || x.email || `LP #${x.lp_id}`).join(', ')}.</p>}
        <FundActControl access={acts} act="capital_call.issue" testId="text-issue-call-refused" className="if2-note">
          <button type="button" className="if2-issue" data-testid="button-issue-call" disabled={composer.busy} onClick={onIssue}>
            {composer.busy ? 'Issuing…' : `Issue call ${preview.next_call_number} to ${plural(preview.lines.length, 'LP')}`}
          </button>
        </FundActControl>
      </>}
    </div>}
  </section>;
}

function Stat({ label, value, note }) {
  return <article className="if2-stat"><span>{label}</span><b>{value ?? 'Unavailable'}</b><small>{note ?? 'The call ledger was not read'}</small></article>;
}

// ── D6238: All calls, and one call's page ───────────────────────────────

/** 'All calls': one row per numbered call; a row opens that call. Cards on a phone. */
export function CallList({ rows, onOpen }) {
  return <section className="i6-card if2-ledger" data-testid="card-call-list">
    <header><div><h2>All calls</h2><span>Every numbered call on this fund, newest first. Lines behind are the lines that still owe part or all of their share.</span></div>
      <span>{plural(rows.length, 'call')}</span></header>
    {rows.length === 0 ? <div className="i6-empty if2-empty"><div><strong>No numbered call has been issued on this fund.</strong><p>New call previews the split before anything is written.</p></div></div> : <>
      <div className="if2-table-wrap if2-desk"><table><thead><tr>
        <th>Call</th><th>Issued</th><th>Due</th><th className="right">Amount</th><th className="right">Collected</th><th className="right">Outstanding</th><th className="right">Lines behind</th><th />
      </tr></thead><tbody>
        {rows.map((r) => <tr key={r.id} data-testid={`row-call-${r.id}`}>
          <td><strong>Call {r.call_number}</strong>{r.withdrawn ? <small><span className="if2-pill withdrawn">Withdrawn</span></small> : r.corrected ? <small>Corrected</small> : null}</td>
          <td>{r.issued_on || 'Not recorded'}</td>
          <td>{r.due_date || 'No due date recorded'}</td>
          <td className="right">{money(r.amount_cents)}</td>
          <td className="right">{r.withdrawn ? 'Withdrawn' : money(r.collected_cents)}</td>
          <td className="right">{r.withdrawn ? 'Withdrawn' : money(r.outstanding_cents)}</td>
          <td className="right">{r.withdrawn ? 'None' : `${r.lines_behind} of ${r.line_count}`}</td>
          <td><button type="button" className="if2-row-action" data-testid={`button-open-call-${r.id}`} onClick={() => onOpen(r.id)}>Open call {r.call_number}</button></td>
        </tr>)}
      </tbody></table></div>
      <ul className="if2-cards" aria-label="All calls">
        {rows.map((r) => <li key={r.id} className="if2-card" data-testid={`card-call-${r.id}`}>
          <div className="if2-card-head"><b>Call {r.call_number}</b>{r.withdrawn ? <span className="if2-pill withdrawn">Withdrawn</span> : <span>{money(r.amount_cents)}</span>}</div>
          <dl><dt>Issued</dt><dd>{r.issued_on || 'Not recorded'}</dd><dt>Due</dt><dd>{r.due_date || 'No due date recorded'}</dd>
            {!r.withdrawn && <><dt>Outstanding</dt><dd>{money(r.outstanding_cents)}</dd><dt>Lines behind</dt><dd>{r.lines_behind} of {r.line_count}</dd></>}</dl>
          <button type="button" className="if2-row-action if2-tap" onClick={() => onOpen(r.id)}>Open call {r.call_number}</button>
        </li>)}
      </ul>
    </>}
  </section>;
}

const AMEND_LABEL = { due_date: 'Due date corrected', purpose: 'Purpose corrected', withdrawn: 'Withdrawn' };

/** One call: header, figures, lines, receipts, comms and notices, correction, withdrawal and the chase. */
function CallPage({ fund, callId, chase, acts, onBack, onChase, onChanged }) {
  const [read, setRead] = useState({ status: 'loading', data: null, code: null });
  const [receipt, setReceipt] = useState(null);
  const [followUp, setFollowUp] = useState(null);
  // `quiet` refetches in place, so a reminder logged in the chase keeps its confirmation on screen.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRead({ status: 'loading', data: null, code: null });
    try {
      const data = await fundCallsApi.read(fund.id, callId);
      setRead(data?.call ? { status: 'ready', data, code: null } : { status: 'unreadable', data: null, code: null });
    } catch (err) {
      setRead({ status: err?.status === 404 ? 'missing' : 'unreadable', data: null, code: err?.status ?? null });
    }
  }, [fund.id, callId]);
  useEffect(() => { load(); }, [load]);
  const reload = async () => { await load(true); await onChanged(); };

  async function saveReceipt(e) {
    e.preventDefault();
    const cents = parseDollarsToCents(receipt.amount);
    if (cents === null) { setReceipt((r) => ({ ...r, error: 'Enter the amount received in dollars, above zero, with at most two decimals.' })); return; }
    setReceipt((r) => ({ ...r, busy: true, error: '' }));
    try {
      await api.fundsRecordReceipt(fund.id, receipt.lineId, { amount_cents: cents, received_on: receipt.date, reference: receipt.reference.trim() || undefined });
      setReceipt(null);
      await reload();
    } catch (err) {
      setReceipt((r) => ({ ...r, busy: false, error: err?.message || 'The receipt could not be recorded.' }));
    }
  }

  const back = <button type="button" className="if2-row-action if2-tap" data-testid="button-back-to-calls" onClick={onBack}>← All calls</button>;
  if (read.status === 'loading') return <section className="i6-card if2-ledger">{back}<div className="i6-skeleton" /></section>;
  if (read.status === 'missing') return <section className="i6-card if2-ledger" data-testid="status-call-missing">{back}<p className="if2-note">That call is not on {fund.name || 'this fund'}.</p></section>;
  if (read.status === 'unreadable') return <section className="i6-card if2-ledger">{back}<Unreadable what="This call" claim="This is not a claim that the call has no lines." onRetry={load} /></section>;

  const { call, receipts, comms, notices, bank_reversals: bankReversals } = read.data;
  const behind = linesBehind(call);
  const rule = withdrawRule(call);
  const lines = call.lines.map((l) => ({ ...l, call_number: call.call_number }));
  return <section className="i6-card if2-ledger if2-call" data-testid="card-call-page">
    {back}
    <header><div><h2>Call {call.call_number} · {money(call.amount_cents)}{call.withdrawn && <> <span className="if2-pill withdrawn">Withdrawn</span></>}</h2>
      <span>{call.purpose ? `Purpose: ${call.purpose}` : 'No purpose recorded'} · issued {String(call.created_at).slice(0, 10)}{call.issued_by_name ? ` by ${call.issued_by_name}` : ''} · {call.due_date ? `due ${call.due_date}` : 'no due date recorded'} · {plural(call.lines.length, 'line')}</span></div></header>
    <p className="if2-purpose">{residualSentence(call)}</p>
    {call.withdrawn && call.withdrawal && <p className="if2-warn" data-testid="status-call-withdrawn">Withdrawn {String(call.withdrawal.at).slice(0, 10)}{call.withdrawal.by_name ? ` by ${call.withdrawal.by_name}` : ''}{call.withdrawal.reason ? ` · ${call.withdrawal.reason}` : ''}. Its lines owe nothing; the shares as issued are kept beside each line.</p>}

    {!call.withdrawn && <section className="if2-stats if2-call-stats">
      <Stat label="Owed" value={money(call.amount_cents)} note={`${plural(call.lines.length, 'line')} · whole cents`} />
      <Stat label="Collected" value={money(call.received_cents)} note="dated receipts on this call" />
      <Stat label="Outstanding" value={money(call.outstanding_cents)} note={`on ${plural(behind.length, 'line')}`} />
      <Stat label="Lines behind" value={`${behind.length} of ${call.lines.length}`} note="lines that still owe part or all of their share" />
    </section>}

    <BankReversals fund={fund} reversals={bankReversals} lines={call.lines} acts={acts} onRetry={load} onResolved={() => load(true)} />

    <h3 className="if2-sub">Lines</h3>
    {call.withdrawn
      ? <div className="if2-table-wrap"><table><thead><tr><th>LP</th><th className="right">Issued share</th><th>State</th></tr></thead><tbody>
        {call.lines.map((l) => <tr key={l.id} data-testid={`row-call-line-${l.id}`}><td><strong>{l.lp_name || l.lp_email || `LP #${l.limited_partner_id}`}</strong></td><td className="right">{money(l.issued_owed_cents)}</td><td><span className="if2-pill withdrawn">Withdrawn</span></td></tr>)}
      </tbody></table></div>
      : <>
        <div className="if2-desk"><LineTable lines={lines} showCall={false} receipt={receipt} setReceipt={setReceipt}
          onOpen={(line) => { setFollowUp(null); setReceipt({ lineId: line.id, lp: line.lp_name, outstanding: line.outstanding_cents, amount: exportAmount(line.outstanding_cents) ?? '', date: todayIso(), reference: '', error: '', busy: false }); }}
          onSave={saveReceipt} followUp={followUp} setFollowUp={setFollowUp}
          onDraft={(line) => { setReceipt(null); setFollowUp({ lineId: line.id, mode: 'draft' }); }}
          onLog={() => onChase(true)} /></div>
        <ul className="if2-cards" aria-label={`Call ${call.call_number} lines`}>
          {lines.map((l) => <li key={l.id} className="if2-card"><div className="if2-card-head"><b>{l.lp_name || l.lp_email || `LP #${l.limited_partner_id}`}</b><span><span className={`if2-pill ${l.state}`}>{lineStateLabel(l)}</span> <BankReversalPill line={l} /></span></div>
            <dl><dt>Owed</dt><dd>{money(l.owed_cents)}</dd><dt>Outstanding</dt><dd>{money(l.outstanding_cents)}</dd><dt>KYC</dt><dd>{kycLabel(l)}</dd></dl>
            {l.state !== 'paid' && <div className="if2-card-acts"><button type="button" className="if2-row-action if2-tap" onClick={() => setReceipt({ lineId: l.id, lp: l.lp_name, outstanding: l.outstanding_cents, amount: exportAmount(l.outstanding_cents) ?? '', date: todayIso(), reference: '', error: '', busy: false })}>Record receipt</button>
              <button type="button" className="if2-row-action if2-tap" onClick={() => onChase(true)}>More…</button></div>}
          </li>)}
        </ul>
      </>}

    {chase && !call.withdrawn && <ReminderQueue fund={fund} call={call} lines={behind} onClose={() => onChase(false)} onLogged={() => load(true)} />}

    <h3 className="if2-sub">Receipts</h3>
    {receipts.status !== 'ready' ? <Unreadable what="This call's receipts" claim="This is not a claim that no money has arrived." onRetry={load} />
      : receipts.rows.length === 0 ? <div className="i6-empty">No receipt has been recorded on this call.</div>
        : <div className="if2-table-wrap"><table><thead><tr><th>Received</th><th>LP</th><th className="right">Amount</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>
          {receipts.rows.map((r) => <tr key={r.id} data-testid={`row-call-receipt-${r.id}`}><td>{r.received_on}</td><td>{r.lp_name || `LP #${r.limited_partner_id}`}</td><td className="right">{money(r.amount_cents)}</td><td>{r.reference || 'No reference recorded'}</td><td>{r.recorded_by_name || 'Not recorded'}{r.source === 'mark_paid' ? ' · marked paid' : ''}</td></tr>)}
        </tbody></table></div>}

    <h3 className="if2-sub">Comms</h3>
    <p className="if2-note">What you logged as sent to each LP on this call, and the notices Axal issued on its lines. The log keeps subjects and dates, never a message; issued is not delivered.</p>
    {comms.status !== 'ready' ? <Unreadable what="The comms logged on this call" claim="This is not a claim that nothing was sent." onRetry={load} />
      : comms.rows.length === 0 ? <div className="i6-empty">Nothing has been logged as sent on this call.</div>
        : <ul className="if2-log" data-testid="list-call-comms">{comms.rows.map((m) => <li key={m.id}><b>{m.subject}</b><small>{m.lp_name || `LP #${m.lp_id}`} · {String(m.kind).replace(/_/g, ' ')} · sent {String(m.sent_at).slice(0, 10)}{m.logged_by_name ? ` · logged by ${m.logged_by_name}` : ''}</small></li>)}</ul>}
    {notices.status !== 'ready' ? <Unreadable what="The notices issued on this call" claim="This is not a claim that no notice was issued." onRetry={load} />
      : notices.rows.length === 0 ? <div className="i6-empty" data-testid="status-no-call-notices">Axal has issued no notice on this call’s lines.</div>
        : <ul className="if2-log" data-testid="list-call-notices">{notices.rows.map((n) => <li key={n.uid}><b>{n.title || 'Capital call notice'}{n.superseded ? ' · superseded' : ''}</b><small>{n.reference || 'No reference'} · {money(n.amount_cents)} · dated {n.notice_date || String(n.created_at).slice(0, 10)} · issued by Axal</small></li>)}</ul>}

    <h3 className="if2-sub">Corrections</h3>
    {call.amendments.length === 0 ? <p className="if2-note">This call is as issued: nothing has been corrected.</p>
      : <ul className="if2-log" data-testid="list-call-amendments">{call.amendments.map((a) => <li key={a.id}><b>{AMEND_LABEL[a.kind] || a.kind}{a.kind !== 'withdrawn' ? `: ${a.old_value || 'none'} → ${a.new_value}` : ''}</b><small>{String(a.at).slice(0, 16).replace('T', ' ')} UTC · {a.by_name || 'Not recorded'}{a.reason ? ` · ${a.reason}` : ''}</small></li>)}</ul>}
    {!call.withdrawn && <CallAmend fund={fund} call={call} rule={rule} notices={notices} acts={acts} onDone={reload} />}
  </section>;
}

/** Correct the due date or the purpose, or withdraw the call. Each says what it changes before it is confirmed. */
function CallAmend({ fund, call, rule, notices, acts, onDone }) {
  const [form, setForm] = useState(null);
  const issuedNotices = notices.status === 'ready' ? notices.rows.length : null;
  const noticeNote = issuedNotices == null ? 'Whether Axal issued notices on this call could not be read.'
    : issuedNotices > 0 ? `${plural(issuedNotices, 'notice')} Axal issued on this call keep what they said; nothing is reissued or recalled. Tell the LPs yourself.`
      : 'Axal has issued no notice on this call.';
  async function submit(e) {
    e.preventDefault();
    setForm((f) => ({ ...f, busy: true, error: '' }));
    try {
      if (form.mode === 'withdraw') await fundCallsApi.withdraw(fund.id, call.id, { reason: form.reason.trim() || undefined });
      else await fundCallsApi.correct(fund.id, call.id, { field: form.field, value: form.value.trim(), reason: form.reason.trim() || undefined });
      setForm(null);
      await onDone();
    } catch (err) {
      setForm((f) => ({ ...f, busy: false, error: err?.message || 'Nothing was recorded.' }));
    }
  }
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return <div className="if2-amend">
    {!form && <div className="if2-card-acts">
      <FundActControl access={acts} act="capital_call.correct" testId="text-correct-call-refused" className="if2-note">
        <button type="button" className="if2-row-action if2-tap" data-testid="button-correct-due" onClick={() => setForm({ mode: 'correct', field: 'due_date', value: call.due_date || '', reason: '', error: '', busy: false })}>Correct due date</button>
        <button type="button" className="if2-row-action if2-tap" data-testid="button-correct-purpose" onClick={() => setForm({ mode: 'correct', field: 'purpose', value: call.purpose || '', reason: '', error: '', busy: false })}>Correct purpose</button>
      </FundActControl>
      <FundActControl access={acts} act="capital_call.withdraw" testId="text-withdraw-call-refused" className="if2-note">
        {rule.allowed
          ? <button type="button" className="if2-row-action if2-tap" data-testid="button-withdraw-call" onClick={() => setForm({ mode: 'withdraw', reason: '', error: '', busy: false })}>Withdraw call</button>
          : <span className="if2-note" data-testid="text-withdraw-rule">{rule.reason}</span>}
      </FundActControl>
    </div>}
    {form && <form className="if2-receipt" onSubmit={submit} data-testid={form.mode === 'withdraw' ? 'form-withdraw-call' : 'form-correct-call'}>
      <span>{form.mode === 'withdraw' ? `Withdraw call ${call.call_number}` : form.field === 'due_date' ? `Correct the due date of call ${call.call_number}` : `Correct the purpose of call ${call.call_number}`}</span>
      {form.mode === 'correct' && (form.field === 'due_date'
        ? <label>New due date<input data-testid="input-correct-value" type="date" value={form.value} onChange={set('value')} required /></label>
        : <label>New purpose<input data-testid="input-correct-value" value={form.value} maxLength={500} onChange={set('value')} required /></label>)}
      <label>Reason<input data-testid="input-amend-reason" value={form.reason} maxLength={500} onChange={set('reason')} placeholder="Optional" /></label>
      <button type="submit" data-testid="button-confirm-amend" disabled={form.busy}>{form.busy ? 'Recording…' : form.mode === 'withdraw' ? `Withdraw call ${call.call_number}` : 'Record correction'}</button>
      <button type="button" onClick={() => setForm(null)}>Cancel</button>
      <p role={form.error ? 'alert' : undefined}>{form.error || (form.mode === 'withdraw'
        ? `Every line is set to owe nothing, and the shares as issued are kept. Your name and the time are recorded. ${noticeNote}`
        : `The call keeps what it was issued with; this correction is recorded beside it with your name and the time.${form.field === 'due_date' ? ' Every line takes the new date.' : ''} ${noticeNote}`)}</p>
    </form>}
  </div>;
}

/**
 * Send reminders: one Eadwyn draft per line behind, for review, each with its
 * own Log as sent. Nothing is sent from here and nothing is logged until the
 * GP confirms that line.
 */
export function ReminderQueue({ fund, call, lines, onClose, onLogged = () => {} }) {
  const [logs, setLogs] = useState({});
  const fresh = () => ({ subject: reminderSubject({ call_number: call.call_number }), date: todayIso(), busy: false, error: '', logged: false });
  const entry = (line) => logs[line.id] || fresh();
  const patch = (id, next) => setLogs((m) => ({ ...m, [id]: { ...fresh(), ...m[id], ...next } }));
  async function confirm(e, line) {
    e.preventDefault();
    const it = entry(line);
    if (!it.subject.trim()) { patch(line.id, { error: 'A logged message needs its subject.' }); return; }
    patch(line.id, { busy: true, error: '' });
    try {
      await api.fundsLogComm(fund.id, { lp_id: line.limited_partner_id, kind: 'call_reminder', subject: it.subject.trim(), sent_at: it.date, capital_call_id: line.id });
      patch(line.id, { busy: false, logged: true });
      onLogged();
    } catch (err) {
      patch(line.id, { busy: false, error: err?.message || 'The message could not be logged.' });
    }
  }
  const logged = lines.filter((l) => logs[l.id]?.logged).length;
  return <section className="if2-chase" data-testid="panel-send-reminders" aria-label={`Reminders for call ${call.call_number}`}>
    <header><div><h3>Send reminders · call {call.call_number}</h3>
      <span>One reminder per line behind, drafted for you to review and send yourself. Nothing is sent from here; each is logged as sent only when you confirm it.</span></div>
      <span>{logged} of {plural(lines.length, 'line')} logged</span></header>
    {lines.length === 0 ? <p className="if2-note">No line of this call still owes anything.</p> : <ol className="if2-chase-list">
      {lines.map((line) => {
        const it = entry(line);
        return <li key={line.id} data-testid={`chase-line-${line.id}`}>
          <p><b>{line.lp_name || line.lp_email || `LP #${line.limited_partner_id}`}</b> · {money(line.outstanding_cents)} outstanding · {lineAge(line)}</p>
          <ZoneDraft
            surface="funds/calls"
            scopeKey={String(line.id)}
            railOption="draft:lp-reminder"
            label="Proposal · a reminder to this LP"
            accept="Accept draft"
            run="Draft the reminder"
            foot="A draft only. Nothing is sent: send it yourself, then Log as sent."
            empty="A short reminder to this LP alone, stating what this line still owes and when it was due, as the ledger records it."
            nothingToDraft="This line owes nothing, or it is not on a fund you operate, so there is nothing to remind about."
          />
          {it.logged ? <p data-testid={`status-chase-logged-${line.id}`}>Logged on the comms log: “{it.subject}”, sent {it.date}. Logged means you sent it; the platform did not.</p>
            : <form className="if2-receipt" onSubmit={(e) => confirm(e, line)} data-testid={`form-chase-log-${line.id}`}>
              <label>Subject<input value={it.subject} maxLength={200} onChange={(e) => patch(line.id, { subject: e.target.value })} /></label>
              <label>Sent on<input type="date" value={it.date} max={todayIso()} onChange={(e) => patch(line.id, { date: e.target.value })} /></label>
              <button type="submit" className="if2-tap" data-testid={`button-chase-log-${line.id}`} disabled={it.busy}>{it.busy ? 'Logging…' : 'Log as sent'}</button>
              <p role={it.error ? 'alert' : undefined}>{it.error || 'Press this only once you have sent it. The log keeps the subject and the date, never the message.'}</p>
            </form>}
        </li>;
      })}
    </ol>}
    <button type="button" className="if2-row-action if2-tap" onClick={onClose}>Close reminders</button>
  </section>;
}
