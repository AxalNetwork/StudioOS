import React, { useState } from 'react';
import { reportingApi } from '../../lib/api/reporting';
import Sheet from '../../ui/Sheet.jsx';
import { Pill } from '../investor/PortfolioReports';
import { periodWord } from '../investor/portfolioReportsModel';
import {
  ASK, WAIVE, actionsOf, confirmLabel, obligationOf, openPeriodsOf, receiptOf, refusalOf, reviewOf,
} from './reportAsk';
import './reportAsk.css';

/**
 * D4817 part 9 (#5311, addendum PFA03–PFA05, PFA10) — "Ask for this report"
 * and "Waive this period" on a company's Reports, drawn to the addendum:
 *
 *   1. The obligation card (PFA03, PFA10) names the company, the period, its
 *      due day, what was received and what is missing, your last ask, the
 *      source document and the holding route, and offers the two actions the
 *      Worker would accept for that period and this session.
 *   2. Review (PFA04, PFA05): one Sheet per act, saying who acts, what is
 *      recorded, who is told and for which period. Nothing is sent until the
 *      confirm, which names the act, the company and the period.
 *   3. Receipt: what the Worker stored, from its answer alone. A refusal keeps
 *      the Review open, with the company and period still chosen, and shows
 *      the Worker's own sentence and code.
 *   4. Afterwards the company is read again, and the period reads as asked or
 *      waived from that read — who and when — never from the press.
 *
 * The rules are `reportAsk.js`; the styles `reportAsk.css`, on the frame's
 * tokens, which `.dark .pf-shell` redefines.
 */

function Facts({ rows, testid }) {
  return (
    <dl className="pf-ask-facts" data-testid={testid}>
      {rows.map(([k, v]) => (
        <div key={k} className="pf-ask-fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The obligation card for one period (PFA03 desktop, PFA10 phone): its facts, its record, and the actions this session may take. */
export function ReportObligation({ company, period, access, onAct, others = 0 }) {
  if (!period) {
    return (
      <section className="pf-card" data-testid="report-obligation-none">
        <h2 className="pf-h2">Reporting obligation</h2>
        <p className="pf-note">No period is open: every period owed to you so far was received or waived. Nothing is due to ask for.</p>
      </section>
    );
  }
  const o = obligationOf(company, period);
  const can = actionsOf(period, access);
  return (
    <section className="pf-card pf-ask-card" aria-labelledby={`pf-ask-${period.uid}`} data-testid="report-obligation">
      <div className="pf-card-head">
        <h2 className="pf-h2" id={`pf-ask-${period.uid}`}>{o.title}</h2>
        <Pill pill={o.pill} testId="report-obligation-pill" />
      </div>
      <Facts rows={o.facts} testid="report-obligation-facts" />
      {o.expected ? <p className="pf-foot" data-testid="report-obligation-expected">{o.expected}</p> : null}
      {o.record ? <p className="pf-ask-record" data-testid="report-obligation-record">{o.record.text}</p> : null}
      {access?.can ? (
        (can.ask || can.waive) ? (
          <div className="pf-ask-actions">
            {can.ask ? <button type="button" className="pf-btn is-primary" aria-haspopup="dialog" onClick={() => onAct(ASK, period.uid)} data-testid="report-obligation-ask">Ask for this report</button> : null}
            {can.waive ? <button type="button" className="pf-btn" aria-haspopup="dialog" onClick={() => onAct(WAIVE, period.uid)} data-testid="report-obligation-waive">Waive this period</button> : null}
          </div>
        ) : null
      ) : <p className="pf-note" data-testid="report-obligation-no-act">{access?.why}</p>}
      {access?.can && !can.ask && (period.state === 'due' || period.state === 'upcoming') ? <p className="pf-foot" data-testid="report-obligation-not-late">You can ask for a report once it is late.</p> : null}
      {access?.can && others > 0 ? <p className="pf-foot" data-testid="report-obligation-others">{others} other open {others === 1 ? 'period is' : 'periods are'} listed below, each with its own actions.</p> : null}
    </section>
  );
}

/** Review, confirm and Receipt for one act on one period, in the shared Sheet. */
export function ReportActionSheet({ kind, company, period, onClose }) {
  const [step, setStep] = useState('review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null);
  const review = reviewOf(kind, company, period);
  const label = confirmLabel(kind, company, period);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const out = kind === WAIVE ? await reportingApi.waive(period.uid) : await reportingApi.ask(period.uid);
      setAnswer(out || {});
      setStep('receipt');
    } catch (e) {
      // The Review stays, with the company and period still chosen, and the Worker's sentence.
      setError(refusalOf(e, kind));
    } finally { setBusy(false); }
  };
  const close = () => onClose(step === 'receipt' || Boolean(error));
  if (step === 'receipt') {
    const r = receiptOf(kind, answer, company, period);
    return (
      <Sheet label={r.title} eyebrow={`Receipt · ${company?.name || 'Company'}`} title={r.title} onClose={close} width={520} phone="sheet" testId="report-receipt"
        footer={<div className="pf-ask-foot"><button type="button" className="pf-btn is-primary" onClick={close} data-testid="report-receipt-done">Done</button></div>}>
        <div className="pf-ask-body">
          <p className="pf-ask-step">Step 2 of 2 · Receipt</p>
          <p role="status" className="pf-ask-ok" data-testid="report-receipt-status">{kind === WAIVE ? 'The period is waived. This is what the platform stored.' : 'Your request is recorded. This is what the platform stored.'}</p>
          <Facts rows={r.facts} testid="report-receipt-facts" />
          <p className="pf-foot">The period’s state below is read again from the record when you close this.</p>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet label={review.title} eyebrow={`Review · ${company?.name || 'Company'} · ${periodWord(period?.label)}`} title={review.title} onClose={close} width={520} phone="sheet" testId={`report-review-${kind}`}
      footer={(
        <div className="pf-ask-foot">
          <button type="button" className="pf-btn" onClick={close} disabled={busy} data-testid="report-review-cancel">Cancel</button>
          <button type="button" className="pf-btn is-primary" onClick={go} disabled={busy} aria-describedby={error ? 'pf-ask-error' : undefined} data-testid="report-review-confirm">{busy ? `${kind === WAIVE ? 'Waiving' : 'Asking'}…` : label}</button>
        </div>
      )}>
      <div className="pf-ask-body">
        <p className="pf-ask-step">Step 1 of 2 · Review. Nothing is sent until you confirm.</p>
        <Facts rows={review.facts} testid="report-review-facts" />
        {review.lines.map((l) => <p key={l} className="pf-ask-line">{l}</p>)}
        {error ? (
          <div role="alert" id="pf-ask-error" className="pf-ask-error" data-testid="report-review-error">
            <b>{kind === WAIVE ? 'Not waived.' : 'Not sent.'}</b> {error.message}
            {error.code ? <span className="pf-ask-code"> · {error.code}</span> : null}
            <span className="pf-ask-kept"> Your choice of {company?.name || 'company'} and {periodWord(period?.label)} is kept; confirm again or cancel.</span>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * The company Reports' actions: the obligation card for the most pressing open
 * period, and the Sheet for whichever period an action was pressed on (here or
 * on the timeline). `act` is lifted so the timeline can open the same flow.
 */
export function ReportAsk({ company, access, act, setAct, onChanged }) {
  const open = openPeriodsOf(company);
  const first = open[0] || null;
  const target = act ? (company?.periods || []).find((p) => p.uid === act.uid) : null;
  return (
    <>
      <ReportObligation company={company} period={first} access={access} onAct={(kind, uid) => setAct({ kind, uid })} others={Math.max(0, open.length - 1)} />
      {act && target ? (
        <ReportActionSheet key={`${act.kind}-${act.uid}`} kind={act.kind} company={company} period={target}
          onClose={(changed) => { setAct(null); if (changed) onChanged(); }} />
      ) : null}
    </>
  );
}
