/**
 * D6205 part 2 (#6205): investors' requests to HQ on the admin position sheet.
 * For the company the sheet is about, HQ reads who asked, for what, why and
 * when, and answers each open request: Resolve (linking the mark recorded, or
 * for a follow-on round a note) or Decline (with a note). Answered requests
 * read their state and date.
 *
 * Prop-driven and exported for its own tests. The page owns the read
 * (`markRequestsApi.list({ projectUid })`) and the write
 * (`markRequestsApi.answer`). Answering never records a mark: that stays the
 * write flow above it (D4817 part 7); the mark just recorded there is the one
 * a Resolve starts on.
 *
 * States, kept apart:
 *   loading      the requests are being read
 *   unreadable   they could not be read: no answer is offered, and the sheet
 *                never says there are none; Retry
 *   none         no investor has asked about this company
 *   list         open requests (each with its answer form), then answered ones
 */
import { useState } from 'react';
import {
  REASON_MAX, adminRequestsOf, answerProblem, answerRefusalWords, defaultMarkUid, kindLabel, needsMark, requestStatusOf, requesterOf,
} from './markRequestModel';
import { day } from './portfolioModel';

const BTN = 'px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-lg text-xs font-medium dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';
const PRIMARY = 'px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium dark:bg-violet-500 dark:hover:bg-violet-600';
const INPUT = 'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100';
const MUTED = 'text-sm text-gray-500 dark:text-gray-400';

const markLine = (m) => `${m.as_of_date || 'Date not recorded'} · ${m.fmv == null ? 'FMV not recorded' : `$${Number(m.fmv).toLocaleString()}`}`;

function AnswerForm({ req, marks, justRecorded, onAnswer }) {
  const [state, setState] = useState('');
  // The form is on the sheet before a mark is recorded, so the default is
  // taken when Resolve is pressed, not when the form first renders.
  const [markUid, setMarkUid] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const withMark = state === 'resolved' && needsMark(req.kind);
  const problem = answerProblem({ kind: req.kind, state, markUid: withMark ? markUid : null, note });

  const send = async (e) => {
    e.preventDefault();
    if (problem || sending) return;
    setSending(true); setError(null);
    try {
      await onAnswer(req, { state, markUid: withMark ? markUid : null, note: note.trim() || null });
    } catch (err) {
      setError(answerRefusalWords(err));
    } finally { setSending(false); }
  };

  if (!state) {
    return (
      <div className="flex gap-2 mt-2">
        <button type="button" className={BTN} onClick={() => { setMarkUid((cur) => cur || defaultMarkUid(marks, justRecorded)); setState('resolved'); }} data-testid={`button-resolve-${req.uid}`}>Resolve…</button>
        <button type="button" className={BTN} onClick={() => setState('declined')} data-testid={`button-decline-${req.uid}`}>Decline…</button>
      </div>
    );
  }
  return (
    <form className="mt-2 space-y-2" onSubmit={send} data-testid={`form-answer-${req.uid}`} data-answer={state}>
      {withMark && (
        <label className="block text-xs text-gray-600 dark:text-gray-400">
          The mark recorded for this request
          {(marks || []).length === 0 ? (
            <span className={`block ${MUTED}`} data-testid={`answer-no-marks-${req.uid}`}>
              No mark is recorded for this company yet. Record one above, then link it here.
            </span>
          ) : (
            <select className={INPUT} value={markUid} onChange={(e) => setMarkUid(e.target.value)} data-testid={`select-answer-mark-${req.uid}`}>
              <option value="">Choose a mark…</option>
              {marks.map((m) => <option key={m.uid} value={m.uid}>{markLine(m)}{m.uid === justRecorded ? ' (just recorded)' : ''}</option>)}
            </select>
          )}
        </label>
      )}
      <label className="block text-xs text-gray-600 dark:text-gray-400">
        {state === 'declined' ? 'Why it is declined' : withMark ? 'Note for the investor (optional)' : 'How the follow-on round was recorded'}
        <textarea className={INPUT} rows={2} maxLength={REASON_MAX} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`input-answer-note-${req.uid}`} />
      </label>
      {error ? <p className="text-sm text-rose-700 dark:text-rose-300" role="alert" data-testid={`answer-error-${req.uid}`}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={Boolean(problem) || sending} title={problem || undefined} data-testid={`button-send-answer-${req.uid}`}>
          {sending ? 'Saving…' : state === 'declined' ? 'Decline request' : 'Resolve request'}
        </button>
        <button type="button" className={BTN} onClick={() => { setState(''); setError(null); }} data-testid={`button-cancel-answer-${req.uid}`}>Cancel</button>
      </div>
    </form>
  );
}

export default function MarkRequestsAdmin({ companyName, read, marks = [], justRecorded = null, onAnswer, onRetry }) {
  let body;
  if (read.state === 'loading') {
    body = <p className={MUTED} data-testid="admin-mark-requests-loading">Reading investors’ requests…</p>;
  } else if (read.state !== 'ok') {
    body = (
      <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="admin-mark-requests-unreadable">
        Investors’ requests for {companyName} could not be read, so whether any is open is not known. That is not a claim that none is.
        {' '}<button type="button" className="underline" onClick={onRetry} data-testid="button-retry-admin-mark-requests">Retry</button>
      </p>
    );
  } else {
    const { open, answered } = adminRequestsOf(read.items);
    if (open.length === 0 && answered.length === 0) {
      body = <p className={MUTED} data-testid="admin-mark-requests-none">No investor has asked HQ about {companyName}.</p>;
    } else {
      body = (
        <div className="space-y-3">
          {open.length === 0 ? <p className={MUTED} data-testid="admin-mark-requests-no-open">No request is open.</p> : null}
          {open.map((req) => (
            <div key={req.uid} className="border border-amber-200 dark:border-amber-800 rounded-lg p-3" data-testid={`admin-mark-request-${req.uid}`} data-state="open">
              <p className="text-sm text-gray-900 dark:text-gray-100">
                <b>{kindLabel(req.kind) || 'Request'}</b> · {requesterOf(req)}
                {' · '}<span data-testid={`admin-mark-request-date-${req.uid}`}>{day(req.created_at) ? `Requested · ${day(req.created_at)}` : 'Requested'}</span>
              </p>
              {req.reason ? <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{req.reason}</p> : null}
              <AnswerForm req={req} marks={marks} justRecorded={justRecorded} onAnswer={onAnswer} />
            </div>
          ))}
          {answered.map((req) => {
            const s = requestStatusOf(req);
            const mark = s?.markUid ? (marks || []).find((m) => m.uid === s.markUid) : null;
            return (
              <div key={req.uid} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3" data-testid={`admin-mark-request-${req.uid}`} data-state={req.state}>
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  <b>{kindLabel(req.kind) || 'Request'}</b> · {requesterOf(req)} · <span data-testid={`admin-mark-request-date-${req.uid}`}>{s?.label}</span>
                </p>
                {s?.markUid ? <p className={MUTED}>Linked mark: {mark ? markLine(mark) : s.markUid}</p> : null}
                {s?.note ? <p className={MUTED}>HQ: {s.note}</p> : null}
              </div>
            );
          })}
        </div>
      );
    }
  }
  return (
    <section aria-labelledby="pf-admin-requests-title" data-testid="admin-mark-requests" data-state={read.state}>
      <h3 id="pf-admin-requests-title" className="font-semibold text-gray-900 dark:text-gray-100 mb-2 mt-6">Investors’ requests</h3>
      {body}
    </section>
  );
}
