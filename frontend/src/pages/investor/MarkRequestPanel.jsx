/**
 * D6205 (#6205), D6909 part 2 (#6909, PRM20 · PRM21 · PRM23): "Ask HQ" in the
 * mark-history Sheet. An investor asks HQ to record a current mark, correct
 * the recorded one, or record a missing follow-on round for the company the
 * Sheet is about, and reads every request's state afterwards.
 *
 * The request goes Prepare → Review → Confirm → Receipt (PF-07's four steps):
 *   Prepare   company fixed, the latest mark with its age, the kind, a
 *             required reason, optional evidence (a link or one PDF, PNG,
 *             JPEG or WebP file of at most 10 MB, never both)
 *   Review    what HQ will see; nobody else sees it
 *   Confirm   what changes now and what does not; Send
 *   Receipt   read from the stored row the Worker returned: Requested on its
 *             day, the kind and the evidence
 * A refused or failed send keeps the reason and the evidence on screen.
 *
 * Under it, "Your requests · newest first": Requested, Answered (a mark
 * recorded, in the history above) or Declined with HQ's reason.
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
 *   none         no request: "Request a mark…" opens the steps
 */
import { useState } from 'react';
import {
  REQUEST_KINDS, REASON_MAX, REQUEST_STEPS, EVIDENCE_ACCEPT, defaultKind, prepareProblem, refusalWords, requestStatusOf,
  kindLabel, draftEvidenceWords, evidenceWords, requestCountWords,
} from '../portfolio/markRequestModel';
import { day } from '../portfolio/portfolioModel';

function Steps({ at }) {
  return (
    <ol className="pf-steps" aria-label="Request steps" data-testid="mark-request-steps">
      {REQUEST_STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className={i === at ? 'is-current' : i < at ? 'is-done' : ''}>{s}</li>
      ))}
    </ol>
  );
}

function Facts({ rows }) {
  return (
    <dl className="pf-facts">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

/** One request in the company's list, with its chip and what HQ said. */
function RequestItem({ req }) {
  const s = requestStatusOf(req);
  if (!s) return null;
  const tone = s.state === 'requested' ? '' : s.state === 'resolved' ? 'is-ok' : 'is-late';
  const ev = evidenceWords(req.evidence);
  return (
    <li className="pf-request-item" data-testid={`mark-request-item-${req.uid}`} data-state={s.state}>
      <span className="pf-mono">{day(req.created_at) || 'Date not recorded'}</span>
      {' · '}<b>{s.kind || 'Request'}</b>{' '}
      <span className={`pf-chip ${tone}`}>{s.label}</span>
      {s.reason ? <p className="pf-foot">{s.reason}</p> : null}
      {ev ? <p className="pf-foot">Evidence · {ev}</p> : null}
      {s.state === 'resolved' && s.markUid ? <p className="pf-foot">The mark recorded is in the history above.</p> : null}
      {s.state === 'declined' && s.note ? <p className="pf-foot" data-testid="mark-request-declined-reason">HQ’s reason: “{s.note}”</p> : null}
      {s.state === 'resolved' && s.note ? <p className="pf-foot">HQ: {s.note}</p> : null}
    </li>
  );
}

export function RequestList({ list }) {
  if (!list || !list.length) return null;
  return (
    <div data-testid="mark-request-list">
      <p className="pf-foot"><b>Your requests · newest first</b> · {requestCountWords(list)}</p>
      <ul className="pf-request-list">{list.map((r) => <RequestItem key={r.uid} req={r} />)}</ul>
      <p className="pf-foot">One open request per company · you can ask again once HQ answers.</p>
    </div>
  );
}

/** The four steps. `latest` is `{ date, age }` of the latest mark, or null. */
export function RequestSteps({ row, latest, initialStep = 0, initialDraft, initialReceipt = null, onSend, onCancel }) {
  const [step, setStep] = useState(initialStep);
  const [kind, setKind] = useState(initialDraft?.kind || defaultKind(row));
  const [reason, setReason] = useState(initialDraft?.reason || '');
  const [mode, setMode] = useState(initialDraft?.file ? 'file' : initialDraft?.link ? 'link' : 'none');
  const [link, setLink] = useState(initialDraft?.link || '');
  const [file, setFile] = useState(initialDraft?.file || null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(initialReceipt);

  const draft = { kind, reason, link: mode === 'link' ? link : '', file: mode === 'file' ? file : null };
  const problem = prepareProblem(draft);
  const evidence = draftEvidenceWords(draft);
  const latestWords = latest && latest.date ? `${latest.date}${latest.age ? ` · ${latest.age}` : ''}` : 'No mark recorded';

  if (receipt) {
    const s = requestStatusOf(receipt);
    return (
      <div data-testid="mark-request-receipt">
        <Steps at={3} />
        <p className="pf-ok" role="status">✓ {s?.date ? `Requested ${s.date}` : 'Requested'}. HQ is told. You will see the answer here and on Positions.</p>
        <Facts rows={[
          ['Company', row.name],
          ['Kind', kindLabel(receipt.kind) || 'Request'],
          ['State', s?.label || 'Requested'],
          ['Evidence', evidenceWords(receipt.evidence) || 'None'],
        ]} />
        <div className="pf-actions"><button type="button" className="pf-btn is-primary" onClick={onCancel} data-testid="button-mark-request-done">Done</button></div>
      </div>
    );
  }

  const send = async () => {
    if (problem || sending) return;
    setSending(true); setError(null);
    try {
      const stored = await onSend({
        kind, reason: reason.trim(),
        ...(draft.link ? { evidenceUrl: draft.link.trim() } : {}),
        ...(draft.file ? { evidenceFile: draft.file } : {}),
      });
      setReceipt(stored && typeof stored === 'object' ? stored : { kind, state: 'open', created_at: null, evidence: null });
    } catch (err) {
      setError(refusalWords(err));
    } finally { setSending(false); }
  };

  if (step === 1) {
    return (
      <div data-testid="mark-request-review">
        <Steps at={1} />
        <p className="pf-foot">What HQ will see. Nobody else sees it.</p>
        <Facts rows={[['Company', row.name], ['Kind', kindLabel(kind)], ['Reason', reason.trim()], ['Evidence', evidence]]} />
        <p className="pf-foot">One open request per company, per investor.</p>
        <div className="pf-actions">
          <button type="button" className="pf-btn is-primary" onClick={() => setStep(2)} data-testid="button-mark-request-confirm-step">Continue to confirm</button>
          <button type="button" className="pf-btn is-quiet" onClick={() => setStep(0)} data-testid="button-mark-request-back">Back</button>
        </div>
      </div>
    );
  }
  if (step === 2) {
    return (
      <div data-testid="mark-request-confirm">
        <Steps at={2} />
        <p>Send this request to HQ? <b>{kindLabel(kind)}</b> for <b>{row.name}</b>. You can have one open request for this company until HQ answers.</p>
        <Facts rows={[
          ['What changes now', 'A request is stored and HQ is told'],
          ['What does not change', 'Your mark, NAV and Positions figures stay as they are until HQ records a mark'],
        ]} />
        {sending ? <p className="pf-muted" role="status">Sending your request…</p> : null}
        {error ? <p className="pf-failure" role="alert" data-testid="mark-request-error">{error} Your reason{draft.file || draft.link ? ' and evidence are' : ' is'} kept.</p> : null}
        <div className="pf-actions">
          <button type="button" className="pf-btn is-primary" onClick={send} disabled={sending} data-testid="button-send-mark-request">
            {sending ? 'Sending…' : error ? 'Try again' : 'Send request'}
          </button>
          <button type="button" className="pf-btn is-quiet" onClick={() => setStep(1)} disabled={sending}>Back</button>
        </div>
      </div>
    );
  }
  return (
    <form className="pf-request-form" onSubmit={(e) => { e.preventDefault(); if (!problem) setStep(1); }} data-testid="mark-request-form">
      <Steps at={0} />
      <p className="pf-foot">Ask HQ about <b>{row.name}</b>. HQ records marks; this sends a request, not a mark.</p>
      <Facts rows={[['Company', `${row.name} · fixed`], ['Latest mark', latestWords]]} />
      <label htmlFor="pf-request-kind">What you are asking for</label>
      <select id="pf-request-kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="select-mark-request-kind">
        {REQUEST_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <label htmlFor="pf-request-reason">Reason · required</label>
      <textarea id="pf-request-reason" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="What is stale, wrong or missing, and what you know of it" data-testid="input-mark-request-reason" />
      <fieldset className="pf-evidence" data-testid="mark-request-evidence">
        <legend>Evidence · optional</legend>
        {['none', 'link', 'file'].map((m) => (
          <label key={m} className="pf-radio">
            <input type="radio" name="pf-evidence-mode" value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`radio-evidence-${m}`} />
            {m === 'none' ? 'None' : m === 'link' ? 'A link' : 'A file'}
          </label>
        ))}
        {mode === 'link' ? (
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" maxLength={2000}
            aria-label="Evidence link" data-testid="input-mark-request-link" />
        ) : null}
        {mode === 'file' ? (
          <input type="file" accept={EVIDENCE_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)}
            aria-label="Evidence file" data-testid="input-mark-request-file" />
        ) : null}
        <p className="pf-foot">A PDF, PNG, JPEG or WebP file of at most 10 MB, or one link. HQ alone reads it.</p>
      </fieldset>
      {problem && (reason.trim() || draft.link || draft.file) ? <p className="pf-failure" data-testid="mark-request-problem">{problem}</p> : null}
      <div className="pf-actions">
        <button type="submit" className="pf-btn is-primary" disabled={Boolean(problem)} title={problem || undefined} data-testid="button-review-mark-request">Review request</button>
        <button type="button" className="pf-btn is-quiet" onClick={onCancel} data-testid="button-cancel-mark-request">Cancel</button>
      </div>
    </form>
  );
}

export default function MarkRequestPanel({ row, read, request, list = [], latest = null, startOpen = false, onSend, onRetry }) {
  // An open request is never followed by a second one: Request a mark… does not open the steps over it.
  const [open, setOpen] = useState(() => Boolean(startOpen) && requestStatusOf(request)?.state !== 'requested');
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
  } else if (status && status.state === 'requested' && !open) {
    body = (
      <div data-testid="mark-request-open">
        <span className="pf-chip" data-testid="mark-request-state">{status.label}</span>
        <p className="pf-foot"><b>{status.kind || 'Request'}</b>{status.reason ? ` · ${status.reason}` : ''}</p>
        <p className="pf-foot">HQ answers it here. One request per company is open at a time.</p>
      </div>
    );
  } else if (open) {
    // Once stored, the request is the company's open one; the steps stay on their Receipt until Done.
    body = <RequestSteps row={row} latest={latest} onSend={onSend} onCancel={() => setOpen(false)} />;
  } else {
    body = (
      <div data-testid={status ? 'mark-request-answered' : 'mark-request-none'}>
        {status ? (
          <>
            <span className={`pf-chip ${status.state === 'resolved' ? 'is-ok' : 'is-late'}`} data-testid="mark-request-state">{status.label}</span>
            <p className="pf-foot"><b>{status.kind || 'Request'}</b>{status.note ? ` · HQ: ${status.note}` : ''}
              {status.markUid ? ' · the mark recorded is in the history above.' : ''}</p>
          </>
        ) : <p className="pf-foot">You have not asked HQ for a mark for {row.name}.</p>}
        <button type="button" className="pf-btn" onClick={() => setOpen(true)} data-testid="button-open-mark-request">
          {status ? 'Send another request…' : 'Request a mark…'}
        </button>
      </div>
    );
  }
  const dataState = read.state !== 'ok' ? read.state : open ? 'drafting' : (status?.state || 'none');
  return (
    <section aria-labelledby="pf-request-title" data-testid="mark-request-panel" data-state={dataState}>
      <h3 id="pf-request-title">Ask HQ</h3>
      {body}
      {read.state === 'ok' && !open ? <RequestList list={list} /> : null}
    </section>
  );
}

/** The register's short form, beside a Stale chip or a missing mark. */
export function RequestChip({ request, onRequest, name }) {
  const status = requestStatusOf(request);
  if (status && status.state === 'requested') return <span className="pf-chip" data-testid="chip-mark-requested">{status.label}</span>;
  return (
    <button type="button" className="pf-link-button pf-request-link" onClick={onRequest} aria-label={`Request a mark for ${name}`} data-testid="button-request-mark">
      Request a mark…
    </button>
  );
}
