/**
 * D6205 (#6205): "Ask HQ" in the mark-history Sheet. An investor asks HQ to
 * record a current mark, correct the recorded one, or record a missing
 * follow-on round for the company the Sheet is about, and reads the answer's
 * state afterwards: Requested, Resolved or Declined, each with its date.
 *
 * Prop-driven and exported for its own tests. The page owns the reads
 * (`markRequestsApi.list`) and the write (`markRequestsApi.create`).
 *
 * States, kept apart:
 *   loading      the requests are being read
 *   unreadable   they could not be read: no form is offered, because whether a
 *                request is already open is not known; Retry
 *   requested    an open request: its kind, reason and date. No second one.
 *   answered     resolved or declined, with HQ's note; a new request may follow
 *   none         no request: "Request…" opens the form
 */
import { useState } from 'react';
import { REQUEST_KINDS, REASON_MAX, defaultKind, draftProblem, refusalWords, requestStatusOf } from '../portfolio/markRequestModel';

export default function MarkRequestPanel({ row, read, request, startOpen = false, onSend, onRetry }) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [kind, setKind] = useState(() => defaultKind(row));
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const status = requestStatusOf(request);
  let body;
  if (read.state === 'loading') {
    body = <p className="pf-muted" data-testid="mark-request-loading">Reading your requests…</p>;
  } else if (read.state !== 'ok') {
    body = (
      <p className="pf-unreadable" data-testid="mark-request-unreadable">
        Your requests could not be read, so whether one is already open is not known. That is not a claim that none is.
        {' '}<button type="button" className="pf-link-button" onClick={onRetry} data-testid="button-retry-mark-requests">Retry</button>
      </p>
    );
  } else if (status && status.state === 'requested') {
    body = (
      <div data-testid="mark-request-open">
        <span className="pf-chip is-late" data-testid="mark-request-state">{status.label}</span>
        <p className="pf-foot"><b>{status.kind || 'Request'}</b>{status.reason ? ` · ${status.reason}` : ''}</p>
        <p className="pf-foot">HQ answers it here. One request per company is open at a time.</p>
      </div>
    );
  } else if (open) {
    const problem = draftProblem({ kind, reason });
    const send = async (e) => {
      e.preventDefault();
      if (problem || sending) return;
      setSending(true); setError(null);
      try {
        await onSend({ kind, reason: reason.trim() });
        setOpen(false); setReason('');
      } catch (err) {
        setError(refusalWords(err));
      } finally { setSending(false); }
    };
    body = (
      <form className="pf-request-form" onSubmit={send} data-testid="mark-request-form">
        <p className="pf-foot">Ask HQ about <b>{row.name}</b>. HQ records marks; this sends a request, not a mark.</p>
        <label htmlFor="pf-request-kind">What you are asking for</label>
        <select id="pf-request-kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="select-mark-request-kind">
          {REQUEST_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <label htmlFor="pf-request-reason">Reason</label>
        <textarea id="pf-request-reason" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="What is stale, wrong or missing, and what you know of it" data-testid="input-mark-request-reason" />
        {error ? <p className="pf-failure" role="alert" data-testid="mark-request-error">{error}</p> : null}
        <div className="pf-actions">
          <button type="submit" className="pf-btn is-primary" disabled={Boolean(problem) || sending} title={problem || undefined} data-testid="button-send-mark-request">
            {sending ? 'Sending…' : 'Send request'}
          </button>
          <button type="button" className="pf-btn is-quiet" onClick={() => { setOpen(false); setError(null); }} data-testid="button-cancel-mark-request">Cancel</button>
        </div>
      </form>
    );
  } else {
    body = (
      <div data-testid={status ? 'mark-request-answered' : 'mark-request-none'}>
        {status ? (
          <>
            <span className={`pf-chip ${status.state === 'resolved' ? 'is-ok' : 'is-late'}`} data-testid="mark-request-state">{status.label}</span>
            <p className="pf-foot"><b>{status.kind || 'Request'}</b>{status.note ? ` · HQ: ${status.note}` : ''}
              {status.markUid ? ' · the mark recorded is in the history above.' : ''}</p>
          </>
        ) : <p className="pf-foot">No request sent for {row.name}.</p>}
        <button type="button" className="pf-btn" onClick={() => setOpen(true)} data-testid="button-open-mark-request">
          {status ? 'Send another request…' : 'Request a mark or correction…'}
        </button>
      </div>
    );
  }
  return (
    <section aria-labelledby="pf-request-title" data-testid="mark-request-panel" data-state={read.state === 'ok' ? (status?.state || (open ? 'drafting' : 'none')) : read.state}>
      <h3 id="pf-request-title">Ask HQ</h3>
      {body}
    </section>
  );
}

/** The register's short form, beside a Stale chip or a missing mark. */
export function RequestChip({ request, onRequest, name }) {
  const status = requestStatusOf(request);
  if (status && status.state === 'requested') return <span className="pf-chip" data-testid="chip-mark-requested">{status.label}</span>;
  return (
    <button type="button" className="pf-link-button pf-request-link" onClick={onRequest} aria-label={`Request a mark for ${name}`} data-testid="button-request-mark">
      Request…
    </button>
  );
}

