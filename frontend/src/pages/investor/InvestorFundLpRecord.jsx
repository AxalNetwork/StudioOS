import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, Unreadable } from '../../ui';
import { api } from '../../lib/api';
import { COMM_KIND_LABELS, lpTypeLabel } from './fundLpCommsModel';
import {
  callLines, calledToDate, commBody, distributionRow, dollarsText, kycOf, lpaOf, moneyText, statementOf,
} from './fundLpRecordModel';
import './investorFundLpRecord.css';

/**
 * D6236 (#6236) — FV4 · LP record, as a drawer over Fund · LPs.
 *
 * Opened by `?lp=<id>` (a register row, or an LP's name on a call line), closed
 * with Escape, the ×, or the scrim; below 640px the shared Sheet is a full
 * page. The row's own figures come from the register the page already read.
 * Each of the three per-LP reads is its own block and fails on its own,
 * "could not be read" with Retry, so a failed ledger never blanks the comms
 * log:
 *
 *   Calls and receipts   GET /api/funds/:id/ledger?lp=<id>
 *   Comms log            GET /api/funds/:id/comms?lp=<id>, Log a message posts
 *                        POST /api/funds/:id/comms for this LP
 *   Statement            GET /api/funds/:id/lp-report/:lpId (as the LP sees it,
 *                        with the distributions to them)
 *
 * All three answer `requireFundGp`: the GP of record at the institutional
 * tier, or an admin. Nothing here sends a message: Log a message records one
 * the GP sent outside the platform, subject only.
 *
 * D6242 (#6242): `proposal`, when the page passes one, is called with the
 * drawer's ledger and comms reads and draws Eadwyn's LP summary band.
 */

/** One read's state: loading, ready with its data, or unreadable. `key` names what is read. */
function useRead(fetcher, key) {
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const [state, setState] = useState({ status: 'loading', data: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    latest.current().then((data) => { if (live) setState({ status: 'ready', data }); })
      .catch(() => { if (live) setState({ status: 'unreadable', data: null }); });
    return () => { live = false; };
  }, [key, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function LpRecordDrawer({ fund, lp, figures, onClose, onLogged, proposal = null }) {
  const key = `${fund.id}:${lp.id}`;
  const ledger = useRead(() => api.fundsLedger(fund.id, lp.id), key);
  const comms = useRead(() => api.fundsCommsList(fund.id, lp.id), key);
  const report = useRead(() => api.fundsLpReport(fund.id, lp.id), key);
  const [form, setForm] = useState(null);

  async function logMessage(event) {
    event.preventDefault();
    const { body, error } = commBody(lp.id, form);
    if (error) { setForm((f) => ({ ...f, error })); return; }
    setForm((f) => ({ ...f, busy: true, error: '' }));
    try {
      await api.fundsLogComm(fund.id, body);
      setForm(null);
      comms.reload();
      onLogged?.();
    } catch (cause) {
      // The Worker's own sentence; nothing is assumed logged.
      setForm((f) => ({ ...f, busy: false, error: cause?.message || 'The message could not be logged. Nothing was recorded.' }));
    }
  }

  return <LpRecordView fund={fund} lp={lp} figures={figures} ledger={ledger} comms={comms} report={report}
    form={form} setForm={setForm} onLog={logMessage} onClose={onClose} proposal={proposal} />;
}

/** The drawer itself, over read states, so a test can draw every state. */
export function LpRecordView({ fund, lp, figures, ledger, comms, report, form = null, setForm = () => {}, onLog = () => {}, onClose, proposal = null }) {
  const who = lp.name || lp.email || `LP #${lp.id}`;
  const kyc = kycOf(lp);
  const lpa = lpaOf(lp);
  const calls = ledger.status === 'ready' ? callLines(ledger.data?.entries) : null;
  const called = calls ? calledToDate(calls.lines, ledger.data?.truncated) : null;
  const openLog = () => setForm({ kind: 'call_notice', subject: '', sentOn: todayIso(), callId: '', error: '', busy: false });
  return <Sheet label={`LP record · ${who}`} eyebrow="LP record" title={who} sub={[lp.email && lp.email !== who ? lp.email : null, fund.name].filter(Boolean).join(' · ') || null}
    testId="lp-record" onClose={onClose} width={720}>
    <div className="lpr" data-testid={`lp-record-${lp.id}`}>
      <div className="lpr-tags"><span className="lpr-pill">{lp.status ? String(lp.status).replace(/_/g, ' ') : 'State not recorded'}</span><span className="lpr-pill">{lpTypeLabel(lp) || 'Type not recorded'}</span></div>
      <div className="lpr-three">
        <section className="lpr-blk" data-testid="lp-record-commitment">
          <h3>Commitment</h3>
          <strong className="lpr-amt">{figures.commitment}</strong>
          <dl className="lpr-kv">
            <dt>Share of fund</dt><dd>{figures.share}</dd>
            <dt>Paid to date</dt><dd>{figures.paid}</dd>
            <dt>Called to date</dt><dd data-testid="lp-record-called">{ledger.status === 'ready' ? moneyText(called) : ledger.status === 'loading' ? '…' : 'Unavailable'}</dd>
            <dt>Committed on</dt><dd>{lp.commitment_date ? String(lp.commitment_date).slice(0, 10) : 'Not recorded'}</dd>
          </dl>
        </section>
        <section className="lpr-blk" data-testid="lp-record-standing">
          <h3>LPA</h3>
          <span className={`lpr-state ${lpa.tone}`} data-testid="lp-record-lpa">{lpa.label}</span>
          <h3>KYC</h3>
          <span className={`lpr-state ${kyc.tone}`} data-testid="lp-record-kyc">{kyc.label}</span>
          <small className="lpr-src" data-testid="lp-record-kyc-source">{kyc.source}</small>
        </section>
        <section className="lpr-blk" data-testid="lp-record-type">
          <h3>Type</h3>
          <span>{lpTypeLabel(lp) || 'Not recorded'}</span>
          <small className="lpr-src">Change it from the register's Type column.</small>
        </section>
      </div>

      <section className="lpr-card" data-testid="lp-record-calls">
        <header><h3>Calls and receipts</h3><span>Line by line · owed is computed by the ledger</span></header>
        {ledger.status === 'loading' ? <div className="i6-skeleton" />
          : ledger.status === 'unreadable' ? <Unreadable what="This LP's calls and receipts" claim="This is not a claim that no money has moved." onRetry={ledger.reload} />
            : !calls.lines.length && !calls.loose.length ? <p className="lpr-empty" data-testid="lp-record-calls-empty">No capital call has a line for this LP yet.</p>
              : <div className="lpr-table"><table><thead><tr><th>Call</th><th className="right">Owed</th><th className="right">Received</th><th className="right">Outstanding</th><th>State</th></tr></thead><tbody>
                {calls.lines.map((l) => <tr key={l.id} data-testid={`lp-record-line-${l.id}`}>
                  <td><strong>{l.call}</strong><small>{l.due ? `Due ${l.due}` : 'No due date recorded'}</small></td>
                  <td className="right">{moneyText(l.owed)}</td>
                  <td className="right">{moneyText(l.received)}{l.receipts.map((r) => <small key={r.id}>{r.received_on || 'Date not recorded'}{r.reference ? ` · ${r.reference}` : ''}</small>)}</td>
                  <td className="right"><b>{moneyText(l.outstanding)}</b></td>
                  <td><span className="lpr-pill">{l.state}</span></td>
                </tr>)}
                {calls.loose.map((r) => <tr key={`r${r.id}`} data-testid={`lp-record-receipt-${r.id}`}>
                  <td><strong>Receipt</strong><small>{r.call_number != null ? `Call ${r.call_number}` : 'Line not on this list'}</small></td>
                  <td className="right">—</td><td className="right">{moneyText(r.amount_cents)}<small>{r.received_on || 'Date not recorded'}</small></td><td className="right">—</td><td />
                </tr>)}
              </tbody></table></div>}
        {ledger.status === 'ready' && ledger.data?.truncated && <p className="i6-footnote">Only the newest entries are shown, so called to date is not totalled.</p>}
      </section>

      <section className="lpr-card" data-testid="lp-record-comms">
        <header><h3>Comms log</h3>{!form && <button type="button" className="lpr-btn" onClick={openLog} data-testid="button-lp-record-log">Log a message</button>}</header>
        {form && <LogMessageForm form={form} setForm={setForm} onSubmit={onLog} lines={calls?.lines || []} />}
        {comms.status === 'loading' ? <div className="i6-skeleton" />
          : comms.status === 'unreadable' ? <Unreadable what="This LP's comms log" claim="This is not a claim that nothing was sent." onRetry={comms.reload} />
            : !(comms.data?.items || []).length ? <p className="lpr-empty" data-testid="lp-record-comms-empty">Nothing has been logged as sent to this LP.</p>
              : <ul className="lpr-list">{comms.data.items.map((m) => <li key={m.id} data-testid={`lp-record-comm-${m.id}`}>
                <div><b>{m.subject}</b><small>{COMM_KIND_LABELS[m.kind] || m.kind} · {String(m.sent_at || '').slice(0, 10) || 'Date not recorded'} · logged by {m.logged_by_name || 'Not recorded'}</small></div>
                <span>Subject only · no body stored</span>
              </li>)}</ul>}
      </section>

      {/* D6242 (#6242): Eadwyn's summary of this LP, drawn by the page over this drawer's own reads. */}
      {proposal ? proposal({ ledger, comms }) : null}

      <section className="lpr-card" data-testid="lp-record-statement">
        <header><h3>Statement</h3><span>As the LP sees it</span></header>
        <StatementBlock fund={fund} report={report} />
      </section>
    </div>
  </Sheet>;
}

function StatementBlock({ fund, report }) {
  if (report.status === 'loading') return <div className="i6-skeleton" />;
  if (report.status === 'unreadable') return <Unreadable what="This LP's statement" claim="This is not a claim that they have no statement or distributions." onRetry={report.reload} />;
  const st = statementOf(report.data);
  const dists = (report.data?.distributions || []).map(distributionRow);
  return <>
    {!st.found ? <p className="lpr-empty">No position for this LP came back, so there is no statement to show.</p>
      : <dl className="lpr-kv lpr-wide" data-testid="lp-record-statement-figures">
        <dt>Commitment</dt><dd>{dollarsText(st.commitment)}</dd>
        <dt>Paid in</dt><dd>{dollarsText(st.paidIn)}</dd>
        <dt>Distributions</dt><dd>{dollarsText(st.distributed)}</dd>
        <dt>TVPI</dt><dd>{st.tvpi == null ? <span className="lpr-nr">Not recorded · nothing paid in</span> : `${st.tvpi.toFixed(2)}×`}</dd>
        <dt>NAV</dt><dd><span className="lpr-nr">Not recorded · the fund has no NAV</span></dd>
      </dl>}
    <h4>Distributions to this LP</h4>
    {!dists.length ? <p className="lpr-empty" data-testid="lp-record-dists-empty">No distribution to this LP is recorded.</p>
      : <div className="lpr-table"><table><thead><tr><th>Paid on</th><th className="right">Amount</th><th>Type</th><th>Status</th></tr></thead><tbody>
        {dists.map((d) => <tr key={d.id}><td>{d.on}</td><td className="right">{d.amount}</td><td>{d.type}</td><td>{d.status}</td></tr>)}
      </tbody></table></div>}
    <h4>Issued statements</h4>
    {!st.issuedRecorded ? <p className="lpr-empty" data-testid="lp-record-issued-unreadable">The issued statements could not be read. This is not a claim that none was issued.</p>
      : !st.issued.length ? <p className="lpr-empty" data-testid="lp-record-issued-empty">No capital statement has been issued to this LP.</p>
        : <ul className="lpr-list">{st.issued.map((s) => <li key={s.uid}><div><b>{s.period_label || 'Period not recorded'}</b><small>Issued {String(s.issued_at || '').slice(0, 10) || 'date not recorded'}{s.revision > 1 ? ` · revision ${s.revision}` : ''}</small></div></li>)}</ul>}
    <Link className="lpr-link" to={`/funds/reporting?fund=${fund.id}`} data-testid="link-lp-record-statement">Open their statement in Reporting</Link>
  </>;
}

/** Log a message: kind, subject, when it was sent, and an optional call line of this LP's. */
export function LogMessageForm({ form, setForm, onSubmit, lines }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, error: '' }));
  return <form className="lpr-form" onSubmit={onSubmit} data-testid="form-lp-record-log">
    <fieldset><legend>Kind</legend><div className="lpr-kinds">
      {Object.entries(COMM_KIND_LABELS).map(([k, label]) => <label key={k} className={form.kind === k ? 'on' : ''}>
        <input type="radio" name="lpr-kind" value={k} checked={form.kind === k} onChange={set('kind')} data-testid={`radio-lp-record-kind-${k}`} />{label}
      </label>)}
    </div></fieldset>
    <label>Subject<input value={form.subject} onChange={set('subject')} maxLength={200} data-testid="input-lp-record-subject" placeholder="What the message was about" /></label>
    <label>Sent on<input type="date" value={form.sentOn} onChange={set('sentOn')} data-testid="input-lp-record-sent" /></label>
    {lines.length > 0 && <label>Linked call <small>(optional)</small><select value={form.callId} onChange={set('callId')} data-testid="select-lp-record-call">
      <option value="">None</option>
      {lines.map((l) => <option key={l.id} value={String(l.id)}>{l.call}</option>)}
    </select></label>}
    <p className={form.error ? 'lpr-err' : 'lpr-cap'} role={form.error ? 'alert' : undefined} data-testid={form.error ? 'status-lp-record-log-error' : 'note-lp-record-log'}>
      {form.error || 'Logging records that you sent it, outside the platform. The body is not stored and nothing is sent.'}
    </p>
    <div className="lpr-actions">
      <button type="button" className="lpr-btn" onClick={() => setForm(null)}>Cancel</button>
      <button type="submit" className="lpr-btn p" disabled={form.busy} data-testid="button-lp-record-log-save">{form.busy ? 'Logging…' : 'Log message'}</button>
    </div>
  </form>;
}
