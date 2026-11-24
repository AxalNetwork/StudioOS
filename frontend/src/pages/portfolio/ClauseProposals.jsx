/**
 * D6907 part 2 (#6907, canvas PRM18 rail of `Portfolio v2 Rights and Request a Mark`): Eadwyn's proposal of a right
 * that is in the investor's signed paper but not recorded, on a company's Ownership & rights.
 *
 * It reads `GET /api/portfolio-clauses/:uid?type=` only for the types the rights read gives as not recorded with no
 * open request (`askable`), so it never proposes a recorded or already-requested right. Each proposal cites the
 * document, the clause and the page, and offers:
 *   Accept        one `POST /api/portfolio-rights/requests` with the clause as its description, and nothing else
 *   Edit wording  the description in a box first; Send to HQ then makes that same one request
 *   Discard       forgets the proposal on this page; nothing is sent or stored
 * A document that cannot be read is listed with its reason, so the card never reads as "none found" when it was not
 * read. Eadwyn never records a right; HQ does.
 */
import { useEffect, useState } from 'react';
import { portfolioClausesApi } from '../../lib/api/portfolioClauses';
import { portfolioRightsApi } from '../../lib/api/portfolioRights';
import { DESCRIPTION_MAX, RIGHT_WORDS, askProblem, askRefusal } from './rightsModel';
import {
  CLAUSES_SHAPE, CLAUSES_UNREADABLE, PROPOSAL_FOOT, RAIL_FOOT, noneFoundLine, proposalsOf, railState, unreadableDocs,
} from './clauseProposalModel';

function Proposal({ p, uid, onSent, onDiscard }) {
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const send = async (description) => {
    const problem = askProblem({ type: p.type, description }, [p.type]);
    if (problem) { setError(problem); return; }
    setSending(true); setError(null);
    try {
      await portfolioRightsApi.ask({ projectUid: uid, type: p.type, description: description.trim() });
      onSent(p);
    } catch (e) { setError(askRefusal(e)); setSending(false); }
  };
  return (
    <div className="pf-draft" data-testid={`clause-proposal-${p.type}`}>
      <span className="pf-chip is-pending">Proposal · {RIGHT_WORDS[p.type]}</span>
      <q data-testid={`clause-proposal-sentence-${p.type}`}>{p.sentence}</q>
      <p className="pf-muted" data-testid={`clause-proposal-cite-${p.type}`}>{p.cite}</p>
      {editing != null ? (
        <label>
          <span className="pf-rights-label">Where it is written</span>
          <textarea rows={4} maxLength={DESCRIPTION_MAX} value={editing} onChange={(e) => setEditing(e.target.value)}
            aria-label={`Your wording for ${RIGHT_WORDS[p.type]}`} data-testid={`clause-proposal-edit-${p.type}`} />
        </label>
      ) : null}
      {error ? <p className="pf-rights-error" role="alert" data-testid={`clause-proposal-error-${p.type}`}>{error}</p> : null}
      <div className="pf-actions">
        {editing == null ? (
          <>
            <button type="button" className="pf-btn is-primary" disabled={sending} onClick={() => send(p.description)} data-testid={`button-clause-accept-${p.type}`}>{sending ? 'Sending…' : 'Accept'}</button>
            <button type="button" className="pf-btn" disabled={sending} onClick={() => { setEditing(p.description); setError(null); }} data-testid={`button-clause-edit-${p.type}`}>Edit wording</button>
          </>
        ) : (
          <button type="button" className="pf-btn is-primary" disabled={sending} onClick={() => send(editing)} data-testid={`button-clause-send-${p.type}`}>{sending ? 'Sending…' : 'Send to HQ'}</button>
        )}
        <button type="button" className="pf-btn" disabled={sending} onClick={() => onDiscard(p)} data-testid={`button-clause-discard-${p.type}`}>Discard</button>
      </div>
      <p className="pf-muted">{PROPOSAL_FOOT}</p>
    </div>
  );
}

/**
 * `askable` is `askableTypes(rightsRows(...))`, or null while the rights are not read (then nothing is proposed).
 * `onSent(type)` says what was sent and refreshes the rights read, so the new request shows as open and its type
 * leaves `askable`.
 */
export default function ClauseProposals({ uid, askable, onSent }) {
  const key = (askable || []).join(',');
  const [read, setRead] = useState({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [discarded, setDiscarded] = useState([]);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    setRead({ state: 'loading' });
    portfolioClausesApi.get(uid, { types: key.split(',') })
      .then((v) => { if (live) setRead(CLAUSES_SHAPE(v) ? { state: 'ok', value: v } : { state: 'unreadable' }); })
      .catch(() => { if (live) setRead({ state: 'unreadable' }); });
    return () => { live = false; };
  }, [uid, key, attempt]);

  const state = railState({ askable, read });
  if (state === 'nothing_to_ask') return null;
  const proposals = state === 'proposals' ? proposalsOf(read.value, askable).filter((p) => !discarded.includes(p.key)) : [];
  const unread = read.state === 'ok' ? unreadableDocs(read.value) : [];
  return (
    <aside className="pf-card pf-rights-card" aria-label="Eadwyn" data-testid="clause-proposals">
      <div className="pf-card-head">
        <h3 className="pf-h2">Eadwyn</h3>
        <span className="pf-chip">Proposals only · you decide</span>
      </div>
      {state === 'loading' ? <p className="pf-sm" aria-busy="true" data-testid="clause-proposals-loading">Reading your signed documents…</p> : null}
      {state === 'unreadable' ? (
        <p className="pf-sm" role="alert" data-testid="clause-proposals-unreadable">
          {CLAUSES_UNREADABLE} <button type="button" className="pf-btn is-quiet" onClick={() => setAttempt((n) => n + 1)} data-testid="button-retry-clauses">Retry</button>
        </p>
      ) : null}
      {state === 'no_documents' ? <p className="pf-sm" data-testid="clause-proposals-no-documents">You hold no signed document for this company that Eadwyn can read, so it has nothing to propose.</p> : null}
      {state === 'none_found' ? <p className="pf-sm" data-testid="clause-proposals-none">{noneFoundLine(read.value)}</p> : null}
      {state === 'unreadable_all' ? <p className="pf-sm" role="alert" data-testid="clause-proposals-unreadable-all">Eadwyn could not read any of your signed documents for this company, so it cannot say whether one grants a right.</p> : null}
      {state === 'proposals' && !proposals.length ? <p className="pf-sm" data-testid="clause-proposals-all-discarded">You discarded every proposal. Nothing was sent.</p> : null}
      {proposals.map((p) => (
        <Proposal key={p.key} p={p} uid={uid}
          onSent={(x) => { setDiscarded((d) => [...d, x.key]); onSent?.(x.type); }}
          onDiscard={(x) => setDiscarded((d) => [...d, x.key])} />
      ))}
      {unread.length ? (
        <ul className="pf-sm" data-testid="clause-proposals-unread">
          {unread.map((d) => <li key={d.key} data-testid={`clause-unread-${d.key}`}>Not read: {d.title}. {d.reason}</li>)}
        </ul>
      ) : null}
      <p className="pf-muted">{RAIL_FOOT}</p>
    </aside>
  );
}
