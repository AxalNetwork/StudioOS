/**
 * D6261 (#6261): investor intro asks addressed to this founder
 * (GET /api/introductions/asks/received), each pending one with Accept and
 * Decline. The answer is the founder's own click; it tells the investor in the
 * app. Accepting opens the mutual NDA step, which the investor starts: it signs
 * nothing and makes no introduction by itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, RefreshCw, UserRoundSearch, X } from 'lucide-react';
import { investorAsksApi } from '../../lib/api/investorAsks.js';
import { askDate, askStatusLabel } from '../../lib/investorIntroRequest';
import { resolveIntroTarget } from '../../lib/introDestination';

const refusal = (error, fallback) => error?.data?.message || error?.message || fallback;
const FOUNDER_NOTE = {
  pending: 'Not answered. Accept to move to the mutual NDA, or decline.',
  accepted: 'You accepted. The investor starts the mutual NDA; nothing is signed yet.',
  declined: 'You declined.',
  withdrawn: 'The investor withdrew this ask before you answered.',
};

export default function FounderInvestorAsks() {
  const [params] = useSearchParams();
  const target = resolveIntroTarget(params);
  const highlighted = target.kind === 'ask' ? target.uid : '';
  const [asks, setAsks] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [lines, setLines] = useState({});

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await investorAsksApi.received();
      if (!Array.isArray(result?.asks)) throw new Error('Unrecognized response');
      setAsks(result.asks);
    } catch {
      setError('Investor asks addressed to you are unavailable right now.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (ask, decision) => {
    setBusy(ask.uid); setLines((current) => ({ ...current, [ask.uid]: '' }));
    try {
      const result = decision === 'accept' ? await investorAsksApi.accept(ask.uid) : await investorAsksApi.decline(ask.uid);
      setAsks((current) => (current || []).map((a) => (a.uid === ask.uid ? { ...a, status: result?.status || a.status } : a)));
      setLines((current) => ({ ...current, [ask.uid]: decision === 'accept' ? 'Accepted. The investor has been told.' : 'Declined. The investor has been told.' }));
    } catch (cause) {
      setLines((current) => ({ ...current, [ask.uid]: refusal(cause, 'Your answer could not be recorded. Reload and try again.') }));
    } finally { setBusy(''); }
  };

  return <section className="fn-rel-card" data-testid="founder-investor-asks">
    <div className="fn-rel-card-head"><div><UserRoundSearch size={16} /><h2>Investor asks</h2></div><span>Investors who asked to be introduced to you</span></div>
    {error ? <div className="fn-rel-alert" data-testid="status-investor-asks-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>
      : asks === null ? <p className="fn-rel-note" role="status" aria-busy="true">Reading investor asks…</p>
      : asks.length === 0 ? <p className="fn-rel-note" data-testid="empty-investor-asks">No investor has asked to be introduced to you.</p>
      : <div className="fn-rel-table-wrap"><table><thead><tr><th>Investor</th><th>Message</th><th>State</th><th>Answer</th></tr></thead><tbody>
        {asks.map((ask) => <tr key={ask.uid} data-testid={`row-investor-ask-${ask.uid}`} aria-current={ask.uid === highlighted ? 'true' : undefined} style={ask.uid === highlighted ? { outline: '2px solid var(--indigo)' } : undefined}>
          <td><strong>{ask.investor_name || 'Name not recorded'}</strong><small>{ask.investor_headline || `Asked ${askDate(ask.created_at)}`}</small></td>
          <td>{ask.message || 'No message was sent with this ask.'}</td>
          <td><span data-testid={`status-investor-ask-${ask.uid}`}>{askStatusLabel(ask.status)}</span><small>{FOUNDER_NOTE[ask.status] || 'This status is not one the ask route writes.'}</small></td>
          <td>{ask.status === 'pending'
            ? <span className="flex flex-wrap gap-2"><button type="button" onClick={() => decide(ask, 'accept')} disabled={Boolean(busy)} data-testid={`button-accept-investor-ask-${ask.uid}`}><Check size={12} />{busy === ask.uid ? 'Working' : 'Accept'}</button><button type="button" onClick={() => decide(ask, 'decline')} disabled={Boolean(busy)} data-testid={`button-decline-investor-ask-${ask.uid}`}><X size={12} />Decline</button></span>
            : <small>{ask.decided_at ? `${askStatusLabel(ask.status)} ${askDate(ask.decided_at)}` : 'Answered'}</small>}
            {lines[ask.uid] && <small role="status" data-testid={`line-investor-ask-${ask.uid}`}>{lines[ask.uid]}</small>}</td>
        </tr>)}
      </tbody></table></div>}
    <p className="fn-rel-note">An investor spends one of their quarterly asks to send one. Your answer reaches them only when you click Accept or Decline.</p>
  </section>;
}
