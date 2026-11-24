/**
 * D6261 (#6261): one of the investor's own intro asks on the Asked view, with
 * what may happen to it next. Pending: Withdraw (a slot spent this quarter
 * comes back). Accepted: start the existing Trust Center NDA step
 * (POST /api/trust/intro/request), which is the investor's own click and signs
 * nothing by itself. Every status shown is one the Worker writes.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { investorAsksApi } from '../../lib/api/investorAsks.js';
import { askDate, askStatusLabel, askStatusNote, askTargetName, withdrawnLine } from '../../lib/investorIntroRequest';

const refusal = (error, fallback) => error?.data?.message || error?.message || fallback;

export default function InvestorAskCard({ ask, namesUnreadable, highlighted, age, onWithdrawn }) {
  const [busy, setBusy] = useState('');
  const [line, setLine] = useState('');
  const [nda, setNda] = useState(null);

  const withdraw = async () => {
    setBusy('withdraw'); setLine('');
    try {
      const result = await investorAsksApi.withdraw(ask.uid);
      setLine(withdrawnLine(result));
      onWithdrawn?.(result);
    } catch (error) {
      setLine(refusal(error, 'The ask could not be withdrawn. Reload your asks before trying again.'));
    } finally { setBusy(''); }
  };
  const startNda = async () => {
    setBusy('nda'); setLine('');
    try {
      const result = await api.trustIntroRequest(ask.nda_founder_user_id);
      setNda(result?.status === 'already_active' ? 'active' : 'issued');
    } catch (error) {
      setLine(refusal(error, 'The NDA could not be started. Nothing was sent; try again.'));
    } finally { setBusy(''); }
  };

  return <article className={`inw-proposition${highlighted ? ' highlighted' : ''}`} data-testid={`card-ask-${ask.uid}`} aria-current={highlighted ? 'true' : undefined}>
    <div className="inw-prop-top"><span className="inw-prop-label">Asked · {ask.quarter || 'quarter not recorded'}</span><span className="inw-state" data-testid={`status-ask-${ask.uid}`}>{askStatusLabel(ask.status)}</span></div>
    <strong data-testid={`target-ask-${ask.uid}`}>{askTargetName(ask, namesUnreadable)}</strong>
    <p data-testid={`message-ask-${ask.uid}`}>{ask.message ? ask.message : 'No message was sent with this ask.'}</p>
    <p className="inw-footnote" data-testid={`note-ask-${ask.uid}`}>{askStatusNote(ask)}{ask.decided_at && ask.status !== 'pending' ? ` ${askStatusLabel(ask.status)} ${askDate(ask.decided_at)}.` : ''}</p>
    <div className="inw-prop-actions">
      <span className="inw-state" data-testid={`date-ask-${ask.uid}`}>Asked {askDate(ask.created_at)} · {age(ask.created_at)}</span>
      {ask.status === 'pending' && <button type="button" className="quiet" onClick={withdraw} disabled={Boolean(busy)} data-testid={`button-withdraw-ask-${ask.uid}`}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw ask'}</button>}
      {ask.status === 'accepted' && ask.nda_founder_user_id && !nda && <button type="button" onClick={startNda} disabled={Boolean(busy)} data-testid={`button-nda-ask-${ask.uid}`}>{busy === 'nda' ? 'Starting…' : 'Start the mutual NDA'}</button>}
    </div>
    {nda === 'issued' && <p role="status" data-testid={`nda-ask-${ask.uid}`}>The mutual NDA was sent for signature. Sign it in your <Link to="/trust">Trust Center</Link>.</p>}
    {nda === 'active' && <p role="status" data-testid={`nda-ask-${ask.uid}`}>A mutual NDA with this founder is already active. See your <Link to="/trust">Trust Center</Link>.</p>}
    {line && <p role="status" data-testid={`line-ask-${ask.uid}`}>{line}</p>}
  </article>;
}
