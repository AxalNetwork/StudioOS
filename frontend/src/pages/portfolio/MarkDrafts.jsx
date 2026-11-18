/**
 * D6909 part 4 (#6909, canvas PRM20 and PRM22) — Eadwyn's drafts on a mark request.
 *
 * - `ReasonDraft` (PRM20) sits under the request's reason. Eadwyn drafts the reason from the mark's age and the
 *   latest report the investor can read, and says which. Accept into reason, Edit (then Keep my edit) or Discard.
 *   Eadwyn never sends a request; the investor still reviews and sends it.
 * - `BasisProposal` (PRM22) sits above HQ's mark flow when it answers a request. Eadwyn proposes a basis, a source
 *   and an as-of day, never a value. Accept into the mark fills Prepare; HQ still reviews, confirms and records.
 *
 * Every run is quoted first: Ask Eadwyn reads the hold, and the run happens only on Confirm. When Eadwyn cannot be
 * asked, the panel says the form works without it. No browser pop-up; nothing here sends or records anything.
 */
import React, { useState } from 'react';
import { markRequestsApi } from '../../lib/api/markRequests';
import {
  BASIS_ACCEPT_NOTE, BASIS_NOTE, BASIS_OFF, NO_DRAFT, REASON_NOTE, REASON_OFF,
  draftError, holdLine, prepareSeed, proposalFacts, sourcesLine,
} from './markDraftsModel';

/** Quote → Confirm → run, shared by both drafts. */
function useAsk(scope, off) {
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const ask = async () => {
    setBusy('quote'); setNotice('');
    try { setQuote((await markRequestsApi.draftQuote(scope))?.quote || null); }
    catch (e) { setNotice(draftError(e, off)); }
    finally { setBusy(''); }
  };
  const run = async (onDraft) => {
    setBusy('run'); setNotice('');
    try {
      const out = await markRequestsApi.draftRun(scope, quote?.confirm_quote);
      setQuote(null);
      if (out?.draft) onDraft(out.draft); else setNotice(NO_DRAFT);
    } catch (e) {
      // A changed input needs a new quote: the Worker sends it with the refusal.
      if (e?.status === 402 && e?.data?.quote) setQuote(e.data.quote);
      setNotice(draftError(e, off));
    } finally { setBusy(''); }
  };
  return { quote, setQuote, busy, setBusy, notice, setNotice, ask, run };
}

function Ask({ a, onDraft, testId, word, confirmWord }) {
  if (a.quote) {
    return (
      <div className="pf-actions" data-testid={`${testId}-hold`}>
        <span className="pf-muted">{holdLine(a.quote) || 'The cost could not be read. Cancel and try again.'}</span>
        <button type="button" className="pf-btn is-primary" disabled={a.busy === 'run' || !holdLine(a.quote)} onClick={() => a.run(onDraft)} data-testid={`${testId}-run`}>{a.busy === 'run' ? 'Asking…' : confirmWord}</button>
        <button type="button" className="pf-btn" disabled={a.busy === 'run'} onClick={() => a.setQuote(null)} data-testid={`${testId}-cancel`}>Cancel</button>
      </div>
    );
  }
  return <div className="pf-actions"><button type="button" className="pf-btn" disabled={a.busy === 'quote'} onClick={a.ask} data-testid={`${testId}-ask`}>{a.busy === 'quote' ? 'Reading the cost…' : word}</button></div>;
}

/** PRM20: the investor's reason. `onUse` puts the kept words in the reason field. */
export function ReasonDraft({ projectUid, requestKind, onUse }) {
  const scope = { kind: 'reason', project_uid: projectUid, request_kind: requestKind };
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [done, setDone] = useState('');
  const a = useAsk(scope, REASON_OFF);
  const keep = async (reason) => {
    a.setBusy('accept'); a.setNotice('');
    try {
      const r = await markRequestsApi.draftAccept(draft.uid, scope, reason == null ? {} : { reason });
      onUse(r?.kept?.reason || ''); setDraft(null); setEditing(null);
      setDone(r?.draft?.status === 'edited' ? 'Your edit is in the reason.' : 'The draft is in the reason. You can still change it before you send.');
    } catch (e) { a.setNotice(draftError(e, REASON_OFF)); }
    finally { a.setBusy(''); }
  };
  const discard = async () => {
    a.setBusy('discard'); a.setNotice('');
    try { await markRequestsApi.draftDiscard(draft.uid, scope); setDraft(null); setEditing(null); setDone('Discarded. The reason is unchanged.'); }
    catch (e) { a.setNotice(draftError(e, REASON_OFF)); }
    finally { a.setBusy(''); }
  };
  return (
    <section className="pf-draft" aria-label="Eadwyn’s draft" data-testid="reason-draft">
      {!draft ? <Ask a={a} testId="reason-draft" word="Ask Eadwyn to draft the reason" confirmWord="Draft the reason" onDraft={(d) => { setDraft(d); setDone(''); }} /> : (
        <div data-testid="reason-draft-proposed">
          <p className="pf-muted">Eadwyn drafted a reason from the mark’s age and the latest report</p>
          {editing == null
            ? <p data-testid="reason-draft-text">{draft.reason}</p>
            : <textarea rows={3} maxLength={2000} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Your edit of the reason" data-testid="reason-draft-edit" />}
          {sourcesLine(draft.sources) ? <p className="pf-muted" data-testid="reason-draft-sources">{sourcesLine(draft.sources)}</p> : null}
          <div className="pf-actions">
            {editing == null ? (
              <>
                <button type="button" className="pf-btn is-primary" disabled={!!a.busy} onClick={() => keep(null)} data-testid="reason-draft-accept">Accept into reason</button>
                <button type="button" className="pf-btn" disabled={!!a.busy} onClick={() => setEditing(draft.reason)} data-testid="reason-draft-edit-open">Edit</button>
              </>
            ) : <button type="button" className="pf-btn is-primary" disabled={!!a.busy} onClick={() => keep(editing)} data-testid="reason-draft-keep">Keep my edit</button>}
            <button type="button" className="pf-btn" disabled={!!a.busy} onClick={discard} data-testid="reason-draft-discard">Discard</button>
          </div>
        </div>
      )}
      <p className="pf-muted">{REASON_NOTE}</p>
      {done ? <p className="pf-muted" role="status" data-testid="reason-draft-done">{done}</p> : null}
      {a.notice ? <p className="pf-muted" role="status" data-testid="reason-draft-notice">{a.notice}</p> : null}
    </section>
  );
}

/** PRM22: HQ's basis and source on one request. `onAccept` gets the seed for the mark's Prepare. */
export function BasisProposal({ requestUid, requester, company, onAccept }) {
  const scope = { kind: 'basis', request_uid: requestUid };
  const [draft, setDraft] = useState(null);
  const [done, setDone] = useState('');
  const a = useAsk(scope, BASIS_OFF);
  const decide = async (verb) => {
    a.setBusy(verb); a.setNotice('');
    try {
      if (verb === 'accept') {
        const r = await markRequestsApi.draftAccept(draft.uid, scope);
        onAccept(prepareSeed(r?.kept)); setDone('In Prepare. Check it, enter the value yourself, then review and record.');
      } else { await markRequestsApi.draftDiscard(draft.uid, scope); setDone('Discarded. Prepare is unchanged.'); }
      setDraft(null);
    } catch (e) { a.setNotice(draftError(e, BASIS_OFF)); }
    finally { a.setBusy(''); }
  };
  return (
    <section className="pf-draft" aria-label="Eadwyn’s proposal" data-testid="basis-proposal">
      <p className="pf-muted">On the request from {requester || 'an investor'}{company ? ` for ${company}` : ''}</p>
      {!draft ? <Ask a={a} testId="basis-proposal" word="Ask Eadwyn for a basis and source" confirmWord="Propose a basis" onDraft={(d) => { setDraft(d); setDone(''); }} /> : (
        <div data-testid="basis-proposal-proposed">
          <dl className="pf-kv">
            {proposalFacts(draft).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd data-testid={`basis-proposal-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd></React.Fragment>)}
          </dl>
          {draft.why ? <p className="pf-muted" data-testid="basis-proposal-why">{draft.why}</p> : null}
          {sourcesLine(draft.sources) ? <p className="pf-muted" data-testid="basis-proposal-sources">{sourcesLine(draft.sources)}</p> : null}
          <div className="pf-actions">
            <button type="button" className="pf-btn is-primary" disabled={!!a.busy} onClick={() => decide('accept')} data-testid="basis-proposal-accept">Accept into the mark</button>
            <button type="button" className="pf-btn" disabled={!!a.busy} onClick={() => decide('discard')} data-testid="basis-proposal-discard">Discard</button>
          </div>
          <p className="pf-muted">{BASIS_ACCEPT_NOTE}</p>
        </div>
      )}
      <p className="pf-muted">{BASIS_NOTE}</p>
      {done ? <p className="pf-muted" role="status" data-testid="basis-proposal-done">{done}</p> : null}
      {a.notice ? <p className="pf-muted" role="status" data-testid="basis-proposal-notice">{a.notice}</p> : null}
    </section>
  );
}
