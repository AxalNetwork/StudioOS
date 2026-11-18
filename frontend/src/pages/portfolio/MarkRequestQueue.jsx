/**
 * D6909 part 2 (#6909, PRM22 · PRM23 · PRM24G): HQ's open mark requests, above
 * the register on the admin Positions page, across every company, oldest first
 * (`GET /api/mark-requests/queue`). Investors see none of this queue.
 *
 * Each row: company, investor and kind, reason, evidence (a link, or the file
 * downloaded through `GET /api/mark-requests/:uid/evidence`), the day it was
 * asked and its age, the company's latest mark, then two actions:
 *   Record a mark…  opens the company's position sheet, where the mark is
 *                   recorded (PF-07's write flow) and the request answered
 *                   with it (D6205 part 2). Recording a mark stays an HQ act.
 *   Decline…        Scope → Review → Result, with a reason the investor sees.
 *                   Declining records no mark and changes no figure.
 *
 * States, kept apart: loading · unreadable (never "No open requests"; the
 * register still shows) · empty (the read succeeded) · list.
 *
 * Prop-driven and exported for its own tests; the page owns the read and the
 * writes.
 */
import { useState } from 'react';
import { DECLINE_STEPS, REASON_MAX, declineProblem, answerRefusalWords, queueRows } from './markRequestModel';

const BTN = 'px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 rounded-lg text-xs font-medium dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800';
const PRIMARY = 'px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium dark:bg-violet-500 dark:hover:bg-violet-600';
const MUTED = 'text-sm text-gray-500 dark:text-gray-400';
const INPUT = 'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100';

/** Decline as Scope → Review → Result, inline under the request's row. */
export function DeclineFlow({ row, onDecline, onClose, initialStep = 0, initialNote = '' }) {
  const [step, setStep] = useState(initialStep);
  const [note, setNote] = useState(initialNote);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const problem = declineProblem(note);
  const steps = (
    <ol className="flex gap-2 text-xs font-semibold mb-2" aria-label="Decline steps" data-testid="decline-steps">
      {DECLINE_STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? 'step' : undefined}
          className={i === step ? 'text-violet-700 dark:text-violet-300' : 'text-gray-500 dark:text-gray-400'}>{i + 1}. {s}</li>
      ))}
    </ol>
  );
  const send = async () => {
    if (problem || sending) return;
    setSending(true); setError(null);
    try { await onDecline(row, note.trim()); setStep(2); }
    catch (err) { setError(answerRefusalWords(err)); }
    finally { setSending(false); }
  };
  let body;
  if (step === 0) {
    body = (
      <div data-testid="decline-scope">
        <p className="text-sm text-gray-800 dark:text-gray-200">Decline the request for <b>{row.company}</b> · {row.kind} · {row.requestedOn || 'date not recorded'} · from {row.requester}.</p>
        <label className="block text-xs font-semibold mt-2 text-gray-700 dark:text-gray-300" htmlFor={`decline-${row.uid}`}>Reason the investor will see · required</label>
        <textarea id={`decline-${row.uid}`} rows={3} maxLength={REASON_MAX} className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-decline-reason" />
        <div className="flex gap-2 mt-2">
          <button type="button" className={PRIMARY} disabled={Boolean(problem)} title={problem || undefined} onClick={() => setStep(1)} data-testid="button-decline-review">Review</button>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  } else if (step === 1) {
    body = (
      <div data-testid="decline-review">
        <p className="text-sm text-gray-800 dark:text-gray-200">“{note.trim()}”</p>
        <p className={MUTED}>Declining records no mark and changes no figure. The investor sees Declined, the date and this reason, and may ask again.</p>
        {error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="decline-error">{error} The request is still open; your reason is kept.</p> : null}
        <div className="flex gap-2 mt-2">
          <button type="button" className={PRIMARY} disabled={sending} onClick={send} data-testid="button-decline-send">
            {sending ? 'Declining…' : error ? 'Try again' : `Decline request for ${row.company}`}
          </button>
          <button type="button" className={BTN} disabled={sending} onClick={() => setStep(0)}>Back</button>
        </div>
      </div>
    );
  } else {
    body = (
      <div data-testid="decline-result" role="status">
        <p className="text-sm text-gray-800 dark:text-gray-200">✓ Declined. The investor sees it on Positions with your reason.</p>
        <button type="button" className={BTN} onClick={onClose} data-testid="button-decline-done">Back to the queue</button>
      </div>
    );
  }
  return <div className="mt-2 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">{steps}{body}</div>;
}

export default function MarkRequestQueue({ read, today, onRetry, onRecord, onDecline, onEvidence, declining: initialDeclining = null }) {
  const [declining, setDeclining] = useState(initialDeclining);
  let body;
  let count = null;
  if (read.state === 'loading') {
    body = <p className={MUTED} data-testid="mark-queue-loading">Reading open mark requests…</p>;
  } else if (read.state !== 'ok') {
    body = (
      <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="mark-queue-unreadable">
        Unavailable · the request queue could not be read. The register below is current. This is not “No open requests”.{' '}
        <button type="button" className="underline" onClick={onRetry} data-testid="button-retry-mark-queue">Try again</button>
      </p>
    );
  } else {
    const rows = queueRows(read.items, today);
    count = rows.length;
    body = rows.length === 0 ? (
      <p className={MUTED} data-testid="mark-queue-empty">No open requests. The queue read succeeded.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="mark-queue-table">
          <caption className="text-left text-xs text-gray-500 dark:text-gray-400 pb-2">{rows.length} open · oldest first · investors see none of this queue</caption>
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
              <th scope="col" className="py-1 pr-3">Company</th><th scope="col" className="py-1 pr-3">Investor · kind</th>
              <th scope="col" className="py-1 pr-3">Reason</th><th scope="col" className="py-1 pr-3">Evidence</th>
              <th scope="col" className="py-1 pr-3">Requested on · age</th><th scope="col" className="py-1"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className="border-t border-gray-100 dark:border-gray-800 align-top" data-testid={`mark-queue-row-${r.uid}`}>
                <th scope="row" className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">{r.company}
                  <div className="text-xs font-normal text-gray-500 dark:text-gray-400">Latest mark · {r.latestMark || 'none recorded'}</div></th>
                <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.requester}<div className="text-xs text-gray-500 dark:text-gray-400">{r.kind}</div></td>
                <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 max-w-xs">{r.reason}</td>
                <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 break-all">
                  {!r.evidence ? <span className="text-gray-500 dark:text-gray-400">None</span>
                    : r.hasFile ? <button type="button" className="underline text-violet-700 dark:text-violet-300" onClick={() => onEvidence?.(r)} data-testid={`button-queue-evidence-${r.uid}`}>{r.evidence}</button>
                      : r.href ? <a className="underline text-violet-700 dark:text-violet-300" href={r.href} target="_blank" rel="noopener noreferrer nofollow">{r.evidence}</a>
                        : <span>{r.evidence}</span>}
                </td>
                <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.requestedOn || 'Not recorded'}<div className="text-xs text-gray-500 dark:text-gray-400">{r.age || ''}</div></td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={PRIMARY} onClick={() => onRecord?.(r)} data-testid={`button-queue-record-${r.uid}`}>Record a mark…</button>
                    <button type="button" className={BTN} onClick={() => setDeclining(r.uid)} data-testid={`button-queue-decline-${r.uid}`}>Decline…</button>
                  </div>
                  {declining === r.uid ? <DeclineFlow row={r} onDecline={onDecline} onClose={() => setDeclining(null)} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Decline needs a reason the investor sees · one open request per company per investor is enforced when it is sent.</p>
      </div>
    );
  }
  return (
    <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4" aria-labelledby="mark-queue-title"
      data-testid="mark-request-queue" data-state={read.state === 'ok' ? (count ? 'list' : 'empty') : read.state}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 id="mark-queue-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">Open mark requests</h2>
        {count != null ? <span className="text-xs text-gray-500 dark:text-gray-400">{count} open</span> : null}
      </div>
      <p className={`${MUTED} mb-2`}>Marks are recorded here. Investors ask; HQ answers.</p>
      {body}
    </section>
  );
}
